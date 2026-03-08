/**
 * AGENT_BUDGET_OPTIMIZER v4.2
 * Compares marginal ROAS across platforms.
 * Recommends (and optionally executes) inter-platform budget shifts.
 * "Move €50/day from Meta to TikTok — TikTok marginal ROAS is 3.4×, Meta is 2.2×."
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from '../core/llm-audit.service';
import { councilGate } from '../../constitution/council.middleware';
import { ConstitutionalCouncil } from '../../constitution/council.agent';

export class AgentBudgetOptimizer extends BaseAgent {
  readonly name = 'AGENT_BUDGET_OPTIMIZER';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'analyze':   return this.analyze(task);
      case 'apply':     return this.applyShift(task);
      case 'get_history': return this.getHistory(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async analyze(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Compute marginal ROAS per platform over last 7 days
    // Marginal ROAS = ROAS at current spend level (last 3d) vs baseline (7d)
    const { rows: platforms } = await this.db.query(`
      SELECT
        platform,
        SUM(spend)    AS total_spend,
        SUM(revenue)  AS total_revenue,
        AVG(roas)     AS avg_roas,
        -- Marginal: ROAS when spend was 20% higher vs 20% lower
        AVG(CASE WHEN spend > percentile_cont(0.6) WITHIN GROUP (ORDER BY spend) OVER (PARTITION BY platform)
                 THEN roas END) AS high_spend_roas,
        AVG(CASE WHEN spend < percentile_cont(0.4) WITHIN GROUP (ORDER BY spend) OVER (PARTITION BY platform)
                 THEN roas END) AS low_spend_roas
      FROM ad_metrics
      WHERE shop_id=$1 AND recorded_at > NOW() - INTERVAL '7 days' AND spend > 0
      GROUP BY platform
      HAVING SUM(spend) > 50`, [shop_id]);

    if (platforms.length < 2) {
      return { success: true, data: { message: 'Need 2+ active platforms to optimize allocation' } };
    }

    const totalBudget = platforms.reduce((s: number, p: any) => s + parseFloat(p.total_spend) / 7, 0);

    // Build allocation map
    const allocations: Record<string, any> = {};
    for (const p of platforms) {
      const dailyBudget  = parseFloat(p.total_spend) / 7;
      const marginalRoas = parseFloat(p.high_spend_roas ?? p.avg_roas ?? 0);
      allocations[p.platform] = {
        budget:        Math.round(dailyBudget),
        pct:           Math.round(dailyBudget / totalBudget * 100),
        marginal_roas: parseFloat(marginalRoas.toFixed(2)),
        avg_roas:      parseFloat(parseFloat(p.avg_roas ?? 0).toFixed(2)),
      };
    }

    // Find best and worst marginal ROAS
    const sorted = Object.entries(allocations)
      .sort(([, a], [, b]) => (b as any).marginal_roas - (a as any).marginal_roas);

    const best  = sorted[0];
    const worst = sorted[sorted.length - 1];
    const [bestPlatform, bestData]   = best  as [string, any];
    const [worstPlatform, worstData] = worst as [string, any];

    let recommendedShift = null;
    if (bestData.marginal_roas - worstData.marginal_roas > 0.5) {
      const shiftAmount = Math.min(
        Math.round(worstData.budget * 0.20),  // max 20% of worst platform
        50  // max €50/day shift per analysis
      );

      // Generate rationale
      const llm   = new LLMAuditService(this.db);
      let rationale = '';
      try {
        const { text } = await llm.call({
          shop_id, agent_name: this.name, call_purpose: 'budget_shift_rationale',
          max_tokens: 100,
          messages: [{
            role: 'user',
            content: `Justifie en 1 phrase ce transfert de budget publicitaire:
De: ${worstPlatform} (ROAS marginal ${worstData.marginal_roas}×)
Vers: ${bestPlatform} (ROAS marginal ${bestData.marginal_roas}×)
Montant: €${shiftAmount}/jour`
          }]
        });
        rationale = text;
      } catch {
        rationale = `${bestPlatform} montre un ROAS marginal ${bestData.marginal_roas}× vs ${worstData.marginal_roas}× sur ${worstPlatform} — transférer €${shiftAmount}/jour améliore l'efficacité globale.`;
      }

      recommendedShift = {
        from: worstPlatform, to: bestPlatform,
        amount: shiftAmount, reason: rationale,
        estimated_roas_gain: (bestData.marginal_roas - worstData.marginal_roas).toFixed(2),
      };
    }

    await this.db.query(`
      INSERT INTO platform_budget_allocation
        (shop_id, total_daily_budget, allocations, recommended_shift)
      VALUES ($1,$2,$3,$4)`,
      [shop_id, Math.round(totalBudget), JSON.stringify(allocations),
       recommendedShift ? JSON.stringify(recommendedShift) : null]);

    if (recommendedShift) {
      await this.remember(shop_id, {
        memory_key: 'budget_shift_recommendation', memory_type: 'opportunity',
        value: { ...recommendedShift, message: recommendedShift.reason, severity: 'info' },
        ttl_hours: 48,
      });
    }

    return { success: true, data: { allocations, recommended_shift: recommendedShift, total_daily: Math.round(totalBudget) } };
  }

  private async applyShift(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { allocation_id } = payload as any;

    const { rows } = await this.db.query(
      `SELECT * FROM platform_budget_allocation WHERE id=$1 AND shop_id=$2`, [allocation_id, shop_id]);
    if (!rows[0]?.recommended_shift) return { success: false, message: 'No shift to apply' };

    const shift = rows[0].recommended_shift as any;

    // Council gate
    const council = new ConstitutionalCouncil(this.db, this.redis);
    const gate = await councilGate(council, shop_id, this.name, 'budget_scale', {
      action: 'inter_platform_shift', from: shift.from, to: shift.to, amount: shift.amount,
    });
    if (!gate.approved) return { success: false, message: gate.veto_reason };

    // Decrease worst platform budgets proportionally
    const { rows: worstAdsets } = await this.db.query(`
      SELECT entity_id, daily_budget FROM ad_metrics_latest
      WHERE shop_id=$1 AND platform=$2 AND entity_type='adset' AND status='active'
        AND daily_budget > 10
      ORDER BY daily_budget DESC LIMIT 3`, [shop_id, shift.from]);

    const totalFrom = worstAdsets.reduce((s: number, a: any) => s + parseFloat(a.daily_budget), 0);
    for (const adset of worstAdsets) {
      const reduction = (parseFloat(adset.daily_budget) / totalFrom) * shift.amount;
      await this.emit('meta:update_budget', {
        adset_id: adset.entity_id, daily_budget: parseFloat(adset.daily_budget) - reduction, shop_id,
      });
    }

    // Increase best platform budgets proportionally
    const { rows: bestAdsets } = await this.db.query(`
      SELECT entity_id, daily_budget FROM ad_metrics_latest
      WHERE shop_id=$1 AND platform=$2 AND entity_type='adset' AND status='active'
        AND daily_budget > 10
      ORDER BY roas DESC LIMIT 3`, [shop_id, shift.to]);

    const totalTo = bestAdsets.reduce((s: number, a: any) => s + parseFloat(a.daily_budget), 0);
    for (const adset of bestAdsets) {
      const increase = (parseFloat(adset.daily_budget) / totalTo) * shift.amount;
      await this.emit(shift.to === 'tiktok' ? 'tiktok:update_budget' : 'meta:update_budget', {
        adset_id: adset.entity_id, daily_budget: parseFloat(adset.daily_budget) + increase, shop_id,
      });
    }

    await this.db.query(`UPDATE platform_budget_allocation SET applied=true, applied_at=NOW() WHERE id=$1`, [allocation_id]);
    return { success: true, data: { shift_applied: shift } };
  }

  private async getHistory(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM platform_budget_allocation WHERE shop_id=$1
      ORDER BY recorded_at DESC LIMIT 30`, [task.shop_id]);
    return { success: true, data: { history: rows } };
  }
}
