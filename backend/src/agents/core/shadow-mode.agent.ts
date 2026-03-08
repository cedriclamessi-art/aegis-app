/**
 * AGENT_SHADOW_MODE v3.9
 * Records what AEGIS WOULD have done vs what the human DID.
 * After 7 days: side-by-side performance comparison.
 * Build trust before handing over the keys.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from './llm-audit.service';

export class AgentShadowMode extends BaseAgent {
  readonly name = 'AGENT_SHADOW_MODE';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'record_shadow':   return this.recordShadow(task);
      case 'record_human':    return this.recordHuman(task);
      case 'generate_report': return this.generateReport(task);
      case 'get_report':      return this.getReport(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /**
   * Called when AEGIS is in shadow mode — logs what it would have done.
   * No actual execution happens.
   */
  private async recordShadow(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { agent_name, decision_type, subject_id, shadow_decision } = payload as any;

    await this.db.query(`
      INSERT INTO shadow_decisions
        (shop_id, agent_name, decision_type, subject_id, shadow_decision)
      VALUES ($1,$2,$3,$4,$5)`,
      [shop_id, agent_name, decision_type, subject_id, JSON.stringify(shadow_decision)]);

    return { success: true };
  }

  /**
   * Called when a human makes a decision on an entity that AEGIS was tracking.
   * Reconciles shadow decision with human action.
   */
  private async recordHuman(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { subject_id, human_decision } = payload as any;

    await this.db.query(`
      UPDATE shadow_decisions
      SET human_decision = $1
      WHERE shop_id = $2 AND subject_id = $3
        AND human_decision IS NULL
        AND created_at > NOW() - INTERVAL '24 hours'`,
      [JSON.stringify(human_decision), shop_id, subject_id]);

    return { success: true };
  }

  /**
   * Weekly report: AEGIS shadow vs human reality.
   * Estimates revenue delta with confidence bands.
   */
  private async generateReport(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const periodStart = new Date();
    periodStart.setDate(periodStart.getDate() - 7);
    const periodEnd = new Date();

    const { rows: shadows } = await this.db.query(`
      SELECT * FROM shadow_decisions
      WHERE shop_id=$1
        AND created_at >= $2 AND created_at <= $3
      ORDER BY created_at ASC`,
      [shop_id, periodStart, periodEnd]);

    if (shadows.length === 0) {
      return { success: true, data: { message: 'No shadow decisions in period' } };
    }

    // Categorize decisions
    let wouldScale = 0, wouldKill = 0, agreements = 0;
    const divergences: any[] = [];
    let estimatedDelta = 0;

    for (const s of shadows) {
      const shadow = s.shadow_decision as any;
      const human  = s.human_decision  as any;

      if (shadow?.action?.includes('scale')) wouldScale++;
      if (shadow?.action?.includes('kill') || shadow?.action?.includes('pause')) wouldKill++;

      if (human) {
        // Check agreement
        const shadowAction = shadow?.action ?? '';
        const humanAction  = human?.action  ?? '';
        const agree = (shadowAction.includes('scale') && humanAction.includes('scale')) ||
                      (shadowAction.includes('kill')  && humanAction.includes('kill'))  ||
                      (shadowAction === humanAction);

        if (agree) {
          agreements++;
        } else {
          // Estimate delta: if AEGIS would have scaled but human didn't,
          // estimate missed revenue = budget_increase × avg_roas
          if (shadow?.action?.includes('scale') && !humanAction.includes('scale')) {
            const budgetDelta = (shadow.new_budget ?? 0) - (shadow.old_budget ?? 0);
            const { rows: avgRoas } = await this.db.query(`
              SELECT AVG(roas) AS r FROM ad_metrics_latest WHERE shop_id=$1`, [shop_id]);
            const roas = parseFloat(avgRoas[0]?.r ?? 2.5);
            const missedRev = budgetDelta * roas * 7; // 7 day estimate
            estimatedDelta += missedRev;

            divergences.push({
              date:         new Date(s.created_at).toISOString().slice(0,10),
              subject_id:   s.subject_id,
              aegis_would:  `Scale budget ${shadow.old_budget}→${shadow.new_budget}`,
              human_did:    humanAction || 'no action',
              estimated_impact: `+€${missedRev.toFixed(0)} missed revenue (est.)`,
            });
          }
        }
      }
    }

    const agreementRate = shadows.filter(s => s.human_decision).length > 0
      ? agreements / shadows.filter(s => s.human_decision).length
      : 0;

    // LLM recommendation
    const llm = new LLMAuditService(this.db);
    let recommendation = '';
    try {
      const { text } = await llm.call({
        shop_id, agent_name: this.name, call_purpose: 'shadow_report',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `AEGIS shadow mode report for Blissal.
Period: ${periodStart.toISOString().slice(0,10)} – ${periodEnd.toISOString().slice(0,10)}
Shadow decisions: ${shadows.length}
Would have scaled: ${wouldScale}, would have killed: ${wouldKill}
Agreement with human: ${(agreementRate*100).toFixed(0)}%
Estimated revenue delta: €${estimatedDelta.toFixed(0)} (AEGIS would have generated more)
Top divergence: ${divergences[0]?.aegis_would ?? 'none'}

In 2 sentences: should the owner consider activating semi-auto or full-auto mode?`
        }]
      });
      recommendation = text;
    } catch {
      recommendation = agreementRate > 0.75
        ? 'High agreement with human decisions. Consider activating semi-auto mode.'
        : 'Significant divergence detected. Review top divergences before activating auto mode.';
    }

    // Persist report
    await this.db.query(`
      INSERT INTO shadow_reports
        (shop_id, period_start, period_end, total_shadow_decisions,
         aegis_would_have_scaled, aegis_would_have_killed,
         estimated_revenue_delta, agreement_rate, top_divergences, recommendation)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (shop_id, period_start, period_end) DO UPDATE SET
        total_shadow_decisions=$4, aegis_would_have_scaled=$5, aegis_would_have_killed=$6,
        estimated_revenue_delta=$7, agreement_rate=$8, top_divergences=$9, recommendation=$10`,
      [shop_id, periodStart, periodEnd, shadows.length,
       wouldScale, wouldKill, estimatedDelta.toFixed(2), agreementRate,
       JSON.stringify(divergences.slice(0, 5)), recommendation]);

    await this.remember(shop_id, {
      memory_key: 'shadow_mode_report', memory_type: 'opportunity',
      value: {
        agreement_rate: agreementRate,
        estimated_delta: estimatedDelta,
        recommendation: recommendation.slice(0, 200),
        message: `Shadow report: ${(agreementRate*100).toFixed(0)}% agreement, €${estimatedDelta.toFixed(0)} estimated delta`,
        severity: agreementRate > 0.75 ? 'info' : 'warning',
      },
      ttl_hours: 168,
    });

    return {
      success: true,
      data: {
        period: `${periodStart.toISOString().slice(0,10)} – ${periodEnd.toISOString().slice(0,10)}`,
        total_decisions: shadows.length,
        would_scale: wouldScale,
        would_kill: wouldKill,
        agreement_rate: agreementRate,
        estimated_revenue_delta: estimatedDelta,
        top_divergences: divergences.slice(0, 5),
        recommendation,
      },
    };
  }

  private async getReport(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM shadow_reports WHERE shop_id=$1
      ORDER BY generated_at DESC LIMIT 4`, [task.shop_id]);
    return { success: true, data: { reports: rows } };
  }
}
