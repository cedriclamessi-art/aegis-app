/**
 * Turn Budget — Per-agent turn limits and cost caps
 * ===================================================
 * Sources: anthropic/claude-code-base-action, 21e-developer/1-code,
 *          lst97/claude-code-subagents
 *
 * Controls:
 *   - Max turns per agent execution
 *   - Max cost per agent execution (USD)
 *   - Max total cost per pipeline run
 *   - Max concurrent agents
 *   - Graceful degradation on budget exceeded
 *
 * Enforcement modes:
 *   hard  — Kill agent when limit reached
 *   soft  — Warn and allow to finish current turn
 *   track — Log only, no enforcement
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type EnforcementMode = 'hard' | 'soft' | 'track';

export interface TurnBudgetConfig {
  maxTurns:           number;       // Max API round-trips
  maxCostUsd:         number;       // Max cost in USD
  maxDurationMs:      number;       // Max wall-clock time
  maxOutputTokens:    number;       // Max total output tokens
  enforcement:        EnforcementMode;
  warningThreshold:   number;       // 0.0-1.0 — warn at this % of budget
  onExceeded:         'stop' | 'downgrade' | 'continue';
  downgradeModel?:    string;       // Model to switch to on budget pressure
}

export interface TurnBudgetSession {
  sessionId:      string;
  agentId:        string;
  shopId?:        string;
  config:         TurnBudgetConfig;
  turnsUsed:      number;
  costUsedUsd:    number;
  tokensUsed:     number;
  startedAt:      Date;
  warnings:       BudgetWarning[];
  status:         'active' | 'exceeded' | 'completed' | 'downgraded';
  modelDowngraded: boolean;
}

export interface BudgetWarning {
  type:       'turns' | 'cost' | 'duration' | 'tokens';
  threshold:  number;
  current:    number;
  limit:      number;
  message:    string;
  timestamp:  Date;
}

export interface TurnRecord {
  turnNumber:    number;
  model:         string;
  inputTokens:   number;
  outputTokens:  number;
  costUsd:       number;
  durationMs:    number;
  action?:       string;
  timestamp:     Date;
}

// ── Default Budgets by Tier ───────────────────────────────────────────────

const TIER_BUDGETS: Record<number, TurnBudgetConfig> = {
  1: { // Seed
    maxTurns: 5,
    maxCostUsd: 0.25,
    maxDurationMs: 60000,
    maxOutputTokens: 5000,
    enforcement: 'hard',
    warningThreshold: 0.8,
    onExceeded: 'stop',
  },
  2: { // Growth
    maxTurns: 15,
    maxCostUsd: 2.00,
    maxDurationMs: 180000,
    maxOutputTokens: 20000,
    enforcement: 'soft',
    warningThreshold: 0.7,
    onExceeded: 'downgrade',
    downgradeModel: 'claude-haiku-4-20250514',
  },
  3: { // Scale
    maxTurns: 30,
    maxCostUsd: 10.00,
    maxDurationMs: 300000,
    maxOutputTokens: 50000,
    enforcement: 'soft',
    warningThreshold: 0.8,
    onExceeded: 'downgrade',
    downgradeModel: 'claude-haiku-4-20250514',
  },
  4: { // Empire
    maxTurns: 100,
    maxCostUsd: 50.00,
    maxDurationMs: 600000,
    maxOutputTokens: 200000,
    enforcement: 'track',
    warningThreshold: 0.9,
    onExceeded: 'continue',
  },
};

// ── Agent-specific overrides ──────────────────────────────────────────────

const AGENT_BUDGET_OVERRIDES: Record<string, Partial<TurnBudgetConfig>> = {
  'AGENT_COPY_CHIEF':         { maxTurns: 20, maxCostUsd: 3.00 },
  'AGENT_STORE_BUILDER':      { maxTurns: 25, maxCostUsd: 5.00, maxDurationMs: 300000 },
  'AGENT_SPY':                { maxTurns: 15, maxCostUsd: 2.00 },
  'AGENT_PRODUCT_INGEST':     { maxTurns: 5,  maxCostUsd: 0.50 },
  'AGENT_RESULTS_48H':        { maxTurns: 5,  maxCostUsd: 0.50 },
  'AGENT_BUDGET_PROTECTOR':   { maxTurns: 3,  maxCostUsd: 0.20 },
  'AGENT_STOP_LOSS':          { maxTurns: 3,  maxCostUsd: 0.20 },
  'AGENT_REPORT_GENERATOR':   { maxTurns: 10, maxCostUsd: 1.50 },
  'AGENT_PSYCHO_MARKETING':   { maxTurns: 10, maxCostUsd: 2.00 },
  'AGENT_UGC_FACTORY':        { maxTurns: 15, maxCostUsd: 2.50 },
};

// ── Turn Budget Engine ────────────────────────────────────────────────────

class TurnBudgetEngine {
  private sessions: Map<string, TurnBudgetSession> = new Map();
  private turnHistory: Map<string, TurnRecord[]> = new Map();

  // ── Create session ──────────────────────────────────────────────────

  createSession(agentId: string, tier: number, shopId?: string): TurnBudgetSession {
    const baseConfig = TIER_BUDGETS[tier] || TIER_BUDGETS[1];
    const agentOverrides = AGENT_BUDGET_OVERRIDES[agentId] || {};

    const config: TurnBudgetConfig = { ...baseConfig, ...agentOverrides };

    const session: TurnBudgetSession = {
      sessionId: `budget_${agentId}_${Date.now()}`,
      agentId,
      shopId,
      config,
      turnsUsed: 0,
      costUsedUsd: 0,
      tokensUsed: 0,
      startedAt: new Date(),
      warnings: [],
      status: 'active',
      modelDowngraded: false,
    };

    this.sessions.set(session.sessionId, session);
    this.turnHistory.set(session.sessionId, []);

    return session;
  }

  // ── Check if turn is allowed ────────────────────────────────────────

  checkTurn(sessionId: string): {
    allowed:        boolean;
    reason?:        string;
    suggestModel?:  string;
    warnings:       BudgetWarning[];
  } {
    const session = this.sessions.get(sessionId);
    if (!session) return { allowed: false, reason: 'Session not found', warnings: [] };
    if (session.status === 'exceeded') {
      return { allowed: false, reason: 'Budget exceeded', warnings: session.warnings };
    }

    const warnings: BudgetWarning[] = [];
    const elapsed = Date.now() - session.startedAt.getTime();

    // Check turns
    const turnRatio = session.turnsUsed / session.config.maxTurns;
    if (turnRatio >= 1.0) {
      if (session.config.enforcement === 'hard') {
        session.status = 'exceeded';
        return { allowed: false, reason: `Max turns (${session.config.maxTurns}) exceeded`, warnings };
      }
      warnings.push(this.createWarning('turns', session.config.warningThreshold,
        session.turnsUsed, session.config.maxTurns));
    } else if (turnRatio >= session.config.warningThreshold) {
      warnings.push(this.createWarning('turns', session.config.warningThreshold,
        session.turnsUsed, session.config.maxTurns));
    }

    // Check cost
    const costRatio = session.costUsedUsd / session.config.maxCostUsd;
    if (costRatio >= 1.0) {
      if (session.config.enforcement === 'hard') {
        session.status = 'exceeded';
        return { allowed: false, reason: `Max cost ($${session.config.maxCostUsd}) exceeded`, warnings };
      }
      if (session.config.onExceeded === 'downgrade' && !session.modelDowngraded) {
        session.modelDowngraded = true;
        session.status = 'downgraded';
        return {
          allowed: true,
          suggestModel: session.config.downgradeModel,
          warnings,
        };
      }
    } else if (costRatio >= session.config.warningThreshold) {
      warnings.push(this.createWarning('cost', session.config.warningThreshold,
        session.costUsedUsd, session.config.maxCostUsd));
    }

    // Check duration
    const durationRatio = elapsed / session.config.maxDurationMs;
    if (durationRatio >= 1.0 && session.config.enforcement === 'hard') {
      session.status = 'exceeded';
      return { allowed: false, reason: `Max duration (${session.config.maxDurationMs}ms) exceeded`, warnings };
    } else if (durationRatio >= session.config.warningThreshold) {
      warnings.push(this.createWarning('duration', session.config.warningThreshold,
        elapsed, session.config.maxDurationMs));
    }

    // Check tokens
    const tokenRatio = session.tokensUsed / session.config.maxOutputTokens;
    if (tokenRatio >= 1.0 && session.config.enforcement === 'hard') {
      session.status = 'exceeded';
      return { allowed: false, reason: `Max tokens (${session.config.maxOutputTokens}) exceeded`, warnings };
    }

    // Store warnings
    session.warnings.push(...warnings);

    return { allowed: true, warnings };
  }

  // ── Record a turn ───────────────────────────────────────────────────

  recordTurn(sessionId: string, record: Omit<TurnRecord, 'turnNumber'>): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    session.turnsUsed++;
    session.costUsedUsd += record.costUsd;
    session.tokensUsed += record.outputTokens;

    const history = this.turnHistory.get(sessionId) || [];
    history.push({
      ...record,
      turnNumber: session.turnsUsed,
    });
    this.turnHistory.set(sessionId, history);
  }

  // ── Complete session ────────────────────────────────────────────────

  completeSession(sessionId: string): TurnBudgetSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session && session.status === 'active') {
      session.status = 'completed';
    }
    return session;
  }

  // ── Get session info ────────────────────────────────────────────────

  getSession(sessionId: string): TurnBudgetSession | undefined {
    return this.sessions.get(sessionId);
  }

  getTurnHistory(sessionId: string): TurnRecord[] {
    return this.turnHistory.get(sessionId) || [];
  }

  // ── Aggregate stats ─────────────────────────────────────────────────

  getAgentStats(agentId: string): {
    totalSessions: number;
    avgTurns: number;
    avgCostUsd: number;
    exceededCount: number;
    downgradeCount: number;
  } {
    const sessions = Array.from(this.sessions.values())
      .filter(s => s.agentId === agentId);

    if (sessions.length === 0) {
      return { totalSessions: 0, avgTurns: 0, avgCostUsd: 0, exceededCount: 0, downgradeCount: 0 };
    }

    return {
      totalSessions: sessions.length,
      avgTurns: sessions.reduce((sum, s) => sum + s.turnsUsed, 0) / sessions.length,
      avgCostUsd: sessions.reduce((sum, s) => sum + s.costUsedUsd, 0) / sessions.length,
      exceededCount: sessions.filter(s => s.status === 'exceeded').length,
      downgradeCount: sessions.filter(s => s.modelDowngraded).length,
    };
  }

  // ── Pipeline-level budget ───────────────────────────────────────────

  getPipelineCost(shopId: string): number {
    return Array.from(this.sessions.values())
      .filter(s => s.shopId === shopId)
      .reduce((sum, s) => sum + s.costUsedUsd, 0);
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private createWarning(
    type: BudgetWarning['type'],
    threshold: number,
    current: number,
    limit: number,
  ): BudgetWarning {
    const pct = ((current / limit) * 100).toFixed(0);
    return {
      type,
      threshold,
      current,
      limit,
      message: `${type} at ${pct}% (${current}/${limit})`,
      timestamp: new Date(),
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const turnBudget = new TurnBudgetEngine();
