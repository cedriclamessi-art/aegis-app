// ============================================================
// AEGIS — Feature Flag Middleware
// Enforce : agent_mode · autopilot_mode · guardrails
// Tout passe par ici avant exécution d'une action
// ============================================================

import { db } from '../utils/db';

export type AgentMode = 'basic' | 'hedge_fund' | 'full_organism';
export type AutopilotMode = 'human_validate' | 'semi_auto' | 'full_auto';

// Niveau requis par agent_mode
const AGENT_MODE_RANK: Record<AgentMode, number> = {
  basic: 1,
  hedge_fund: 2,
  full_organism: 3,
};

// Niveau requis par autopilot_mode
const AUTOPILOT_RANK: Record<AutopilotMode, number> = {
  human_validate: 1,
  semi_auto: 2,
  full_auto: 3,
};

// Niveaux max autorisés par plan
const PLAN_AGENT_MODE: Record<string, AgentMode> = {
  trial: 'basic',
  starter: 'basic',
  growth: 'hedge_fund',
  scale: 'full_organism',
};
const PLAN_AUTOPILOT_MODE: Record<string, AutopilotMode> = {
  trial: 'semi_auto',
  starter: 'semi_auto',
  growth: 'semi_auto',
  scale: 'full_auto',
};

// ─── TenantContext ────────────────────────────────────────
export interface TenantContext {
  tenantId: string;
  planId: string;
  agentMode: AgentMode;
  autopilotMode: AutopilotMode;
  stage: string;
  killSwitchActive: boolean;
  guardrailsLocked: boolean;
  workerThrottlePct: number;
  adminLifetime: boolean;
}

export async function getTenantContext(tenantId: string): Promise<TenantContext | null> {
  const result = await db.query(
    `SELECT t.id, t.plan_id, t.agent_mode, t.autopilot_mode, t.stage,
            t.kill_switch_active, t.guardrails_locked, t.worker_throttle_pct,
            t.admin_lifetime, p.agent_mode_allowed, p.autopilot_mode_allowed
     FROM saas.tenants t
     LEFT JOIN saas.plans p ON p.id = t.plan_id
     WHERE t.id = $1`,
    [tenantId]
  );
  if (!result.rows.length) return null;
  const r = result.rows[0];
  return {
    tenantId,
    planId: r.plan_id,
    agentMode: r.agent_mode,
    autopilotMode: r.autopilot_mode,
    stage: r.stage,
    killSwitchActive: r.kill_switch_active,
    guardrailsLocked: r.guardrails_locked,
    workerThrottlePct: r.worker_throttle_pct,
    adminLifetime: r.admin_lifetime,
  };
}

// ─── Vérifications ────────────────────────────────────────

export class FeatureFlagError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly required?: string,
    public readonly current?: string
  ) {
    super(message);
    this.name = 'FeatureFlagError';
  }
}

/**
 * Vérifier qu'un agent peut s'exécuter pour ce tenant
 */
export function assertAgentAllowed(
  ctx: TenantContext,
  requiredLevel: string
): void {
  const required = requiredLevel as AgentMode;
  if (AGENT_MODE_RANK[required] > AGENT_MODE_RANK[ctx.agentMode]) {
    throw new FeatureFlagError(
      `Agent niveau "${required}" non disponible sur le plan "${ctx.planId}" (mode: ${ctx.agentMode})`,
      'AGENT_MODE_INSUFFICIENT',
      required,
      ctx.agentMode
    );
  }
}

/**
 * Vérifier qu'une action peut s'exécuter en autopilot
 * riskScore 0-1 : 0=no risk, 1=critical
 */
export function assertAutopilotAllowed(
  ctx: TenantContext,
  riskScore: number,
  actionType: string
): 'execute' | 'needs_approval' {
  // Kill switch = toujours bloqué
  if (ctx.killSwitchActive) {
    throw new FeatureFlagError(
      'Kill switch actif — toutes les actions sont bloquées',
      'KILL_SWITCH_ACTIVE'
    );
  }

  const mode = ctx.autopilotMode;

  if (mode === 'human_validate') {
    // Tout action avec risque > 0 attend validation
    if (riskScore > 0) return 'needs_approval';
    return 'execute';
  }

  if (mode === 'semi_auto') {
    // Low risk (<0.3) = auto, sinon validation
    if (riskScore < 0.3) return 'execute';
    return 'needs_approval';
  }

  if (mode === 'full_auto') {
    // Tout auto, mais guardrails toujours ON
    // Les guardrails sont vérifiés séparément par POLICY_GOVERNOR / RISK_ENGINE
    return 'execute';
  }

  return 'needs_approval';
}

/**
 * Vérifier qu'un changement de mode est autorisé
 */
