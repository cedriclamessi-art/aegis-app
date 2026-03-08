/**
 * AGENT_DCT_ITERATION v3.7 — Auto DCT refresh on fatigue
 * Detects winner fatigue → queues next DCT iteration inheriting winner tags.
 * Compound learning: each iteration knows what the previous winner looked like.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import Anthropic from '@anthropic-ai/sdk';

export class AgentDCTIteration extends BaseAgent {
  readonly name = 'AGENT_DCT_ITERATION';
  private claude = new Anthropic();

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'check_fatigue':  return this.checkFatigue(task);
      case 'generate_next':  return this.generateNextDCT(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async checkFatigue(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Find active DCTs where winner is showing fatigue signals
    const { rows: fatigued } = await this.db.query(`
      SELECT d.id AS dct_id, d.winner_variant_id,
             m.frequency, m.ctr, m.ctr_baseline,
             ct.content_angle, ct.hook_type, ct.has_human_face,
             ct.face_gender, ct.visual_style
      FROM dct_experiments d
      JOIN ad_metrics_latest m ON m.entity_id = d.winner_variant_id AND m.shop_id = d.shop_id
      LEFT JOIN creative_tags ct ON ct.creative_id = d.winner_variant_id AND ct.shop_id = d.shop_id
      WHERE d.shop_id = $1
        AND d.status = 'scaling'
        AND d.winner_variant_id IS NOT NULL
        AND (m.frequency > 3.5 OR m.ctr < m.ctr_baseline * 0.80)
        AND NOT EXISTS (
          SELECT 1 FROM dct_iteration_queue q
          WHERE q.parent_dct_id = d.id AND q.status IN ('pending','generating','launched')
        )
      LIMIT 5`, [shop_id]);

    const queued = [];
    for (const dct of fatigued) {
      const reason = dct.frequency > 3.5
        ? `Frequency ${parseFloat(dct.frequency).toFixed(1)} exceeds 3.5`
        : `CTR dropped ${((1 - dct.ctr / dct.ctr_baseline) * 100).toFixed(0)}% vs baseline`;

      const winnerTags = {
        content_angle:  dct.content_angle,
        hook_type:      dct.hook_type,
        has_human_face: dct.has_human_face,
        face_gender:    dct.face_gender,
        visual_style:   dct.visual_style,
      };

      const { rows: [q] } = await this.db.query(`
        INSERT INTO dct_iteration_queue (shop_id, parent_dct_id, trigger_reason, winner_tags)
        VALUES ($1,$2,$3,$4) RETURNING id`, [shop_id, dct.dct_id, reason, JSON.stringify(winnerTags)]);

      await this.remember(shop_id, {
        memory_key: `dct_fatigue_${dct.dct_id}`, memory_type: 'warning',
        value: { dct_id: dct.dct_id, reason, message: `DCT winner fatiguing: ${reason}`, severity: 'warning' },
        ttl_hours: 24,
      });

      queued.push({ dct_id: dct.dct_id, queue_id: q.id, reason });
    }

    // Generate next DCTs for pending items
    if (queued.length > 0) {
      await this.emit('dispatch', { agent: 'AGENT_DCT_ITERATION', task: 'generate_next', shop_id });
    }

    return { success: true, data: { fatigued: fatigued.length, queued } };
  }

  private async generateNextDCT(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const { rows: pending } = await this.db.query(`
      SELECT q.*, dct.campaign_id, dct.budget_daily
      FROM dct_iteration_queue q
      JOIN dct_experiments dct ON dct.id = q.parent_dct_id
      WHERE q.shop_id = $1 AND q.status = 'pending'
      ORDER BY q.created_at ASC LIMIT 3`, [shop_id]);

    const launched = [];
    for (const item of pending) {
      const tags = item.winner_tags as any;

      // Consult creative knowledge base before generating
      const { rows: knowledge } = await this.db.query(`
        SELECT title, insight FROM creative_knowledge
        WHERE shop_id = $1 AND $2 = ANY(tags)
        ORDER BY confidence DESC LIMIT 5`, [shop_id, tags.content_angle ?? 'transformation']);

      const knowledgeContext = knowledge.map(k => `- ${k.title}: ${k.insight}`).join('\n');

      // Generate new DCT brief using Claude, informed by winner tags + knowledge base
      const resp = await this.claude.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 400,
        messages: [{
          role: 'user',
          content: `AEGIS DCT iteration for Blissal (French exfoliating towel brand).

Previous winner profile:
- Content angle: ${tags.content_angle}
- Hook type: ${tags.hook_type}
- Has human face: ${tags.has_human_face}
- Face gender: ${tags.face_gender}
- Visual style: ${tags.visual_style}

Fatigue reason: ${item.trigger_reason}

Creative knowledge base:
${knowledgeContext || '(no prior knowledge yet)'}

Generate a new DCT brief with 3 variants that:
1. Keep the winning angle (${tags.content_angle}) but test new hooks
2. Address the fatigue by introducing fresh visual elements
3. Apply the knowledge base learnings

Respond in JSON:
{
  "brief": "one-sentence campaign objective",
  "variants": [
    {"name": "...", "hook": "...", "angle": "...", "visual_direction": "...", "copy_direction": "..."}
  ]
}`
        }]
      });

      let brief: any = {};
      try {
        const text = (resp.content[0] as any).text.replace(/```json|```/g, '').trim();
        brief = JSON.parse(text);
      } catch {
        brief = { brief: 'Auto-generated iteration', variants: [] };
      }

      // Update queue status
      await this.db.query(`
        UPDATE dct_iteration_queue SET status = 'generating', updated_at = NOW() WHERE id = $1`, [item.id]);

      // Emit DCT creation request
      await this.emit('dct:create', {
        shop_id, parent_dct_id: item.parent_dct_id,
        campaign_id: item.campaign_id, budget_daily: item.budget_daily,
        brief, iteration_queue_id: item.id,
      });

      launched.push({ queue_id: item.id, brief: brief.brief });
    }

    return { success: true, data: { launched } };
  }
}
