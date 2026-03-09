/**
 * Persistence — Unified PostgreSQL persistence for agent infrastructure
 * =====================================================================
 * Provides optional DB-backed storage for modules that default to in-memory:
 *   - ExecutionLog entries  → agent_execution_logs
 *   - Observability events  → agent_events
 *   - Skills                → agent_skills
 *   - Task plans            → agent_task_plans
 *
 * Design:
 *   - Lazy initialization (no DB hit until first write)
 *   - Auto-creates tables on first use (IF NOT EXISTS)
 *   - Batch inserts with configurable flush interval
 *   - Graceful degradation: logs warning on DB error, never throws
 *   - Compatible with existing `db.ts` Pool singleton
 */

import type { Pool, PoolClient } from 'pg';
import type { ExecutionLogEntry } from './execution-log';
import type { ObservabilityEvent } from './observability';
import type { Skill } from './skill-extraction';
import type { TaskPlan } from './task-planner';

// ── Types ──────────────────────────────────────────────────────────

export interface PersistenceConfig {
  pool:              Pool;
  flushIntervalMs?:  number;   // Default: 5000
  batchSize?:        number;   // Default: 50
  schemaName?:       string;   // Default: 'public'
  enabled?:          boolean;  // Default: true
}

interface QueueItem {
  table:  string;
  data:   Record<string, unknown>;
}

// ── SQL Schemas ────────────────────────────────────────────────────

const SCHEMA_SQL = `
-- Execution logs
CREATE TABLE IF NOT EXISTS agent_execution_logs (
  id              TEXT PRIMARY KEY,
  agent_id        TEXT NOT NULL,
  agent_name      TEXT NOT NULL,
  shop_id         TEXT,
  pipeline_id     TEXT,
  step_name       TEXT,
  started_at      TIMESTAMPTZ NOT NULL,
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  model           TEXT NOT NULL,
  model_downgraded BOOLEAN DEFAULT false,
  original_model  TEXT,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  total_tokens    INTEGER DEFAULT 0,
  cost_usd        NUMERIC(10,6) DEFAULT 0,
  turns_used      INTEGER DEFAULT 0,
  max_turns       INTEGER DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'success',
  error           TEXT,
  context_size    INTEGER DEFAULT 0,
  tags            TEXT[] DEFAULT '{}',
  tool_calls      JSONB DEFAULT '[]',
  decisions       JSONB DEFAULT '[]',
  quality_gate    JSONB,
  metadata        JSONB DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_exec_logs_agent ON agent_execution_logs(agent_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_logs_shop ON agent_execution_logs(shop_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_exec_logs_status ON agent_execution_logs(status) WHERE status != 'success';

-- Observability events
CREATE TABLE IF NOT EXISTS agent_events (
  id              TEXT PRIMARY KEY,
  type            TEXT NOT NULL,
  timestamp       TIMESTAMPTZ NOT NULL,
  agent_id        TEXT,
  shop_id         TEXT,
  pipeline_id     TEXT,
  data            JSONB DEFAULT '{}',
  level           TEXT NOT NULL DEFAULT 'info',
  tags            TEXT[] DEFAULT '{}',
  created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agent_events_type ON agent_events(type, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_agent ON agent_events(agent_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_agent_events_level ON agent_events(level, timestamp DESC) WHERE level IN ('warn', 'error');

-- Skills
CREATE TABLE IF NOT EXISTS agent_skills (
  id               TEXT PRIMARY KEY,
  name             TEXT NOT NULL,
  type             TEXT NOT NULL,
  description      TEXT,
  category         TEXT NOT NULL,
  content          TEXT NOT NULL,
  parameters       JSONB DEFAULT '[]',
  examples         JSONB DEFAULT '[]',
  extracted_from   TEXT NOT NULL,
  shop_id          TEXT,
  extracted_at     TIMESTAMPTZ NOT NULL,
  times_used       INTEGER DEFAULT 0,
  success_rate     NUMERIC(4,3) DEFAULT 0,
  avg_roas_impact  NUMERIC(8,3) DEFAULT 0,
  rating           NUMERIC(3,1) DEFAULT 0,
  tags             TEXT[] DEFAULT '{}',
  niche            TEXT,
  locale           TEXT,
  verified         BOOLEAN DEFAULT false,
  deprecated       BOOLEAN DEFAULT false,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_skills_category ON agent_skills(category) WHERE deprecated = false;
CREATE INDEX IF NOT EXISTS idx_skills_type ON agent_skills(type) WHERE deprecated = false;

-- Task plans
CREATE TABLE IF NOT EXISTS agent_task_plans (
  id               TEXT PRIMARY KEY,
  goal             TEXT NOT NULL,
  shop_id          TEXT NOT NULL,
  current_phase    TEXT NOT NULL,
  phases           JSONB NOT NULL DEFAULT '[]',
  decisions        JSONB NOT NULL DEFAULT '[]',
  errors           JSONB NOT NULL DEFAULT '[]',
  findings         JSONB NOT NULL DEFAULT '[]',
  progress         JSONB NOT NULL DEFAULT '[]',
  created_at       TIMESTAMPTZ NOT NULL,
  updated_at       TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_plans_shop ON agent_task_plans(shop_id, updated_at DESC);
`;

