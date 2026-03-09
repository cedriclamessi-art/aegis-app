/**
 * SubAgentOrchestrator — Multi-agent coordination engine
 * ========================================================
 * Inspired by: dl-ezo/claude-code-sub-agents (35 sub-agent definitions)
 *
 * Implements:
 * - Supervisor pattern with worker pool (max concurrency)
 * - Phase-gated pipeline with quality gates
 * - Parallel fan-out / fan-in execution
 * - Event-driven reactive coordination
 * - Dependency-aware task scheduling (DAG)
 * - Result aggregation with confidence weighting
 * - Retry with model escalation
 */

// ── Types ──────────────────────────────────────────────────────────

export type AgentResultStatus = 'success' | 'partial' | 'failed';

export interface SubAgentResult<T = unknown> {
  agentName:      string;
  taskId:         string;
  status:         AgentResultStatus;
  data:           T;
  confidence:     number;       // 0.0 - 1.0
  processingMs:   number;
  warnings:       string[];
  retryCount:     number;
  model:          string;
}

export interface WorkerTask {
  id:             string;
  agentName:      string;
  prompt:         string;
  priority:       number;       // Higher = run first
  dependencies:   string[];     // Task IDs that must complete first
  timeoutMs:      number;
  model?:         'haiku' | 'sonnet' | 'opus';
  maxRetries?:    number;
  context?:       Record<string, unknown>;
}

export interface PipelinePhase {
  name:           string;
  agents:         string[];
  parallel:       boolean;
  qualityGate:    (results: SubAgentResult[]) => boolean;
  rollbackFn?:    () => Promise<void>;
  timeoutMs?:     number;
}

export interface OrchestratorEvent {
  type:           string;
  agentName?:     string;
  taskId?:        string;
  data:           unknown;
  timestamp:      Date;
}

export type EventHandler = (event: OrchestratorEvent) => Promise<void>;
export type AgentExecutor = (agentName: string, prompt: string, model?: string) => Promise<string>;

// ── Event Bus ──────────────────────────────────────────────────────

class AgentEventBus {
  private handlers = new Map<string, EventHandler[]>();
  private history: OrchestratorEvent[] = [];

  on(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  off(eventType: string, handler: EventHandler): void {
    const existing = this.handlers.get(eventType) ?? [];
    this.handlers.set(eventType, existing.filter(h => h !== handler));
  }

  async emit(event: OrchestratorEvent): Promise<void> {
    this.history.push(event);
    if (this.history.length > 500) this.history = this.history.slice(-250);

    const handlers = this.handlers.get(event.type) ?? [];
    const wildcardHandlers = this.handlers.get('*') ?? [];

    await Promise.allSettled([
      ...handlers.map(h => h(event)),
      ...wildcardHandlers.map(h => h(event)),
    ]);
  }

  getHistory(opts?: { type?: string; limit?: number }): OrchestratorEvent[] {
    let result = this.history;
    if (opts?.type) result = result.filter(e => e.type === opts.type);
    if (opts?.limit) result = result.slice(-opts.limit);
    return result;
  }
}

// ── Result Aggregator ──────────────────────────────────────────────

export function aggregateResults(results: SubAgentResult[]): {
  overallStatus:    AgentResultStatus;
  overallConfidence: number;
  successCount:     number;
  failCount:        number;
  actionItems:      string[];
  summary:          string;
} {
  const successful = results.filter(r => r.status !== 'failed');
  const failed = results.filter(r => r.status === 'failed');

  const weightedConfidence = successful.length > 0
    ? successful.reduce((sum, r) => sum + r.confidence * (r.status === 'success' ? 1 : 0.5), 0) / successful.length
    : 0;

  const overallStatus: AgentResultStatus =
    failed.length === results.length ? 'failed' :
    failed.length > 0 ? 'partial' : 'success';

  const actionItems: string[] = [];
  for (const r of results) {
    if (r.warnings.length > 0) {
      actionItems.push(`[${r.agentName}] ${r.warnings.join('; ')}`);
    }
  }

  return {
    overallStatus,
    overallConfidence: Math.round(weightedConfidence * 100) / 100,
    successCount: successful.length,
    failCount: failed.length,
    actionItems,
    summary: `${successful.length}/${results.length} agents succeeded (confidence: ${(weightedConfidence * 100).toFixed(0)}%)`,
  };
}

// ── Sub-Agent Orchestrator ─────────────────────────────────────────

class SubAgentOrchestratorEngine {
  private completedTasks = new Map<string, SubAgentResult>();
  private runningTasks = new Set<string>();
  private eventBus = new AgentEventBus();
  private executor: AgentExecutor | null = null;
  private maxConcurrency = 5;

  // ── Configuration ─────────────────────────────────────────────

  setExecutor(fn: AgentExecutor): void {
    this.executor = fn;
  }

  setMaxConcurrency(n: number): void {
    this.maxConcurrency = Math.max(1, Math.min(n, 20));
  }

  // ── Events ────────────────────────────────────────────────────

  on(eventType: string, handler: EventHandler): void {
    this.eventBus.on(eventType, handler);
  }

