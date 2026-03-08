// ============================================================
// AEGIS — AGENT_CAPI
// Server-side conversion tracking agent
//
// Responsabilités :
//  1. Retry des events CAPI failed (cron 5min)
//  2. Health check : taux de capture par plateforme
//  3. Alertes CEO si capture rate < 80%
//  4. Setup initial des webhooks Shopify
// ============================================================

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import { logger } from '../../utils/logger';
import { capiRelay } from '../../services/capi/capi.relay';
import { setupShopifyWebhooks } from '../../services/capi/shopify.webhook';

export class AgentCAPI extends AgentBase {
  readonly agentId = 'AGENT_CAPI';
  readonly taskTypes = [
    'capi.relay',
    'capi.retry_failed',
    'capi.health_check',
    'capi.setup_webhooks',
    'capi.capture_report',
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    await this.heartbeat();

    switch (task.taskType) {

      // ─── Retry events failed ─────────────────────────
      case 'capi.relay':
      case 'capi.retry_failed':
        return this.retryFailedEvents(task);

      // ─── Health check + alertes ───────────────────────
      case 'capi.health_check':
        return this.healthCheck(task);

      // ─── Setup webhooks Shopify ───────────────────────
      case 'capi.setup_webhooks':
        return this.setupWebhooks(task);

      // ─── Rapport de capture ───────────────────────────
      case 'capi.capture_report':
        return this.captureReport(task);

      default:
        return { success: false, error: `Unknown task type: ${task.taskType}` };
    }
  }

  // ─── Retry des events failed ──────────────────────────

