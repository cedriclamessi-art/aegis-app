/**
 * BaseAgent v6.0 — Enhanced with 90+ patterns from 13 sources
 * =============================================================
 * Integrates patterns from:
 *   - Everything Claude Code   → Hooks lifecycle (pre/post/onError)
 *   - Claude Code Router       → Model routing (Haiku/Sonnet/Opus)
 *   - VoltAgent Subagents      → Circuit breaker, tool permissions
 *   - Ralph Claude Code        → Auto-recovery, rate limiting
 *   - Claude-Mem               → Persistent memory, observation capture
 *   - Infrastructure Showcase  → Auto-activation, enforcement levels
 *   - System Prompts           → Expert persona, system reminders
 *   - Claude Code Showcase     → Skill scoring, tenant memory
 *   - OneRedOak Workflows      → Dual-loop, severity classification
 *
 * The run() method now follows this enhanced flow:
 *   1. Rate limit check
 *   2. Circuit breaker check
 *   3. Hook: preExecute (budget, compliance, validation)
 *   4. TierGate verdict (execute/shadow/suggest/block)
 *   5. Model routing (select optimal LLM)
 *   6. Execute agent logic
 *   7. Hook: postExecute (logging, learning, triggers)
 *   8. Memory: record observation
 *   9. Return enriched result
 *
 * On error:
 *   - Hook: onError (retry logic, circuit breaker update)
 *   - Auto-recovery if transient
 *   - Alert if critical
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { tierGate, postSuggestion, TierGateVerdict } from '../core/tier-gate.middleware';
import { hookEngine, HookContext } from './hooks';
import { circuitBreakerRegistry } from './circuit-breaker';
import { modelRouter, ModelTier } from './model-router';
import { rateLimiter, TierName } from './rate-limiter';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface AgentTask {
  shop_id:    string;
  type:       string;
  payload?:   unknown;
  _shadow?:   boolean;
  _metadata?: {
    pipelineId?: string;
    stepIndex?:  number;
    parentAgent?: string;
    priority?:   number;
  };
}

export interface AgentResult {
  success:    boolean;
  data?:      unknown;
  message?:   string;
  // TierGate enrichment
  tier_verdict?:    TierGateVerdict;
  tier_mode?:       string;
  current_tier?:    number;
  shadowed?:        boolean;
  suggested?:       boolean;
  suggestion_id?:   string;
  // v6.0 enrichment
  model_used?:      string;
  duration_ms?:     number;
  hooks_feedback?:  string;
  circuit_breaker?: string;
  memory_recorded?: boolean;
  retry_count?:     number;
}

// Agent metadata for expert persona pattern (from System Prompts)
export interface AgentPersona {
  expertise:    string;
  description:  string;
  model:        'haiku' | 'sonnet' | 'opus';
  tools:        string[];
  whenToUse:    string;
}

// ── Enhanced BaseAgent ──────────────────────────────────────────────────────

export abstract class BaseAgent {
  abstract readonly name: string;

  // Optional: agent persona (from Piebald-AI agent creation framework)
  readonly persona?: AgentPersona;

  constructor(protected db: Pool, protected redis: Redis) {}

  abstract execute(task: AgentTask): Promise<AgentResult>;

  /**
   * Enhanced entry point with full pattern integration.
   * Flow: RateLimit → CircuitBreaker → PreHooks → TierGate → ModelRoute → Execute → PostHooks → Memory
   */
  async run(task: AgentTask, financialImpact?: number): Promise<AgentResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = 3;

    // Resolve tenant tier
    const tierNum = await this.resolveTier(task.shop_id);
    const tierName = this.tierNumberToName(tierNum);

    // ── Step 1: Rate Limit Check ────────────────────────────────
    const rateCheck = rateLimiter.checkLimit(task.shop_id, tierName, 'agentCalls');
    if (!rateCheck.allowed) {
      return {
        success: false,
        message: `Rate limit atteint: ${rateCheck.remaining} appels restants. Reset dans ${Math.ceil(rateCheck.resetInMs / 1000)}s`,
        tier_verdict: 'block',
        current_tier: tierNum,
      };
    }
    rateLimiter.recordUsage(task.shop_id, 'agentCalls', 1);

    // ── Step 2: Circuit Breaker Check ───────────────────────────
    const cbState = circuitBreakerRegistry.getState(this.name);
    if (cbState === 'open') {
      return {
        success: false,
        message: `Circuit breaker OPEN pour ${this.name}. Cooldown en cours.`,
        circuit_breaker: 'open',
        tier_verdict: 'block',
        current_tier: tierNum,
      };
    }

    // ── Step 3: PreExecute Hooks ────────────────────────────────
    const hookCtx: HookContext = {
      agentId: this.name,
      taskType: task.type,
      tenantId: task.shop_id,
      input: task.payload,
      tier: tierNum,
      pipelineId: task._metadata?.pipelineId,
      stepIndex: task._metadata?.stepIndex,
    };

    // Load budget info for hook
    try {
      const budgetInfo = await this.getBudgetInfo(task.shop_id);
      hookCtx.budget = budgetInfo;
    } catch { /* non-blocking */ }

    const preHookResult = await hookEngine.execute('preExecute', hookCtx);
    if (preHookResult.block) {
      return {
        success: false,
        message: preHookResult.reason ?? 'Bloqué par un hook preExecute',
        hooks_feedback: preHookResult.feedback,
        tier_verdict: 'block',
        current_tier: tierNum,
      };
    }

    // Apply modified input from hooks if provided
    if (preHookResult.modifiedInput) {
      task = { ...task, payload: preHookResult.modifiedInput };
    }

    // ── Step 4: TierGate ────────────────────────────────────────
    const gate = await tierGate(this.db, task.shop_id, this.name, financialImpact);

    // Log the gate check (non-blocking)
    this.db.query(`
      INSERT INTO agent_decisions
        (shop_id, agent_name, decision_type, decision_made, executed, confidence, context)
      VALUES ($1,$2,'tier_gate_check',$3,false,1.0,$4)`,
      [task.shop_id, this.name, JSON.stringify({ task_type: task.type }),
       JSON.stringify({
         tier: gate.current_tier, mode: gate.agent_mode,
         verdict: gate.verdict, reason: gate.reason,
       })]).catch(() => {});

    // ── Step 5: Model Routing ───────────────────────────────────
    const selectedModel = modelRouter.getModel(this.name, tierName);
    modelRouter.trackUsage(this.name, selectedModel, 0); // Token count updated after execution

    // ── Step 6: Execute based on TierGate verdict ───────────────
    let result: AgentResult;

    const executeWithRetry = async (): Promise<AgentResult> => {
      try {
        return await circuitBreakerRegistry.execute(this.name, async () => {
          return this.execute(task);
        });
      } catch (error) {
        // ── OnError Hooks ─────────────────────────────────
        const errorCtx: HookContext = {
          ...hookCtx,
          error: error instanceof Error ? error : new Error(String(error)),
          retryCount,
        };
        const errorHookResult = await hookEngine.execute('onError', errorCtx);

        // Check if we should retry
        const retryAction = errorHookResult.actions?.find(a => a.type === 'retry');
        if (retryAction && retryCount < maxRetries) {
          retryCount++;
          const delay = (retryAction.payload as any)?.delay ?? 1000;
          await new Promise(r => setTimeout(r, delay));
          return executeWithRetry();
        }

        throw error;
      }
    };

    switch (gate.verdict) {
      case 'block':
        result = {
          success: false, message: gate.reason,
          tier_verdict: 'block', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier,
        };
        break;

      case 'shadow': {
        const shadowCtx = { ...task, _shadow: true };
        const shadowResult = await executeWithRetry().catch(e => ({
          success: false, message: String(e),
        }));
        this.db.query(`
          INSERT INTO shadow_mode_log
            (shop_id, agent_name, task_type, would_have_done, result, tier)
          VALUES ($1,$2,$3,$4,$5,$6)`,
          [task.shop_id, this.name, task.type,
           JSON.stringify(task.payload ?? {}),
           JSON.stringify(shadowResult),
           gate.current_tier]).catch(() => {});

        result = {
          ...shadowResult,
          tier_verdict: 'shadow', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier, shadowed: true,
        };
        break;
      }

      case 'suggest': {
        const suggestResult = await executeWithRetry().catch(e => ({
          success: false, message: String(e),
        }));
        const narrative = (suggestResult as any)?.data?.narrative_fr
          ?? (suggestResult as any)?.data?.reason
          ?? `${this.name} propose : ${task.type}`;

        const suggestionId = await postSuggestion(
          this.db, task.shop_id, this.name, task.type,
          task.payload, narrative, gate.current_tier
        ).catch(() => null);

        result = {
          ...suggestResult, success: true,
          tier_verdict: 'suggest', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier, suggested: true,
          suggestion_id: suggestionId ?? undefined,
        };
        break;
      }

      case 'execute':
      default: {
        const execResult = await executeWithRetry().catch(e => ({
          success: false as const, message: String(e),
        }));
        result = {
          ...execResult,
          tier_verdict: 'execute', tier_mode: gate.agent_mode,
          current_tier: gate.current_tier,
        };
        break;
      }
    }

    const durationMs = Date.now() - startTime;

    // ── Step 7: PostExecute Hooks ───────────────────────────────
    const postCtx: HookContext = {
      ...hookCtx,
      output: result.data,
      success: result.success,
      durationMs,
    };
    const postHookResult = await hookEngine.execute('postExecute', postCtx);

    // Apply modified output from hooks if provided
    if (postHookResult.modifiedOutput) {
      result.data = postHookResult.modifiedOutput;
    }

    // ── Step 8: Record Observation (Memory System) ──────────────
    try {
      await this.recordObservation(task, result, durationMs);
    } catch { /* non-blocking */ }

    // ── Step 9: Emit event for real-time monitoring ─────────────
    await this.emit(`agent:${result.success ? 'completed' : 'failed'}`, {
      shop_id: task.shop_id,
      agent: this.name,
      task_type: task.type,
      success: result.success,
      duration_ms: durationMs,
      model: selectedModel,
      tier: tierNum,
    }).catch(() => {});

    // ── Enrich result with v6.0 metadata ────────────────────────
    result.model_used = selectedModel;
    result.duration_ms = durationMs;
    result.hooks_feedback = [preHookResult.feedback, postHookResult.feedback]
      .filter(Boolean).join(' | ') || undefined;
    result.circuit_breaker = circuitBreakerRegistry.getState(this.name);
    result.memory_recorded = true;
    result.retry_count = retryCount > 0 ? retryCount : undefined;

    return result;
  }

  // ── Helpers partagés ──────────────────────────────────────────

  protected async remember(shopId: string, opts: {
    memory_key:   string;
    memory_type:  string;
    value:        unknown;
    ttl_hours:    number;
  }): Promise<void> {
    await this.db.query(`
      INSERT INTO agent_memory
        (shop_id, agent_name, memory_key, memory_type, value, expires_at)
      VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' hours')::INTERVAL)
      ON CONFLICT (shop_id, agent_name, memory_key) DO UPDATE
        SET value=$5, expires_at=NOW() + ($6 || ' hours')::INTERVAL`,
      [shopId, this.name, opts.memory_key, opts.memory_type,
       JSON.stringify(opts.value), opts.ttl_hours]);
  }

  protected async emit(event: string, payload: unknown): Promise<void> {
    const channel = `aegis:event:${(payload as any)?.shop_id ?? 'global'}:${event}`;
    await this.redis.publish(channel, JSON.stringify(payload));
  }

  protected async getShopConfig(shopId: string): Promise<Record<string, any>> {
    const { rows } = await this.db.query(
      `SELECT * FROM shops WHERE id=$1`, [shopId]);
    return rows[0] ?? {};
  }

  protected async getWorldState(shopId: string): Promise<Record<string, any>> {
    const { rows } = await this.db.query(
      `SELECT * FROM world_state WHERE shop_id=$1`, [shopId]);
    return rows[0] ?? {};
  }

  /**
   * Get agent's past learnings for this tenant.
   * Memory System pattern from claude-mem: 3-layer search.
   */
  protected async getAgentMemory(shopId: string, limit = 10): Promise<any[]> {
    const { rows } = await this.db.query(`
      SELECT memory_key, memory_type, value, created_at
      FROM agent_memory
      WHERE shop_id = $1 AND agent_name = $2
        AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC LIMIT $3`,
      [shopId, this.name, limit]);
    return rows.map(r => ({
      key: r.memory_key,
      type: r.memory_type,
      value: typeof r.value === 'string' ? JSON.parse(r.value) : r.value,
      at: r.created_at,
    }));
  }

  /**
   * Get system reminders for current context.
   * Pattern from Piebald-AI System Prompts.
   */
  protected async getSystemReminders(shopId: string): Promise<string[]> {
    const reminders: string[] = [];

    // Budget reminder
    try {
      const budget = await this.getBudgetInfo(shopId);
      if (budget) {
        const pct = Math.round(budget.spent / budget.limit * 100);
        if (pct >= 90) reminders.push(`🔴 Budget à ${pct}% (${budget.spent}€/${budget.limit}€)`);
        else if (pct >= 75) reminders.push(`🟡 Budget à ${pct}% (${budget.spent}€/${budget.limit}€)`);
      }
    } catch { /* non-blocking */ }

    // Active campaigns reminder
    try {
      const { rows } = await this.db.query(
        `SELECT COUNT(*) as cnt FROM pipeline_runs WHERE shop_id = $1 AND status = 'running'`,
        [shopId]);
      const count = parseInt(rows[0]?.cnt ?? '0');
      if (count > 0) reminders.push(`📊 ${count} pipeline(s) actif(s)`);
    } catch { /* non-blocking */ }

    return reminders;
  }

  // ── Private helpers ───────────────────────────────────────────

  private async resolveTier(shopId: string): Promise<number> {
    try {
      const { rows } = await this.db.query(
        `SELECT current_tier FROM shops WHERE id = $1`, [shopId]);
      return rows[0]?.current_tier ?? 1;
    } catch {
      return 1;
    }
  }

  private tierNumberToName(tier: number): TierName {
    if (tier >= 5) return 'empire';
    if (tier >= 4) return 'scale';
    if (tier >= 3) return 'growth';
    return 'seed';
  }

  private async getBudgetInfo(shopId: string): Promise<{ spent: number; limit: number } | undefined> {
    try {
      const { rows } = await this.db.query(`
        SELECT COALESCE(SUM(amount), 0) as spent
        FROM financial_transactions
        WHERE shop_id = $1 AND type = 'expense'
          AND created_at >= date_trunc('month', NOW())`,
        [shopId]);
      const spent = parseFloat(rows[0]?.spent ?? '0');
      const config = await this.getShopConfig(shopId);
      const limit = config?.monthly_budget ?? 500;
      return { spent, limit };
    } catch {
      return undefined;
    }
  }

  private async recordObservation(
    task: AgentTask,
    result: AgentResult,
    durationMs: number,
  ): Promise<void> {
    // Extract metrics from result for pattern extraction
    const metrics: Record<string, number> = {};
    const data = result.data as any;
    if (data?.roas) metrics.roas = data.roas;
    if (data?.ctr) metrics.ctr = data.ctr;
    if (data?.cpa) metrics.cpa = data.cpa;
    if (data?.cvr) metrics.cvr = data.cvr;
    if (data?.winnerScore?.overall) metrics.winner_score = data.winnerScore.overall;
    if (data?.contributionMargin?.contributionMarginPct) {
      metrics.margin_pct = data.contributionMargin.contributionMarginPct;
    }

    await this.db.query(`
      INSERT INTO agent_observations
        (shop_id, agent_name, task_type, input_summary, output_summary,
         success, duration_ms, metrics, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
      ON CONFLICT DO NOTHING`,
      [
        task.shop_id,
        this.name,
        task.type,
        JSON.stringify(task.payload ?? {}).slice(0, 500),
        JSON.stringify(result.data ?? {}).slice(0, 2000),
        result.success,
        durationMs,
        JSON.stringify(metrics),
      ]).catch(() => {});
  }
}