  // ── Execute Single Agent (with retries + escalation) ──────────

  async executeAgent(
    agentName: string,
    prompt: string,
    opts?: { model?: string; maxRetries?: number; timeoutMs?: number },
  ): Promise<SubAgentResult> {
    const maxRetries = opts?.maxRetries ?? 3;
    const model = opts?.model ?? 'sonnet';
    const models = ['haiku', 'sonnet', 'opus'];
    const startTime = Date.now();
    let lastError = '';
    let retryCount = 0;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        // Escalate model on later retries
        const currentModel = attempt >= 2
          ? models[Math.min(models.indexOf(model) + 1, models.length - 1)]
          : model;

        const enrichedPrompt = lastError
          ? `${prompt}\n\n[RETRY ${attempt + 1}] Previous attempt failed: ${lastError}. Try a different approach.`
          : prompt;

        if (!this.executor) throw new Error('No executor configured');

        const rawResult = await Promise.race([
          this.executor(agentName, enrichedPrompt, currentModel),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), opts?.timeoutMs ?? 60_000)
          ),
        ]);

        const result: SubAgentResult = {
          agentName,
          taskId: `task_${Date.now()}`,
          status: 'success',
          data: rawResult,
          confidence: attempt === 0 ? 0.9 : 0.7,
          processingMs: Date.now() - startTime,
          warnings: lastError ? [`Recovered after ${attempt} retries`] : [],
          retryCount: attempt,
          model: model,
        };

        await this.eventBus.emit({
          type: 'agent:complete',
          agentName,
          data: result,
          timestamp: new Date(),
        });

        return result;
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        retryCount = attempt + 1;

        await this.eventBus.emit({
          type: 'agent:error',
          agentName,
          data: { error: lastError, attempt: attempt + 1 },
          timestamp: new Date(),
        });
      }
    }

    // All retries exhausted
    return {
      agentName,
      taskId: `task_${Date.now()}`,
      status: 'failed',
      data: null,
      confidence: 0,
      processingMs: Date.now() - startTime,
      warnings: [`Failed after ${maxRetries} attempts: ${lastError}`],
      retryCount,
      model,
    };
  }

  // ── Parallel Fan-Out / Fan-In ─────────────────────────────────

  async executeParallel(
    tasks: Array<{ agentName: string; prompt: string; model?: string }>,
  ): Promise<SubAgentResult[]> {
    await this.eventBus.emit({
      type: 'parallel:start',
      data: { count: tasks.length, agents: tasks.map(t => t.agentName) },
      timestamp: new Date(),
    });

    const results = await Promise.all(
      tasks.map(t => this.executeAgent(t.agentName, t.prompt, { model: t.model }))
    );

    await this.eventBus.emit({
      type: 'parallel:complete',
      data: aggregateResults(results),
      timestamp: new Date(),
    });

    return results;
  }

  // ── Phase-Gated Pipeline ──────────────────────────────────────

  async executePipeline(
    phases: PipelinePhase[],
    contextBuilder?: (phaseResults: Map<string, SubAgentResult[]>) => string,
  ): Promise<{
    success: boolean;
    results: Map<string, SubAgentResult[]>;
    failedPhase?: string;
  }> {
    const allResults = new Map<string, SubAgentResult[]>();

    for (const phase of phases) {
      await this.eventBus.emit({
        type: 'pipeline:phase:start',
        data: { phase: phase.name, agents: phase.agents },
        timestamp: new Date(),
      });

      // Build context from previous phase results
      const context = contextBuilder
        ? contextBuilder(allResults)
        : '';

      let phaseResults: SubAgentResult[];

      if (phase.parallel) {
        phaseResults = await this.executeParallel(
          phase.agents.map(agent => ({
            agentName: agent,
            prompt: `Execute ${phase.name} phase. ${context}`,
          }))
        );
      } else {
        phaseResults = [];
        for (const agent of phase.agents) {
          const result = await this.executeAgent(
            agent,
            `Execute ${phase.name} phase. ${context}`,
            { timeoutMs: phase.timeoutMs },
          );
          phaseResults.push(result);
        }
      }

      allResults.set(phase.name, phaseResults);

      // Quality gate check
      if (!phase.qualityGate(phaseResults)) {
        await this.eventBus.emit({
          type: 'pipeline:gate:failed',
          data: { phase: phase.name, results: aggregateResults(phaseResults) },
          timestamp: new Date(),
        });

        if (phase.rollbackFn) {
          await phase.rollbackFn();
        }

        return { success: false, results: allResults, failedPhase: phase.name };
      }

      await this.eventBus.emit({
        type: 'pipeline:phase:complete',
        data: { phase: phase.name, results: aggregateResults(phaseResults) },
        timestamp: new Date(),
      });
    }

    return { success: true, results: allResults };
  }

  // ── Dependency-Aware Work Plan (DAG Scheduler) ────────────────

  async executeWorkPlan(tasks: WorkerTask[]): Promise<Map<string, SubAgentResult>> {
    this.completedTasks.clear();
    this.runningTasks.clear();

    const pending = [...tasks].sort((a, b) => b.priority - a.priority);
    const inFlight: Promise<void>[] = [];

    const trySpawn = async (): Promise<void> => {
      while (true) {
        // Find ready tasks (all deps satisfied)
        const ready = pending.filter(t =>
          t.dependencies.every(dep => this.completedTasks.has(dep)) &&
          !this.runningTasks.has(t.id)
        );

        // Respect concurrency limit
        const canSpawn = this.maxConcurrency - this.runningTasks.size;
        if (canSpawn <= 0 || ready.length === 0) break;

        const toSpawn = ready.slice(0, canSpawn);

        for (const task of toSpawn) {
          pending.splice(pending.indexOf(task), 1);
          this.runningTasks.add(task.id);

          // Build context from dependency results
          const depContext = task.dependencies
            .map(dep => {
              const depResult = this.completedTasks.get(dep);
              return depResult ? `[${dep}]: ${JSON.stringify(depResult.data).slice(0, 500)}` : '';
            })
            .filter(Boolean)
            .join('\n');

          const enrichedPrompt = depContext
            ? `${task.prompt}\n\nDependency results:\n${depContext}`
            : task.prompt;

          const promise = this.executeAgent(task.agentName, enrichedPrompt, {
            model: task.model,
            maxRetries: task.maxRetries,
            timeoutMs: task.timeoutMs,
          }).then(result => {
            result.taskId = task.id;
            this.runningTasks.delete(task.id);
            this.completedTasks.set(task.id, result);
          });

          inFlight.push(promise);
        }

        // Wait for at least one to complete before trying again
        if (pending.length > 0 || this.runningTasks.size > 0) {
          await Promise.race([
            ...inFlight,
            new Promise(r => setTimeout(r, 500)),
          ]);
        } else {
          break;
        }
      }
    };

    // Main loop: keep trying to spawn until all done
    while (pending.length > 0 || this.runningTasks.size > 0) {
      await trySpawn();
      if (pending.length > 0 || this.runningTasks.size > 0) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    // Wait for any remaining in-flight tasks
    await Promise.allSettled(inFlight);

    return this.completedTasks;
  }

  // ── Event History ─────────────────────────────────────────────

  getEventHistory(opts?: { type?: string; limit?: number }): OrchestratorEvent[] {
    return this.eventBus.getHistory(opts);
  }

  // ── Pre-built Quality Gates ───────────────────────────────────

  static gates = {
    /** All agents must succeed with confidence > threshold */
    allSucceed(minConfidence = 0.7): (results: SubAgentResult[]) => boolean {
      return (results) =>
        results.every(r => r.status === 'success' && r.confidence >= minConfidence);
    },

    /** At least N agents must succeed */
    minSucceed(n: number): (results: SubAgentResult[]) => boolean {
      return (results) =>
        results.filter(r => r.status === 'success').length >= n;
    },

    /** No critical warnings */
    noCritical(): (results: SubAgentResult[]) => boolean {
      return (results) =>
        !results.some(r => r.warnings.some(w => w.toUpperCase().includes('CRITICAL')));
    },

    /** Majority must succeed */
    majority(): (results: SubAgentResult[]) => boolean {
      return (results) =>
        results.filter(r => r.status === 'success').length > results.length / 2;
    },
  };
}

