/**
 * AGENT_KLAVIYO v3.7 — Retention & Email Automation
 * Syncs RFM segments to Klaviyo lists.
 * Triggers personalized flows based on converting creative angle.
 * Pushes high-reorder SKUs into replenishment flows.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentKlaviyo extends BaseAgent {
  readonly name = 'AGENT_KLAVIYO';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'sync_segments':       return this.syncSegments(task);
      case 'trigger_post_purchase': return this.triggerPostPurchase(task);
      case 'trigger_winback':     return this.triggerWinback(task);
      case 'push_replenishment':  return this.pushReplenishment(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async getApiKey(shopId: string): Promise<{key: string; config: any} | null> {
    const { rows } = await this.db.query(
      `SELECT * FROM klaviyo_config WHERE shop_id = $1 AND enabled = true`, [shopId]);
    if (!rows[0]) return null;
    return { key: rows[0].api_key, config: rows[0] };
  }

  private async klaviyoRequest(apiKey: string, endpoint: string, method = 'GET', body?: unknown) {
    const res = await fetch(`https://a.klaviyo.com/api/${endpoint}`, {
      method,
      headers: {
        'Authorization': `Klaviyo-API-Key ${apiKey}`,
        'Content-Type': 'application/json',
        'revision': '2024-02-15',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  private async syncSegments(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const kv = await this.getApiKey(shop_id);
    if (!kv) return { success: false, message: 'Klaviyo not configured' };

    const segmentListMap: Record<string, string | null> = {
      champions:  kv.config.list_id_champions,
      at_risk:    kv.config.list_id_at_risk,
      lost:       kv.config.list_id_lost,
      new_customers: kv.config.list_id_new,
    };

    let totalSynced = 0;
    const errors: string[] = [];

    for (const [segment, listId] of Object.entries(segmentListMap)) {
      if (!listId) continue;

      const { rows } = await this.db.query(`
        SELECT c.email, c.shopify_cid, r.rfm_score, r.monetary, r.segment
        FROM customer_rfm r JOIN customers c ON c.id = r.customer_id
        WHERE r.shop_id = $1 AND r.segment = $2 AND c.email IS NOT NULL
        LIMIT 500`, [shop_id, segment]);

      if (!rows.length) continue;

      // Batch subscribe to Klaviyo list
      const profiles = rows.map(r => ({
        type: 'profile',
        attributes: {
          email: r.email,
          properties: {
            aegis_segment: r.segment,
            rfm_score: r.rfm_score,
            ltv_monetary: parseFloat(r.monetary),
            shopify_customer_id: r.shopify_cid,
          },
        },
      }));

      try {
        await this.klaviyoRequest(kv.key, `lists/${listId}/relationships/profiles/`, 'POST', {
          data: profiles,
        });
        totalSynced += rows.length;
      } catch (err) {
        errors.push(`${segment}: ${err}`);
      }
    }

    await this.db.query(`
      INSERT INTO klaviyo_sync_log (shop_id, sync_type, records_synced, errors)
      VALUES ($1,'rfm_segments',$2,$3)`,
      [shop_id, totalSynced, errors.length]);

    return { success: true, data: { synced: totalSynced, errors } };
  }

  /**
   * Trigger personalized post-purchase flow based on converting creative angle.
   * "Transformation angle buyer" gets transformation sequence, not generic.
   */
  private async triggerPostPurchase(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { order_id, customer_email, order_value } = payload as any;
    const kv = await this.getApiKey(shop_id);
    if (!kv?.config.flow_id_post_purchase) return { success: false, message: 'No post-purchase flow configured' };

    // Find which creative angle converted this customer
    const { rows: attr } = await this.db.query(`
      SELECT ae.attributed_ad_id, ct.content_angle, ct.hook_type
      FROM attribution_events ae
      LEFT JOIN creative_tags ct ON ct.creative_id = ae.attributed_ad_id AND ct.shop_id = ae.shop_id
      WHERE ae.shop_id = $1 AND ae.shopify_order_id = $2
      LIMIT 1`, [shop_id, order_id]);

    const angle = attr[0]?.content_angle ?? 'general';
    const hook  = attr[0]?.hook_type ?? 'none';

    // Track event in Klaviyo with creative context
    await this.klaviyoRequest(kv.key, 'events/', 'POST', {
      data: {
        type: 'event',
        attributes: {
          metric: { data: { type: 'metric', attributes: { name: 'Placed Order' } } },
          profile: { data: { type: 'profile', attributes: { email: customer_email } } },
          properties: {
            order_id, order_value,
            converting_angle: angle,
            converting_hook: hook,
            aegis_tracked: true,
          },
          time: new Date().toISOString(),
        },
      },
    });

    return { success: true, data: { order_id, angle, hook } };
  }

  private async triggerWinback(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const kv = await this.getApiKey(shop_id);
    if (!kv?.config.flow_id_winback) return { success: false, message: 'No winback flow' };

    // Get at_risk customers not contacted in 14 days
    const { rows } = await this.db.query(`
      SELECT c.email, r.recency_days, r.monetary
      FROM customer_rfm r JOIN customers c ON c.id = r.customer_id
      WHERE r.shop_id = $1 AND r.segment IN ('at_risk','cant_lose')
        AND c.email IS NOT NULL
      LIMIT 200`, [shop_id]);

    for (const customer of rows) {
      await this.klaviyoRequest(kv.key, 'events/', 'POST', {
        data: {
          type: 'event',
          attributes: {
            metric: { data: { type: 'metric', attributes: { name: 'AEGIS Winback Trigger' } } },
            profile: { data: { type: 'profile', attributes: { email: customer.email } } },
            properties: { recency_days: customer.recency_days, ltv: parseFloat(customer.monetary) },
          },
        },
      });
    }

    return { success: true, data: { triggered: rows.length } };
  }

  private async pushReplenishment(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const kv = await this.getApiKey(shop_id);
    if (!kv) return { success: false, message: 'Klaviyo not configured' };

    // Find SKUs with high reorder rate
    const { rows: skus } = await this.db.query(`
      SELECT product_id, product_name, AVG(total_orders) AS avg_orders
      FROM customers c JOIN shopify_orders so ON so.shop_id = c.shop_id
      WHERE c.shop_id = $1
      GROUP BY product_id, product_name
      HAVING AVG(total_orders) > 1.5
      LIMIT 5`, [shop_id]);

    // Find customers who bought these SKUs 25-35 days ago (typical replenishment window)
    for (const sku of skus) {
      const { rows: buyers } = await this.db.query(`
        SELECT DISTINCT c.email
        FROM shopify_orders so JOIN customers c ON c.shopify_cid = so.customer_id
        WHERE so.shop_id = $1 AND so.product_id = $2
          AND so.created_at BETWEEN NOW() - INTERVAL '35 days' AND NOW() - INTERVAL '25 days'
          AND c.email IS NOT NULL
        LIMIT 200`, [shop_id, sku.product_id]);

      for (const buyer of buyers) {
        await this.klaviyoRequest(kv.key, 'events/', 'POST', {
          data: {
            type: 'event',
            attributes: {
              metric: { data: { type: 'metric', attributes: { name: 'AEGIS Replenishment Ready' } } },
              profile: { data: { type: 'profile', attributes: { email: buyer.email } } },
              properties: { product_id: sku.product_id, product_name: sku.product_name },
            },
          },
        });
      }
    }

    return { success: true, data: { skus_targeted: skus.length } };
  }
}
