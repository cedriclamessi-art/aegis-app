/**
 * AGENT_SYNC_GUARDIAN v3.7 — Human override detector
 * Runs every 30 min. Compares AEGIS state vs real Meta/TikTok/Shopify state.
 * When human modifies something outside AEGIS → AEGIS pauses that entity.
 * Prevents AEGIS from undoing manual decisions silently.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentSyncGuardian extends BaseAgent {
  readonly name = 'AGENT_SYNC_GUARDIAN';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'scan': return this.scan(task);
      case 'resolve': return this.resolve(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async scan(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const divergences: any[] = [];

    await Promise.allSettled([
      this.checkMetaBudgets(shop_id, divergences),
      this.checkMetaStatuses(shop_id, divergences),
      this.checkShopifyPrices(shop_id, divergences),
    ]);

    // Persist divergences and pause AEGIS on affected entities
    for (const d of divergences) {
      await this.db.query(`
        INSERT INTO platform_sync_state
          (shop_id, platform, entity_type, entity_id, aegis_value, platform_value,
           diverged_at, human_override, override_detected_at, aegis_paused_until)
        VALUES ($1,$2,$3,$4,$5,$6,NOW(),true,NOW(), NOW() + INTERVAL '4 hours')
        ON CONFLICT (shop_id, platform, entity_type, entity_id) DO UPDATE SET
          platform_value = EXCLUDED.platform_value, aegis_value = EXCLUDED.aegis_value,
          diverged_at = NOW(), human_override = true,
          override_detected_at = NOW(), aegis_paused_until = NOW() + INTERVAL '4 hours'`,
        [shop_id, d.platform, d.entity_type, d.entity_id,
         JSON.stringify(d.aegis_value), JSON.stringify(d.platform_value)]);

      await this.remember(shop_id, {
        memory_key: `human_override_${d.entity_id}`,
        memory_type: 'warning',
        value: {
          message: `Human override detected on ${d.entity_type} ${d.entity_id} (${d.platform}). AEGIS paused 4h.`,
          severity: 'warning', platform: d.platform, entity_id: d.entity_id,
          aegis_was: d.aegis_value, platform_has: d.platform_value,
        },
        ttl_hours: 6,
      });

      await this.emit('sync_guardian:override_detected', { shop_id, ...d });
    }

    if (divergences.length > 0) {
      await this.emit('alert', {
        shop_id, severity: 'warning',
        title: `${divergences.length} human override(s) detected`,
        message: `AEGIS has paused actions on: ${divergences.map(d => d.entity_id).join(', ')}`,
      });
    }

    return { success: true, data: { divergences: divergences.length, entities: divergences } };
  }

  private async checkMetaBudgets(shopId: string, out: any[]): Promise<void> {
    // Fetch what AEGIS thinks budgets are
    const { rows: aegisAdsets } = await this.db.query(`
      SELECT entity_id, daily_budget FROM ad_metrics_latest
      WHERE shop_id = $1 AND platform = 'meta' AND entity_type = 'adset' AND status = 'active'
      LIMIT 50`, [shopId]);

    // Fetch what Meta actually has (via connector)
    const metaToken = await this.getMetaToken(shopId);
    if (!metaToken) return;

    for (const adset of aegisAdsets) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${adset.entity_id}?fields=daily_budget&access_token=${metaToken}`
        );
        const data = await res.json() as any;
        if (!data.daily_budget) continue;

        const metaBudget = parseFloat(data.daily_budget) / 100; // Meta returns in cents
        const aegisBudget = parseFloat(adset.daily_budget);

        // Divergence > 5% = human touched it
        if (Math.abs(metaBudget - aegisBudget) / aegisBudget > 0.05) {
          out.push({
            platform: 'meta', entity_type: 'adset', entity_id: adset.entity_id,
            aegis_value: { daily_budget: aegisBudget },
            platform_value: { daily_budget: metaBudget },
          });
        }
      } catch { /* API error — skip */ }
    }
  }

  private async checkMetaStatuses(shopId: string, out: any[]): Promise<void> {
    const { rows: aegisAds } = await this.db.query(`
      SELECT entity_id, status FROM ad_metrics_latest
      WHERE shop_id = $1 AND platform = 'meta' AND entity_type = 'ad'
        AND status IN ('active','paused')
      LIMIT 50`, [shopId]);

    const metaToken = await this.getMetaToken(shopId);
    if (!metaToken) return;

    for (const ad of aegisAds) {
      try {
        const res = await fetch(
          `https://graph.facebook.com/v18.0/${ad.entity_id}?fields=status&access_token=${metaToken}`
        );
        const data = await res.json() as any;
        if (!data.status) continue;

        const metaStatus = data.status.toLowerCase();
        if (metaStatus !== ad.status) {
          out.push({
            platform: 'meta', entity_type: 'ad', entity_id: ad.entity_id,
            aegis_value: { status: ad.status },
            platform_value: { status: metaStatus },
          });
        }
      } catch { /* skip */ }
    }
  }

  private async checkShopifyPrices(shopId: string, out: any[]): Promise<void> {
    // Check if any product prices changed vs what AEGIS expects
    const { rows: economics } = await this.db.query(`
      SELECT product_id, selling_price FROM product_economics WHERE shop_id = $1 LIMIT 20`, [shopId]);

    const shopifyToken  = await this.getShopifyToken(shopId);
    const shopifyDomain = await this.getShopifyDomain(shopId);
    if (!shopifyToken) return;

    for (const prod of economics) {
      try {
        const res = await fetch(
          `https://${shopifyDomain}/admin/api/2024-01/products/${prod.product_id}.json?fields=variants`,
          { headers: { 'X-Shopify-Access-Token': shopifyToken } }
        );
        const data = await res.json() as any;
        const currentPrice = parseFloat(data.product?.variants?.[0]?.price ?? 0);
        if (currentPrice && Math.abs(currentPrice - parseFloat(prod.selling_price)) > 0.01) {
          out.push({
            platform: 'shopify', entity_type: 'product', entity_id: prod.product_id,
            aegis_value: { price: prod.selling_price },
            platform_value: { price: currentPrice },
          });
        }
      } catch { /* skip */ }
    }
  }

  private async resolve(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { entity_id } = payload as any;

    await this.db.query(`
      UPDATE platform_sync_state
      SET human_override = false, resolved_at = NOW(), aegis_paused_until = NULL
      WHERE shop_id = $1 AND entity_id = $2`, [shop_id, entity_id]);

    // Update AEGIS's view of this entity to match what's actually on the platform
    const { rows: [state] } = await this.db.query(`
      SELECT * FROM platform_sync_state WHERE shop_id = $1 AND entity_id = $2`, [shop_id, entity_id]);

    if (state) {
      await this.db.query(`
        UPDATE ad_metrics_latest SET daily_budget = ($1->>'daily_budget')::numeric
        WHERE shop_id = $2 AND entity_id = $3 AND $1->>'daily_budget' IS NOT NULL`,
        [JSON.stringify(state.platform_value), shop_id, entity_id]);
    }

    return { success: true, message: `Override resolved for ${entity_id}. AEGIS resumed.` };
  }

  /**
   * Check if AEGIS should act on an entity (called by other agents before acting).
   */
  async isEntityPaused(shopId: string, entityId: string): Promise<boolean> {
    const { rows } = await this.db.query(`
      SELECT 1 FROM platform_sync_state
      WHERE shop_id = $1 AND entity_id = $2
        AND human_override = true AND aegis_paused_until > NOW()`, [shopId, entityId]);
    return rows.length > 0;
  }

  private async getMetaToken(shopId: string): Promise<string | null> {
    const { rows } = await this.db.query(`SELECT access_token FROM platform_credentials WHERE shop_id = $1 AND platform = 'meta'`, [shopId]);
    return rows[0]?.access_token ?? null;
  }

  private async getShopifyToken(shopId: string): Promise<string | null> {
    const { rows } = await this.db.query(`SELECT access_token FROM shopify_credentials WHERE shop_id = $1`, [shopId]);
    return rows[0]?.access_token ?? null;
  }

  private async getShopifyDomain(shopId: string): Promise<string | null> {
    const { rows } = await this.db.query(`SELECT shopify_domain FROM shops WHERE id = $1`, [shopId]);
    return rows[0]?.shopify_domain ?? null;
  }
}
