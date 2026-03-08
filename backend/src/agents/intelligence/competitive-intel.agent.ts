/**
 * AGENT_COMPETITIVE_INTEL v3.8 — Predictive competitor analysis
 * Builds temporal patterns on competitor behavior from AGENT_SPY data.
 * Detects: launch cadences, budget cycles, seasonal ramps, hook reuse.
 * Predicts next competitor move BEFORE it happens.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentCompetitiveIntel extends BaseAgent {
  readonly name = 'AGENT_COMPETITIVE_INTEL';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'analyze_patterns': return this.analyzePatterns(task);
      case 'get_alerts':       return this.getAlerts(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async analyzePatterns(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Get competitor activity history from AGENT_SPY data
    const { rows: competitors } = await this.db.query(`
      SELECT DISTINCT competitor_name FROM competitor_ads WHERE shop_id=$1`, [shop_id]);

    const alerts: any[] = [];

    for (const { competitor_name } of competitors) {
      const { rows: adHistory } = await this.db.query(`
        SELECT first_seen_at, last_seen_at, creative_count, estimated_spend_tier,
               platform, hook_type, content_angle
        FROM competitor_ads
        WHERE shop_id=$1 AND competitor_name=$2
        ORDER BY first_seen_at ASC`, [shop_id, competitor_name]);

      if (adHistory.length < 5) continue;

      const patterns = await this.extractPatterns(shop_id, competitor_name, adHistory);

      for (const pattern of patterns) {
        await this.db.query(`
          INSERT INTO competitor_patterns
            (shop_id, competitor_name, pattern_type, description, confidence,
             evidence, next_predicted_action, next_predicted_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
          ON CONFLICT (shop_id, competitor_name, pattern_type) DO UPDATE SET
            description=$4, confidence=$5, evidence=$6,
            next_predicted_action=$7, next_predicted_at=$8, updated_at=NOW()`,
          [shop_id, competitor_name, pattern.type, pattern.description,
           pattern.confidence, JSON.stringify(pattern.evidence),
           pattern.next_action, pattern.next_at]);

        // Create alert if action is imminent (within 7 days)
        if (pattern.next_at && new Date(pattern.next_at) < new Date(Date.now() + 7 * 86400000)) {
          alerts.push({
            shop_id, competitor_name,
            alert_type: pattern.type,
            title: `${competitor_name} likely to ${pattern.next_action} within 7 days`,
            description: pattern.description,
            urgency: new Date(pattern.next_at) < new Date(Date.now() + 3 * 86400000) ? 'now' : 'this_week',
            recommended_action: pattern.recommended_response,
          });
        }
      }
    }

    // Persist alerts
    for (const alert of alerts) {
      await this.db.query(`
        INSERT INTO competitive_alerts
          (shop_id, competitor_name, alert_type, title, description, urgency, recommended_action)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [alert.shop_id, alert.competitor_name, alert.alert_type,
         alert.title, alert.description, alert.urgency, alert.recommended_action]);
    }

    if (alerts.length > 0) {
      await this.remember(shop_id, {
        memory_key: 'competitive_alert', memory_type: 'warning',
        value: {
          alerts: alerts.length,
          competitors: [...new Set(alerts.map(a => a.competitor_name))],
          message: alerts[0].title,
          severity: alerts.some(a => a.urgency === 'now') ? 'warning' : 'info',
        },
        ttl_hours: 48,
      });
    }

    return { success: true, data: { competitors_analyzed: competitors.length, alerts: alerts.length } };
  }

  private async extractPatterns(shopId: string, competitor: string, history: any[]): Promise<any[]> {
    // Compute launch intervals
    const launches = history.filter(h => h.creative_count > 0);
    const intervals: number[] = [];
    for (let i = 1; i < launches.length; i++) {
      const days = (new Date(launches[i].first_seen_at).getTime() -
                    new Date(launches[i-1].first_seen_at).getTime()) / 86400000;
      if (days > 0 && days < 60) intervals.push(days);
    }

    // Get our own creative tags to detect hook reuse
    const { rows: ourHooks } = await this.db.query(`
      SELECT hook_type, content_angle, tagged_at FROM creative_tags
      WHERE shop_id=$1 ORDER BY tagged_at DESC LIMIT 20`, [shopId]);

    const competitorHooks = history.map(h => ({ hook: h.hook_type, date: h.first_seen_at }));

    // Build LLM analysis prompt
    const historySummary = history.slice(-15).map(h =>
      `${new Date(h.first_seen_at).toISOString().slice(0,10)}: ${h.creative_count} ads, ${h.platform}, spend:${h.estimated_spend_tier}, hook:${h.hook_type}`
    ).join('\n');

    const ourHooksSummary = ourHooks.slice(0,5).map(h =>
      `${new Date(h.tagged_at).toISOString().slice(0,10)}: hook=${h.hook_type}, angle=${h.content_angle}`
    ).join('\n');

    let patterns: any[] = [];
    try {
      const resp = await this.claude.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 500,
        messages: [{
          role: 'user',
          content: `Analyze competitor "${competitor}" behavior for Blissal (French DTC brand).

Competitor ad history (last 15 entries):
${historySummary}

Our own creative launches:
${ourHooksSummary}

Average launch interval: ${intervals.length > 0 ? (intervals.reduce((a,b)=>a+b,0)/intervals.length).toFixed(1) : 'unknown'} days

Identify patterns and predict next action. Respond ONLY in JSON array:
[
  {
    "type": "launch_cadence"|"budget_cycle"|"seasonal_ramp"|"hook_reuse"|"platform_shift",
    "description": "Specific pattern description with evidence",
    "confidence": 0.75,
    "evidence": ["data point 1", "data point 2"],
    "next_action": "What they will likely do next",
    "next_at": "ISO date estimate or null",
    "recommended_response": "What Blissal should do before that happens"
  }
]`
        }]
      });
      const text = (resp.content[0] as any).text.replace(/```json|```/g,'').trim();
      patterns = JSON.parse(text);
    } catch { patterns = []; }

    return patterns;
  }

  private async getAlerts(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM competitive_alerts
      WHERE shop_id=$1 AND acknowledged=false
      ORDER BY CASE urgency WHEN 'now' THEN 1 WHEN 'this_week' THEN 2 ELSE 3 END,
               created_at DESC LIMIT 10`, [task.shop_id]);
    return { success: true, data: { alerts: rows } };
  }
}
