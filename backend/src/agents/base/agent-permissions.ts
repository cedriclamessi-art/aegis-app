/**
 * Agent Permissions — Fine-grained access control per agent
 * ============================================================
 * Sources: lst97/claude-code-subagents, Jeffallan/claude-skills,
 *          jeremylongshore/claude-code-plugins-plus-skills,
 *          0xfurai/claude-code-subagents
 *
 * Controls what each agent can do:
 *   - Tool access (which tools an agent can use)
 *   - Data access (which shops/campaigns it can read/write)
 *   - Action approval (which actions need human approval)
 *   - Budget limits (how much it can spend)
 *   - API access (which external APIs it can call)
 *
 * Permission levels:
 *   allow  — Can do without asking
 *   ask    — Requires human-in-the-loop approval
 *   deny   — Cannot do, blocked
 *
 * Human-in-the-loop gates:
 *   - Budget > threshold → approval required
 *   - Campaign kill → approval required (tier 1-2)
 *   - Scale > 200% → approval required
 *   - External API calls → logged
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type PermissionLevel = 'allow' | 'ask' | 'deny';

export interface Permission {
  action:     string;         // e.g., 'kill_campaign', 'scale_budget', 'call_api'
  level:      PermissionLevel;
  conditions?: PermissionCondition[];
  reason?:    string;
}

export interface PermissionCondition {
  field:     string;          // e.g., 'budget', 'roas', 'tier'
  operator:  '>' | '<' | '>=' | '<=' | '==' | '!=';
  value:     number | string | boolean;
}

export interface AgentPermissionSet {
  agentId:       string;
  tools:         Record<string, PermissionLevel>;     // tool_name -> level
  actions:       Permission[];
  dataAccess:    DataAccessRule[];
  budgetLimit:   number;          // Max spend per execution (USD)
  canKill:       boolean;         // Can kill campaigns
  canScale:      boolean;         // Can scale budgets
  canCreateAds:  boolean;         // Can create new ads
  canModifyStore: boolean;        // Can modify store pages
  needsApproval: string[];        // Actions requiring human approval
  tier:          number;          // Agent's minimum tier requirement
}

export interface DataAccessRule {
  resource:    string;           // 'shops', 'campaigns', 'creatives', etc.
  access:      'read' | 'write' | 'none';
  scope:       'own' | 'all';    // own = only agent's assigned shop
}

export interface ApprovalRequest {
  id:           string;
  agentId:      string;
  shopId?:      string;
  action:       string;
  description:  string;
  data:         Record<string, unknown>;
  status:       'pending' | 'approved' | 'denied' | 'expired';
  requestedAt:  Date;
  resolvedAt?:  Date;
  resolvedBy?:  string;
  expiresAt:    Date;
}

// ── Default Permission Sets ───────────────────────────────────────────────

const DEFAULT_PERMISSIONS: Record<string, Partial<AgentPermissionSet>> = {
  // Read-only agents
  'AGENT_PRODUCT_INGEST': {
    canKill: false,
    canScale: false,
    canCreateAds: false,
    canModifyStore: false,
    budgetLimit: 0,
    tools: {
      'web_scraper': 'allow',
      'image_analyzer': 'allow',
      'price_extractor': 'allow',
      'db_write': 'deny',
      'api_call': 'ask',
    },
    needsApproval: [],
  },
  'AGENT_SPY': {
    canKill: false,
    canScale: false,
    canCreateAds: false,
    canModifyStore: false,
    budgetLimit: 0,
    tools: {
      'web_scraper': 'allow',
      'search_engine': 'allow',
      'db_write': 'deny',
    },
    needsApproval: [],
  },

  // Write agents (need more restrictions)
  'AGENT_STORE_BUILDER': {
    canKill: false,
    canScale: false,
    canCreateAds: false,
    canModifyStore: true,
    budgetLimit: 0,
    tools: {
      'html_generator': 'allow',
      'css_generator': 'allow',
      'image_optimizer': 'allow',
      'deploy_store': 'ask',        // Needs approval to deploy
    },
    needsApproval: ['deploy_store', 'modify_live_page'],
  },

  // Budget agents (highest risk)
  'AGENT_BUDGET_OPTIMIZER': {
    canKill: false,
    canScale: true,
    canCreateAds: false,
    canModifyStore: false,
    budgetLimit: 500,
    tools: {
      'adjust_budget': 'allow',
      'api_call': 'allow',
    },
    actions: [
      {
        action: 'scale_budget',
        level: 'allow',
        conditions: [
          { field: 'increase_percent', operator: '<=', value: 30 },
        ],
      },
      {
        action: 'scale_budget',
        level: 'ask',
        conditions: [
          { field: 'increase_percent', operator: '>', value: 30 },
        ],
        reason: 'Budget increase > 30% requires approval',
      },
    ],
    needsApproval: ['scale_budget_large', 'emergency_budget'],
  },

  // Kill agents (very high risk)
  'AGENT_BUDGET_PROTECTOR': {
    canKill: true,
    canScale: false,
    canCreateAds: false,
    canModifyStore: false,
    budgetLimit: 0,
    tools: {
      'kill_campaign': 'allow',
      'pause_campaign': 'allow',
      'alert_user': 'allow',
    },
    actions: [
      {
        action: 'kill_campaign',
        level: 'allow',
        conditions: [
          { field: 'roas', operator: '<', value: 0.5 },
        ],
      },
      {
        action: 'kill_campaign',
        level: 'ask',
        conditions: [
          { field: 'roas', operator: '>=', value: 0.5 },
        ],
        reason: 'Campaign has some revenue — confirm kill',
      },
    ],
    needsApproval: ['kill_campaign_profitable'],
  },

  // Ad agents
  'AGENT_AD_LAUNCHER': {
    canKill: false,
    canScale: false,
    canCreateAds: true,
    canModifyStore: false,
    budgetLimit: 100,
    tools: {
      'create_ad': 'allow',
      'api_call': 'allow',
      'set_budget': 'ask',
    },
    needsApproval: ['launch_campaign', 'set_initial_budget'],
  },

  // Copy agents (lower risk)
  'AGENT_COPY_CHIEF': {
    canKill: false,
    canScale: false,
    canCreateAds: false,
    canModifyStore: false,
    budgetLimit: 0,
    tools: {
      'text_generator': 'allow',
      'compliance_check': 'allow',
    },
    needsApproval: [],
  },
};

// ── Agent Permissions Engine ──────────────────────────────────────────────

class AgentPermissionsEngine {
  private permissions: Map<string, AgentPermissionSet> = new Map();
  private approvalQueue: Map<string, ApprovalRequest> = new Map();
  private approvalCallbacks: Map<string, (approved: boolean) => void> = new Map();

  constructor() {
    // Load defaults
    for (const [agentId, perms] of Object.entries(DEFAULT_PERMISSIONS)) {
      this.permissions.set(agentId, {
        agentId,
        tools: {},
        actions: [],
        dataAccess: [],
        budgetLimit: 0,
        canKill: false,
        canScale: false,
        canCreateAds: false,
        canModifyStore: false,
        needsApproval: [],
        tier: 1,
        ...perms,
      });
    }
  }

  // ── Check permission ────────────────────────────────────────────────

  check(agentId: string, action: string, context?: Record<string, unknown>): {
    allowed:       boolean;
    level:         PermissionLevel;
    requiresApproval: boolean;
    reason?:       string;
  } {
    const perms = this.permissions.get(agentId);

    // No permissions defined = allow by default (with logging)
    if (!perms) {
      return { allowed: true, level: 'allow', requiresApproval: false };
    }

    // Check tool permissions
    if (perms.tools[action]) {
      const level = perms.tools[action];
      return {
        allowed: level !== 'deny',
        level,
        requiresApproval: level === 'ask',
        reason: level === 'deny' ? `Tool ${action} denied for ${agentId}` : undefined,
      };
    }

    // Check action permissions with conditions
    for (const perm of perms.actions) {
      if (perm.action !== action) continue;

      // Check conditions
      if (perm.conditions && context) {
        const allConditionsMet = perm.conditions.every(cond => {
          const fieldValue = context[cond.field];
          if (fieldValue === undefined) return false;

          switch (cond.operator) {
            case '>': return Number(fieldValue) > Number(cond.value);
            case '<': return Number(fieldValue) < Number(cond.value);
            case '>=': return Number(fieldValue) >= Number(cond.value);
            case '<=': return Number(fieldValue) <= Number(cond.value);
            case '==': return fieldValue === cond.value;
            case '!=': return fieldValue !== cond.value;
            default: return false;
          }
        });

        if (allConditionsMet) {
          return {
            allowed: perm.level !== 'deny',
            level: perm.level,
            requiresApproval: perm.level === 'ask',
            reason: perm.reason,
          };
        }
      } else if (!perm.conditions) {
        return {
          allowed: perm.level !== 'deny',
          level: perm.level,
          requiresApproval: perm.level === 'ask',
          reason: perm.reason,
        };
      }
    }

    // Check needsApproval list
    if (perms.needsApproval.includes(action)) {
      return {
        allowed: true,
        level: 'ask',
        requiresApproval: true,
        reason: `Action ${action} requires human approval`,
      };
    }

    // Default: allow
    return { allowed: true, level: 'allow', requiresApproval: false };
  }

  // ── Request approval ────────────────────────────────────────────────

  requestApproval(params: {
    agentId:     string;
    shopId?:     string;
    action:      string;
    description: string;
    data:        Record<string, unknown>;
    ttlMs?:      number;
  }): ApprovalRequest {
    const request: ApprovalRequest = {
      id: `approval_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      agentId: params.agentId,
      shopId: params.shopId,
      action: params.action,
      description: params.description,
      data: params.data,
      status: 'pending',
      requestedAt: new Date(),
      expiresAt: new Date(Date.now() + (params.ttlMs || 3600000)), // 1h default
    };

    this.approvalQueue.set(request.id, request);
    return request;
  }

  // ── Resolve approval ────────────────────────────────────────────────

  resolveApproval(requestId: string, approved: boolean, resolvedBy: string): boolean {
    const request = this.approvalQueue.get(requestId);
    if (!request || request.status !== 'pending') return false;

    request.status = approved ? 'approved' : 'denied';
    request.resolvedAt = new Date();
    request.resolvedBy = resolvedBy;

    // Notify callback
    const callback = this.approvalCallbacks.get(requestId);
    if (callback) {
      callback(approved);
      this.approvalCallbacks.delete(requestId);
    }

    return true;
  }

  // ── Wait for approval ───────────────────────────────────────────────

  waitForApproval(requestId: string): Promise<boolean> {
    const request = this.approvalQueue.get(requestId);
    if (!request) return Promise.resolve(false);

    if (request.status === 'approved') return Promise.resolve(true);
    if (request.status === 'denied') return Promise.resolve(false);

    return new Promise((resolve) => {
      this.approvalCallbacks.set(requestId, resolve);

      // Auto-expire
      const timeout = request.expiresAt.getTime() - Date.now();
      setTimeout(() => {
        if (request.status === 'pending') {
          request.status = 'expired';
          resolve(false);
          this.approvalCallbacks.delete(requestId);
        }
      }, Math.max(timeout, 0));
    });
  }

  // ── Get pending approvals ───────────────────────────────────────────

  getPendingApprovals(shopId?: string): ApprovalRequest[] {
    return Array.from(this.approvalQueue.values())
      .filter(r => r.status === 'pending')
      .filter(r => !shopId || r.shopId === shopId)
      .sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  }

  // ── Set permissions ─────────────────────────────────────────────────

  setPermissions(agentId: string, perms: Partial<AgentPermissionSet>): void {
    const existing = this.permissions.get(agentId) || {
      agentId,
      tools: {},
      actions: [],
      dataAccess: [],
      budgetLimit: 0,
      canKill: false,
      canScale: false,
      canCreateAds: false,
      canModifyStore: false,
      needsApproval: [],
      tier: 1,
    };
    this.permissions.set(agentId, { ...existing, ...perms });
  }

  // ── Get permissions ─────────────────────────────────────────────────

  getPermissions(agentId: string): AgentPermissionSet | undefined {
    return this.permissions.get(agentId);
  }

  // ── Budget check ────────────────────────────────────────────────────

  checkBudget(agentId: string, amount: number): {
    allowed: boolean;
    limit: number;
    reason?: string;
  } {
    const perms = this.permissions.get(agentId);
    if (!perms) return { allowed: true, limit: Infinity };

    if (perms.budgetLimit === 0) {
      return { allowed: true, limit: 0 };
    }

    if (amount > perms.budgetLimit) {
      return {
        allowed: false,
        limit: perms.budgetLimit,
        reason: `Budget ${amount}€ exceeds ${agentId} limit of ${perms.budgetLimit}€`,
      };
    }

    return { allowed: true, limit: perms.budgetLimit };
  }

  // ── List all ────────────────────────────────────────────────────────

  listAll(): AgentPermissionSet[] {
    return Array.from(this.permissions.values());
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const agentPermissions = new AgentPermissionsEngine();
