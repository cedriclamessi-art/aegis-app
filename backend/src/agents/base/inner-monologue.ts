/**
 * Inner Monologue — Chain-of-thought as first-class auditable data
 * ==================================================================
 * Source: letta-ai/letta (inner_thoughts parameter),
 *         letta-ai/claude-subconscious (self_improvement block)
 *
 * Persists agent reasoning alongside decisions:
 *   - Why a decision was made (reasoning chain)
 *   - What alternatives were considered
 *   - Confidence level
 *   - Self-awareness notes (metacognition)
 *   - Persona evolution tracking
 *
 * Features:
 *   - Inner thoughts stored per agent turn
 *   - Self-editing persona blocks
 *   - Metacognition: track blind spots and gaps
 *   - Reasoning audit trail for merchants
 *   - Persona drift detection
 */

// ── Types ─────────────────────────────────────────────────────────────────

export interface InnerThought {
  id:            string;
  agentId:       string;
  shopId?:       string;
  pipelineId?:   string;
  turnNumber:    number;
  thought:       string;          // The agent's internal reasoning
  type:          ThoughtType;
  confidence:    number;          // 0-1
  alternatives?: string[];        // Other options considered
  timestamp:     Date;
  metadata?:     Record<string, unknown>;
}

export type ThoughtType =
  | 'reasoning'       // Step-by-step logic
  | 'decision'        // Why a choice was made
  | 'uncertainty'     // What the agent isn't sure about
  | 'metacognition'   // Self-reflection on capabilities
  | 'persona_update'  // Self-editing identity
  | 'observation'     // Noticing something important
  | 'hypothesis'      // Forming a theory
  | 'correction';     // Correcting a previous thought

export interface PersonaBlock {
  agentId:        string;
  expertise:      string;
  style:          string;
  learnedRules:   string[];       // Self-discovered rules
  blindSpots:     string[];       // Known limitations
  preferences:    Record<string, string>;  // Learned preferences
  version:        number;
  lastUpdatedAt:  Date;
  updateHistory:  PersonaUpdate[];
}

export interface PersonaUpdate {
  field:       string;
  oldValue:    string;
  newValue:    string;
  reason:      string;
  agentId:     string;
  timestamp:   Date;
}

export interface MetacognitionEntry {
  id:           string;
  agentId:      string;
  shopId?:      string;
  type:         'blind_spot' | 'retrieval_gap' | 'bias_detected' | 'calibration_needed' | 'strength';
  description:  string;
  severity:     'low' | 'medium' | 'high';
  actionNeeded: string;
  resolved:     boolean;
  createdAt:    Date;
  resolvedAt?:  Date;
}

export interface ReasoningAudit {
  agentId:       string;
  shopId?:       string;
  decision:      string;
  reasoning:     InnerThought[];
  alternatives:  string[];
  confidence:    number;
  outcome?:      string;
  wasCorrect?:   boolean;
  timestamp:     Date;
}

// ── Inner Monologue Engine ────────────────────────────────────────────────

class InnerMonologueEngine {
  private thoughts: InnerThought[] = [];
  private personas: Map<string, PersonaBlock> = new Map();
  private metacognition: MetacognitionEntry[] = [];
  private audits: ReasoningAudit[] = [];
  private maxThoughts = 5000;

  // ═══════════════════════════════════════════════════════════════════
  //  INNER THOUGHTS
  // ═══════════════════════════════════════════════════════════════════

