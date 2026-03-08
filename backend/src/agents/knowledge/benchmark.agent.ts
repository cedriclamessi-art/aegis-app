/**
 * AGENT_BENCHMARK v6.0
 * Collecte anonymisée et diffusion des benchmarks sectoriels.
 * Plus AEGIS a de clients, plus les benchmarks sont précis.
 * Chaque nouveau client bénéficie de l'expérience de tous les précédents.
 *
 * Principe : le ROI augmente avec chaque nouveau client sans coût marginal.
 * C'est le flywheel data d'AEGIS.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentBenchmark extends BaseAgent {
  readonly name = 'AGENT_BENCHMARK';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'contribute':       return this.contribute(task);
      case 'recompute':        return this.recompute(task);
      case 'get_position':     return this.getPosition(task);
      case 'get_benchmarks':   return this.getBenchmarks(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /**
   * Contribution mensuelle anonymisée de ce shop aux benchmarks globaux.
   * Appelé le 1er du mois. L'anonymisation est irréversible.
   */
  private async contribute(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Récupère le secteur du shop
    const { rows: [shop] } = await this.db.query(
      `SELECT industry, sub_category, market, price_tier FROM shops WHERE id=$1`, [shop_id]);
    if (!shop?.industry) return { success: false, message: 'Shop industry not configured' };

    const period = `Q${Math.ceil((new Date().getMonth()+1)/3)}_${new Date().getFullYear()}`;

    // Collecte les métriques à benchmarker
    const metrics = await this.collectShopMetrics(shop_id);

    // Contribue chaque métrique de façon anonymisée
    let contributed = 0;
    for (const [key, value] of Object.entries(metrics)) {
      if (value === null || value === undefined) continue;

      await this.db.query(`
        INSERT INTO benchmark_contributions
          (shop_id, metric_key, value, period)
        VALUES ($1,$2,$3,$4)
        ON CONFLICT DO NOTHING`,
        [shop_id, key, value, period]);
      contributed++;
    }

    return { success: true, data: { metrics_contributed: contributed, period } };
  }

  /**
   * Recompute benchmarks depuis toutes les contributions.
   * Utilise les percentiles PostgreSQL — statistiquement rigoureux.
   */
  private async recompute(task: AgentTask): Promise<AgentResult> {
    const period = `Q${Math.ceil((new Date().getMonth()+1)/3)}_${new Date().getFullYear()}`;

    // Pour chaque combinaison industry × metric, recalcule la distribution
    const { rows: combinations } = await this.db.query(`
      SELECT DISTINCT
        s.industry, s.sub_category, s.market, s.price_tier, bc.metric_key
      FROM benchmark_contributions bc
      JOIN shops s ON s.id = bc.shop_id
      WHERE bc.period=$1 AND s.industry IS NOT NULL`, [period]);

    let updated = 0;
    for (const combo of combinations) {
      const { rows: stats } = await this.db.query(`
        SELECT
          percentile_cont(0.10) WITHIN GROUP (ORDER BY bc.value) AS p10,
          percentile_cont(0.25) WITHIN GROUP (ORDER BY bc.value) AS p25,
          percentile_cont(0.50) WITHIN GROUP (ORDER BY bc.value) AS p50,
          percentile_cont(0.75) WITHIN GROUP (ORDER BY bc.value) AS p75,
          percentile_cont(0.90) WITHIN GROUP (ORDER BY bc.value) AS p90,
          COUNT(DISTINCT bc.shop_id) AS sample_shops
        FROM benchmark_contributions bc
        JOIN shops s ON s.id = bc.shop_id
        WHERE bc.metric_key=$1 AND bc.period=$2
          AND s.industry=$3
          AND ($4::text IS NULL OR s.sub_category=$4)
          AND s.market=$5
          AND ($6::text IS NULL OR s.price_tier=$6)`,
        [combo.metric_key, period, combo.industry, combo.sub_category,
         combo.market, combo.price_tier]);

      if (!stats[0] || parseInt(stats[0].sample_shops) < 3) continue; // minimum 3 shops

      await this.db.query(`
        INSERT INTO industry_benchmarks
          (industry, sub_category, market, price_tier, metric_key, metric_label,
           p10, p25, p50, p75, p90, sample_shops, sample_period)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT (industry, sub_category, market, price_tier, metric_key, sample_period)
        DO UPDATE SET p10=$7,p25=$8,p50=$9,p75=$10,p90=$11,sample_shops=$12,computed_at=NOW()`,
        [combo.industry, combo.sub_category, combo.market, combo.price_tier,
         combo.metric_key, combo.metric_key,
         stats[0].p10, stats[0].p25, stats[0].p50, stats[0].p75, stats[0].p90,
         stats[0].sample_shops, period]);
      updated++;
    }

    return { success: true, data: { benchmarks_updated: updated, period } };
  }

  /** Position de ce shop dans les benchmarks — "tu es au P67 pour le ROAS". */
  private async getPosition(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const { rows: [shop] } = await this.db.query(
      `SELECT industry, sub_category, market, price_tier FROM shops WHERE id=$1`, [shop_id]);

    const metrics = await this.collectShopMetrics(shop_id);
    const positions: any[] = [];

    for (const [key, value] of Object.entries(metrics)) {
      if (!value) continue;

      const { rows: [bench] } = await this.db.query(`
        SELECT p25, p50, p75, p90 FROM industry_benchmarks
        WHERE metric_key=$1 AND industry=$2 AND market=$3
          AND ($4::text IS NULL OR sub_category=$4)
        ORDER BY computed_at DESC LIMIT 1`,
        [key, shop?.industry ?? 'beauty_care', shop?.market ?? 'FR', shop?.sub_category]);

      if (!bench) continue;

      // Calcule le percentile approximatif
      let percentile = 50;
      const v = parseFloat(value as any);
      if (v >= parseFloat(bench.p90)) percentile = 90;
      else if (v >= parseFloat(bench.p75)) percentile = 75;
      else if (v >= parseFloat(bench.p50)) percentile = 50;
      else if (v >= parseFloat(bench.p25)) percentile = 25;
      else percentile = 10;

      const vsMedian = parseFloat(bench.p50) > 0
        ? ((v - parseFloat(bench.p50)) / parseFloat(bench.p50) * 100)
        : 0;

      await this.db.query(`
        INSERT INTO shop_benchmark_position (shop_id, metric_key, current_value, benchmark_p50, percentile, vs_median_pct)
        VALUES ($1,$2,$3,$4,$5,$6)
        ON CONFLICT (shop_id, metric_key) DO UPDATE SET
          current_value=$3, benchmark_p50=$4, percentile=$5, vs_median_pct=$6, computed_at=NOW()`,
        [shop_id, key, v, bench.p50, percentile, vsMedian]);

      positions.push({ metric: key, value: v, p50: bench.p50, percentile, vs_median_pct: vsMedian });
    }

    return { success: true, data: { positions } };
  }

  private async getBenchmarks(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows: positions } = await this.db.query(`
      SELECT * FROM shop_benchmark_position WHERE shop_id=$1 ORDER BY percentile DESC`, [shop_id]);
    const { rows: benchmarks } = await this.db.query(`
      SELECT ib.* FROM industry_benchmarks ib
      JOIN shops s ON s.industry=ib.industry AND s.market=ib.market
      WHERE s.id=$1 ORDER BY ib.computed_at DESC`, [shop_id]);
    return { success: true, data: { positions, benchmarks } };
  }

  private async collectShopMetrics(shopId: string): Promise<Record<string, number | null>> {
    const metrics: Record<string, number | null> = {};

    const { rows: ads } = await this.db.query(`
      SELECT AVG(roas) AS roas, AVG(cpa) AS cpa, AVG(ctr) AS ctr
      FROM ad_metrics WHERE shop_id=$1 AND recorded_at > NOW() - INTERVAL '30 days'`, [shopId]);

    metrics['roas_meta']   = parseFloat(ads[0]?.roas ?? 0) || null;
    metrics['cpa_meta']    = parseFloat(ads[0]?.cpa  ?? 0) || null;

    const { rows: cr } = await this.db.query(`
      SELECT AVG(conversion_rate) AS cr FROM attribution_events
      WHERE shop_id=$1 AND event_time > NOW() - INTERVAL '30 days'`, [shopId]);
    metrics['cr_landing_page'] = parseFloat(cr[0]?.cr ?? 0) || null;

    const { rows: cart } = await this.db.query(`
      SELECT COUNT(*) FILTER (WHERE NOT recovered)::numeric / NULLIF(COUNT(*),0) AS rate
      FROM cart_abandonment_events WHERE shop_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [shopId]);
    metrics['cart_abandonment_rate'] = parseFloat(cart[0]?.rate ?? 0) || null;

    return metrics;
  }
}
