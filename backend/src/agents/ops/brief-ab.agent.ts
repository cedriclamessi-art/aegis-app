/**
 * AGENT_BRIEF_AB v4.2
 * A/B tests the Morning Brief format.
 * Tracks open rate + actions taken in the 2h following delivery.
 * Determines which format actually drives decisions.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentBriefAB extends BaseAgent {
  readonly name = 'AGENT_BRIEF_AB';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'record_delivery': return this.recordDelivery(task);
      case 'record_open':     return this.recordOpen(task);
      case 'record_action':   return this.recordAction(task);
      case 'analyze':         return this.analyze(task);
      case 'get_winner':      return this.getWinner(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Called by AGENT_DELIVERY when brief is sent. */
  private async recordDelivery(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { format } = payload as any;

    // Alternate variants A/B based on day of week
    const variant = new Date().getDay() % 2 === 0 ? 'A' : 'B';

    const { rows: [exp] } = await this.db.query(`
      INSERT INTO brief_delivery_experiments (shop_id, variant, format)
      VALUES ($1,$2,$3) RETURNING id`, [shop_id, variant, format]);

    return { success: true, data: { experiment_id: exp.id, variant } };
  }

  /** Called when user clicks confirmation link in brief. */
  private async recordOpen(task: AgentTask): Promise<AgentResult> {
    const { payload } = task;
    const { experiment_id } = payload as any;
    await this.db.query(`
      UPDATE brief_delivery_experiments SET opened=true, opened_at=NOW()
      WHERE id=$1`, [experiment_id]);
    return { success: true };
  }

  /** Called every 2h — counts dashboard decisions made since each brief. */
  private async recordAction(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // For each brief delivered in last 24h, count decisions made in next 2h
    const { rows: briefs } = await this.db.query(`
      SELECT id, delivered_at FROM brief_delivery_experiments
      WHERE shop_id=$1 AND delivered_at > NOW() - INTERVAL '24 hours'`, [shop_id]);

    for (const b of briefs) {
      const { rows: actions } = await this.db.query(`
        SELECT COUNT(*) AS n FROM audit_log
        WHERE shop_id=$1 AND user_id IS NOT NULL
          AND created_at BETWEEN $2 AND $2 + INTERVAL '2 hours'`,
        [shop_id, b.delivered_at]);

      await this.db.query(`
        UPDATE brief_delivery_experiments SET actions_taken_2h=$1 WHERE id=$2`,
        [parseInt(actions[0]?.n ?? 0), b.id]);
    }
    return { success: true };
  }

  /** Weekly analysis — which format wins? Z-test on action rates. */
  private async analyze(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const periodStart = new Date(Date.now() - 28 * 86400000);

    const { rows } = await this.db.query(`
      SELECT
        variant,
        COUNT(*) AS delivered,
        AVG(CASE WHEN opened THEN 1.0 ELSE 0.0 END) AS open_rate,
        AVG(actions_taken_2h) AS avg_actions
      FROM brief_delivery_experiments
      WHERE shop_id=$1 AND delivered_at >= $2
      GROUP BY variant`, [shop_id, periodStart]);

    if (rows.length < 2) return { success: true, data: { message: 'Insufficient data (need both variants)' } };

    const a = rows.find((r: any) => r.variant === 'A');
    const b = rows.find((r: any) => r.variant === 'B');
    if (!a || !b) return { success: true, data: { message: 'Missing variant data' } };

    const aActions = parseFloat(a.avg_actions ?? 0);
    const bActions = parseFloat(b.avg_actions ?? 0);
    const aOpen    = parseFloat(a.open_rate ?? 0);
    const bOpen    = parseFloat(b.open_rate ?? 0);

    // Simple comparison — winner needs >15% lift and >30 samples per variant
    const minSamples = 30;
    const aCount     = parseInt(a.delivered);
    const bCount     = parseInt(b.delivered);

    let winner: 'A' | 'B' | 'no_difference' = 'no_difference';
    let confidence = 0;
    let recommendation = 'Données insuffisantes pour conclure.';

    if (aCount >= minSamples && bCount >= minSamples) {
      if (bActions > aActions * 1.15) {
        winner = 'B'; confidence = 0.80;
        recommendation = `Format B (${rows.find((r: any) => r.variant==='B')?.format}) génère ${((bActions/aActions-1)*100).toFixed(0)}% plus d'actions dans les 2h. Adopter comme format principal.`;
      } else if (aActions > bActions * 1.15) {
        winner = 'A'; confidence = 0.80;
        recommendation = `Format A (${rows.find((r: any) => r.variant==='A')?.format}) reste le meilleur. Continuer avec ce format.`;
      } else {
        recommendation = `Pas de différence significative entre les formats (A: ${aActions.toFixed(1)} actions vs B: ${bActions.toFixed(1)}). Continuer le test.`;
      }
    }

    await this.db.query(`
      INSERT INTO brief_ab_results
        (shop_id, period_start, period_end,
         variant_a_opens, variant_b_opens, variant_a_actions, variant_b_actions,
         winner, confidence, recommendation)
      VALUES ($1,$2,CURRENT_DATE,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (shop_id, period_start) DO UPDATE SET
        variant_a_opens=$3, variant_b_opens=$4, variant_a_actions=$5, variant_b_actions=$6,
        winner=$7, confidence=$8, recommendation=$9`,
      [shop_id, periodStart, aOpen, bOpen, aActions, bActions, winner, confidence, recommendation]);

    if (winner !== 'no_difference') {
      await this.remember(shop_id, {
        memory_key: 'brief_ab_winner', memory_type: 'opportunity',
        value: { winner, confidence, recommendation, message: recommendation, severity: 'info' },
        ttl_hours: 168,
      });
    }

    return { success: true, data: { winner, confidence, recommendation, a: { open_rate: aOpen, avg_actions: aActions }, b: { open_rate: bOpen, avg_actions: bActions } } };
  }

  private async getWinner(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM brief_ab_results WHERE shop_id=$1
      ORDER BY period_start DESC LIMIT 4`, [task.shop_id]);
    return { success: true, data: { results: rows } };
  }
}