  /** Record an inner thought */
  think(params: {
    agentId:      string;
    thought:      string;
    type:         ThoughtType;
    confidence?:  number;
    alternatives?: string[];
    shopId?:      string;
    pipelineId?:  string;
    turnNumber?:  number;
    metadata?:    Record<string, unknown>;
  }): InnerThought {
    const entry: InnerThought = {
      id: `thought_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId: params.agentId,
      shopId: params.shopId,
      pipelineId: params.pipelineId,
      turnNumber: params.turnNumber || 0,
      thought: params.thought,
      type: params.type,
      confidence: params.confidence ?? 0.7,
      alternatives: params.alternatives,
      timestamp: new Date(),
      metadata: params.metadata,
    };

    this.thoughts.push(entry);

    // Trim
    if (this.thoughts.length > this.maxThoughts) {
      this.thoughts = this.thoughts.slice(-this.maxThoughts);
    }

    return entry;
  }

  /** Get thoughts for a specific agent/execution */
  getThoughts(filter: {
    agentId?:    string;
    shopId?:     string;
    pipelineId?: string;
    type?:       ThoughtType;
    since?:      Date;
    limit?:      number;
  }): InnerThought[] {
    let results = [...this.thoughts];

    if (filter.agentId) results = results.filter(t => t.agentId === filter.agentId);
    if (filter.shopId) results = results.filter(t => t.shopId === filter.shopId);
    if (filter.pipelineId) results = results.filter(t => t.pipelineId === filter.pipelineId);
    if (filter.type) results = results.filter(t => t.type === filter.type);
    if (filter.since) results = results.filter(t => t.timestamp >= filter.since!);

    return results.slice(-(filter.limit || 50));
  }

  /** Format reasoning chain for display */
  formatReasoningChain(agentId: string, pipelineId: string): string {
    const thoughts = this.getThoughts({ agentId, pipelineId });
    if (thoughts.length === 0) return 'No reasoning recorded';

    return thoughts.map(t => {
      const prefix = {
        reasoning: '💭',
        decision: '✅',
        uncertainty: '❓',
        metacognition: '🔍',
        persona_update: '📝',
        observation: '👁',
        hypothesis: '🧪',
        correction: '🔄',
      }[t.type];

      return `${prefix} [${t.type}] (${(t.confidence * 100).toFixed(0)}% conf) ${t.thought}`;
    }).join('\n');
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SELF-EDITING PERSONA
  // ═══════════════════════════════════════════════════════════════════

  /** Initialize or get persona for an agent */
  getPersona(agentId: string): PersonaBlock {
    if (!this.personas.has(agentId)) {
      this.personas.set(agentId, {
        agentId,
        expertise: '',
        style: '',
        learnedRules: [],
        blindSpots: [],
        preferences: {},
        version: 0,
        lastUpdatedAt: new Date(),
        updateHistory: [],
      });
    }
    return this.personas.get(agentId)!;
  }

  /** Agent self-edits its persona */
  updatePersona(agentId: string, field: string, newValue: string, reason: string): boolean {
    const persona = this.getPersona(agentId);

    const oldValue = (persona as Record<string, unknown>)[field] as string || '';

    // Record update
    persona.updateHistory.push({
      field,
      oldValue: typeof oldValue === 'string' ? oldValue : JSON.stringify(oldValue),
      newValue,
      reason,
      agentId,
      timestamp: new Date(),
    });

    // Keep last 50 updates
    if (persona.updateHistory.length > 50) {
      persona.updateHistory = persona.updateHistory.slice(-50);
    }

    // Apply update
    if (field === 'expertise' || field === 'style') {
      (persona as Record<string, unknown>)[field] = newValue;
    }

    persona.version++;
    persona.lastUpdatedAt = new Date();

    // Record as inner thought
    this.think({
      agentId,
      thought: `Updated persona.${field}: "${newValue}" — Reason: ${reason}`,
      type: 'persona_update',
      confidence: 0.8,
    });

    return true;
  }

  /** Add a learned rule */
  addLearnedRule(agentId: string, rule: string): void {
    const persona = this.getPersona(agentId);
    if (!persona.learnedRules.includes(rule)) {
      persona.learnedRules.push(rule);
      // Keep last 20
      if (persona.learnedRules.length > 20) {
        persona.learnedRules = persona.learnedRules.slice(-20);
      }
    }
  }

  /** Set a preference */
  setPreference(agentId: string, key: string, value: string): void {
    const persona = this.getPersona(agentId);
    persona.preferences[key] = value;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  METACOGNITION
  // ═══════════════════════════════════════════════════════════════════

  /** Record a metacognition entry */
  recordMetacognition(params: {
    agentId:      string;
    type:         MetacognitionEntry['type'];
    description:  string;
    severity:     'low' | 'medium' | 'high';
    actionNeeded: string;
    shopId?:      string;
  }): MetacognitionEntry {
    const entry: MetacognitionEntry = {
      id: `meta_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId: params.agentId,
      shopId: params.shopId,
      type: params.type,
      description: params.description,
      severity: params.severity,
      actionNeeded: params.actionNeeded,
      resolved: false,
      createdAt: new Date(),
    };

    this.metacognition.push(entry);

    // Also record as thought
    this.think({
      agentId: params.agentId,
      shopId: params.shopId,
      thought: `[Metacognition: ${params.type}] ${params.description}`,
      type: 'metacognition',
      confidence: 0.6,
    });

    // Add as blind spot to persona
    if (params.type === 'blind_spot') {
      const persona = this.getPersona(params.agentId);
      if (!persona.blindSpots.includes(params.description)) {
        persona.blindSpots.push(params.description);
        if (persona.blindSpots.length > 10) {
          persona.blindSpots = persona.blindSpots.slice(-10);
        }
      }
    }

    return entry;
  }

