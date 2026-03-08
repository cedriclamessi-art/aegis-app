// ============================================================
// AEGIS — Agent Scheduler
// Lit agent_schedule · Enfile les tasks au bon moment
// Chaque agent sait quand agir + réagit aux messages du bus
// ============================================================

import { db } from '../utils/db';
import { logger } from '../utils/logger';

interface ScheduledTask {
  agentId: string;
  taskType: string;
  scheduleType: string;
  cronExpr: string | null;
  intervalMs: number | null;
  triggerEvent: string | null;
  priority: number;
  tenantScope: string;
  conditions: Record<string, unknown>;
  payloadTemplate: Record<string, unknown>;
  nextRunAt: Date | null;
}

export class AgentScheduler {
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private readonly TICK_MS = 30_000; // check toutes les 30s

  async start(): Promise<void> {
    logger.info('⏱  AgentScheduler démarré');

    // Premier tick immédiat
    await this.tick();

    // Puis toutes les 30s
    this.intervalHandle = setInterval(() => this.tick(), this.TICK_MS);
  }

  stop(): void {
    if (this.intervalHandle) clearInterval(this.intervalHandle);
    logger.info('AgentScheduler arrêté');
  }

  private async tick(): Promise<void> {
    try {
      // 1. Enqueue les tasks "cron" dont le next_run_at est dépassé
      await this.enqueueDueCronTasks();

      // 2. Traiter les messages du bus qui déclenchent des tasks (triggers)
      await this.processTriggerEvents();

      // 3. Lire les messages entrants sur le bus pour chaque agent
      await this.routeBusMessages();

    } catch (err) {
      logger.error({ err }, 'AgentScheduler tick error');
    }
  }

  // ─── 1. CRON : enqueue les tasks dues ────────────────────
  private async enqueueDueCronTasks(): Promise<void> {
    const dueTasks = await db.query<ScheduledTask & { id: string }>(
      `SELECT * FROM agent_schedule
       WHERE is_enabled = TRUE
         AND schedule_type IN ('cron', 'interval')
         AND (next_run_at IS NULL OR next_run_at <= NOW())
       FOR UPDATE SKIP LOCKED`
    );

    for (const schedule of dueTasks.rows) {
      try {
        const tenantIds = await this.getTargetTenants(schedule.tenantScope);

        for (const tenantId of tenantIds) {
          // Vérifier les conditions
          if (!await this.checkConditions(schedule.conditions, tenantId)) continue;

          // Enqueue la task
          await db.query(
            `INSERT INTO actions_queue
             (tenant_id, task_type, payload, priority, correlation_id)
             VALUES ($1, $2, $3::jsonb, $4, $5)`,
            [
              tenantId,
              schedule.taskType,
              JSON.stringify({ ...schedule.payloadTemplate, scheduledBy: 'SCHEDULER', agentId: schedule.agentId }),
              schedule.priority,
              `sched-${schedule.agentId}-${Date.now()}`,
            ]
          );

          logger.info({ agentId: schedule.agentId, taskType: schedule.taskType, tenantId }, '⏱ Task schedulée');
        }

        // Calculer le prochain run
        const nextRun = await this.calcNextRun(schedule);
        await db.query(
          `UPDATE agent_schedule
           SET last_run_at = NOW(), next_run_at = $1, run_count = run_count + 1, updated_at = NOW()
           WHERE id = $2`,
          [nextRun, (schedule as { id: string }).id]
        );
      } catch (err) {
        logger.error({ err, schedule }, 'Failed to enqueue scheduled task');
      }
    }
  }

  // ─── 2. TRIGGERS : events qui déclenchent des tasks ──────
  private async processTriggerEvents(): Promise<void> {
    // Lire les events non traités de l'outbox
    const events = await db.query(
      `UPDATE outbox_events
       SET published = TRUE, published_at = NOW()
       WHERE id IN (
         SELECT id FROM outbox_events
         WHERE published = FALSE
         ORDER BY created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 50
       )
       RETURNING *`
    );

    for (const event of events.rows) {
      // Trouver les agents qui écoutent cet event
      const triggers = await db.query(
        `SELECT * FROM agent_schedule
         WHERE schedule_type = 'trigger'
           AND trigger_event = $1
           AND is_enabled = TRUE`,
        [event.event_type]
      );

      for (const trigger of triggers.rows) {
        await db.query(
          `INSERT INTO actions_queue (tenant_id, task_type, payload, priority, correlation_id)
           VALUES ($1, $2, $3::jsonb, $4, $5)
           ON CONFLICT DO NOTHING`,
          [
            event.tenant_id,
            trigger.task_type,
            JSON.stringify({ triggeredBy: event.event_type, eventPayload: event.payload, ...trigger.payload_template }),
            trigger.priority,
            `trigger-${event.id}-${trigger.agent_id}`,
          ]
        );
      }
    }
  }

