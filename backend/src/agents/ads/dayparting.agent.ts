/**
 * AGENT_DAYPARTING v3.8
 * Learns which hours/days convert best per platform.
 * Dynamically adjusts budgets — more at peak, less at dead hours.
 * For Blissal FR: soirée 19-22h + samedi matin = peak probable.
 * Un euro à 03h00 ≠ un euro à 20h00.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentDayparting extends BaseAgent {
  readonly name = 'AGENT_DAYPARTING';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'analyze_patterns':  return this.analyzePatterns(task);
      case 'apply_schedule':    return this.applySchedule(task);
      case 'build_schedule':    return this.buildSchedule(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Runs weekly. Computes hourly performance index from last 30 days. */
  private async analyzePatterns(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const { rows } = await this.db.query(`
      SELECT
        platform,
        EXTRACT(DOW FROM recorded_at AT TIME ZONE 'Europe/Paris')::int AS dow,
        EXTRACT(HOUR FROM recorded_at AT TIME ZONE 'Europe/Paris')::int AS hour,
        AVG(roas) AS avg_roas, AVG(cpa) AS avg_cpa,
        AVG(ctr) AS avg_ctr,
        AVG(CASE WHEN spend > 0 THEN conversions::numeric / spend ELSE 0 END) AS avg_cvr,
        SUM(spend) AS total_spend, SUM(conversions) AS total_conv,
        COUNT(DISTINCT DATE(recorded_at)) AS sample_days
      FROM ad_metrics
      WHERE shop_id = $1 AND recorded_at > NOW() - INTERVAL '30 days'
        AND spend > 1
      GROUP BY platform, dow, hour
      HAVING COUNT(DISTINCT DATE(recorded_at)) >= 5`, [shop_id]);

    if (!rows.length) return { success: false, message: 'Insufficient hourly data (need 5+ days)' };

    // Compute baseline ROAS per platform
    const platformBaselines: Record<string, number> = {};
    for (const r of rows) {
      if (!platformBaselines[r.platform]) platformBaselines[r.platform] = 0;
      platformBaselines[r.platform] += parseFloat(r.avg_roas);
    }
    for (const p of Object.keys(platformBaselines)) {
      const count = rows.filter(r => r.platform === p).length;
      platformBaselines[p] /= count;
    }

    // Upsert hourly performance with performance_index
    for (const r of rows) {
      const baseline = platformBaselines[r.platform] || 1;
      const perfIndex = Math.min(3.0, Math.max(0.1, parseFloat(r.avg_roas) / baseline));

      await this.db.query(`
        INSERT INTO hourly_performance
          (shop_id, platform, day_of_week, hour_of_day, avg_roas, avg_cpa, avg_cvr, avg_ctr,
           total_spend, total_conversions, sample_days, performance_index)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        ON CONFLICT (shop_id, platform, day_of_week, hour_of_day) DO UPDATE SET
          avg_roas=$5, avg_cpa=$6, avg_cvr=$7, avg_ctr=$8,
          total_spend=$9, total_conversions=$10, sample_days=$11,
          performance_index=$12, computed_at=NOW()`,
        [shop_id, r.platform, r.dow, r.hour,
         r.avg_roas, r.avg_cpa, r.avg_cvr, r.avg_ctr,
         r.total_spend, r.total_conv, r.sample_days, perfIndex]);
    }

    // Deposit top/bottom hours in memory
    const sorted = rows.sort((a,b) => parseFloat(b.avg_roas) - parseFloat(a.avg_roas));
    const top5   = sorted.slice(0, 5);
    const bot5   = sorted.slice(-5);

    await this.remember(shop_id, {
      memory_key: 'dayparting_patterns', memory_type: 'signal',
      value: {
        top_hours: top5.map(r => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.dow]} ${r.hour}h: ROAS ${parseFloat(r.avg_roas).toFixed(2)}×`),
        dead_hours: bot5.map(r => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.dow]} ${r.hour}h: ROAS ${parseFloat(r.avg_roas).toFixed(2)}×`),
      },
      ttl_hours: 168,
    });

    // Auto-build schedule after analysis
    await this.buildSchedule({ ...task });

    return { success: true, data: { hours_analyzed: rows.length, platforms: Object.keys(platformBaselines) } };
  }

  /** Build daypart schedule from performance data. */
  private async buildSchedule(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const platforms = ['meta', 'tiktok'];

    for (const platform of platforms) {
      const { rows } = await this.db.query(`
        SELECT day_of_week, hour_of_day, performance_index
        FROM hourly_performance
        WHERE shop_id = $1 AND platform = $2
        ORDER BY day_of_week, hour_of_day`, [shop_id, platform]);

      if (!rows.length) continue;

      // Build multiplier map — index > 1.3 → scale, < 0.7 → reduce
      const multipliers: Record<string, Record<string, number>> = {};
      for (const r of rows) {
        const dow  = r.day_of_week.toString();
        const hour = r.hour_of_day.toString();
        const idx  = parseFloat(r.performance_index);

        if (idx > 1.2 || idx < 0.8) {  // Only set non-default hours
          if (!multipliers[dow]) multipliers[dow] = {};
          multipliers[dow][hour] = Math.min(2.0, Math.max(0.2, Math.round(idx * 10) / 10));
        }
      }

      // Get LLM to name the pattern and validate logic
      let summary = '';
      try {
        const topHours = rows.filter(r => parseFloat(r.performance_index) > 1.3)
          .slice(0,5).map(r => `${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][r.day_of_week]} ${r.hour_of_day}h (${parseFloat(r.performance_index).toFixed(2)}×)`)
          .join(', ');
        const resp = await this.claude.messages.create({
          model: 'claude-sonnet-4-5', max_tokens: 80,
          messages: [{ role: 'user', content: `French DTC brand (exfoliating towels, women 25-40). Top performing hours: ${topHours}. In one sentence, describe the audience pattern.` }]
        });
        summary = (resp.content[0] as any).text;
      } catch {}

      await this.db.query(`
        INSERT INTO daypart_schedules (shop_id, platform, budget_multipliers)
        VALUES ($1,$2,$3)
        ON CONFLICT (shop_id, platform) DO UPDATE SET
          budget_multipliers=$3, updated_at=NOW()`,
        [shop_id, platform, JSON.stringify(multipliers)]);

      await this.remember(shop_id, {
        memory_key: `daypart_schedule_${platform}`, memory_type: 'opportunity',
        value: { platform, multipliers_count: Object.values(multipliers).reduce((s,h)=>s+Object.keys(h).length,0), summary },
        ttl_hours: 168,
      });
    }

    return { success: true, message: 'Daypart schedules built' };
  }

  /** Runs every hour. Applies budget multipliers based on current time. */
  private async applySchedule(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const world = await this.getWorldState(shop_id);

    // Don't apply in conservative mode unless it's a reduction
    const now   = new Date();
    const dow   = now.getDay().toString();
    const hour  = now.getHours().toString();

    const { rows: schedules } = await this.db.query(`
      SELECT * FROM daypart_schedules WHERE shop_id = $1 AND is_active = true`, [shop_id]);

    const applied = [];
    for (const schedule of schedules) {
      const multipliers = schedule.budget_multipliers as Record<string, Record<string, number>>;
      const multiplier  = multipliers[dow]?.[hour] ?? 1.0;

      // In conservative mode, only allow reductions
      if (world?.empire_mode === 'conservative' && multiplier > 1.0) continue;

      if (multiplier === 1.0) continue; // No change needed

      // Get active adsets for this platform
      const { rows: adsets } = await this.db.query(`
        SELECT entity_id, daily_budget FROM ad_metrics_latest
        WHERE shop_id = $1 AND platform = $2 AND entity_type = 'adset' AND status = 'active'
          AND daily_budget > 0`, [shop_id, schedule.platform]);

      for (const adset of adsets) {
        // Check for human override
        const paused = await this.isEntityPaused(shop_id, adset.entity_id);
        if (paused) continue;

        const newBudget = parseFloat(adset.daily_budget) * multiplier;

        const decisionId = await this.logDecision(shop_id, {
          decision_type:  'daypart_budget',
          subject_type:   'adset',
          subject_id:     adset.entity_id,
          world_state:    world,
          rules_evaluated: [{ rule: `dow=${dow} hour=${hour}`, multiplier, platform: schedule.platform }],
          decision_made:  { action: 'daypart_adjust', old_budget: adset.daily_budget, new_budget: newBudget, multiplier },
          confidence:     0.80,
        });

        await this.emit('meta:update_budget', { adset_id: adset.entity_id, daily_budget: newBudget, shop_id });
        await this.markExecuted(decisionId);
        applied.push({ adset_id: adset.entity_id, multiplier, new_budget: newBudget });
      }

      await this.db.query(`UPDATE daypart_schedules SET last_applied_at=NOW() WHERE id=$1`, [schedule.id]);
    }

    return { success: true, data: { hour: parseInt(hour), dow: parseInt(dow), applied: applied.length, adjustments: applied } };
  }

  private async isEntityPaused(shopId: string, entityId: string): Promise<boolean> {
    const { rows } = await this.db.query(`
      SELECT 1 FROM platform_sync_state
      WHERE shop_id=$1 AND entity_id=$2 AND human_override=true AND aegis_paused_until>NOW()`,
      [shopId, entityId]);
    return rows.length > 0;
  }
}
