/**
 * AEGIS — Connector Registry
 * ==========================
 * Point d'entrée unique pour tous les connecteurs.
 * AGENT_CONNECTOR_MANAGER utilise ce registry.
 *
 * Usage :
 *   const meta = await ConnectorRegistry.get('meta', tenantId);
 *   const campaigns = await meta.getCampaigns();
 */

import { ConnectorBase } from './connector.base';
import { MetaConnector }      from './meta.connector';
import {
  PinterestConnector,
  SnapchatConnector,
  GoogleAdsConnector,
} from './platforms.connector';
import { TikTokConnector } from './tiktok.connector';
import logger from '../utils/logger';

type PlatformId = 'meta' | 'tiktok' | 'pinterest' | 'snapchat' | 'google';

const CONNECTOR_MAP: Record<PlatformId, new (tenantId: string) => ConnectorBase> = {
  meta:      MetaConnector,
  tiktok:    TikTokConnector,
  pinterest: PinterestConnector,
  snapchat:  SnapchatConnector,
  google:    GoogleAdsConnector,
};

// Cache en mémoire par (tenantId, platform) — TTL 5 min
const cache = new Map<string, { connector: ConnectorBase; loadedAt: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000;

export class ConnectorRegistry {

  /**
   * Récupère un connecteur initialisé pour un tenant.
   * Retourne null si pas de credentials (mode dégradé).
   */
  static async get(platform: PlatformId, tenantId: string): Promise<ConnectorBase | null> {
    const cacheKey = `${tenantId}:${platform}`;
    const cached   = cache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < CACHE_TTL_MS) {
      return cached.connector;
    }

    const ConnectorClass = CONNECTOR_MAP[platform];
    if (!ConnectorClass) {
      logger.warn(`[REGISTRY] Plateforme inconnue : ${platform}`);
      return null;
    }

    const connector = new ConnectorClass(tenantId);
    const loaded    = await connector.loadCredentials();

    if (!loaded) {
      logger.warn(`[REGISTRY] ${platform} — pas de credentials pour tenant ${tenantId} — mode dégradé`);
      return null;
    }

    cache.set(cacheKey, { connector, loadedAt: Date.now() });
    return connector;
  }

  /**
   * Tous les connecteurs actifs pour un tenant.
   */
  static async getAll(tenantId: string): Promise<Partial<Record<PlatformId, ConnectorBase>>> {
    const platforms = Object.keys(CONNECTOR_MAP) as PlatformId[];
    const results: Partial<Record<PlatformId, ConnectorBase>> = {};

    await Promise.allSettled(
      platforms.map(async platform => {
        const connector = await ConnectorRegistry.get(platform, tenantId);
        if (connector) results[platform] = connector;
      })
    );

    return results;
  }

  /**
   * Rapport de performance consolidé toutes plateformes.
   */
  static async getConsolidatedReport(tenantId: string, fromDate: string, toDate: string) {
    const connectors = await ConnectorRegistry.getAll(tenantId);
    const reports    = await Promise.allSettled(
      Object.entries(connectors).map(([, connector]) =>
        connector.getPerformanceReport(fromDate, toDate)
      )
    );

    const successful = reports
      .filter(r => r.status === 'fulfilled')
      .map(r => (r as PromiseFulfilledResult<Awaited<ReturnType<ConnectorBase['getPerformanceReport']>>>).value);

    // Agrégation cross-platform
    const totals = successful.reduce((acc, r) => ({
      spend:       acc.spend + r.spend,
      revenue:     acc.revenue + r.revenue,
      impressions: acc.impressions + r.impressions,
      clicks:      acc.clicks + r.clicks,
      conversions: acc.conversions + r.conversions,
    }), { spend: 0, revenue: 0, impressions: 0, clicks: 0, conversions: 0 });

    const mer = totals.spend > 0 ? totals.revenue / totals.spend : 0;

    return {
      period:    { from: fromDate, to: toDate },
      platforms: successful,
      totals,
      mer,                                         // MER global cross-platform
      cpa_blended: totals.conversions > 0 ? totals.spend / totals.conversions : 0,
    };
  }

  /**
   * Pause d'urgence sur toutes les plateformes (stop-loss global).
   */
  static async emergencyPauseAll(tenantId: string, campaignIds: Record<PlatformId, string[]>): Promise<{
    platform: string; paused: number; errors: string[];
  }[]> {
    const connectors = await ConnectorRegistry.getAll(tenantId);
    const results    = [];

    for (const [platform, connector] of Object.entries(connectors)) {
      const ids    = campaignIds[platform as PlatformId] ?? [];
      const errors: string[] = [];
      let paused = 0;

      for (const id of ids) {
        try {
          await connector.pauseCampaign(id);
          paused++;
        } catch (err) {
          errors.push(`${id}: ${err}`);
        }
      }

      results.push({ platform, paused, errors });
    }

    logger.warn(`[REGISTRY] Emergency pause — ${results.map(r => `${r.platform}:${r.paused}`).join(', ')}`);
    return results;
  }

  /**
   * Invalide le cache pour un tenant (après refresh token par ex.).
   */
  static invalidate(tenantId: string, platform?: PlatformId): void {
    if (platform) {
      cache.delete(`${tenantId}:${platform}`);
    } else {
      for (const key of cache.keys()) {
        if (key.startsWith(`${tenantId}:`)) cache.delete(key);
      }
    }
  }
}
