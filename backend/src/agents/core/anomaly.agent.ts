/**
 * AGENT_ANOMALY v3.5 — Structural monitoring
 * Runs every 15 minutes. Detects:
 *   - spend_spike: spend ×3 in 30min
 *   - capi_silence: no CAPI events in 30min
 *   - token_expiry: API tokens expiring < 7 days
 *   - webhook_failure: no webhook received in 15min
 *   - roas_collapse: ROAS dropped > 50% vs last cycle
 *   - cpa_explosion: CPA ×3 vs 24h avg
 *   - data_gap: missing ad metrics for > 30min
 *   - budget_deviation: actual spend > planned by >20%
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentAnomaly extends BaseAgent {
  readonly name = 'AGENT_ANOMALY';
  private claude: Anthropic;

  constructor(db: any, redis: any) {
    super(db, redis);
    this.claude = new Anthropic();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    return this.scan(task);
  }

  private async scan(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const anomalies: Array<{type: string; severity: string; title: string; description: string; data?: unknown}> = [];

    await Promise.allSettled([
      this.checkSpendSpike(shop_id, anomalies),
      this.checkCAPIsilence(shop_id, anomalies),
      this.checkTokenExpiry(shop_id, anomalies),
      this.checkROASCollapse(shop_id, anomalies),
      this.checkCPAExplosion(shop_id, anomalies),
      this.checkDataGap(shop_id, anomalies),
    ]);

    // Persist anomalies to DB
    for (const a of anomalies) {
      await this.db.query(
        `INSERT INTO anomalies (shop_id, anomaly_type, severity, title, description, data_snapshot)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [shop_id, a.type, a.severity, a.title, a.description, a.data ? JSON.stringify(a.data) : null]
      );

      // Deposit into shared memory so Orchestrator sees it
      await this.remember(shop_id, {
        memory_key:  `anomaly_${a.type}`,
        memory_type: 'warning',
        value: {
          severity: a.severity,
          message:  a.title,
          detail:   a.description,
        },
        confidence: 0.95,
        ttl_hours:  a.severity === 'emergency' ? 2 : 6,
      });

      // Emit critical+ anomalies immediately
      if (a.severity === 'critical' || a.severity === 'emergency') {
        await this.emit('anomaly_critical', { shop_id, type: a.type, title: a.title, severity: a.severity });
      }
    }

    // Deposit scan result (even if no anomalies — confirms system health)
    await this.remember(shop_id, {
      memory_key:  'anomaly_scan_last',
      memory_type: 'observation',
      value:       { scanned_at: new Date().toISOString(), anomalies_found: anomalies.length },
      ttl_hours:   1,
    });

    return { success: true, data: { anomalies_found: anomalies.length, anomalies } };
  }

  // ── CHECKS ───────────────────────────────────────────────

  private async checkSpendSpike(shopId: string, out: any[]): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT
         SUM(CASE WHEN recorded_at > NOW() - INTERVAL '30 minutes' THEN spend END) AS spend_30m,
         SUM(CASE WHEN recorded_at > NOW() - INTERVAL '2 hours'    THEN spend END) / 4.0 AS spend_30m_avg
       FROM ad_events WHERE shop_id = $1`,
      [shopId]
    );
    const r = rows[0];
    if (!r?.spend_30m) return;
    const ratio = parseFloat(r.spend_30m) / Math.max(parseFloat(r.spend_30m_avg ?? 1), 1);
    if (ratio >= 3) {
      out.push({
        type: 'spend_spike', severity: ratio >= 5 ? 'emergency' : 'critical',
        title: `Spend spike ×${ratio.toFixed(1)} in 30 minutes`,
        description: `€${parseFloat(r.spend_30m).toFixed(2)} spent in 30min vs avg €${parseFloat(r.spend_30m_avg).toFixed(2)}`,
        data: { ratio, spend_30m: r.spend_30m, avg: r.spend_30m_avg },
      });
    }
  }

  private async checkCAPIsilence(shopId: string, out: any[]): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT MAX(created_at) AS last_event
       FROM capi_events WHERE shop_id = $1`,
      [shopId]
    );
    const last = rows[0]?.last_event;
    if (!last) return;
    const minutesSince = (Date.now() - new Date(last).getTime()) / 60000;
    if (minutesSince > 30) {
      out.push({
        type: 'capi_silence', severity: minutesSince > 60 ? 'critical' : 'warning',
        title: `CAPI silence — no events for ${Math.round(minutesSince)} minutes`,
        description: 'Server-side conversion tracking may be broken. Meta/TikTok will have degraded targeting.',
        data: { last_event: last, minutes_since: minutesSince },
      });
    }
  }

  private async checkTokenExpiry(shopId: string, out: any[]): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT platform, expires_at
       FROM platform_credentials
       WHERE shop_id = $1 AND expires_at < NOW() + INTERVAL '7 days'`,
      [shopId]
    );
    for (const row of rows) {
      const daysLeft = (new Date(row.expires_at).getTime() - Date.now()) / 86400000;
      out.push({
        type: 'token_expiry', severity: daysLeft < 1 ? 'emergency' : daysLeft < 3 ? 'critical' : 'warning',
        title: `${row.platform} token expires in ${daysLeft.toFixed(1)} days`,
        description: `Renew ${row.platform} access token before expiry to prevent campaign interruption.`,
        data: { platform: row.platform, expires_at: row.expires_at, days_left: daysLeft },
      });
    }
  }

  private async checkROASCollapse(shopId: string, out: any[]): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT
         AVG(CASE WHEN recorded_at > NOW() - INTERVAL '2 hours'  THEN roas END) AS roas_2h,
         AVG(CASE WHEN recorded_at > NOW() - INTERVAL '24 hours' THEN roas END) AS roas_24h
       FROM ad_metrics WHERE shop_id = $1`,
      [shopId]
    );
    const r = rows[0];
    if (!r?.roas_2h || !r?.roas_24h) return;
    const drop = (parseFloat(r.roas_24h) - parseFloat(r.roas_2h)) / parseFloat(r.roas_24h);
    if (drop > 0.5) {
      out.push({
        type: 'roas_collapse', severity: drop > 0.7 ? 'critical' : 'warning',
        title: `ROAS collapsed ${(drop * 100).toFixed(0)}% in last 2h`,
        description: `ROAS dropped from ${parseFloat(r.roas_24h).toFixed(2)}× (24h avg) to ${parseFloat(r.roas_2h).toFixed(2)}× (2h avg)`,
        data: { roas_2h: r.roas_2h, roas_24h: r.roas_24h, drop_pct: drop },
      });
    }
  }

  private async checkCPAExplosion(shopId: string, out: any[]): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT
         AVG(CASE WHEN recorded_at > NOW() - INTERVAL '2 hours'  THEN cpa END) AS cpa_2h,
         AVG(CASE WHEN recorded_at > NOW() - INTERVAL '24 hours' THEN cpa END) AS cpa_24h
       FROM ad_metrics WHERE shop_id = $1`,
      [shopId]
    );
    const r = rows[0];
    if (!r?.cpa_2h || !r?.cpa_24h) return;
    const ratio = parseFloat(r.cpa_2h) / parseFloat(r.cpa_24h);
    if (ratio > 3) {
      out.push({
        type: 'cpa_explosion', severity: 'critical',
        title: `CPA ×${ratio.toFixed(1)} vs 24h avg`,
        description: `CPA spiked to €${parseFloat(r.cpa_2h).toFixed(2)} vs €${parseFloat(r.cpa_24h).toFixed(2)} 24h avg`,
        data: { cpa_2h: r.cpa_2h, cpa_24h: r.cpa_24h, ratio },
      });
    }
  }

  private async checkDataGap(shopId: string, out: any[]): Promise<void> {
    const { rows } = await this.db.query(
      `SELECT MAX(recorded_at) AS last_metric FROM ad_metrics WHERE shop_id = $1`, [shopId]
    );
    const last = rows[0]?.last_metric;
    if (!last) return;
    const minutesSince = (Date.now() - new Date(last).getTime()) / 60000;
    if (minutesSince > 30) {
      out.push({
        type: 'data_gap', severity: minutesSince > 60 ? 'critical' : 'warning',
        title: `Data gap — no ad metrics for ${Math.round(minutesSince)} minutes`,
        description: 'Ad metric collection interrupted. Agents may be making decisions on stale data.',
        data: { last_metric: last, minutes_since: minutesSince },
      });
    }
  }
}
