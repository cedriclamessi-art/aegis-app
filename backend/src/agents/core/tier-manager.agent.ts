/**
 * AGENT_TIER_MANAGER v5.0
 * Évalue quotidiennement si un shop peut progresser au palier suivant.
 * Applique automatiquement la progression si toutes les conditions sont remplies.
 * Peut aussi rétrograder en cas de dégradation sévère (anomalie critique persistante).
 *
 * Paliers :
 *   1 — Démarrage  : tout en shadow, AEGIS observe
 *   2 — Validation : stop-loss auto, reste suggest
 *   3 — Croissance : semi-auto < €200/j
 *   4 — Scale      : tout auto, budget illimité
 *   5 — Empire     : mode empire unlocked
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from './llm-audit.service';

interface TierMetrics {
  shadow_agreement_rate:    number;
  days_live:                number;
  avg_roas_30d:             number;
  days_no_critical_anomaly: number;
  decisions_executed_30d:   number;
  total_revenue_aegis:      number;
  nps_score:                number;
  health_probes_passing:    number;
  onboarding_complete:      number;
  constitution_veto_rate:   number;
}

export class AgentTierManager extends BaseAgent {
  readonly name = 'AGENT_TIER_MANAGER';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'evaluate':      return this.evaluate(task);
      case 'get_status':    return this.getStatus(task);
      case 'force_tier':    return this.forceTier(task);
      case 'get_config':    return this.getTierConfig(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /**
   * Évaluation quotidienne.
   * 1. Collecte les métriques actuelles
   * 2. Vérifie les conditions d'unlock
   * 3. Promeut ou rétrograde si nécessaire
   * 4. Met à jour la config des agents selon le nouveau tier
   */
  private async evaluate(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Récupère ou crée le tier actuel
    await this.db.query(`
      INSERT INTO shop_tiers (shop_id, current_tier)
      VALUES ($1, 1) ON CONFLICT (shop_id) DO NOTHING`, [shop_id]);

    const { rows: [tier] } = await this.db.query(
      `SELECT * FROM shop_tiers WHERE shop_id=$1`, [shop_id]);

    const currentTier = tier.current_tier as number;
    const metrics     = await this.collectMetrics(shop_id, tier);

    // Mise à jour des métriques dans shop_tiers
    await this.db.query(`
      UPDATE shop_tiers SET
        shadow_agreement_rate     = $1,
        decisions_executed_30d    = $2,
        avg_roas_30d              = $3,
        days_no_critical_anomaly  = $4,
        total_revenue_aegis       = $5,
        updated_at                = NOW()
      WHERE shop_id = $6`,
      [metrics.shadow_agreement_rate, metrics.decisions_executed_30d,
       metrics.avg_roas_30d, metrics.days_no_critical_anomaly,
       metrics.total_revenue_aegis, shop_id]);

    // Vérifie si le shop peut monter de tier
    let newTier = currentTier;
    let trigger = '';

    if (currentTier < 5) {
      const { canPromote, failedConditions, triggerKey } =
        await this.checkUnlockConditions(shop_id, currentTier, currentTier + 1, metrics);

      if (canPromote) {
        newTier  = currentTier + 1;
        trigger  = triggerKey;
      }
    }

    // Vérifie si le shop doit rétrograder (anomalie critique sur 48h)
    if (currentTier >= 3 && metrics.days_no_critical_anomaly < 2) {
      newTier = Math.max(2, currentTier - 1);
      trigger = 'critical_anomaly_regression';
    }

    if (newTier !== currentTier) {
      await this.applyTierTransition(shop_id, currentTier, newTier, trigger, metrics);
    }

    return {
      success: true,
      data: {
        current_tier:  newTier,
        previous_tier: currentTier,
        promoted:      newTier > currentTier,
        regressed:     newTier < currentTier,
        metrics,
        trigger: newTier !== currentTier ? trigger : null,
      }
    };
  }

  private async collectMetrics(shopId: string, tier: any): Promise<TierMetrics> {

    // Shadow agreement rate
    const { rows: shadow } = await this.db.query(`
      SELECT AVG(agreement_rate) AS rate FROM shadow_mode_reports
      WHERE shop_id=$1 AND generated_at > NOW() - INTERVAL '14 days'`, [shopId]);

    // Days live
    const { rows: age } = await this.db.query(`
      SELECT EXTRACT(EPOCH FROM (NOW() - MIN(created_at)))/86400 AS days
      FROM agent_decisions WHERE shop_id=$1`, [shopId]);

    // ROAS 30d
    const { rows: roas } = await this.db.query(`
      SELECT AVG(roas) AS r FROM ad_metrics
      WHERE shop_id=$1 AND recorded_at > NOW() - INTERVAL '30 days'`, [shopId]);

    // Days no critical anomaly
    const { rows: anomaly } = await this.db.query(`
      SELECT COALESCE(
        EXTRACT(EPOCH FROM (NOW() - MAX(created_at)))/86400, 999
      ) AS days
      FROM anomalies WHERE shop_id=$1 AND severity='critical'`, [shopId]);

    // Decisions executed 30d
    const { rows: decisions } = await this.db.query(`
      SELECT COUNT(*) AS n FROM agent_decisions
      WHERE shop_id=$1 AND executed=true AND created_at > NOW() - INTERVAL '30 days'`, [shopId]);

    // Revenue attributed to AEGIS
    const { rows: roi } = await this.db.query(`
      SELECT COALESCE(SUM(total_revenue_attributed),0) AS rev
      FROM aegis_roi_summary WHERE shop_id=$1`, [shopId]);

    // NPS from verbatims
    const { rows: nps } = await this.db.query(`
      SELECT AVG(nps_score)*10 AS score FROM customer_verbatims
      WHERE shop_id=$1 AND responded_at > NOW() - INTERVAL '30 days'
        AND nps_score IS NOT NULL`, [shopId]);

    // Health probes passing rate
    const { rows: probes } = await this.db.query(`
      SELECT
        COUNT(*) FILTER (WHERE last_passed) AS passed,
        COUNT(*) AS total
      FROM health_probe_status`, []);

    const totalProbes  = parseInt(probes[0]?.total ?? 8);
    const passedProbes = parseInt(probes[0]?.passed ?? 7);

    // Onboarding complete
    const { rows: onboard } = await this.db.query(`
      SELECT completed_at IS NOT NULL AS done
      FROM onboarding_sessions WHERE shop_id=$1`, [shopId]);

    // Constitution veto rate
    const { rows: veto } = await this.db.query(`
      SELECT
        COUNT(*) FILTER (WHERE verdict='vetoed')::numeric / NULLIF(COUNT(*),0) AS rate
      FROM constitution_reviews
      WHERE shop_id=$1 AND reviewed_at > NOW() - INTERVAL '30 days'`, [shopId]);

    return {
      shadow_agreement_rate:    parseFloat(shadow[0]?.rate ?? 0),
      days_live:                parseFloat(age[0]?.days ?? 0),
      avg_roas_30d:             parseFloat(roas[0]?.r ?? 0),
      days_no_critical_anomaly: parseFloat(anomaly[0]?.days ?? 999),
      decisions_executed_30d:   parseInt(decisions[0]?.n ?? 0),
      total_revenue_aegis:      parseFloat(roi[0]?.rev ?? 0),
      nps_score:                parseFloat(nps[0]?.score ?? 0),
      health_probes_passing:    totalProbes > 0 ? passedProbes / totalProbes : 0,
      onboarding_complete:      onboard[0]?.done ? 1 : 0,
      constitution_veto_rate:   parseFloat(veto[0]?.rate ?? 0),
    };
  }

  private async checkUnlockConditions(
    shopId: string, fromTier: number, toTier: number, metrics: TierMetrics
  ): Promise<{ canPromote: boolean; failedConditions: string[]; triggerKey: string }> {

    const { rows: conditions } = await this.db.query(`
      SELECT * FROM tier_unlock_conditions
      WHERE from_tier=$1 AND to_tier=$2`, [fromTier, toTier]);

    const failed: string[] = [];
    let   lastPassed = '';

    for (const cond of conditions) {
      const value = (metrics as any)[cond.condition_key] ?? 0;
      let passes  = false;

      switch (cond.operator) {
        case '>=': passes = value >= cond.threshold; break;
        case '<=': passes = value <= cond.threshold; break;
        case '>':  passes = value >  cond.threshold; break;
        case '<':  passes = value <  cond.threshold; break;
        case '=':  passes = value === cond.threshold; break;
      }

      if (!passes && cond.mandatory) failed.push(cond.condition_key);
      if  (passes) lastPassed = cond.condition_key;
    }

    return { canPromote: failed.length === 0, failedConditions: failed, triggerKey: lastPassed };
  }

  /**
   * Applique la transition de tier :
   * 1. Met à jour shop_tiers
   * 2. Log la transition
   * 3. Émet l'événement
   * 4. Dépose la mémoire
   * 5. Génère le message d'annonce en français
   */
  private async applyTierTransition(
    shopId: string, from: number, to: number, trigger: string, metrics: TierMetrics
  ): Promise<void> {

    const tierNames: Record<number, string> = {
      1: 'Démarrage', 2: 'Validation', 3: 'Croissance', 4: 'Scale', 5: 'Empire'
    };

    // Update shop_tiers
    await this.db.query(`
      UPDATE shop_tiers SET
        current_tier    = $1,
        tier_entered_at = NOW(),
        tier_unlocked_by = 'auto',
        tier_history = tier_history || $2::jsonb
      WHERE shop_id = $3`,
      [to, JSON.stringify({ tier: from, exited: new Date().toISOString(), trigger }), shopId]);

    // Log transition
    await this.db.query(`
      INSERT INTO tier_transitions (shop_id, from_tier, to_tier, triggered_by, metrics_at_transition)
      VALUES ($1,$2,$3,$4,$5)`,
      [shopId, from, to, trigger, JSON.stringify(metrics)]);

    // Génère annonce FR
    const llm = new LLMAuditService(this.db);
    let announcement = '';
    try {
      const { text } = await llm.call({
        shop_id: shopId, agent_name: this.name, call_purpose: 'tier_announcement',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `AEGIS vient de passer du palier ${from} (${tierNames[from]}) au palier ${to} (${tierNames[to]}).
Condition déclenchante: ${trigger}.
ROAS: ${metrics.avg_roas_30d.toFixed(2)}×, Shadow rate: ${(metrics.shadow_agreement_rate*100).toFixed(0)}%.

Rédige une annonce courte (2-3 phrases) pour la Morning Brief du lendemain.
Ton: confiant, factuel. Explique ce que ça change concrètement pour l'utilisateur.`
        }]
      });
      announcement = text;
    } catch {
      const promoted = to > from;
      announcement = promoted
        ? `AEGIS est passé au Palier ${to} — ${tierNames[to]}. ${this.getTierDescription(to)}`
        : `AEGIS est revenu au Palier ${to} suite à une anomalie critique. La surveillance est renforcée.`;
    }

    await this.remember(shopId, {
      memory_key:   `tier_transition_${Date.now()}`,
      memory_type:  to > from ? 'opportunity' : 'warning',
      value: {
        from_tier: from, to_tier: to,
        from_name: tierNames[from], to_name: tierNames[to],
        trigger, announcement,
        message:   announcement,
        severity:  to > from ? 'info' : 'warning',
      },
      ttl_hours: 48,
    });

    await this.emit('tier:transition', {
      shop_id: shopId, from_tier: from, to_tier: to,
      promoted: to > from, trigger, announcement,
    });
  }

  private getTierDescription(tier: number): string {
    const desc: Record<number, string> = {
      2: 'Les campagnes sous-performantes seront coupées automatiquement.',
      3: 'Les décisions budgétaires < €200/j sont maintenant automatiques.',
      4: 'Tous les agents tournent en plein automatique, budget illimité dans les guardrails.',
      5: 'Mode Empire activé — AEGIS opère à pleine autonomie.',
    };
    return desc[tier] ?? '';
  }

  private async getStatus(task: AgentTask): Promise<AgentResult> {
    const { rows: [tier] } = await this.db.query(
      `SELECT * FROM shop_tiers WHERE shop_id=$1`, [task.shop_id]);

    const { rows: transitions } = await this.db.query(`
      SELECT * FROM tier_transitions WHERE shop_id=$1
      ORDER BY transitioned_at DESC LIMIT 10`, [task.shop_id]);

    // Next tier conditions
    const currentTier = tier?.current_tier ?? 1;
    const { rows: nextConditions } = await this.db.query(`
      SELECT *, $2 AS current_value FROM tier_unlock_conditions
      WHERE from_tier=$1 AND to_tier=$3`,
      [currentTier, 0, currentTier + 1]);

    return { success: true, data: { tier, transitions, next_tier_conditions: nextConditions } };
  }

  private async forceTier(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { tier, reason } = payload as any;
    await this.db.query(`
      UPDATE shop_tiers SET current_tier=$1, tier_entered_at=NOW(), tier_unlocked_by=$2
      WHERE shop_id=$3`, [tier, `manual:${reason}`, shop_id]);
    await this.emit('tier:transition', { shop_id, to_tier: tier, triggered_by: `manual:${reason}` });
    return { success: true, data: { tier } };
  }

  private async getTierConfig(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { rows: [tierRow] } = await this.db.query(
      `SELECT current_tier FROM shop_tiers WHERE shop_id=$1`, [shop_id]);
    const tier = (payload as any)?.tier ?? tierRow?.current_tier ?? 1;

    const { rows } = await this.db.query(
      `SELECT * FROM tier_agent_config WHERE tier=$1 ORDER BY agent_name`, [tier]);
    return { success: true, data: { tier, agents: rows } };
  }
}
