/**
 * AGENT_REPLENISHMENT v4.2
 * Predicts stockouts before they happen.
 * AEGIS spends on Meta to sell a product that's already out of stock.
 * This agent prevents that.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentReplenishment extends BaseAgent {
  readonly name = 'AGENT_REPLENISHMENT';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'sync_inventory':  return this.syncInventory(task);
      case 'analyze':         return this.analyze(task);
      case 'get_alerts':      return this.getAlerts(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Daily sync from Shopify inventory levels. */
  private async syncInventory(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows: creds } = await this.db.query(
      `SELECT store_domain, access_token FROM shopify_credentials WHERE shop_id=$1`, [shop_id]);
    if (!creds[0]) return { success: false, message: 'Shopify not connected' };

    const { store_domain, access_token } = creds[0];

    // Fetch product inventory from Shopify
    const res  = await fetch(
      `https://${store_domain}/admin/api/2024-01/variants.json?limit=250&fields=id,product_id,title,sku,inventory_quantity`,
      { headers: { 'X-Shopify-Access-Token': access_token } }
    );
    const data = await res.json() as any;
    const variants = data.variants ?? [];

    // Compute avg daily sales per variant (last 30 days)
    for (const v of variants) {
      const { rows: sales } = await this.db.query(`
        SELECT COALESCE(SUM(quantity), 0) / 30.0 AS avg_daily
        FROM shopify_order_items
        WHERE shop_id=$1 AND shopify_variant_id=$2
          AND created_at > NOW() - INTERVAL '30 days'`,
        [shop_id, v.id.toString()]);

      const avgDaily   = parseFloat(sales[0]?.avg_daily ?? 0);
      const reorderPoint = Math.ceil(avgDaily * 21 * 1.3); // lead_days × 1.3 safety

      await this.db.query(`
        INSERT INTO product_inventory
          (shop_id, shopify_product_id, shopify_variant_id, product_name, sku,
           current_stock, reorder_point, avg_daily_sales)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (shop_id, shopify_variant_id) DO UPDATE SET
          current_stock=$6, reorder_point=$7, avg_daily_sales=$8, last_synced_at=NOW()`,
        [shop_id, v.product_id.toString(), v.id.toString(),
         v.title, v.sku ?? null, v.inventory_quantity ?? 0, reorderPoint, avgDaily]);
    }

    await this.analyze({ ...task, type: 'analyze' });
    return { success: true, data: { synced: variants.length } };
  }

  /** Analyze stock levels and generate alerts. */
  private async analyze(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const { rows: products } = await this.db.query(`
      SELECT * FROM product_inventory
      WHERE shop_id=$1 AND avg_daily_sales > 0
      ORDER BY days_of_stock ASC`, [shop_id]);

    const alerts: any[] = [];

    // Upcoming seasonal events — need extra stock
    const { rows: upcomingEvents } = await this.db.query(`
      SELECT se.event_name, ser.peak_date, ser.phases
      FROM seasonal_events se
      JOIN seasonal_event_regions ser ON ser.event_id = se.id
      WHERE se.shop_id=$1
        AND ser.peak_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '45 days'
        AND ser.is_active = true
      ORDER BY ser.peak_date ASC LIMIT 3`, [shop_id]);

    for (const p of products) {
      const daysStock    = parseFloat(p.days_of_stock);
      const leadDays     = p.supplier_lead_days ?? 21;
      const avgDaily     = parseFloat(p.avg_daily_sales);

      // Check basic reorder triggers
      if (daysStock < leadDays) {
        // Will run out BEFORE next delivery arrives
        const lostRev = Math.max(0, leadDays - daysStock) * avgDaily *
          parseFloat(await this.getProductPrice(shop_id, p.shopify_product_id));

        alerts.push({
          shop_id, product_id: p.id,
          alert_type: 'reorder_now',
          days_until_stockout: daysStock,
          recommended_order_qty: Math.ceil(avgDaily * 60), // 60-day restock
          estimated_lost_revenue: lostRev,
        });
      } else if (daysStock < leadDays * 2) {
        alerts.push({
          shop_id, product_id: p.id,
          alert_type: 'reorder_soon',
          days_until_stockout: daysStock,
          recommended_order_qty: Math.ceil(avgDaily * 45),
          estimated_lost_revenue: 0,
        });
      }

      // Seasonal check: need extra stock for upcoming event
      for (const ev of upcomingEvents) {
        const phases      = ev.phases as any;
        const peakPhase   = phases.peak ?? {};
        const peakMult    = peakPhase.budget_multiplier ?? 2.0;
        const peakDays    = 3;
        const extraNeeded = Math.ceil(avgDaily * peakMult * peakDays);
        const daysUntilPeak = Math.round(
          (new Date(ev.peak_date).getTime() - Date.now()) / 86400000);

        if (p.available_stock < extraNeeded + leadDays * avgDaily) {
          alerts.push({
            shop_id, product_id: p.id,
            alert_type: 'seasonal_prep',
            days_until_stockout: daysStock,
            recommended_order_qty: extraNeeded,
            estimated_lost_revenue: extraNeeded * await this.getProductPrice(shop_id, p.shopify_product_id),
            seasonal_event: `${ev.event_name} dans ${daysUntilPeak}j`,
          });
        }
      }

      // Overstock check
      if (daysStock > 120 && avgDaily > 0) {
        alerts.push({
          shop_id, product_id: p.id,
          alert_type: 'overstock',
          days_until_stockout: daysStock,
          recommended_order_qty: 0,
          estimated_lost_revenue: 0,
        });
      }
    }

    // Persist alerts (skip duplicates created today)
    let created = 0;
    for (const a of alerts) {
      const { rows: existing } = await this.db.query(`
        SELECT 1 FROM replenishment_alerts
        WHERE shop_id=$1 AND product_id=$2 AND alert_type=$3
          AND created_at > CURRENT_DATE AND acknowledged=false`,
        [a.shop_id, a.product_id, a.alert_type]);
      if (existing.length) continue;

      await this.db.query(`
        INSERT INTO replenishment_alerts
          (shop_id, product_id, alert_type, days_until_stockout,
           recommended_order_qty, estimated_lost_revenue, seasonal_event)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [a.shop_id, a.product_id, a.alert_type, a.days_until_stockout,
         a.recommended_order_qty, a.estimated_lost_revenue, a.seasonal_event ?? null]);
      created++;
    }

    // Critical: pause ads for stockouts
    const critical = alerts.filter(a => a.alert_type === 'reorder_now');
    for (const c of critical) {
      await this.remember(shop_id, {
        memory_key: `stock_critical_${c.product_id}`,
        memory_type: 'warning',
        value: {
          product_id: c.product_id,
          days_until_stockout: c.days_until_stockout,
          lost_revenue_est: c.estimated_lost_revenue,
          message: `Rupture de stock dans ${c.days_until_stockout?.toFixed(0)} jours — commander ${c.recommended_order_qty} unités`,
          severity: 'critical',
        },
        ttl_hours: 48,
      });
      await this.emit('stock_critical', { shop_id, ...c });
    }

    return { success: true, data: { products: products.length, alerts_created: created, critical: critical.length } };
  }

  private async getAlerts(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT ra.*, pi.product_name, pi.sku, pi.days_of_stock, pi.current_stock
      FROM replenishment_alerts ra
      JOIN product_inventory pi ON pi.id = ra.product_id
      WHERE ra.shop_id=$1 AND ra.acknowledged=false
      ORDER BY CASE ra.alert_type WHEN 'reorder_now' THEN 1 WHEN 'seasonal_prep' THEN 2
               WHEN 'reorder_soon' THEN 3 ELSE 4 END, ra.created_at DESC`, [task.shop_id]);
    return { success: true, data: { alerts: rows } };
  }

  private async getProductPrice(shopId: string, productId: string): Promise<number> {
    const { rows } = await this.db.query(
      `SELECT AVG(price) AS p FROM shopify_order_items WHERE shop_id=$1 AND shopify_product_id=$2 LIMIT 1`,
      [shopId, productId]);
    return parseFloat(rows[0]?.p ?? 30);
  }
}
