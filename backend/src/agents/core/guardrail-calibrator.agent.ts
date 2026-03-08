/**
 * AGENT_GUARDRAIL_CALIBRATOR v3.9
 * Recalculates optimal guardrail thresholds monthly from real data.
 * max_cpa  → from product_economics break-even
 * max_spend → from 30-day avg × growth factor
 * min_roas  → from contribution margin requirement
 * Proposes changes. Human approves or rejects.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from './llm-audit.service';

export class AgentGuardrailCalibrator extends BaseAgent {
  readonly name = 'AGENT_GUARDRAIL_CALIBRATOR';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'calibrate':        return this.calibrate(task);
      case 'apply_approved':   return this.applyApproved(task);
      case 'get_proposals':    return this.getProposals(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async calibrate(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const proposals: any[] = [];

    // ── max_cpa ───────────────────────────────────────────
    const { rows: econ } = await this.db.query(`
      SELECT AVG(gross_margin) AS avg_margin, MIN(gross_margin) AS min_margin
      FROM product_economics WHERE shop_id=$1`, [shop_id]);

    const avgMargin = parseFloat(econ[0]?.avg_margin ?? 0);
    if (avgMargin > 0) {
      // Optimal max_cpa = 90% of gross margin (leave 10% buffer)
      const optimalMaxCpa = avgMargin * 0.90;
      const { rows: current } = await this.db.query(
        `SELECT value FROM guardrail_configs WHERE shop_id=$1 AND key='max_cpa'`, [shop_id]);
      const currentCpa = parseFloat(current[0]?.value ?? 35);

      if (Math.abs(optimalMaxCpa - currentCpa) / currentCpa > 0.10) {
        proposals.push({
          guardrail_key: 'max_cpa',
          current_value: currentCpa,
          proposed_value: Math.round(optimalMaxCpa * 100) / 100,
          rationale: `Based on average gross margin of €${avgMargin.toFixed(2)}, max profitable CPA is €${optimalMaxCpa.toFixed(2)}. Current limit of €${currentCpa} is ${optimalMaxCpa > currentCpa ? 'too restrictive' : 'too permissive'}.`,
          evidence: { avg_margin: avgMargin, min_margin: econ[0]?.min_margin, safety_buffer_pct: 10 },
        });
      }
    }

    // ── max_daily_spend ───────────────────────────────────
    const { rows: spendData } = await this.db.query(`
      SELECT AVG(daily_spend) AS avg_spend, STDDEV(daily_spend) AS stddev_spend,
             MAX(daily_spend) AS max_spend
      FROM (
        SELECT DATE(recorded_at) AS d, SUM(spend) AS daily_spend
        FROM ad_metrics WHERE shop_id=$1 AND recorded_at > NOW() - INTERVAL '30 days'
        GROUP BY DATE(recorded_at)
      ) s`, [shop_id]);

    const avgSpend = parseFloat(spendData[0]?.avg_spend ?? 0);
    if (avgSpend > 0) {
      // Optimal max = avg + 2σ (allows scaling peaks without uncapped risk)
      const stddev = parseFloat(spendData[0]?.stddev_spend ?? 0);
      const optimalMax = Math.ceil((avgSpend + 2 * stddev) * 1.2); // +20% growth buffer

      const { rows: curSpend } = await this.db.query(
        `SELECT value FROM guardrail_configs WHERE shop_id=$1 AND key='max_daily_spend'`, [shop_id]);
      const currentMax = parseFloat(curSpend[0]?.value ?? 500);

      if (Math.abs(optimalMax - currentMax) / currentMax > 0.15) {
        proposals.push({
          guardrail_key: 'max_daily_spend',
          current_value: currentMax,
          proposed_value: optimalMax,
          rationale: `30-day avg spend €${avgSpend.toFixed(0)}/day (σ=€${stddev.toFixed(0)}). Current cap of €${currentMax} is ${optimalMax > currentMax ? 'blocking growth headroom' : 'higher than needed — reduce to limit runaway spend'}.`,
          evidence: { avg_daily_spend: avgSpend, stddev: stddev, max_observed: spendData[0]?.max_spend },
        });
      }
    }

    // ── min_roas ──────────────────────────────────────────
    const { rows: profData } = await this.db.query(`
      SELECT AVG(true_roas) AS avg_roas,
             PERCENTILE_CONT(0.25) WITHIN GROUP (ORDER BY true_roas) AS p25_roas
      FROM profitability_metrics
      WHERE shop_id=$1 AND period_end > NOW() - INTERVAL '30 days'
        AND contribution_margin > 0`, [shop_id]);

    const p25Roas = parseFloat(profData[0]?.p25_roas ?? 0);
    if (p25Roas > 0) {
      // min_roas should be at the P25 of profitable campaigns
      const optimalMinRoas = Math.round(p25Roas * 10) / 10;
      const { rows: curRoas } = await this.db.query(
        `SELECT value FROM guardrail_configs WHERE shop_id=$1 AND key='min_roas'`, [shop_id]);
      const currentMinRoas = parseFloat(curRoas[0]?.value ?? 2.0);

      if (Math.abs(optimalMinRoas - currentMinRoas) > 0.3) {
        proposals.push({
          guardrail_key: 'min_roas',
          current_value: currentMinRoas,
          proposed_value: optimalMinRoas,
          rationale: `P25 of profitable campaigns shows ROAS ${p25Roas.toFixed(2)}×. Setting min_roas at this level keeps bottom quartile while allowing realistic thresholds.`,
          evidence: { p25_roas: p25Roas, avg_roas: profData[0]?.avg_roas },
        });
      }
    }

    // Generate LLM rationale summary for all proposals
    if (proposals.length > 0) {
      const llm = new LLMAuditService(this.db);
      const summary = proposals.map(p =>
        `${p.guardrail_key}: ${p.current_value} → ${p.proposed_value} (${p.proposed_value > p.current_value ? '+' : ''}${((p.proposed_value/p.current_value - 1)*100).toFixed(0)}%)`
      ).join(', ');

      try {
        const { text } = await llm.call({
          shop_id, agent_name: this.name, call_purpose: 'guardrail_calibration',
          max_tokens: 150,
          messages: [{
            role: 'user',
            content: `AEGIS guardrail recalibration for Blissal DTC brand. Proposed changes: ${summary}. In 2 sentences, explain the business implication of these changes to the owner.`
          }]
        });
        // Prepend summary to first proposal
        if (proposals[0]) proposals[0].rationale = text + '\n\n' + proposals[0].rationale;
      } catch { /* non-critical */ }
    }

    // Persist proposals
    for (const p of proposals) {
      await this.db.query(`
        INSERT INTO guardrail_calibration_proposals
          (shop_id, guardrail_key, current_value, proposed_value, rationale, evidence)
        VALUES ($1,$2,$3,$4,$5,$6)`,
        [shop_id, p.guardrail_key, p.current_value, p.proposed_value,
         p.rationale, JSON.stringify(p.evidence)]);
    }

    if (proposals.length > 0) {
      await this.remember(shop_id, {
        memory_key: 'guardrail_calibration', memory_type: 'opportunity',
        value: {
          proposals: proposals.length,
          changes: proposals.map(p => `${p.guardrail_key}: ${p.current_value}→${p.proposed_value}`),
          message: `${proposals.length} guardrail(s) need recalibration — review in settings`,
          severity: 'info',
        },
        ttl_hours: 168,
      });
    }

    return { success: true, data: { proposals_generated: proposals.length, proposals } };
  }

  private async applyApproved(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows: approved } = await this.db.query(`
      SELECT * FROM guardrail_calibration_proposals
      WHERE shop_id=$1 AND status='approved'`, [shop_id]);

    let applied = 0;
    for (const p of approved) {
      await this.db.query(`
        INSERT INTO guardrail_configs (shop_id, key, value) VALUES ($1,$2,$3)
        ON CONFLICT (shop_id, key) DO UPDATE SET value=$3`, [shop_id, p.guardrail_key, p.proposed_value]);

      await this.db.query(`
        INSERT INTO config_changelog
          (shop_id, changed_by, change_type, entity_type, config_key, value_before, value_after, change_reason)
        VALUES ($1,'AGENT_GUARDRAIL_CALIBRATOR','calibration','shop',$2,$3,$4,$5)`,
        [shop_id, p.guardrail_key, JSON.stringify(p.current_value),
         JSON.stringify(p.proposed_value), p.rationale.slice(0, 200)]);

      await this.db.query(
        `UPDATE guardrail_calibration_proposals SET status='auto_applied', reviewed_at=NOW() WHERE id=$1`,
        [p.id]);
      applied++;
    }

    return { success: true, data: { applied } };
  }

  private async getProposals(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM guardrail_calibration_proposals
      WHERE shop_id=$1 AND status='pending'
      ORDER BY proposed_at DESC`, [task.shop_id]);
    return { success: true, data: { proposals: rows } };
  }
}
