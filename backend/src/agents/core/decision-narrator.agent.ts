/**
 * AGENT_DECISION_NARRATOR v4.1
 * Translates every AEGIS decision into plain French.
 * "AGENT_SCALE executed budget_scale adset_23847 delta=+42% confidence=0.87"
 * becomes:
 * "J'ai augmenté le budget de la campagne Serviette Bleue de 42% —
 *  elle affichait un ROAS de 3.8× depuis 48h, au-dessus du seuil de 2.5×."
 *
 * Runs after each agent execution, in the background.
 * Powers: Decision Inspector, Morning Brief, Monthly Report.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from './llm-audit.service';

export class AgentDecisionNarrator extends BaseAgent {
  readonly name = 'AGENT_DECISION_NARRATOR';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'narrate_decision':  return this.narrateDecision(task);
      case 'narrate_batch':     return this.narrateBatch(task);
      case 'get_feed':          return this.getFeed(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Called after a single agent decision is executed. */
  private async narrateDecision(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { decision_id } = payload as any;

    const { rows } = await this.db.query(`
      SELECT ad.*, dn.narrative_fr
      FROM agent_decisions ad
      LEFT JOIN decision_narratives dn ON dn.decision_id = ad.id
      WHERE ad.id=$1 AND ad.shop_id=$2`, [decision_id, shop_id]);

    if (!rows[0]) return { success: false, message: 'Decision not found' };
    if (rows[0].narrative_fr) return { success: true, data: { narrative: rows[0].narrative_fr } }; // already done

    const d = rows[0];
    const narrative = await this.generateNarrative(shop_id, d);

    await this.db.query(`
      INSERT INTO decision_narratives (shop_id, decision_id, narrative_fr)
      VALUES ($1,$2,$3) ON CONFLICT (decision_id) DO UPDATE SET narrative_fr=$3`,
      [shop_id, decision_id, narrative]);

    return { success: true, data: { narrative } };
  }

  /**
   * Narrates all un-narrated decisions from the last 24h.
   * Runs every hour in background.
   */
  private async narrateBatch(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const { rows: pending } = await this.db.query(`
      SELECT ad.* FROM agent_decisions ad
      LEFT JOIN decision_narratives dn ON dn.decision_id = ad.id
      WHERE ad.shop_id=$1
        AND ad.executed = true
        AND ad.created_at > NOW() - INTERVAL '24 hours'
        AND dn.id IS NULL
      ORDER BY ad.created_at DESC
      LIMIT 20`, [shop_id]);

    let narrated = 0;
    for (const d of pending) {
      try {
        const narrative = await this.generateNarrative(shop_id, d);
        await this.db.query(`
          INSERT INTO decision_narratives (shop_id, decision_id, narrative_fr)
          VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
          [shop_id, d.id, narrative]);
        narrated++;
      } catch { /* skip — non-critical */ }
    }

    return { success: true, data: { pending: pending.length, narrated } };
  }

  private async generateNarrative(shopId: string, d: any): Promise<string> {
    const decision  = d.decision_made  as any;
    const worldState = d.world_state_snapshot as any;

    // Build a structured context for the LLM
    const context = this.buildContext(d, decision, worldState);

    const llm = new LLMAuditService(this.db);
    try {
      const { text } = await llm.call({
        shop_id:       shopId,
        agent_name:    this.name,
        call_purpose:  'decision_narrative',
        max_tokens:    120,
        messages: [{
          role: 'user',
          content: `Traduis cette décision AEGIS en français simple (1-2 phrases, ton factuel, pas de jargon technique):

Agent: ${d.agent_name}
Action: ${d.decision_type}
Détail: ${context}
Confiance: ${Math.round((d.confidence ?? 0) * 100)}%

Exemple de bon format: "J'ai augmenté le budget de la campagne Serviette Bleue de 42% car elle affichait un ROAS de 3.8× depuis 48h, au-dessus du seuil de 2.5×."
Exemple de mauvais format: "AGENT_SCALE a exécuté budget_scale sur adset_23847 avec delta=+42%."`,
        }],
      });
      return text.trim();
    } catch {
      // Fallback to template-based narrative
      return this.templateNarrative(d, decision, worldState);
    }
  }

  private buildContext(d: any, decision: any, ws: any): string {
    const parts: string[] = [];

    switch (d.decision_type) {
      case 'budget_scale':
      case 'budget_increase':
        if (decision?.old_budget && decision?.new_budget) {
          const pct = Math.round(((decision.new_budget - decision.old_budget) / decision.old_budget) * 100);
          parts.push(`Budget: €${decision.old_budget} → €${decision.new_budget} (${pct > 0 ? '+' : ''}${pct}%)`);
        }
        if (ws?.roas_24h) parts.push(`ROAS: ${parseFloat(ws.roas_24h).toFixed(2)}×`);
        if (ws?.cpa_24h) parts.push(`CPA: €${parseFloat(ws.cpa_24h).toFixed(2)}`);
        break;

      case 'ad_kill':
      case 'campaign_pause':
        if (ws?.cpa_24h) parts.push(`CPA: €${parseFloat(ws.cpa_24h).toFixed(2)}`);
        if (decision?.reason) parts.push(`Raison: ${decision.reason}`);
        break;

      case 'price_apply':
        if (decision?.old_price && decision?.new_price)
          parts.push(`Prix: €${decision.old_price} → €${decision.new_price}`);
        if (decision?.winner_variant) parts.push(`Variante gagnante: ${decision.winner_variant}`);
        break;

      case 'dct_launch':
        if (decision?.creative_count) parts.push(`${decision.creative_count} créatifs`);
        if (decision?.content_angle)  parts.push(`Angle: ${decision.content_angle}`);
        break;

      case 'rfm_sync':
        if (decision?.segments_synced) parts.push(`${decision.segments_synced} segments`);
        if (decision?.records_synced)  parts.push(`${decision.records_synced} contacts`);
        break;

      default:
        parts.push(JSON.stringify(decision ?? {}).slice(0, 150));
    }

    return parts.join(', ');
  }

  /** Template-based fallback if LLM unavailable. */
  private templateNarrative(d: any, decision: any, ws: any): string {
    const agentFR: Record<string, string> = {
      AGENT_SCALE:      'J\'ai augmenté le budget',
      AGENT_STOP_LOSS:  'J\'ai arrêté',
      AGENT_DAYPARTING: 'J\'ai ajusté le budget (dayparting)',
      AGENT_PRICING:    'J\'ai appliqué le prix gagnant',
      AGENT_KLAVIYO:    'J\'ai synchronisé les segments',
      AGENT_DCT:        'J\'ai lancé un DCT',
      AGENT_ANOMALY:    'J\'ai détecté et signalé une anomalie',
    };

    const base    = agentFR[d.agent_name] ?? `${d.agent_name} a exécuté ${d.decision_type}`;
    const subject = d.subject_id ? ` sur ${d.subject_id}` : '';
    const roas    = ws?.roas_24h ? ` (ROAS ${parseFloat(ws.roas_24h).toFixed(2)}×)` : '';

    return `${base}${subject}${roas} — confiance ${Math.round((d.confidence ?? 0) * 100)}%.`;
  }

  /** Returns last 50 narrated decisions as a human-readable activity feed. */
  private async getFeed(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT
        ad.agent_name, ad.decision_type, ad.confidence, ad.created_at,
        dn.narrative_fr
      FROM agent_decisions ad
      JOIN decision_narratives dn ON dn.decision_id = ad.id
      WHERE ad.shop_id=$1 AND ad.executed=true
      ORDER BY ad.created_at DESC LIMIT 50`, [task.shop_id]);

    return { success: true, data: { feed: rows } };
  }
}