  // ─── 3. ROUTING BUS : inter-agent messages ───────────────
  private async routeBusMessages(): Promise<void> {
    // Messages en attente qui nécessitent une action immédiate (COMMAND, ALERT)
    const urgentMessages = await db.query(
      `UPDATE agent_bus SET status = 'delivered', delivered_at = NOW()
       WHERE id IN (
         SELECT id FROM agent_bus
         WHERE status = 'pending'
           AND message_type IN ('COMMAND', 'ALERT')
           AND expires_at > NOW()
         ORDER BY priority DESC, created_at ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 20
       )
       RETURNING *`
    );

    for (const msg of urgentMessages.rows) {
      // Transformer le message en task pour le worker
      await db.query(
        `INSERT INTO actions_queue (tenant_id, task_type, payload, priority, correlation_id)
         VALUES ($1, $2, $3::jsonb, $4, $5)`,
        [
          msg.tenant_id,
          `${msg.to_agent}.handle_message`,  // ex: AGENT_COPY_CHIEF.handle_message
          JSON.stringify({
            messageId: msg.id,
            fromAgent: msg.from_agent,
            messageType: msg.message_type,
            subject: msg.subject,
            payload: msg.payload,
            intelRefs: msg.intel_refs,
          }),
          msg.priority,
          msg.correlation_id,
        ]
      ).catch(() => {}); // Ne pas crash si le task_type n'est pas enregistré
    }
  }

  // ─── Helpers ──────────────────────────────────────────────
  private async getTargetTenants(scope: string): Promise<(string | null)[]> {
    if (scope === 'global') return [null]; // task globale sans tenant

    const result = await db.query(
      `SELECT id FROM tenants
       WHERE kill_switch_active = FALSE
         AND plan_status IN ('active', 'trialing')
       ORDER BY created_at`
    );
    return result.rows.map(r => r.id);
  }

  private async checkConditions(conditions: Record<string, unknown>, tenantId: string | null): Promise<boolean> {
    if (!conditions || Object.keys(conditions).length === 0) return true;

    // Exemple: has_active_pipelines → vérifier qu'il y a des pipelines actifs
    if (conditions.has_active_pipelines) {
      const check = await db.query(
        `SELECT id FROM pipeline_runs
         WHERE tenant_id = $1 AND status NOT IN ('completed','failed','cancelled')
         LIMIT 1`,
        [tenantId]
      );
      if (check.rows.length === 0) return false;
    }

    return true;
  }

  private async calcNextRun(schedule: ScheduledTask): Promise<Date> {
    // Calcul simple basé sur cron ou interval
    if (schedule.intervalMs) {
      return new Date(Date.now() + schedule.intervalMs);
    }

    // Cron parser minimal (les cas les plus courants)
    // Pour production : utiliser la lib 'croner' ou 'node-cron'
    const cron = schedule.cronExpr ?? '0 */1 * * *';
    const now = new Date();

    // Parsing simple pour les formats courants
    if (cron === '*/5 * * * *') return new Date(now.getTime() + 5 * 60_000);
    if (cron === '*/15 * * * *') return new Date(now.getTime() + 15 * 60_000);
    if (cron === '*/2 * * * *') return new Date(now.getTime() + 2 * 60_000);
    if (cron === '0 * * * *') {
      const next = new Date(now);
      next.setMinutes(0, 0, 0);
      next.setHours(next.getHours() + 1);
      return next;
    }
    if (cron.startsWith('0 */')) {
      const hours = parseInt(cron.split('*/')[1]);
      return new Date(now.getTime() + hours * 3_600_000);
    }
    if (cron.startsWith('0 ') && cron.includes(',')) {
      // Ex: '0 6,14,22 * * *' → 3x par jour
      return new Date(now.getTime() + 8 * 3_600_000);
    }
    if (cron.startsWith('0 0 * * ')) {
      // Hebdomadaire
      return new Date(now.getTime() + 7 * 24 * 3_600_000);
    }
    if (cron.startsWith('0 ') && cron.endsWith('* * *')) {
      // Quotidien à heure fixe
      const next = new Date(now);
      next.setDate(next.getDate() + 1);
      next.setHours(parseInt(cron.split(' ')[1]), 0, 0, 0);
      return next;
    }

    // Défaut : 1h
    return new Date(now.getTime() + 3_600_000);
  }
}

export const agentScheduler = new AgentScheduler();
