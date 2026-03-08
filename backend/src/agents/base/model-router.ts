/**
 * Model Router — Dynamic LLM selection per agent/tier/complexity
 * ===============================================================
 * Sources: Claude Code Router, VoltAgent Subagents, Claude Code Showcase
 *
 * Route types:
 *   analysis      → Data analysis, classification (Haiku→Sonnet)
 *   creative      → Copy, ads, store pages (Sonnet→Opus)
 *   quick         → Simple lookups, status checks (Haiku)
 *   orchestration → Pipeline decisions, coordination (Sonnet)
 *   review        → Quality checks, compliance (Sonnet→Opus)
 *
 * Tier routing:
 *   Seed (1)   → Always Haiku (cost-optimized)
 *   Growth (2) → Haiku for quick, Sonnet for creative/analysis
 *   Scale (3)  → Sonnet default, Opus for creative/review
 *   Empire (4) → Opus for creative/review, Sonnet for rest
 *
 * Agent overrides: Some agents always use a specific model
 * Dynamic upgrade: If task complexity > threshold, upgrade model
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ModelTier = 'haiku' | 'sonnet' | 'opus';
export type RouteType = 'analysis' | 'creative' | 'quick' | 'orchestration' | 'review';

export interface ModelRoute {
  model:       ModelTier;
  reason:      string;
  costFactor:  number;    // Relative cost: haiku=1, sonnet=5, opus=25
  upgraded?:   boolean;   // True if dynamic upgrade applied
}

export interface ModelUsage {
  model:       ModelTier;
  agentName:   string;
  shopId:      string;
  tokensIn:    number;
  tokensOut:   number;
  costUsd:     number;
  durationMs:  number;
  timestamp:   Date;
}

// ── Cost factors ──────────────────────────────────────────────────────────

const COST_FACTORS: Record<ModelTier, number> = {
  haiku:  1,
  sonnet: 5,
  opus:   25,
};

// Tokens per dollar (approximate, for budget estimation)
const TOKENS_PER_DOLLAR: Record<ModelTier, number> = {
  haiku:  4_000_000,   // ~$0.25/1M input
  sonnet: 333_333,     // ~$3/1M input
  opus:   66_667,      // ~$15/1M input
};

// ── Tier × Route Matrix ──────────────────────────────────────────────────

const TIER_ROUTING: Record<number, Record<RouteType, ModelTier>> = {
  1: { // Seed — always cheapest
    analysis:      'haiku',
    creative:      'haiku',
    quick:         'haiku',
    orchestration: 'haiku',
    review:        'haiku',
  },
  2: { // Growth — sonnet for important tasks
    analysis:      'sonnet',
    creative:      'sonnet',
    quick:         'haiku',
    orchestration: 'haiku',
    review:        'sonnet',
  },
  3: { // Scale — opus for creative
    analysis:      'sonnet',
    creative:      'opus',
    quick:         'haiku',
    orchestration: 'sonnet',
    review:        'opus',
  },
  4: { // Empire — best quality
    analysis:      'sonnet',
    creative:      'opus',
    quick:         'sonnet',
    orchestration: 'sonnet',
    review:        'opus',
  },
};

// ── Agent-specific overrides ──────────────────────────────────────────────

const AGENT_OVERRIDES: Record<string, { model: ModelTier; reason: string }> = {
  // Creative agents — need high quality
  'AGENT_PSYCHO_MARKETING': { model: 'opus',   reason: 'Psychological analysis requires deep reasoning' },
  'AGENT_COPY_CHIEF':       { model: 'sonnet', reason: 'Copywriting needs good creative quality' },
  'AGENT_STORE_BUILDER':    { model: 'sonnet', reason: 'Store design needs quality generation' },
  'AGENT_FUNNEL_ENGINE':    { model: 'sonnet', reason: 'Funnel strategy needs quality reasoning' },

  // Fast agents — speed matters
  'AGENT_RESULTS_48H':      { model: 'haiku',  reason: 'Classification is pattern-matching' },
  'AGENT_CAMPAIGN_MONITOR': { model: 'haiku',  reason: 'Monitoring is data lookup' },
  'AGENT_DATA_VALIDATOR':   { model: 'haiku',  reason: 'Validation is rule-based' },
  'AGENT_PRODUCT_INGEST':   { model: 'haiku',  reason: 'Data extraction is structured' },

  // Decision agents — need reasoning
  'AGENT_SCALER':           { model: 'sonnet', reason: 'Scaling decisions need good judgment' },
  'AGENT_OFFER_ENGINE':     { model: 'sonnet', reason: 'Offer strategy needs market understanding' },
  'AGENT_DEEP_ANALYZER':    { model: 'opus',   reason: 'Deep analysis requires comprehensive reasoning' },
};

// ── Agent → Route Type mapping ────────────────────────────────────────────

const AGENT_ROUTE_TYPES: Record<string, RouteType> = {
  // Analysis agents
  'AGENT_RESULTS_48H':      'analysis',
  'AGENT_DEEP_ANALYZER':    'analysis',
  'AGENT_CAMPAIGN_MONITOR': 'analysis',
  'AGENT_DATA_VALIDATOR':   'analysis',
  'AGENT_PRODUCT_INGEST':   'analysis',

  // Creative agents
  'AGENT_COPY_CHIEF':       'creative',
  'AGENT_PSYCHO_MARKETING': 'creative',
  'AGENT_STORE_BUILDER':    'creative',
  'AGENT_FUNNEL_ENGINE':    'creative',
  'AGENT_AD_CREATOR':       'creative',

  // Quick lookup agents
  'AGENT_SCRAPER':          'quick',
  'AGENT_TREND_HUNTER':     'quick',
  'AGENT_COMPLIANCE':       'quick',

  // Orchestration agents
  'AGENT_CEO':              'orchestration',
  'AGENT_SCALER':           'orchestration',
  'AGENT_OFFER_ENGINE':     'orchestration',
  'AGENT_BUDGET_PROTECTOR': 'orchestration',

  // Review agents
  'AGENT_QUALITY_CHECKER':  'review',
};

// ── Model Router ──────────────────────────────────────────────────────────

class ModelRouter {
  private usageLog: ModelUsage[] = [];
  private maxLogSize = 10_000;

  /**
   * Route an agent to the optimal model
   */
  route(agentName: string, tier: number, options?: {
    forceModel?:   ModelTier;
    complexity?:   number;      // 0-1 scale
    routeType?:    RouteType;
    budgetRemaining?: number;   // USD
  }): ModelRoute {
    // 1. Force override
    if (options?.forceModel) {
      return {
        model: options.forceModel,
        reason: `Forced: ${options.forceModel}`,
        costFactor: COST_FACTORS[options.forceModel],
      };
    }

    // 2. Agent-specific override (only for tiers that support it)
    if (AGENT_OVERRIDES[agentName] && tier >= 2) {
      const override = AGENT_OVERRIDES[agentName];
      // Downgrade if tier doesn't support the model
      let model = override.model;
      if (tier === 2 && model === 'opus') model = 'sonnet';
      if (tier === 1) model = 'haiku';

      return {
        model,
        reason: override.reason,
        costFactor: COST_FACTORS[model],
      };
    }

    // 3. Route type based on tier matrix
    const routeType = options?.routeType || AGENT_ROUTE_TYPES[agentName] || 'analysis';
    const tierRoutes = TIER_ROUTING[tier] || TIER_ROUTING[1];
    let model = tierRoutes[routeType];

    // 4. Dynamic upgrade on complexity
    let upgraded = false;
    if (options?.complexity && options.complexity > 0.8) {
      if (model === 'haiku') {
        model = 'sonnet';
        upgraded = true;
      } else if (model === 'sonnet' && tier >= 3) {
        model = 'opus';
        upgraded = true;
      }
    }

    // 5. Budget constraint — downgrade if budget is low
    if (options?.budgetRemaining !== undefined && options.budgetRemaining < 1) {
      model = 'haiku'; // Emergency: use cheapest
    }

    return {
      model,
      reason: upgraded
        ? `Upgraded from tier matrix due to high complexity (${options!.complexity!.toFixed(2)})`
        : `Tier ${tier} × ${routeType} → ${model}`,
      costFactor: COST_FACTORS[model],
      upgraded,
    };
  }

  /**
   * Record model usage for analytics
   */
  recordUsage(usage: ModelUsage): void {
    this.usageLog.push(usage);

    // Trim log
    if (this.usageLog.length > this.maxLogSize) {
      this.usageLog = this.usageLog.slice(-this.maxLogSize / 2);
    }
  }

  /**
   * Get usage analytics
   */
  getAnalytics(shopId?: string, since?: Date): {
    totalCost:      number;
    byModel:        Record<ModelTier, { calls: number; cost: number; tokens: number }>;
    byAgent:        Record<string, { calls: number; cost: number; model: ModelTier }>;
    avgDuration:    number;
  } {
    let entries = this.usageLog;
    if (shopId) entries = entries.filter(e => e.shopId === shopId);
    if (since) entries = entries.filter(e => e.timestamp >= since);

    const byModel: Record<ModelTier, { calls: number; cost: number; tokens: number }> = {
      haiku:  { calls: 0, cost: 0, tokens: 0 },
      sonnet: { calls: 0, cost: 0, tokens: 0 },
      opus:   { calls: 0, cost: 0, tokens: 0 },
    };

    const byAgent: Record<string, { calls: number; cost: number; model: ModelTier }> = {};
    let totalCost = 0;
    let totalDuration = 0;

    for (const e of entries) {
      totalCost += e.costUsd;
      totalDuration += e.durationMs;

      byModel[e.model].calls++;
      byModel[e.model].cost += e.costUsd;
      byModel[e.model].tokens += e.tokensIn + e.tokensOut;

      if (!byAgent[e.agentName]) {
        byAgent[e.agentName] = { calls: 0, cost: 0, model: e.model };
      }
      byAgent[e.agentName].calls++;
      byAgent[e.agentName].cost += e.costUsd;
    }

    return {
      totalCost,
      byModel,
      byAgent,
      avgDuration: entries.length > 0 ? totalDuration / entries.length : 0,
    };
  }

  /**
   * Get model API string for Claude API
   */
  static toApiModel(tier: ModelTier): string {
    switch (tier) {
      case 'haiku':  return 'claude-3-5-haiku-20241022';
      case 'sonnet': return 'claude-sonnet-4-20250514';
      case 'opus':   return 'claude-opus-4-20250514';
    }
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const modelRouter = new ModelRouter();
