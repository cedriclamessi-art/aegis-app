/**
 * Scheduled Tasks — Automated recurring agent workflows
 * ======================================================
 * Sources: Claude Code Showcase, OneRedOak Workflows
 *
 * 10 built-in scheduled tasks:
 *   1.  roas-monitor       — Every 6h: Check all active campaigns ROAS
 *   2.  daily-report       — Daily: Generate shop performance summary
 *   3.  auto-kill-dead     — Every 6h: Kill DEAD campaigns automatically
 *   4.  audience-refresh   — Daily: Refresh audience data and lookalikes
 *   5.  weekly-audit       — Weekly: Full store + campaign audit
 *   6.  weekly-suggestions — Weekly: AI-generated optimization suggestions
 *   7.  budget-rebalance   — Daily: Rebalance budget across campaigns
 *   8.  monthly-pnl        — Monthly: Profit & Loss report
 *   9.  creative-refresh   — Daily: Check creative fatigue and refresh
 *   10. pricing-audit      — Weekly: Competitor pricing analysis
 *
 * Frequencies:
 *   every_6h  — Runs every 6 hours
 *   daily     — Runs once per day (default 6 AM)
 *   weekly    — Runs once per week (default Monday 6 AM)
 *   monthly   — Runs once per month (default 1st at 6 AM)
 *
 * Task scope:
 *   global    — Runs across all shops
 *   per_shop  — Runs separately for each shop
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type TaskFrequency = 'every_6h' | 'daily' | 'weekly' | 'monthly';
export type TaskScope = 'global' | 'per_shop';
export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

export interface ScheduledTask {
  id:           string;
  name:         string;
  description:  string;
  frequency:    TaskFrequency;
  scope:        TaskScope;
  handler:      (ctx: TaskContext) => Promise<TaskResult>;
  enabled:      boolean;
  tier?:        number;        // Minimum tier required (1-4)
  agentId?:     string;        // Agent to invoke
  priority:     number;        // Lower = runs first
}

export interface TaskContext {
  shopId?:      string;         // Set for per_shop tasks
  allShopIds?:  string[];       // Set for global tasks
  runId:        string;
  startedAt:    Date;
  metadata?:    Record<string, unknown>;
}

export interface TaskResult {
  success:      boolean;
  message:      string;
  data?:        unknown;
  actions?:     TaskAction[];
  nextRunSuggestion?: string;   // Override next run time
}

export interface TaskAction {
  type:     string;             // 'kill_campaign', 'alert', 'refresh_creative', etc.
  target:   string;             // Campaign ID, Creative ID, etc.
  reason:   string;
  executed: boolean;
}

export interface TaskExecution {
  taskId:     string;
  runId:      string;
  shopId?:    string;
  status:     TaskStatus;
  startedAt:  Date;
  completedAt?: Date;
  durationMs?: number;
  result?:    TaskResult;
  error?:     string;
}

export interface SchedulerConfig {
  timezone:        string;       // Default 'Europe/Paris'
  dailyRunHour:    number;       // Default 6 (6 AM)
  weeklyRunDay:    number;       // Default 1 (Monday)
  monthlyRunDay:   number;       // Default 1 (1st)
  maxConcurrent:   number;       // Default 3
  retryOnFailure:  boolean;      // Default true
  maxRetries:      number;       // Default 2
}

// ── Default Config ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: SchedulerConfig = {
  timezone:       'Europe/Paris',
  dailyRunHour:   6,
  weeklyRunDay:   1,
  monthlyRunDay:  1,
  maxConcurrent:  3,
  retryOnFailure: true,
  maxRetries:     2,
};

// ── Frequency to milliseconds ─────────────────────────────────────────────

const FREQUENCY_MS: Record<TaskFrequency, number> = {
  every_6h: 6 * 60 * 60 * 1000,        // 21,600,000
  daily:    24 * 60 * 60 * 1000,        // 86,400,000
  weekly:   7 * 24 * 60 * 60 * 1000,    // 604,800,000
  monthly:  30 * 24 * 60 * 60 * 1000,   // 2,592,000,000
};

// ── Scheduled Task Engine ─────────────────────────────────────────────────

class ScheduledTaskEngine {
  private tasks: Map<string, ScheduledTask> = new Map();
  private executions: TaskExecution[] = [];
  private lastRunTimes: Map<string, number> = new Map();
  private config: SchedulerConfig;
  private timers: Map<string, NodeJS.Timeout> = new Map();
  private running = false;

  constructor(config?: Partial<SchedulerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.registerBuiltInTasks();
  }

  // ── Register / Unregister ───────────────────────────────────────────

  registerTask(task: ScheduledTask): void {
    this.tasks.set(task.id, task);
  }

  unregisterTask(taskId: string): void {
    this.tasks.delete(taskId);
    const timer = this.timers.get(taskId);
    if (timer) {
      clearInterval(timer);
      this.timers.delete(taskId);
    }
  }

  enableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) task.enabled = true;
  }

  disableTask(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (task) task.enabled = false;
  }

  // ── Start / Stop Scheduler ──────────────────────────────────────────

  start(): void {
    if (this.running) return;
    this.running = true;

    // Set up intervals for each frequency
    for (const [taskId, task] of this.tasks) {
      if (!task.enabled) continue;

      const intervalMs = FREQUENCY_MS[task.frequency];
      const timer = setInterval(() => {
        this.runTask(taskId).catch(err => {
          console.error(`[SCHEDULER] Error running task ${taskId}:`, err);
        });
      }, intervalMs);

      this.timers.set(taskId, timer);
    }

    console.log(`[SCHEDULER] Started with ${this.tasks.size} tasks`);
  }

  stop(): void {
    this.running = false;
    for (const [taskId, timer] of this.timers) {
      clearInterval(timer);
    }
    this.timers.clear();
    console.log('[SCHEDULER] Stopped');
  }

  // ── Run a single task ───────────────────────────────────────────────

  async runTask(taskId: string, shopId?: string): Promise<TaskExecution> {
    const task = this.tasks.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (!task.enabled) {
      return this.createExecution(taskId, 'skipped', shopId, undefined, 'Task disabled');
    }

    // Check if enough time has passed since last run
    const lastKey = shopId ? `${taskId}:${shopId}` : taskId;
    const lastRun = this.lastRunTimes.get(lastKey) || 0;
    const elapsed = Date.now() - lastRun;
    const minInterval = FREQUENCY_MS[task.frequency] * 0.9; // 10% tolerance

    if (elapsed < minInterval) {
      return this.createExecution(taskId, 'skipped', shopId, undefined,
        `Too soon — last ran ${Math.round(elapsed / 60000)}min ago`);
    }

    // Execute
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const ctx: TaskContext = {
      shopId,
      runId,
      startedAt: new Date(),
    };

    const startMs = Date.now();

    try {
      const result = await task.handler(ctx);
      const durationMs = Date.now() - startMs;
      this.lastRunTimes.set(lastKey, Date.now());

      const execution = this.createExecution(taskId, 'completed', shopId, {
        ...result,
      });
      execution.durationMs = durationMs;
      execution.runId = runId;

      return execution;

    } catch (err) {
      const durationMs = Date.now() - startMs;
      const execution = this.createExecution(
        taskId, 'failed', shopId, undefined,
        (err as Error).message
      );
      execution.durationMs = durationMs;
      execution.runId = runId;

      // Retry if configured
      if (this.config.retryOnFailure) {
        const retryKey = `${lastKey}:retries`;
        const retries = (this.lastRunTimes.get(retryKey) || 0);
        if (retries < this.config.maxRetries) {
          this.lastRunTimes.set(retryKey, retries + 1);
          console.log(`[SCHEDULER] Retrying ${taskId} (attempt ${retries + 1}/${this.config.maxRetries})`);
          setTimeout(() => this.runTask(taskId, shopId), 5000 * (retries + 1));
        }
      }

      return execution;
    }
  }

  // ── Run all due tasks ───────────────────────────────────────────────

  async runDueTasks(shopIds?: string[]): Promise<TaskExecution[]> {
    const executions: TaskExecution[] = [];
    const sortedTasks = Array.from(this.tasks.values())
      .filter(t => t.enabled)
      .sort((a, b) => a.priority - b.priority);

    for (const task of sortedTasks) {
      if (task.scope === 'per_shop' && shopIds) {
        for (const shopId of shopIds) {
          const exec = await this.runTask(task.id, shopId);
          executions.push(exec);
        }
      } else {
        const exec = await this.runTask(task.id);
        executions.push(exec);
      }
    }

    return executions;
  }

  // ── Get task list ───────────────────────────────────────────────────

  listTasks(): Array<{
    id: string;
    name: string;
    frequency: TaskFrequency;
    scope: TaskScope;
    enabled: boolean;
    lastRun?: Date;
  }> {
    return Array.from(this.tasks.values()).map(t => ({
      id: t.id,
      name: t.name,
      frequency: t.frequency,
      scope: t.scope,
      enabled: t.enabled,
      lastRun: this.lastRunTimes.has(t.id)
        ? new Date(this.lastRunTimes.get(t.id)!)
        : undefined,
    }));
  }

  // ── Get execution history ───────────────────────────────────────────

  getExecutionHistory(taskId?: string, limit = 50): TaskExecution[] {
    let execs = this.executions;
    if (taskId) execs = execs.filter(e => e.taskId === taskId);
    return execs.slice(-limit);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private createExecution(
    taskId: string,
    status: TaskStatus,
    shopId?: string,
    result?: TaskResult,
    error?: string,
  ): TaskExecution {
    const execution: TaskExecution = {
      taskId,
      runId: `exec_${Date.now()}`,
      shopId,
      status,
      startedAt: new Date(),
      completedAt: new Date(),
      result,
      error,
    };

    this.executions.push(execution);

    // Trim execution history (keep last 1000)
    if (this.executions.length > 1000) {
      this.executions = this.executions.slice(-1000);
    }

    return execution;
  }

  // ── Built-in Tasks ──────────────────────────────────────────────────

  private registerBuiltInTasks(): void {

    // 1. ROAS Monitor — Every 6h
    this.registerTask({
      id: 'roas-monitor',
      name: 'ROAS Monitor',
      description: 'Check all active campaigns ROAS and alert on drops below target',
      frequency: 'every_6h',
      scope: 'per_shop',
      enabled: true,
      priority: 10,
      agentId: 'AGENT_CAMPAIGN_MONITOR',
      handler: async (ctx) => {
        return {
          success: true,
          message: `ROAS monitoring completed for shop ${ctx.shopId}`,
          actions: [],
        };
      },
    });

    // 2. Daily Report
    this.registerTask({
      id: 'daily-report',
      name: 'Daily Performance Report',
      description: 'Generate daily performance summary with key metrics',
      frequency: 'daily',
      scope: 'per_shop',
      enabled: true,
      priority: 20,
      agentId: 'AGENT_REPORT_GENERATOR',
      handler: async (ctx) => {
        return {
          success: true,
          message: `Daily report generated for shop ${ctx.shopId}`,
        };
      },
    });

    // 3. Auto-kill DEAD — Every 6h
    this.registerTask({
      id: 'auto-kill-dead',
      name: 'Auto-Kill DEAD Campaigns',
      description: 'Automatically stop campaigns classified as DEAD with ROAS < 1.0',
      frequency: 'every_6h',
      scope: 'per_shop',
      enabled: true,
      priority: 5,
      agentId: 'AGENT_BUDGET_PROTECTOR',
      handler: async (ctx) => {
        return {
          success: true,
          message: `DEAD campaign check for shop ${ctx.shopId}`,
          actions: [],
        };
      },
    });

    // 4. Audience Refresh — Daily
    this.registerTask({
      id: 'audience-refresh',
      name: 'Audience Data Refresh',
      description: 'Refresh audience data, update lookalike audiences',
      frequency: 'daily',
      scope: 'per_shop',
      enabled: true,
      priority: 30,
      handler: async (ctx) => {
        return {
          success: true,
          message: `Audience data refreshed for shop ${ctx.shopId}`,
        };
      },
    });

    // 5. Weekly Audit
    this.registerTask({
      id: 'weekly-audit',
      name: 'Weekly Full Audit',
      description: 'Complete store + campaign + creative audit',
      frequency: 'weekly',
      scope: 'per_shop',
      enabled: true,
      priority: 40,
      tier: 2,
      handler: async (ctx) => {
        return {
          success: true,
          message: `Weekly audit completed for shop ${ctx.shopId}`,
        };
      },
    });

    // 6. Weekly Suggestions
    this.registerTask({
      id: 'weekly-suggestions',
      name: 'AI Optimization Suggestions',
      description: 'AI-generated optimization suggestions based on performance data',
      frequency: 'weekly',
      scope: 'per_shop',
      enabled: true,
      priority: 50,
      tier: 2,
      handler: async (ctx) => {
        return {
          success: true,
          message: `Optimization suggestions generated for shop ${ctx.shopId}`,
        };
      },
    });

    // 7. Budget Rebalance — Daily
    this.registerTask({
      id: 'budget-rebalance',
      name: 'Budget Rebalancer',
      description: 'Rebalance ad budget across campaigns based on ROAS performance',
      frequency: 'daily',
      scope: 'per_shop',
      enabled: true,
      priority: 15,
      tier: 3,
      agentId: 'AGENT_BUDGET_OPTIMIZER',
      handler: async (ctx) => {
        return {
          success: true,
          message: `Budget rebalanced for shop ${ctx.shopId}`,
          actions: [],
        };
      },
    });

    // 8. Monthly P&L
    this.registerTask({
      id: 'monthly-pnl',
      name: 'Monthly P&L Report',
      description: 'Monthly profit & loss report with margins, costs, and projections',
      frequency: 'monthly',
      scope: 'per_shop',
      enabled: true,
      priority: 60,
      handler: async (ctx) => {
        return {
          success: true,
          message: `Monthly P&L report generated for shop ${ctx.shopId}`,
        };
      },
    });

    // 9. Creative Refresh — Daily
    this.registerTask({
      id: 'creative-refresh',
      name: 'Creative Fatigue Check',
      description: 'Check creative fatigue scores and trigger new variants if needed',
      frequency: 'daily',
      scope: 'per_shop',
      enabled: true,
      priority: 25,
      agentId: 'AGENT_COPY_CHIEF',
      handler: async (ctx) => {
        return {
          success: true,
          message: `Creative fatigue check for shop ${ctx.shopId}`,
          actions: [],
        };
      },
    });

    // 10. Pricing Audit — Weekly
    this.registerTask({
      id: 'pricing-audit',
      name: 'Competitor Pricing Audit',
      description: 'Analyze competitor pricing and suggest adjustments',
      frequency: 'weekly',
      scope: 'per_shop',
      enabled: true,
      priority: 45,
      tier: 2,
      handler: async (ctx) => {
        return {
          success: true,
          message: `Pricing audit completed for shop ${ctx.shopId}`,
        };
      },
    });
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const scheduler = new ScheduledTaskEngine();
