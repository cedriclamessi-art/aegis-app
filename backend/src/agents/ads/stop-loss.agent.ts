// ThresholdHelper is optional — import only if available
// import { ThresholdHelper } from '../core/threshold.helper';

// AGENT_STOP_LOSS — Moteur Stop-Loss + Revive Granulaire
// Superieur a Madgicx sur: granularite, multi-criteres, revive conditionnel, reduce_budget
// Frequence: toutes les 15 minutes
// Integrations: ads.performance_hourly, risk.stop_loss_rules, Meta Graph API

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import { logger } from '../../utils/logger';

// ─── Types ──────────────────────────────────────────────────

type ActionType = 'pause' | 'revive' | 'reduce_budget' | 'alert';
type EntityType = 'ad' | 'adset' | 'campaign';

interface StopLossRule {
  id: string;
  name: string;
  action_on_trigger: ActionType;
  budget_reduction_pct: number | null;
  revive_enabled: boolean;
  revive_after_hours: number;
  revive_min_roas: number | null;
  revive_max_cpa_eur: number | null;
  revive_window_hours: number;
  max_revives_per_day: number;
}

interface EvalResult {
  rule_id: string;
  rule_name: string;
  action: ActionType;
  triggered: boolean;
  reason: string;
  spend: number;
  roas: number | null;
  cpa: number | null;
  ctr: number | null;
  cpm: number | null;
  conversions: number;
}

interface AdEntity {
  entity_id: string;
  tenant_id: string;
  platform: string;
  entity_type: EntityType;
  external_id: string;
  entity_name: string;
  current_status: string;
  daily_budget: number | null;
  is_paused_by_stop_loss: boolean;
  paused_since: Date | null;
  spend_24h: number;
  roas_24h: number | null;
  cpa_24h: number | null;
  ctr_24h: number | null;
}

interface ScanSummary {
  scanned: number;
  paused: number;
  revived: number;
  budget_reduced: number;
  alerts: number;
  actions: Array<{
    entity: string;
    action: ActionType;
    reason: string;
    metrics: Record<string, unknown>;
  }>;
}

// ─── Agent ───────────────────────────────────────────────────

export class StopLossAgent extends AgentBase {
  readonly agentId = 'AGENT_STOP_LOSS';
  readonly taskTypes = [
    'stop_loss.scan',            // cron 15min — scan toutes les entités actives
    'stop_loss.eval_entity',     // évaluer une entité spécifique (on-demand)
    'stop_loss.revive_check',    // vérifier les entités en pause pour revive
    'stop_loss.configure_rules', // (re)configurer les règles d'un tenant
    'stop_loss.report',          // rapport des 24 dernières heures
  ];

  // ══════════════════════════════════════════════════════════
  // EXECUTE
  // ══════════════════════════════════════════════════════════