export async function assertModeChangeAllowed(
  ctx: TenantContext,
  newAgentMode?: AgentMode,
  newAutopilotMode?: AutopilotMode,
  requestedBy?: string
): Promise<void> {
  const plan = await db.query(
    `SELECT agent_mode_allowed, autopilot_mode_allowed FROM saas.plans WHERE id = $1`,
    [ctx.planId]
  );
  if (!plan.rows.length) throw new FeatureFlagError('Plan introuvable', 'PLAN_NOT_FOUND');

  const maxAgentMode = plan.rows[0].agent_mode_allowed as AgentMode;
  const maxAutopilot = plan.rows[0].autopilot_mode_allowed as AutopilotMode;

  if (newAgentMode && AGENT_MODE_RANK[newAgentMode] > AGENT_MODE_RANK[maxAgentMode]) {
    throw new FeatureFlagError(
      `Le plan "${ctx.planId}" ne permet pas le mode "${newAgentMode}" (max: ${maxAgentMode})`,
      'PLAN_UPGRADE_REQUIRED',
      newAgentMode,
      maxAgentMode
    );
  }

  if (newAutopilotMode && AUTOPILOT_RANK[newAutopilotMode] > AUTOPILOT_RANK[maxAutopilot]) {
    throw new FeatureFlagError(
      `Le plan "${ctx.planId}" ne permet pas l'autopilot "${newAutopilotMode}" (max: ${maxAutopilot})`,
      'PLAN_UPGRADE_REQUIRED',
      newAutopilotMode,
      maxAutopilot
    );
  }

  // full_auto nécessite 7 jours green minimum
  if (newAutopilotMode === 'full_auto') {
    const minDays = await getGuardrailValue('policy.full_auto_min_days_green', 7);
    const greenDays = await countGreenDays(ctx.tenantId);
    if (greenDays < minDays) {
      throw new FeatureFlagError(
        `Full Auto nécessite ${minDays} jours green consécutifs (actuel: ${greenDays})`,
        'INSUFFICIENT_GREEN_DAYS',
        String(minDays),
        String(greenDays)
      );
    }
  }

  // Audit log obligatoire pour tout changement de mode
  await db.query(
    `INSERT INTO ops.audit_log (tenant_id, agent_id, action, old_value, new_value, metadata)
     VALUES ($1, $2, 'mode_change', $3::jsonb, $4::jsonb, $5::jsonb)`,
    [
      ctx.tenantId,
      requestedBy ?? 'api',
      JSON.stringify({ agentMode: ctx.agentMode, autopilotMode: ctx.autopilotMode }),
      JSON.stringify({ agentMode: newAgentMode ?? ctx.agentMode, autopilotMode: newAutopilotMode ?? ctx.autopilotMode }),
      JSON.stringify({ requestedBy }),
    ]
  );
}

/**
 * Vérifier qu'une modification de guardrail est autorisée
 * Seul super_admin peut modifier is_locked = TRUE
 */
export async function assertGuardrailModificationAllowed(
  userId: string,
  key: string
): Promise<void> {
  const config = await db.query(
    `SELECT is_locked, locked_by FROM ops.runtime_config WHERE key = $1`,
    [key]
  );
  if (!config.rows.length) return; // clé n'existe pas → OK

  if (config.rows[0].is_locked) {
    const user = await db.query(
      `SELECT role FROM saas.users WHERE id = $1`, [userId]
    );
    if (!user.rows.length || user.rows[0].role !== 'super_admin') {
      throw new FeatureFlagError(
        `La config "${key}" est verrouillée (guardrail système). Super-admin requis.`,
        'GUARDRAIL_LOCKED',
        'super_admin',
        user.rows[0]?.role ?? 'unknown'
      );
    }
    // Super admin peut modifier MAIS audit log obligatoire
    await db.query(
      `INSERT INTO ops.audit_log (user_id, action, resource_type, metadata)
       VALUES ($1, 'guardrail_override', 'runtime_config', $2::jsonb)`,
      [userId, JSON.stringify({ key, warning: 'GUARDRAIL_OVERRIDE_BY_SUPER_ADMIN' })]
    );
  }
}

// ─── Helpers ──────────────────────────────────────────────
async function getGuardrailValue(key: string, defaultVal: number): Promise<number> {
  const r = await db.query(
    `SELECT value FROM ops.runtime_config WHERE key = $1 AND tenant_id IS NULL`, [key]
  );
  return r.rows.length ? Number(r.rows[0].value) : defaultVal;
}

async function countGreenDays(tenantId: string): Promise<number> {
  // "green" = aucun stop-loss event critique les N derniers jours
  const r = await db.query(
    `SELECT COUNT(DISTINCT DATE(created_at)) as days
     FROM risk.stop_loss_events
     WHERE tenant_id = $1
       AND event_type IN ('roas_below_min','daily_loss_exceeded','kill_switch')
       AND created_at > NOW() - INTERVAL '30 days'`,
    [tenantId]
  );
  const badDays = Number(r.rows[0]?.days ?? 0);
  return Math.max(0, 30 - badDays);
}