  /** Get unresolved metacognition entries */
  getOpenMetacognition(agentId?: string): MetacognitionEntry[] {
    let results = this.metacognition.filter(m => !m.resolved);
    if (agentId) results = results.filter(m => m.agentId === agentId);
    return results.sort((a, b) => {
      const severityOrder = { high: 0, medium: 1, low: 2 };
      return severityOrder[a.severity] - severityOrder[b.severity];
    });
  }

  /** Resolve a metacognition entry */
  resolveMetacognition(entryId: string): void {
    const entry = this.metacognition.find(m => m.id === entryId);
    if (entry) {
      entry.resolved = true;
      entry.resolvedAt = new Date();
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  REASONING AUDIT
  // ═══════════════════════════════════════════════════════════════════

  /** Create an audit trail for a decision */
  createAudit(params: {
    agentId:      string;
    shopId?:      string;
    decision:     string;
    alternatives: string[];
    confidence:   number;
  }): ReasoningAudit {
    const reasoning = this.getThoughts({
      agentId: params.agentId,
      limit: 10,
    });

    const audit: ReasoningAudit = {
      agentId: params.agentId,
      shopId: params.shopId,
      decision: params.decision,
      reasoning,
      alternatives: params.alternatives,
      confidence: params.confidence,
      timestamp: new Date(),
    };

    this.audits.push(audit);

    // Keep last 500
    if (this.audits.length > 500) {
      this.audits = this.audits.slice(-500);
    }

    return audit;
  }

  /** Record outcome of a decision (for learning) */
  recordOutcome(auditIndex: number, outcome: string, wasCorrect: boolean): void {
    if (auditIndex >= 0 && auditIndex < this.audits.length) {
      this.audits[auditIndex].outcome = outcome;
      this.audits[auditIndex].wasCorrect = wasCorrect;
    }
  }

  /** Get audit accuracy for an agent */
  getAuditAccuracy(agentId: string): {
    totalDecisions: number;
    evaluated: number;
    correct: number;
    accuracy: number;
    avgConfidence: number;
  } {
    const agentAudits = this.audits.filter(a => a.agentId === agentId);
    const evaluated = agentAudits.filter(a => a.wasCorrect !== undefined);
    const correct = evaluated.filter(a => a.wasCorrect === true);

    return {
      totalDecisions: agentAudits.length,
      evaluated: evaluated.length,
      correct: correct.length,
      accuracy: evaluated.length > 0 ? correct.length / evaluated.length : 0,
      avgConfidence: agentAudits.length > 0
        ? agentAudits.reduce((s, a) => s + a.confidence, 0) / agentAudits.length
        : 0,
    };
  }

  /** Get recent audits for merchant display */
  getRecentAudits(shopId: string, limit = 10): ReasoningAudit[] {
    return this.audits
      .filter(a => a.shopId === shopId)
      .slice(-limit);
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const innerMonologue = new InnerMonologueEngine();