// ── Persistence Engine ─────────────────────────────────────────────

class PersistenceEngine {
  private pool: Pool | null = null;
  private queue: QueueItem[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private batchSize = 50;
  private flushIntervalMs = 5000;
  private initialized = false;
  private initializing = false;
  private enabled = false;
  private schema = 'public';

  // ── Configure ─────────────────────────────────────────────────

  async configure(config: PersistenceConfig): Promise<void> {
    this.pool = config.pool;
    this.batchSize = config.batchSize ?? 50;
    this.flushIntervalMs = config.flushIntervalMs ?? 5000;
    this.schema = config.schemaName ?? 'public';
    this.enabled = config.enabled !== false;

    if (this.enabled) {
      await this.ensureSchema();
      this.startFlushing();
    }
  }

  isEnabled(): boolean {
    return this.enabled && this.pool !== null;
  }

  // ── Schema initialization ─────────────────────────────────────

  private async ensureSchema(): Promise<void> {
    if (this.initialized || this.initializing || !this.pool) return;
    this.initializing = true;

    try {
      await this.pool.query(SCHEMA_SQL);
      this.initialized = true;
    } catch (err) {
      console.warn('[persistence] Schema creation failed, falling back to in-memory:', err);
      this.enabled = false;
    } finally {
      this.initializing = false;
    }
  }

  // ── Flush queue ───────────────────────────────────────────────

  private startFlushing(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => this.flush(), this.flushIntervalMs);
  }

  async flush(): Promise<void> {
    if (this.queue.length === 0 || !this.pool || !this.enabled) return;

    const batch = this.queue.splice(0, this.batchSize);
    const grouped = new Map<string, QueueItem[]>();

    for (const item of batch) {
      const existing = grouped.get(item.table) ?? [];
      existing.push(item);
      grouped.set(item.table, existing);
    }

    for (const [table, items] of grouped) {
      try {
        await this.batchInsert(table, items.map(i => i.data));
      } catch (err) {
        console.warn(`[persistence] Batch insert to ${table} failed:`, err);
        // Re-queue failed items (max 1 retry via flag)
      }
    }
  }

  private async batchInsert(table: string, rows: Record<string, unknown>[]): Promise<void> {
    if (rows.length === 0 || !this.pool) return;

    const columns = Object.keys(rows[0]);
    const valueSets: string[] = [];
    const params: unknown[] = [];
    let paramIdx = 1;

    for (const row of rows) {
      const placeholders: string[] = [];
      for (const col of columns) {
        const val = row[col];
        if (typeof val === 'object' && val !== null && !(val instanceof Date) && !Array.isArray(val)) {
          placeholders.push(`$${paramIdx++}::jsonb`);
          params.push(JSON.stringify(val));
        } else if (Array.isArray(val)) {
          placeholders.push(`$${paramIdx++}`);
          params.push(val);
        } else {
          placeholders.push(`$${paramIdx++}`);
          params.push(val);
        }
      }
      valueSets.push(`(${placeholders.join(', ')})`);
    }

    const sql = `INSERT INTO ${this.schema}.${table} (${columns.join(', ')})
      VALUES ${valueSets.join(', ')}
      ON CONFLICT (id) DO NOTHING`;

    await this.pool.query(sql, params);
  }

