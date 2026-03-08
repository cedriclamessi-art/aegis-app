/**
 * Rate Limiter — Per-tier rate limiting with sliding windows
 * ==========================================================
 * Sources: Ralph Claude Code, Claude Code Showcase
 *
 * Tier limits:
 *   Seed (1)   — 50 agent calls/hour,  2 concurrent pipelines, 10k tokens/day
 *   Growth (2) — 200 calls/hour,       5 concurrent pipelines, 100k tokens/day
 *   Scale (3)  — 1000 calls/hour,      20 concurrent pipelines, 1M tokens/day
 *   Empire (4) — Unlimited calls,      100 concurrent pipelines, 10M tokens/day
 *
 * Features:
 *   - Sliding window counters (per minute precision)
 *   - Per-tenant tracking
 *   - LLM token budget enforcement
 *   - Concurrent pipeline limiting
 *   - Graceful degradation: suggest→throttle→block
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type TierName = 'seed' | 'growth' | 'scale' | 'empire';

export interface TierLimits {
  callsPerHour:         number;
  concurrentPipelines:  number;
  tokensPerDay:         number;
  externalApiPerHour:   number;
}

export interface RateLimitResult {
  allowed:      boolean;
  reason?:      string;
  remaining?:   number;
  resetIn?:     number;   // ms until reset
  tier:         TierName;
}

interface WindowEntry {
  timestamp: number;
  count:     number;
}

interface TenantState {
  // Sliding window for calls per hour
  callWindows:         WindowEntry[];
  // Token usage today
  tokensUsedToday:     number;
  tokenResetDate:      string;   // YYYY-MM-DD
  // Active pipelines
  activePipelines:     Set<string>;
  // External API calls
  externalApiWindows:  WindowEntry[];
}

// ── Tier Configuration ────────────────────────────────────────────────────

const TIER_LIMITS: Record<number, TierLimits> = {
  1: { // Seed
    callsPerHour:         50,
    concurrentPipelines:  2,
    tokensPerDay:         10_000,
    externalApiPerHour:   20,
  },
  2: { // Growth
    callsPerHour:         200,
    concurrentPipelines:  5,
    tokensPerDay:         100_000,
    externalApiPerHour:   100,
  },
  3: { // Scale
    callsPerHour:         1_000,
    concurrentPipelines:  20,
    tokensPerDay:         1_000_000,
    externalApiPerHour:   500,
  },
  4: { // Empire
    callsPerHour:         100_000,    // Effectively unlimited
    concurrentPipelines:  100,
    tokensPerDay:         10_000_000,
    externalApiPerHour:   10_000,
  },
};

const TIER_NAMES: Record<number, TierName> = {
  1: 'seed',
  2: 'growth',
  3: 'scale',
  4: 'empire',
};

// ── Rate Limiter ──────────────────────────────────────────────────────────

class RateLimiter {
  private tenants: Map<string, TenantState> = new Map();
  private windowSizeMs = 60_000;  // 1 minute granularity
  private hourMs = 3_600_000;

  // ── Get or create tenant state ───────────────────────────────────────

  private getState(shopId: string): TenantState {
    if (!this.tenants.has(shopId)) {
      this.tenants.set(shopId, {
        callWindows: [],
        tokensUsedToday: 0,
        tokenResetDate: new Date().toISOString().split('T')[0],
        activePipelines: new Set(),
        externalApiWindows: [],
      });
    }

    const state = this.tenants.get(shopId)!;

    // Reset daily token counter if needed
    const today = new Date().toISOString().split('T')[0];
    if (state.tokenResetDate !== today) {
      state.tokensUsedToday = 0;
      state.tokenResetDate = today;
    }

    return state;
  }

  // ── Clean old windows ────────────────────────────────────────────────

  private cleanWindows(windows: WindowEntry[]): WindowEntry[] {
    const cutoff = Date.now() - this.hourMs;
    return windows.filter(w => w.timestamp > cutoff);
  }

  // ── Count calls in last hour ─────────────────────────────────────────

  private countInHour(windows: WindowEntry[]): number {
    return windows.reduce((sum, w) => sum + w.count, 0);
  }

  // ── Check rate limit ─────────────────────────────────────────────────

  checkLimit(shopId: string, tier: number): RateLimitResult {
    const limits = TIER_LIMITS[tier] || TIER_LIMITS[1];
    const tierName = TIER_NAMES[tier] || 'seed';
    const state = this.getState(shopId);

    // Clean old windows
    state.callWindows = this.cleanWindows(state.callWindows);

    // Check calls per hour
    const callCount = this.countInHour(state.callWindows);
    if (callCount >= limits.callsPerHour) {
      const oldestWindow = state.callWindows[0];
      const resetIn = oldestWindow
        ? (oldestWindow.timestamp + this.hourMs) - Date.now()
        : this.hourMs;

      return {
        allowed: false,
        reason: `Rate limit: ${callCount}/${limits.callsPerHour} calls/hour (${tierName})`,
        remaining: 0,
        resetIn,
        tier: tierName,
      };
    }

    // Check daily token budget
    if (state.tokensUsedToday >= limits.tokensPerDay) {
      return {
        allowed: false,
        reason: `Token budget: ${state.tokensUsedToday.toLocaleString()}/${limits.tokensPerDay.toLocaleString()} tokens/day (${tierName})`,
        remaining: 0,
        tier: tierName,
      };
    }

    return {
      allowed: true,
      remaining: limits.callsPerHour - callCount,
      tier: tierName,
    };
  }

  // ── Record a call ────────────────────────────────────────────────────

  recordCall(shopId: string): void {
    const state = this.getState(shopId);
    const now = Date.now();
    const windowKey = Math.floor(now / this.windowSizeMs) * this.windowSizeMs;

    const existing = state.callWindows.find(w => w.timestamp === windowKey);
    if (existing) {
      existing.count++;
    } else {
      state.callWindows.push({ timestamp: windowKey, count: 1 });
    }
  }

  // ── Record token usage ───────────────────────────────────────────────

  recordTokens(shopId: string, tokens: number): void {
    const state = this.getState(shopId);
    state.tokensUsedToday += tokens;
  }

  // ── Pipeline concurrency ─────────────────────────────────────────────

  checkPipelineLimit(shopId: string, tier: number, pipelineId: string): RateLimitResult {
    const limits = TIER_LIMITS[tier] || TIER_LIMITS[1];
    const tierName = TIER_NAMES[tier] || 'seed';
    const state = this.getState(shopId);

    if (state.activePipelines.size >= limits.concurrentPipelines) {
      return {
        allowed: false,
        reason: `Pipeline limit: ${state.activePipelines.size}/${limits.concurrentPipelines} concurrent (${tierName})`,
        remaining: 0,
        tier: tierName,
      };
    }

    return {
      allowed: true,
      remaining: limits.concurrentPipelines - state.activePipelines.size,
      tier: tierName,
    };
  }

  startPipeline(shopId: string, pipelineId: string): void {
    this.getState(shopId).activePipelines.add(pipelineId);
  }

  endPipeline(shopId: string, pipelineId: string): void {
    this.getState(shopId).activePipelines.delete(pipelineId);
  }

  // ── External API rate limiting ───────────────────────────────────────

  checkExternalApiLimit(shopId: string, tier: number): RateLimitResult {
    const limits = TIER_LIMITS[tier] || TIER_LIMITS[1];
    const tierName = TIER_NAMES[tier] || 'seed';
    const state = this.getState(shopId);

    state.externalApiWindows = this.cleanWindows(state.externalApiWindows);
    const apiCount = this.countInHour(state.externalApiWindows);

    if (apiCount >= limits.externalApiPerHour) {
      return {
        allowed: false,
        reason: `External API limit: ${apiCount}/${limits.externalApiPerHour} calls/hour (${tierName})`,
        remaining: 0,
        tier: tierName,
      };
    }

    return {
      allowed: true,
      remaining: limits.externalApiPerHour - apiCount,
      tier: tierName,
    };
  }

  recordExternalApiCall(shopId: string): void {
    const state = this.getState(shopId);
    const now = Date.now();
    const windowKey = Math.floor(now / this.windowSizeMs) * this.windowSizeMs;

    const existing = state.externalApiWindows.find(w => w.timestamp === windowKey);
    if (existing) {
      existing.count++;
    } else {
      state.externalApiWindows.push({ timestamp: windowKey, count: 1 });
    }
  }

  // ── Get usage stats ──────────────────────────────────────────────────

  getUsage(shopId: string, tier: number): {
    callsUsed:           number;
    callsLimit:          number;
    tokensUsed:          number;
    tokensLimit:         number;
    activePipelines:     number;
    pipelineLimit:       number;
    percentUsed:         number;
  } {
    const limits = TIER_LIMITS[tier] || TIER_LIMITS[1];
    const state = this.getState(shopId);
    state.callWindows = this.cleanWindows(state.callWindows);
    const callsUsed = this.countInHour(state.callWindows);

    return {
      callsUsed,
      callsLimit:       limits.callsPerHour,
      tokensUsed:       state.tokensUsedToday,
      tokensLimit:      limits.tokensPerDay,
      activePipelines:  state.activePipelines.size,
      pipelineLimit:    limits.concurrentPipelines,
      percentUsed:      Math.round((callsUsed / limits.callsPerHour) * 100),
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const rateLimiter = new RateLimiter();
