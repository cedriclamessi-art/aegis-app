/**
 * AGENT_ATTRIBUTION v3.6 — First-party order reconciliation
 * Deduplicates conversions across Meta/TikTok/Pinterest/Snapchat/Google.
 * Every Shopify order gets ONE attribution. Prevents 30-60% inflation.
 *
 * Flow:
 *   1. Shopify order created → order_id + event_id generated
 *   2. CAPI relay sends same event_id to all platforms
 *   3. Each platform claims the conversion (normal)
 *   4. This agent reconciles: ONE order → ONE attribution
 *   5. Reports true ROAS per platform vs inflated ROAS
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

type AttributionModel = 'last_click' | 'linear' | 'first_click';

interface PlatformClaim {
  platform:     string;
  ad_id:        string;
  campaign_id:  string;
  click_time:   Date;
  window_hours: number;
  is_view_through: boolean;
}

export class AgentAttribution extends BaseAgent {
  readonly name = 'AGENT_ATTRIBUTION';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'record_order':         return this.recordOrder(task);
      case 'add_platform_claim':   return this.addPlatformClaim(task);
      case 'resolve_attribution':  return this.resolveAttribution(task);
      case 'reconcile_daily':      return this.reconcileDaily(task);
      case 'get_inflation_report': return this.getInflationReport(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  /**
   * Record a new Shopify order in the attribution system.
   * Called by Shopify webhook handler.
   */
  private async recordOrder(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { order_id, order_value, order_at } = payload as any;

    // Generate deterministic event_id (same order always gets same id)
    const eventId = `aegis_${shop_id.slice(0,8)}_${order_id}`;

    await this.db.query(
      `INSERT INTO attribution_events
         (shop_id, shopify_order_id, event_id, order_value, order_at)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (event_id) DO NOTHING`,
      [shop_id, order_id, eventId, order_value, order_at ?? new Date()]
    );

    // Emit event_id to CAPI relay — it will use this for all platforms
    await this.emit('capi:send_order', {
      shop_id, order_id, event_id: eventId,
      order_value,
      send_to: ['meta', 'tiktok', 'pinterest', 'snapchat', 'google'],
    });

    return { success: true, data: { event_id: eventId, order_id } };
  }

  /**
   * Add a platform's claim to an order.
   * Called when platform reports a conversion for our event_id.
   */
  private async addPlatformClaim(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { event_id, platform, ad_id, campaign_id, click_time, window_hours, is_view_through } = payload as any;

    const claim: PlatformClaim = {
      platform, ad_id, campaign_id,
      click_time: new Date(click_time),
      window_hours: window_hours ?? 7 * 24,
      is_view_through: is_view_through ?? false,
    };

    await this.db.query(
      `UPDATE attribution_events
       SET platform_claims = platform_claims || $1::jsonb
       WHERE event_id = $2 AND shop_id = $3`,
      [JSON.stringify(claim), event_id, shop_id]
    );

    // Resolve attribution now that we have a new claim
    await this.resolveAttribution({ ...task, payload: { event_id } });

    return { success: true, data: { event_id, platform } };
  }

  /**
   * Resolve which platform gets credit for an order.
   * Model: last_click (default) — most recent click before purchase wins.
   * View-through conversions get lower priority than click-through.
   */
  private async resolveAttribution(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { event_id, model = 'last_click' } = payload as any;

    const { rows } = await this.db.query(
      `SELECT event_id, platform_claims, order_value, order_at
       FROM attribution_events WHERE event_id = $1 AND shop_id = $2`,
      [event_id, shop_id]
    );
    if (!rows[0]) return { success: false, message: 'Event not found' };

    const claims: PlatformClaim[] = rows[0].platform_claims ?? [];
    if (!claims.length) return { success: true, message: 'No claims yet' };

    const orderAt  = new Date(rows[0].order_at);
    let winner: PlatformClaim | null = null;

    if (model === 'last_click') {
      // Last click-through before purchase wins. View-through only if no click.
      const clickThroughs = claims.filter(c => !c.is_view_through);
      const pool = clickThroughs.length > 0 ? clickThroughs : claims;

      // Find most recent click within attribution window
      const valid = pool.filter(c => {
        const clickAge = (orderAt.getTime() - new Date(c.click_time).getTime()) / 3600000;
        return clickAge >= 0 && clickAge <= c.window_hours;
      });

      if (valid.length > 0) {
        winner = valid.reduce((latest, c) =>
          new Date(c.click_time) > new Date(latest.click_time) ? c : latest
        );
      }
    }

    if (!winner) return { success: true, message: 'No valid claim in window' };

    // Check for duplicate: has this order already been attributed?
    const { rows: existing } = await this.db.query(
      `SELECT id FROM attribution_events
       WHERE shopify_order_id = (SELECT shopify_order_id FROM attribution_events WHERE event_id = $1)
         AND attributed_platform IS NOT NULL
         AND id != (SELECT id FROM attribution_events WHERE event_id = $1)`,
      [event_id]
    );

    const isDuplicate = existing.length > 0;

    await this.db.query(
      `UPDATE attribution_events
       SET attributed_platform  = $1,
           attributed_ad_id     = $2,
           attribution_model    = $3,
           attribution_confidence = $4,
           is_duplicate         = $5,
           duplicate_of         = $6
       WHERE event_id = $7`,
      [
        winner.platform, winner.ad_id, model,
        0.85, // base confidence
        isDuplicate,
        isDuplicate ? existing[0].id : null,
        event_id,
      ]
    );

    return { success: true, data: { winner: winner.platform, ad_id: winner.ad_id } };
  }

  /**
   * Daily reconciliation: compare platform-reported vs Shopify-actual.
   * Compute inflation factor per platform.
   */
  private async reconcileDaily(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const dateStr = yesterday.toISOString().slice(0, 10);

    // Get platforms active yesterday
    const { rows: platforms } = await this.db.query(
      `SELECT DISTINCT platform FROM ad_metrics WHERE shop_id = $1 AND DATE(recorded_at) = $2`,
      [shop_id, dateStr]
    );

    const reconciliations = [];

    for (const { platform } of platforms) {
      // Platform-reported
      const { rows: reported } = await this.db.query(
        `SELECT SUM(conversions) AS conv, SUM(revenue) AS rev
         FROM ad_metrics WHERE shop_id = $1 AND platform = $2 AND DATE(recorded_at) = $3`,
        [shop_id, platform, dateStr]
      );

      // Shopify-actual (our first-party attribution)
      const { rows: actual } = await this.db.query(
        `SELECT COUNT(*) AS conv, SUM(order_value) AS rev
         FROM attribution_events
         WHERE shop_id = $1 AND attributed_platform = $2
           AND DATE(order_at) = $3 AND is_duplicate = false`,
        [shop_id, platform, dateStr]
      );

      await this.db.query(
        `INSERT INTO attribution_reconciliation
           (shop_id, period_date, platform,
            platform_reported_conversions, platform_reported_revenue,
            shopify_actual_conversions, shopify_actual_revenue)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (shop_id, period_date, platform) DO UPDATE SET
           platform_reported_conversions = EXCLUDED.platform_reported_conversions,
           platform_reported_revenue     = EXCLUDED.platform_reported_revenue,
           shopify_actual_conversions    = EXCLUDED.shopify_actual_conversions,
           shopify_actual_revenue        = EXCLUDED.shopify_actual_revenue`,
        [
          shop_id, dateStr, platform,
          parseInt(reported[0]?.conv ?? 0), parseFloat(reported[0]?.rev ?? 0),
          parseInt(actual[0]?.conv ?? 0),   parseFloat(actual[0]?.rev ?? 0),
        ]
      );
      reconciliations.push({ platform, reported: reported[0], actual: actual[0] });
    }

    // Deposit inflation signal
    const { rows: inflation } = await this.db.query(
      `SELECT platform, attribution_inflation_pct FROM attribution_reconciliation
       WHERE shop_id = $1 AND period_date = $2 ORDER BY attribution_inflation_pct DESC`,
      [shop_id, dateStr]
    );

    if (inflation.length > 0) {
      await this.remember(shop_id, {
        memory_key:  'attribution_inflation',
        memory_type: 'signal',
        value: {
          date: dateStr,
          platforms: inflation,
          avg_inflation: inflation.reduce((s, r) => s + parseFloat(r.attribution_inflation_pct), 0) / inflation.length,
        },
        ttl_hours: 48,
      });
    }

    return { success: true, data: { reconciliations, inflation } };
  }

  private async getInflationReport(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows } = await this.db.query(
      `SELECT platform, AVG(attribution_inflation_pct) AS avg_inflation,
              AVG(shopify_actual_conversions) AS avg_real_conv,
              AVG(platform_reported_conversions) AS avg_reported_conv
       FROM attribution_reconciliation
       WHERE shop_id = $1 AND period_date > NOW() - INTERVAL '30 days'
       GROUP BY platform ORDER BY avg_inflation DESC`,
      [shop_id]
    );
    return { success: true, data: { inflation_by_platform: rows } };
  }
}
