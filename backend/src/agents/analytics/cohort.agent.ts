/**
 * AGENT_COHORT v7.0 — Hack #94
 * Analyse de cohortes clients : rétention, LTV, canal d'acquisition.
 * Répond à : "Les clients acquis via Meta en janvier valent-ils
 * mieux que ceux acquis via TikTok en février ?"
 *
 * Alimenté par : AGENT_BEHAVIORAL_LEARNING (patterns rétention)
 * Alimente : AGENT_BUDGET_OPTIMIZER (ROI par canal d'acquisition)
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentCohort extends BaseAgent {
  readonly name = 'AGENT_COHORT';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'compute':       return this.compute(task);
      case 'get_report':    return this.getReport(task);
      case 'compare':       return this.compare(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Calcule les cohortes mensuelles. */
  private async compute(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Cohortes des 12 derniers mois
    const { rows: cohortBases } = await this.db.query(`
      SELECT
        DATE_TRUNC('month', MIN(o.created_at))::DATE AS cohort_month,
        o.customer_id,
        ae.converting_channel AS acquisition_channel
      FROM shopify_orders o
      LEFT JOIN attribution_events ae
        ON ae.customer_id=o.customer_id AND ae.shop_id=$1
        AND ae.event_time = (
          SELECT MIN(ae2.event_time) FROM attribution_events ae2
          WHERE ae2.customer_id=o.customer_id AND ae2.shop_id=$1
        )
      WHERE o.shop_id=$1
        AND o.created_at > NOW() - INTERVAL '12 months'
      GROUP BY o.customer_id, ae.converting_channel`, [shop_id]);

    // Groupe par cohorte
    const cohorts = new Map<string, { customers: string[]; channel: string }>();
    for (const r of cohortBases) {
      const key = `${r.cohort_month}_${r.acquisition_channel ?? 'unknown'}`;
      if (!cohorts.has(key)) cohorts.set(key, { customers: [], channel: r.acquisition_channel ?? 'unknown' });
      cohorts.get(key)!.customers.push(r.customer_id);
    }

    let computed = 0;
    for (const [key, cohort] of cohorts.entries()) {
      const [cohortMonth] = key.split('_');
      const cohortSize = cohort.customers.length;
      if (cohortSize < 3) continue;

      // Rétention par mois M0..M6
      const retention: Record<string, number> = {};
      const revenue: Record<string, number> = {};

      for (let m = 0; m <= 6; m++) {
        const { rows: ret } = await this.db.query(`
          SELECT
            COUNT(DISTINCT o.customer_id) AS active,
            SUM(o.total_price::numeric) AS rev
          FROM shopify_orders o
          WHERE o.shop_id=$1
            AND o.customer_id = ANY($2::uuid[])
            AND DATE_TRUNC('month', o.created_at) =
                (DATE_TRUNC('month', $3::date) + $4 * INTERVAL '1 month')`,
          [shop_id, cohort.customers, cohortMonth, m]);

        retention[`M${m}`] = ret[0]?.active
          ? parseFloat(ret[0].active) / cohortSize
          : 0;
        revenue[`M${m}`] = parseFloat(ret[0]?.rev ?? 0);
      }

      // LTV cumulatif
      const ltvM3  = Object.entries(revenue).filter(([k]) => parseInt(k.slice(1)) <= 3).reduce((s, [,v]) => s+v, 0) / cohortSize;
      const ltvM6  = Object.values(revenue).reduce((s, v) => s+v, 0) / cohortSize;

      await this.db.query(`
        INSERT INTO cohort_analysis
          (shop_id, cohort_month, cohort_size, retention_by_month, revenue_by_month,
           ltv_m3, ltv_m6, acquisition_channel)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
        ON CONFLICT (shop_id, cohort_month, acquisition_channel) DO UPDATE SET
          cohort_size=$3, retention_by_month=$4, revenue_by_month=$5,
          ltv_m3=$6, ltv_m6=$7, computed_at=NOW()`,
        [shop_id, cohortMonth, cohortSize,
         JSON.stringify(retention), JSON.stringify(revenue),
         ltvM3, ltvM6, cohort.channel]);

      computed++;
    }

    return { success: true, data: { cohorts_computed: computed } };
  }

  private async getReport(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM cohort_analysis WHERE shop_id=$1
      ORDER BY cohort_month DESC, ltv_m6 DESC`, [task.shop_id]);

    // Identifie la meilleure cohorte
    const best = rows.reduce((b: any, r: any) =>
      (!b || parseFloat(r.ltv_m6) > parseFloat(b.ltv_m6)) ? r : b, null);

    return { success: true, data: { cohorts: rows, best_cohort: best } };
  }

  /** Compare deux canaux d'acquisition. */
  private async compare(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { channel_a, channel_b } = payload as any;

    const { rows } = await this.db.query(`
      SELECT
        acquisition_channel,
        AVG(cohort_size) AS avg_cohort_size,
        AVG(ltv_m3) AS avg_ltv_m3,
        AVG(ltv_m6) AS avg_ltv_m6,
        AVG((retention_by_month->>'M1')::numeric) AS avg_retention_m1,
        AVG((retention_by_month->>'M3')::numeric) AS avg_retention_m3
      FROM cohort_analysis
      WHERE shop_id=$1
        AND acquisition_channel = ANY($2::text[])
        AND cohort_month > NOW() - INTERVAL '6 months'
      GROUP BY acquisition_channel`,
      [shop_id, [channel_a, channel_b]]);

    const winner = rows.reduce((b: any, r: any) =>
      (!b || parseFloat(r.avg_ltv_m6) > parseFloat(b.avg_ltv_m6)) ? r : b, null);

    return { success: true, data: { comparison: rows, winner_channel: winner?.acquisition_channel } };
  }
}
