/**
 * Conversation Compaction — Recursive summarization with eviction
 * =================================================================
 * Source: letta-ai/letta (ephemeral_summary_agent.py),
 *         letta-ai/letta-code (context repositories)
 *
 * When context window fills up, compaction triggers:
 *   1. Summarize oldest messages (preserving key decisions)
 *   2. Replace summarized messages with compact summary
 *   3. Keep most recent messages in full
 *   4. Build upon previous summaries (recursive)
 *
 * Eviction strategies:
 *   static_buffer  — Keep last N messages, summarize rest
 *   partial_evict  — Selectively remove less important messages
 *   priority_keep  — Keep messages with decisions/actions, evict chatter
 *
 * Pipeline-specific compaction:
 *   After each pipeline phase, compact phase results into brief
 *   so next phase has clean, focused context.
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type EvictionStrategy = 'static_buffer' | 'partial_evict' | 'priority_keep';

export interface CompactionConfig {
  maxContextTokens:    number;     // Trigger compaction at this token count
  keepRecentMessages:  number;     // Always keep last N messages
  summaryMaxTokens:    number;     // Max tokens for summary
  strategy:            EvictionStrategy;
  preserveDecisions:   boolean;    // Always keep messages with decisions
  preserveToolCalls:   boolean;    // Always keep tool call results
  recursive:           boolean;    // Build upon previous summaries
}

export interface ConversationMessage {
  id:            string;
  role:          'system' | 'user' | 'assistant' | 'tool';
  content:       string;
  tokenCount:    number;
  timestamp:     Date;
  importance:    number;           // 0-1 (higher = more important)
  hasDecision:   boolean;
  hasToolCall:   boolean;
  isCompacted:   boolean;          // Was this produced by compaction?
  pipelineStep?: string;
  agentId?:      string;
  metadata?:     Record<string, unknown>;
}

export interface CompactionResult {
  summary:            string;
  tokensBefore:       number;
  tokensAfter:        number;
  messagesEvicted:    number;
  messagesKept:       number;
  compressionRatio:   number;
  phaseSummaries:     PhaseSummary[];
  timestamp:          Date;
}

export interface PhaseSummary {
  phase:       string;            // Pipeline step name
  summary:     string;
  keyDecisions: string[];
  keyMetrics:   Record<string, unknown>;
  tokenCount:  number;
}

export interface ConversationState {
  sessionId:       string;
  shopId:          string;
  messages:        ConversationMessage[];
  summaries:       string[];       // Stack of recursive summaries
  totalTokens:     number;
  compactionCount: number;
  phaseSummaries:  PhaseSummary[];
}

// ── Default Config ────────────────────────────────────────────────────────

const DEFAULT_CONFIG: CompactionConfig = {
  maxContextTokens: 30000,
  keepRecentMessages: 10,
  summaryMaxTokens: 500,
  strategy: 'priority_keep',
  preserveDecisions: true,
  preserveToolCalls: true,
  recursive: true,
};

// ── Importance Scoring ────────────────────────────────────────────────────

const IMPORTANCE_KEYWORDS = {
  high: ['decision', 'decided', 'approved', 'killed', 'scaled', 'launched',
         'ROAS', 'CONDOR', 'DEAD', 'budget', 'margin', 'error', 'failed',
         'blocked', 'warning', 'critical', 'revenue', 'conversion'],
  medium: ['analyzed', 'generated', 'created', 'updated', 'found',
           'audience', 'creative', 'campaign', 'product', 'competitor'],
  low: ['checking', 'loading', 'processing', 'waiting', 'starting',
        'completed step', 'running'],
};

// ── Conversation Compaction Engine ────────────────────────────────────────

class ConversationCompactionEngine {
  private sessions: Map<string, ConversationState> = new Map();
  private config: CompactionConfig;

  constructor(config?: Partial<CompactionConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Create session ──────────────────────────────────────────────────

  createSession(sessionId: string, shopId: string): ConversationState {
    const state: ConversationState = {
      sessionId,
      shopId,
      messages: [],
      summaries: [],
      totalTokens: 0,
      compactionCount: 0,
      phaseSummaries: [],
    };
    this.sessions.set(sessionId, state);
    return state;
  }

  // ── Add message ─────────────────────────────────────────────────────

  addMessage(sessionId: string, msg: Omit<ConversationMessage, 'id' | 'importance' | 'isCompacted'>): CompactionResult | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;

    const message: ConversationMessage = {
      ...msg,
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      importance: this.scoreImportance(msg.content, msg.hasDecision, msg.hasToolCall),
      isCompacted: false,
    };

    state.messages.push(message);
    state.totalTokens += message.tokenCount;

    // Check if compaction needed
    if (state.totalTokens > this.config.maxContextTokens) {
      return this.compact(sessionId);
    }

    return null;
  }

  // ── Compact conversation ────────────────────────────────────────────

  compact(sessionId: string): CompactionResult {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return {
        summary: '', tokensBefore: 0, tokensAfter: 0,
        messagesEvicted: 0, messagesKept: 0,
        compressionRatio: 1, phaseSummaries: [], timestamp: new Date(),
      };
    }

    const tokensBefore = state.totalTokens;
    const messagesBefore = state.messages.length;

    let evicted: ConversationMessage[];
    let kept: ConversationMessage[];

    switch (this.config.strategy) {
      case 'static_buffer':
        ({ evicted, kept } = this.staticBufferEvict(state));
        break;
      case 'partial_evict':
        ({ evicted, kept } = this.partialEvict(state));
        break;
      case 'priority_keep':
      default:
        ({ evicted, kept } = this.priorityKeepEvict(state));
        break;
    }

    // Build summary of evicted messages
    const summary = this.buildSummary(evicted, state.summaries);

    // Create compacted message
    const summaryMessage: ConversationMessage = {
      id: `summary_${Date.now()}`,
      role: 'system',
      content: `[Conversation Summary]\n${summary}`,
      tokenCount: Math.ceil(summary.length / 4),
      timestamp: new Date(),
      importance: 0.9,
      hasDecision: false,
      hasToolCall: false,
      isCompacted: true,
    };

    // Update state
    state.messages = [summaryMessage, ...kept];
    state.totalTokens = state.messages.reduce((s, m) => s + m.tokenCount, 0);
    state.compactionCount++;

    // Store summary for recursive building
    if (this.config.recursive) {
      state.summaries.push(summary);
    }

    const result: CompactionResult = {
      summary,
      tokensBefore,
      tokensAfter: state.totalTokens,
      messagesEvicted: evicted.length,
      messagesKept: kept.length + 1, // +1 for summary
      compressionRatio: state.totalTokens / tokensBefore,
      phaseSummaries: state.phaseSummaries,
      timestamp: new Date(),
    };

    return result;
  }

  // ── Pipeline phase compaction ───────────────────────────────────────

  compactPhase(sessionId: string, phaseName: string, keyDecisions: string[], keyMetrics: Record<string, unknown>): PhaseSummary | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;

    // Find messages for this phase
    const phaseMessages = state.messages.filter(m => m.pipelineStep === phaseName);
    if (phaseMessages.length === 0) return null;

    // Build phase summary
    const content = phaseMessages.map(m => m.content).join('\n');
    const summaryText = this.extractPhaseSummary(content, phaseName);

    const phaseSummary: PhaseSummary = {
      phase: phaseName,
      summary: summaryText,
      keyDecisions,
      keyMetrics,
      tokenCount: Math.ceil(summaryText.length / 4),
    };

    state.phaseSummaries.push(phaseSummary);

    // Evict detailed phase messages, keep summary
    state.messages = state.messages.filter(m => m.pipelineStep !== phaseName);
    state.messages.push({
      id: `phase_summary_${phaseName}`,
      role: 'system',
      content: `[Phase: ${phaseName}] ${summaryText}`,
      tokenCount: phaseSummary.tokenCount,
      timestamp: new Date(),
      importance: 0.8,
      hasDecision: keyDecisions.length > 0,
      hasToolCall: false,
      isCompacted: true,
      pipelineStep: phaseName,
    });

    state.totalTokens = state.messages.reduce((s, m) => s + m.tokenCount, 0);

    return phaseSummary;
  }

  // ── Eviction strategies ─────────────────────────────────────────────

  private staticBufferEvict(state: ConversationState): {
    evicted: ConversationMessage[];
    kept: ConversationMessage[];
  } {
    const keepCount = this.config.keepRecentMessages;
    const splitIdx = Math.max(0, state.messages.length - keepCount);

    return {
      evicted: state.messages.slice(0, splitIdx),
      kept: state.messages.slice(splitIdx),
    };
  }

  private partialEvict(state: ConversationState): {
    evicted: ConversationMessage[];
    kept: ConversationMessage[];
  } {
    const sorted = [...state.messages].sort((a, b) => a.importance - b.importance);
    const targetTokens = this.config.maxContextTokens * 0.6;

    let tokens = 0;
    const kept: ConversationMessage[] = [];
    const evicted: ConversationMessage[] = [];

    // Keep from most important to least
    for (const msg of sorted.reverse()) {
      if (tokens + msg.tokenCount <= targetTokens) {
        kept.push(msg);
        tokens += msg.tokenCount;
      } else {
        evicted.push(msg);
      }
    }

    // Maintain chronological order
    kept.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

    return { evicted, kept };
  }

  private priorityKeepEvict(state: ConversationState): {
    evicted: ConversationMessage[];
    kept: ConversationMessage[];
  } {
    const evicted: ConversationMessage[] = [];
    const kept: ConversationMessage[] = [];
    const keepRecent = this.config.keepRecentMessages;

    for (let i = 0; i < state.messages.length; i++) {
      const msg = state.messages[i];
      const isRecent = i >= state.messages.length - keepRecent;
      const isImportant = msg.importance >= 0.7;
      const isDecision = this.config.preserveDecisions && msg.hasDecision;
      const isToolCall = this.config.preserveToolCalls && msg.hasToolCall;

      if (isRecent || isImportant || isDecision || isToolCall) {
        kept.push(msg);
      } else {
        evicted.push(msg);
      }
    }

    return { evicted, kept };
  }

  // ── Summary building ────────────────────────────────────────────────

  private buildSummary(evicted: ConversationMessage[], previousSummaries: string[]): string {
    const parts: string[] = [];

    // Include previous summary context for recursion
    if (previousSummaries.length > 0) {
      parts.push(`Previous context: ${previousSummaries[previousSummaries.length - 1].slice(0, 200)}`);
    }

    // Extract key information from evicted messages
    const decisions = evicted
      .filter(m => m.hasDecision)
      .map(m => `- ${m.content.slice(0, 100)}`);

    const toolResults = evicted
      .filter(m => m.hasToolCall)
      .map(m => `- ${m.content.slice(0, 80)}`);

    const highImportance = evicted
      .filter(m => m.importance >= 0.7 && !m.hasDecision && !m.hasToolCall)
      .map(m => `- ${m.content.slice(0, 80)}`);

    if (decisions.length > 0) {
      parts.push(`Decisions made:\n${decisions.slice(0, 5).join('\n')}`);
    }
    if (toolResults.length > 0) {
      parts.push(`Key results:\n${toolResults.slice(0, 5).join('\n')}`);
    }
    if (highImportance.length > 0) {
      parts.push(`Important context:\n${highImportance.slice(0, 5).join('\n')}`);
    }

    parts.push(`(${evicted.length} messages compacted at ${new Date().toISOString()})`);

    return parts.join('\n\n');
  }

  private extractPhaseSummary(content: string, phaseName: string): string {
    // Extract first 200 chars as basic summary
    const cleaned = content.replace(/\n+/g, ' ').trim();
    return `${phaseName}: ${cleaned.slice(0, 200)}${cleaned.length > 200 ? '...' : ''}`;
  }

  // ── Importance scoring ──────────────────────────────────────────────

  private scoreImportance(content: string, hasDecision: boolean, hasToolCall: boolean): number {
    let score = 0.3; // Base

    if (hasDecision) score += 0.4;
    if (hasToolCall) score += 0.2;

    const lower = content.toLowerCase();
    for (const keyword of IMPORTANCE_KEYWORDS.high) {
      if (lower.includes(keyword)) { score += 0.1; break; }
    }
    for (const keyword of IMPORTANCE_KEYWORDS.medium) {
      if (lower.includes(keyword)) { score += 0.05; break; }
    }
    for (const keyword of IMPORTANCE_KEYWORDS.low) {
      if (lower.includes(keyword)) { score -= 0.1; break; }
    }

    return Math.max(0, Math.min(1, score));
  }

  // ── Session management ──────────────────────────────────────────────

  getSession(sessionId: string): ConversationState | undefined {
    return this.sessions.get(sessionId);
  }

  getContextWindow(sessionId: string): string {
    const state = this.sessions.get(sessionId);
    if (!state) return '';

    return state.messages
      .map(m => `[${m.role}${m.isCompacted ? ' (summary)' : ''}]: ${m.content}`)
      .join('\n\n');
  }

  getStats(sessionId: string): {
    totalMessages: number;
    totalTokens: number;
    compactionCount: number;
    phaseSummaries: number;
    avgImportance: number;
  } | null {
    const state = this.sessions.get(sessionId);
    if (!state) return null;

    return {
      totalMessages: state.messages.length,
      totalTokens: state.totalTokens,
      compactionCount: state.compactionCount,
      phaseSummaries: state.phaseSummaries.length,
      avgImportance: state.messages.length > 0
        ? state.messages.reduce((s, m) => s + m.importance, 0) / state.messages.length
        : 0,
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const conversationCompaction = new ConversationCompactionEngine();
