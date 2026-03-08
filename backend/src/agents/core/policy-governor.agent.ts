// ============================================================
// AEGIS — AGENT_POLICY_GOVERNOR (Niveau 3)
// Doctrine + règles immuables + veto sur toute décision
// Il est le "juge" — ORCHESTRATOR exécute, POLICY_GOVERNOR valide
// ============================================================

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';

interface Proposal {
  agentId: string;
  proposal: string;
  riskScore: number;
  expectedUplift: number;
  confidence: number;
  blastRadius: 'low' | 'medium' | 'high' | 'critical';
  proof: string[];
}

interface DecisionRequest {
  subject: string;
  decisionType: string;
  proposals: Proposal[];
  voteWeights?: Record<string, number>;
  tenantId: string;
  pipelineRunId?: string;
  correlationId?: string;
}

interface DecisionResult {
  finalDecision: 'approved' | 'rejected' | 'deferred';
  winningProposal?: Proposal;
  justification: string;
  policyBlocked: boolean;
  policyReason?: string;
}

export class PolicyGovernorAgent extends AgentBase {
  readonly agentId = 'AGENT_POLICY_GOVERNOR';
  readonly taskTypes = [
    'policy.check',
    'policy.enforce',
    'policy.audit',
    'AGENT_POLICY_GOVERNOR.handle_message',
  ];

