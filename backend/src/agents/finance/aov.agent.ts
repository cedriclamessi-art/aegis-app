/**
 * AGENT_AOV v3.8 — Average Order Value optimization
 * Tests bundles and upsells. Measures AOV impact, not just conversion.
 * Alerts when cross-sell opportunities are missed.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentAOV extends BaseAgent {
  readonly name = 'AGENT_AOV';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'analyze':          return this.analyze(task);
      case 'propose_bundles':  return this.proposeBundles(task);
      case 'record_snapshot':  return this.recordSnapshot(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Daily analysis of AOV trends and bundle performance. */
  private async analyze(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Current vs historical AOV
    const { rows: aovData } = await this.db.query(`
      SELECT
        AVG(total_price) AS avg_aov,
        PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY total_price) AS median_aov,
        AVG(line_items_count) AS avg_items,
        COUNT(*) AS order_count
      FROM shopify_orders
      WHERE shop_id = $1 AND created_at > NOW() - INTERVAL '7 days'`, [shop_id]);

    const { rows: prevAov } = await this.db.query(`
      SELECT AVG(total_price) AS avg_aov
      FROM shopify_orders
      WHERE shop_id = $1
        AND created_at BETWEEN NOW() - INTERVAL '14 days' AND NOW() - INTERVAL '7 days'`,
      [shop_id]);

    const currentAOV = parseFloat(aovData[0]?.avg_aov ?? 0);
    const prevAOV    = parseFloat(prevAov[0]?.avg_aov ?? 0);
    const aovDelta   = prevAOV > 0 ? ((currentAOV - prevAOV) / prevAOV) * 100 : 0;

    // Bundle performance
    const { rows: bundles } = await this.db.query(`
      SELECT bundle_name, conversions, avg_order_value, status,
             avg_order_value - individual_price AS lift
      FROM bundle_tests WHERE shop_id = $1 AND status != 'paused'
      ORDER BY avg_order_value DESC`, [shop_id]);

    // Upsell rate
    const { rows: upsell } = await this.db.query(`
      SELECT
        COUNT(CASE WHEN line_items_count > 1 THEN 1 END)::numeric / NULLIF(COUNT(*),0) AS upsell_rate
      FROM shopify_orders WHERE shop_id = $1 AND created_at > NOW() - INTERVAL '30 days'`, [shop_id]);

    const upsellRate = parseFloat(upsell[0]?.upsell_rate ?? 0);

    // Snapshot
    await this.db.query(`
      INSERT INTO aov_snapshots (shop_id, period_date, avg_order_value, median_order_value, upsell_rate)
      VALUES ($1, CURRENT_DATE, $2, $3, $4)
      ON CONFLICT (shop_id, period_date) DO UPDATE SET
        avg_order_value=$2, median_order_value=$3, upsell_rate=$4`,
      [shop_id, currentAOV, aovData[0]?.median_aov ?? currentAOV, upsellRate]);

    // Memory signal
    const memType = aovDelta < -10 ? 'warning' : upsellRate < 0.15 ? 'opportunity' : 'signal';
    await this.remember(shop_id, {
      memory_key: 'aov_snapshot', memory_type: memType,
      value: {
        current_aov: currentAOV, prev_aov: prevAOV, delta_pct: aovDelta,
        upsell_rate: upsellRate,
        message: aovDelta < -10
          ? `AOV dropped ${Math.abs(aovDelta).toFixed(1)}% vs last week — review bundles`
          : upsellRate < 0.15
          ? `Upsell rate only ${(upsellRate*100).toFixed(1)}% — bundle opportunity`
          : `AOV stable at €${currentAOV.toFixed(2)}`,
        severity: aovDelta < -10 ? 'warning' : 'info',
      },
      ttl_hours: 24,
    });

    return { success: true, data: { current_aov: currentAOV, delta_pct: aovDelta, upsell_rate: upsellRate, bundles } };
  }

  /** Proposes bundles based on product co-purchase analysis. */
  private async proposeBundles(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Find products frequently bought together
    const { rows: pairs } = await this.db.query(`
      SELECT a.product_id AS pid_a, a.product_name AS name_a, a.price AS price_a,
             b.product_id AS pid_b, b.product_name AS name_b, b.price AS price_b,
             COUNT(*) AS co_purchases
      FROM shopify_order_items a
      JOIN shopify_order_items b ON b.order_id = a.order_id AND b.product_id > a.product_id
      WHERE a.shop_id = $1 AND a.created_at > NOW() - INTERVAL '90 days'
      GROUP BY a.product_id, a.product_name, a.price, b.product_id, b.product_name, b.price
      HAVING COUNT(*) >= 3
      ORDER BY co_purchases DESC LIMIT 10`, [shop_id]);

    // Also get single-product SKUs with high repeat purchase
    const { rows: highRepeat } = await this.db.query(`
      SELECT product_id, product_name, AVG(price) AS price, COUNT(*) AS orders
      FROM shopify_order_items
      WHERE shop_id = $1 AND created_at > NOW() - INTERVAL '90 days'
      GROUP BY product_id, product_name
      ORDER BY orders DESC LIMIT 5`, [shop_id]);

    // Ask Claude to design bundle strategy
    const pairSummary = pairs.map(p =>
      `${p.name_a} (€${p.price_a}) + ${p.name_b} (€${p.price_b}) — co-purchased ${p.co_purchases}×`
    ).join('\n');

    let bundles: any[] = [];
    try {
      const resp = await this.claude.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 400,
        messages: [{
          role: 'user',
          content: `DTC brand Blissal (French exfoliating towels). Product pairs frequently bought together:
${pairSummary || '(insufficient data)'}

High-volume SKUs: ${highRepeat.map(r => `${r.product_name} (${r.orders} orders)`).join(', ')}

Propose 2-3 concrete bundles. Respond in JSON array:
[{"name":"...","products":["pid_a","pid_b"],"suggested_price":0,"individual_total":0,"discount_pct":0,"rationale":"..."}]`
        }]
      });
      const text = (resp.content[0] as any).text.replace(/```json|```/g,'').trim();
      bundles = JSON.parse(text);
    } catch { bundles = []; }

    // Create bundle tests
    for (const b of bundles) {
      await this.db.query(`
        INSERT INTO bundle_tests (shop_id, bundle_name, product_ids, bundle_price, individual_price, discount_pct)
        VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [shop_id, b.name, b.products, b.suggested_price, b.individual_total, b.discount_pct]);
    }

    return { success: true, data: { pairs_analyzed: pairs.length, bundles_proposed: bundles.length, bundles } };
  }

  private async recordSnapshot(task: AgentTask): Promise<AgentResult> {
    return this.analyze(task);
  }
}
