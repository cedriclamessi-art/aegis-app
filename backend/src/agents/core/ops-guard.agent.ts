/**
 * AGENT_OPS_GUARD \u2014 Gardien financier + gestionnaire de phase
 * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Responsabilit\u00e9s :
 *   1. Surveiller le CA journalier
 *   2. D\u00e9clencher le d\u00e9verrouillage Phase 1 \u00e0 1000\u20ac/jour
 *   3. Envoyer le BROADCAST de r\u00e9veil \u00e0 tous les agents endormis
 *   4. Guardrails financiers : stop-loss, ROAS min, daily cap
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { AgentBus, AGENT_WAKEUP_PROTOCOLS } from './agent-bus.js';
import { db } from '../../utils/db';

export class OpsGuardAgent extends AgentBase {
  readonly agentId = 'AGENT_OPS_GUARD';

  readonly supportedTasks = [
    'ops.check_unlock_threshold',   // cron toutes les heures
    'ops.budget_cap',
    'ops.stop_loss',
    'ops.alert',
    'ops.revenue_update',           // re\u00e7u depuis Shopify webhook
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'ops.check_unlock_threshold':
        return this.checkUnlockThreshold(task);
      case 'ops.revenue_update':
        return this.updateRevenue(task);
      case 'ops.stop_loss':
        return this.triggerStopLoss(task);
      default:
        return this.runGuardrailCheck(task);
    }
  }

  // \u2500\u2500 V\u00e9rification du seuil et unlock \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async checkUnlockThreshold(task: AgentTask): Promise<AgentResult> {
    const bus = new AgentBus(this.agentId, task.tenantId);

    // Appeler la fonction SQL ops.check_and_unlock_phases
    const r = await db.query(
      `SELECT * FROM ops.check_and_unlock_phases($1)`,
      [task.tenantId]
    );

    if (!r.rows.length) {
      // Aucune phase d\u00e9bloqu\u00e9e \u2014 juste logger le CA du jour
      const rev = await db.query(
        `SELECT COALESCE(SUM(revenue_eur), 0) as total,
                $2::decimal as threshold,
                ROUND(($2::decimal - COALESCE(SUM(revenue_eur), 0)), 2) as gap_eur
         FROM ops.revenue_daily
         WHERE tenant_id = $1 AND date = CURRENT_DATE`,
        [task.tenantId, 1000]
      );

      const { total, threshold, gap_eur } = rev.rows[0];
      await this.trace('info', `CA aujourd'hui : ${total}\u20ac / ${threshold}\u20ac (manque ${gap_eur}\u20ac)`, {
        revenueToday: total,
        threshold,
        gapEur: gap_eur,
      });

      return {
        success: true,
        output: { phaseUnlocked: null, revenueToday: total, gapToUnlock: gap_eur },
      };
    }

    // \u2550\u2550 PHASE D\u00c9VERROUILL\u00c9E \u2550\u2550
    const { phase_unlocked, agents_activated, revenue_today } = r.rows[0];

    await this.trace('info',
      `\ud83d\udd13 PHASE D\u00c9VERROUILL\u00c9E : ${phase_unlocked} \u2014 ${agents_activated} agents r\u00e9veill\u00e9s (CA: ${revenue_today}\u20ac)`,
      { phase: phase_unlocked, agentsActivated: agents_activated, revenueToday: revenue_today }
    );

    // R\u00e9cup\u00e9rer le contexte produit actif
    const productCtx = await this.getActiveProductContext(task.tenantId);

    // R\u00e9veiller chaque agent avec son protocole sp\u00e9cifique
    await this.wakeUpAllAgents(bus, task.tenantId, productCtx);

    return {
      success: true,
      output: {
        phaseUnlocked:   phase_unlocked,
        agentsActivated: agents_activated,
        revenueToday:    revenue_today,
        message:         `Organisme complet activ\u00e9. ${agents_activated} agents en ligne.`,
      },
    };
  }

  // \u2500\u2500 R\u00e9veiller tous les agents en s\u00e9quence logique \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async wakeUpAllAgents(
    bus: AgentBus,
    tenantId: string,
    productCtx: Record<string, unknown>
  ): Promise<void> {

    // Ordre de r\u00e9veil : infrastructure \u2192 data \u2192 ex\u00e9cution \u2192 contr\u00f4le
    const wakeupOrder = [
      // 1. Fondations data
      'AGENT_ANALYTICS',
      'AGENT_OPS_GUARD',         // s'auto-configure les guardrails complets

      // 2. Intelligence produit
      'AGENT_OFFER',
      'AGENT_STRATEGY_ORGANIC',

      // 3. Cr\u00e9ation
      'AGENT_CREATIVE',
      'AGENT_STORE_BUILDER',
      'AGENT_PSYCHO_MARKETING',

      // 4. Ex\u00e9cution ads
      'AGENT_RISK_ENGINE',
      'AGENT_BUDGET_ALLOCATOR',
      'AGENT_MEDIA_BUYER',

      // 5. Optimisation
      'AGENT_PORTFOLIO_OPT',
      'AGENT_FRAUD_GUARD',
      'AGENT_RECOVERY',
      'AGENT_LEARNING',
      'AGENT_EXPERIMENTS',

      // 6. Contr\u00f4le et intelligence sup\u00e9rieure
      'AGENT_MARKET_INTEL',
      'AGENT_INNOVATION',
      'AGENT_LEGAL_SCRAPING',
      'AGENT_HEALTH_SRE',
      'AGENT_POLICY_GOVERNOR',

      // 7. Cerveau central en dernier (prend le contr\u00f4le du pipeline)
      'AGENT_ORCHESTRATOR',
    ];

    for (const agentId of wakeupOrder) {
      const protocol = AGENT_WAKEUP_PROTOCOLS[agentId];

      if (protocol) {
        try {
          // Cr\u00e9er un bus au nom de SYSTEM pour ce r\u00e9veil
          const systemBus = new AgentBus('SYSTEM', tenantId);
          await protocol(systemBus, productCtx);

          await this.trace('info', `\u2713 ${agentId} r\u00e9veill\u00e9`, { agentId });
        } catch (e) {
          await this.trace('warn', `R\u00e9veil ${agentId} partiel`, { error: String(e) });
        }
      }

      // Petit d\u00e9lai entre chaque r\u00e9veil pour \u00e9viter de saturer la queue
      await new Promise(r => setTimeout(r, 100));
    }
  }

  // \u2500\u2500 Mise \u00e0 jour CA (webhook Shopify) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async updateRevenue(task: AgentTask): Promise<AgentResult> {
    const { amountEur, orderId, source = 'shopify' } = task.payload as {
      amountEur: number;
      orderId:   string;
      source?:   string;
    };

    await db.query(
      `INSERT INTO ops.revenue_daily (tenant_id, date, revenue_eur, order_count, source)
       VALUES ($1, CURRENT_DATE, $2, 1, $3)
       ON CONFLICT (tenant_id, date, source)
       DO UPDATE SET
         revenue_eur  = ops.revenue_daily.revenue_eur + $2,
         order_count  = ops.revenue_daily.order_count + 1,
         updated_at   = NOW()`,
      [task.tenantId, amountEur, source]
    );

    await this.trace('info', `Vente enregistr\u00e9e : +${amountEur}\u20ac`, { orderId, source });

    // D\u00e9clencher imm\u00e9diatement la v\u00e9rification du seuil
    await db.query(
      `INSERT INTO jobs.queue (tenant_id, task_type, payload, priority, scheduled_at)
       VALUES ($1, 'ops.check_unlock_threshold', '{}'::jsonb, 9, NOW())
       ON CONFLICT DO NOTHING`,
      [task.tenantId]
    );

    return { success: true, output: { amountEur, orderId } };
  }

  // \u2500\u2500 Stop loss \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async triggerStopLoss(task: AgentTask): Promise<AgentResult> {
    const bus = new AgentBus(this.agentId, task.tenantId);

    // Activer le kill-switch capability ads.write
    await db.query(
      `INSERT INTO ops.kill_switches (scope, tenant_id, capability, reason, activated_by, is_active)
       VALUES ('capability', $1, 'ads.write', $2, 'AGENT_OPS_GUARD', TRUE)`,
      [task.tenantId, task.payload.reason ?? 'Stop loss d\u00e9clench\u00e9 automatiquement']
    );

    await bus.alert('\ud83d\uded1 STOP LOSS D\u00c9CLENCH\u00c9', {
      reason:    task.payload.reason,
      timestamp: new Date().toISOString(),
    });

    return { success: true, output: { stopLossActive: true } };
  }

  // \u2500\u2500 Guardrail g\u00e9n\u00e9rique \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async runGuardrailCheck(task: AgentTask): Promise<AgentResult> {
    await this.trace('info', 'Guardrail check', { taskType: task.taskType });
    return { success: true, output: {} };
  }

  // \u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async getActiveProductContext(tenantId: string): Promise<Record<string, unknown>> {
    const r = await db.query(
      `SELECT
         p.id        AS "productId",
         p.name      AS "productName",
         p.metadata  AS "productMeta",
         pr.id       AS "pipelineRunId",
         fa.usp, fa.personas, fa.ad_strategies AS "adStrategies"
       FROM store.products p
       LEFT JOIN store.pipeline_runs pr ON pr.product_id = p.id
       LEFT JOIN intel.fast_analysis  fa ON fa.product_id = p.id AND fa.tenant_id = p.tenant_id
       WHERE p.tenant_id = $1 AND p.is_active = TRUE
       ORDER BY p.created_at DESC
       LIMIT 1`,
      [tenantId]
    );

    return r.rows[0] ?? { tenantId };
  }
}
