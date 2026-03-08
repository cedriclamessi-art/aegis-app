/**
 * AdapterWatchdog v6.0
 * Surveille les APIs tierces pour détecter les changements de schéma.
 * Quand Meta change son API v18→v20, AEGIS le détecte avant que les agents
 * ne cassent.
 *
 * Principe : si le hash de la réponse type change → drift détecté → alerte.
 * Les agents utilisent l'adapter registry pour savoir quelle version appeler.
 * Un seul endroit à mettre à jour quand une API change.
 */
import { Pool } from 'pg';
import * as crypto from 'crypto';

interface EndpointSpec {
  platform: string;
  endpoint: string;
  method:   string;
  sample_params?: Record<string, any>;
  critical_fields: string[];  // champs dont la présence est requise
}

// Endpoints critiques surveillés
const WATCHED_ENDPOINTS: EndpointSpec[] = [
  {
    platform: 'meta',
    endpoint: '/v20.0/act_{account_id}/campaigns',
    method:   'GET',
    critical_fields: ['id','name','status','daily_budget','effective_status'],
  },
  {
    platform: 'meta',
    endpoint: '/v20.0/act_{account_id}/adsets',
    method:   'GET',
    critical_fields: ['id','name','status','daily_budget','campaign_id'],
  },
  {
    platform: 'shopify',
    endpoint: '/admin/api/2024-10/orders.json',
    method:   'GET',
    critical_fields: ['id','total_price','created_at','financial_status','customer'],
  },
  {
    platform: 'shopify',
    endpoint: '/admin/api/2024-10/products.json',
    method:   'GET',
    critical_fields: ['id','title','variants','published_at'],
  },
  {
    platform: 'tiktok',
    endpoint: '/open_api/v1.3/campaign/get/',
    method:   'GET',
    critical_fields: ['campaign_id','campaign_name','status','budget'],
  },
];

export class AdapterWatchdog {
  constructor(private db: Pool) {}

  /**
   * Vérifie tous les adapters enregistrés.
   * Appelé quotidiennement par le scheduler.
   */
  async checkAll(shopId: string): Promise<{ healthy: number; degraded: number; drifts: any[] }> {
    let healthy = 0, degraded = 0;
    const drifts: any[] = [];

    const { rows: adapters } = await this.db.query(
      `SELECT * FROM connector_adapters WHERE is_active=true AND is_deprecated=false`);

    for (const adapter of adapters) {
      try {
        const result = await this.checkAdapter(shopId, adapter);
        if (result.healthy) healthy++;
        else { degraded++; drifts.push(...result.drifts); }

        await this.db.query(`
          UPDATE connector_adapters SET
            last_health_check=NOW(), health_status=$1,
            error_rate_24h=$2, avg_latency_ms=$3, schema_drift_count=$4
          WHERE id=$5`,
          [result.healthy ? 'healthy' : 'degraded',
           result.error_rate, result.avg_latency, result.drift_count, adapter.id]);
      } catch {
        degraded++;
        await this.db.query(
          `UPDATE connector_adapters SET health_status='down', last_health_check=NOW() WHERE id=$1`,
          [adapter.id]);
      }
    }

    return { healthy, degraded, drifts };
  }

  private async checkAdapter(shopId: string, adapter: any): Promise<{
    healthy: boolean; drifts: any[]; error_rate: number; avg_latency: number; drift_count: number;
  }> {
    const endpoints = WATCHED_ENDPOINTS.filter(e => e.platform === adapter.platform);
    const drifts: any[] = [];
    let totalLatency = 0, errorCount = 0;

    for (const ep of endpoints) {
      const start = Date.now();
      try {
        const response = await this.probeEndpoint(shopId, adapter.platform, ep);
        totalLatency += Date.now() - start;

        if (response) {
          // Vérifie les champs critiques
          const missingFields = ep.critical_fields.filter(f => !(f in response));

          // Hash de structure (type des champs, pas les valeurs)
          const structureHash = this.hashStructure(response);

          if (adapter.schema_hash && adapter.schema_hash !== structureHash) {
            // Drift détecté
            const drift = {
              platform:    adapter.platform,
              adapter_id:  adapter.id,
              endpoint:    ep.endpoint,
              drift_type:  missingFields.length ? 'field_removed' : 'type_changed',
              is_breaking: missingFields.length > 0,
              field_path:  missingFields.join(',') || 'structure_changed',
              old_value:   adapter.schema_hash,
              new_value:   structureHash,
            };

            await this.db.query(`
              INSERT INTO api_schema_drifts
                (platform, adapter_id, endpoint, drift_type, field_path, old_value, new_value, is_breaking)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
              [drift.platform, drift.adapter_id, drift.endpoint, drift.drift_type,
               drift.field_path, drift.old_value, drift.new_value, drift.is_breaking]);

            drifts.push(drift);

            if (drift.is_breaking) {
              // Alerte critique — l'adapter doit être mis à jour
              await this.db.query(`
                UPDATE connector_adapters SET
                  health_status='degraded', schema_drift_count=schema_drift_count+1,
                  last_schema_change=NOW()
                WHERE id=$1`, [adapter.id]);
            }
          } else if (!adapter.schema_hash) {
            // Premier check — enregistre le hash de référence
            await this.db.query(
              `UPDATE connector_adapters SET schema_hash=$1 WHERE id=$2`, [structureHash, adapter.id]);
          }
        }
      } catch {
        errorCount++;
      }
    }

    const errorRate = endpoints.length > 0 ? errorCount / endpoints.length : 0;
    const avgLatency = endpoints.length > 0 ? totalLatency / endpoints.length : 0;

    return {
      healthy:     errorRate < 0.3 && drifts.filter(d => d.is_breaking).length === 0,
      drifts,
      error_rate:  errorRate,
      avg_latency: avgLatency,
      drift_count: drifts.length,
    };
  }

  private async probeEndpoint(shopId: string, platform: string, ep: EndpointSpec): Promise<any> {
    // En production: utilise les credentials du shop pour faire un appel réel
    // Ici on retourne un mock structural pour le build
    const mocks: Record<string, any> = {
      meta:     { id: '', name: '', status: '', daily_budget: 0, effective_status: '', campaign_id: '' },
      shopify:  { id: 0, total_price: '', created_at: '', financial_status: '', customer: {} },
      tiktok:   { campaign_id: '', campaign_name: '', status: '', budget: 0 },
    };
    return mocks[platform] ?? null;
  }

  private hashStructure(obj: any): string {
    const structure = this.extractStructure(obj);
    return crypto.createHash('md5').update(JSON.stringify(structure)).digest('hex');
  }

  private extractStructure(obj: any, depth = 0): any {
    if (depth > 3) return typeof obj;
    if (Array.isArray(obj)) return [this.extractStructure(obj[0], depth + 1)];
    if (obj && typeof obj === 'object') {
      return Object.fromEntries(
        Object.entries(obj).map(([k, v]) => [k, this.extractStructure(v, depth + 1)])
      );
    }
    return typeof obj;
  }

  /**
   * Retourne un adapter sain pour une plateforme.
   * Si l'adapter actuel est down, essaie une version précédente.
   */
  async getHealthyAdapter(platform: string): Promise<any> {
    const { rows } = await this.db.query(`
      SELECT * FROM connector_adapters
      WHERE platform=$1 AND is_active=true
        AND health_status IN ('healthy','unknown')
      ORDER BY (health_status='healthy') DESC, api_version DESC
      LIMIT 1`, [platform]);
    return rows[0] ?? null;
  }
}