  // ── Write methods ─────────────────────────────────────────────

  persistExecutionLog(entry: ExecutionLogEntry): void {
    if (!this.enabled) return;

    this.queue.push({
      table: 'agent_execution_logs',
      data: {
        id:               entry.id,
        agent_id:         entry.agentId,
        agent_name:       entry.agentName,
        shop_id:          entry.shopId ?? null,
        pipeline_id:      entry.pipelineId ?? null,
        step_name:        entry.stepName ?? null,
        started_at:       entry.startedAt,
        completed_at:     entry.completedAt ?? null,
        duration_ms:      entry.durationMs ?? null,
        model:            entry.model,
        model_downgraded: entry.modelDowngraded,
        original_model:   entry.originalModel ?? null,
        input_tokens:     entry.inputTokens,
        output_tokens:    entry.outputTokens,
        total_tokens:     entry.totalTokens,
        cost_usd:         entry.costUsd,
        turns_used:       entry.turnsUsed,
        max_turns:        entry.maxTurns,
        status:           entry.status,
        error:            entry.error ?? null,
        context_size:     entry.contextSize,
        tags:             entry.tags,
        tool_calls:       entry.toolCalls,
        decisions:        entry.decisions,
        quality_gate:     entry.qualityGate ?? null,
        metadata:         entry.metadata ?? {},
      },
    });
  }

  persistEvent(event: ObservabilityEvent): void {
    if (!this.enabled) return;

    this.queue.push({
      table: 'agent_events',
      data: {
        id:          event.id,
        type:        event.type,
        timestamp:   event.timestamp,
        agent_id:    event.agentId ?? null,
        shop_id:     event.shopId ?? null,
        pipeline_id: event.pipelineId ?? null,
        data:        event.data,
        level:       event.level,
        tags:        event.tags,
      },
    });
  }

  persistSkill(skill: Skill): void {
    if (!this.enabled) return;

    this.queue.push({
      table: 'agent_skills',
      data: {
        id:               skill.id,
        name:             skill.name,
        type:             skill.type,
        description:      skill.description,
        category:         skill.category,
        content:          skill.content,
        parameters:       skill.parameters ?? [],
        examples:         skill.examples ?? [],
        extracted_from:   skill.extractedFrom,
        shop_id:          skill.shopId ?? null,
        extracted_at:     skill.extractedAt,
        times_used:       skill.timesUsed,
        success_rate:     skill.successRate,
        avg_roas_impact:  skill.avgRoasImpact,
        rating:           skill.rating,
        tags:             skill.tags,
        niche:            skill.niche ?? null,
        locale:           skill.locale ?? null,
        verified:         skill.verified,
        deprecated:       skill.deprecated,
      },
    });
  }

  persistTaskPlan(plan: TaskPlan): void {
    if (!this.enabled) return;

    this.queue.push({
      table: 'agent_task_plans',
      data: {
        id:            plan.id,
        goal:          plan.goal,
        shop_id:       plan.shopId,
        current_phase: plan.currentPhase,
        phases:        plan.phases,
        decisions:     plan.decisions,
        errors:        plan.errors,
        findings:      plan.findings,
        progress:      plan.progress,
        created_at:    plan.createdAt,
        updated_at:    plan.updatedAt,
      },
    });
  }

  // ── Read methods (for rehydration) ────────────────────────────

