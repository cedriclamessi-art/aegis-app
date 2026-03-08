/**
 * AGENT_ORCHESTRATOR v5.0
 * Chef d'orchestre du système de paliers.
 * Dispatche les tâches aux agents via agent.run() (pas agent.execute()).
 * Gère la file de suggestions en attente d'approbation humaine.
 * Rapport de progression de palier dans la Morning Brief.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { AgentTierManager } from './tier-manager.agent';

export class AgentOrchestratorV5 extends BaseAgent {
  readonly name = 'AGENT_ORCHESTRATOR';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'tick':              return this.tick(task);
      case 'approve_suggestion':return this.approveSuggestion(task);
      case 'reject_suggestion': return this.rejectSuggestion(task);
      case 'get_inbox':         return this.getInbox(task);
      case 'get_tier_status':   return this.getTierStatus(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /**
   * Tick principal — appelé toutes les 5 minutes.
   * Lance tous les agents actifs dans l'ordre de priorité.
   * Chaque agent.run() passe par le TierGate automatiquement.
   */
  private async tick(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Récupère le tier et les agents actifs pour ce tick
    const { rows: [tier] } = await this.db.query(
      `SELECT current_tier FROM shop_tiers WHERE shop_id=$1`, [shop_id]);
    const currentTier = tier?.current_tier ?? 1;

    // Agents à déclencher dans ce tick (ceux dont next_run_at <= NOW())
    const { rows: dueAgents } = await this.db.query(`
      SELECT agent_name, task_type, payload_template, priority
      FROM agent_schedule
      WHERE enabled=true AND next_run_at <= NOW()
        AND (tenant_scope='all' OR tenant_scope=$1)
      ORDER BY priority DESC
      LIMIT 20`, [shop_id]);

    const results: Record<string, any> = {};

    for (const a of dueAgents) {
      try {
        const agentTask: AgentTask = {
          shop_id,
          type:    a.task_type,
          payload: a.payload_template ? JSON.parse(a.payload_template) : {},
        };

        // Instancie l'agent et lance via run() (TierGate inclus)
        const agent  = await this.resolveAgent(a.agent_name);
        const result = await agent.run(agentTask);

        results[a.agent_name] = {
          verdict:      result.tier_verdict,
          tier:         result.current_tier,
          success:      result.success,
          suggested:    result.suggested ?? false,
          suggestion_id:result.suggestion_id,
        };

        // Avance le next_run_at
        await this.db.query(`
          UPDATE agent_schedule SET last_run_at=NOW(),
            next_run_at = NOW() + (
              CASE schedule_type
                WHEN 'interval' THEN (interval_ms/1000 || ' seconds')::INTERVAL
                ELSE '1 hour'::INTERVAL
              END)
          WHERE agent_name=$1`, [a.agent_name]);

      } catch (err) {
        results[a.agent_name] = { error: String(err) };
      }
    }

    // Statistiques palier dans le résultat
    const summary = {
      tier:      currentTier,
      agents_run: dueAgents.length,
      executed:  Object.values(results).filter((r: any) => r.verdict === 'execute').length,
      shadowed:  Object.values(results).filter((r: any) => r.verdict === 'shadow').length,
      suggested: Object.values(results).filter((r: any) => r.suggested).length,
      blocked:   Object.values(results).filter((r: any) => r.verdict === 'block').length,
    };

    return { success: true, data: { summary, results } };
  }

  /** Approuve une suggestion en boîte de réception. */
  private async approveSuggestion(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { decision_id, user_email } = payload as any;

    const { rows: [dec] } = await this.db.query(
      `SELECT * FROM agent_decisions WHERE id=$1 AND shop_id=$2`, [decision_id, shop_id]);
    if (!dec) return { success: false, message: 'Suggestion introuvable' };

    // Marque comme approuvé
    await this.db.query(`
      UPDATE agent_decisions SET
        executed=true, executed_at=NOW(),
        context = context || '{"human_approved": true, "approved_by": "${user_email}"}'::jsonb
      WHERE id=$1`, [decision_id]);

    // Re-dispatche l'action réelle
    const parsed = JSON.parse(dec.decision_made ?? '{}');
    await this.emit(`${dec.agent_name.toLowerCase()}:execute`, {
      shop_id, action: dec.decision_type, payload: parsed, approved_by: user_email,
    });

    return { success: true, data: { approved: decision_id, action: dec.decision_type } };
  }

  /** Rejette une suggestion. */
  private async rejectSuggestion(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { decision_id, reason } = payload as any;

    await this.db.query(`
      UPDATE agent_decisions SET
        context = context || $1::jsonb
      WHERE id=$2 AND shop_id=$3`,
      [JSON.stringify({ human_rejected: true, reject_reason: reason ?? 'no reason' }),
       decision_id, shop_id]);

    return { success: true, data: { rejected: decision_id } };
  }

  /** Boîte de réception des suggestions en attente. */
  private async getInbox(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT d.id, d.agent_name, d.decision_type, d.decision_made,
             d.created_at, d.confidence,
             dn.narrative_fr,
             c.current_tier
      FROM agent_decisions d
      LEFT JOIN decision_narratives dn ON dn.decision_id = d.id
      CROSS JOIN shop_tiers c
      WHERE d.shop_id=$1 AND c.shop_id=$1
        AND d.executed=false
        AND d.context->>'awaiting_human' = 'true'
      ORDER BY d.created_at DESC
      LIMIT 30`, [task.shop_id]);

    return { success: true, data: { inbox: rows, count: rows.length } };
  }

  /** Statut détaillé du tier + progression. */
  private async getTierStatus(task: AgentTask): Promise<AgentResult> {
    const { rows: [tier] } = await this.db.query(
      `SELECT * FROM shop_tiers WHERE shop_id=$1`, [task.shop_id]);

    if (!tier) return { success: true, data: { tier: 1, message: 'Tier non initialisé' } };

    const currentTier = tier.current_tier;

    // Conditions pour le tier suivant
    const { rows: conditions } = await this.db.query(`
      SELECT c.*,
        CASE c.condition_key
          WHEN 'shadow_agreement_rate'    THEN $2::text
          WHEN 'avg_roas_30d'             THEN $3::text
          WHEN 'days_no_critical_anomaly' THEN $4::text
          WHEN 'days_live'                THEN $5::text
          WHEN 'onboarding_complete'      THEN CASE WHEN $6 THEN '1' ELSE '0' END
          ELSE '?'
        END AS current_value
      FROM tier_unlock_conditions c
      WHERE c.from_tier=$1 AND c.to_tier=$1+1`,
      [currentTier,
       tier.shadow_agreement_rate?.toFixed(3),
       tier.avg_roas_30d?.toFixed(2),
       tier.days_no_critical_anomaly?.toFixed(0),
       '7', // days_live calculé séparément
       true]);

    // Compte des actions par verdict (30j)
    const { rows: stats } = await this.db.query(`
      SELECT
        COUNT(*) FILTER (WHERE context->>'verdict'='execute') AS executed,
        COUNT(*) FILTER (WHERE context->>'verdict'='shadow')  AS shadowed,
        COUNT(*) FILTER (WHERE context->>'awaiting_human'='true' AND executed=false) AS pending_suggestions
      FROM agent_decisions
      WHERE shop_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [task.shop_id]);

    const TIER_NAMES = ['','Démarrage','Validation','Croissance','Scale','Empire'];
    const TIER_DESC  = [
      '',
      'AEGIS observe tout. Aucune exécution automatique.',
      'AEGIS coupe les campagnes perdantes. Suggère le reste.',
      'AEGIS exécute les décisions < €200/j. Suggère au-delà.',
      'AEGIS est en plein automatique, budget illimité dans les guardrails.',
      'Mode Empire. Autonomie totale.',
    ];

    return { success: true, data: {
      current_tier: currentTier,
      tier_name:    TIER_NAMES[currentTier],
      tier_desc:    TIER_DESC[currentTier],
      next_tier:    currentTier < 5 ? currentTier + 1 : null,
      next_tier_name: currentTier < 5 ? TIER_NAMES[currentTier + 1] : null,
      next_conditions: conditions,
      metrics: {
        shadow_agreement_rate:     tier.shadow_agreement_rate,
        avg_roas_30d:              tier.avg_roas_30d,
        days_no_critical_anomaly:  tier.days_no_critical_anomaly,
        total_revenue_aegis:       tier.total_revenue_aegis,
      },
      stats:   stats[0],
      entered_at: tier.tier_entered_at,
    }};
  }

  /** Résout le nom d'un agent en instance. */
  private async resolveAgent(name: string): Promise<BaseAgent> {
    // Lazy imports pour éviter les dépendances circulaires
    const map: Record<string, () => Promise<BaseAgent>> = {
      AGENT_SCALE:          async () => { const { AgentScale }         = await import('../ads/scale.agent');           return new AgentScale(this.db, this.redis); },
      AGENT_STOP_LOSS:      async () => { const { AgentStopLoss }      = await import('../ads/stop-loss.agent');       return new AgentStopLoss(this.db, this.redis); },
      AGENT_DAYPARTING:     async () => { const { AgentDayparting }    = await import('../ads/dayparting.agent');      return new AgentDayparting(this.db, this.redis); },
      AGENT_ANOMALY:        async () => { const { AgentAnomaly }       = await import('../core/anomaly.agent');        return new AgentAnomaly(this.db, this.redis); },
      AGENT_PIXEL_HEALTH:   async () => { const { AgentPixelHealth }   = await import('../analytics/pixel-health.agent'); return new AgentPixelHealth(this.db, this.redis); },
      AGENT_RFM:            async () => { const { AgentRFM }           = await import('../retention/rfm.agent');       return new AgentRFM(this.db, this.redis); },
      AGENT_FORECASTER:     async () => { const { AgentForecaster }    = await import('../analytics/forecaster.agent'); return new AgentForecaster(this.db, this.redis); },
      AGENT_REPLENISHMENT:  async () => { const { AgentReplenishment } = await import('../ops/replenishment.agent');   return new AgentReplenishment(this.db, this.redis); },
      AGENT_VERBATIM:       async () => { const { AgentVerbatim }      = await import('../growth/verbatim.agent');     return new AgentVerbatim(this.db, this.redis); },
      AGENT_REPUTATION:     async () => { const { AgentReputation }    = await import('../growth/reputation.agent');   return new AgentReputation(this.db, this.redis); },
      AGENT_TIER_MANAGER:   async () => { return new AgentTierManager(this.db, this.redis); },
      AGENT_SEASONAL_CALENDAR: async () => { const { AgentSeasonalCalendarGlobal } = await import('../ops/seasonal-calendar-v42.agent'); return new AgentSeasonalCalendarGlobal(this.db, this.redis); },
      AGENT_BUDGET_OPTIMIZER:  async () => { const { AgentBudgetOptimizer }       = await import('../finance/budget-optimizer.agent');   return new AgentBudgetOptimizer(this.db, this.redis); },
      AGENT_PERFORMANCE_BILLING: async () => { const { AgentPerformanceBilling } = await import('../finance/performance-billing.agent'); return new AgentPerformanceBilling(this.db, this.redis); },
    };
    const factory = map[name];
    if (!factory) throw new Error(`Agent ${name} non résolu dans l'orchestrateur`);
    return factory();
  }
}
