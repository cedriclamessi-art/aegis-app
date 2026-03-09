/**
 * Memory Hierarchy — 3-tier Core / Recall / Archival memory system
 * ==================================================================
 * Source: letta-ai/letta (MemGPT architecture), letta-ai/agent-file
 *
 * Inspired by operating system memory hierarchy:
 *   CORE MEMORY      (RAM)   — Always in context, self-edited by agent
 *   RECALL MEMORY    (Disk)  — Full history, searchable, not in context
 *   ARCHIVAL MEMORY  (Cloud) — Vector-indexed long-term knowledge
 *
 * Core Memory blocks (always loaded, token-limited):
 *   - shop_profile   — Shop identity, niche, tier, preferences
 *   - active_kpis    — Current campaign metrics, ROAS, spend
 *   - recent_decisions — Last 5 decisions made
 *   - persona        — Agent's self-edited expertise and style
 *
 * Recall Memory (searchable conversation history):
 *   - Full execution logs per agent
 *   - Tool call results
 *   - Pipeline step outputs
 *
 * Archival Memory (vector-indexed, semantic search):
 *   - Historical winning ad copies
 *   - Product catalog embeddings
 *   - Competitor analysis reports
 *   - Seasonal performance patterns
 *   - Niche-specific strategies
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type MemoryTier = 'core' | 'recall' | 'archival';

export interface CoreMemoryBlock {
  label:        string;           // Block name (e.g., 'shop_profile')
  value:        string;           // Current content
  description:  string;           // What this block stores
  charLimit:    number;           // Max characters
  readOnly:     boolean;          // Can agent edit this?
  lastEditedBy?: string;          // Agent ID or 'system'
  lastEditedAt?: Date;
  version:      number;           // Edit counter
}

export interface RecallEntry {
  id:           string;
  agentId:      string;
  shopId:       string;
  role:         'user' | 'assistant' | 'tool' | 'system';
  content:      string;
  toolName?:    string;
  toolResult?:  string;
  inContext:     boolean;          // Currently in context window?
  timestamp:    Date;
  tokenCount:   number;
  metadata?:    Record<string, unknown>;
}

export interface ArchivalPassage {
  id:           string;
  shopId:       string;
  agentId?:     string;
  content:      string;
  embedding?:   number[];         // Vector embedding for semantic search
  category:     string;           // 'ad_copy', 'strategy', 'competitor', 'product', etc.
  tags:         string[];
  source:       string;           // Where this knowledge came from
  createdAt:    Date;
  accessCount:  number;
  lastAccessedAt?: Date;
  relevanceScore?: number;        // Decays over time
}

export interface MemoryHierarchyConfig {
  coreTokenBudget:      number;   // Max tokens for core memory (default 2000)
  recallSearchLimit:    number;   // Max results from recall search (default 20)
  archivalSearchLimit:  number;   // Max results from archival search (default 10)
  evictionStrategy:     'lru' | 'priority' | 'partial';
  compactionThreshold:  number;   // Trigger compaction at this token count
}

export interface MemorySnapshot {
  shopId:     string;
  core:       CoreMemoryBlock[];
  recallSize: number;
  archivalSize: number;
  totalTokens: number;
  timestamp:  Date;
}

// ── Default Core Memory Blocks ────────────────────────────────────────────

const DEFAULT_CORE_BLOCKS: CoreMemoryBlock[] = [
  {
    label: 'shop_profile',
    value: '',
    description: 'Shop identity: name, niche, tier, URL, preferences, language',
    charLimit: 500,
    readOnly: false,
    version: 0,
  },
  {
    label: 'active_kpis',
    value: '',
    description: 'Current KPIs: ROAS, daily spend, active campaigns, conversion rate',
    charLimit: 400,
    readOnly: false,
    version: 0,
  },
  {
    label: 'recent_decisions',
    value: '',
    description: 'Last 5 decisions: what was decided, by which agent, outcome',
    charLimit: 600,
    readOnly: false,
    version: 0,
  },
  {
    label: 'persona',
    value: '',
    description: 'Agent persona: expertise, style, learned preferences, behavioral notes',
    charLimit: 400,
    readOnly: false,
    version: 0,
  },
  {
    label: 'warnings',
    value: '',
    description: 'Active warnings: budget alerts, fatigue alerts, compliance flags',
    charLimit: 300,
    readOnly: false,
    version: 0,
  },
];

// ── Memory Hierarchy Engine ───────────────────────────────────────────────

class MemoryHierarchyEngine {
  private coreMemory: Map<string, CoreMemoryBlock[]> = new Map();    // shopId -> blocks
  private recallMemory: Map<string, RecallEntry[]> = new Map();       // shopId -> entries
  private archivalMemory: Map<string, ArchivalPassage[]> = new Map(); // shopId -> passages
  private config: MemoryHierarchyConfig;
  private editLog: Array<{
    shopId: string;
    block: string;
    oldValue: string;
    newValue: string;
    editedBy: string;
    timestamp: Date;
  }> = [];

  constructor(config?: Partial<MemoryHierarchyConfig>) {
    this.config = {
      coreTokenBudget: 2000,
      recallSearchLimit: 20,
      archivalSearchLimit: 10,
      evictionStrategy: 'lru',
      compactionThreshold: 50000,
      ...config,
    };
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CORE MEMORY — Always in context
  // ═══════════════════════════════════════════════════════════════════

  initializeCore(shopId: string, overrides?: Partial<CoreMemoryBlock>[]): void {
    const blocks = DEFAULT_CORE_BLOCKS.map((block, i) => ({
      ...block,
      ...(overrides?.[i] || {}),
    }));
    this.coreMemory.set(shopId, blocks);
  }

  getCoreMemory(shopId: string): CoreMemoryBlock[] {
    if (!this.coreMemory.has(shopId)) {
      this.initializeCore(shopId);
    }
    return this.coreMemory.get(shopId)!;
  }

  /** Get core memory as a formatted string for context injection */
  getCoreContext(shopId: string): string {
    const blocks = this.getCoreMemory(shopId);
    return blocks
      .filter(b => b.value.trim().length > 0)
      .map(b => `<memory block="${b.label}">\n${b.value}\n</memory>`)
      .join('\n');
  }

  /** Agent self-edits a core memory block */
  coreReplace(shopId: string, label: string, oldText: string, newText: string, agentId: string): boolean {
    const blocks = this.getCoreMemory(shopId);
    const block = blocks.find(b => b.label === label);
    if (!block || block.readOnly) return false;

    const idx = block.value.indexOf(oldText);
    if (idx === -1) return false;

    const newValue = block.value.slice(0, idx) + newText + block.value.slice(idx + oldText.length);
    if (newValue.length > block.charLimit) return false;

    // Log edit
    this.editLog.push({
      shopId, block: label,
      oldValue: block.value,
      newValue,
      editedBy: agentId,
      timestamp: new Date(),
    });

    block.value = newValue;
    block.lastEditedBy = agentId;
    block.lastEditedAt = new Date();
    block.version++;

    return true;
  }

  /** Agent rewrites entire core memory block */
  coreRewrite(shopId: string, label: string, newValue: string, agentId: string): boolean {
    const blocks = this.getCoreMemory(shopId);
    const block = blocks.find(b => b.label === label);
    if (!block || block.readOnly) return false;
    if (newValue.length > block.charLimit) return false;

    this.editLog.push({
      shopId, block: label,
      oldValue: block.value,
      newValue,
      editedBy: agentId,
      timestamp: new Date(),
    });

    block.value = newValue;
    block.lastEditedBy = agentId;
    block.lastEditedAt = new Date();
    block.version++;

    return true;
  }

  /** Append to a core memory block */
  coreAppend(shopId: string, label: string, text: string, agentId: string): boolean {
    const blocks = this.getCoreMemory(shopId);
    const block = blocks.find(b => b.label === label);
    if (!block || block.readOnly) return false;

    const newValue = block.value + text;
    if (newValue.length > block.charLimit) return false;

    block.value = newValue;
    block.lastEditedBy = agentId;
    block.lastEditedAt = new Date();
    block.version++;

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  RECALL MEMORY — Searchable conversation history
  // ═══════════════════════════════════════════════════════════════════

  /** Add entry to recall memory */
  recallInsert(shopId: string, entry: Omit<RecallEntry, 'id' | 'timestamp' | 'inContext'>): void {
    const entries = this.recallMemory.get(shopId) || [];

    entries.push({
      ...entry,
      id: `recall_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      timestamp: new Date(),
      inContext: true,
    });

    this.recallMemory.set(shopId, entries);

    // Check compaction threshold
    const totalTokens = entries.reduce((s, e) => s + e.tokenCount, 0);
    if (totalTokens > this.config.compactionThreshold) {
      this.evictFromRecall(shopId);
    }
  }

  /** Search recall memory by keyword */
  recallSearch(shopId: string, query: string, limit?: number): RecallEntry[] {
    const entries = this.recallMemory.get(shopId) || [];
    const lower = query.toLowerCase();
    const max = limit || this.config.recallSearchLimit;

    return entries
      .filter(e => e.content.toLowerCase().includes(lower) ||
                   e.toolName?.toLowerCase().includes(lower))
      .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())
      .slice(0, max);
  }

  /** Get recent recall entries currently in context */
  recallGetInContext(shopId: string): RecallEntry[] {
    const entries = this.recallMemory.get(shopId) || [];
    return entries.filter(e => e.inContext);
  }

  /** Evict old entries from context (keep in recall but mark out-of-context) */
  private evictFromRecall(shopId: string): void {
    const entries = this.recallMemory.get(shopId) || [];
    const inContext = entries.filter(e => e.inContext);

    if (this.config.evictionStrategy === 'lru') {
      // Keep most recent N entries in context
      const keepCount = Math.floor(inContext.length * 0.5);
      inContext.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
      for (let i = 0; i < inContext.length - keepCount; i++) {
        inContext[i].inContext = false;
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  //  ARCHIVAL MEMORY — Vector-indexed long-term knowledge
  // ═══════════════════════════════════════════════════════════════════

  /** Insert passage into archival memory */
  archivalInsert(shopId: string, passage: {
    content:   string;
    category:  string;
    agentId?:  string;
    tags?:     string[];
    source:    string;
  }): ArchivalPassage {
    const passages = this.archivalMemory.get(shopId) || [];

    const entry: ArchivalPassage = {
      id: `arch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      shopId,
      agentId: passage.agentId,
      content: passage.content,
      category: passage.category,
      tags: passage.tags || [],
      source: passage.source,
      createdAt: new Date(),
      accessCount: 0,
    };

    passages.push(entry);
    this.archivalMemory.set(shopId, passages);

    return entry;
  }

  /** Search archival memory by text similarity (keyword-based fallback) */
  archivalSearch(shopId: string, query: string, options?: {
    category?: string;
    tags?: string[];
    limit?: number;
  }): ArchivalPassage[] {
    let passages = this.archivalMemory.get(shopId) || [];
    const lower = query.toLowerCase();
    const max = options?.limit || this.config.archivalSearchLimit;

    // Filter
    if (options?.category) {
      passages = passages.filter(p => p.category === options.category);
    }
    if (options?.tags && options.tags.length > 0) {
      passages = passages.filter(p => options.tags!.some(t => p.tags.includes(t)));
    }

    // Score by keyword relevance (simple TF-IDF approximation)
    const queryWords = lower.split(/\s+/).filter(w => w.length > 2);
    const scored = passages.map(p => {
      const contentLower = p.content.toLowerCase();
      let score = 0;
      for (const word of queryWords) {
        if (contentLower.includes(word)) score++;
      }
      // Recency bonus
      const ageMs = Date.now() - p.createdAt.getTime();
      const recencyBonus = Math.max(0, 1 - ageMs / (365 * 24 * 60 * 60 * 1000)); // Decay over 1 year
      score += recencyBonus * 0.5;

      return { passage: p, score };
    });

    return scored
      .filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, max)
      .map(s => {
        s.passage.accessCount++;
        s.passage.lastAccessedAt = new Date();
        return s.passage;
      });
  }

  // ═══════════════════════════════════════════════════════════════════
  //  CROSS-TIER OPERATIONS
  // ═══════════════════════════════════════════════════════════════════

  /** Promote recall entry to archival (for long-term storage) */
  promoteToArchival(shopId: string, recallId: string, category: string, tags?: string[]): ArchivalPassage | null {
    const entries = this.recallMemory.get(shopId) || [];
    const entry = entries.find(e => e.id === recallId);
    if (!entry) return null;

    return this.archivalInsert(shopId, {
      content: entry.content,
      category,
      agentId: entry.agentId,
      tags,
      source: `recall:${recallId}`,
    });
  }

  /** Load archival passage into core context (temporary) */
  loadIntoCore(shopId: string, archivalId: string): boolean {
    const passages = this.archivalMemory.get(shopId) || [];
    const passage = passages.find(p => p.id === archivalId);
    if (!passage) return false;

    // Append to a 'loaded_context' block (create if needed)
    const blocks = this.getCoreMemory(shopId);
    let contextBlock = blocks.find(b => b.label === 'loaded_context');
    if (!contextBlock) {
      contextBlock = {
        label: 'loaded_context',
        value: '',
        description: 'Temporarily loaded archival passages',
        charLimit: 1000,
        readOnly: false,
        version: 0,
      };
      blocks.push(contextBlock);
    }

    const snippet = passage.content.slice(0, 300);
    if (contextBlock.value.length + snippet.length > contextBlock.charLimit) {
      // Evict oldest loaded context
      contextBlock.value = snippet;
    } else {
      contextBlock.value += `\n---\n${snippet}`;
    }

    passage.accessCount++;
    passage.lastAccessedAt = new Date();

    return true;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SNAPSHOTS & STATS
  // ═══════════════════════════════════════════════════════════════════

  getSnapshot(shopId: string): MemorySnapshot {
    const core = this.getCoreMemory(shopId);
    const recall = this.recallMemory.get(shopId) || [];
    const archival = this.archivalMemory.get(shopId) || [];

    const coreTokens = core.reduce((s, b) => s + Math.ceil(b.value.length / 4), 0);
    const recallTokens = recall.filter(e => e.inContext).reduce((s, e) => s + e.tokenCount, 0);

    return {
      shopId,
      core,
      recallSize: recall.length,
      archivalSize: archival.length,
      totalTokens: coreTokens + recallTokens,
      timestamp: new Date(),
    };
  }

  getEditHistory(shopId: string, limit = 20): typeof this.editLog {
    return this.editLog
      .filter(e => e.shopId === shopId)
      .slice(-limit);
  }

  /** Get all archival categories for a shop */
  getArchivalCategories(shopId: string): Array<{ category: string; count: number }> {
    const passages = this.archivalMemory.get(shopId) || [];
    const counts: Record<string, number> = {};
    for (const p of passages) {
      counts[p.category] = (counts[p.category] || 0) + 1;
    }
    return Object.entries(counts).map(([category, count]) => ({ category, count }));
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const memoryHierarchy = new MemoryHierarchyEngine();
