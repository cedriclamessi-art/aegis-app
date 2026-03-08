/**
 * AGENT_CREATIVE_KNOWLEDGE v3.7 — Long-term creative memory
 * Builds narrative insights from creative performance.
 * AGENT_DCT_322 consults this before proposing new angles.
 * Insights are dated, versioned, and superseded — not just overwritten.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentCreativeKnowledge extends BaseAgent {
  readonly name = 'AGENT_CREATIVE_KNOWLEDGE';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'update_knowledge':  return this.updateKnowledge(task);
      case 'query':             return this.queryKnowledge(task);
      case 'get_brief_context': return this.getBriefContext(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /**
   * Run weekly. Analyzes creative performance data and writes narrative insights.
   */
  private async updateKnowledge(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Refresh materialized view first
    await this.db.query('REFRESH MATERIALIZED VIEW creative_tag_performance');

    // Fetch top and bottom performers by tag combination
    const { rows: patterns } = await this.db.query(`
      SELECT content_angle, hook_type, has_human_face, face_gender,
             visual_style, asset_type,
             creative_count, avg_ctr, avg_roas, avg_hook_rate, total_impressions
      FROM creative_tag_performance
      WHERE shop_id = $1 AND total_impressions > 2000
      ORDER BY avg_roas DESC`, [shop_id]);

    if (patterns.length < 3) return { success: true, message: 'Insufficient data for knowledge extraction' };

    const top3    = patterns.slice(0, 3);
    const bottom3 = patterns.slice(-3);

    // Get recent winner/loser from DCT stat tests
    const { rows: recentTests } = await this.db.query(`
      SELECT dst.winner_variant_id, dst.recommendation, dst.winner_confidence,
             ct.content_angle, ct.hook_type, ct.visual_style
      FROM dct_stat_tests dst
      LEFT JOIN creative_tags ct ON ct.creative_id = dst.winner_variant_id AND ct.shop_id = dst.shop_id
      WHERE dst.shop_id = $1 AND dst.status = 'significant'
      ORDER BY dst.tested_at DESC LIMIT 5`, [shop_id]);

    // Build knowledge with LLM
    const insights = await this.extractInsights(shop_id, top3, bottom3, recentTests);

    let created = 0;
    for (const insight of insights) {
      // Check if similar insight exists (supersede it)
      const { rows: existing } = await this.db.query(`
        SELECT id FROM creative_knowledge
        WHERE shop_id = $1 AND insight_type = $2 AND $3 = ANY(tags)
          AND valid_until IS NULL
        ORDER BY created_at DESC LIMIT 1`,
        [shop_id, insight.insight_type, insight.tags[0] ?? '']);

      const { rows: [newInsight] } = await this.db.query(`
        INSERT INTO creative_knowledge (shop_id, insight_type, title, insight, evidence, tags, confidence)
        VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [shop_id, insight.insight_type, insight.title, insight.insight,
         JSON.stringify(insight.evidence), insight.tags, insight.confidence]);

      // Supersede old insight
      if (existing[0]) {
        await this.db.query(`
          UPDATE creative_knowledge SET valid_until = CURRENT_DATE, superseded_by = $1 WHERE id = $2`,
          [newInsight.id, existing[0].id]);
      }
      created++;
    }

    await this.remember(shop_id, {
      memory_key: 'creative_knowledge_updated', memory_type: 'observation',
      value: { insights_created: created, updated_at: new Date().toISOString() },
      ttl_hours: 168,
    });

    return { success: true, data: { insights_created: created } };
  }

  private async extractInsights(shopId: string, top: any[], bottom: any[], tests: any[]): Promise<any[]> {
    const topSummary = top.map(p =>
      `${p.content_angle}+${p.hook_type}+face:${p.has_human_face}(${p.face_gender})+${p.visual_style}: ROAS ${parseFloat(p.avg_roas).toFixed(2)}× CTR ${(parseFloat(p.avg_ctr)*100).toFixed(2)}% (${p.total_impressions} imp)`
    ).join('\n');

    const bottomSummary = bottom.map(p =>
      `${p.content_angle}+${p.hook_type}: ROAS ${parseFloat(p.avg_roas).toFixed(2)}×`
    ).join('\n');

    const testSummary = tests.map(t =>
      `Winner: ${t.content_angle}+${t.hook_type} (${(parseFloat(t.winner_confidence)*100).toFixed(0)}% confidence)`
    ).join('\n');

    const resp = await this.claude.messages.create({
      model: 'claude-sonnet-4-5', max_tokens: 600,
      messages: [{
        role: 'user',
        content: `Extract creative insights for Blissal (French DTC exfoliating towel brand).

Top performers:
${topSummary}

Bottom performers:
${bottomSummary}

Recent DCT winners:
${testSummary || '(none yet)'}

Generate 3 distinct insights. Respond ONLY in JSON array:
[
  {
    "insight_type": "winner_pattern"|"loser_pattern"|"audience_insight",
    "title": "Short title (max 60 chars)",
    "insight": "One specific, data-backed insight sentence. Include the numbers.",
    "tags": ["angle", "hook", ...],
    "confidence": 0.75,
    "evidence": {"roas_avg": 0, "sample_size": 0}
  }
]`
      }]
    });

    try {
      const text = (resp.content[0] as any).text.replace(/```json|```/g, '').trim();
      return JSON.parse(text);
    } catch {
      return [{
        insight_type: 'winner_pattern',
        title: `Top angle: ${top[0]?.content_angle} + ${top[0]?.hook_type}`,
        insight: `${top[0]?.content_angle} angle with ${top[0]?.hook_type} hook achieves ${parseFloat(top[0]?.avg_roas).toFixed(2)}× ROAS on ${top[0]?.total_impressions} impressions.`,
        tags: [top[0]?.content_angle, top[0]?.hook_type].filter(Boolean),
        confidence: 0.8,
        evidence: { roas_avg: top[0]?.avg_roas, sample_size: top[0]?.total_impressions },
      }];
    }
  }

  private async queryKnowledge(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { tags, insight_type } = payload as any;

    let query = `SELECT * FROM creative_knowledge WHERE shop_id = $1 AND valid_until IS NULL`;
    const params: any[] = [shop_id];
    if (tags?.length) { params.push(tags); query += ` AND tags && $${params.length}`; }
    if (insight_type) { params.push(insight_type); query += ` AND insight_type = $${params.length}`; }
    query += ` ORDER BY confidence DESC, created_at DESC LIMIT 20`;

    const { rows } = await this.db.query(query, params);
    return { success: true, data: { knowledge: rows, count: rows.length } };
  }

  /**
   * Get formatted knowledge context for DCT brief generation.
   * Called by AGENT_DCT_322 before creating a new test.
   */
  private async getBriefContext(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows } = await this.db.query(`
      SELECT title, insight, insight_type, confidence
      FROM creative_knowledge
      WHERE shop_id = $1 AND valid_until IS NULL
      ORDER BY confidence DESC, created_at DESC
      LIMIT 10`, [shop_id]);

    const context = rows.map(r =>
      `[${r.insight_type.toUpperCase()}] ${r.title}: ${r.insight}`
    ).join('\n');

    return { success: true, data: { context, count: rows.length } };
  }
}