  // Règles immuables (ne peuvent pas être overridées par config)
  private readonly HARD_RULES: Array<{
    id: string;
    description: string;
    check: (proposal: Proposal, ctx: PolicyContext) => boolean;
    reason: string;
  }> = [
    {
      id: 'KILL_SWITCH',
      description: 'Kill switch actif → tout bloqué',
      check: (_, ctx) => !ctx.killSwitchActive,
      reason: 'Kill switch activé — toutes les actions sont bloquées',
    },
    {
      id: 'ROAS_MIN',
      description: 'ROAS en dessous du minimum → pas de scaling',
      check: (proposal, ctx) => {
        if (proposal.proposal.includes('scale') || proposal.proposal.includes('Scale')) {
          return ctx.currentRoas >= ctx.roasMin;
        }
        return true;
      },
      reason: 'ROAS actuel en dessous du minimum — scaling interdit',
    },
    {
      id: 'BLAST_RADIUS_FULL_AUTO',
      description: 'blast_radius=critical → jamais en full_auto sans validation',
      check: (proposal, ctx) => {
        if (proposal.blastRadius === 'critical' && ctx.autopilotMode === 'full_auto') {
          return false; // toujours bloquer blast=critical même en full_auto
        }
        return true;
      },
      reason: 'Action blast_radius=critical requiert validation humaine même en full_auto',
    },
    {
      id: 'DRAWDOWN_MAX',
      description: 'Drawdown > max → pas de nouvelles positions',
      check: (proposal, ctx) => {
        if (proposal.proposal.toLowerCase().includes('launch') ||
            proposal.proposal.toLowerCase().includes('create')) {
          return ctx.currentDrawdownPct < ctx.maxDrawdownPct;
        }
        return true;
      },
      reason: 'Drawdown maximum atteint — nouvelles positions interdites',
    },
    {
      id: 'COOLDOWN',
      description: 'Cooldown scaling non respecté',
      check: (proposal, ctx) => {
        if (proposal.proposal.toLowerCase().includes('scale')) {
          const hoursSinceLastScale = ctx.hoursSinceLastScale ?? 999;
          return hoursSinceLastScale >= ctx.scalingCooldownH;
        }
        return true;
      },
      reason: 'Cooldown de scaling non écoulé — réessayer plus tard',
    },
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    await this.heartbeat();
    switch (task.taskType) {
      case 'policy.check':
        return this.checkPolicy(task);
      case 'policy.enforce':
        return this.enforceOnDecision(task);
      case 'policy.audit':
        return this.runAudit(task);
      default:
        return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  // ─── Vérification d'une proposition ──────────────────────
  private async checkPolicy(task: AgentTask): Promise<AgentResult> {
    const { proposal, tenantId } = task.input as { proposal: Proposal; tenantId: string };
    const ctx = await this.buildPolicyContext(tenantId);

    const violations = this.HARD_RULES
      .filter(rule => !rule.check(proposal, ctx))
      .map(rule => ({ ruleId: rule.id, reason: rule.reason }));

    const allowed = violations.length === 0;

    if (!allowed) {
      await this.trace('warn', `Policy violation: ${violations[0].ruleId}`, {
        proposal: proposal.proposal,
        violations,
      }, task.id);
    }

    return {
      success: true,
      output: { allowed, violations, proposal },
    };
  }

  // ─── Arbitrage final (appelé par ORCHESTRATOR) ────────────
  async arbitrate(request: DecisionRequest): Promise<DecisionResult> {
    const ctx = await this.buildPolicyContext(request.tenantId);

    // 1. Vérifier les règles absolues sur chaque proposition
    const validProposals = request.proposals.filter(p => {
      const violations = this.HARD_RULES.filter(rule => !rule.check(p, ctx));
      return violations.length === 0;
    });

    if (validProposals.length === 0) {
      const firstViolation = this.HARD_RULES.find(
        rule => !rule.check(request.proposals[0], ctx)
      );
      const result: DecisionResult = {
        finalDecision: 'rejected',
        justification: `Toutes les propositions violent les règles de doctrine`,
        policyBlocked: true,
        policyReason: firstViolation?.reason ?? 'Violation politique',
      };
      await this.recordDecision(request, result);
      return result;
    }

    // 2. Vote pondéré sur les propositions valides
    const weights = request.voteWeights ?? {};
    const scored = validProposals.map(p => {
      const weight = weights[p.agentId] ?? 1.0;
      const score = (p.confidence * (1 - p.riskScore) * p.expectedUplift) * weight;
      return { ...p, weightedScore: score };
    });

    scored.sort((a, b) => b.weightedScore - a.weightedScore);
    const winner = scored[0];

    // 3. Vérification finale blast_radius
    let policyBlocked = false;
    let policyReason: string | undefined;

    if (winner.blastRadius === 'critical' && ctx.autopilotMode !== 'human_validate') {
      policyBlocked = true;
      policyReason = 'blast_radius=critical → validation humaine obligatoire';
    }

    const result: DecisionResult = {
      finalDecision: policyBlocked ? 'deferred' : 'approved',
      winningProposal: winner,
      justification: `Proposition gagnante par vote pondéré (score: ${winner.weightedScore.toFixed(3)}). Agent: ${winner.agentId}. Risk: ${winner.riskScore}. Confidence: ${winner.confidence}.`,
      policyBlocked,
      policyReason,
    };

    await this.recordDecision(request, result);
    return result;
  }

  // ─── Enforce sur une décision (post-vote) ─────────────────
  private async enforceOnDecision(task: AgentTask): Promise<AgentResult> {
    const { decisionId, action } = task.input as { decisionId: string; action: Record<string, unknown> };

    // Vérifier que la décision existe et est approuvée
    const decision = await db.query(
      `SELECT * FROM agents.decisions WHERE id = $1`, [decisionId]
    );
    if (!decision.rows.length) {
      return { success: false, error: 'Decision not found' };
    }
    if (decision.rows[0].final_decision !== 'approved') {
      return { success: false, error: `Decision is ${decision.rows[0].final_decision}, not approved` };
    }
    if (decision.rows[0].policy_blocked) {
      return { success: false, error: `Decision policy_blocked: ${decision.rows[0].policy_reason}` };
    }

    return { success: true, output: { canExecute: true, decisionId } };
  }

  // ─── Audit périodique ─────────────────────────────────────
  private async runAudit(task: AgentTask): Promise<AgentResult> {
    const issues: string[] = [];

    // 1. Vérifier que tous les guardrails sont bien locked
    const unlockedGuardrails = await db.query(
      `SELECT key FROM ops.runtime_config
       WHERE key LIKE 'guardrails.%' AND is_locked = FALSE`
    );
    if (unlockedGuardrails.rows.length > 0) {
      issues.push(`CRITICAL: Guardrails non verrouillés: ${unlockedGuardrails.rows.map((r: { key: string }) => r.key).join(', ')}`);
    }

    // 2. Vérifier qu'aucun tenant en full_auto sans 7j green
    const badFullAuto = await db.query(
      `SELECT t.id, t.slug FROM saas.tenants t
       WHERE t.autopilot_mode = 'full_auto'
         AND (SELECT COUNT(*) FROM risk.stop_loss_events s
              WHERE s.tenant_id = t.id AND s.created_at > NOW() - INTERVAL '7 days') > 0`
    );
    if (badFullAuto.rows.length > 0) {
      issues.push(`WARNING: Tenants full_auto avec incidents récents: ${badFullAuto.rows.map((r: { slug: string }) => r.slug).join(', ')}`);
    }

    // 3. Vérifier agents non autorisés actifs
    const unauthorizedAgents = await db.query(
      `SELECT j.tenant_id, j.agent_id, t.agent_mode
       FROM jobs.queue j
       JOIN saas.tenants t ON t.id = j.tenant_id
       JOIN agents.registry ar ON ar.agent_id = j.agent_id
       WHERE j.status IN ('pending','claimed')
         AND (
           (ar.required_level = 'hedge_fund' AND t.agent_mode = 'basic') OR
           (ar.required_level = 'full_organism' AND t.agent_mode IN ('basic','hedge_fund'))
         )
       LIMIT 10`
    );
    if (unauthorizedAgents.rows.length > 0) {
      issues.push(`CRITICAL: ${unauthorizedAgents.rows.length} jobs d'agents non autorisés dans la queue`);
      // Annuler ces jobs
      await db.query(
        `UPDATE jobs.queue SET status='cancelled' WHERE id IN (
          SELECT j.id FROM jobs.queue j
          JOIN saas.tenants t ON t.id = j.tenant_id
          JOIN agents.registry ar ON ar.agent_id = j.agent_id
          WHERE j.status = 'pending'
            AND (
              (ar.required_level = 'hedge_fund' AND t.agent_mode = 'basic') OR
              (ar.required_level = 'full_organism' AND t.agent_mode IN ('basic','hedge_fund'))
            )
        )`
      );
    }

    if (issues.length > 0) {
      // Alerter
      await db.query(
        `INSERT INTO ops.alerts (level, type, title, message, agent_id)
         VALUES ('critical', 'policy_audit', 'Violations détectées par POLICY_GOVERNOR', $1, $2)`,
        [issues.join('\n'), this.agentId]
      );
    }

    return { success: true, output: { issuesFound: issues.length, issues } };
  }

  // ─── Enregistrer la décision (immuable) ───────────────────
  private async recordDecision(
    request: DecisionRequest,
    result: DecisionResult
  ): Promise<void> {
    await db.query(
      `INSERT INTO agents.decisions
       (tenant_id, subject, decision_type, proposals, vote_weights, winning_proposal,
        final_decision, decided_by, justification, policy_blocked, policy_reason,
        pipeline_run_id, correlation_id, decided_at)
       VALUES ($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb,$7,$8,$9,$10,$11,$12,$13,NOW())`,
      [
        request.tenantId,
        request.subject,
        request.decisionType,
        JSON.stringify(request.proposals),
        JSON.stringify(request.voteWeights ?? {}),
        result.winningProposal ? JSON.stringify(result.winningProposal) : null,
        result.finalDecision,
        this.agentId,
        result.justification,
        result.policyBlocked,
        result.policyReason ?? null,
        request.pipelineRunId ?? null,
        request.correlationId ?? null,
      ]
    );
  }

  // ─── Contexte politique du tenant ────────────────────────
  private async buildPolicyContext(tenantId: string): Promise<PolicyContext> {
    const [tenant, guardrails, lastScale, drawdown, roas] = await Promise.all([
      db.query(`SELECT autopilot_mode, kill_switch_active, stage FROM saas.tenants WHERE id=$1`, [tenantId]),
      db.query(`SELECT key, value FROM ops.runtime_config WHERE tenant_id IS NULL AND key LIKE 'guardrails.%'`),
      db.query(
        `SELECT created_at FROM ads.actions WHERE tenant_id=$1 AND action_type LIKE '%scale%'
         AND status='executed' ORDER BY created_at DESC LIMIT 1`, [tenantId]
      ),
      db.query(
        `SELECT drawdown_pct FROM risk.drawdown WHERE tenant_id=$1
         ORDER BY period_date DESC LIMIT 1`, [tenantId]
      ),
      db.query(
        `SELECT AVG(roas) as avg_roas FROM ads.performance_hourly
         WHERE tenant_id=$1 AND hour > NOW() - INTERVAL '24 hours'`, [tenantId]
      ),
    ]);

    if (!tenant.rows.length) throw new Error('Tenant not found');
    const t = tenant.rows[0];

    const cfg: Record<string, number> = {};
    for (const r of guardrails.rows) {
      cfg[r.key] = Number(r.value);
    }

    const stage = t.stage as string;
    const roasMinKey = `guardrails.roas_min_${stage === 'enterprise_100m' ? 'scale' : stage === 'growth_1m' ? 'growth' : 'seed'}`;
    const lossKey = `guardrails.max_loss_day_${stage === 'enterprise_100m' ? 'scale' : stage === 'growth_1m' ? 'growth' : 'seed'}`;

    let hoursSinceLastScale: number | undefined;
    if (lastScale.rows.length) {
      hoursSinceLastScale = (Date.now() - new Date(lastScale.rows[0].created_at).getTime()) / 3_600_000;
    }

    return {
      tenantId,
      autopilotMode: t.autopilot_mode,
      killSwitchActive: t.kill_switch_active,
      stage,
      roasMin: cfg[roasMinKey] ?? 1.5,
      maxLossDay: cfg[lossKey] ?? 500,
      maxDrawdownPct: cfg['guardrails.drawdown_max_pct'] ?? 20,
      scalingCooldownH: cfg['guardrails.scaling_cooldown_h'] ?? 4,
      currentRoas: Number(roas.rows[0]?.avg_roas ?? 0),
      currentDrawdownPct: Number(drawdown.rows[0]?.drawdown_pct ?? 0),
      hoursSinceLastScale,
    };
  }
}

interface PolicyContext {
  tenantId: string;
  autopilotMode: string;
  killSwitchActive: boolean;
  stage: string;
  roasMin: number;
  maxLossDay: number;
  maxDrawdownPct: number;
  scalingCooldownH: number;
  currentRoas: number;
  currentDrawdownPct: number;
  hoursSinceLastScale?: number;
}
