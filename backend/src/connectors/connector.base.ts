/**
 * AEGIS — Connector Base
 * ======================
 * Classe abstraite pour tous les connecteurs publicitaires.
 * Chaque plateforme étend ConnectorBase et implémente les méthodes.
 *
 * Pattern :
 *   - Token chiffré en DB (pgcrypto)
 *   - Refresh automatique avant expiration
 *   - Mode dégradé si token absent (ne bloque pas le reste)
 *   - Circuit breaker si 3 erreurs consécutives
 *   - Tous les appels loggés dans ops.connector_logs
 */

import { db } from '../utils/db';
import logger from '../utils/logger';

export interface ConnectorCredentials {
  accessToken:    string;
  refreshToken?:  string;
  expiresAt?:     Date;
  accountId:      string;
  extra?:         Record<string, string>;
}

export interface AdCampaign {
  id:         string;
  name:       string;
  status:     'ACTIVE' | 'PAUSED' | 'DELETED' | 'ARCHIVED';
  budget:     number;
  spend:      number;
  impressions:number;
  clicks:     number;
  conversions:number;
  revenue:    number;
  roas:       number;
  cpa:        number;
  cpm:        number;
  ctr:        number;
  startDate:  string;
  endDate?:   string;
}

export interface AdCreative {
  id:       string;
  name:     string;
  type:     'image' | 'video' | 'carousel' | 'collection';
  status:   string;
  imageUrl?: string;
  videoUrl?: string;
  headline?: string;
  body?:    string;
}

export interface AudienceSegment {
  id:       string;
  name:     string;
  size:     number;
  type:     'lookalike' | 'custom' | 'saved' | 'interest';
}

export interface PerformanceReport {
  platform:   string;
  period:     { from: string; to: string };
  spend:      number;
  revenue:    number;
  roas:       number;
  impressions:number;
  clicks:     number;
  conversions:number;
  cpa:        number;
  cpm:        number;
  ctr:        number;
  campaigns:  AdCampaign[];
}

export abstract class ConnectorBase {
  abstract readonly platform: string;
  abstract readonly baseUrl:  string;

  protected tenantId: string;
  protected credentials: ConnectorCredentials | null = null;
  protected errorCount = 0;
  protected readonly MAX_ERRORS = 3;

  constructor(tenantId: string) {
    this.tenantId = tenantId;
  }

  // ── Chargement credentials depuis DB ───────────────────────────────────

  async loadCredentials(): Promise<boolean> {
    try {
      const r = await db.query<{
        access_token: string;
        refresh_token: string | null;
        expires_at: Date | null;
        account_id: string;
        extra_data: Record<string, string> | null;
      }>(
        `SELECT
           pgp_sym_decrypt(access_token_enc::BYTEA,
             current_setting('app.encryption_key')) AS access_token,
           CASE WHEN refresh_token_enc IS NOT NULL
             THEN pgp_sym_decrypt(refresh_token_enc::BYTEA,
               current_setting('app.encryption_key'))
             ELSE NULL END AS refresh_token,
           access_token_expires_at AS expires_at,
           platform_account_id    AS account_id,
           extra_config            AS extra_data
         FROM integrations.connectors
         WHERE tenant_id = $1 AND platform = $2 AND is_active = TRUE`,
        [this.tenantId, this.platform]
      );

      if (!r.rows[0]) {
        logger.warn(`[${this.platform}] Pas de credentials — mode dégradé`);
        return false;
      }

      this.credentials = {
        accessToken:  r.rows[0].access_token,
        refreshToken: r.rows[0].refresh_token ?? undefined,
        expiresAt:    r.rows[0].expires_at ?? undefined,
        accountId:    r.rows[0].account_id,
        extra:        r.rows[0].extra_data ?? {},
      };

      // Token expire dans moins de 48h → refresh préventif
      if (this.credentials.expiresAt) {
        const hoursLeft = (this.credentials.expiresAt.getTime() - Date.now()) / 3600_000;
        if (hoursLeft < 48) {
          logger.info(`[${this.platform}] Token expire dans ${hoursLeft.toFixed(1)}h — refresh préventif`);
          await this.refreshAccessToken();
        }
      }

      return true;
    } catch (err) {
      logger.error(`[${this.platform}] loadCredentials error: ${err}`);
      return false;
    }
  }

