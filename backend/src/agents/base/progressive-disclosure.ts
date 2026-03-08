/**
 * Progressive Disclosure — Complexity-based agent dispatch
 * ==========================================================
 * Sources: lst97/claude-code-subagents, Cranot/claude-code-guide,
 *          Yeachan-Heo/oh-my-claudecode
 *
 * Routes tasks to appropriate complexity level:
 *   Level 1 (Fast)   — Simple lookups, status checks → cheap model, few turns
 *   Level 2 (Medium) — Analysis, reports → standard model, moderate turns
 *   Level 3 (Deep)   — Creative generation, strategy → smart model, many turns
 *   Level 4 (Expert) — Full pipeline, multi-agent → best model, full budget
 *
 * Features:
 *   - Automatic complexity detection from task description
 *   - Keyword-based routing
 *   - Tier-based access gates
 *   - Dynamic upgrade when simple approach fails
 *   - Cost estimation before execution
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ComplexityLevel = 1 | 2 | 3 | 4;

export interface ComplexityProfile {
  level:         ComplexityLevel;
  label:         string;
  model:         string;
  maxTurns:      number;
  maxCostUsd:    number;
  description:   string;
  minTier:       number;
}

export interface ComplexitySignal {
  keywords:      string[];
  level:         ComplexityLevel;
  weight:        number;          // 0-1, higher = stronger signal
}

export interface DispatchResult {
  level:         ComplexityLevel;
  profile:       ComplexityProfile;
  confidence:    number;          // 0-1
  signals:       string[];        // Which signals matched
  estimatedCost: number;          // USD
  estimatedTime: number;          // milliseconds
  canExecute:    boolean;         // Based on tier
  tierRequired:  number;
}

// ── Complexity Profiles ───────────────────────────────────────────────────

const COMPLEXITY_PROFILES: Record<ComplexityLevel, ComplexityProfile> = {
  1: {
    level: 1,
    label: 'Fast',
    model: 'claude-haiku-4-20250514',
    maxTurns: 3,
    maxCostUsd: 0.05,
    description: 'Simple lookups, status checks, basic queries',
    minTier: 1,
  },
  2: {
    level: 2,
    label: 'Medium',
    model: 'claude-haiku-4-20250514',
    maxTurns: 8,
    maxCostUsd: 0.50,
    description: 'Analysis, reports, data processing',
    minTier: 1,
  },
  3: {
    level: 3,
    label: 'Deep',
    model: 'claude-sonnet-4-20250514',
    maxTurns: 15,
    maxCostUsd: 3.00,
    description: 'Creative generation, strategy, optimization',
    minTier: 2,
  },
  4: {
    level: 4,
    label: 'Expert',
    model: 'claude-sonnet-4-20250514',
    maxTurns: 30,
    maxCostUsd: 10.00,
    description: 'Full pipeline, multi-agent orchestration',
    minTier: 3,
  },
};

// ── Complexity Signals ────────────────────────────────────────────────────

const COMPLEXITY_SIGNALS: ComplexitySignal[] = [
  // Level 1 — Simple
  { keywords: ['status', 'check', 'list', 'get', 'show', 'count'], level: 1, weight: 0.8 },
  { keywords: ['price', 'cost', 'balance', 'total'], level: 1, weight: 0.6 },
  { keywords: ['help', 'info', 'about', 'what is'], level: 1, weight: 0.9 },

  // Level 2 — Medium
  { keywords: ['analyze', 'report', 'compare', 'summary', 'review'], level: 2, weight: 0.8 },
  { keywords: ['audit', 'metrics', 'performance', 'trend'], level: 2, weight: 0.7 },
  { keywords: ['monitor', 'track', 'watch'], level: 2, weight: 0.6 },

  // Level 3 — Deep
  { keywords: ['create', 'generate', 'build', 'write', 'design'], level: 3, weight: 0.8 },
  { keywords: ['optimize', 'improve', 'strategy', 'plan'], level: 3, weight: 0.7 },
  { keywords: ['copy', 'creative', 'ad', 'hook', 'headline'], level: 3, weight: 0.8 },
  { keywords: ['audience', 'targeting', 'segment'], level: 3, weight: 0.6 },

  // Level 4 — Expert
  { keywords: ['launch', 'pipeline', 'full', 'complete', 'end-to-end'], level: 4, weight: 0.9 },
  { keywords: ['scale', 'grow', 'expand', 'multiply'], level: 4, weight: 0.7 },
  { keywords: ['multi', 'orchestrate', 'coordinate', 'team'], level: 4, weight: 0.8 },
  { keywords: ['automate', 'autonomous', 'ralph', 'loop'], level: 4, weight: 0.9 },
];

// ── Agent-to-Level Mapping ────────────────────────────────────────────────

const AGENT_COMPLEXITY: Record<string, ComplexityLevel> = {
  // Level 1 — Fast agents
  'AGENT_PRODUCT_INGEST':     1,
  'AGENT_RESULTS_48H':        1,
  'AGENT_CAMPAIGN_MONITOR':   1,
  'AGENT_DATA_PROCESSOR':     1,

  // Level 2 — Medium agents
  'AGENT_SPY':                2,
  'AGENT_STORE_AUDITOR':      2,
  'AGENT_CREATIVE_SCORER':    2,
  'AGENT_REPORT_GENERATOR':   2,
  'AGENT_TREND_ANALYZER':     2,

  // Level 3 — Deep agents
  'AGENT_COPY_CHIEF':         3,
  'AGENT_OFFER_ENGINE':       3,
  'AGENT_PSYCHO_MARKETING':   3,
  'AGENT_UGC_FACTORY':        3,
  'AGENT_BUDGET_OPTIMIZER':   3,
  'AGENT_AUDIENCE_FINDER':    3,
  'AGENT_NICHE_FINDER':       3,

  // Level 4 — Expert agents
  'AGENT_STORE_BUILDER':      4,
  'AGENT_AD_LAUNCHER':        4,
  'AGENT_FUNNEL_ENGINE':      4,
  'AGENT_GROWTH_HACKER':      4,
  'AGENT_RALPH':              4,
  'AGENT_PIPELINE_ORCHESTRATOR': 4,
};

// ── Progressive Disclosure Engine ─────────────────────────────────────────

class ProgressiveDisclosureEngine {
  private upgradeHistory: Map<string, ComplexityLevel[]> = new Map();

  // ── Assess complexity ───────────────────────────────────────────────

  assess(taskDescription: string, agentId?: string): DispatchResult {
    const lower = taskDescription.toLowerCase();
    const matchedSignals: Array<{ signal: ComplexitySignal; matched: string[] }> = [];

    // Check signals
    for (const signal of COMPLEXITY_SIGNALS) {
      const matched = signal.keywords.filter(kw => lower.includes(kw));
      if (matched.length > 0) {
        matchedSignals.push({ signal, matched });
      }
    }

    // Calculate weighted level
    let totalWeight = 0;
    let weightedLevel = 0;

    for (const { signal, matched } of matchedSignals) {
      const matchWeight = signal.weight * (matched.length / signal.keywords.length);
      totalWeight += matchWeight;
      weightedLevel += signal.level * matchWeight;
    }

    // Determine level
    let level: ComplexityLevel;
    let confidence: number;

    if (totalWeight > 0) {
      const avgLevel = weightedLevel / totalWeight;
      level = Math.round(avgLevel) as ComplexityLevel;
      level = Math.max(1, Math.min(4, level)) as ComplexityLevel;
      confidence = Math.min(1, totalWeight / 2);  // Normalize
    } else {
      level = 2; // Default to medium
      confidence = 0.3;
    }

    // Agent override if specified
    if (agentId && AGENT_COMPLEXITY[agentId]) {
      const agentLevel = AGENT_COMPLEXITY[agentId];
      if (agentLevel > level) {
        level = agentLevel;
        confidence = Math.max(confidence, 0.7);
      }
    }

    const profile = COMPLEXITY_PROFILES[level];
    const signals = matchedSignals.flatMap(m => m.matched);

    return {
      level,
      profile,
      confidence,
      signals: [...new Set(signals)],
      estimatedCost: profile.maxCostUsd * 0.5, // Average estimate
      estimatedTime: profile.maxTurns * 5000,   // ~5s per turn estimate
      canExecute: true,
      tierRequired: profile.minTier,
    };
  }

  // ── Check tier access ───────────────────────────────────────────────

  canAccess(level: ComplexityLevel, tier: number): boolean {
    return tier >= COMPLEXITY_PROFILES[level].minTier;
  }

  // ── Dynamic upgrade ─────────────────────────────────────────────────

  upgrade(taskId: string, currentLevel: ComplexityLevel, reason: string): DispatchResult | null {
    if (currentLevel >= 4) return null; // Max level

    const newLevel = (currentLevel + 1) as ComplexityLevel;
    const profile = COMPLEXITY_PROFILES[newLevel];

    // Track upgrade history
    const history = this.upgradeHistory.get(taskId) || [];
    history.push(newLevel);
    this.upgradeHistory.set(taskId, history);

    console.log(`[PROGRESSIVE] Upgraded ${taskId}: Level ${currentLevel} → ${newLevel} (${reason})`);

    return {
      level: newLevel,
      profile,
      confidence: 0.8,
      signals: [`upgrade: ${reason}`],
      estimatedCost: profile.maxCostUsd * 0.6,
      estimatedTime: profile.maxTurns * 5000,
      canExecute: true,
      tierRequired: profile.minTier,
    };
  }

  // ── Get profile ─────────────────────────────────────────────────────

  getProfile(level: ComplexityLevel): ComplexityProfile {
    return COMPLEXITY_PROFILES[level];
  }

  // ── Get agent level ─────────────────────────────────────────────────

  getAgentLevel(agentId: string): ComplexityLevel {
    return AGENT_COMPLEXITY[agentId] || 2;
  }

  // ── Cost estimation ─────────────────────────────────────────────────

  estimateCost(level: ComplexityLevel, turnsEstimate?: number): {
    minCostUsd: number;
    maxCostUsd: number;
    avgCostUsd: number;
  } {
    const profile = COMPLEXITY_PROFILES[level];
    const turns = turnsEstimate || profile.maxTurns;
    const avgCostPerTurn = profile.maxCostUsd / profile.maxTurns;

    return {
      minCostUsd: avgCostPerTurn * 1,           // Best case: 1 turn
      maxCostUsd: avgCostPerTurn * turns,        // Worst case
      avgCostUsd: avgCostPerTurn * turns * 0.6,  // Average
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const progressiveDisclosure = new ProgressiveDisclosureEngine();
