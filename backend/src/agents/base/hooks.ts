/**
 * Hook System — Pre/Post/OnError/OnActivation lifecycle
 * ======================================================
 * Sources: Everything Claude Code, Infrastructure Showcase, OneRedOak Workflows
 *
 * Hooks intercept agent execution at 4 lifecycle points:
 *   preExecute  — Before agent runs (validation, budget check, compliance)
 *   postExecute — After agent succeeds (logging, learning, trigger next)
 *   onError     — When agent fails (retry, circuit breaker, alert)
 *   onActivation — Auto-activation rules (skill-rules.json pattern)
 *
 * Enforcement levels:
 *   suggest — Log recommendation, don't block
 *   block   — Prevent execution if hook fails
 *   auto    — Execute action automatically
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type HookEvent = 'preExecute' | 'postExecute' | 'onError' | 'onActivation';
export type EnforcementLevel = 'suggest' | 'block' | 'auto';

export interface HookContext {
  agentName:    string;
  shopId:       string;
  tier:         number;
  task:         unknown;
  result?:      unknown;
  error?:       Error;
  pipelineId?:  string;
  stepIndex?:   number;
  metadata?:    Record<string, unknown>;
}

export interface HookResult {
  allow:      boolean;
  feedback?:  string;
  action?:    string;
  data?:      unknown;
}

export interface Hook {
  name:         string;
  event:        HookEvent;
  enforcement:  EnforcementLevel;
  priority:     number;   // Lower = runs first
  condition?:   (ctx: HookContext) => boolean;
  handler:      (ctx: HookContext) => Promise<HookResult>;
}

export interface ActivationRule {
  name:          string;
  description:   string;
  triggerAgent:  string;
  condition:     (ctx: HookContext) => boolean;
  action:        string;
  targetAgent?:  string;
  enforcement:   EnforcementLevel;
}

// ── Hook Engine ───────────────────────────────────────────────────────────

class HookEngine {
  private hooks: Map<HookEvent, Hook[]> = new Map();
  private activationRules: ActivationRule[] = [];

  constructor() {
    this.hooks.set('preExecute', []);
    this.hooks.set('postExecute', []);
    this.hooks.set('onError', []);
    this.hooks.set('onActivation', []);
    this.registerBuiltInHooks();
    this.registerBuiltInActivationRules();
  }

  // ── Register / Unregister ───────────────────────────────────────────

  register(hook: Hook): void {
    const list = this.hooks.get(hook.event) || [];
    list.push(hook);
    list.sort((a, b) => a.priority - b.priority);
    this.hooks.set(hook.event, list);
  }

  unregister(hookName: string, event: HookEvent): void {
    const list = this.hooks.get(event) || [];
    this.hooks.set(event, list.filter(h => h.name !== hookName));
  }

  registerActivationRule(rule: ActivationRule): void {
    this.activationRules.push(rule);
  }

  // ── Execute Hooks ───────────────────────────────────────────────────

  async execute(event: HookEvent, ctx: HookContext): Promise<HookResult> {
    const hooks = this.hooks.get(event) || [];
    let combinedFeedback: string[] = [];

    for (const hook of hooks) {
      // Check condition
      if (hook.condition && !hook.condition(ctx)) continue;

      try {
        const result = await hook.handler(ctx);

        if (result.feedback) {
          combinedFeedback.push(`[${hook.name}] ${result.feedback}`);
        }

        // Block enforcement: stop if hook denies
        if (hook.enforcement === 'block' && !result.allow) {
          return {
            allow: false,
            feedback: combinedFeedback.join(' | '),
            action: result.action || 'blocked',
            data: result.data,
          };
        }

        // Auto enforcement: execute action automatically
        if (hook.enforcement === 'auto' && result.action) {
          combinedFeedback.push(`[AUTO] ${result.action}`);
        }
      } catch (err) {
        combinedFeedback.push(`[${hook.name}] Hook error: ${(err as Error).message}`);
      }
    }

    return {
      allow: true,
      feedback: combinedFeedback.length > 0 ? combinedFeedback.join(' | ') : undefined,
    };
  }

  // ── Check Activation Rules ──────────────────────────────────────────

  async checkActivationRules(ctx: HookContext): Promise<{ triggered: ActivationRule[]; actions: string[] }> {
    const triggered: ActivationRule[] = [];
    const actions: string[] = [];

    for (const rule of this.activationRules) {
      // Match on the agent that just ran
      if (rule.triggerAgent !== '*' && rule.triggerAgent !== ctx.agentName) continue;

      try {
        if (rule.condition(ctx)) {
          triggered.push(rule);
          actions.push(rule.action);
        }
      } catch {
        // Silently skip failed conditions
      }
    }

    return { triggered, actions };
  }

  // ── Built-in Hooks ──────────────────────────────────────────────────

  private registerBuiltInHooks(): void {
    // 1. Budget check — block if daily budget exceeded
    this.register({
      name: 'budget-check',
      event: 'preExecute',
      enforcement: 'block',
      priority: 10,
      handler: async (ctx) => {
        // Budget is checked via metadata injected by the pipeline
        const meta = ctx.metadata || {};
        const dailySpent = (meta.dailyLlmSpent as number) || 0;
        const dailyLimit = (meta.dailyLlmLimit as number) || Infinity;

        if (dailySpent >= dailyLimit) {
          return {
            allow: false,
            feedback: `Budget exceeded: ${dailySpent.toFixed(2)}€ / ${dailyLimit.toFixed(2)}€ limit`,
            action: 'budget_block',
          };
        }

        return {
          allow: true,
          feedback: dailyLimit < Infinity
            ? `Budget: ${dailySpent.toFixed(2)}€ / ${dailyLimit.toFixed(2)}€`
            : undefined,
        };
      },
    });

    // 2. Execution timer — measure and log duration
    this.register({
      name: 'execution-timer',
      event: 'postExecute',
      enforcement: 'suggest',
      priority: 90,
      handler: async (ctx) => {
        const duration = (ctx.metadata?.duration_ms as number) || 0;
        if (duration > 30000) {
          return {
            allow: true,
            feedback: `Slow execution: ${(duration / 1000).toFixed(1)}s — consider model downgrade`,
            action: 'slow_warning',
          };
        }
        return { allow: true };
      },
    });

    // 3. Error retry advisor — suggest retry on transient errors
    this.register({
      name: 'error-retry',
      event: 'onError',
      enforcement: 'auto',
      priority: 10,
      handler: async (ctx) => {
        const errMsg = ctx.error?.message || '';
        const isTransient = /timeout|ECONNRESET|429|503|rate.limit/i.test(errMsg);

        if (isTransient) {
          return {
            allow: true,
            feedback: 'Transient error detected — auto-retry recommended',
            action: 'retry',
          };
        }

        return {
          allow: true,
          feedback: `Permanent error: ${errMsg.slice(0, 100)}`,
          action: 'alert',
        };
      },
    });

    // 4. Compliance check — ensure required fields before pipeline steps
    this.register({
      name: 'compliance-check',
      event: 'preExecute',
      enforcement: 'block',
      priority: 20,
      handler: async (ctx) => {
        const task = ctx.task as Record<string, unknown>;

        // Pipeline steps require shop_id
        if (!task?.shop_id) {
          return {
            allow: false,
            feedback: 'Missing shop_id — cannot execute pipeline step',
          };
        }

        return { allow: true };
      },
    });

    // 5. Post-execution learning trigger
    this.register({
      name: 'learning-trigger',
      event: 'postExecute',
      enforcement: 'auto',
      priority: 50,
      handler: async (ctx) => {
        const result = ctx.result as Record<string, unknown>;
        const success = result?.success;

        return {
          allow: true,
          action: success ? 'record_success' : 'record_failure',
          feedback: success
            ? 'Recording successful execution pattern'
            : 'Recording failure for future avoidance',
        };
      },
    });
  }

  // ── Built-in Activation Rules ───────────────────────────────────────

  private registerBuiltInActivationRules(): void {
    // 1. Auto-protect on ROAS drop
    this.registerActivationRule({
      name: 'auto-protect-roas-drop',
      description: 'Activate budget protector when ROAS drops below 1.5',
      triggerAgent: 'AGENT_RESULTS_48H',
      condition: (ctx) => {
        const result = ctx.result as Record<string, unknown>;
        const data = result?.data as Record<string, unknown>;
        const roas = (data?.roas as number) || 0;
        return roas < 1.5 && roas > 0;
      },
      action: 'ACTIVATE:AGENT_BUDGET_PROTECTOR',
      targetAgent: 'AGENT_BUDGET_PROTECTOR',
      enforcement: 'auto',
    });

    // 2. Auto-analyze after results
    this.registerActivationRule({
      name: 'auto-analyze-after-results',
      description: 'Trigger deep analysis after 48h results',
      triggerAgent: 'AGENT_RESULTS_48H',
      condition: (ctx) => {
        const result = ctx.result as Record<string, unknown>;
        return result?.success === true;
      },
      action: 'ACTIVATE:AGENT_DEEP_ANALYZER',
      targetAgent: 'AGENT_DEEP_ANALYZER',
      enforcement: 'auto',
    });

    // 3. Auto-scale on CONDOR classification
    this.registerActivationRule({
      name: 'auto-scale-condor',
      description: 'Auto-scale winning creatives classified as CONDOR',
      triggerAgent: 'AGENT_RESULTS_48H',
      condition: (ctx) => {
        const result = ctx.result as Record<string, unknown>;
        const data = result?.data as Record<string, unknown>;
        const classification = data?.classification as string;
        return classification === 'CONDOR';
      },
      action: 'ACTIVATE:AGENT_SCALER',
      targetAgent: 'AGENT_SCALER',
      enforcement: 'auto',
    });

    // 4. Auto-kill DEAD creatives
    this.registerActivationRule({
      name: 'auto-kill-dead',
      description: 'Auto-kill creatives classified as DEAD',
      triggerAgent: 'AGENT_RESULTS_48H',
      condition: (ctx) => {
        const result = ctx.result as Record<string, unknown>;
        const data = result?.data as Record<string, unknown>;
        const classification = data?.classification as string;
        return classification === 'DEAD';
      },
      action: 'ACTIVATE:AGENT_BUDGET_PROTECTOR',
      targetAgent: 'AGENT_BUDGET_PROTECTOR',
      enforcement: 'auto',
    });

    // 5. Creative refresh on fatigue detection
    this.registerActivationRule({
      name: 'auto-refresh-fatigue',
      description: 'Trigger creative refresh when fatigue detected',
      triggerAgent: 'AGENT_CAMPAIGN_MONITOR',
      condition: (ctx) => {
        const result = ctx.result as Record<string, unknown>;
        const data = result?.data as Record<string, unknown>;
        const fatigue = (data?.fatigueScore as number) || 0;
        return fatigue > 0.7;
      },
      action: 'ACTIVATE:AGENT_COPY_CHIEF',
      targetAgent: 'AGENT_COPY_CHIEF',
      enforcement: 'suggest',
    });
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const hookEngine = new HookEngine();
