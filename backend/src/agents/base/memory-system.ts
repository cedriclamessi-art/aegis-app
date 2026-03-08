/**
 * Memory System — Persistent agent learnings & pattern extraction
 * ================================================================
 * Sources: claude-mem, Everything Claude Code, Claude Code Showcase
 *
 * Features:
 *   - Observation capture: What happened, what worked, what didn't
 *   - Semantic compression: Summarize N observations into patterns
 *   - 3-layer search: Index → Timeline → Detail (fast to deep)
 *   - Pattern extraction: Winning hooks, optimal prices, best audiences
 *   - Per-tenant isolation: Each shop has its own memory
 *   - PostgreSQL storage: JSON columns for flexibility
 *
 * Observation types:
 *   success  — Something worked well (record pattern)
 *   failure  — Something failed (avoid in future)
 *   insight  — Analysis revealed something (store for future)
 *   pattern  — Compressed from multiple observations
 */

import { Pool } from 'pg';

// ── Types ─────────────────────────────────────────────────────────────────

export type ObservationType = 'success' | 'failure' | 'insight' | 'pattern';

export interface Observation {
  id?:          string;
  shopId:       string;
  agentName:    string;
  type:         ObservationType;
  content:      string;
  metadata?:    Record<string, unknown>;
  tags?:        string[];
  confidence?:  number;      // 0-1
  createdAt?:   Date;
  expiresAt?:   Date;       // Auto-expire old observations
}

export interface MemoryQuery {
  shopId:       string;
  agentName?:   string;
  type?:        ObservationType;
  tags?:        string[];
  limit?:       number;
  since?:       Date;
  searchText?:  string;
}

export interface Pattern {
  shopId:       string;
  category:     string;     // 'winning_hooks', 'optimal_prices', 'best_audiences', etc.
  content:      string;
  evidence:     string[];   // Observation IDs that support this pattern
  confidence:   number;
  extractedAt:  Date;
}

export interface AgentMemory {
  recentObservations: Observation[];
  patterns:           Pattern[];
  summary:            string;
}

// ── Memory System ─────────────────────────────────────────────────────────

class MemorySystem {
  private pool: Pool | null = null;
  private initialized = false;

  // In-memory fallback when no database
  private memoryStore: Map<string, Observation[]> = new Map();
  private patternStore: Map<string, Pattern[]> = new Map();

  // ── Initialize ───────────────────────────────────────────────────────

  async initialize(pool: Pool): Promise<void> {
    this.pool = pool;
    try {
      await this.ensureTable();
      this.initialized = true;
    } catch (err) {
      console.warn('[MemorySystem] DB init failed, using in-memory fallback:', (err as Error).message);
    }
  }

