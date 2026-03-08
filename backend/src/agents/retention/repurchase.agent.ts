/**
 * AGENT_REPURCHASE v7.0 — Hack #88
 * Prédit quand un client va manquer de produit et déclenche
 * la campagne au bon moment — pas trop tôt, pas trop tard.
 *
 * Logique : si une serviette exfoliante dure en moyenne 82 jours
 * chez tes clients répétés → campagne au jour 72 (J-10).
 * Chaque SKU a son propre cycle calculé depuis les vraies commandes.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { ThresholdHelper } from '../core/threshold.helper';
import { tierGate, postSuggestion } from '../core/tier-gate.middleware';

export class AgentRepurchase extends BaseAgent {
  readonly name = 'AGENT_REPURCHASE';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'compute_lifecycles':    return this.computeLifecycles(task);
      case 'identify_opportunities':return this.identifyOpportunities(task);
      case 'trigger_campaigns':     return this.triggerCampaigns(task);
      case 'get_dashboard':         return this.getDashboard(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Calcule le cycle de vie moyen par SKU depuis les commandes répétées. */
  private async computeLifecycles(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Intervalles entre 2 achats du même produit par le même client
    const { rows } = await this.db.query(`
      WITH repeat_purchases AS (
        SELECT
          oi.shopify_variant_id,
          oi.shopify_product_id,
          p.title AS product_name,
          o.customer_id,
          o.created_at,
          LAG(o.created_at) OVER (
            PARTITION BY o.customer_id, oi.shopify_product_id
            ORDER BY o.created_at
          ) AS prev_purchase
        FROM shopify_order_items oi
        JOIN shopify_orders o ON o.shopify_order_id = oi.shopify_order_id AND o.shop_id=$1
        JOIN store.products p ON p.shopify_product_id = oi.shopify_product_id AND p.shop_id=$1
        WHERE oi.shop_id=$1
      ),
      intervals AS (
        SELECT
          shopify_product_id,
          product_name,
          customer_id,
          DATE_PART('day', created_at - prev_purchase)::INTEGER AS interval_days
        FROM repeat_purchases
        WHERE prev_purchase IS NOT NULL
          AND DATE_PART('day', created_at - prev_purchase) BETWEEN 7 AND 365
      )
      SELECT
        shopify_product_id,
        MAX(product_name) AS product_name,
        PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY interval_days)::INTEGER AS p25,
        PERCENTILE_CONT(0.50) WITHIN GROUP (ORDER BY interval_days)::INTEGER AS p50,
        PERCENTILE_CONT(0.75) WITHIN GROUP (ORDER BY interval_days)::INTEGER AS p75,
        COUNT(DISTINCT customer_id) AS sample_repeat_buyers
      FROM intervals
      GROUP BY shopify_product_id
      HAVING COUNT(DISTINCT customer_id) >= 5`, [shop_id]);

    let computed = 0;
    for (const r of rows) {
      const confidence = Math.min(0.95, parseInt(r.sample_repeat_buyers) / 50);
      await this.db.query(`
        INSERT INTO product_lifecycle
          (shop_id, shopify_product_id, product_name, avg_repurchase_days,
           p25_repurchase_days, p75_repurchase_days, sample_repeat_buyers, confidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (shop_id, shopify_product_id) DO UPDATE SET
          avg_repurchase_days=$4, p25_repurchase_days=$5, p75_repurchase_days=$6,
          sample_repeat_buyers=$7, confidence=$8, last_computed_at=NOW()`,
        [shop_id, r.shopify_product_id, r.product_name,
         r.p50, r.p25, r.p75, r.sample_repeat_buyers, confidence]);
      computed++;
    }

    return { success: true, data: { products_computed: computed } };
  }

  /** Identifie les clients proches de l'épuisement de leur produit. */
  private async identifyOpportunities(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Dernier achat de chaque client × cycle de vie du produit
    const { rows } = await this.db.query(`
      WITH last_purchases AS (
        SELECT DISTINCT ON (o.customer_id, oi.shopify_product_id)
          o.customer_id,
          oi.shopify_product_id,
          o.created_at::DATE AS last_purchase_date
        FROM shopify_order_items oi
        JOIN shopify_orders o ON o.shopify_order_id = oi.shopify_order_id AND o.shop_id=$1
        WHERE oi.shop_id=$1
        ORDER BY o.customer_id, oi.shopify_product_id, o.created_at DESC
      )
      SELECT
        lp.customer_id,
        lp.shopify_product_id,
        lp.last_purchase_date,
        (lp.last_purchase_date + pl.avg_repurchase_days * INTERVAL '1 day')::DATE AS predicted_repurchase,
        (lp.last_purchase_date + pl.campaign_trigger_days * INTERVAL '1 day')::DATE AS trigger_date,
        pl.confidence
      FROM last_purchases lp
      JOIN product_lifecycle pl
        ON pl.shop_id=$1 AND pl.shopify_product_id=lp.shopify_product_id
      WHERE pl.confidence >= 0.5
        AND (lp.last_purchase_date + pl.campaign_trigger_days * INTERVAL '1 day')::DATE
            BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '30 days'`, [shop_id]);

    let created = 0;
    for (const r of rows) {
      await this.db.query(`
        INSERT INTO repurchase_opportunities
          (shop_id, customer_id, shopify_product_id, last_purchase_date,
           predicted_repurchase_date, campaign_trigger_date)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (shop_id, customer_id, shopify_product_id, last_purchase_date)
        DO NOTHING`,
        [shop_id, r.customer_id, r.shopify_product_id,
         r.last_purchase_date, r.predicted_repurchase, r.trigger_date]);
      created++;
    }

    return { success: true, data: { opportunities_created: created } };
  }

  /** Déclenche les campagnes pour les opportunités arrivées à maturité. */
  private async triggerCampaigns(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const gate = await tierGate(this.db, shop_id, this.name, 5);

    const { rows: due } = await this.db.query(`
      SELECT ro.*, c.email, pl.product_name,
             cr.segment AS rfm_segment
      FROM repurchase_opportunities ro
      JOIN customers c ON c.id=ro.customer_id
      JOIN product_lifecycle pl ON pl.shop_id=$1 AND pl.shopify_product_id=ro.shopify_product_id
      LEFT JOIN customer_rfm cr ON cr.customer_id=ro.customer_id
      WHERE ro.shop_id=$1
        AND ro.campaign_trigger_date <= CURRENT_DATE
        AND ro.campaign_triggered = false
      LIMIT 100`, [shop_id]);

    let triggered = 0;
    for (const opp of due) {
      if (gate.verdict === 'shadow') {
        await this.logShadow(shop_id, 'repurchase_email', opp);
      } else if (gate.verdict === 'suggest') {
        await postSuggestion(this.db, shop_id, this.name, 'repurchase_campaign',
          opp, `Déclencher campagne rachat "${opp.product_name}" pour ${opp.email}`, gate.current_tier);
      } else {
        // Execute
        await this.emit('klaviyo:trigger_repurchase', {
          shop_id, customer_email: opp.email,
          product_name: opp.product_name,
          rfm_segment:  opp.rfm_segment,
          predicted_run_out: opp.predicted_repurchase_date,
        });

        await this.db.query(`
          UPDATE repurchase_opportunities SET
            campaign_triggered=true, triggered_at=NOW()
          WHERE id=$1`, [opp.id]);
        triggered++;
      }
    }

    if (triggered > 0) {
      await this.remember(shop_id, {
        memory_key: `repurchase_triggered_${new Date().toISOString().slice(0,10)}`,
        memory_type: 'observation',
        value: {
          triggered, message: `${triggered} campagnes de rachat déclenchées aujourd'hui`,
          severity: 'info',
        },
        ttl_hours: 48,
      });
    }

    return { success: true, data: { triggered, tier: gate.current_tier, mode: gate.agent_mode } };
  }

  private async logShadow(shopId: string, type: string, data: any): Promise<void> {
    await this.db.query(`
      INSERT INTO agent_decisions (shop_id, agent_name, decision_type, decision_made, executed, confidence)
      VALUES ($1,$2,$3,$4,false,0.80)`,
      [shopId, this.name, type, JSON.stringify({ shadow: true, ...data })]);
  }

  private async getDashboard(task: AgentTask): Promise<AgentResult> {
    const { rows: lifecycles } = await this.db.query(
      `SELECT * FROM product_lifecycle WHERE shop_id=$1 ORDER BY avg_repurchase_days ASC`, [task.shop_id]);
    const { rows: upcoming } = await this.db.query(`
      SELECT ro.*, pl.product_name FROM repurchase_opportunities ro
      JOIN product_lifecycle pl ON pl.shopify_product_id=ro.shopify_product_id AND pl.shop_id=$1
      WHERE ro.shop_id=$1 AND ro.campaign_triggered=false
      ORDER BY ro.days_until_trigger ASC LIMIT 20`, [task.shop_id]);
    return { success: true, data: { lifecycles, upcoming_campaigns: upcoming } };
  }
}
