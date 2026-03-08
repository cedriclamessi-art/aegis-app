/**
 * AGENT_CONTENT_ORCHESTRATOR v7.0 — Hack #92
 * Séquençage coordonné contenu/promo sur 4 semaines cycliques.
 * Évite de toujours être en mode "promo" ce qui fatigue l'audience
 * et détruit la perception de valeur de la marque.
 *
 * Cycle :
 *   S1 — Éducation     : contenu, pas de promo, budget réduit (×0.7)
 *   S2 — Preuve sociale : UGC, avis, résultats, budget normal (×1.0)
 *   S3 — Urgence        : offre limitée, scaling (×1.4)
 *   S4 — Fidélisation   : contenu retention, email, budget bas (×0.6)
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { tierGate } from '../core/tier-gate.middleware';
import { LLMAuditService } from '../core/llm-audit.service';

const CYCLE: Array<{ type: string; budget_mult: number; meta_objective: string; email: string; theme: string }> = [
  {
    type:             'education',
    budget_mult:      0.70,
    meta_objective:   'BRAND_AWARENESS',
    email:            'sequence_education',
    theme:            'Comment utiliser / bénéfices produit',
  },
  {
    type:             'social_proof',
    budget_mult:      1.00,
    meta_objective:   'CONVERSIONS',
    email:            'sequence_social_proof',
    theme:            'Avis clients, avant/après, UGC',
  },
  {
    type:             'urgency',
    budget_mult:      1.40,
    meta_objective:   'CONVERSIONS',
    email:            'sequence_urgency',
    theme:            'Offre limitée, stock limité, compte à rebours',
  },
  {
    type:             'retention',
    budget_mult:      0.60,
    meta_objective:   'RETARGETING',
    email:            'sequence_retention',
    theme:            'Contenu fidélisation, programme points, nouveautés',
  },
];

export class AgentContentOrchestrator extends BaseAgent {
  readonly name = 'AGENT_CONTENT_ORCHESTRATOR';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'plan_week':    return this.planWeek(task);
      case 'apply_week':   return this.applyWeek(task);
      case 'get_calendar': return this.getCalendar(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Planifie la semaine en cours dans le cycle. */
  private async planWeek(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Trouve la position dans le cycle
    const weekStart = this.getWeekStart();
    const { rows: [last] } = await this.db.query(`
      SELECT sequence_position FROM content_promo_calendar
      WHERE shop_id=$1 ORDER BY week_start DESC LIMIT 1`, [shop_id]);

    const lastPos  = last?.sequence_position ?? 0;
    const nextPos  = (lastPos % 4) + 1;  // 1→2→3→4→1→...
    const template = CYCLE[nextPos - 1];

    // Vérifie événements saisonniers — peut override le cycle
    const { rows: events } = await this.db.query(`
      SELECT event_name, phase, budget_multiplier FROM seasonal_event_regions
      WHERE shop_id=$1 AND region='FR'
        AND phase_start <= $2 AND phase_end >= $2
      ORDER BY budget_multiplier DESC LIMIT 1`, [shop_id, weekStart]);

    let finalMult  = template.budget_mult;
    let finalTheme = template.theme;
    let overridden = false;

    if (events[0]) {
      // Événement saisonnier prioritaire sur le cycle normal
      finalMult  = Math.max(template.budget_mult, parseFloat(events[0].budget_multiplier));
      finalTheme = `${events[0].event_name} — ${template.theme}`;
      overridden = true;
    }

    // Génère le CTA suggéré via LLM
    const llm = new LLMAuditService(this.db);
    let suggestedCta = '';
    try {
      const { text } = await llm.call({
        shop_id, agent_name: this.name, call_purpose: 'content_cta',
        max_tokens: 80,
        messages: [{
          role: 'user',
          content: `Semaine ${nextPos}/4 du cycle marketing AEGIS pour Blissal (serviettes exfoliantes FR).
Type: ${template.type} | Thème: ${finalTheme}
Budget: ×${finalMult} par rapport au budget de base.
Rédige UN CTA court (5-8 mots) en français pour cette semaine.`
        }]
      });
      suggestedCta = text.trim().replace(/"/g, '');
    } catch {
      const ctas: Record<string, string> = {
        education:    'Découvrez les bienfaits de l\'exfoliation',
        social_proof: 'Rejoignez nos clientes satisfaites',
        urgency:      'Profitez de l\'offre — stock limité',
        retention:    'Merci de nous faire confiance',
      };
      suggestedCta = ctas[template.type] ?? '';
    }

    await this.db.query(`
      INSERT INTO content_promo_calendar
        (shop_id, week_start, sequence_type, sequence_position,
         meta_campaign_objective, meta_budget_multiplier,
         email_sequence_name, organic_content_theme, suggested_cta)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT (shop_id, week_start) DO UPDATE SET
        sequence_type=$3, sequence_position=$4,
        meta_campaign_objective=$5, meta_budget_multiplier=$6,
        email_sequence_name=$7, organic_content_theme=$8, suggested_cta=$9`,
      [shop_id, weekStart, template.type, nextPos,
       template.meta_objective, finalMult,
       template.email, finalTheme, suggestedCta]);

    await this.remember(shop_id, {
      memory_key: `content_week_${weekStart}`,
      memory_type: 'observation',
      value: {
        week: weekStart, phase: template.type, position: nextPos,
        budget_multiplier: finalMult, cta: suggestedCta,
        seasonal_override: overridden,
        message: `Semaine ${nextPos}/4 — ${template.type.toUpperCase()} | Budget ×${finalMult} | "${suggestedCta}"`,
        severity: 'info',
      },
      ttl_hours: 168,
    });

    return { success: true, data: {
      week_start: weekStart, phase: template.type, position: nextPos,
      budget_multiplier: finalMult, seasonal_override: overridden,
      suggested_cta: suggestedCta, meta_objective: template.meta_objective,
    }};
  }

  /** Applique le plan de la semaine — ajuste les budgets Meta, active la séquence email. */
  private async applyWeek(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const gate = await tierGate(this.db, shop_id, this.name, 30);

    const weekStart = this.getWeekStart();
    const { rows: [plan] } = await this.db.query(
      `SELECT * FROM content_promo_calendar WHERE shop_id=$1 AND week_start=$2`,
      [shop_id, weekStart]);

    if (!plan || plan.applied) {
      return { success: true, data: { skipped: true, reason: 'Already applied or no plan' } };
    }

    if (gate.verdict === 'shadow') {
      await this.db.query(`
        UPDATE content_promo_calendar SET applied=true, applied_at=NOW()
        WHERE shop_id=$1 AND week_start=$2`, [shop_id, weekStart]);
      return { success: true, data: { mode: 'shadow', plan } };
    }

    // Applique le multiplicateur de budget sur toutes les campagnes actives
    await this.emit('meta:adjust_budget_multiplier', {
      shop_id,
      multiplier:     plan.meta_budget_multiplier,
      objective:      plan.meta_campaign_objective,
      week:           weekStart,
      reason:         `Orchestration ${plan.sequence_type} — semaine ${plan.sequence_position}/4`,
    });

    // Active la séquence email correspondante dans Klaviyo
    await this.emit('klaviyo:activate_sequence', {
      shop_id,
      sequence_name: plan.email_sequence_name,
      week:          weekStart,
    });

    // Brief TikTok Organic avec le thème de la semaine
    await this.emit('organic:set_weekly_theme', {
      shop_id, theme: plan.organic_content_theme, cta: plan.suggested_cta,
    });

    await this.db.query(`
      UPDATE content_promo_calendar SET applied=true, applied_at=NOW()
      WHERE shop_id=$1 AND week_start=$2`, [shop_id, weekStart]);

    return { success: true, data: {
      applied: true, phase: plan.sequence_type,
      budget_multiplier: plan.meta_budget_multiplier,
      mode: gate.agent_mode,
    }};
  }

  private async getCalendar(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM content_promo_calendar WHERE shop_id=$1
      ORDER BY week_start DESC LIMIT 12`, [task.shop_id]);
    return { success: true, data: { calendar: rows } };
  }

  private getWeekStart(): string {
    const d = new Date();
    d.setDate(d.getDate() - d.getDay() + 1); // lundi
    return d.toISOString().slice(0, 10);
  }
}
