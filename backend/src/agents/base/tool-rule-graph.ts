/**
 * Tool Rule Graph — Declarative DAG constraints on tool execution
 * ==================================================================
 * Source: letta-ai/letta (ToolRulesSolver),
 *         letta docs (tool-rules guide)
 *
 * Constrains tool execution order using four rule types:
 *   InitToolRule     — Must be called first
 *   TerminalToolRule — Ends execution after call
 *   ChildToolRule    — Tool X must be followed by one of [Y, Z]
 *   ParentToolRule   — Tool Y requires tool X to have been called first
 *
 * Use cases in AEGIS:
 *   - Ensure product analysis always runs before copy generation
 *   - Ensure generated copy always goes through compliance review
 *   - Ensure budget changes require approval before execution
 *   - Ensure store deployment is always the final action
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type ToolRuleType = 'init' | 'terminal' | 'child' | 'parent';

export interface ToolRule {
  type:       ToolRuleType;
  toolName:   string;
  children?:  string[];         // For 'child' rule: allowed next tools
  parent?:    string;           // For 'parent' rule: required prerequisite
  description?: string;
}

export interface ToolRuleSet {
  id:          string;
  name:        string;
  description: string;
  rules:       ToolRule[];
  agentId?:    string;          // If specific to an agent
  enabled:     boolean;
}

export interface ToolValidation {
  allowed:     boolean;
  validTools:  string[];        // Currently allowed tools
  reason?:     string;
  violations:  string[];
}

// ── Built-in Rule Sets ────────────────────────────────────────────────────

const BUILT_IN_RULESETS: ToolRuleSet[] = [
  // Pipeline execution order
  {
    id: 'pipeline_order',
    name: 'Pipeline Execution Order',
    description: 'Enforce pipeline step dependencies',
    enabled: true,
    rules: [
      { type: 'init', toolName: 'analyze_product', description: 'Always start with product analysis' },
      { type: 'child', toolName: 'analyze_product', children: ['research_market', 'build_offer'] },
      { type: 'child', toolName: 'research_market', children: ['build_offer', 'analyze_audience'] },
      { type: 'child', toolName: 'build_offer', children: ['generate_copy', 'review_offer'] },
      { type: 'child', toolName: 'generate_copy', children: ['review_copy', 'score_copy'] },
      { type: 'child', toolName: 'review_copy', children: ['build_store', 'generate_copy'] },
      { type: 'child', toolName: 'build_store', children: ['deploy_store', 'review_store'] },
      { type: 'child', toolName: 'review_store', children: ['deploy_store', 'build_store'] },
      { type: 'child', toolName: 'deploy_store', children: ['create_ads', 'launch_campaign'] },
      { type: 'terminal', toolName: 'launch_campaign', description: 'Campaign launch ends pipeline' },
    ],
  },

  // Copy generation workflow
  {
    id: 'copy_workflow',
    name: 'Copy Generation Workflow',
    description: 'Ensure copy goes through proper review',
    agentId: 'AGENT_COPY_CHIEF',
    enabled: true,
    rules: [
      { type: 'init', toolName: 'analyze_brief' },
      { type: 'child', toolName: 'analyze_brief', children: ['generate_hooks', 'research_angles'] },
      { type: 'child', toolName: 'generate_hooks', children: ['generate_headlines', 'generate_descriptions'] },
      { type: 'child', toolName: 'generate_headlines', children: ['compliance_check', 'score_headlines'] },
      { type: 'parent', toolName: 'finalize_copy', parent: 'compliance_check', description: 'Must pass compliance before finalizing' },
      { type: 'terminal', toolName: 'finalize_copy' },
    ],
  },

  // Budget operations safety
  {
    id: 'budget_safety',
    name: 'Budget Operations Safety',
    description: 'Ensure budget changes follow safety protocol',
    agentId: 'AGENT_BUDGET_OPTIMIZER',
    enabled: true,
    rules: [
      { type: 'init', toolName: 'fetch_current_metrics' },
      { type: 'child', toolName: 'fetch_current_metrics', children: ['analyze_roas', 'check_spend_limit'] },
      { type: 'parent', toolName: 'adjust_budget', parent: 'analyze_roas', description: 'Must analyze ROAS before adjusting budget' },
      { type: 'parent', toolName: 'adjust_budget', parent: 'check_spend_limit', description: 'Must check spend limits' },
      { type: 'child', toolName: 'adjust_budget', children: ['verify_change', 'log_adjustment'] },
      { type: 'terminal', toolName: 'log_adjustment' },
    ],
  },

  // Kill campaign safety
  {
    id: 'kill_safety',
    name: 'Campaign Kill Safety',
    description: 'Require verification before killing campaigns',
    agentId: 'AGENT_BUDGET_PROTECTOR',
    enabled: true,
    rules: [
      { type: 'init', toolName: 'check_campaign_status' },
      { type: 'parent', toolName: 'kill_campaign', parent: 'check_campaign_status' },
      { type: 'parent', toolName: 'kill_campaign', parent: 'verify_roas_below_threshold' },
      { type: 'child', toolName: 'kill_campaign', children: ['notify_merchant', 'log_kill_reason'] },
      { type: 'terminal', toolName: 'log_kill_reason' },
    ],
  },
];

// ── Tool Rule Graph Engine ────────────────────────────────────────────────

class ToolRuleGraphEngine {
  private ruleSets: Map<string, ToolRuleSet> = new Map();
  private executionState: Map<string, {
    calledTools:  string[];
    lastTool?:    string;
    completed:    boolean;
  }> = new Map();

  constructor() {
    for (const ruleSet of BUILT_IN_RULESETS) {
      this.ruleSets.set(ruleSet.id, ruleSet);
    }
  }

  // ── Start new execution ─────────────────────────────────────────────

  startExecution(executionId: string): void {
    this.executionState.set(executionId, {
      calledTools: [],
      completed: false,
    });
  }

  // ── Validate tool call ──────────────────────────────────────────────

  validateTool(executionId: string, toolName: string, agentId?: string): ToolValidation {
    const state = this.executionState.get(executionId);
    if (!state) {
      return { allowed: true, validTools: [], violations: [] };
    }

    if (state.completed) {
      return {
        allowed: false,
        validTools: [],
        reason: 'Execution already completed (terminal tool was called)',
        violations: ['Execution completed'],
      };
    }

    const applicableRules = this.getApplicableRules(agentId);
    const violations: string[] = [];
    const validTools = this.getValidTools(state, applicableRules);

    // Check init rules
    if (state.calledTools.length === 0) {
      const initRules = applicableRules.filter(r => r.type === 'init');
      if (initRules.length > 0) {
        const initTools = initRules.map(r => r.toolName);
        if (!initTools.includes(toolName)) {
          violations.push(`Must call one of [${initTools.join(', ')}] first`);
        }
      }
    }

    // Check parent rules
    const parentRules = applicableRules.filter(r => r.type === 'parent' && r.toolName === toolName);
    for (const rule of parentRules) {
      if (rule.parent && !state.calledTools.includes(rule.parent)) {
        violations.push(`${toolName} requires ${rule.parent} to be called first${rule.description ? ` (${rule.description})` : ''}`);
      }
    }

    // Check child rules (is this tool an allowed child of the last tool?)
    if (state.lastTool) {
      const childRules = applicableRules.filter(r => r.type === 'child' && r.toolName === state.lastTool);
      if (childRules.length > 0) {
        const allowedChildren = childRules.flatMap(r => r.children || []);
        if (allowedChildren.length > 0 && !allowedChildren.includes(toolName)) {
          violations.push(`After ${state.lastTool}, must call one of [${allowedChildren.join(', ')}]`);
        }
      }
    }

    const allowed = violations.length === 0;

    return {
      allowed,
      validTools,
      reason: violations.length > 0 ? violations[0] : undefined,
      violations,
    };
  }

  // ── Record tool call ────────────────────────────────────────────────

  recordToolCall(executionId: string, toolName: string, agentId?: string): void {
    const state = this.executionState.get(executionId);
    if (!state) return;

    state.calledTools.push(toolName);
    state.lastTool = toolName;

    // Check if terminal
    const applicableRules = this.getApplicableRules(agentId);
    const isTerminal = applicableRules.some(r => r.type === 'terminal' && r.toolName === toolName);
    if (isTerminal) {
      state.completed = true;
    }
  }

  // ── Get valid tools ─────────────────────────────────────────────────

  private getValidTools(
    state: { calledTools: string[]; lastTool?: string; completed: boolean },
    rules: ToolRule[]
  ): string[] {
    if (state.completed) return [];

    const valid = new Set<string>();

    // If first call, only init tools
    if (state.calledTools.length === 0) {
      const initRules = rules.filter(r => r.type === 'init');
      if (initRules.length > 0) {
        return initRules.map(r => r.toolName);
      }
    }

    // Check child rules for last tool
    if (state.lastTool) {
      const childRules = rules.filter(r => r.type === 'child' && r.toolName === state.lastTool);
      for (const rule of childRules) {
        for (const child of rule.children || []) {
          valid.add(child);
        }
      }
    }

    // If no child rules applied, collect all tools that have satisfied parents
    if (valid.size === 0) {
      const allToolNames = new Set(rules.map(r => r.toolName));
      for (const toolName of allToolNames) {
        const parentRules = rules.filter(r => r.type === 'parent' && r.toolName === toolName);
        const parentsSatisfied = parentRules.every(r =>
          !r.parent || state.calledTools.includes(r.parent)
        );
        if (parentsSatisfied) {
          valid.add(toolName);
        }
      }
    }

    return Array.from(valid);
  }

  // ── Get applicable rules ────────────────────────────────────────────

  private getApplicableRules(agentId?: string): ToolRule[] {
    const rules: ToolRule[] = [];
    for (const ruleSet of this.ruleSets.values()) {
      if (!ruleSet.enabled) continue;
      if (ruleSet.agentId && agentId && ruleSet.agentId !== agentId) continue;
      if (!ruleSet.agentId || ruleSet.agentId === agentId) {
        rules.push(...ruleSet.rules);
      }
    }
    return rules;
  }

  // ── Rule set management ─────────────────────────────────────────────

  addRuleSet(ruleSet: ToolRuleSet): void {
    this.ruleSets.set(ruleSet.id, ruleSet);
  }

  removeRuleSet(ruleSetId: string): void {
    this.ruleSets.delete(ruleSetId);
  }

  enableRuleSet(ruleSetId: string): void {
    const rs = this.ruleSets.get(ruleSetId);
    if (rs) rs.enabled = true;
  }

  disableRuleSet(ruleSetId: string): void {
    const rs = this.ruleSets.get(ruleSetId);
    if (rs) rs.enabled = false;
  }

  listRuleSets(): ToolRuleSet[] {
    return Array.from(this.ruleSets.values());
  }

  // ── Cleanup ─────────────────────────────────────────────────────────

  endExecution(executionId: string): void {
    this.executionState.delete(executionId);
  }

  getExecutionState(executionId: string): {
    calledTools: string[];
    lastTool?: string;
    completed: boolean;
  } | undefined {
    return this.executionState.get(executionId);
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const toolRuleGraph = new ToolRuleGraphEngine();