  private async ensureTable(): Promise<void> {
    if (!this.pool) return;

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_memory (
        id          UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        shop_id     TEXT NOT NULL,
        agent_name  TEXT NOT NULL,
        type        TEXT NOT NULL DEFAULT 'insight',
        content     TEXT NOT NULL,
        metadata    JSONB DEFAULT '{}',
        tags        TEXT[] DEFAULT '{}',
        confidence  REAL DEFAULT 0.5,
        created_at  TIMESTAMPTZ DEFAULT NOW(),
        expires_at  TIMESTAMPTZ
      );

      CREATE INDEX IF NOT EXISTS idx_memory_shop ON agent_memory(shop_id);
      CREATE INDEX IF NOT EXISTS idx_memory_agent ON agent_memory(agent_name);
      CREATE INDEX IF NOT EXISTS idx_memory_type ON agent_memory(type);
      CREATE INDEX IF NOT EXISTS idx_memory_tags ON agent_memory USING GIN(tags);
    `);

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS agent_patterns (
        id           UUID DEFAULT gen_random_uuid() PRIMARY KEY,
        shop_id      TEXT NOT NULL,
        category     TEXT NOT NULL,
        content      TEXT NOT NULL,
        evidence     TEXT[] DEFAULT '{}',
        confidence   REAL DEFAULT 0.5,
        extracted_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_patterns_shop ON agent_patterns(shop_id);
      CREATE INDEX IF NOT EXISTS idx_patterns_category ON agent_patterns(category);
    `);
  }

  // ── Record Observation ───────────────────────────────────────────────

  async record(obs: Observation): Promise<string> {
    // DB path
    if (this.pool && this.initialized) {
      try {
        const result = await this.pool.query(
          `INSERT INTO agent_memory (shop_id, agent_name, type, content, metadata, tags, confidence, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           RETURNING id`,
          [
            obs.shopId,
            obs.agentName,
            obs.type,
            obs.content,
            JSON.stringify(obs.metadata || {}),
            obs.tags || [],
            obs.confidence || 0.5,
            obs.expiresAt || null,
          ]
        );
        return result.rows[0].id;
      } catch (err) {
        console.warn('[MemorySystem] DB write failed:', (err as Error).message);
      }
    }

    // In-memory fallback
    const id = `mem_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const key = obs.shopId;
    if (!this.memoryStore.has(key)) this.memoryStore.set(key, []);
    this.memoryStore.get(key)!.push({ ...obs, id, createdAt: new Date() });

    // Trim in-memory store (keep last 500 per shop)
    const entries = this.memoryStore.get(key)!;
    if (entries.length > 500) {
      this.memoryStore.set(key, entries.slice(-500));
    }

    return id;
  }

  // ── Query Observations ───────────────────────────────────────────────

  async query(q: MemoryQuery): Promise<Observation[]> {
    // DB path
    if (this.pool && this.initialized) {
      try {
        let sql = 'SELECT * FROM agent_memory WHERE shop_id = $1';
        const params: unknown[] = [q.shopId];
        let idx = 2;

        if (q.agentName) {
          sql += ` AND agent_name = $${idx++}`;
          params.push(q.agentName);
        }
        if (q.type) {
          sql += ` AND type = $${idx++}`;
          params.push(q.type);
        }
        if (q.since) {
          sql += ` AND created_at >= $${idx++}`;
          params.push(q.since);
        }
        if (q.tags && q.tags.length > 0) {
          sql += ` AND tags && $${idx++}`;
          params.push(q.tags);
        }
        if (q.searchText) {
          sql += ` AND content ILIKE $${idx++}`;
          params.push(`%${q.searchText}%`);
        }

        // Exclude expired
        sql += ' AND (expires_at IS NULL OR expires_at > NOW())';

        sql += ` ORDER BY created_at DESC LIMIT $${idx}`;
        params.push(q.limit || 20);

        const result = await this.pool.query(sql, params);
        return result.rows.map(row => ({
          id:         row.id,
          shopId:     row.shop_id,
          agentName:  row.agent_name,
          type:       row.type,
          content:    row.content,
          metadata:   row.metadata,
          tags:       row.tags,
          confidence: row.confidence,
          createdAt:  row.created_at,
          expiresAt:  row.expires_at,
        }));
      } catch (err) {
        console.warn('[MemorySystem] DB query failed:', (err as Error).message);
      }
    }

    // In-memory fallback
    let entries = this.memoryStore.get(q.shopId) || [];
    if (q.agentName) entries = entries.filter(e => e.agentName === q.agentName);
    if (q.type) entries = entries.filter(e => e.type === q.type);
    if (q.since) entries = entries.filter(e => e.createdAt && e.createdAt >= q.since!);
    if (q.tags) entries = entries.filter(e => e.tags?.some(t => q.tags!.includes(t)));
    if (q.searchText) {
      const search = q.searchText.toLowerCase();
      entries = entries.filter(e => e.content.toLowerCase().includes(search));
    }

    return entries.slice(-(q.limit || 20)).reverse();
  }

  // ── Get Agent Memory (3-layer search) ────────────────────────────────

  async getAgentMemory(shopId: string, agentName: string): Promise<AgentMemory> {
    // Layer 1: Recent observations (last 10)
    const recent = await this.query({
      shopId,
      agentName,
      limit: 10,
    });

    // Layer 2: Patterns for this shop
    const patterns = await this.getPatterns(shopId);

    // Layer 3: Build summary
    const successCount = recent.filter(o => o.type === 'success').length;
    const failureCount = recent.filter(o => o.type === 'failure').length;
    const summary = [
      `Last 10 runs: ${successCount} successes, ${failureCount} failures`,
      patterns.length > 0 ? `${patterns.length} known patterns` : 'No patterns yet',
      recent.length > 0 ? `Latest: ${recent[0].content.slice(0, 100)}` : 'No observations yet',
    ].join('. ');

    return { recentObservations: recent, patterns, summary };
  }

  // ── Pattern Management ───────────────────────────────────────────────

  async savePattern(pattern: Pattern): Promise<string> {
    if (this.pool && this.initialized) {
      try {
        const result = await this.pool.query(
          `INSERT INTO agent_patterns (shop_id, category, content, evidence, confidence)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING id`,
          [pattern.shopId, pattern.category, pattern.content, pattern.evidence, pattern.confidence]
        );
        return result.rows[0].id;
      } catch (err) {
        console.warn('[MemorySystem] Pattern save failed:', (err as Error).message);
      }
    }

    // In-memory fallback
    const key = pattern.shopId;
    if (!this.patternStore.has(key)) this.patternStore.set(key, []);
    this.patternStore.get(key)!.push(pattern);
    return `pat_${Date.now()}`;
  }

  async getPatterns(shopId: string, category?: string): Promise<Pattern[]> {
    if (this.pool && this.initialized) {
      try {
        let sql = 'SELECT * FROM agent_patterns WHERE shop_id = $1';
        const params: unknown[] = [shopId];

        if (category) {
          sql += ' AND category = $2';
          params.push(category);
        }
        sql += ' ORDER BY confidence DESC LIMIT 50';

        const result = await this.pool.query(sql, params);
        return result.rows.map(row => ({
          shopId:      row.shop_id,
          category:    row.category,
          content:     row.content,
          evidence:    row.evidence,
          confidence:  row.confidence,
          extractedAt: row.extracted_at,
        }));
      } catch (err) {
        console.warn('[MemorySystem] Pattern query failed:', (err as Error).message);
      }
    }

    // In-memory fallback
    let patterns = this.patternStore.get(shopId) || [];
    if (category) patterns = patterns.filter(p => p.category === category);
    return patterns.slice(0, 50);
  }

  // ── Extract Patterns from Observations ───────────────────────────────
  // This would normally use LLM to compress, but we do rule-based extraction

  async extractPatterns(shopId: string): Promise<Pattern[]> {
    const observations = await this.query({ shopId, limit: 100 });
    const newPatterns: Pattern[] = [];

    // Group by agent and type
    const grouped: Record<string, Observation[]> = {};
    for (const obs of observations) {
      const key = `${obs.agentName}:${obs.type}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(obs);
    }

    for (const [key, items] of Object.entries(grouped)) {
      if (items.length < 3) continue; // Need at least 3 observations for a pattern

      const [agentName, type] = key.split(':');

      // Extract common themes
      const pattern: Pattern = {
        shopId,
        category: `${agentName}_${type}_pattern`,
        content: `${agentName} ${type}: ${items.length} occurrences. ` +
                 `Latest: ${items[0].content.slice(0, 200)}`,
        evidence: items.map(i => i.id!).filter(Boolean),
        confidence: Math.min(0.9, items.length / 10),
        extractedAt: new Date(),
      };

      await this.savePattern(pattern);
      newPatterns.push(pattern);
    }

    return newPatterns;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────

  async cleanupExpired(): Promise<number> {
    if (this.pool && this.initialized) {
      try {
        const result = await this.pool.query(
          'DELETE FROM agent_memory WHERE expires_at IS NOT NULL AND expires_at < NOW()'
        );
        return result.rowCount || 0;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  // ── Stats ────────────────────────────────────────────────────────────

  async getStats(shopId: string): Promise<{
    totalObservations: number;
    totalPatterns:     number;
    byType:            Record<string, number>;
    byAgent:           Record<string, number>;
  }> {
    if (this.pool && this.initialized) {
      try {
        const obsResult = await this.pool.query(
          'SELECT type, agent_name, COUNT(*) as count FROM agent_memory WHERE shop_id = $1 GROUP BY type, agent_name',
          [shopId]
        );
        const patResult = await this.pool.query(
          'SELECT COUNT(*) as count FROM agent_patterns WHERE shop_id = $1',
          [shopId]
        );

        const byType: Record<string, number> = {};
        const byAgent: Record<string, number> = {};
        let total = 0;

        for (const row of obsResult.rows) {
          total += parseInt(row.count);
          byType[row.type] = (byType[row.type] || 0) + parseInt(row.count);
          byAgent[row.agent_name] = (byAgent[row.agent_name] || 0) + parseInt(row.count);
        }

        return {
          totalObservations: total,
          totalPatterns: parseInt(patResult.rows[0].count),
          byType,
          byAgent,
        };
      } catch {
        // Fallback
      }
    }

    const entries = this.memoryStore.get(shopId) || [];
    const patterns = this.patternStore.get(shopId) || [];
    const byType: Record<string, number> = {};
    const byAgent: Record<string, number> = {};

    for (const e of entries) {
      byType[e.type] = (byType[e.type] || 0) + 1;
      byAgent[e.agentName] = (byAgent[e.agentName] || 0) + 1;
    }

    return {
      totalObservations: entries.length,
      totalPatterns: patterns.length,
      byType,
      byAgent,
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const memorySystem = new MemorySystem();