  // ── Refresh token ──────────────────────────────────────────────────────

  async refreshAccessToken(): Promise<boolean> {
    if (!this.credentials?.refreshToken) return false;

    try {
      const tokens = await this.doTokenRefresh(this.credentials.refreshToken);

      await db.query(
        `UPDATE integrations.connectors
         SET access_token_enc = pgp_sym_encrypt($1, current_setting('app.encryption_key'))::TEXT,
             access_token_expires_at = $2,
             status = 'active', last_refresh_at = NOW(), error_count = 0
         WHERE tenant_id = $3 AND platform = $4`,
        [tokens.accessToken, tokens.expiresAt, this.tenantId, this.platform]
      );

      this.credentials.accessToken = tokens.accessToken;
      this.credentials.expiresAt   = tokens.expiresAt;
      logger.info(`[${this.platform}] Token refreshed`);
      return true;
    } catch (err) {
      logger.error(`[${this.platform}] Token refresh failed: ${err}`);
      await this.markError(`Token refresh failed: ${err}`);
      return false;
    }
  }

  // ── HTTP helper avec circuit breaker ──────────────────────────────────

  protected async apiRequest<T>(
    method: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH',
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    if (!this.credentials) throw new Error(`[${this.platform}] Pas de credentials`);

    if (this.errorCount >= this.MAX_ERRORS) {
      throw new Error(`[${this.platform}] Circuit breaker ouvert (${this.errorCount} erreurs)`);
    }

    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const start = Date.now();

    try {
      const resp = await fetch(url, {
        method,
        headers: {
          'Content-Type': 'application/json',
          ...this.buildAuthHeaders(),
          ...extraHeaders,
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(30_000),
      });

      const latency = Date.now() - start;
      await this.logRequest(method, path, resp.status, latency);

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`${resp.status}: ${errBody.slice(0, 200)}`);
      }

      this.errorCount = 0; // reset sur succès
      return resp.json() as Promise<T>;

    } catch (err) {
      this.errorCount++;
      await this.markError(String(err));
      throw err;
    }
  }

  // ── Logging ───────────────────────────────────────────────────────────

  protected async logRequest(method: string, path: string, status: number, latencyMs: number): Promise<void> {
    try {
      await db.query(
        `INSERT INTO ops.connector_logs
           (tenant_id, platform, method, endpoint, status_code, latency_ms)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [this.tenantId, this.platform, method, path, status, latencyMs]
      );
    } catch { /* non bloquant */ }
  }

  protected async markError(message: string): Promise<void> {
    await db.query(
      `UPDATE integrations.connectors
       SET last_error = $1, error_count = error_count + 1,
           status = CASE WHEN error_count + 1 >= 3 THEN 'error' ELSE status END
       WHERE tenant_id = $2 AND platform = $3`,
      [message.slice(0, 500), this.tenantId, this.platform]
    ).catch(() => {});
  }

  // ── Méthodes abstraites (implémentées par chaque connecteur) ──────────

  protected abstract buildAuthHeaders(): Record<string, string>;
  protected abstract doTokenRefresh(refreshToken: string): Promise<{ accessToken: string; expiresAt: Date }>;

  abstract getCampaigns(): Promise<AdCampaign[]>;
  abstract getPerformanceReport(fromDate: string, toDate: string): Promise<PerformanceReport>;
  abstract pauseCampaign(campaignId: string): Promise<void>;
  abstract resumeCampaign(campaignId: string): Promise<void>;
  abstract updateBudget(campaignId: string, newBudget: number): Promise<void>;
  abstract createCampaign(params: Record<string, unknown>): Promise<{ id: string }>;
}
