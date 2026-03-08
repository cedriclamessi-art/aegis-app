/**
 * Execution Log — Structured JSON logging per agent run
 * =======================================================
 * Sources: anthropic/claude-code-base-action, 21e-developer/1-code,
 *          disler/claude-code-hooks-multi-agent-observability
 *
 * Every agent execution produces a structured log entry:
 *   - Timing (start, end, duration)
 *   - Model used (and any downgrades)
 *   - Token usage (input, output, total, cost)
 *   - Turns taken
 *   - Tool calls made
 *   - Decisions made
 *   - Errors encountered
 *   - Quality gate results
 *   - Context size
 *
 * Logs are stored in-memory with optional PostgreSQL persistence.
 * Supports real-time streaming via event emitter pattern.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'fatal';

export interface ExecutionLogEntry {
  id:            string;
  agentId:       string;
  agentName:     string;
  shopId?:       string;
  pipelineId?:   string;
  stepName?:     string;

  // Timing
  startedAt:     Date;
  completedAt?:  Date;
  durationMs?:   number;

  // Model
  model:         string;
  modelDowngraded: boolean;
  originalModel?: string;

  // Usage
  inputTokens:   number;
  outputTokens:  number;
  totalTokens:   number;
  costUsd:       number;

  // Execution
  turnsUsed:     number;
  maxTurns:      number;
  toolCalls:     ToolCallRecord[];
  decisions:     DecisionLogEntry[];

  // Result
  status:        'success' | 'failure' | 'timeout' | 'budget_exceeded' | 'cancelled';
  result?:       unknown;
  error?:        string;
  errorStack?:   string;

  // Quality
  qualityGate?:  {
    passed: boolean;
    severity: string;
    checks: number;
    failures: number;
  };

  // Context
  contextSize:   number;    // Characters of context provided
  memoryHits?:   number;    // Number of memory retrievals

  // Tags
  tags:          string[];
  metadata?:     Record<string, unknown>;
}

export interface ToolCallRecord {
  name:        string;
  arguments:   Record<string, unknown>;
  result?:     string;
  durationMs:  number;
  success:     boolean;
  turnNumber:  number;
  timestamp:   Date;
}

export interface DecisionLogEntry {
  type:        string;       // 'classify', 'route', 'scale', 'kill', etc.
  input:       string;       // What was evaluated
  output:      string;       // Decision made
  confidence?: number;       // 0-1
  timestamp:   Date;
}

export interface LogQuery {
  agentId?:     string;
  shopId?:      string;
  pipelineId?:  string;
  status?:      string;
  since?:       Date;
  until?:       Date;
  minCostUsd?:  number;
  maxCostUsd?:  number;
  tags?:        string[];
  limit?:       number;
  offset?:      number;
}

export interface LogAggregation {
  agentId:       string;
  totalRuns:     number;
  successRate:   number;
  avgDurationMs: number;
  avgCostUsd:    number;
  totalCostUsd:  number;
  avgTurns:      number;
  avgTokens:     number;
  errorTypes:    Record<string, number>;
  modelUsage:    Record<string, number>;
}

type LogListener = (entry: ExecutionLogEntry) => void;

// ── Execution Log Engine ──────────────────────────────────────────────────

class ExecutionLogEngine {
  private entries: ExecutionLogEntry[] = [];
  private activeEntries: Map<string, ExecutionLogEntry> = new Map();
  private listeners: LogListener[] = [];
  private maxEntries = 5000;

  // ── Start logging a new execution ───────────────────────────────────

  startExecution(params: {
    agentId:      string;
    agentName:    string;
    model:        string;
    maxTurns:     number;
    shopId?:      string;
    pipelineId?:  string;
    stepName?:    string;
    contextSize?: number;
    tags?:        string[];
  }): string {
    const id = `log_${params.agentId}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const entry: ExecutionLogEntry = {
      id,
      agentId: params.agentId,
      agentName: params.agentName,
      shopId: params.shopId,
      pipelineId: params.pipelineId,
      stepName: params.stepName,
      startedAt: new Date(),
      model: params.model,
      modelDowngraded: false,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: 0,
      turnsUsed: 0,
      maxTurns: params.maxTurns,
      toolCalls: [],
      decisions: [],
      status: 'success',
      contextSize: params.contextSize || 0,
      tags: params.tags || [],
    };

    this.activeEntries.set(id, entry);
    return id;
  }

  // ── Record a turn ───────────────────────────────────────────────────

  recordTurn(logId: string, turn: {
    inputTokens:  number;
    outputTokens: number;
    costUsd:      number;
    model:        string;
  }): void {
    const entry = this.activeEntries.get(logId);
    if (!entry) return;

    entry.turnsUsed++;
    entry.inputTokens += turn.inputTokens;
    entry.outputTokens += turn.outputTokens;
    entry.totalTokens += turn.inputTokens + turn.outputTokens;
    entry.costUsd += turn.costUsd;

    // Check for model downgrade
    if (turn.model !== entry.model && !entry.modelDowngraded) {
      entry.originalModel = entry.model;
      entry.model = turn.model;
      entry.modelDowngraded = true;
    }
  }

  // ── Record tool call ────────────────────────────────────────────────

  recordToolCall(logId: string, toolCall: ToolCallRecord): void {
    const entry = this.activeEntries.get(logId);
    if (!entry) return;
    entry.toolCalls.push(toolCall);
  }

  // ── Record decision ─────────────────────────────────────────────────

  recordDecision(logId: string, decision: DecisionLogEntry): void {
    const entry = this.activeEntries.get(logId);
    if (!entry) return;
    entry.decisions.push(decision);
  }

  // ── Record quality gate ─────────────────────────────────────────────

  recordQualityGate(logId: string, gate: ExecutionLogEntry['qualityGate']): void {
    const entry = this.activeEntries.get(logId);
    if (!entry) return;
    entry.qualityGate = gate;
  }

  // ── Complete execution ──────────────────────────────────────────────

  completeExecution(logId: string, result: {
    status:   ExecutionLogEntry['status'];
    result?:  unknown;
    error?:   string;
    tags?:    string[];
  }): ExecutionLogEntry | undefined {
    const entry = this.activeEntries.get(logId);
    if (!entry) return;

    entry.completedAt = new Date();
    entry.durationMs = entry.completedAt.getTime() - entry.startedAt.getTime();
    entry.status = result.status;
    entry.result = result.result;
    entry.error = result.error;
    if (result.tags) entry.tags.push(...result.tags);

    // Move to completed
    this.activeEntries.delete(logId);
    this.entries.push(entry);

    // Trim
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Notify listeners
    for (const listener of this.listeners) {
      try { listener(entry); } catch { /* ignore */ }
    }

    return entry;
  }

  // ── Query logs ──────────────────────────────────────────────────────

  query(q: LogQuery): ExecutionLogEntry[] {
    let results = [...this.entries];

    if (q.agentId) results = results.filter(e => e.agentId === q.agentId);
    if (q.shopId) results = results.filter(e => e.shopId === q.shopId);
    if (q.pipelineId) results = results.filter(e => e.pipelineId === q.pipelineId);
    if (q.status) results = results.filter(e => e.status === q.status);
    if (q.since) results = results.filter(e => e.startedAt >= q.since!);
    if (q.until) results = results.filter(e => e.startedAt <= q.until!);
    if (q.minCostUsd) results = results.filter(e => e.costUsd >= q.minCostUsd!);
    if (q.maxCostUsd) results = results.filter(e => e.costUsd <= q.maxCostUsd!);
    if (q.tags && q.tags.length > 0) {
      results = results.filter(e => q.tags!.some(t => e.tags.includes(t)));
    }

    // Sort by newest first
    results.sort((a, b) => b.startedAt.getTime() - a.startedAt.getTime());

    const offset = q.offset || 0;
    const limit = q.limit || 50;
    return results.slice(offset, offset + limit);
  }

  // ── Aggregations ────────────────────────────────────────────────────

  aggregate(agentId?: string, since?: Date): LogAggregation[] {
    const cutoff = since || new Date(Date.now() - 24 * 60 * 60 * 1000);
    let relevant = this.entries.filter(e => e.startedAt >= cutoff);
    if (agentId) relevant = relevant.filter(e => e.agentId === agentId);

    // Group by agentId
    const groups: Record<string, ExecutionLogEntry[]> = {};
    for (const entry of relevant) {
      if (!groups[entry.agentId]) groups[entry.agentId] = [];
      groups[entry.agentId].push(entry);
    }

    return Object.entries(groups).map(([id, entries]) => {
      const successCount = entries.filter(e => e.status === 'success').length;
      const errorTypes: Record<string, number> = {};
      const modelUsage: Record<string, number> = {};

      for (const e of entries) {
        if (e.error) {
          const errorKey = e.error.slice(0, 50);
          errorTypes[errorKey] = (errorTypes[errorKey] || 0) + 1;
        }
        modelUsage[e.model] = (modelUsage[e.model] || 0) + 1;
      }

      return {
        agentId: id,
        totalRuns: entries.length,
        successRate: entries.length > 0 ? successCount / entries.length : 0,
        avgDurationMs: entries.reduce((s, e) => s + (e.durationMs || 0), 0) / entries.length,
        avgCostUsd: entries.reduce((s, e) => s + e.costUsd, 0) / entries.length,
        totalCostUsd: entries.reduce((s, e) => s + e.costUsd, 0),
        avgTurns: entries.reduce((s, e) => s + e.turnsUsed, 0) / entries.length,
        avgTokens: entries.reduce((s, e) => s + e.totalTokens, 0) / entries.length,
        errorTypes,
        modelUsage,
      };
    });
  }

  // ── Dashboard data ──────────────────────────────────────────────────

  getDashboardData(since?: Date): {
    totalExecutions:   number;
    activeExecutions:  number;
    successRate:       number;
    totalCostUsd:      number;
    avgDurationMs:     number;
    topAgents:         Array<{ agentId: string; runs: number; cost: number }>;
    recentErrors:      Array<{ agentId: string; error: string; timestamp: Date }>;
  } {
    const cutoff = since || new Date(Date.now() - 24 * 60 * 60 * 1000);
    const relevant = this.entries.filter(e => e.startedAt >= cutoff);
    const successCount = relevant.filter(e => e.status === 'success').length;

    // Top agents by run count
    const agentCounts: Record<string, { runs: number; cost: number }> = {};
    for (const e of relevant) {
      if (!agentCounts[e.agentId]) agentCounts[e.agentId] = { runs: 0, cost: 0 };
      agentCounts[e.agentId].runs++;
      agentCounts[e.agentId].cost += e.costUsd;
    }

    const topAgents = Object.entries(agentCounts)
      .map(([agentId, data]) => ({ agentId, ...data }))
      .sort((a, b) => b.runs - a.runs)
      .slice(0, 10);

    // Recent errors
    const recentErrors = relevant
      .filter(e => e.error)
      .slice(-10)
      .map(e => ({
        agentId: e.agentId,
        error: e.error!,
        timestamp: e.startedAt,
      }));

    return {
      totalExecutions: relevant.length,
      activeExecutions: this.activeEntries.size,
      successRate: relevant.length > 0 ? successCount / relevant.length : 1,
      totalCostUsd: relevant.reduce((s, e) => s + e.costUsd, 0),
      avgDurationMs: relevant.length > 0
        ? relevant.reduce((s, e) => s + (e.durationMs || 0), 0) / relevant.length
        : 0,
      topAgents,
      recentErrors,
    };
  }

  // ── Event listeners ─────────────────────────────────────────────────

  onComplete(listener: LogListener): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter(l => l !== listener);
    };
  }

  // ── Active executions ───────────────────────────────────────────────

  getActiveExecutions(): ExecutionLogEntry[] {
    return Array.from(this.activeEntries.values());
  }

  // ── Get entry by ID ─────────────────────────────────────────────────

  getEntry(logId: string): ExecutionLogEntry | undefined {
    return this.activeEntries.get(logId) || this.entries.find(e => e.id === logId);
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const executionLog = new ExecutionLogEngine();
