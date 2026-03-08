/**
 * AGENT_PRICING v3.7 — A/B price testing
 * Creates Shopify variant pairs at different price points.
 * Measures conversion AND margin impact (not just revenue).
 * Recommends optimal price per SKU.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentPricing extends BaseAgent {
  readonly name = 'AGENT_PRICING';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'launch_test':    return this.launchTest(task);
      case 'evaluate_tests': return this.evaluateTests(task);
      case 'apply_winner':   return this.applyWinner(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async launchTest(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { product_id, price_a, price_b, reason } = payload as any;

    // Create two Shopify variants at different prices
    const shopifyToken = await this.getShopifyToken(shop_id);
    const shopifyDomain = await this.getShopifyDomain(shop_id);

    const [varA, varB] = await Promise.all([
      this.createShopifyVariant(shopifyDomain, shopifyToken, product_id, price_a, 'Price Test A'),
      this.createShopifyVariant(shopifyDomain, shopifyToken, product_id, price_b, 'Price Test B'),
    ]);

    const { rows: [test] } = await this.db.query(`
      INSERT INTO pricing_tests (shop_id, product_id, variant_id_a, variant_id_b, price_a, price_b)
      VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [shop_id, product_id, varA.id, varB.id, price_a, price_b]);

    // Log to config changelog
    await this.db.query(`
      INSERT INTO config_changelog (shop_id, changed_by, change_type, entity_type, entity_id, config_key, value_before, value_after, change_reason)
      VALUES ($1,'AGENT_PRICING','pricing','product',$2,'price',$3,$4,$5)`,
      [shop_id, product_id, JSON.stringify({price: price_a}), JSON.stringify({price_a, price_b}), reason ?? 'Automated price test']);

    return { success: true, data: { test_id: test.id, variant_a: varA.id, variant_b: varB.id } };
  }

  private async evaluateTests(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows: tests } = await this.db.query(`
      SELECT * FROM pricing_tests WHERE shop_id = $1 AND status = 'running'
        AND start_date < NOW() - INTERVAL '7 days'`, [shop_id]);

    const results = [];
    for (const test of tests) {
      // Fetch actual performance from Shopify analytics
      const [perfA, perfB] = await Promise.all([
        this.getVariantPerformance(shop_id, test.variant_id_a),
        this.getVariantPerformance(shop_id, test.variant_id_b),
      ]);

      // Get COGS for margin calculation
      const { rows: econ } = await this.db.query(`
        SELECT cogs, shipping_cost FROM product_economics WHERE shop_id = $1 AND product_id = $2 LIMIT 1`,
        [shop_id, test.product_id]);

      const cogs     = parseFloat(econ[0]?.cogs ?? 0);
      const shipping = parseFloat(econ[0]?.shipping_cost ?? 0);
      const marginA  = (test.price_a - cogs - shipping) * perfA.conversions;
      const marginB  = (test.price_b - cogs - shipping) * perfB.conversions;

      // Z-test on conversion rates
      const { pValue, winner } = this.zTestPricing(
        perfA.sessions, perfA.conversions, test.price_a, marginA,
        perfB.sessions, perfB.conversions, test.price_b, marginB
      );

      const status = pValue < 0.10 ? 'significant' :
        (perfA.sessions + perfB.sessions) < 200 ? 'running' : 'no_difference';

      const recommendation = await this.generateRecommendation(
        test.price_a, perfA, marginA, test.price_b, perfB, marginB, status, winner
      );

      await this.db.query(`
        UPDATE pricing_tests SET
          sessions_a=$1, sessions_b=$2, conversions_a=$3, conversions_b=$4,
          revenue_a=$5, revenue_b=$6, margin_a=$7, margin_b=$8,
          p_value=$9, confidence=$10, winner_price=$11, status=$12, recommendation=$13
        WHERE id=$14`,
        [perfA.sessions, perfB.sessions, perfA.conversions, perfB.conversions,
         perfA.revenue, perfB.revenue, marginA, marginB,
         pValue, (1-pValue), winner === 'A' ? test.price_a : test.price_b,
         status, recommendation, test.id]);

      results.push({ test_id: test.id, status, winner, pValue, recommendation });
    }

    return { success: true, data: { evaluated: results.length, results } };
  }

  private async applyWinner(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { test_id } = payload as any;

    const { rows: [test] } = await this.db.query(
      `SELECT * FROM pricing_tests WHERE id = $1 AND shop_id = $2`, [test_id, shop_id]);
    if (!test || test.status !== 'significant') return { success: false, message: 'Test not significant' };

    const winnerPrice  = test.winner_price;
    const loserVariant = winnerPrice === test.price_a ? test.variant_id_b : test.variant_id_a;

    const shopifyToken  = await this.getShopifyToken(shop_id);
    const shopifyDomain = await this.getShopifyDomain(shop_id);

    // Update main product to winner price, delete test variant
    await this.updateShopifyPrice(shopifyDomain, shopifyToken, test.product_id, winnerPrice);
    await this.deleteShopifyVariant(shopifyDomain, shopifyToken, loserVariant);

    await this.db.query(`UPDATE pricing_tests SET status='ended', end_date=CURRENT_DATE WHERE id=$1`, [test_id]);

    await this.remember(shop_id, {
      memory_key: `pricing_winner_${test.product_id}`, memory_type: 'opportunity',
      value: { product_id: test.product_id, winner_price: winnerPrice, applied_at: new Date().toISOString() },
      ttl_hours: 168,
    });

    return { success: true, data: { product_id: test.product_id, new_price: winnerPrice } };
  }

  private zTestPricing(sA: number, cA: number, pA: number, mA: number, sB: number, cB: number, pB: number, mB: number) {
    if (!sA || !sB) return { pValue: 1, winner: null };
    const rA = cA / sA, rB = cB / sB;
    const pool = (cA + cB) / (sA + sB);
    const se = Math.sqrt(pool * (1 - pool) * (1/sA + 1/sB));
    if (!se) return { pValue: 1, winner: null };
    const z = Math.abs(rA - rB) / se;
    const pValue = 2 * (1 - this.normCDF(z));
    // Winner = higher margin per session, not just higher conversion
    const margPerSessionA = mA / sA, margPerSessionB = mB / sB;
    const winner = margPerSessionA >= margPerSessionB ? 'A' : 'B';
    return { pValue, winner };
  }

  private normCDF(z: number): number {
    const t = 1 / (1 + 0.3275911 * z);
    return 1 - t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429)))) * Math.exp(-z*z/2);
  }

  private async generateRecommendation(pA: number, perfA: any, mA: number, pB: number, perfB: any, mB: number, status: string, winner: string | null): Promise<string> {
    if (status !== 'significant') return `Continue testing — need more sessions (${perfA.sessions + perfB.sessions}/200).`;
    const w = winner === 'A' ? pA : pB;
    const wM = winner === 'A' ? mA : mB;
    const lM = winner === 'A' ? mB : mA;
    return `Apply €${w} — generates €${(wM - lM).toFixed(0)} more margin vs €${winner === 'A' ? pB : pA} (${((wM/lM - 1)*100).toFixed(1)}% improvement).`;
  }

  private async getShopifyToken(shopId: string): Promise<string> {
    const { rows } = await this.db.query(`SELECT access_token FROM shopify_credentials WHERE shop_id = $1`, [shopId]);
    return rows[0]?.access_token ?? '';
  }

  private async getShopifyDomain(shopId: string): Promise<string> {
    const { rows } = await this.db.query(`SELECT shopify_domain FROM shops WHERE id = $1`, [shopId]);
    return rows[0]?.shopify_domain ?? '';
  }

  private async createShopifyVariant(domain: string, token: string, productId: string, price: number, title: string): Promise<{id: string}> {
    const res = await fetch(`https://${domain}/admin/api/2024-01/products/${productId}/variants.json`, {
      method: 'POST', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ variant: { option1: title, price: price.toString() } }),
    });
    const data = await res.json() as any;
    return { id: data.variant?.id?.toString() ?? '' };
  }

  private async updateShopifyPrice(domain: string, token: string, productId: string, price: number): Promise<void> {
    await fetch(`https://${domain}/admin/api/2024-01/products/${productId}.json`, {
      method: 'PUT', headers: { 'X-Shopify-Access-Token': token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ product: { variants: [{ price: price.toString() }] } }),
    });
  }

  private async deleteShopifyVariant(domain: string, token: string, variantId: string): Promise<void> {
    await fetch(`https://${domain}/admin/api/2024-01/variants/${variantId}.json`, {
      method: 'DELETE', headers: { 'X-Shopify-Access-Token': token },
    });
  }

  private async getVariantPerformance(shopId: string, variantId: string): Promise<{sessions: number; conversions: number; revenue: number}> {
    const { rows } = await this.db.query(`
      SELECT COUNT(*) AS sessions, SUM(CASE WHEN converted THEN 1 ELSE 0 END) AS conversions,
             SUM(CASE WHEN converted THEN order_value ELSE 0 END) AS revenue
      FROM shopify_sessions WHERE shop_id = $1 AND variant_id = $2`, [shopId, variantId]);
    return { sessions: parseInt(rows[0]?.sessions ?? 0), conversions: parseInt(rows[0]?.conversions ?? 0), revenue: parseFloat(rows[0]?.revenue ?? 0) };
  }
}
