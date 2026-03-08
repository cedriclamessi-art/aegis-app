/**
 * Observability — Real-time agent monitoring and event streaming
 * ================================================================
 * Sources: disler/claude-code-hooks-multi-agent-observability,
 *          Dicklesworthstone/claude_code_agent_farm,
 *          sugyan/claude-code-web-interface
 *
 * Provides:
 *   - Real-time event streaming (agent starts, completes, errors)
 *   - Lifecycle event tracking (spawn, execute, complete, error)
 *   - Heartbeat monitoring (agent liveness)
 *   - Performance metrics (P50, P95, P99 latencies)
 *   - Cost tracking per agent, shop, pipeline
 *   - Health dashboard data
 *   - Alert system for anomalies
 *   - Event summarization for long-running pipelines
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type EventType =
  | 'agent:spawn'
  | 'agent:start'
  | 'agent:turn'
  | 'agent:tool_call'
  | 'agent:decision'
  | 'agent:complete'
  | 'agent:error'
  | 'agent:timeout'
  | 'agent:budget_exceeded'
  | 'agent:downgrade'
  | 'pipeline:start'
  | 'pipeline:step'
  | 'pipeline:complete'
  | 'pipeline:error'
  | 'pipeline:gate_block'
  | 'team:start'
  | 'team:worker_complete'
  | 'team:complete'
  | 'system:heartbeat'
  | 'system:alert'
  | 'system:health_check';

export interface ObservabilityEvent {
  id:          string;
  type:        EventType;
  timestamp:   Date;
  agentId?:    string;
  shopId?:     string;
  pipelineId?: string;
  data:        Record<string, unknown>;
  level:       'debug' | 'info' | 'warn' | 'error';
  tags:        string[];
}

export interface AgentHeartbeat {
  agentId:       string;
  sessionId:     string;
  shopId?:       string;
  lastBeat:      Date;
  turnsUsed:     number;
  costUsd:       number;
  status:        'alive' | 'stale' | 'dead';
  currentAction?: string;
}

export interface PerformanceMetrics {
  agentId:       string;
  period:        string;       // '1h', '24h', '7d'
  invocations:   number;
  successRate:   number;
  p50LatencyMs:  number;
  p95LatencyMs:  number;
  p99LatencyMs:  number;
  avgCostUsd:    number;
  totalCostUsd:  number;
  avgTurns:      number;
  errorCount:    number;
  topErrors:     string[];
}

export interface SystemAlert {
  id:            string;
  severity:      'info' | 'warning' | 'critical';
  source:        string;
  message:       string;
  timestamp:     Date;
  acknowledged:  boolean;
  data?:         Record<string, unknown>;
}

type EventListener = (event: ObservabilityEvent) => void;

// ── Observability Engine ──────────────────────────────────────────────────

class ObservabilityEngine {
  private events: ObservabilityEvent[] = [];
  private heartbeats: Map<string, AgentHeartbeat> = new Map();
  private alerts: SystemAlert[] = [];
  private listeners: Map<string, EventListener[]> = new Map();
  private latencyHistory: Map<string, number[]> = new Map();
  private maxEvents = 10000;
  private heartbeatStaleMs = 120000;   // 2 minutes
  private heartbeatDeadMs = 300000;    // 5 minutes

  // ── Emit event ──────────────────────────────────────────────────────

  emit(event: Omit<ObservabilityEvent, 'id' | 'timestamp'>): void {
    const fullEvent: ObservabilityEvent = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      ...event,
    };

    this.events.push(fullEvent);

    // Trim
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Notify listeners
    const typeListeners = this.listeners.get(event.type) || [];
    const allListeners = this.listeners.get('*') || [];
    for (const listener of [...typeListeners, ...allListeners]) {
      try { listener(fullEvent); } catch { /* ignore */ }
    }

    // Track latency for agent:complete events
    if (event.type === 'agent:complete' && event.agentId && event.data.durationMs) {
      const history = this.latencyHistory.get(event.agentId) || [];
      history.push(event.data.durationMs as number);
      if (history.length > 1000) history.splice(0, history.length - 1000);
      this.latencyHistory.set(event.agentId, history);
    }

    // Auto-alert on errors
    if (event.level === 'error') {
      this.createAlert({
        severity: 'warning',
        source: event.agentId || 'system',
        message: `Error in ${event.type}: ${event.data.error || 'Unknown error'}`,
        data: event.data,
      });
    }
  }

  // ── Subscribe to events ─────────────────────────────────────────────

  on(eventType: EventType | '*', listener: EventListener): () => void {
    const listeners = this.listeners.get(eventType) || [];
    listeners.push(listener);
    this.listeners.set(eventType, listeners);

    return () => {
      const current = this.listeners.get(eventType) || [];
      this.listeners.set(eventType, current.filter(l => l !== listener));
    };
  }

  // ── Heartbeat ───────────────────────────────────────────────────────

  heartbeat(agentId: string, sessionId: string, data: Partial<AgentHeartbeat>): void {
    this.heartbeats.set(sessionId, {
      agentId,
      sessionId,
      lastBeat: new Date(),
      turnsUsed: 0,
      costUsd: 0,
      status: 'alive',
      ...data,
    });
  }

  checkHeartbeats(): AgentHeartbeat[] {
    const now = Date.now();
    const results: AgentHeartbeat[] = [];

    for (const [sessionId, beat] of this.heartbeats) {
      const elapsed = now - beat.lastBeat.getTime();

      if (elapsed > this.heartbeatDeadMs) {
        beat.status = 'dead';
        this.createAlert({
          severity: 'critical',
          source: beat.agentId,
          message: `Agent ${beat.agentId} (${sessionId}) is DEAD — no heartbeat for ${(elapsed / 1000).toFixed(0)}s`,
        });
      } else if (elapsed > this.heartbeatStaleMs) {
        beat.status = 'stale';
      } else {
        beat.status = 'alive';
      }

      results.push(beat);
    }

    return results;
  }

  removeHeartbeat(sessionId: string): void {
    this.heartbeats.delete(sessionId);
  }

  // ── Performance metrics ─────────────────────────────────────────────

  getPerformanceMetrics(agentId: string, period: '1h' | '24h' | '7d' = '24h'): PerformanceMetrics {
    const periodMs = {
      '1h': 60 * 60 * 1000,
      '24h': 24 * 60 * 60 * 1000,
      '7d': 7 * 24 * 60 * 60 * 1000,
    }[period];

    const cutoff = new Date(Date.now() - periodMs);
    const agentEvents = this.events.filter(e =>
      e.agentId === agentId &&
      e.timestamp >= cutoff &&
      e.type === 'agent:complete'
    );

    const latencies = this.latencyHistory.get(agentId) || [];
    const sortedLatencies = [...latencies].sort((a, b) => a - b);

    const successCount = agentEvents.filter(e => e.data.status === 'success').length;
    const errorEvents = agentEvents.filter(e => e.data.status !== 'success');

    return {
      agentId,
      period,
      invocations: agentEvents.length,
      successRate: agentEvents.length > 0 ? successCount / agentEvents.length : 1,
      p50LatencyMs: this.percentile(sortedLatencies, 0.50),
      p95LatencyMs: this.percentile(sortedLatencies, 0.95),
      p99LatencyMs: this.percentile(sortedLatencies, 0.99),
      avgCostUsd: agentEvents.length > 0
        ? agentEvents.reduce((s, e) => s + ((e.data.costUsd as number) || 0), 0) / agentEvents.length
        : 0,
      totalCostUsd: agentEvents.reduce((s, e) => s + ((e.data.costUsd as number) || 0), 0),
      avgTurns: agentEvents.length > 0
        ? agentEvents.reduce((s, e) => s + ((e.data.turnsUsed as number) || 0), 0) / agentEvents.length
        : 0,
      errorCount: errorEvents.length,
      topErrors: errorEvents
        .map(e => String(e.data.error || 'unknown'))
        .slice(0, 5),
    };
  }

  // ── Alerts ──────────────────────────────────────────────────────────

  createAlert(alert: Omit<SystemAlert, 'id' | 'timestamp' | 'acknowledged'>): void {
    this.alerts.push({
      id: `alert_${Date.now()}_${Math.random().toString(36).slice(2, 4)}`,
      timestamp: new Date(),
      acknowledged: false,
      ...alert,
    });

    // Keep only last 500 alerts
    if (this.alerts.length > 500) {
      this.alerts = this.alerts.slice(-500);
    }
  }

  getAlerts(unacknowledgedOnly = false): SystemAlert[] {
    if (unacknowledgedOnly) {
      return this.alerts.filter(a => !a.acknowledged);
    }
    return this.alerts;
  }

  acknowledgeAlert(alertId: string): void {
    const alert = this.alerts.find(a => a.id === alertId);
    if (alert) alert.acknowledged = true;
  }

  // ── Query events ────────────────────────────────────────────────────

  getEvents(filter?: {
    type?:    EventType;
    agentId?: string;
    shopId?:  string;
    since?:   Date;
    level?:   string;
    limit?:   number;
  }): ObservabilityEvent[] {
    let results = [...this.events];

    if (filter?.type) results = results.filter(e => e.type === filter.type);
    if (filter?.agentId) results = results.filter(e => e.agentId === filter.agentId);
    if (filter?.shopId) results = results.filter(e => e.shopId === filter.shopId);
    if (filter?.since) results = results.filter(e => e.timestamp >= filter.since!);
    if (filter?.level) results = results.filter(e => e.level === filter.level);

    return results.slice(-(filter?.limit || 100));
  }

  // ── Event summarization ─────────────────────────────────────────────

  summarize(pipelineId: string): {
    duration:      string;
    stepsCompleted: number;
    agentsUsed:    number;
    totalCostUsd:  number;
    errors:        number;
    gateBlocks:    number;
    timeline:      string[];
  } {
    const pipelineEvents = this.events.filter(e => e.pipelineId === pipelineId);
    if (pipelineEvents.length === 0) {
      return { duration: '0s', stepsCompleted: 0, agentsUsed: 0, totalCostUsd: 0, errors: 0, gateBlocks: 0, timeline: [] };
    }

    const start = pipelineEvents[0].timestamp;
    const end = pipelineEvents[pipelineEvents.length - 1].timestamp;
    const durationMs = end.getTime() - start.getTime();

    const agentIds = new Set(pipelineEvents.filter(e => e.agentId).map(e => e.agentId));

    return {
      duration: durationMs > 60000 ? `${(durationMs / 60000).toFixed(1)}min` : `${(durationMs / 1000).toFixed(0)}s`,
      stepsCompleted: pipelineEvents.filter(e => e.type === 'pipeline:step').length,
      agentsUsed: agentIds.size,
      totalCostUsd: pipelineEvents
        .filter(e => e.type === 'agent:complete')
        .reduce((s, e) => s + ((e.data.costUsd as number) || 0), 0),
      errors: pipelineEvents.filter(e => e.level === 'error').length,
      gateBlocks: pipelineEvents.filter(e => e.type === 'pipeline:gate_block').length,
      timeline: pipelineEvents
        .filter(e => ['pipeline:start', 'pipeline:step', 'agent:complete', 'pipeline:complete', 'pipeline:error'].includes(e.type))
        .map(e => `[${e.timestamp.toISOString().slice(11, 19)}] ${e.type}: ${e.data.message || e.agentId || ''}`),
    };
  }

  // ── Dashboard data ──────────────────────────────────────────────────

  getDashboard(): {
    activeAgents:   number;
    staleAgents:    number;
    deadAgents:     number;
    recentEvents:   number;
    unackedAlerts:  number;
    costLast24h:    number;
    errorRate24h:   number;
  } {
    const heartbeats = this.checkHeartbeats();
    const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const recent = this.events.filter(e => e.timestamp >= since24h);
    const completeEvents = recent.filter(e => e.type === 'agent:complete');
    const errorEvents = recent.filter(e => e.level === 'error');

    return {
      activeAgents: heartbeats.filter(h => h.status === 'alive').length,
      staleAgents: heartbeats.filter(h => h.status === 'stale').length,
      deadAgents: heartbeats.filter(h => h.status === 'dead').length,
      recentEvents: recent.length,
      unackedAlerts: this.alerts.filter(a => !a.acknowledged).length,
      costLast24h: completeEvents.reduce((s, e) => s + ((e.data.costUsd as number) || 0), 0),
      errorRate24h: completeEvents.length > 0 ? errorEvents.length / completeEvents.length : 0,
    };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const idx = Math.ceil(sorted.length * p) - 1;
    return sorted[Math.max(0, idx)];
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const observability = new ObservabilityEngine();
