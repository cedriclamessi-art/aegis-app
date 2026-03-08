/**
 * Circuit Breaker — Protection against cascading failures
 * ========================================================
 * Sources: Ralph Claude Code, VoltAgent Subagents
 *
 * 3 states:
 *   CLOSED   — Normal operation, tracking failures
 *   OPEN     — Blocked, waiting for cooldown
 *   HALF_OPEN — Testing with a single request
 *
 * Thresholds (configurable per agent):
 *   consecutiveFailures: 3 consecutive failures → OPEN
 *   sameErrorCount:      5 same error type → OPEN
 *   noProgressCount:     3 no-improvement cycles → OPEN
 *
 * Recovery:
 *   After cooldownMs (default 60s), moves to HALF_OPEN.
 *   If next request succeeds → CLOSED.
 *   If next request fails → OPEN (reset cooldown).
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type CircuitState = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

export interface CircuitBreakerConfig {
  maxConsecutiveFailures: number;
  maxSameErrors:          number;
  maxNoProgress:          number;
  cooldownMs:             number;
  halfOpenMaxAttempts:    number;
}

export interface CircuitBreakerStatus {
  state:                CircuitState;
  consecutiveFailures:  number;
  totalFailures:        number;
  totalSuccesses:       number;
  lastError?:           string;
  lastErrorAt?:         Date;
  openedAt?:            Date;
  errorCounts:          Map<string, number>;
  noProgressCount:      number;
}

// ── Default Config ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  maxConsecutiveFailures: 3,
  maxSameErrors:          5,
  maxNoProgress:          3,
  cooldownMs:             60_000,    // 60 seconds
  halfOpenMaxAttempts:    1,
};

// ── Circuit Breaker ───────────────────────────────────────────────────────

class CircuitBreaker {
  private state: CircuitState = 'CLOSED';
  private consecutiveFailures = 0;
  private totalFailures = 0;
  private totalSuccesses = 0;
  private lastError?: string;
  private lastErrorAt?: Date;
  private openedAt?: Date;
  private errorCounts: Map<string, number> = new Map();
  private noProgressCount = 0;
  private config: CircuitBreakerConfig;
  private halfOpenAttempts = 0;

  constructor(config?: Partial<CircuitBreakerConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Check if request is allowed ──────────────────────────────────────

  canExecute(): { allowed: boolean; state: CircuitState; reason?: string } {
    switch (this.state) {
      case 'CLOSED':
        return { allowed: true, state: 'CLOSED' };

      case 'OPEN': {
        // Check if cooldown has elapsed
        if (this.openedAt) {
          const elapsed = Date.now() - this.openedAt.getTime();
          if (elapsed >= this.config.cooldownMs) {
            this.state = 'HALF_OPEN';
            this.halfOpenAttempts = 0;
            return { allowed: true, state: 'HALF_OPEN', reason: 'Cooldown elapsed, testing...' };
          }
          const remaining = Math.ceil((this.config.cooldownMs - elapsed) / 1000);
          return {
            allowed: false,
            state: 'OPEN',
            reason: `Circuit OPEN — cooldown ${remaining}s remaining. Last error: ${this.lastError}`,
          };
        }
        return { allowed: false, state: 'OPEN', reason: 'Circuit OPEN' };
      }

      case 'HALF_OPEN': {
        if (this.halfOpenAttempts < this.config.halfOpenMaxAttempts) {
          this.halfOpenAttempts++;
          return { allowed: true, state: 'HALF_OPEN', reason: 'Half-open test request' };
        }
        return { allowed: false, state: 'HALF_OPEN', reason: 'Half-open test in progress' };
      }
    }
  }

  // ── Record success ──────────────────────────────────────────────────

  recordSuccess(): void {
    this.totalSuccesses++;
    this.consecutiveFailures = 0;
    this.noProgressCount = 0;

    if (this.state === 'HALF_OPEN') {
      // Recovery: move back to CLOSED
      this.state = 'CLOSED';
      this.errorCounts.clear();
      this.halfOpenAttempts = 0;
    }
  }

  // ── Record failure ──────────────────────────────────────────────────

  recordFailure(errorType: string, errorMessage: string): void {
    this.totalFailures++;
    this.consecutiveFailures++;
    this.lastError = errorMessage;
    this.lastErrorAt = new Date();

    // Track error types
    const count = (this.errorCounts.get(errorType) || 0) + 1;
    this.errorCounts.set(errorType, count);

    // Check thresholds
    const shouldOpen =
      this.consecutiveFailures >= this.config.maxConsecutiveFailures ||
      count >= this.config.maxSameErrors;

    if (shouldOpen || this.state === 'HALF_OPEN') {
      this.trip(errorMessage);
    }
  }

  // ── Record no progress (for optimization loops) ─────────────────────

  recordNoProgress(): void {
    this.noProgressCount++;

    if (this.noProgressCount >= this.config.maxNoProgress) {
      this.trip('No progress after ' + this.noProgressCount + ' cycles');
    }
  }

  // ── Trip the breaker ────────────────────────────────────────────────

  private trip(reason: string): void {
    this.state = 'OPEN';
    this.openedAt = new Date();
    this.lastError = reason;
  }

  // ── Force reset ─────────────────────────────────────────────────────

  reset(): void {
    this.state = 'CLOSED';
    this.consecutiveFailures = 0;
    this.noProgressCount = 0;
    this.errorCounts.clear();
    this.openedAt = undefined;
    this.halfOpenAttempts = 0;
  }

  // ── Get status ──────────────────────────────────────────────────────

  getStatus(): CircuitBreakerStatus {
    return {
      state: this.state,
      consecutiveFailures: this.consecutiveFailures,
      totalFailures: this.totalFailures,
      totalSuccesses: this.totalSuccesses,
      lastError: this.lastError,
      lastErrorAt: this.lastErrorAt,
      openedAt: this.openedAt,
      errorCounts: new Map(this.errorCounts),
      noProgressCount: this.noProgressCount,
    };
  }
}

// ── Circuit Breaker Registry ──────────────────────────────────────────────
// Per-agent circuit breakers, keyed by "agentName:shopId"

class CircuitBreakerRegistry {
  private breakers: Map<string, CircuitBreaker> = new Map();
  private configs: Map<string, Partial<CircuitBreakerConfig>> = new Map();

  // Set custom config for an agent type
  setConfig(agentName: string, config: Partial<CircuitBreakerConfig>): void {
    this.configs.set(agentName, config);
  }

  // Get or create a circuit breaker for agent+shop
  get(agentName: string, shopId: string): CircuitBreaker {
    const key = `${agentName}:${shopId}`;
    if (!this.breakers.has(key)) {
      const agentConfig = this.configs.get(agentName);
      this.breakers.set(key, new CircuitBreaker(agentConfig));
    }
    return this.breakers.get(key)!;
  }

  // Get all breakers in a given state
  getByState(state: CircuitState): Array<{ key: string; status: CircuitBreakerStatus }> {
    const results: Array<{ key: string; status: CircuitBreakerStatus }> = [];
    for (const [key, breaker] of this.breakers) {
      const status = breaker.getStatus();
      if (status.state === state) {
        results.push({ key, status });
      }
    }
    return results;
  }

  // Reset all breakers for a shop
  resetShop(shopId: string): void {
    for (const [key, breaker] of this.breakers) {
      if (key.endsWith(`:${shopId}`)) {
        breaker.reset();
      }
    }
  }

  // Get summary stats
  getSummary(): { total: number; closed: number; open: number; halfOpen: number } {
    let closed = 0, open = 0, halfOpen = 0;
    for (const breaker of this.breakers.values()) {
      const s = breaker.getStatus().state;
      if (s === 'CLOSED') closed++;
      else if (s === 'OPEN') open++;
      else halfOpen++;
    }
    return { total: this.breakers.size, closed, open, halfOpen };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const circuitBreakerRegistry = new CircuitBreakerRegistry();
