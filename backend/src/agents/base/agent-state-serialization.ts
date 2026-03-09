/**
 * Agent State Serialization — Portable agent snapshots (.af format)
 * ====================================================================
 * Source: letta-ai/agent-file (.af format),
 *         letta-ai/letta (state management)
 *
 * Serializes complete agent state into a portable JSON format:
 *   - Agent identity and persona
 *   - All memory blocks (core, recall summary, archival keys)
 *   - Learned rules and preferences
 *   - Configuration (model, tools, budgets)
 *   - Performance history (condensed)
 *   - Skill library references
 *
 * Use cases:
 *   1. Clone a successful shop's agent config to new shop
 *   2. Version-control agent state, roll back if worse
 *   3. Export "niche expert" templates for onboarding
 *   4. Checkpoint before major configuration changes
 *   5. Share cross-project memory (anonymized)
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface AgentSnapshot {
  // Format
  format:          'aegis-agent-file';
  version:         string;          // '1.0.0'
  exportedAt:      string;          // ISO date
  exportedBy:      string;          // 'system' or user ID

  // Identity
  agentId:         string;
  agentName:       string;
  agentType:       string;          // 'copy_chief', 'ralph', etc.
  description:     string;

  // Persona (self-editing)
  persona: {
    expertise:     string;
    style:         string;
    learnedRules:  string[];
    preferences:   Record<string, string>;
    blindSpots:    string[];
  };

  // Core Memory blocks
  coreMemory:      Array<{
    label:         string;
    value:         string;
    charLimit:     number;
    readOnly:      boolean;
  }>;

  // Condensed archival (key patterns, not full history)
  archivalSummary: Array<{
    category:      string;
    count:         number;
    topEntries:    string[];        // Top 5 most accessed
  }>;

  // Configuration
  config: {
    model:         string;
    maxTurns:      number;
    maxCostUsd:    number;
    temperature:   number;
    tier:          number;
    tools:         string[];
  };

  // Performance (condensed)
  performance: {
    totalRuns:     number;
    successRate:   number;
    avgCostUsd:    number;
    avgDurationMs: number;
    topDecisions:  string[];        // Most frequent decision types
  };

  // Skills
  skills:          string[];        // Skill IDs this agent uses

  // Metadata
  shopId?:         string;
  niche?:          string;
  locale?:         string;
  tags:            string[];
}

export interface SnapshotDiff {
  field:         string;
  before:        unknown;
  after:         unknown;
}

export interface CrossProjectBrain {
  id:            string;
  niche:         string;
  locale:        string;
  patterns:      AnonymizedPattern[];
  shopCount:     number;
  lastUpdated:   Date;
}

export interface AnonymizedPattern {
  category:      string;
  pattern:       string;
  confidence:    number;
  shopCount:     number;            // How many shops validated this
  avgRoasImpact: number;
}

// ── Agent State Serialization Engine ──────────────────────────────────────

class AgentStateSerializationEngine {
  private snapshots: Map<string, AgentSnapshot[]> = new Map();  // agentId -> versions
  private crossProjectBrains: Map<string, CrossProjectBrain> = new Map();  // niche -> brain

  // ═══════════════════════════════════════════════════════════════════
  //  EXPORT / IMPORT
  // ═══════════════════════════════════════════════════════════════════

  /** Export agent state as snapshot */
  export(params: {
    agentId:      string;
    agentName:    string;
    agentType:    string;
    description:  string;
    persona?:     AgentSnapshot['persona'];
    coreMemory?:  AgentSnapshot['coreMemory'];
    archivalSummary?: AgentSnapshot['archivalSummary'];
    config?:      Partial<AgentSnapshot['config']>;
    performance?: Partial<AgentSnapshot['performance']>;
    skills?:      string[];
    shopId?:      string;
    niche?:       string;
    locale?:      string;
    tags?:        string[];
    exportedBy?:  string;
  }): AgentSnapshot {
    const snapshot: AgentSnapshot = {
      format: 'aegis-agent-file',
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      exportedBy: params.exportedBy || 'system',
      agentId: params.agentId,
      agentName: params.agentName,
      agentType: params.agentType,
      description: params.description,
      persona: params.persona || {
        expertise: '',
        style: '',
        learnedRules: [],
        preferences: {},
        blindSpots: [],
      },
      coreMemory: params.coreMemory || [],
      archivalSummary: params.archivalSummary || [],
      config: {
        model: 'claude-haiku-4-20250514',
        maxTurns: 10,
        maxCostUsd: 2.00,
        temperature: 0.7,
        tier: 1,
        tools: [],
        ...(params.config || {}),
      },
      performance: {
        totalRuns: 0,
        successRate: 0,
        avgCostUsd: 0,
        avgDurationMs: 0,
        topDecisions: [],
        ...(params.performance || {}),
      },
      skills: params.skills || [],
      shopId: params.shopId,
      niche: params.niche,
      locale: params.locale,
      tags: params.tags || [],
    };

    // Store version
    const versions = this.snapshots.get(params.agentId) || [];
    versions.push(snapshot);
    if (versions.length > 20) versions.splice(0, versions.length - 20);
    this.snapshots.set(params.agentId, versions);

    return snapshot;
  }

  /** Import snapshot to configure a new agent */
  import(snapshot: AgentSnapshot, targetAgentId: string, targetShopId: string): {
    success: boolean;
    appliedFields: string[];
  } {
    const appliedFields: string[] = [];

    // Validate format
    if (snapshot.format !== 'aegis-agent-file') {
      return { success: false, appliedFields: [] };
    }

    // Apply persona
    if (snapshot.persona) {
      appliedFields.push('persona');
    }

    // Apply core memory (with new shop ID)
    if (snapshot.coreMemory?.length > 0) {
      appliedFields.push('coreMemory');
    }

    // Apply config
    if (snapshot.config) {
      appliedFields.push('config');
    }

    // Apply skills
    if (snapshot.skills?.length > 0) {
      appliedFields.push('skills');
    }

    // Store imported snapshot
    const versions = this.snapshots.get(targetAgentId) || [];
    versions.push({
      ...snapshot,
      agentId: targetAgentId,
      shopId: targetShopId,
      exportedAt: new Date().toISOString(),
      exportedBy: `imported_from:${snapshot.agentId}`,
    });
    this.snapshots.set(targetAgentId, versions);

    return { success: true, appliedFields };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  VERSION CONTROL
  // ═══════════════════════════════════════════════════════════════════

  /** Get all versions of an agent */
  getVersions(agentId: string): AgentSnapshot[] {
    return this.snapshots.get(agentId) || [];
  }

  /** Get latest snapshot */
  getLatest(agentId: string): AgentSnapshot | undefined {
    const versions = this.snapshots.get(agentId) || [];
    return versions[versions.length - 1];
  }

  /** Compare two snapshots */
  diff(snapshotA: AgentSnapshot, snapshotB: AgentSnapshot): SnapshotDiff[] {
    const diffs: SnapshotDiff[] = [];

    // Compare persona
    if (snapshotA.persona.expertise !== snapshotB.persona.expertise) {
      diffs.push({ field: 'persona.expertise', before: snapshotA.persona.expertise, after: snapshotB.persona.expertise });
    }
    if (snapshotA.persona.style !== snapshotB.persona.style) {
      diffs.push({ field: 'persona.style', before: snapshotA.persona.style, after: snapshotB.persona.style });
    }

    // Compare learned rules
    const rulesA = new Set(snapshotA.persona.learnedRules);
    const rulesB = new Set(snapshotB.persona.learnedRules);
    const newRules = [...rulesB].filter(r => !rulesA.has(r));
    const removedRules = [...rulesA].filter(r => !rulesB.has(r));
    if (newRules.length > 0) diffs.push({ field: 'persona.learnedRules.added', before: null, after: newRules });
    if (removedRules.length > 0) diffs.push({ field: 'persona.learnedRules.removed', before: removedRules, after: null });

    // Compare config
    if (snapshotA.config.model !== snapshotB.config.model) {
      diffs.push({ field: 'config.model', before: snapshotA.config.model, after: snapshotB.config.model });
    }
    if (snapshotA.config.maxTurns !== snapshotB.config.maxTurns) {
      diffs.push({ field: 'config.maxTurns', before: snapshotA.config.maxTurns, after: snapshotB.config.maxTurns });
    }

    // Compare performance
    if (snapshotA.performance.successRate !== snapshotB.performance.successRate) {
      diffs.push({ field: 'performance.successRate', before: snapshotA.performance.successRate, after: snapshotB.performance.successRate });
    }

    return diffs;
  }

  /** Rollback to a previous version */
  rollback(agentId: string, versionIndex: number): AgentSnapshot | null {
    const versions = this.snapshots.get(agentId);
    if (!versions || versionIndex >= versions.length) return null;

    return versions[versionIndex];
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CROSS-PROJECT MEMORY
  // ═══════════════════════════════════════════════════════════════════

  /** Contribute anonymized patterns to niche brain */
  contributeToNicheBrain(niche: string, patterns: AnonymizedPattern[]): void {
    let brain = this.crossProjectBrains.get(niche);
    if (!brain) {
      brain = {
        id: `brain_${niche}_${Date.now()}`,
        niche,
        locale: 'fr',
        patterns: [],
        shopCount: 0,
        lastUpdated: new Date(),
      };
      this.crossProjectBrains.set(niche, brain);
    }

    // Merge patterns
    for (const newPattern of patterns) {
      const existing = brain.patterns.find(p =>
        p.category === newPattern.category && p.pattern === newPattern.pattern
      );

      if (existing) {
        // Strengthen existing pattern
        existing.shopCount++;
        existing.confidence = Math.min(1, existing.confidence + 0.1);
        existing.avgRoasImpact = (existing.avgRoasImpact + newPattern.avgRoasImpact) / 2;
      } else {
        brain.patterns.push(newPattern);
      }
    }

    brain.shopCount++;
    brain.lastUpdated = new Date();

    // Keep top 100 patterns by confidence
    brain.patterns.sort((a, b) => b.confidence - a.confidence);
    if (brain.patterns.length > 100) {
      brain.patterns = brain.patterns.slice(0, 100);
    }
  }

  /** Get niche brain patterns for a new shop */
  getNicheBrainPatterns(niche: string, limit = 20): AnonymizedPattern[] {
    const brain = this.crossProjectBrains.get(niche);
    if (!brain) return [];

    return brain.patterns
      .filter(p => p.shopCount >= 2) // Only patterns validated by 2+ shops
      .sort((a, b) => b.confidence * b.shopCount - a.confidence * a.shopCount)
      .slice(0, limit);
  }

  /** List available niche brains */
  listNicheBrains(): Array<{ niche: string; patternCount: number; shopCount: number }> {
    return Array.from(this.crossProjectBrains.values()).map(b => ({
      niche: b.niche,
      patternCount: b.patterns.length,
      shopCount: b.shopCount,
    }));
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const agentStateSerialization = new AgentStateSerializationEngine();
