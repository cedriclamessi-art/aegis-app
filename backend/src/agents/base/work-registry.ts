/**
 * Work Registry — Multi-agent work claiming and coordination
 * =============================================================
 * Sources: Dicklesworthstone/claude_code_agent_farm,
 *          0xfurai/claude-code-subagents,
 *          lst97/claude-code-subagents
 *
 * Manages work distribution across multiple agents:
 *   - Work item registration (tasks to be done)
 *   - Claim/release semantics (only one agent works on each item)
 *   - Dependency tracking (task B waits for task A)
 *   - Priority queue (high-priority items first)
 *   - Stale claim detection (reclaim if agent dies)
 *   - Completion tracking and result collection
 *   - Deduplication (no duplicate work)
 *
 * Used by:
 *   - Pipeline orchestrator (step assignments)
 *   - Team presets (worker coordination)
 *   - Scheduled tasks (prevent double-runs)
 *   - Ralph loop (campaign-level locking)
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type WorkStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled' | 'stale';

export interface WorkItem {
  id:            string;
  type:          string;           // 'pipeline_step', 'scheduled_task', 'team_worker', etc.
  description:   string;
  priority:      number;           // Lower = higher priority
  shopId?:       string;
  pipelineId?:   string;

  // Status
  status:        WorkStatus;
  claimedBy?:    string;           // Agent ID
  claimedAt?:    Date;
  startedAt?:    Date;
  completedAt?:  Date;

  // Dependencies
  dependsOn:     string[];         // Work item IDs that must complete first
  blockedBy?:    string;           // Currently blocking work item

  // Data
  input:         Record<string, unknown>;
  output?:       Record<string, unknown>;
  error?:        string;

  // Metadata
  createdAt:     Date;
  updatedAt:     Date;
  ttlMs?:        number;           // Auto-cancel if not claimed within TTL
  maxClaimMs:    number;           // Auto-release if claim exceeds this
  retries:       number;
  maxRetries:    number;
  tags:          string[];
}

export interface ClaimResult {
  success:    boolean;
  workItem?:  WorkItem;
  reason?:    string;
}

export interface WorkSummary {
  pending:    number;
  claimed:    number;
  running:    number;
  completed:  number;
  failed:     number;
  stale:      number;
  total:      number;
}

// ── Work Registry Engine ──────────────────────────────────────────────────

class WorkRegistryEngine {
  private items: Map<string, WorkItem> = new Map();
  private claimIndex: Map<string, Set<string>> = new Map(); // agentId -> workItemIds
  private deduplicationKeys: Set<string> = new Set();

  // ── Register work ───────────────────────────────────────────────────

  register(params: {
    type:         string;
    description:  string;
    priority?:    number;
    shopId?:      string;
    pipelineId?:  string;
    dependsOn?:   string[];
    input?:       Record<string, unknown>;
    ttlMs?:       number;
    maxClaimMs?:  number;
    maxRetries?:  number;
    tags?:        string[];
    deduplicationKey?: string;
  }): WorkItem {
    // Deduplication
    if (params.deduplicationKey) {
      if (this.deduplicationKeys.has(params.deduplicationKey)) {
        const existing = Array.from(this.items.values()).find(
          i => i.tags.includes(`dedup:${params.deduplicationKey}`) &&
               !['completed', 'failed', 'cancelled'].includes(i.status)
        );
        if (existing) return existing;
      }
      this.deduplicationKeys.add(params.deduplicationKey);
    }

    const id = `work_${params.type}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    const item: WorkItem = {
      id,
      type: params.type,
      description: params.description,
      priority: params.priority ?? 50,
      shopId: params.shopId,
      pipelineId: params.pipelineId,
      status: 'pending',
      dependsOn: params.dependsOn || [],
      input: params.input || {},
      createdAt: new Date(),
      updatedAt: new Date(),
      ttlMs: params.ttlMs,
      maxClaimMs: params.maxClaimMs || 300000,  // 5 min default
      retries: 0,
      maxRetries: params.maxRetries ?? 2,
      tags: [
        ...(params.tags || []),
        ...(params.deduplicationKey ? [`dedup:${params.deduplicationKey}`] : []),
      ],
    };

    this.items.set(id, item);
    return item;
  }

  // ── Claim work ──────────────────────────────────────────────────────

  claim(agentId: string, filter?: {
    type?:     string;
    shopId?:   string;
    priority?: number;
    tags?:     string[];
  }): ClaimResult {
    // Find best unclaimed work item
    const candidates = Array.from(this.items.values())
      .filter(item => {
        if (item.status !== 'pending') return false;

        // Check dependencies
        if (item.dependsOn.length > 0) {
          const allDepsComplete = item.dependsOn.every(depId => {
            const dep = this.items.get(depId);
            return dep && dep.status === 'completed';
          });
          if (!allDepsComplete) return false;
        }

        // Check TTL
        if (item.ttlMs && Date.now() - item.createdAt.getTime() > item.ttlMs) {
          item.status = 'cancelled';
          item.updatedAt = new Date();
          return false;
        }

        // Apply filters
        if (filter?.type && item.type !== filter.type) return false;
        if (filter?.shopId && item.shopId !== filter.shopId) return false;
        if (filter?.tags && !filter.tags.some(t => item.tags.includes(t))) return false;

        return true;
      })
      .sort((a, b) => a.priority - b.priority);

    if (candidates.length === 0) {
      return { success: false, reason: 'No available work items' };
    }

    const item = candidates[0];
    item.status = 'claimed';
    item.claimedBy = agentId;
    item.claimedAt = new Date();
    item.updatedAt = new Date();

    // Update claim index
    if (!this.claimIndex.has(agentId)) {
      this.claimIndex.set(agentId, new Set());
    }
    this.claimIndex.get(agentId)!.add(item.id);

    return { success: true, workItem: item };
  }

  // ── Start work ──────────────────────────────────────────────────────

  start(workId: string, agentId: string): boolean {
    const item = this.items.get(workId);
    if (!item || item.claimedBy !== agentId || item.status !== 'claimed') return false;

    item.status = 'running';
    item.startedAt = new Date();
    item.updatedAt = new Date();
    return true;
  }

  // ── Complete work ───────────────────────────────────────────────────

  complete(workId: string, agentId: string, output?: Record<string, unknown>): boolean {
    const item = this.items.get(workId);
    if (!item || item.claimedBy !== agentId) return false;

    item.status = 'completed';
    item.completedAt = new Date();
    item.updatedAt = new Date();
    item.output = output;

    // Clean claim index
    this.claimIndex.get(agentId)?.delete(workId);

    return true;
  }

  // ── Fail work ───────────────────────────────────────────────────────

  fail(workId: string, agentId: string, error: string): boolean {
    const item = this.items.get(workId);
    if (!item || item.claimedBy !== agentId) return false;

    item.retries++;
    item.error = error;
    item.updatedAt = new Date();

    if (item.retries < item.maxRetries) {
      // Release for retry
      item.status = 'pending';
      item.claimedBy = undefined;
      item.claimedAt = undefined;
    } else {
      item.status = 'failed';
      item.completedAt = new Date();
    }

    // Clean claim index
    this.claimIndex.get(agentId)?.delete(workId);

    return true;
  }

  // ── Release claim ───────────────────────────────────────────────────

  release(workId: string, agentId: string): boolean {
    const item = this.items.get(workId);
    if (!item || item.claimedBy !== agentId) return false;

    item.status = 'pending';
    item.claimedBy = undefined;
    item.claimedAt = undefined;
    item.updatedAt = new Date();

    this.claimIndex.get(agentId)?.delete(workId);
    return true;
  }

  // ── Detect stale claims ─────────────────────────────────────────────

  detectStaleClaims(): WorkItem[] {
    const staleItems: WorkItem[] = [];
    const now = Date.now();

    for (const item of this.items.values()) {
      if (
        (item.status === 'claimed' || item.status === 'running') &&
        item.claimedAt &&
        now - item.claimedAt.getTime() > item.maxClaimMs
      ) {
        item.status = 'stale';
        item.updatedAt = new Date();
        staleItems.push(item);

        // Clean claim index
        if (item.claimedBy) {
          this.claimIndex.get(item.claimedBy)?.delete(item.id);
        }
      }
    }

    return staleItems;
  }

  // ── Reclaim stale items ─────────────────────────────────────────────

  reclaimStale(): number {
    let reclaimed = 0;
    for (const item of this.items.values()) {
      if (item.status === 'stale') {
        if (item.retries < item.maxRetries) {
          item.status = 'pending';
          item.claimedBy = undefined;
          item.claimedAt = undefined;
          item.retries++;
          item.updatedAt = new Date();
          reclaimed++;
        } else {
          item.status = 'failed';
          item.error = 'Max retries exceeded after stale claims';
          item.completedAt = new Date();
          item.updatedAt = new Date();
        }
      }
    }
    return reclaimed;
  }

  // ── Query ───────────────────────────────────────────────────────────

  getItem(workId: string): WorkItem | undefined {
    return this.items.get(workId);
  }

  getItemsByAgent(agentId: string): WorkItem[] {
    const ids = this.claimIndex.get(agentId);
    if (!ids) return [];
    return Array.from(ids).map(id => this.items.get(id)!).filter(Boolean);
  }

  getItemsByPipeline(pipelineId: string): WorkItem[] {
    return Array.from(this.items.values())
      .filter(i => i.pipelineId === pipelineId);
  }

  getItemsByStatus(status: WorkStatus): WorkItem[] {
    return Array.from(this.items.values())
      .filter(i => i.status === status);
  }

  // ── Summary ─────────────────────────────────────────────────────────

  getSummary(shopId?: string): WorkSummary {
    let items = Array.from(this.items.values());
    if (shopId) items = items.filter(i => i.shopId === shopId);

    return {
      pending: items.filter(i => i.status === 'pending').length,
      claimed: items.filter(i => i.status === 'claimed').length,
      running: items.filter(i => i.status === 'running').length,
      completed: items.filter(i => i.status === 'completed').length,
      failed: items.filter(i => i.status === 'failed').length,
      stale: items.filter(i => i.status === 'stale').length,
      total: items.length,
    };
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  cleanup(maxAgeMs: number = 24 * 60 * 60 * 1000): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, item] of this.items) {
      if (
        ['completed', 'failed', 'cancelled'].includes(item.status) &&
        item.updatedAt.getTime() < cutoff
      ) {
        this.items.delete(id);
        removed++;
      }
    }

    return removed;
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const workRegistry = new WorkRegistryEngine();
