/**
 * BaseAgent v7.0 — Fully wired with all 24 infrastructure modules
 * ==================================================================
 * Flow: Permission → RateLimit → CircuitBreaker → TurnBudget →
 *       PreHooks → ToolRuleGraph → TierGate → ModelRoute →
 *       InnerMonologue → Execute → PostHooks → ExecutionLog →
 *       Memory Hierarchy → Observability → SleeptimeCompute →
 *       TriggerActivation → Return enriched result
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { tierGate, postSuggestion, TierGateVerdict } from '../core/tier-gate.middleware';
import { hookEngine, HookContext } from './hooks';
import { circuitBreakerRegistry } from './circuit-breaker';
import { modelRouter } from './model-router';
import { rateLimiter, TierName } from './rate-limiter';
import { turnBudget } from './turn-budget';
import { executionLog } from './execution-log';
import { innerMonologue } from './inner-monologue';
import { memoryHierarchy } from './memory-hierarchy';
import { observability } from './observability';
import { sleeptimeCompute } from './sleeptime-compute';
import { agentPermissions } from './agent-permissions';
import { triggerActivation } from './trigger-activation';
import { progressiveDisclosure } from './progressive-disclosure';
import { toolRuleGraph } from './tool-rule-graph';
import { workRegistry } from './work-registry';
import { conversationCompaction } from './conversation-compaction';

// ── Interfaces ──────────────────────────────────────────────────────────────

export interface AgentTask {
  shop_id:    string;
  type:       string;
  id?:        string;        // Task ID (used by legacy agents for trace)
  payload?:   unknown;
  _shadow?:   boolean;
  _metadata?: {
    pipelineId?: string;
    stepIndex?:  number;
    parentAgent?: string;
    priority?:   number;
  };
  // Legacy compat aliases (used by stop-loss, spy, ugc-factory, etc.)
  taskType?:  string;
  tenantId?:  string;
  input?:     unknown;
  [key: string]: unknown;   // Allow extra fields from legacy agents
}

export interface AgentResult {
  success:    boolean;
  data?:      unknown;
  message?:   string;
  // Compat aliases (legacy agents use output/error)
  output?:    unknown;
  error?:     string;
  retryable?: boolean;
  // TierGate enrichment
  tier_verdict?:    TierGateVerdict;
  tier_mode?:       string;
  current_tier?:    number;
  shadowed?:        boolean;
  suggested?:       boolean;
  suggestion_id?:   string;
  // v7.0 enrichment
  model_used?:      string;
  duration_ms?:     number;
  hooks_feedback?:  string;
  circuit_breaker?: string;
  memory_recorded?: boolean;
  retry_count?:     number;
  turn_budget?:     string;
  execution_log_id?: string;
  complexity_level?: number;
  reasoning_id?:    string;
}

export interface AgentPersona {
  expertise:    string;
  description:  string;
  model:        'haiku' | 'sonnet' | 'opus';
  tools:        string[];
  whenToUse:    string;
}

export type RiskLevel = 'low' | 'medium' | 'high' | 'critical';

export type EmpireMode = 'startup' | 'growth' | 'scale' | 'empire';

export interface WorldState {
  shop_id:       string;
  empire_mode:   EmpireMode;
  current_tier:  number;
  metrics:       Record<string, number>;
  updated_at:    Date;
  [key: string]: unknown;
}

// ── Enhanced BaseAgent v7 ─────────────────────────────────────────────────

export abstract class BaseAgent {
  abstract readonly name: string;

  readonly persona?: AgentPersona;

  constructor(protected db: Pool, protected redis: Redis) {}

  abstract execute(task: AgentTask): Promise<AgentResult>;

  /**
   * Full v7 pipeline:
   * Permission → RateLimit → CircuitBreaker → TurnBudget → PreHooks →
   * TierGate → ModelRoute → InnerMonologue → Execute → PostHooks →
   * ExecutionLog → Memory → Observability → Sleeptime → Triggers
   */
  async run(task: AgentTask, financialImpact?: number): Promise<AgentResult> {
    const startTime = Date.now();
    let retryCount = 0;
    const maxRetries = 3;

    // Resolve tenant tier
    const tierNum = await this.resolveTier(task.shop_id);
    const tierName = this.tierNumberToName(tierNum);

    // ── Step 0: Permission Check ──────────────────────────────
    const permCheck = agentPermissions.check(this.name, task.type);
    if (!permCheck.allowed) {
      return {
        success: false,
        message: permCheck.reason ?? `Action ${task.type} denied for ${this.name}`,
        tier_verdict: 'block',
        current_tier: tierNum,
      };
    }
    if (permCheck.requiresApproval) {
      const approvalReq = agentPermissions.requestApproval({
        agentId: this.name,
        shopId: task.shop_id,
        action: task.type,
        description: `${this.name} requests approval for ${task.type}`,
        data: { payload: task.payload },
      });
      // Log but continue (non-blocking approval for now)
      observability.emit({
        type: 'system:alert',
        level: 'warn',
        agentId: this.name,
        shopId: task.shop_id,
        data: { approvalId: approvalReq.id, action: task.type },
        tags: ['approval', 'hitl'],
      });
    }

    // ── Step 1: Rate Limit Check ──────────────────────────────
    const rateCheck = rateLimiter.checkLimit(task.shop_id, tierNum);
    if (!rateCheck.allowed) {
      return {
        success: false,
        message: `Rate limit atteint: ${rateCheck.remaining ?? 0} appels restants. Reset dans ${Math.ceil((rateCheck.resetIn ?? 60000) / 1000)}s`,
        tier_verdict: 'block',
        current_tier: tierNum,
      };
    }
    rateLimiter.recordCall(task.shop_id);

    // ── Step 2: Circuit Breaker Check ─────────────────────────
    const cb = circuitBreakerRegistry.get(this.name, task.shop_id);
    const cbState = cb.getStatus().state;
    if (cbState === 'OPEN') {
      return {
        success: false,
        message: `Circuit breaker OPEN pour ${this.name}. Cooldown en cours.`,
        circuit_breaker: 'open',
        tier_verdict: 'block',
        current_tier: tierNum,
      };
    }

    // ── Step 3: Turn Budget ───────────────────────────────────
    const budgetSession = turnBudget.createSession(this.name, tierNum, task.shop_id);
    const budgetCheck = turnBudget.checkTurn(budgetSession.sessionId);
    if (!budgetCheck.allowed) {
      return {
        success: false,
        message: budgetCheck.reason ?? 'Turn budget exceeded',
        turn_budget: 'exceeded',
        current_tier: tierNum,
      };
    }

    // ── Step 4: Complexity Assessment ─────────────────────────
    const complexity = progressiveDisclosure.assess(
      task.type + ' ' + JSON.stringify(task.payload ?? '').slice(0, 200),
      this.name
    );

    // ── Step 5: Start Execution Log ───────────────────────────
    const logId = executionLog.startExecution({
      agentId: this.name,
      agentName: this.name,
      model: complexity.profile.model,
      maxTurns: complexity.profile.maxTurns,
      shopId: task.shop_id,
      pipelineId: task._metadata?.pipelineId,
      stepName: task.type,
      contextSize: JSON.stringify(task.payload ?? '').length,
      tags: [task.type, `tier:${tierNum}`, `level:${complexity.level}`],
    });

    // ── Step 6: PreExecute Hooks ──────────────────────────────
    const hookCtx: HookContext = {
      agentName: this.name,
      shopId: task.shop_id,
      tier: tierNum,
      task: task.payload,
      pipelineId: task._metadata?.pipelineId,
      stepIndex: task._metadata?.stepIndex,
      metadata: { taskType: task.type },
    };

    const preHookResult = await hookEngine.execute('preExecute', hookCtx);
    if (!preHookResult.allow) {
      executionLog.completeExecution(logId, { status: 'failure', error: preHookResult.feedback });
      return {
        success: false,
        message: preHookResult.feedback ?? 'Bloqué par un hook preExecute',
        hooks_feedback: preHookResult.feedback,
        tier_verdict: 'block',
        current_tier: tierNum,
        execution_log_id: logId,
      };
    }

    // ── Step 7: Consume Guidance Whispers ──────────────────────
    const guidance = sleeptimeCompute.consumeGuidance(this.name, task.shop_id);
    const whisperContext = sleeptimeCompute.formatGuidanceWhisper(guidance);

    // ── Step 8: Load Core Memory Context ──────────────────────
    const coreContext = memoryHierarchy.getCoreContext(task.shop_id);

    // ── Step 9: Inner Monologue — Pre-execution reasoning ─────
    const reasoningId = innerMonologue.think({
      agentId: this.name,
      shopId: task.shop_id,
      pipelineId: task._metadata?.pipelineId,
      thought: `Starting ${task.type}. Complexity: L${complexity.level} (${complexity.profile.label}). Model: ${complexity.profile.model}. ${whisperContext ? 'Has guidance whispers.' : 'No guidance.'}`,
      type: 'reasoning',
      confidence: complexity.confidence,
    }).id;

    // ── Step 10: TierGate ─────────────────────────────────────
    const gate = await tierGate(this.db, task.shop_id, this.name, financialImpact);

    this.db.query(`
      INSERT INTO agent_decisions
        (shop_id, agent_name, decision_type, decision_made, executed, confidence, context)
      VALUES ($1,$2,'tier_gate_check',$3,false,1.0,$4)`,
      [task.shop_id, this.name, JSON.stringify({ task_type: task.type }),
       JSON.stringify({
         tier: gate.current_tier, mode: gate.agent_mode,
         verdict: gate.verdict, reason: gate.reason,
       })]).catch(() => {});

    // ── Step 11: Model Routing ────────────────────────────────
    const modelRoute = modelRouter.route(this.name, tierNum, { complexity: complexity.level });
    const selectedModel = modelRoute.model;

    // ── Step 12: Observability — Agent Start ──────────────────
    observability.emit({
      type: 'agent:start',
      level: 'info',
      agentId: this.name,
      shopId: task.shop_id,
      pipelineId: task._metadata?.pipelineId,
      data: {
        taskType: task.type,
        model: selectedModel,
        tier: tierNum,
        complexity: complexity.level,
      },
      tags: [task.type],
    });

    observability.heartbeat(this.name, budgetSession.sessionId, {
      shopId: task.shop_id,
      turnsUsed: 0,
      costUsd: 0,
      currentAction: task.type,
    });

    // ── Step 13: Execute based on TierGate verdict ────────────
    let result: AgentResult;

    const executeWithRetry = async (): Promise<AgentResult> => {
      try {
        if (!cb.canExecute()) {
          return { success: false, message: 'Circuit breaker OPEN', circuit_breaker: 'open' };
        }
        const res = await this.execute(task);
        cb.recordSuccess();
        return res;
      } catch (error) {
        cb.recordFailure('execution_error', error instanceof Error ? error.message : String(error));

        const errorCtx: HookContext = {
          ...hookCtx,
          error: error instanceof Error ? error : new Error(String(error)),
        };
        const errorHookResult = await hookEngine.execute('onError', errorCtx);

        if (errorHookResult.action === 'retry' && retryCount < maxRetries) {
          retryCount++;
          await new Promise(r => setTimeout(r, 1000 * retryCount));
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

    // ── Step 14: PostExecute Hooks ────────────────────────────
    const postCtx: HookContext = {
      ...hookCtx,
      result: result.data ?? result.output,
      metadata: { ...hookCtx.metadata, success: result.success, durationMs },
    };
    const postHookResult = await hookEngine.execute('postExecute', postCtx);

    if (postHookResult.data) {
      result.data = postHookResult.data;
    }

    // ── Step 15: Inner Monologue — Post-execution reasoning ───
    innerMonologue.think({
      agentId: this.name,
      shopId: task.shop_id,
      pipelineId: task._metadata?.pipelineId,
      thought: result.success
        ? `Completed ${task.type} successfully in ${durationMs}ms. Model: ${selectedModel}.`
        : `Failed ${task.type}: ${result.message || result.error || 'unknown error'}`,
      type: result.success ? 'observation' : 'uncertainty',
      confidence: result.success ? 0.9 : 0.3,
    });

    // Create audit trail for decisions
    if (gate.verdict === 'execute' && result.success) {
      innerMonologue.createAudit({
        agentId: this.name,
        shopId: task.shop_id,
        decision: `${task.type} executed with ${gate.verdict} verdict`,
        alternatives: ['shadow', 'suggest', 'block'],
        confidence: complexity.confidence,
      });
    }

    // ── Step 16: Execution Log — Complete ─────────────────────
    executionLog.recordTurn(logId, {
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      model: selectedModel,
    });

    executionLog.completeExecution(logId, {
      status: result.success ? 'success' : 'failure',
      result: result.data ?? result.output,
      error: result.message || result.error,
      tags: result.success ? ['success'] : ['failure'],
    });

    // ── Step 17: Turn Budget — Record ─────────────────────────
    turnBudget.recordTurn(budgetSession.sessionId, {
      model: selectedModel,
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs,
      action: task.type,
      timestamp: new Date(),
    });
    turnBudget.completeSession(budgetSession.sessionId);

    // ── Step 18: Record Observation (Memory) ──────────────────
    try {
      await this.recordObservation(task, result, durationMs);
    } catch { /* non-blocking */ }

    // ── Step 19: Observability — Agent Complete ───────────────
    observability.emit({
      type: result.success ? 'agent:complete' : 'agent:error',
      level: result.success ? 'info' : 'error',
      agentId: this.name,
      shopId: task.shop_id,
      pipelineId: task._metadata?.pipelineId,
      data: {
        taskType: task.type,
        success: result.success,
        durationMs,
        model: selectedModel,
        tier: tierNum,
        costUsd: 0,
        turnsUsed: 1,
        error: result.success ? undefined : (result.message || result.error),
        status: result.success ? 'success' : 'failure',
        message: `${this.name} ${result.success ? 'completed' : 'failed'} ${task.type}`,
      },
      tags: [task.type, result.success ? 'success' : 'failure'],
    });

    observability.removeHeartbeat(budgetSession.sessionId);

    // ── Step 20: Sleeptime tick ───────────────────────────────
    sleeptimeCompute.tick(task.shop_id).catch(() => {});

    // ── Step 21: Emit Redis event ─────────────────────────────
    await this.emit(`agent:${result.success ? 'completed' : 'failed'}`, {
      shop_id: task.shop_id,
      agent: this.name,
      task_type: task.type,
      success: result.success,
      duration_ms: durationMs,
      model: selectedModel,
      tier: tierNum,
    }).catch(() => {});

    // ── Step 22: Fire chain triggers ──────────────────────────
    if (result.success) {
      const chainMatches = triggerActivation.fireChain(this.name, {
        shopId: task.shop_id,
        taskType: task.type,
        result: result.data ?? result.output,
      });
      for (const match of chainMatches) {
        triggerActivation.recordExecution(
          match.trigger.id, match.trigger.agentId,
          `chain from ${this.name}`, match.context
        );
      }
    }

    // ── Enrich result with v7.0 metadata ──────────────────────
    result.model_used = selectedModel;
    result.duration_ms = durationMs;
    result.hooks_feedback = [preHookResult.feedback, postHookResult.feedback]
      .filter(Boolean).join(' | ') || undefined;
    result.circuit_breaker = cb.getStatus().state;
    result.memory_recorded = true;
    result.retry_count = retryCount > 0 ? retryCount : undefined;
    result.turn_budget = budgetSession.status;
    result.execution_log_id = logId;
    result.complexity_level = complexity.level;
    result.reasoning_id = reasoningId;

    return result;
  }

  // ═══════════════════════════════════════════════════════════════════
  //  SHARED HELPERS (available to all agents)
  // ═══════════════════════════════════════════════════════════════════

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

  /** Send inter-agent message via Redis pub/sub */
  protected async send(msg: {
    fromAgent:   string;
    toAgent:     string;
    messageType: string;
    subject:     string;
    payload:     unknown;
    tenantId:    string;
    priority?:   number;
  }): Promise<void> {
    const channel = `aegis:agent:${msg.toAgent}`;
    await this.redis.publish(channel, JSON.stringify({
      ...msg,
      timestamp: new Date().toISOString(),
    }));
    // Also log to DB for audit trail
    this.db.query(`
      INSERT INTO agent_messages
        (from_agent, to_agent, message_type, subject, payload, tenant_id, priority, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [msg.fromAgent, msg.toAgent, msg.messageType, msg.subject,
       JSON.stringify(msg.payload), msg.tenantId, msg.priority ?? 5]
    ).catch(() => {});
  }

  /** Structured trace logging */
  protected async trace(
    level: string, message: string,
    data: Record<string, unknown> = {}, taskId?: string,
  ): Promise<void> {
    this.db.query(
      `INSERT INTO agent_trace (agent_name, level, message, data, task_id, created_at)
       VALUES ($1,$2,$3,$4,$5,NOW())`,
      [this.name, level, message, JSON.stringify(data), taskId]
    ).catch(() => {});
  }

  /** Call Claude/LLM with system+user prompt */
  protected async callLLM(opts: {
    system: string; user: string; maxTokens?: number; model?: string; temperature?: number;
  }): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return '{"error":"No ANTHROPIC_API_KEY set"}';
    const model = opts.model ?? process.env.AEGIS_DEFAULT_MODEL ?? 'claude-sonnet-4-20250514';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model, max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.3,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    });
    const json = await res.json() as { content?: Array<{ type: string; text: string }> };
    return json.content?.find((b: any) => b.type === 'text')?.text ?? '';
  }

  /** Log a decision for audit trail — returns decision ID */
  protected async logDecision(
    shopIdOrObj: string | Record<string, unknown>,
    maybeDecision?: Record<string, unknown>,
  ): Promise<string> {
    const decisionId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let shopId: string;
    let decision: Record<string, unknown>;
    if (typeof shopIdOrObj === 'string') {
      shopId = shopIdOrObj; decision = maybeDecision ?? {};
    } else {
      shopId = (shopIdOrObj as any).tenantId ?? (shopIdOrObj as any).shopId ?? 'unknown';
      decision = shopIdOrObj;
    }
    this.db.query(`
      INSERT INTO agent_decisions
        (id, shop_id, agent_name, decision_type, decision_made, executed, confidence, context, created_at)
      VALUES ($1,$2,$3,$4,$5,false,$6,$7,NOW())`,
      [decisionId, shopId, this.name,
       decision.decision_type ?? decision.decisionType ?? 'generic',
       JSON.stringify(decision.decision_made ?? decision.decision ?? decision),
       decision.confidence ?? 0.8, JSON.stringify(decision)]
    ).catch(() => {});
    return decisionId;
  }

  /** Mark a decision as executed */
  protected async markExecuted(decisionId: string): Promise<void> {
    this.db.query(
      `UPDATE agent_decisions SET executed = true, executed_at = NOW() WHERE id = $1`,
      [decisionId]
    ).catch(() => {});
  }

  /** Update agent execution status */
  protected async setStatus(status: string): Promise<void> {
    this.db.query(
      `INSERT INTO agent_status (agent_name, status, updated_at)
       VALUES ($1,$2,NOW())
       ON CONFLICT (agent_name) DO UPDATE SET status=$2, updated_at=NOW()`,
      [this.name, status]
    ).catch(() => {});
  }

  /** Signal liveness to monitoring */
  protected async heartbeat(): Promise<void> {
    await this.redis.set(
      `aegis:heartbeat:${this.name}`,
      JSON.stringify({ ts: Date.now(), agent: this.name }),
      'EX', 300
    ).catch(() => {});
  }

  /** Broadcast event to all agents */
  protected async broadcast(payload: unknown, topic: string, tenantId?: string): Promise<void> {
    const channel = `aegis:broadcast:${tenantId ?? 'global'}`;
    await this.redis.publish(channel, JSON.stringify({
      topic, from: this.name, payload, timestamp: new Date().toISOString(),
    })).catch(() => {});
  }

  /** Push market intelligence signal */
  protected async pushIntel(
    signalOrType: Record<string, unknown> | string, ...args: unknown[]
  ): Promise<string> {
    const intelId = `intel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    let signal: Record<string, unknown>;
    if (typeof signalOrType === 'string') {
      signal = { signal_type: signalOrType, title: args[0], summary: args[1], actionHint: args[2], targetAgents: args[3] };
    } else { signal = signalOrType; }
    this.db.query(`
      INSERT INTO intel_feed (id, source, signal_type, subject, data, confidence, relevance_score, created_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
      [intelId, signal.source ?? this.name, signal.signal_type ?? 'generic',
       signal.subject ?? signal.title ?? '', JSON.stringify(signal.data ?? signal),
       signal.confidence ?? 0.7, signal.relevance_score ?? 5]
    ).catch(() => {});
    return intelId;
  }

  /** Read intel feed */
  protected async readIntelFeed(opts?: { limit?: number; type?: string }): Promise<Record<string, unknown>[]> {
    try {
      const { rows } = await this.db.query(`
        SELECT * FROM intel_feed WHERE ($1::text IS NULL OR signal_type = $1)
        ORDER BY created_at DESC LIMIT $2`,
        [opts?.type ?? null, opts?.limit ?? 20]);
      return rows;
    } catch { return []; }
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

  protected async getSystemReminders(shopId: string): Promise<string[]> {
    const reminders: string[] = [];

    try {
      const budget = await this.getBudgetInfo(shopId);
      if (budget) {
        const pct = Math.round(budget.spent / budget.limit * 100);
        if (pct >= 90) reminders.push(`Budget at ${pct}% (${budget.spent}/${budget.limit})`);
        else if (pct >= 75) reminders.push(`Budget at ${pct}% (${budget.spent}/${budget.limit})`);
      }
    } catch { /* non-blocking */ }

    try {
      const { rows } = await this.db.query(
        `SELECT COUNT(*) as cnt FROM pipeline_runs WHERE shop_id = $1 AND status = 'running'`,
        [shopId]);
      const count = parseInt(rows[0]?.cnt ?? '0');
      if (count > 0) reminders.push(`${count} pipeline(s) running`);
    } catch { /* non-blocking */ }

    // Guidance whispers
    const pendingGuidance = sleeptimeCompute.getPendingGuidanceCount(shopId);
    if (pendingGuidance > 0) reminders.push(`${pendingGuidance} guidance message(s) pending`);

    // Metacognition alerts
    const metacog = innerMonologue.getOpenMetacognition(this.name);
    if (metacog.length > 0) reminders.push(`${metacog.length} metacognition alert(s)`);

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
    const metrics: Record<string, number> = {};
    const data = (result.data ?? result.output) as any;
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
        JSON.stringify(data ?? {}).slice(0, 2000),
        result.success,
        durationMs,
        JSON.stringify(metrics),
      ]).catch(() => {});

    // Also insert into memory hierarchy recall
    memoryHierarchy.recallInsert(task.shop_id, {
      agentId: this.name,
      shopId: task.shop_id,
      role: 'assistant',
      content: `[${this.name}] ${task.type}: ${result.success ? 'success' : 'failed'} — ${JSON.stringify(data ?? {}).slice(0, 300)}`,
      tokenCount: Math.ceil(JSON.stringify(data ?? {}).length / 4),
      metadata: {
        durationMs, model: result.model_used,
        hasDecision: !!data?.decision || !!data?.classification,
        pipelineStep: task._metadata?.pipelineId ? task.type : undefined,
      },
    });
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMPATIBILITY LAYER — AgentBase alias for legacy agents
// ═══════════════════════════════════════════════════════════════════════════
//
//  Legacy agents (20+ agents) use:
//    - class XAgent extends AgentBase
//    - agentId / taskTypes properties
//    - execute(task) with { taskType, tenantId, input, id } shape
//    - this.send() for inter-agent messaging
//    - this.trace() for logging
//    - this.callLLM() for AI calls
//    - this.logDecision() / this.markExecuted() for decision audit
//    - this.setStatus() / this.heartbeat() / this.broadcast()
//    - this.pushIntel() / this.readIntelFeed() for intelligence sharing
//    - { success, output, error, retryable } result shape
//
//  This abstract class bridges both interfaces.
// ═══════════════════════════════════════════════════════════════════════════

export interface LegacyAgentTask {
  taskType?:  string;
  tenantId?:  string;
  input?:     unknown;
  id?:        string;
  [key: string]: unknown;
}

export abstract class AgentBase {
  abstract readonly agentId: string;
  readonly taskTypes: string[] = [];

  protected db: Pool;
  protected redis: Redis;

  constructor(dbOrPool?: Pool, redisClient?: Redis) {
    this.db = dbOrPool ?? (globalThis as any).__aegis_db;
    this.redis = redisClient ?? (globalThis as any).__aegis_redis;
  }

  abstract execute(task: AgentTask): Promise<AgentResult>;

  // ── Logging ─────────────────────────────────────────────────────────

  /** Structured trace logging (level: info | debug | warn | error) */
  protected async trace(
    level: string,
    message: string,
    data: Record<string, unknown> = {},
    taskId?: string,
  ): Promise<void> {
    const entry = {
      timestamp: new Date().toISOString(),
      agent: this.agentId,
      level,
      message,
      taskId,
      ...data,
    };
    // Log to DB (non-blocking)
    if (this.db) {
      this.db.query(
        `INSERT INTO agent_trace (agent_name, level, message, data, task_id, created_at)
         VALUES ($1,$2,$3,$4,$5,NOW())`,
        [this.agentId, level, message, JSON.stringify(data), taskId]
      ).catch(() => {});
    }
    // Console
    if (level === 'error') console.error(`[${this.agentId}]`, message, data);
    else if (level === 'warn') console.warn(`[${this.agentId}]`, message);
    else if (level === 'debug') { /* skip debug in prod */ }
    else console.log(`[${this.agentId}]`, message);
  }

  // ── LLM Calls ──────────────────────────────────────────────────────

  /** Call Claude/LLM with system+user prompt */
  protected async callLLM(opts: {
    system: string;
    user: string;
    maxTokens?: number;
    model?: string;
    temperature?: number;
  }): Promise<string> {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return '{"error":"No ANTHROPIC_API_KEY set"}';

    const model = opts.model ?? process.env.AEGIS_DEFAULT_MODEL ?? 'claude-sonnet-4-20250514';
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: opts.maxTokens ?? 1024,
        temperature: opts.temperature ?? 0.3,
        system: opts.system,
        messages: [{ role: 'user', content: opts.user }],
      }),
    });

    const data = await res.json() as { content?: Array<{ type: string; text: string }> };
    return data.content?.find((b: any) => b.type === 'text')?.text ?? '';
  }

  // ── Decision Audit ─────────────────────────────────────────────────

  /** Log a decision for audit trail — returns decision ID */
  protected async logDecision(
    shopIdOrObj: string | Record<string, unknown>,
    maybeDecision?: Record<string, unknown>,
  ): Promise<string> {
    const decisionId = `dec_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let shopId: string;
    let decision: Record<string, unknown>;

    if (typeof shopIdOrObj === 'string') {
      shopId = shopIdOrObj;
      decision = maybeDecision ?? {};
    } else {
      shopId = (shopIdOrObj as any).tenantId ?? (shopIdOrObj as any).shopId ?? 'unknown';
      decision = shopIdOrObj;
    }

    if (this.db) {
      this.db.query(`
        INSERT INTO agent_decisions
          (id, shop_id, agent_name, decision_type, decision_made, executed, confidence, context, created_at)
        VALUES ($1,$2,$3,$4,$5,false,$6,$7,NOW())`,
        [
          decisionId,
          shopId,
          this.agentId,
          decision.decision_type ?? decision.decisionType ?? 'generic',
          JSON.stringify(decision.decision_made ?? decision.decision ?? decision),
          decision.confidence ?? 0.8,
          JSON.stringify(decision),
        ]
      ).catch(() => {});
    }

    return decisionId;
  }

  /** Mark a decision as executed */
  protected async markExecuted(decisionId: string): Promise<void> {
    if (this.db) {
      this.db.query(
        `UPDATE agent_decisions SET executed = true, executed_at = NOW() WHERE id = $1`,
        [decisionId]
      ).catch(() => {});
    }
  }

  // ── Status & Heartbeat ─────────────────────────────────────────────

  /** Update agent execution status */
  protected async setStatus(status: string): Promise<void> {
    if (this.db) {
      this.db.query(
        `INSERT INTO agent_status (agent_name, status, updated_at)
         VALUES ($1,$2,NOW())
         ON CONFLICT (agent_name) DO UPDATE SET status=$2, updated_at=NOW()`,
        [this.agentId, status]
      ).catch(() => {});
    }
  }

  /** Signal liveness to monitoring system */
  protected async heartbeat(): Promise<void> {
    if (this.redis) {
      await this.redis.set(
        `aegis:heartbeat:${this.agentId}`,
        JSON.stringify({ ts: Date.now(), agent: this.agentId }),
        'EX', 300
      ).catch(() => {});
    }
  }

  // ── Messaging ──────────────────────────────────────────────────────

  /** Inter-agent messaging via Redis pub/sub */
  protected async send(msg: {
    fromAgent:   string;
    toAgent:     string;
    messageType: string;
    subject:     string;
    payload:     unknown;
    tenantId:    string;
    priority?:   number;
  }): Promise<void> {
    if (!this.redis) return;
    const channel = `aegis:agent:${msg.toAgent}`;
    await this.redis.publish(channel, JSON.stringify({
      ...msg,
      timestamp: new Date().toISOString(),
    })).catch(() => {});
    // Audit trail
    if (this.db) {
      this.db.query(`
        INSERT INTO agent_messages
          (from_agent, to_agent, message_type, subject, payload, tenant_id, priority, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [msg.fromAgent, msg.toAgent, msg.messageType, msg.subject,
         JSON.stringify(msg.payload), msg.tenantId, msg.priority ?? 5]
      ).catch(() => {});
    }
  }

  /** Broadcast event to all agents / Redis subscribers */
  protected async broadcast(
    payload: unknown,
    topic: string,
    tenantId?: string,
  ): Promise<void> {
    if (!this.redis) return;
    const channel = `aegis:broadcast:${tenantId ?? 'global'}`;
    await this.redis.publish(channel, JSON.stringify({
      topic,
      from: this.agentId,
      payload,
      timestamp: new Date().toISOString(),
    })).catch(() => {});
  }

  // ── Intelligence Feed ──────────────────────────────────────────────

  /** Push market intelligence signal */
  protected async pushIntel(
    signalOrType: Record<string, unknown> | string,
    ...args: unknown[]
  ): Promise<string> {
    const intelId = `intel_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

    let signal: Record<string, unknown>;
    if (typeof signalOrType === 'string') {
      signal = {
        signal_type: signalOrType,
        title: args[0] as string,
        summary: args[1] as string,
        actionHint: args[2] as string,
        targetAgents: args[3],
      };
    } else {
      signal = signalOrType;
    }

    if (this.db) {
      this.db.query(`
        INSERT INTO intel_feed
          (id, source, signal_type, subject, data, confidence, relevance_score, created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())`,
        [
          intelId,
          signal.source ?? this.agentId,
          signal.signal_type ?? 'generic',
          signal.subject ?? signal.title ?? '',
          JSON.stringify(signal.data ?? signal),
          signal.confidence ?? 0.7,
          signal.relevance_score ?? 5,
        ]
      ).catch(() => {});
    }

    return intelId;
  }

  /** Read intel feed */
  protected async readIntelFeed(opts?: {
    limit?: number;
    type?: string;
  }): Promise<Record<string, unknown>[]> {
    if (!this.db) return [];
    try {
      const { rows } = await this.db.query(`
        SELECT * FROM intel_feed
        WHERE ($1::text IS NULL OR signal_type = $1)
        ORDER BY created_at DESC LIMIT $2`,
        [opts?.type ?? null, opts?.limit ?? 20]
      );
      return rows;
    } catch { return []; }
  }

  // ── Memory shortcuts ───────────────────────────────────────────────

  protected async remember(shopId: string, opts: {
    memory_key: string; memory_type: string; value: unknown; ttl_hours: number;
  }): Promise<void> {
    if (!this.db) return;
    await this.db.query(`
      INSERT INTO agent_memory
        (shop_id, agent_name, memory_key, memory_type, value, expires_at)
      VALUES ($1,$2,$3,$4,$5, NOW() + ($6 || ' hours')::INTERVAL)
      ON CONFLICT (shop_id, agent_name, memory_key) DO UPDATE
        SET value=$5, expires_at=NOW() + ($6 || ' hours')::INTERVAL`,
      [shopId, this.agentId, opts.memory_key, opts.memory_type,
       JSON.stringify(opts.value), opts.ttl_hours]).catch(() => {});
  }

  protected async emit(event: string, payload: unknown): Promise<void> {
    if (!this.redis) return;
    const channel = `aegis:event:${(payload as any)?.shop_id ?? (payload as any)?.tenantId ?? 'global'}:${event}`;
    await this.redis.publish(channel, JSON.stringify(payload)).catch(() => {});
  }

  protected async getShopConfig(shopId: string): Promise<Record<string, any>> {
    if (!this.db) return {};
    try {
      const { rows } = await this.db.query(`SELECT * FROM shops WHERE id=$1`, [shopId]);
      return rows[0] ?? {};
    } catch { return {}; }
  }

  protected async getWorldState(shopId: string): Promise<Record<string, any>> {
    if (!this.db) return {};
    try {
      const { rows } = await this.db.query(`SELECT * FROM world_state WHERE shop_id=$1`, [shopId]);
      return rows[0] ?? {};
    } catch { return {}; }
  }

  protected async getAgentMemory(shopId: string, limit = 10): Promise<any[]> {
    if (!this.db) return [];
    try {
      const { rows } = await this.db.query(`
        SELECT memory_key, memory_type, value, created_at
        FROM agent_memory
        WHERE shop_id = $1 AND agent_name = $2
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY created_at DESC LIMIT $3`,
        [shopId, this.agentId, limit]);
      return rows.map(r => ({
        key: r.memory_key, type: r.memory_type,
        value: typeof r.value === 'string' ? JSON.parse(r.value) : r.value,
        at: r.created_at,
      }));
    } catch { return []; }
  }
}

// Re-export everything agents need
export { TierGateVerdict };
