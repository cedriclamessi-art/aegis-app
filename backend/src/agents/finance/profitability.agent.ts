/**
 * AGENT_PROFITABILITY v3.6
 * Replaces ROAS as primary optimization signal with contribution margin.
 * Listens to Shopify refund webhooks and adjusts real profitability.
 *
 * Key insight: ROAS 2.4× on €29 product with €12 COGS + €22 CPA = -€5/order
 * This agent surfaces that reality so scaling decisions use real numbers.
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

interface ProductEcon {
  product_id:    string;
  selling_price: number;
  cogs:          number;
  shipping_cost: number;
  platform_fee_pct: number;
  return_rate:   number;
  gross_margin:  number;
}

interface ProfitabilityReport {
  entity_id:          string;
  entity_type:        string;
  gross_revenue:      number;
  net_revenue:        number;          // after refunds
  ad_spend:           number;
  cogs_total:         number;
  contribution_margin: number;         // net_revenue - cogs - shipping - platform_fees - ad_spend
  contribution_margin_pct: number;
  true_roas:          number;          // net_revenue / ad_spend
  orders:             number;
  refunded_orders:    number;
  break_even_cpa:     number;          // gross_margin per order (max CPA to not lose money)
  current_cpa:        number;
  profitable:         boolean;
  profit_per_order:   number;
}

export class AgentProfitability extends BaseAgent {
  readonly name = 'AGENT_PROFITABILITY';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'compute_all':       return this.computeAll(task);
      case 'compute_entity':    return this.computeEntity(task);
      case 'handle_refund':     return this.handleRefund(task);
      case 'get_break_even':    return this.getBreakEven(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  /**
   * Compute contribution margin for all active ad sets.
   * Called every hour by Orchestrator.
   */
  private async computeAll(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const world = await this.getWorldState(shop_id);

    // Get all active campaigns with spend
    const { rows: entities } = await this.db.query(
      `SELECT DISTINCT entity_type, entity_id
       FROM ad_metrics_latest
       WHERE shop_id = $1 AND status = 'active' AND spend > 0`,
      [shop_id]
    );

    const reports: ProfitabilityReport[] = [];
    for (const e of entities) {
      const report = await this.computeEntityProfitability(shop_id, e.entity_type, e.entity_id);
      if (report) {
        reports.push(report);
        await this.persistProfitability(shop_id, report);
      }
    }

    // Find unprofitable entities
    const unprofitable = reports.filter(r => !r.profitable);
    const criticalLosses = unprofitable.filter(r => r.contribution_margin < -100);

    // Deposit memory signal
    await this.remember(shop_id, {
      memory_key:  'profitability_snapshot',
      memory_type: unprofitable.length > 0 ? 'warning' : 'signal',
      value: {
        computed: reports.length,
        profitable: reports.filter(r => r.profitable).length,
        unprofitable: unprofitable.length,
        critical_losses: criticalLosses.length,
        avg_contribution_margin_pct: reports.reduce((s, r) => s + r.contribution_margin_pct, 0) / (reports.length || 1),
        worst: criticalLosses[0] ? {
          entity_id: criticalLosses[0].entity_id,
          loss: criticalLosses[0].contribution_margin,
          message: `Losing €${Math.abs(criticalLosses[0].contribution_margin).toFixed(0)} on ${criticalLosses[0].entity_id}`,
          severity: 'critical',
        } : null,
      },
      ttl_hours: 2,
    });

    // Emit critical loss alerts
    for (const loss of criticalLosses) {
      await this.emit('profitability_alert', {
        shop_id, entity_id: loss.entity_id,
        loss: loss.contribution_margin,
        profit_per_order: loss.profit_per_order,
        break_even_cpa: loss.break_even_cpa,
        current_cpa: loss.current_cpa,
      });
    }

    return { success: true, data: { reports: reports.length, unprofitable: unprofitable.length } };
  }

  private async computeEntity(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { entity_type, entity_id } = payload as any;
    const report = await this.computeEntityProfitability(shop_id, entity_type, entity_id);
    return { success: !!report, data: report };
  }

  private async computeEntityProfitability(
    shopId:     string,
    entityType: string,
    entityId:   string
  ): Promise<ProfitabilityReport | null> {
    // Fetch ad metrics
    const { rows: adm } = await this.db.query(
      `SELECT spend, revenue, conversions, cpa
       FROM ad_metrics_latest
       WHERE shop_id = $1 AND entity_type = $2 AND entity_id = $3`,
      [shopId, entityType, entityId]
    );
    if (!adm[0]) return null;

    const adSpend    = parseFloat(adm[0].spend ?? 0);
    const grossRev   = parseFloat(adm[0].revenue ?? 0);
    const orders     = parseInt(adm[0].conversions ?? 0);

    // Fetch refund data for this period
    const { rows: refunds } = await this.db.query(
      `SELECT COALESCE(SUM(sre.refund_amount), 0) AS refunded,
              COUNT(sre.id) AS refund_count
       FROM shopify_refund_events sre
       JOIN attribution_events ae ON ae.shopify_order_id = sre.shopify_order_id
       WHERE ae.shop_id = $1 AND ae.attributed_ad_id = $2
         AND sre.refunded_at > NOW() - INTERVAL '30 days'`,
      [shopId, entityId]
    );
    const refundedAmount = parseFloat(refunds[0]?.refunded ?? 0);
    const refundedOrders = parseInt(refunds[0]?.refund_count ?? 0);
    const netRevenue     = grossRev - refundedAmount;

    // Fetch product economics for this shop (weighted avg across SKUs)
    const { rows: econRows } = await this.db.query<ProductEcon>(
      `SELECT AVG(cogs) AS avg_cogs, AVG(shipping_cost) AS avg_shipping,
              AVG(platform_fee_pct) AS avg_platform_fee, AVG(gross_margin) AS avg_margin
       FROM product_economics WHERE shop_id = $1`,
      [shopId]
    );
    const econ = econRows[0];
    if (!econ) return null;

    const avgCogs      = parseFloat(econ.avg_cogs ?? 0);
    const avgShipping  = parseFloat(econ.avg_shipping ?? 0);
    const platformFees = netRevenue * parseFloat(econ.avg_platform_fee ?? 0.029);
    const cogsTotal    = orders * avgCogs;
    const shippingTotal = orders * avgShipping;

    const contributionMargin = netRevenue - cogsTotal - shippingTotal - platformFees - adSpend;
    const cmPct = netRevenue > 0 ? contributionMargin / netRevenue : 0;
    const trueROAS = adSpend > 0 ? netRevenue / adSpend : 0;
    const breakEvenCPA = parseFloat(econ.avg_margin ?? 0); // max CPA = gross margin per order
    const currentCPA = orders > 0 ? adSpend / orders : 0;
    const profitPerOrder = orders > 0 ? contributionMargin / orders : 0;

    return {
      entity_id: entityId, entity_type: entityType,
      gross_revenue: grossRev, net_revenue: netRevenue,
      ad_spend: adSpend, cogs_total: cogsTotal,
      contribution_margin: contributionMargin,
      contribution_margin_pct: cmPct,
      true_roas: trueROAS,
      orders, refunded_orders: refundedOrders,
      break_even_cpa: breakEvenCPA,
      current_cpa: currentCPA,
      profitable: contributionMargin > 0,
      profit_per_order: profitPerOrder,
    };
  }

  /**
   * Handle Shopify refund webhook — immediately update profitability.
   */
  private async handleRefund(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { order_id, refund_id, refund_amount, reason, line_items } = payload as any;

    // Store refund event
    await this.db.query(
      `INSERT INTO shopify_refund_events
         (shop_id, shopify_order_id, shopify_refund_id, refund_amount, refund_reason, line_items, refunded_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())
       ON CONFLICT (shopify_refund_id) DO NOTHING`,
      [shop_id, order_id, refund_id, refund_amount, reason, JSON.stringify(line_items ?? [])]
    );

    // Deposit in memory so agents know real revenue is lower
    await this.remember(shop_id, {
      memory_key:  `refund_signal_${new Date().toISOString().slice(0,10)}`,
      memory_type: 'observation',
      value: { order_id, refund_amount, reason },
      ttl_hours: 48,
    });

    // Trigger profitability recompute
    await this.emit('dispatch', { agent: 'AGENT_PROFITABILITY', task: 'compute_all', shop_id });

    return { success: true, data: { refund_id, order_id, refund_amount } };
  }

  private async getBreakEven(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows } = await this.db.query(
      `SELECT AVG(gross_margin) AS avg_margin, MIN(gross_margin) AS min_margin
       FROM product_economics WHERE shop_id = $1`,
      [shop_id]
    );
    return {
      success: true,
      data: {
        break_even_cpa:    parseFloat(rows[0]?.avg_margin ?? 0),
        break_even_cpa_min: parseFloat(rows[0]?.min_margin ?? 0),
        message: `Your CPA must stay below €${parseFloat(rows[0]?.avg_margin ?? 0).toFixed(2)} to be profitable per order`,
      }
    };
  }

  private async persistProfitability(shopId: string, r: ProfitabilityReport): Promise<void> {
    await this.db.query(
      `INSERT INTO profitability_metrics
         (shop_id, period_start, period_end, granularity, entity_type, entity_id,
          gross_revenue, refunded_amount, ad_spend, cogs_total, shipping_total, platform_fees, orders, refunded_orders)
       VALUES ($1, NOW() - INTERVAL '24 hours', NOW(), 'daily', $2, $3, $4, $5, $6, $7, 0, 0, $8, $9)
       ON CONFLICT DO NOTHING`,
      [shopId, r.entity_type, r.entity_id, r.gross_revenue,
       r.gross_revenue - r.net_revenue, r.ad_spend, r.cogs_total, r.orders, r.refunded_orders]
    );
  }
}
