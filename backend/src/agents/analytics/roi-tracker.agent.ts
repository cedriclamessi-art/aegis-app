/**
 * AGENT_ROI_TRACKER v3.7 — AEGIS measures its own impact
 * Revenue attributed to AGENT_SCALE decisions.
 * Cost saved by AGENT_STOP_LOSS interventions.
 * Monthly ROI vs subscription cost. SaaS proof of value.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentROITracker extends BaseAgent {
  readonly name = 'AGENT_ROI_TRACKER';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'compute_monthly': return this.computeMonthly(task);
      case 'get_summary':     return this.getSummary(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async computeMonthly(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const monthStart = new Date();
    monthStart.setDate(1); monthStart.setHours(0,0,0,0);

    // ── AGENT_SCALE impact ─────────────────────────
    // For each successful scale, compare ROAS 72h before vs 72h after
    const { rows: scaleDecisions } = await this.db.query(`
      SELECT ad.id, ad.subject_id, ad.decision_made, ad.executed_at,
             ao.outcome_score, ao.metrics_before, ao.metrics_after
      FROM agent_decisions ad
      LEFT JOIN action_outcomes ao ON ao.decision_id = ad.id
      WHERE ad.shop_id = $1 AND ad.agent_name = 'AGENT_SCALE'
        AND ad.executed = true AND ad.created_at >= $2
        AND ao.evaluated = true`, [shop_id, monthStart]);

    let scaleRevenue = 0;
    for (const d of scaleDecisions) {
      const before = d.metrics_before as any;
      const after  = d.metrics_after  as any;
      if (!before || !after) continue;

      const decision   = d.decision_made as any;
      const budgetDelta = (decision.new_budget ?? 0) - (decision.old_budget ?? 0);
      const roasBefore  = parseFloat(before.roas ?? 0);
      const roasAfter   = parseFloat(after.roas  ?? 0);

      // Incremental revenue = extra spend × ROAS after, minus what same spend would have generated at baseline
      if (roasAfter > roasBefore * 0.95) {
        const incrementalRev = budgetDelta * roasAfter - budgetDelta * roasBefore;
        scaleRevenue += Math.max(0, incrementalRev);
      }
    }

    // ── AGENT_STOP_LOSS impact ─────────────────────
    // For each kill, cost saved = spend that would have been wasted at bad CPA
    const { rows: stopLossDecisions } = await this.db.query(`
      SELECT ad.id, ad.subject_id, ad.decision_made,
             ao.metrics_before, ao.outcome_score
      FROM agent_decisions ad
      LEFT JOIN action_outcomes ao ON ao.decision_id = ad.id
      WHERE ad.shop_id = $1 AND ad.agent_name = 'AGENT_STOP_LOSS'
        AND ad.executed = true AND ad.created_at >= $2
        AND ao.evaluated = true`, [shop_id, monthStart]);

    let stopLossSaved = 0;
    const breakEvenCPA = await this.getBreakEvenCPA(shop_id);

    for (const d of stopLossDecisions) {
      const before = d.metrics_before as any;
      if (!before) continue;
      const badCPA  = parseFloat(before.cpa ?? 0);
      // Estimated daily spend that would have continued
      const dailySpend = parseFloat(before.spend ?? 0) / 7;
      const daysKept = 7; // estimate 7 days saved
      if (badCPA > breakEvenCPA * 1.2) {
        // Cost saved = spend × (cpa_waste_per_euro)
        const wastePerEuro = (badCPA - breakEvenCPA) / badCPA;
        stopLossSaved += dailySpend * daysKept * wastePerEuro;
      }
    }

    // ── AGENT_ANOMALY impact ────────────────────────
    const { rows: anomalyFixes } = await this.db.query(`
      SELECT COUNT(*) AS fixed, AVG(EXTRACT(HOUR FROM (resolved_at - created_at))) AS avg_hours
      FROM anomalies
      WHERE shop_id = $1 AND resolved_at IS NOT NULL
        AND created_at >= $2 AND severity IN ('critical','emergency')`, [shop_id, monthStart]);

    const anomaliesFixed = parseInt(anomalyFixes[0]?.fixed ?? 0);
    // Each critical anomaly resolved = ~2h less bad-data decision making
    const anomalySaved = anomaliesFixed * 2 * (await this.getHourlySpend(shop_id));

    // ── Persist to ledger ──────────────────────────
    const entries = [
      { agent: 'AGENT_SCALE',     action: 'budget_scale',   revenue: scaleRevenue,  saved: 0 },
      { agent: 'AGENT_STOP_LOSS', action: 'ad_kill',        revenue: 0,             saved: stopLossSaved },
      { agent: 'AGENT_ANOMALY',   action: 'anomaly_resolve', revenue: 0,            saved: anomalySaved },
    ];

    for (const e of entries) {
      await this.db.query(`
        INSERT INTO aegis_roi_ledger
          (shop_id, period_month, agent_name, action_type, actions_count, revenue_attributed, cost_saved)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT (shop_id, period_month, agent_name, action_type) DO UPDATE SET
          revenue_attributed = EXCLUDED.revenue_attributed, cost_saved = EXCLUDED.cost_saved`,
        [shop_id, monthStart, e.agent, e.action, scaleDecisions.length, e.revenue, e.saved]);
    }

    const totalRevenue = scaleRevenue;
    const totalSaved   = stopLossSaved + anomalySaved;

    // Upsert monthly summary
    const bestAgent = scaleRevenue > stopLossSaved ? 'AGENT_SCALE' : 'AGENT_STOP_LOSS';
    const bestImpact = Math.max(scaleRevenue, stopLossSaved);

    await this.db.query(`
      INSERT INTO aegis_roi_summary
        (shop_id, period_month, total_revenue_attributed, total_cost_saved, best_agent, best_agent_impact)
      VALUES ($1,$2,$3,$4,$5,$6)
      ON CONFLICT (shop_id, period_month) DO UPDATE SET
        total_revenue_attributed = EXCLUDED.total_revenue_attributed,
        total_cost_saved = EXCLUDED.total_cost_saved,
        best_agent = EXCLUDED.best_agent, best_agent_impact = EXCLUDED.best_agent_impact`,
      [shop_id, monthStart, totalRevenue.toFixed(2), totalSaved.toFixed(2), bestAgent, bestImpact.toFixed(2)]);

    await this.remember(shop_id, {
      memory_key: 'aegis_roi_this_month', memory_type: 'opportunity',
      value: {
        revenue_attributed: totalRevenue, cost_saved: totalSaved,
        total_impact: totalRevenue + totalSaved,
        roi_multiple: ((totalRevenue + totalSaved) / 199).toFixed(1) + '×',
      },
      ttl_hours: 24,
    });

    return { success: true, data: { revenue_attributed: totalRevenue, cost_saved: totalSaved, total_impact: totalRevenue + totalSaved } };
  }

  private async getSummary(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM aegis_roi_summary
      WHERE shop_id = $1 ORDER BY period_month DESC LIMIT 6`, [task.shop_id]);
    return { success: true, data: { monthly_summaries: rows } };
  }

  private async getBreakEvenCPA(shopId: string): Promise<number> {
    const { rows } = await this.db.query(`SELECT AVG(gross_margin) AS m FROM product_economics WHERE shop_id = $1`, [shopId]);
    return parseFloat(rows[0]?.m ?? 25);
  }

  private async getHourlySpend(shopId: string): Promise<number> {
    const { rows } = await this.db.query(`
      SELECT SUM(spend)/720 AS hourly FROM ad_metrics WHERE shop_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'`, [shopId]);
    return parseFloat(rows[0]?.hourly ?? 5);
  }
}
