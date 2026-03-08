/**
 * AGENT_RFM v3.7 — Customer RFM Segmentation
 * Computes Recency/Frequency/Monetary scores from Shopify orders.
 * Segments: champions · loyal · potential_loyal · new_customers
 *           at_risk · cant_lose · hibernating · lost
 * AGENT_SCALE uses Champions lookalike. Klaviyo sync triggered after compute.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

const SEGMENT_RULES = (r: number, f: number, m: number): string => {
  if (r >= 4 && f >= 4 && m >= 4) return 'champions';
  if (r >= 3 && f >= 3)           return 'loyal';
  if (r >= 3 && f <= 2)           return 'potential_loyal';
  if (r >= 4 && f === 1)          return 'new_customers';
  if (r === 2 && f >= 3)          return 'at_risk';
  if (r <= 2 && f >= 4 && m >= 4) return 'cant_lose';
  if (r <= 2 && f <= 2)           return 'hibernating';
  return 'lost';
};

export class AgentRFM extends BaseAgent {
  readonly name = 'AGENT_RFM';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'compute_all':      return this.computeAll(task);
      case 'get_champions':    return this.getChampions(task);
      case 'get_segment':      return this.getSegment(task);
      case 'predict_ltv':      return this.predictLTV(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async computeAll(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Upsert all customers from Shopify orders
    await this.db.query(`
      INSERT INTO customers (shop_id, shopify_cid, email, first_order_at, last_order_at, total_orders, total_revenue, avg_order_value)
      SELECT shop_id, customer_id, customer_email,
             MIN(created_at), MAX(created_at), COUNT(*),
             SUM(total_price), AVG(total_price)
      FROM shopify_orders WHERE shop_id = $1 AND customer_id IS NOT NULL
      GROUP BY shop_id, customer_id, customer_email
      ON CONFLICT (shop_id, shopify_cid) DO UPDATE SET
        last_order_at  = EXCLUDED.last_order_at,
        total_orders   = EXCLUDED.total_orders,
        total_revenue  = EXCLUDED.total_revenue,
        avg_order_value = EXCLUDED.avg_order_value`, [shop_id]);

    // Compute RFM quintiles
    const { rows: customers } = await this.db.query(`
      SELECT c.id, c.shopify_cid,
             EXTRACT(DAY FROM NOW() - c.last_order_at)::int AS recency_days,
             c.total_orders AS frequency,
             c.total_revenue AS monetary
      FROM customers c WHERE c.shop_id = $1`, [shop_id]);

    if (!customers.length) return { success: true, data: { computed: 0 } };

    // Compute quintile breakpoints
    const recencies   = customers.map(c => c.recency_days).sort((a,b) => a-b);
    const frequencies = customers.map(c => c.frequency).sort((a,b) => a-b);
    const monetaries  = customers.map(c => parseFloat(c.monetary)).sort((a,b) => a-b);

    const quintile = (arr: number[], val: number): number => {
      const pct = arr.filter(v => v <= val).length / arr.length;
      // Recency: lower = better (recent = high score)
      return Math.ceil(pct * 5);
    };
    const quintileInverse = (arr: number[], val: number): number => 6 - quintile(arr, val);

    let computed = 0;
    const segments: Record<string, number> = {};

    for (const c of customers) {
      const r = quintileInverse(recencies, c.recency_days);   // recent = high
      const f = quintile(frequencies, c.frequency);
      const m = quintile(monetaries, parseFloat(c.monetary));
      const segment = SEGMENT_RULES(r, f, m);

      await this.db.query(`
        INSERT INTO customer_rfm (shop_id, customer_id, recency_days, frequency, monetary, r_score, f_score, m_score, segment)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT (shop_id, customer_id) DO UPDATE SET
          recency_days=$3, frequency=$4, monetary=$5, r_score=$6, f_score=$7, m_score=$8,
          segment=$9, computed_at=NOW()`,
        [shop_id, c.id, c.recency_days, c.frequency, c.monetary, r, f, m, segment]);

      segments[segment] = (segments[segment] ?? 0) + 1;
      computed++;
    }

    await this.remember(shop_id, {
      memory_key: 'rfm_snapshot', memory_type: 'signal',
      value: { computed, segments, champions: segments.champions ?? 0, at_risk: segments.at_risk ?? 0 },
      ttl_hours: 24,
    });

    // Trigger Klaviyo sync
    await this.emit('dispatch', { agent: 'AGENT_KLAVIYO', task: 'sync_segments', shop_id });

    return { success: true, data: { computed, segments } };
  }

  private async getChampions(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT c.shopify_cid, c.email, r.monetary, r.frequency, r.rfm_score, r.ltv_predicted
      FROM customer_rfm r JOIN customers c ON c.id = r.customer_id
      WHERE r.shop_id = $1 AND r.segment = 'champions'
      ORDER BY r.rfm_score DESC LIMIT 500`, [task.shop_id]);
    return { success: true, data: { champions: rows, count: rows.length } };
  }

  private async getSegment(task: AgentTask): Promise<AgentResult> {
    const { segment } = task.payload as any;
    const { rows } = await this.db.query(`
      SELECT c.shopify_cid, c.email, r.segment, r.rfm_score, r.monetary, r.recency_days
      FROM customer_rfm r JOIN customers c ON c.id = r.customer_id
      WHERE r.shop_id = $1 AND r.segment = $2
      ORDER BY r.rfm_score DESC LIMIT 1000`, [task.shop_id, segment]);
    return { success: true, data: { customers: rows, count: rows.length } };
  }

  private async predictLTV(task: AgentTask): Promise<AgentResult> {
    // Simple LTV prediction: avg_order_value * predicted_orders_next_12m
    // Based on frequency and recency cohort analysis
    await this.db.query(`
      UPDATE customer_rfm SET ltv_predicted = (
        SELECT c.avg_order_value * GREATEST(1, r2.frequency * (365.0 / NULLIF(
          EXTRACT(DAY FROM (c.last_order_at - c.first_order_at)), 0
        )))
        FROM customers c WHERE c.id = customer_rfm.customer_id
      ) WHERE shop_id = $1`, [task.shop_id]);
    return { success: true, message: 'LTV predictions updated' };
  }
}