// ── Pre-built AEGIS Pipeline Templates ─────────────────────────────

export const aegisPipelines = {
  /** Product launch pipeline */
  productLaunch: (): PipelinePhase[] => [
    {
      name: 'market-research',
      agents: ['spy', 'market-intel', 'winner-detector'],
      parallel: true,
      qualityGate: SubAgentOrchestratorEngine.gates.minSucceed(2),
    },
    {
      name: 'creative-production',
      agents: ['copy-chief', 'creative-factory', 'ugc-factory'],
      parallel: true,
      qualityGate: SubAgentOrchestratorEngine.gates.allSucceed(0.6),
    },
    {
      name: 'campaign-setup',
      agents: ['meta-testing', 'dayparting', 'scale'],
      parallel: false,
      qualityGate: SubAgentOrchestratorEngine.gates.allSucceed(0.8),
    },
    {
      name: 'validation',
      agents: ['stop-loss', 'profitability', 'guardrails'],
      parallel: true,
      qualityGate: SubAgentOrchestratorEngine.gates.noCritical(),
    },
  ],

  /** Daily optimization pipeline */
  dailyOptimization: (): PipelinePhase[] => [
    {
      name: 'data-collection',
      agents: ['results-48h', 'capi-relay', 'forecaster'],
      parallel: true,
      qualityGate: SubAgentOrchestratorEngine.gates.majority(),
    },
    {
      name: 'analysis',
      agents: ['profitability', 'creative-fatigue', 'dayparting'],
      parallel: true,
      qualityGate: SubAgentOrchestratorEngine.gates.allSucceed(0.5),
    },
    {
      name: 'execution',
      agents: ['scale', 'stop-loss'],
      parallel: false,
      qualityGate: SubAgentOrchestratorEngine.gates.allSucceed(0.8),
    },
  ],
};

// ── Singleton Export ─────────────────────────────────────────────

export const subAgentOrchestrator = new SubAgentOrchestratorEngine();
