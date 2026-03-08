/**
 * Ralph Autonomous Loop — Intelligent campaign optimization cycle
 * ================================================================
 * Sources: Ralph Claude Code, OneRedOak Workflows (dual-loop)
 *
 * State machine:
 *   IDLE → LAUNCH → WAIT → ANALYZE → DECIDE → (ITERATE|SCALE|KILL|PAUSE|EXIT)
 *
 * Dual exit gate:
 *   1. ROAS ≥ target for 7+ consecutive days
 *   2. Budget threshold reached
 *   Both must be true to exit with "SCALE" verdict
 *
 * Circuit breaker integration:
 *   - 3 consecutive no-improvement cycles → PAUSE
 *   - 5 consecutive DEAD classifications → KILL
 *   - Error threshold → PAUSE with alert
 *
 * Decision matrix:
 *   CONDOR + ROAS ≥ 3.0       → SCALE (increase budget 30%)
 *   CONDOR + ROAS 2.0-3.0     → ITERATE (test new creatives)
 *   TOF + ROAS ≥ 2.0          → ITERATE (optimize audience)
 *   TOF + ROAS < 2.0          → ITERATE (change angle)
 *   BOF + any ROAS             → ITERATE (retarget only)
 *   DEAD + ROAS < 1.0          → KILL (stop campaign)
 *   No data after 72h          → KILL (no traction)
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type LoopState =
  | 'IDLE'
  | 'LAUNCH'
  | 'WAIT'
  | 'ANALYZE'
  | 'DECIDE'
  | 'ITERATE'
  | 'SCALE'
  | 'KILL'
  | 'PAUSE'
  | 'EXIT';

export type Classification = 'CONDOR' | 'TOF' | 'BOF' | 'DEAD' | 'UNKNOWN';

export type Decision =
  | 'SCALE_UP'
  | 'ITERATE_CREATIVE'
  | 'ITERATE_AUDIENCE'
  | 'ITERATE_ANGLE'
  | 'RETARGET'
  | 'KILL'
  | 'PAUSE'
  | 'WAIT_MORE';

export interface CampaignMetrics {
  impressions:     number;
  clicks:          number;
  conversions:     number;
  spent:           number;
  revenue:         number;
  roas:            number;
  ctr:             number;
  cpa:             number;
  classification:  Classification;
  daysRunning:     number;
  frequency:       number;
  fatigueScore:    number;    // 0-1
}

export interface LoopConfig {
  shopId:            string;
  campaignId:        string;
  pipelineId?:       string;
  targetRoas:        number;     // Default 2.5
  testBudget:        number;     // Initial test budget in €
  maxBudget:         number;     // Maximum scale budget
  waitHours:         number;     // Hours between analysis (default 48)
  maxIterations:     number;     // Max optimization cycles (default 10)
  exitConsecutiveDays: number;   // Consecutive profitable days to exit (default 7)
  scaleFactor:       number;     // Budget increase on scale (default 1.3 = 30%)
}

export interface LoopSession {
  id:               string;
  config:           LoopConfig;
  state:            LoopState;
  currentIteration: number;
  metrics:          CampaignMetrics[];   // History of all measurements
  decisions:        DecisionRecord[];
  startedAt:        Date;
  lastAnalyzedAt?:  Date;
  exitReason?:      string;
  consecutiveProfitableDays: number;
  consecutiveNoImprovement:  number;
  consecutiveDeads:          number;
  currentBudget:    number;
  totalSpent:       number;
  totalRevenue:     number;
}

export interface DecisionRecord {
  iteration:     number;
  decision:      Decision;
  reason:        string;
  metrics:       CampaignMetrics;
  action:        string;
  timestamp:     Date;
}

// ── Default Config ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: Partial<LoopConfig> = {
  targetRoas:           2.5,
  testBudget:           50,
  maxBudget:            5000,
  waitHours:            48,
  maxIterations:        10,
  exitConsecutiveDays:  7,
  scaleFactor:          1.3,
};

// ── Ralph Loop Engine ─────────────────────────────────────────────────────

class RalphLoopEngine {
  private sessions: Map<string, LoopSession> = new Map();

  // ── Create a new loop session ────────────────────────────────────────

  createSession(config: LoopConfig): LoopSession {
    const fullConfig = { ...DEFAULT_CONFIG, ...config } as LoopConfig;

    const session: LoopSession = {
      id: `ralph_${config.shopId}_${config.campaignId}_${Date.now()}`,
      config: fullConfig,
      state: 'IDLE',
      currentIteration: 0,
      metrics: [],
      decisions: [],
      startedAt: new Date(),
      consecutiveProfitableDays: 0,
      consecutiveNoImprovement: 0,
      consecutiveDeads: 0,
      currentBudget: fullConfig.testBudget,
      totalSpent: 0,
      totalRevenue: 0,
    };

    this.sessions.set(session.id, session);
    return session;
  }

  // ── Advance the loop state machine ───────────────────────────────────

  advance(sessionId: string, metrics?: CampaignMetrics): {
    newState:  LoopState;
    decision?: Decision;
    action?:   string;
    reason?:   string;
  } {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`Session ${sessionId} not found`);

    switch (session.state) {
      case 'IDLE':
        session.state = 'LAUNCH';
        return { newState: 'LAUNCH', action: 'Launch test campaign with initial budget' };

      case 'LAUNCH':
        session.state = 'WAIT';
        return {
          newState: 'WAIT',
          action: `Wait ${session.config.waitHours}h for data collection`,
          reason: `Test budget: ${session.currentBudget}€`
        };

      case 'WAIT':
        session.state = 'ANALYZE';
        return { newState: 'ANALYZE', action: 'Analyze campaign performance' };

      case 'ANALYZE': {
        if (!metrics) throw new Error('Metrics required for ANALYZE state');

        session.metrics.push(metrics);
        session.lastAnalyzedAt = new Date();
        session.totalSpent += metrics.spent;
        session.totalRevenue += metrics.revenue;
        session.currentIteration++;

        // Make decision
        const decision = this.makeDecision(session, metrics);
        session.decisions.push(decision);

        // Apply decision
        return this.applyDecision(session, decision);
      }

      case 'ITERATE':
        session.state = 'WAIT';
        return {
          newState: 'WAIT',
          action: `Iteration ${session.currentIteration}: Wait ${session.config.waitHours}h`,
        };

      case 'SCALE':
        session.state = 'WAIT';
        session.currentBudget = Math.min(
          session.currentBudget * session.config.scaleFactor,
          session.config.maxBudget
        );
        return {
          newState: 'WAIT',
          action: `Scaled budget to ${session.currentBudget.toFixed(0)}€`,
        };

      case 'KILL':
      case 'EXIT':
        return { newState: session.state, reason: session.exitReason };

      case 'PAUSE':
        return { newState: 'PAUSE', reason: session.exitReason };

      default:
        return { newState: session.state };
    }
  }

  // ── Decision Engine ──────────────────────────────────────────────────

  private makeDecision(session: LoopSession, metrics: CampaignMetrics): DecisionRecord {
    const { classification, roas, daysRunning, fatigueScore } = metrics;
    const { targetRoas, maxIterations } = session.config;

    let decision: Decision;
    let reason: string;
    let action: string;

    // 1. Max iterations check
    if (session.currentIteration >= maxIterations) {
      decision = roas >= targetRoas ? 'SCALE_UP' : 'KILL';
      reason = `Max iterations (${maxIterations}) reached. Final ROAS: ${roas.toFixed(1)}x`;
      action = decision === 'SCALE_UP' ? 'Scale winning campaign' : 'Kill unprofitable campaign';
    }
    // 2. No data after 72h
    else if (daysRunning >= 3 && metrics.impressions < 100) {
      decision = 'KILL';
      reason = `No traction after ${daysRunning} days (${metrics.impressions} impressions)`;
      action = 'Kill campaign — no audience response';
    }
    // 3. DEAD classification
    else if (classification === 'DEAD') {
      session.consecutiveDeads++;
      if (session.consecutiveDeads >= 5) {
        decision = 'KILL';
        reason = `5 consecutive DEAD classifications`;
        action = 'Kill campaign — consistently underperforming';
      } else if (roas < 1.0) {
        decision = 'KILL';
        reason = `DEAD + ROAS ${roas.toFixed(1)}x < 1.0`;
        action = 'Kill campaign — losing money';
      } else {
        decision = 'ITERATE_ANGLE';
        reason = `DEAD but ROAS ${roas.toFixed(1)}x — try different angle`;
        action = 'Change marketing angle and creative approach';
      }
    }
    // 4. CONDOR classification (winner!)
    else if (classification === 'CONDOR') {
      session.consecutiveDeads = 0;
      if (roas >= targetRoas * 1.2) {
        decision = 'SCALE_UP';
        reason = `CONDOR + ROAS ${roas.toFixed(1)}x (${((roas/targetRoas)*100).toFixed(0)}% of target)`;
        action = `Scale budget ${session.config.scaleFactor * 100 - 100}% — winner detected`;
      } else if (roas >= targetRoas) {
        decision = 'ITERATE_CREATIVE';
        reason = `CONDOR at target — test new creative variations`;
        action = 'Generate new creative variants to find even better ROAS';
      } else {
        decision = 'ITERATE_AUDIENCE';
        reason = `CONDOR but ROAS ${roas.toFixed(1)}x below target ${targetRoas}x`;
        action = 'Optimize audience targeting to improve ROAS';
      }
    }
    // 5. TOF classification (potential)
    else if (classification === 'TOF') {
      session.consecutiveDeads = 0;
      if (roas >= targetRoas) {
        decision = 'ITERATE_CREATIVE';
        reason = `TOF + profitable — test more creatives`;
        action = 'Test additional creative variants';
      } else if (roas >= 1.5) {
        decision = 'ITERATE_AUDIENCE';
        reason = `TOF + ROAS ${roas.toFixed(1)}x — optimize audience`;
        action = 'Refine audience targeting';
      } else {
        decision = 'ITERATE_ANGLE';
        reason = `TOF + low ROAS — change angle`;
        action = 'Test completely different marketing angle';
      }
    }
    // 6. BOF classification (bottom of funnel)
    else if (classification === 'BOF') {
      session.consecutiveDeads = 0;
      decision = 'RETARGET';
      reason = `BOF — focus on retargeting only`;
      action = 'Switch to retargeting audience with new offers';
    }
    // 7. Unknown / insufficient data
    else {
      decision = 'WAIT_MORE';
      reason = `Insufficient data — ${metrics.impressions} impressions, ${daysRunning} days`;
      action = `Wait ${session.config.waitHours}h more for data`;
    }

    // Check fatigue
    if (fatigueScore > 0.7 && decision !== 'KILL') {
      reason += ` | Creative fatigue: ${(fatigueScore*100).toFixed(0)}%`;
      action += ' + refresh creatives';
    }

    // Track no-improvement
    if (session.metrics.length >= 2) {
      const prevRoas = session.metrics[session.metrics.length - 2].roas;
      if (roas <= prevRoas) {
        session.consecutiveNoImprovement++;
      } else {
        session.consecutiveNoImprovement = 0;
      }
    }

    // Circuit breaker: 3 no-improvement → PAUSE
    if (session.consecutiveNoImprovement >= 3 && decision !== 'KILL') {
      decision = 'PAUSE';
      reason = `3 consecutive iterations without ROAS improvement`;
      action = 'Pause campaign — needs manual review';
    }

    return {
      iteration: session.currentIteration,
      decision,
      reason,
      metrics,
      action,
      timestamp: new Date(),
    };
  }

  // ── Apply Decision ───────────────────────────────────────────────────

  private applyDecision(session: LoopSession, record: DecisionRecord): {
    newState:  LoopState;
    decision:  Decision;
    action:    string;
    reason:    string;
  } {
    switch (record.decision) {
      case 'SCALE_UP':
        // Check dual exit gate
        if (this.checkExitGate(session)) {
          session.state = 'EXIT';
          session.exitReason = `Exit gate passed: ROAS target met for ${session.consecutiveProfitableDays} days`;
        } else {
          session.state = 'SCALE';
        }
        break;

      case 'ITERATE_CREATIVE':
      case 'ITERATE_AUDIENCE':
      case 'ITERATE_ANGLE':
      case 'RETARGET':
        session.state = 'ITERATE';
        break;

      case 'KILL':
        session.state = 'KILL';
        session.exitReason = record.reason;
        break;

      case 'PAUSE':
        session.state = 'PAUSE';
        session.exitReason = record.reason;
        break;

      case 'WAIT_MORE':
        session.state = 'WAIT';
        break;
    }

    return {
      newState: session.state,
      decision: record.decision,
      action: record.action,
      reason: record.reason,
    };
  }

  // ── Dual Exit Gate ───────────────────────────────────────────────────

  private checkExitGate(session: LoopSession): boolean {
    const { targetRoas, exitConsecutiveDays } = session.config;

    // Count consecutive profitable days
    const recentMetrics = session.metrics.slice(-exitConsecutiveDays);
    const allProfitable = recentMetrics.length >= exitConsecutiveDays &&
      recentMetrics.every(m => m.roas >= targetRoas);

    if (allProfitable) {
      session.consecutiveProfitableDays = recentMetrics.length;
    }

    // Gate 1: ROAS ≥ target for N consecutive measurement periods
    const roasGate = session.consecutiveProfitableDays >= exitConsecutiveDays;

    // Gate 2: Meaningful budget spent (at least 50% of test budget)
    const budgetGate = session.totalSpent >= session.config.testBudget * 0.5;

    return roasGate && budgetGate;
  }

  // ── Session Management ───────────────────────────────────────────────

  getSession(sessionId: string): LoopSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionsByShop(shopId: string): LoopSession[] {
    return Array.from(this.sessions.values())
      .filter(s => s.config.shopId === shopId);
  }

  getActiveSessions(): LoopSession[] {
    return Array.from(this.sessions.values())
      .filter(s => !['KILL', 'EXIT', 'PAUSE'].includes(s.state));
  }

  resumeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId);
    if (session && session.state === 'PAUSE') {
      session.state = 'WAIT';
      session.consecutiveNoImprovement = 0;
      session.exitReason = undefined;
    }
  }

  // ── Summary ──────────────────────────────────────────────────────────

  getSessionSummary(sessionId: string): string {
    const session = this.sessions.get(sessionId);
    if (!session) return 'Session not found';

    const latestMetrics = session.metrics[session.metrics.length - 1];
    const overallRoas = session.totalSpent > 0
      ? session.totalRevenue / session.totalSpent
      : 0;

    return [
      `Ralph Loop: ${session.id}`,
      `State: ${session.state}`,
      `Iteration: ${session.currentIteration}/${session.config.maxIterations}`,
      `Budget: ${session.currentBudget.toFixed(0)}€ (spent: ${session.totalSpent.toFixed(0)}€)`,
      `Overall ROAS: ${overallRoas.toFixed(2)}x (target: ${session.config.targetRoas}x)`,
      latestMetrics ? `Latest: ${latestMetrics.classification} | ROAS ${latestMetrics.roas.toFixed(1)}x` : 'No data yet',
      session.decisions.length > 0
        ? `Last decision: ${session.decisions[session.decisions.length - 1].decision}`
        : '',
      session.exitReason ? `Exit: ${session.exitReason}` : '',
    ].filter(Boolean).join('\n');
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const ralphLoop = new RalphLoopEngine();
