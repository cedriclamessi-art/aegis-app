/**
 * AGENT_EVALUATOR v3.5 — Feedback loop & self-calibration
 * Triggered by Orchestrator when action_outcomes.evaluate_after <= NOW().
 * Measures what happened 6h after each decision, scores the outcome,
 * and feeds the score back to the responsible agent.
 */

import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

interface PendingOutcome {
  id:            string;
  decision_id:   string;
  agent_name:    string;
  decision_type: string;
  metrics_before: Record<string, number>;
}

export class AgentEvaluator extends BaseAgent {
  readonly name = 'AGENT_EVALUATOR';
  private claude: Anthropic;

  constructor(db: any, redis: any) {
    super(db, redis);
    this.claude = new Anthropic();
  }

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'evaluate_outcome':  return this.evaluateOutcome(task);
      case 'run_batch':         return this.runBatch(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  private async runBatch(task: AgentTask): Promise<AgentResult> {
    const { rows: pending } = await this.db.query<PendingOutcome>(
      `SELECT id, decision_id, agent_name, decision_type, metrics_before
       FROM action_outcomes
       WHERE shop_id = $1 AND evaluated = false AND evaluate_after <= NOW()
       LIMIT 20`,
      [task.shop_id]
    );

    const results = [];
    for (const outcome of pending) {
      const r = await this.evaluateOutcome({ ...task, payload: outcome });
      results.push(r);
    }
    return { success: true, data: { evaluated: results.length } };
  }

  private async evaluateOutcome(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const outcome = payload as PendingOutcome;

    // 1. Fetch current metrics (t+6h)
    const { rows: current } = await this.db.query(
      `SELECT
         AVG(roas) AS roas, AVG(cpa) AS cpa,
         SUM(spend) AS spend, COUNT(*) AS active_ads
       FROM ad_metrics_latest
       WHERE shop_id = $1`,
      [shop_id]
    );
    const metricsAfter = {
      roas:       parseFloat(current[0]?.roas ?? 0),
      cpa:        parseFloat(current[0]?.cpa ?? 0),
      spend:      parseFloat(current[0]?.spend ?? 0),
      active_ads: parseInt(current[0]?.active_ads ?? 0),
    };

    // 2. Score the outcome via LLM
    const score = await this.scoreOutcome(
      outcome.decision_type, outcome.metrics_before, metricsAfter
    );

    // 3. Update action_outcomes record
    await this.db.query(
      `UPDATE action_outcomes
       SET metrics_after       = $1,
           measured_at_after   = NOW(),
           outcome_score       = $2,
           outcome_label       = $3,
           outcome_reason      = $4,
           evaluated           = true
       WHERE id = $5`,
      [
        JSON.stringify(metricsAfter),
        score.score, score.label, score.reason,
        outcome.id,
      ]
    );

    // 4. Feed score back to the responsible agent for self-calibration
    await this.emit('outcome_feedback', {
      agent_name:     outcome.agent_name,
      decision_type:  outcome.decision_type,
      shop_id,
      outcome_score:  score.score,
      suggestion:     score.threshold_suggestion,
    });

    // 5. Deposit learning into shared memory
    await this.remember(shop_id, {
      memory_key:  `outcome_${outcome.decision_type}_recent`,
      memory_type: score.score > 0.1 ? 'opportunity' : score.score < -0.1 ? 'warning' : 'observation',
      value: {
        agent:     outcome.agent_name,
        decision:  outcome.decision_type,
        score:     score.score,
        label:     score.label,
        message:   score.reason,
        severity:  score.score < -0.3 ? 'warning' : 'info',
      },
      confidence: 0.9,
      ttl_hours: 12,
    });

    return { success: true, data: { outcome_id: outcome.id, score: score.score, label: score.label } };
  }

  private async scoreOutcome(
    decisionType: string,
    before:       Record<string, number>,
    after:        Record<string, number>
  ): Promise<{ score: number; label: string; reason: string; threshold_suggestion?: number }> {
    // Simple heuristic scoring (fast path — no LLM)
    const roasDelta = after.roas && before.roas ? (after.roas - before.roas) / before.roas : 0;
    const cpaDelta  = after.cpa  && before.cpa  ? (before.cpa - after.cpa)   / before.cpa  : 0; // lower CPA = positive
    const score = (roasDelta * 0.6 + cpaDelta * 0.4);

    const label =
      score >  0.5 ? 'excellent' :
      score >  0.2 ? 'good'      :
      score > -0.2 ? 'neutral'   :
      score > -0.5 ? 'bad'       : 'terrible';

    // Ask LLM for reasoning on significant outcomes
    let reason = `ROAS ${roasDelta > 0 ? '+' : ''}${(roasDelta * 100).toFixed(1)}% · CPA ${cpaDelta > 0 ? '+' : ''}${(cpaDelta * 100).toFixed(1)}%`;
    if (Math.abs(score) > 0.2) {
      try {
        const resp = await this.claude.messages.create({
          model: 'claude-sonnet-4-5', max_tokens: 100,
          messages: [{
            role: 'user',
            content: `AEGIS agent feedback. Decision: ${decisionType}. Before: ${JSON.stringify(before)}. After 6h: ${JSON.stringify(after)}. Outcome score: ${score.toFixed(2)} (${label}). In one sentence, why?`
          }]
        });
        reason = (resp.content[0] as {text: string}).text;
      } catch { /* fallback to heuristic */ }
    }

    // Suggest threshold adjustment for bad/terrible outcomes
    const threshold_suggestion = score < -0.3 ? -5 : score < -0.1 ? -2 : score > 0.4 ? +3 : 0;

    return { score, label, reason, threshold_suggestion };
  }
}