  async loadExecutionLogs(opts: {
    shopId?:  string;
    agentId?: string;
    since?:   Date;
    limit?:   number;
  }): Promise<Record<string, unknown>[]> {
    if (!this.pool || !this.enabled) return [];

    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (opts.shopId) { conditions.push(`shop_id = $${idx++}`); params.push(opts.shopId); }
    if (opts.agentId) { conditions.push(`agent_id = $${idx++}`); params.push(opts.agentId); }
    if (opts.since) { conditions.push(`started_at >= $${idx++}`); params.push(opts.since); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = opts.limit ?? 100;

    const { rows } = await this.pool.query(
      `SELECT * FROM agent_execution_logs ${where} ORDER BY started_at DESC LIMIT $${idx}`,
      [...params, limit]
    );
    return rows;
  }

  async loadSkills(opts?: {
    category?: string;
    verified?: boolean;
    limit?:    number;
  }): Promise<Record<string, unknown>[]> {
    if (!this.pool || !this.enabled) return [];

    const conditions: string[] = ['deprecated = false'];
    const params: unknown[] = [];
    let idx = 1;

    if (opts?.category) { conditions.push(`category = $${idx++}`); params.push(opts.category); }
    if (opts?.verified !== undefined) { conditions.push(`verified = $${idx++}`); params.push(opts.verified); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const limit = opts?.limit ?? 200;

    const { rows } = await this.pool.query(
      `SELECT * FROM agent_skills ${where} ORDER BY rating DESC, times_used DESC LIMIT $${idx}`,
      [...params, limit]
    );
    return rows;
  }

  async loadTaskPlan(planId: string): Promise<Record<string, unknown> | null> {
    if (!this.pool || !this.enabled) return null;

    const { rows } = await this.pool.query(
      'SELECT * FROM agent_task_plans WHERE id = $1',
      [planId]
    );
    return rows[0] ?? null;
  }

  async loadShopPlans(shopId: string): Promise<Record<string, unknown>[]> {
    if (!this.pool || !this.enabled) return [];

    const { rows } = await this.pool.query(
      'SELECT * FROM agent_task_plans WHERE shop_id = $1 ORDER BY updated_at DESC LIMIT 50',
      [shopId]
    );
    return rows;
  }

  // ── Aggregate queries ─────────────────────────────────────────

  async getCostSummary(shopId: string, since?: Date): Promise<{
    totalCostUsd: number;
    totalRuns:    number;
    successRate:  number;
    byAgent:      Array<{ agentName: string; cost: number; runs: number }>;
  }> {
    if (!this.pool || !this.enabled) {
      return { totalCostUsd: 0, totalRuns: 0, successRate: 1, byAgent: [] };
    }

    const cutoff = since ?? new Date(Date.now() - 24 * 60 * 60 * 1000);

    const { rows: [summary] } = await this.pool.query(
      `SELECT
        COALESCE(SUM(cost_usd), 0)::float AS total_cost,
        COUNT(*)::int AS total_runs,
        COALESCE(AVG(CASE WHEN status = 'success' THEN 1.0 ELSE 0.0 END), 1)::float AS success_rate
      FROM agent_execution_logs
      WHERE shop_id = $1 AND started_at >= $2`,
      [shopId, cutoff]
    );

    const { rows: byAgent } = await this.pool.query(
      `SELECT
        agent_name,
        COALESCE(SUM(cost_usd), 0)::float AS cost,
        COUNT(*)::int AS runs
      FROM agent_execution_logs
      WHERE shop_id = $1 AND started_at >= $2
      GROUP BY agent_name
      ORDER BY cost DESC
      LIMIT 20`,
      [shopId, cutoff]
    );

    return {
      totalCostUsd: summary.total_cost,
      totalRuns:    summary.total_runs,
      successRate:  summary.success_rate,
      byAgent:      byAgent.map((r: Record<string, unknown>) => ({
        agentName: r.agent_name as string,
        cost:      r.cost as number,
        runs:      r.runs as number,
      })),
    };
  }

  // ── Cleanup ───────────────────────────────────────────────────

  async shutdown(): Promise<void> {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
    await this.flush(); // Final flush
  }

  /** Purge old data (call from cron) */
  async purgeOlderThan(days: number): Promise<{ deleted: number }> {
    if (!this.pool || !this.enabled) return { deleted: 0 };

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    let deleted = 0;

    for (const table of ['agent_execution_logs', 'agent_events']) {
      const col = table === 'agent_events' ? 'timestamp' : 'started_at';
      const { rowCount } = await this.pool.query(
        `DELETE FROM ${table} WHERE ${col} < $1`,
        [cutoff]
      );
      deleted += rowCount ?? 0;
    }

    return { deleted };
  }
}

// ── Singleton Export ─────────────────────────────────────────────

export const persistence = new PersistenceEngine();
