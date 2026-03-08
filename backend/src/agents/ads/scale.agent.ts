import { ThresholdHelper } from '../core/threshold.helper';
/**
 * AGENT_SCALE v3.5 — Empire-aware budget scaling
 * Now uses world_state, logs decisions, requests deliberation for heavy scales,
 * schedules outcome measurement for feedback loop.
 */

import { BaseAgent, AgentTask, AgentResult, RiskLevel } from '../base/agent.base';

interface AdSet {
  id:        string;
  name:      string;
  roas:      number;
  cpa:       number;
  spend:     number;
  daily_budget: number;
}

export class AgentScale extends BaseAgent {
  readonly name = 'AGENT_SCALE';

  // Base thresholds — modulated by empire_mode risk multiplier
  private readonly BASE_ROAS_THRESHOLD = 2.5;
  private readonly BASE_BUDGET_CAP     = 500;

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'evaluate': return this.evaluateAllAdSets(task);
      case 'scale_one': return this.scaleOne(task);
      default: throw new Error(`Unknown task: ${task.type}`);
    }
  }

  private async evaluateAllAdSets(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // 1. Read world state — ALWAYS first step
    const world = await this.getWorldState(shop_id);
    if (!world) return { success: false, message: 'No world state available' };

    const multiplier = this.getRiskMultiplier(world.empire_mode);
    const roasThreshold = this.BASE_ROAS_THRESHOLD * (1 / multiplier); // lower in aggressive mode
    const budgetCap     = this.BASE_BUDGET_CAP * multiplier;

    // 2. Check own confidence for scale decisions
    const confidence = await this.getConfidence(shop_id, 'scale');
    if (confidence < 0.4) {
      // Poor track record — deposit warning in memory
      await this.remember(shop_id, {
        memory_key:  'scale_confidence_low',
        memory_type: 'warning',
        value:       { message: `AGENT_SCALE confidence low (${confidence.toFixed(2)}) — scaling paused`, severity: 'warning' },
        ttl_hours:   6,
      });
      return { success: true, message: `Scaling paused — confidence too low (${confidence.toFixed(2)})` };
    }

    // 3. Fetch ad sets eligible for scale
    const { rows: adsets } = await this.db.query<AdSet>(
      `SELECT id, name, roas, cpa, spend, daily_budget
       FROM ad_metrics_latest
       WHERE shop_id = $1
         AND status = 'active'
         AND spend > 50
         AND roas >= $2
         AND daily_budget < $3
       ORDER BY roas DESC
       LIMIT 10`,
      [shop_id, roasThreshold, budgetCap]
    );

    const scaled = [];
    for (const ad of adsets) {
      const result = await this.considerScaling(ad, shop_id, world, confidence, budgetCap);
      if (result) scaled.push(result);
    }

    // 4. Deposit memory signal
    await this.remember(shop_id, {
      memory_key:  'scale_eval_result',
      memory_type: scaled.length > 0 ? 'signal' : 'observation',
      value:       { evaluated: adsets.length, scaled: scaled.length, empire_mode: world.empire_mode },
      ttl_hours:   2,
    });

    return { success: true, data: { evaluated: adsets.length, scaled: scaled.length, details: scaled } };
  }

  private async considerScaling(
    ad:         AdSet,
    shopId:     string,
    world:      any,
    confidence: number,
    budgetCap:  number
  ): Promise<unknown | null> {
    // Determine scale percentage based on empire mode
    const scalePct: Record<string, number> = { conservative: 0.10, balanced: 0.20, aggressive: 0.30 };
    const pct = scalePct[world.empire_mode] ?? 0.20;
    const newBudget = Math.min(ad.daily_budget * (1 + pct), budgetCap);
    const delta = newBudget - ad.daily_budget;

    // Determine risk level
    const risk: RiskLevel = pct >= 0.30 ? 'high' : pct >= 0.20 ? 'medium' : 'low';

    // High-risk scale requires deliberation
    if (this.needsDeliberation(risk, world.empire_mode)) {
      const deliberationId = await this.requestDeliberation(
        shopId,
        'scale_budget',
        { ad_id: ad.id, current_budget: ad.daily_budget, new_budget: newBudget, pct },
        risk,
        ['AGENT_GUARDRAIL', 'AGENT_CPA_GUARDIAN']
      );

      const { approved, reason } = await this.waitForDeliberation(deliberationId);
      if (!approved) {
        await this.logDecision(shopId, {
          decision_type:   'scale',
          subject_type:    'adset',
          subject_id:      ad.id,
          world_state:     world,
          decision_made:   { action: 'blocked_by_deliberation', reason },
          confidence,
          was_vetoed:      true,
          veto_reason:     reason,
          deliberation_id: deliberationId,
          consensus_reached: false,
        });
        return null;
      }
    }

    // Log the decision
    const metrics = { roas: ad.roas, cpa: ad.cpa, spend: ad.spend, budget: ad.daily_budget };
    const decisionId = await this.logDecision(shopId, {
      decision_type:  'scale',
      subject_type:   'adset',
      subject_id:     ad.id,
      world_state:    world,
      rules_evaluated: [
        { rule: `roas >= threshold`, value: ad.roas, threshold: this.BASE_ROAS_THRESHOLD, passed: true },
        { rule: `empire_mode`, value: world.empire_mode, multiplier: this.getRiskMultiplier(world.empire_mode) },
        { rule: `confidence >= 0.4`, value: confidence, passed: true },
      ],
      decision_made: { action: 'scale', old_budget: ad.daily_budget, new_budget: newBudget, pct, delta },
      confidence,
    });

    // Execute scale via Meta connector
    await this.emit('meta:update_budget', { adset_id: ad.id, daily_budget: newBudget, shop_id: shopId });
    await this.markExecuted(decisionId);

    // Schedule outcome measurement at t+6h
    await this.scheduleOutcome(shopId, decisionId, metrics);

    return { ad_id: ad.id, old: ad.daily_budget, new: newBudget, pct, decision_id: decisionId };
  }

  private async scaleOne(task: AgentTask): Promise<AgentResult> {
    const { ad_id, pct, shop_id } = task.payload as any;
    const world = await this.getWorldState(shop_id);
    if (!world) return { success: false, message: 'No world state' };

    const { rows } = await this.db.query(
      `SELECT id, name, roas, cpa, spend, daily_budget FROM ad_metrics_latest WHERE id = $1 AND shop_id = $2`,
      [ad_id, shop_id]
    );
    if (!rows[0]) return { success: false, message: 'Ad set not found' };

    const result = await this.considerScaling(rows[0], shop_id, world, 0.75, this.BASE_BUDGET_CAP);
    return { success: !!result, data: result };
  }
}
