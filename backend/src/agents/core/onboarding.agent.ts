/**
 * AGENT_ONBOARDING v5.0
 * Self-service onboarding en 5 étapes — 15 minutes, zéro call.
 * À la fin: shadow mode lancé, premier rapport dans 7 jours.
 *
 * Étapes:
 *   1. shopify_connect    — OAuth Shopify
 *   2. meta_connect       — OAuth Meta Ads
 *   3. params_set         — budget max, CPA cible, marge produit
 *   4. shadow_launched    — démarrage du shadow mode + tier 1
 *   5. brief_sent         — envoi de la première Morning Brief
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from './llm-audit.service';

const STEPS = ['shopify_connect','meta_connect','params_set','shadow_launched','brief_sent'] as const;
type OnboardingStep = typeof STEPS[number];

export class AgentOnboarding extends BaseAgent {
  readonly name = 'AGENT_ONBOARDING';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'start':         return this.start(task);
      case 'complete_step': return this.completeStep(task);
      case 'get_status':    return this.getStatus(task);
      case 'finish':        return this.finish(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async start(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    await this.db.query(`
      INSERT INTO onboarding_sessions (shop_id, current_step)
      VALUES ($1,'shopify_connect')
      ON CONFLICT (shop_id) DO UPDATE SET
        current_step='shopify_connect', abandoned=false, completed_at=NULL`,
      [shop_id]);

    // Init tier 1
    await this.db.query(`
      INSERT INTO shop_tiers (shop_id, current_tier)
      VALUES ($1, 1) ON CONFLICT (shop_id) DO NOTHING`, [shop_id]);

    return { success: true, data: {
      step:        'shopify_connect',
      total_steps: STEPS.length,
      message:     'Onboarding démarré — connectez votre boutique Shopify',
    }};
  }

  private async completeStep(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { step, data: stepData, duration_seconds } = payload as any;

    if (!STEPS.includes(step)) return { success: false, message: `Étape invalide: ${step}` };

    const stepIndex = STEPS.indexOf(step as OnboardingStep);
    const nextStep  = STEPS[stepIndex + 1] ?? null;

    // Log the step
    await this.db.query(`
      INSERT INTO onboarding_steps (shop_id, step_name, duration_seconds, data)
      VALUES ($1,$2,$3,$4) ON CONFLICT (shop_id, step_name) DO UPDATE SET
        completed_at=NOW(), duration_seconds=$3, data=$4`,
      [shop_id, step, duration_seconds ?? null, JSON.stringify(stepData ?? {})]);

    // Update session
    await this.db.query(`
      UPDATE onboarding_sessions SET
        current_step    = $1,
        steps_completed = steps_completed || $2::text[]
      WHERE shop_id=$3`,
      [nextStep ?? step, `{${step}}`, shop_id]);

    // Étape-specific logic
    if (step === 'params_set' && stepData) {
      await this.applyParams(shop_id, stepData);
    }

    if (step === 'shadow_launched') {
      await this.launchShadowMode(shop_id);
    }

    // Finish if last step
    if (!nextStep) {
      return this.finish({ ...task, type: 'finish' });
    }

    return { success: true, data: {
      completed_step: step,
      next_step:      nextStep,
      progress:       `${stepIndex + 1}/${STEPS.length}`,
    }};
  }

  private async applyParams(shopId: string, params: any): Promise<void> {
    const { max_daily_budget, cpa_target, product_margin_pct } = params;
    await this.db.query(`
      UPDATE shops SET
        max_daily_spend     = $1,
        cpa_target          = $2,
        default_margin_pct  = $3
      WHERE id = $4`,
      [max_daily_budget, cpa_target, product_margin_pct, shopId]);

    // Init world_state
    await this.db.query(`
      INSERT INTO world_state
        (shop_id, empire_mode, max_daily_spend, cpa_target)
      VALUES ($1,'conservative',$2,$3)
      ON CONFLICT (shop_id) DO UPDATE SET
        max_daily_spend=$2, cpa_target=$3`,
      [shopId, max_daily_budget, cpa_target]);

    // Init guardrails from params
    await this.db.query(`
      INSERT INTO guardrail_configs
        (shop_id, guardrail_key, value, description)
      VALUES
        ($1,'max_daily_spend',$2,'Budget quotidien maximum'),
        ($1,'cpa_target',$3,'CPA cible'),
        ($1,'min_roas',2.0,'ROAS minimum acceptable')
      ON CONFLICT (shop_id, guardrail_key) DO UPDATE SET value=EXCLUDED.value`,
      [shopId, max_daily_budget, cpa_target]);
  }

  private async launchShadowMode(shopId: string): Promise<void> {
    // Active shadow mode pour tous les agents
    await this.db.query(`
      UPDATE agent_schedule SET enabled=true
      WHERE agent_name IN (
        'AGENT_SHADOW_MODE','AGENT_ANOMALY','AGENT_PIXEL_HEALTH',
        'AGENT_FORECASTER','AGENT_RFM','AGENT_HEALTH_PROBES'
      )`, []);

    await this.emit('shadow_mode:start', { shop_id: shopId });
    await this.remember(shopId, {
      memory_key: 'onboarding_shadow_start', memory_type: 'observation',
      value: {
        started_at: new Date().toISOString(),
        message: 'Shadow mode lancé — AEGIS observe toutes vos décisions publicitaires sans intervenir.',
        severity: 'info',
      },
      ttl_hours: 24,
    });
  }

  private async finish(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const startedAt = await this.db.query(
      `SELECT started_at FROM onboarding_sessions WHERE shop_id=$1`, [shop_id]);
    const durationMinutes = startedAt.rows[0]
      ? Math.round((Date.now() - new Date(startedAt.rows[0].started_at).getTime()) / 60000)
      : null;

    await this.db.query(`
      UPDATE onboarding_sessions SET
        completed_at               = NOW(),
        current_step               = 'completed',
        time_to_complete_minutes   = $1
      WHERE shop_id=$2`, [durationMinutes, shop_id]);

    // Marque onboarding_complete=1 dans les métriques tier
    await this.db.query(`
      UPDATE shop_tiers SET updated_at=NOW() WHERE shop_id=$1`, [shop_id]);

    // Génère le premier brief personnalisé
    const llm = new LLMAuditService(this.db);
    let welcomeMessage = '';
    try {
      const { rows: [params] } = await this.db.query(
        `SELECT max_daily_spend, cpa_target FROM shops WHERE id=$1`, [shop_id]);
      const { text } = await llm.call({
        shop_id, agent_name: this.name, call_purpose: 'onboarding_welcome',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Rédige un message de bienvenue pour le premier rapport AEGIS.
Budget configuré: €${params?.max_daily_spend ?? '?'}/jour | CPA cible: €${params?.cpa_target ?? '?'}
Durée onboarding: ${durationMinutes ?? '?'} minutes

AEGIS est en Palier 1 (Démarrage) — il observe tout sans intervenir pendant 7 jours.
Le premier rapport Shadow arrive dans 7 jours avec la comparaison: "voici ce que j'aurais fait différemment."

Message court (3 phrases), ton direct et professionnel.`
        }]
      });
      welcomeMessage = text;
    } catch {
      welcomeMessage = `AEGIS est configuré et en Palier 1 — Démarrage. Pendant 7 jours, il observe votre compte en silence et enregistre ce qu'il aurait fait différemment. Le premier rapport Shadow vous sera envoyé dans 7 jours.`;
    }

    await this.emit('delivery:onboarding_complete', {
      shop_id, welcome_message: welcomeMessage, duration_minutes: durationMinutes,
    });

    await this.remember(shop_id, {
      memory_key: 'onboarding_complete', memory_type: 'observation',
      value: {
        completed_at: new Date().toISOString(),
        duration_minutes: durationMinutes,
        message: welcomeMessage,
        severity: 'info',
      },
      ttl_hours: 48,
    });

    return { success: true, data: {
      completed:         true,
      duration_minutes:  durationMinutes,
      current_tier:      1,
      next_milestone:    'Shadow mode pendant 7 jours → rapport comparatif',
      welcome_message:   welcomeMessage,
    }};
  }

  private async getStatus(task: AgentTask): Promise<AgentResult> {
    const { rows: [session] } = await this.db.query(
      `SELECT * FROM onboarding_sessions WHERE shop_id=$1`, [task.shop_id]);
    const { rows: steps } = await this.db.query(
      `SELECT step_name, completed_at, duration_seconds FROM onboarding_steps WHERE shop_id=$1`, [task.shop_id]);

    const completed  = steps.map((s: any) => s.step_name);
    const remaining  = STEPS.filter(s => !completed.includes(s));
    const progressPct = Math.round(completed.length / STEPS.length * 100);

    return { success: true, data: {
      session, steps, completed, remaining,
      progress_pct: progressPct,
      is_done: session?.completed_at != null,
    }};
  }
}