  private async retryFailedEvents(task: AgentTask): Promise<AgentResult> {
    const { tenantId } = task;
    if (!tenantId) return { success: false, error: 'tenantId required' };

    await this.trace('info', 'Retrying failed CAPI events', {}, task.id);

    // Récupérer les events failed avec moins de 3 retries
    const result = await db.query(
      `SELECT id, event_name, event_id, source_id, value, currency,
              content_ids, contents, num_items, order_id,
              user_ip, user_agent, fbc, fbp, ttclid, gclid,
              platforms_target, platforms_ok, retry_count
       FROM analytics.capi_events
       WHERE tenant_id = $1
         AND status IN ('failed', 'partial')
         AND retry_count < 3
         AND created_at > NOW() - INTERVAL '24 hours'
       ORDER BY created_at ASC
       LIMIT 50`,
      [tenantId]
    );

    if (!result.rows.length) {
      await this.trace('info', 'No failed events to retry', {}, task.id);
      return { success: true, output: { retried: 0 } };
    }

    let retried = 0;
    let recovered = 0;

    for (const row of result.rows) {
      try {
        // Incrémenter retry_count et re-relayer
        await db.query(
          `UPDATE analytics.capi_events
           SET retry_count = retry_count + 1, status = 'pending', updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        );

        // Les plateformes à retenter = celles qui n'ont pas encore réussi
        const failedPlatforms: string[] = row.platforms_target.filter(
          (p: string) => !row.platforms_ok.includes(p)
        );

        await this.trace('debug', `Retrying event ${row.event_id} for ${failedPlatforms.join(',')}`, {
          eventId: row.event_id,
          retry: row.retry_count + 1,
          failedPlatforms,
        }, task.id);

        // Re-relay via service
        await capiRelay.relay({
          tenantId,
          eventName: row.event_name,
          sourceId: row.source_id,
          value: row.value,
          currency: row.currency,
          contentIds: row.content_ids,
          contents: row.contents,
          numItems: row.num_items,
          orderId: row.order_id,
          ip: row.user_ip,
          userAgent: row.user_agent,
          fbc: row.fbc,
          fbp: row.fbp,
          ttclid: row.ttclid,
          gclid: row.gclid,
        });

        retried++;
        recovered++;
      } catch (err) {
        logger.error({ eventId: row.event_id, err }, 'CAPI retry failed');
        retried++;
      }
    }

    await this.trace('info', `CAPI retry complete: ${recovered}/${retried} recovered`, {
      retried, recovered,
    }, task.id);

    return { success: true, output: { retried, recovered } };
  }

  // ─── Health check ─────────────────────────────────────

  private async healthCheck(task: AgentTask): Promise<AgentResult> {
    const { tenantId } = task;
    if (!tenantId) return { success: false, error: 'tenantId required' };

    // Calculer le taux de capture des dernières 24h
    const result = await db.query(
      `SELECT
        event_name,
        COUNT(*) AS total,
        COUNT(*) FILTER (WHERE 'meta' = ANY(platforms_ok))     AS meta_ok,
        COUNT(*) FILTER (WHERE 'tiktok' = ANY(platforms_ok))   AS tiktok_ok,
        COUNT(*) FILTER (WHERE 'google' = ANY(platforms_ok))   AS google_ok,
        SUM(value) FILTER (WHERE 'meta' = ANY(platforms_ok))   AS meta_value,
        COUNT(*) FILTER (WHERE status = 'failed')              AS failed_total
       FROM analytics.capi_events
       WHERE tenant_id = $1
         AND created_at > NOW() - INTERVAL '24 hours'
       GROUP BY event_name`,
      [tenantId]
    );

    const stats = result.rows;
    const issues: string[] = [];

    for (const row of stats) {
      const metaRate   = row.total > 0 ? (row.meta_ok / row.total * 100).toFixed(1) : null;
      const tiktokRate = row.total > 0 ? (row.tiktok_ok / row.total * 100).toFixed(1) : null;

      // Alerte si taux de capture < 80%
      if (metaRate && parseFloat(metaRate) < 80) {
        issues.push(`Meta capture rate LOW for ${row.event_name}: ${metaRate}%`);
      }
      if (tiktokRate && parseFloat(tiktokRate) < 80) {
        issues.push(`TikTok capture rate LOW for ${row.event_name}: ${tiktokRate}%`);
      }
      if (row.failed_total > 10) {
        issues.push(`${row.failed_total} failed CAPI events in last 24h`);
      }
    }

    // Si problèmes détectés → alerter AGENT_CEO
    if (issues.length > 0) {
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_CEO',
        messageType: 'ALERT',
        subject: 'CAPI_CAPTURE_DEGRADED',
        payload: {
          tenantId,
          issues,
          stats,
          severity: 'high',
          action: 'CAPI relay dégradé — vérifier credentials Meta/TikTok et connectivité',
        },
        priority: 8,
        tenantId,
      });

      await this.trace('warn', `CAPI health issues detected: ${issues.join(' | ')}`, {
        issues, stats,
      }, task.id);
    } else {
      await this.trace('info', 'CAPI health check passed', { stats }, task.id);
    }

    return {
      success: true,
      output: {
        healthy: issues.length === 0,
        issues,
        stats,
      },
    };
  }

  // ─── Setup webhooks Shopify ───────────────────────────

  private async setupWebhooks(task: AgentTask): Promise<AgentResult> {
    const { tenantId, shopifyDomain, accessToken } = task.input as {
      tenantId: string;
      shopifyDomain: string;
      accessToken: string;
    };

    if (!shopifyDomain || !accessToken) {
      return { success: false, error: 'shopifyDomain and accessToken required' };
    }

    try {
      await setupShopifyWebhooks(tenantId, shopifyDomain, accessToken);

      await this.trace('info', `Shopify webhooks configured for ${shopifyDomain}`, {
        shopifyDomain, tenantId,
      }, task.id);

      // Notifier CEO que le CAPI tracking est opérationnel
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_CEO',
        messageType: 'EVENT',
        subject: 'CAPI_WEBHOOKS_ACTIVE',
        payload: {
          tenantId,
          shopifyDomain,
          message: 'Server-side CAPI tracking activé — données de conversion maintenant fiables à 100%',
        },
        tenantId,
      });

      return { success: true, output: { webhooksConfigured: true, shopifyDomain } };
    } catch (err: any) {
      await this.trace('error', `Failed to setup Shopify webhooks: ${err.message}`, {}, task.id);
      return { success: false, error: err.message };
    }
  }

  // ─── Rapport de capture ───────────────────────────────

  private async captureReport(task: AgentTask): Promise<AgentResult> {
    const { tenantId, days = 7 } = task.input as { tenantId: string; days?: number };

    const result = await db.query(
      `SELECT
        DATE_TRUNC('day', event_time) AS day,
        event_name,
        COUNT(*) AS total_events,
        ROUND(COUNT(*) FILTER (WHERE 'meta' = ANY(platforms_ok))::numeric / NULLIF(COUNT(*),0)*100,1) AS meta_pct,
        ROUND(COUNT(*) FILTER (WHERE 'tiktok' = ANY(platforms_ok))::numeric / NULLIF(COUNT(*),0)*100,1) AS tiktok_pct,
        ROUND(COUNT(*) FILTER (WHERE 'google' = ANY(platforms_ok))::numeric / NULLIF(COUNT(*),0)*100,1) AS google_pct,
        SUM(value) FILTER (WHERE 'meta' = ANY(platforms_ok)) AS meta_revenue_captured
       FROM analytics.capi_events
       WHERE tenant_id = $1
         AND event_time > NOW() - INTERVAL '${days} days'
       GROUP BY 1, 2
       ORDER BY 1 DESC, 2`,
      [tenantId]
    );

    return {
      success: true,
      output: {
        report: result.rows,
        period: `${days} days`,
      },
    };
  }
}