  async execute(task: AgentTask): Promise<AgentResult> {
    const { taskType, tenantId } = task;
    logger.info({ agent: this.agentId, taskType, tenantId }, 'Stop-Loss task start');

    try {
      switch (taskType) {
        case 'stop_loss.scan':
          return await this.scan(tenantId!);

        case 'stop_loss.eval_entity':
          return await this.evalEntity(
            tenantId!,
            (task.input as { entityId: string }).entityId
          );

        case 'stop_loss.revive_check':
          return await this.reviveCheck(tenantId!);

        case 'stop_loss.configure_rules':
          return await this.configureRules(tenantId!, task.input as {
            reset?: boolean;
            rules?: Partial<StopLossRule>[];
          });

        case 'stop_loss.report':
          return await this.generateReport(tenantId!);

        default:
          return { success: false, error: `Unknown taskType: ${taskType}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ agent: this.agentId, err: msg }, 'Task failed');
      return { success: false, error: msg, retryable: true };
    }
  }

  // ══════════════════════════════════════════════════════════
  // TASK 1 : SCAN COMPLET (cron 15min)
  // ══════════════════════════════════════════════════════════

  private async scan(tenantId: string): Promise<AgentResult> {
    logger.info({ agent: this.agentId, tenantId }, 'Stop-Loss scan start');

    const summary: ScanSummary = {
      scanned: 0,
      paused: 0,
      revived: 0,
      budget_reduced: 0,
      alerts: 0,
      actions: [],
    };

    // 1. Charger toutes les entités actives
    const entities = await db.query<AdEntity>(`
      SELECT * FROM risk.ad_health_now
      WHERE tenant_id = $1
        AND current_status IN ('ACTIVE', 'active', 'PAUSED')
    `, [tenantId]);

    summary.scanned = entities.rows.length;

    for (const entity of entities.rows) {
      try {
        if (entity.is_paused_by_stop_loss) {
          // En pause → vérifier si on peut revive
          const revived = await this.tryRevive(tenantId, entity);
          if (revived) {
            summary.revived++;
            summary.actions.push({
              entity: entity.entity_name,
              action: 'revive',
              reason: 'Métriques récupérées',
              metrics: { roas: entity.roas_24h, cpa: entity.cpa_24h },
            });
          }
        } else {
          // Actif → évaluer les règles stop-loss
          const result = await this.evalAndAct(tenantId, entity);
          if (result) {
            if (result.action === 'pause') summary.paused++;
            else if (result.action === 'reduce_budget') summary.budget_reduced++;
            else if (result.action === 'alert') summary.alerts++;
            summary.actions.push(result);
          }
        }
      } catch (err) {
        logger.warn({ entity: entity.entity_id, err: String(err) }, 'Entity eval failed');
      }
    }

    // Alerte CEO si nombreuses pauces en rafale
    if (summary.paused >= 3) {
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_CEO',
        messageType: 'ALERT',
        subject: 'stop_loss_burst',
        payload: {
          pausedCount: summary.paused,
          totalScanned: summary.scanned,
          actions: summary.actions.filter(a => a.action === 'pause'),
          message: `⚠️ ${summary.paused} ads pausés en une seule analyse — vérifier la qualité du compte.`,
        },
        tenantId,
        priority: 8,
      });
    }

    logger.info({ ...summary, tenantId }, 'Stop-Loss scan complete');

    return {
      success: true,
      output: summary,
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 2 : ÉVALUER UNE ENTITÉ SPÉCIFIQUE
  // ══════════════════════════════════════════════════════════

  private async evalEntity(tenantId: string, entityId: string): Promise<AgentResult> {
    const entityResult = await db.query<AdEntity>(`
      SELECT * FROM risk.ad_health_now
      WHERE entity_id = $1 AND tenant_id = $2
    `, [entityId, tenantId]);

    if (!entityResult.rows.length) {
      return { success: false, error: `Entity ${entityId} not found` };
    }

    const entity = entityResult.rows[0];

    // Évaluer via la fonction SQL
    const evalResult = await db.query<EvalResult>(`
      SELECT * FROM risk.eval_entity($1, $2)
    `, [entityId, tenantId]);

    const triggered = evalResult.rows.filter(r => r.triggered);

    return {
      success: true,
      output: {
        entity: {
          id: entity.entity_id,
          name: entity.entity_name,
          status: entity.current_status,
          is_paused_by_stop_loss: entity.is_paused_by_stop_loss,
        },
        metrics: {
          spend_24h:       entity.spend_24h,
          roas_24h:        entity.roas_24h,
          cpa_24h:         entity.cpa_24h,
          ctr_24h:         entity.ctr_24h,
        },
        rules_evaluated:   evalResult.rows.length,
        rules_triggered:   triggered.length,
        triggered_rules:   triggered.map(r => ({
          rule: r.rule_name,
          action: r.action,
          reason: r.reason,
        })),
        all_rules: evalResult.rows,
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 3 : REVIVE CHECK (inclus dans scan, aussi dispo seul)
  // ══════════════════════════════════════════════════════════

  private async reviveCheck(tenantId: string): Promise<AgentResult> {
    const paused = await db.query<AdEntity>(`
      SELECT * FROM risk.ad_health_now
      WHERE tenant_id = $1 AND is_paused_by_stop_loss = TRUE
    `, [tenantId]);

    let revived = 0;
    const actions: Array<{ entity: string; reason: string }> = [];

    for (const entity of paused.rows) {
      const didRevive = await this.tryRevive(tenantId, entity);
      if (didRevive) {
        revived++;
        actions.push({ entity: entity.entity_name, reason: 'Conditions de revive satisfaites' });
      }
    }

    return {
      success: true,
      output: { checked: paused.rows.length, revived, actions },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 4 : CONFIGURER LES RÈGLES
  // ══════════════════════════════════════════════════════════

  private async configureRules(
    tenantId: string,
    input: { reset?: boolean; rules?: Partial<StopLossRule>[] }
  ): Promise<AgentResult> {

    if (input.reset) {
      // Supprimer les règles existantes et réinitialiser avec les défauts
      await db.query(`
        DELETE FROM risk.stop_loss_rules WHERE tenant_id = $1
      `, [tenantId]);

      const count = await db.query<{ risk_init_default_rules: number }>(`
        SELECT risk.init_default_rules($1)
      `, [tenantId]);

      return {
        success: true,
        output: {
          rulesCreated: count.rows[0].risk_init_default_rules,
          message: 'Règles réinitialisées avec les défauts AEGIS.',
        },
      };
    }

    // Sinon : initialiser uniquement si aucune règle n'existe
    const existing = await db.query(`
      SELECT COUNT(*) AS cnt FROM risk.stop_loss_rules WHERE tenant_id = $1
    `, [tenantId]);

    if (parseInt(existing.rows[0].cnt) === 0) {
      const count = await db.query<{ risk_init_default_rules: number }>(`
        SELECT risk.init_default_rules($1)
      `, [tenantId]);

      return {
        success: true,
        output: {
          rulesCreated: count.rows[0].risk_init_default_rules,
          message: 'Règles par défaut initialisées.',
        },
      };
    }

    return {
      success: true,
      output: {
        message: `${existing.rows[0].cnt} règles existantes. Utiliser reset=true pour réinitialiser.`,
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 5 : RAPPORT 24H
  // ══════════════════════════════════════════════════════════

  private async generateReport(tenantId: string): Promise<AgentResult> {
    const [actions, health] = await Promise.all([
      db.query(`
        SELECT
          sla.action,
          sla.reason,
          sla.spend_at_trigger,
          sla.roas_at_trigger,
          sla.cpa_at_trigger,
          sla.pause_duration_hours,
          e.name AS entity_name,
          e.entity_type,
          r.name AS rule_name,
          sla.created_at
        FROM risk.stop_loss_actions sla
        LEFT JOIN ads.entities e ON e.id = sla.entity_id
        LEFT JOIN risk.stop_loss_rules r ON r.id = sla.rule_id
        WHERE sla.tenant_id = $1
          AND sla.created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY sla.created_at DESC
      `, [tenantId]),

      db.query(`
        SELECT
          COUNT(*) FILTER (WHERE is_paused_by_stop_loss = TRUE)  AS currently_paused,
          COUNT(*) FILTER (WHERE current_status = 'ACTIVE')       AS active,
          ROUND(AVG(roas_24h) FILTER (WHERE roas_24h IS NOT NULL), 2) AS avg_roas,
          ROUND(AVG(cpa_24h)  FILTER (WHERE cpa_24h IS NOT NULL), 2)  AS avg_cpa
        FROM risk.ad_health_now
        WHERE tenant_id = $1
      `, [tenantId]),
    ]);

    const h = health.rows[0];
    const byAction = actions.rows.reduce((acc: Record<string, number>, row: { action: string }) => {
      acc[row.action] = (acc[row.action] ?? 0) + 1;
      return acc;
    }, {});

    return {
      success: true,
      output: {
        period: '24h',
        account_health: {
          active_ads:       h.active,
          currently_paused: h.currently_paused,
          avg_roas_24h:     h.avg_roas,
          avg_cpa_24h:      h.avg_cpa,
        },
        actions_24h: {
          total: actions.rows.length,
          by_type: byAction,
        },
        action_log: actions.rows,
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // HELPERS INTERNES
  // ══════════════════════════════════════════════════════════

  /**
   * Évalue une entité et exécute l'action si une règle est déclenchée.
   */
  private async evalAndAct(
    tenantId: string,
    entity: AdEntity
  ): Promise<ScanSummary['actions'][0] | null> {

    // Évaluer via la fonction SQL
    const evalResult = await db.query<EvalResult>(`
      SELECT * FROM risk.eval_entity($1, $2)
    `, [entity.entity_id, tenantId]);

    // Trouver la première règle déclenchée (la plus prioritaire)
    const triggered = evalResult.rows.find(r => r.triggered);
    if (!triggered) return null;

    // Charger les détails de la règle pour la config revive
    const ruleResult = await db.query<StopLossRule>(`
      SELECT * FROM risk.stop_loss_rules WHERE id = $1
    `, [triggered.rule_id]);

    const rule = ruleResult.rows[0];
    if (!rule) return null;

    // Exécuter l'action
    await this.executeAction(tenantId, entity, rule, triggered);

    return {
      entity:  entity.entity_name,
      action:  triggered.action,
      reason:  triggered.reason,
      metrics: {
        spend:       triggered.spend,
        roas:        triggered.roas,
        cpa:         triggered.cpa,
        ctr:         triggered.ctr,
        cpm:         triggered.cpm,
        conversions: triggered.conversions,
      },
    };
  }

  /**
   * Exécute l'action (pause / reduce_budget / alert) via Meta Graph API
   * et logue dans risk.stop_loss_actions.
   */
  private async executeAction(
    tenantId: string,
    entity: AdEntity,
    rule: StopLossRule,
    evalResult: EvalResult
  ): Promise<void> {

    let apiSuccess = false;
    let apiResponse: Record<string, unknown> = {};
    let apiError: string | undefined;

    try {
      if (rule.action_on_trigger === 'pause') {
        // Appel Meta Graph API pour pauser
        const metaResult = await this.callMetaApi(
          entity.platform,
          entity.external_id,
          entity.entity_type,
          'pause'
        );
        apiSuccess = metaResult.success;
        apiResponse = metaResult.response;

        // Mettre à jour le statut dans ads.entities
        await db.query(`
          UPDATE ads.entities
          SET status = 'PAUSED',
              paused_by = 'AGENT_STOP_LOSS',
              updated_at = NOW()
          WHERE id = $1
        `, [entity.entity_id]);

      } else if (rule.action_on_trigger === 'reduce_budget' && rule.budget_reduction_pct) {
        const newBudget = Math.round(
          (entity.daily_budget ?? 0) * (1 - rule.budget_reduction_pct / 100)
        );
        const metaResult = await this.callMetaApi(
          entity.platform,
          entity.external_id,
          entity.entity_type,
          'update_budget',
          { daily_budget: newBudget * 100 } // Meta attend les centimes
        );
        apiSuccess = metaResult.success;
        apiResponse = metaResult.response;

        await db.query(`
          UPDATE ads.entities
          SET daily_budget = $2, updated_at = NOW()
          WHERE id = $1
        `, [entity.entity_id, newBudget]);

      } else {
        // alert_only
        apiSuccess = true;
      }
    } catch (err) {
      apiError = String(err);
      apiSuccess = false;
    }

    // Logger l'action
    await db.query(`
      INSERT INTO risk.stop_loss_actions (
        tenant_id, rule_id, entity_id, entity_type, external_id, platform,
        action, triggered_by,
        spend_at_trigger, roas_at_trigger, cpa_at_trigger, ctr_at_trigger,
        conversions_at_trigger, reason,
        api_success, api_response, api_error, paused_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,'AGENT_STOP_LOSS',$8,$9,$10,$11,$12,$13,$14,$15,$16,
        CASE WHEN $7 = 'pause' THEN NOW() ELSE NULL END)
    `, [
      tenantId,
      rule.id,
      entity.entity_id,
      entity.entity_type,
      entity.external_id,
      entity.platform,
      rule.action_on_trigger,
      evalResult.spend,
      evalResult.roas,
      evalResult.cpa,
      evalResult.ctr,
      evalResult.conversions,
      evalResult.reason,
      apiSuccess,
      JSON.stringify(apiResponse),
      apiError ?? null,
    ]);

    // Si CTR effondré → déclencher un nouveau brief créatif
    if (rule.name.includes('CTR') && rule.action_on_trigger === 'pause') {
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_CREATIVE_FACTORY',
        messageType: 'COMMAND',
        subject: 'creative_refresh_needed',
        payload: {
          entityId:   entity.entity_id,
          reason:     'CTR effondré — creative épuisé',
          ctrObserved: evalResult.ctr,
          adName:     entity.entity_name,
        },
        tenantId,
        priority: 6,
      });
    }

    logger.info({
      agent:  this.agentId,
      entity: entity.entity_name,
      action: rule.action_on_trigger,
      reason: evalResult.reason,
      roas:   evalResult.roas,
      cpa:    evalResult.cpa,
      apiOk:  apiSuccess,
    }, 'Stop-Loss action executed');
  }

  /**
   * Vérifie si une entité en pause peut être revivée.
   * Logique : délai écoulé + métriques récupérées sur la fenêtre de revive.
   */
  private async tryRevive(tenantId: string, entity: AdEntity): Promise<boolean> {
    if (!entity.is_paused_by_stop_loss || !entity.paused_since) return false;

    // Charger la dernière action de pause et sa règle
    const lastPause = await db.query(`
      SELECT sla.*, r.*
      FROM risk.stop_loss_actions sla
      LEFT JOIN risk.stop_loss_rules r ON r.id = sla.rule_id
      WHERE sla.entity_id = $1
        AND sla.action = 'pause'
        AND sla.revived_at IS NULL
      ORDER BY sla.created_at DESC
      LIMIT 1
    `, [entity.entity_id]);

    if (!lastPause.rows.length) return false;
    const pause = lastPause.rows[0];

    // 1. Vérifier le délai minimum
    const pausedHours = (Date.now() - new Date(pause.paused_at).getTime()) / 3600000;
    if (pausedHours < (pause.revive_after_hours ?? 24)) return false;

    // 2. Vérifier si revive désactivé pour cette règle
    if (!pause.revive_enabled) return false;

    // 3. Vérifier la limite de revives par jour
    const revivesToday = await db.query(`
      SELECT COUNT(*) AS cnt
      FROM risk.stop_loss_actions
      WHERE entity_id = $1
        AND action = 'revive'
        AND created_at >= CURRENT_DATE
    `, [entity.entity_id]);

    if (parseInt(revivesToday.rows[0].cnt) >= (pause.max_revives_per_day ?? 2)) return false;

    // 4. Vérifier les conditions métriques (fenêtre courte post-pause)
    const recentPerf = await db.query(`
      SELECT
        CASE WHEN SUM(spend) > 0 THEN SUM(revenue) / SUM(spend) ELSE NULL END AS roas,
        CASE WHEN SUM(conversions) > 0 THEN SUM(spend) / SUM(conversions) ELSE NULL END AS cpa
      FROM ads.performance_hourly
      WHERE entity_id = $1
        AND hour >= NOW() - ($2 || ' hours')::INTERVAL
    `, [entity.entity_id, pause.revive_window_hours ?? 6]);

    const perf = recentPerf.rows[0];

    if (pause.revive_min_roas && perf.roas !== null && perf.roas < pause.revive_min_roas) {
      logger.debug({ entity: entity.entity_name, roas: perf.roas, min: pause.revive_min_roas },
        'Revive denied: ROAS still too low');
      return false;
    }

    if (pause.revive_max_cpa_eur && perf.cpa !== null && perf.cpa > pause.revive_max_cpa_eur) {
      logger.debug({ entity: entity.entity_name, cpa: perf.cpa, max: pause.revive_max_cpa_eur },
        'Revive denied: CPA still too high');
      return false;
    }

    // ✅ REVIVE
    try {
      await this.callMetaApi(entity.platform, entity.external_id, entity.entity_type, 'resume');
    } catch (err) {
      logger.warn({ entity: entity.entity_name, err: String(err) }, 'Meta API revive failed');
      return false;
    }

    // Mettre à jour le statut
    await db.query(`
      UPDATE ads.entities SET status = 'ACTIVE', paused_by = NULL, updated_at = NOW()
      WHERE id = $1
    `, [entity.entity_id]);

    // Logguer le revive
    await db.query(`
      UPDATE risk.stop_loss_actions
      SET revived_at = NOW()
      WHERE entity_id = $1 AND action = 'pause' AND revived_at IS NULL
    `, [entity.entity_id]);

    await db.query(`
      INSERT INTO risk.stop_loss_actions (
        tenant_id, rule_id, entity_id, entity_type, external_id, platform,
        action, triggered_by, reason, api_success
      ) VALUES ($1,$2,$3,$4,$5,$6,'revive','AGENT_STOP_LOSS',$7,TRUE)
    `, [
      tenantId,
      pause.rule_id,
      entity.entity_id,
      entity.entity_type,
      entity.external_id,
      entity.platform,
      `Revive après ${Math.round(pausedHours)}h — ROAS: ${perf.roas?.toFixed(2) ?? 'n/a'}, CPA: ${perf.cpa?.toFixed(0) ?? 'n/a'}€`,
    ]);

    logger.info({
      entity:   entity.entity_name,
      pausedHours: Math.round(pausedHours),
      roas:     perf.roas,
      cpa:      perf.cpa,
    }, '✅ Ad revivée');

    return true;
  }

  /**
   * Appel Meta Graph API (pause / resume / update_budget).
   * En mode shadow → log sans exécuter.
   */
  private async callMetaApi(
    platform: string,
    externalId: string,
    entityType: EntityType,
    action: string,
    params?: Record<string, unknown>
  ): Promise<{ success: boolean; response: Record<string, unknown> }> {

    if (platform !== 'meta' || !externalId) {
      return { success: true, response: { skipped: true, reason: 'non-meta or no external_id' } };
    }

    const token = process.env.META_ADS_TOKEN;
    if (!token) {
      logger.warn({ agent: this.agentId }, 'META_ADS_TOKEN not set — stop-loss in shadow mode');
      return { success: true, response: { shadow_mode: true, action, entityType, externalId } };
    }

    const endpoint = `https://graph.facebook.com/v21.0/${externalId}`;
    let body: Record<string, unknown> = {};

    if (action === 'pause') {
      body = { status: 'PAUSED' };
    } else if (action === 'resume') {
      body = { status: 'ACTIVE' };
    } else if (action === 'update_budget' && params) {
      body = { daily_budget: params.daily_budget };
    }

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify({ ...body, access_token: token }),
    });

    const data = await response.json() as Record<string, unknown>;

    if (!response.ok) {
      throw new Error(`Meta API error: ${JSON.stringify(data)}`);
    }

    return { success: true, response: data };
  }
}

export default StopLossAgent;
