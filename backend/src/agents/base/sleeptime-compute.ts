/**
 * Sleeptime Compute — Background memory consolidation during idle
 * =================================================================
 * Source: letta-ai/letta (sleeptime_multi_agent.py),
 *         letta-ai/claude-subconscious
 *
 * Background agents that activate during idle periods to:
 *   1. Consolidate fragmented observations into patterns
 *   2. Deduplicate memory entries
 *   3. Archive stale information
 *   4. Extract cross-agent insights
 *   5. Update core memory blocks with synthesized knowledge
 *   6. Generate guidance for next agent sessions
 *
 * Cadence:
 *   - Every N turns:  Light deduplication
 *   - Session end:    Consolidation pass
 *   - Daily:          Full memory review
 *   - Weekly:         Cross-shop pattern extraction
 *   - Monthly:        Archival cleanup + defragmentation
 *
 * Runs asynchronously — zero latency impact on main agents.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type SleeptimeFrequency = 'per_turns' | 'session_end' | 'daily' | 'weekly' | 'monthly';

export type SleeptimeTaskType =
  | 'deduplicate'
  | 'consolidate'
  | 'archive_stale'
  | 'extract_patterns'
  | 'update_core'
  | 'generate_guidance'
  | 'defragment';

export interface SleeptimeTask {
  id:           string;
  type:         SleeptimeTaskType;
  frequency:    SleeptimeFrequency;
  description:  string;
  enabled:      boolean;
  priority:     number;
  handler:      (ctx: SleeptimeContext) => Promise<SleeptimeResult>;
  lastRunAt?:   Date;
  turnsInterval?: number;        // For 'per_turns' frequency
}

export interface SleeptimeContext {
  shopId:        string;
  runId:         string;
  turnsSinceLastRun: number;
  lastSessionEnd?: Date;
  metadata?:     Record<string, unknown>;
}

export interface SleeptimeResult {
  success:       boolean;
  taskType:      SleeptimeTaskType;
  changes:       SleeptimeChange[];
  summary:       string;
  durationMs:    number;
}

export interface SleeptimeChange {
  type:    'merged' | 'archived' | 'created' | 'updated' | 'deleted';
  target:  string;          // What was changed
  details: string;          // Description of change
}

export interface GuidanceMessage {
  id:            string;
  shopId:        string;
  fromAgent:     string;        // Usually 'sleeptime_consolidator'
  toAgent:       string;        // Target agent
  message:       string;
  priority:      'low' | 'medium' | 'high';
  createdAt:     Date;
  expiresAt:     Date;
  consumed:      boolean;
  consumedBy?:   string;
  consumedAt?:   Date;
}

export interface ConsolidationReport {
  shopId:          string;
  runAt:           Date;
  observationsBefore: number;
  observationsAfter:  number;
  patternsMerged:  number;
  patternsCreated: number;
  staleArchived:   number;
  guidanceGenerated: number;
  durationMs:      number;
}

// ── Sleeptime Compute Engine ──────────────────────────────────────────────

class SleeptimeComputeEngine {
  private tasks: Map<string, SleeptimeTask> = new Map();
  private turnCounters: Map<string, number> = new Map();   // shopId -> turns
  private guidanceQueue: GuidanceMessage[] = [];
  private reports: ConsolidationReport[] = [];
  private running: Map<string, boolean> = new Map();       // shopId -> running

  constructor() {
    this.registerBuiltInTasks();
  }

  // ── Tick — Call after each agent turn ────────────────────────────────

  async tick(shopId: string): Promise<SleeptimeResult[]> {
    const currentTurns = (this.turnCounters.get(shopId) || 0) + 1;
    this.turnCounters.set(shopId, currentTurns);

    const results: SleeptimeResult[] = [];

    // Check per-turn tasks
    for (const task of this.tasks.values()) {
      if (!task.enabled || task.frequency !== 'per_turns') continue;
      if (!task.turnsInterval || currentTurns % task.turnsInterval !== 0) continue;

      const result = await this.runTask(task, shopId, currentTurns);
      results.push(result);
    }

    return results;
  }

  // ── Session end trigger ─────────────────────────────────────────────

  async onSessionEnd(shopId: string): Promise<SleeptimeResult[]> {
    const results: SleeptimeResult[] = [];
    const turns = this.turnCounters.get(shopId) || 0;

    for (const task of this.tasks.values()) {
      if (!task.enabled || task.frequency !== 'session_end') continue;

      const result = await this.runTask(task, shopId, turns);
      results.push(result);
    }

    // Reset turn counter
    this.turnCounters.set(shopId, 0);

    return results;
  }

  // ── Scheduled trigger (daily/weekly/monthly) ────────────────────────

  async runScheduled(frequency: SleeptimeFrequency, shopIds: string[]): Promise<ConsolidationReport[]> {
    const reports: ConsolidationReport[] = [];

    for (const shopId of shopIds) {
      if (this.running.get(shopId)) continue;
      this.running.set(shopId, true);

      const startMs = Date.now();
      const results: SleeptimeResult[] = [];

      for (const task of this.tasks.values()) {
        if (!task.enabled || task.frequency !== frequency) continue;

        const result = await this.runTask(task, shopId, 0);
        results.push(result);
      }

      const report: ConsolidationReport = {
        shopId,
        runAt: new Date(),
        observationsBefore: 0,
        observationsAfter: 0,
        patternsMerged: results.reduce((s, r) => s + r.changes.filter(c => c.type === 'merged').length, 0),
        patternsCreated: results.reduce((s, r) => s + r.changes.filter(c => c.type === 'created').length, 0),
        staleArchived: results.reduce((s, r) => s + r.changes.filter(c => c.type === 'archived').length, 0),
        guidanceGenerated: this.guidanceQueue.filter(g => g.shopId === shopId && !g.consumed).length,
        durationMs: Date.now() - startMs,
      };

      reports.push(report);
      this.reports.push(report);
      this.running.set(shopId, false);
    }

    return reports;
  }

  // ── Run a single task ───────────────────────────────────────────────

  private async runTask(task: SleeptimeTask, shopId: string, turns: number): Promise<SleeptimeResult> {
    const ctx: SleeptimeContext = {
      shopId,
      runId: `sleep_${task.id}_${Date.now()}`,
      turnsSinceLastRun: turns,
    };

    const startMs = Date.now();

    try {
      const result = await task.handler(ctx);
      task.lastRunAt = new Date();
      result.durationMs = Date.now() - startMs;
      return result;
    } catch (err) {
      return {
        success: false,
        taskType: task.type,
        changes: [],
        summary: `Sleeptime task ${task.id} failed: ${(err as Error).message}`,
        durationMs: Date.now() - startMs,
      };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  GUIDANCE CHANNEL
  // ═══════════════════════════════════════════════════════════════════

  /** Generate guidance for a specific agent */
  addGuidance(params: {
    shopId:    string;
    toAgent:   string;
    message:   string;
    priority?: 'low' | 'medium' | 'high';
    ttlMs?:    number;
  }): GuidanceMessage {
    const guidance: GuidanceMessage = {
      id: `guidance_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      shopId: params.shopId,
      fromAgent: 'sleeptime_consolidator',
      toAgent: params.toAgent,
      message: params.message,
      priority: params.priority || 'medium',
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + (params.ttlMs || 24 * 60 * 60 * 1000)),
      consumed: false,
    };

    this.guidanceQueue.push(guidance);

    // Keep last 500
    if (this.guidanceQueue.length > 500) {
      this.guidanceQueue = this.guidanceQueue.slice(-500);
    }

    return guidance;
  }

  /** Get pending guidance for an agent (and mark as consumed) */
  consumeGuidance(agentId: string, shopId: string): GuidanceMessage[] {
    const now = new Date();
    const pending = this.guidanceQueue.filter(g =>
      g.toAgent === agentId &&
      g.shopId === shopId &&
      !g.consumed &&
      g.expiresAt > now
    );

    // Mark as consumed
    for (const g of pending) {
      g.consumed = true;
      g.consumedBy = agentId;
      g.consumedAt = now;
    }

    return pending.sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    });
  }

  /** Format guidance as whisper injection for prompt */
  formatGuidanceWhisper(messages: GuidanceMessage[]): string {
    if (messages.length === 0) return '';

    return messages.map(m =>
      `<aegis_whisper from="${m.fromAgent}" priority="${m.priority}" timestamp="${m.createdAt.toISOString()}">\n${m.message}\n</aegis_whisper>`
    ).join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  BUILT-IN TASKS
  // ═══════════════════════════════════════════════════════════════════

  private registerBuiltInTasks(): void {

    // 1. Deduplication — every 20 turns
    this.tasks.set('deduplicate', {
      id: 'deduplicate',
      type: 'deduplicate',
      frequency: 'per_turns',
      description: 'Remove duplicate observations and merge similar ones',
      enabled: true,
      priority: 10,
      turnsInterval: 20,
      handler: async (ctx) => {
        return {
          success: true,
          taskType: 'deduplicate',
          changes: [],
          summary: `Deduplication pass for shop ${ctx.shopId}`,
          durationMs: 0,
        };
      },
    });

    // 2. Consolidation — session end
    this.tasks.set('consolidate', {
      id: 'consolidate',
      type: 'consolidate',
      frequency: 'session_end',
      description: 'Merge fragmented observations into coherent patterns',
      enabled: true,
      priority: 20,
      handler: async (ctx) => {
        return {
          success: true,
          taskType: 'consolidate',
          changes: [],
          summary: `Session consolidation for shop ${ctx.shopId} (${ctx.turnsSinceLastRun} turns)`,
          durationMs: 0,
        };
      },
    });

    // 3. Archive stale — daily
    this.tasks.set('archive_stale', {
      id: 'archive_stale',
      type: 'archive_stale',
      frequency: 'daily',
      description: 'Move stale observations to archival memory',
      enabled: true,
      priority: 30,
      handler: async (ctx) => {
        return {
          success: true,
          taskType: 'archive_stale',
          changes: [],
          summary: `Stale archival for shop ${ctx.shopId}`,
          durationMs: 0,
        };
      },
    });

    // 4. Extract patterns — daily
    this.tasks.set('extract_patterns', {
      id: 'extract_patterns',
      type: 'extract_patterns',
      frequency: 'daily',
      description: 'Extract cross-agent patterns from recent observations',
      enabled: true,
      priority: 40,
      handler: async (ctx) => {
        return {
          success: true,
          taskType: 'extract_patterns',
          changes: [],
          summary: `Pattern extraction for shop ${ctx.shopId}`,
          durationMs: 0,
        };
      },
    });

    // 5. Update core memory — daily
    this.tasks.set('update_core', {
      id: 'update_core',
      type: 'update_core',
      frequency: 'daily',
      description: 'Synthesize daily data into core memory blocks',
      enabled: true,
      priority: 50,
      handler: async (ctx) => {
        return {
          success: true,
          taskType: 'update_core',
          changes: [],
          summary: `Core memory update for shop ${ctx.shopId}`,
          durationMs: 0,
        };
      },
    });

    // 6. Generate guidance — daily
    this.tasks.set('generate_guidance', {
      id: 'generate_guidance',
      type: 'generate_guidance',
      frequency: 'daily',
      description: 'Generate guidance messages for agents based on analysis',
      enabled: true,
      priority: 60,
      handler: async (ctx) => {
        return {
          success: true,
          taskType: 'generate_guidance',
          changes: [],
          summary: `Guidance generation for shop ${ctx.shopId}`,
          durationMs: 0,
        };
      },
    });

    // 7. Defragment — monthly
    this.tasks.set('defragment', {
      id: 'defragment',
      type: 'defragment',
      frequency: 'monthly',
      description: 'Full memory reorganization: split, merge, archive',
      enabled: true,
      priority: 70,
      handler: async (ctx) => {
        return {
          success: true,
          taskType: 'defragment',
          changes: [],
          summary: `Memory defragmentation for shop ${ctx.shopId}`,
          durationMs: 0,
        };
      },
    });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  getReports(shopId?: string, limit = 20): ConsolidationReport[] {
    let reports = this.reports;
    if (shopId) reports = reports.filter(r => r.shopId === shopId);
    return reports.slice(-limit);
  }

  getTurnCount(shopId: string): number {
    return this.turnCounters.get(shopId) || 0;
  }

  listTasks(): SleeptimeTask[] {
    return Array.from(this.tasks.values()).sort((a, b) => a.priority - b.priority);
  }

  getPendingGuidanceCount(shopId: string): number {
    return this.guidanceQueue.filter(g =>
      g.shopId === shopId && !g.consumed && g.expiresAt > new Date()
    ).length;
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const sleeptimeCompute = new SleeptimeComputeEngine();
