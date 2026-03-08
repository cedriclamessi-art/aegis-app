/**
 * AGENT_GUARDRAILS — Orchestrateur des garde-fous systémiques
 * ============================================================
 *
 * Point d'entrée unique pour TOUS les garde-fous AEGIS.
 * Appelé par ORCHESTRATOR avant toute décision significative.
 *
 * Responsabilités :
 *   GF1-GF5  — Complexity budget, circuit breaker, silence window,
 *               data quality gate, complexity score (migration 020)
 *   Risque A — Agent conflicts  : locks d'entités + arbitrage priorité
 *   Risque B — Data drift       : invalidation patterns obsolètes
 *   Risque C — Collapse risk    : over-optimization détection
 *
 * Philosophie :
 *   Structurel = l'erreur est impossible.
 *   Réactif    = l'erreur est détectée immédiatement.
 *   Les deux couches sont nécessaires.
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

// ── Types ──────────────────────────────────────────────────────────────────

interface GuardrailCheckInput {
  actionType: 'agent_promotion' | 'decision' | 'pattern_share' | 'simulator' | 'scale';
  actionValueEur?: number;
  agentId?: string;
  entityType?: string;
  entityId?: string;
  requestingAgent?: string;
  lockIntent?: string;
  ttlSeconds?: number;
}

interface CollapseRiskInput {
  avgCpm7d:            number;
  avgCpm30d:           number;
  avgFrequency7d:      number;
  topCreativeAgeDays:  number;
  topCreativeCtrDecay: number;   // ex: 0.45 = -45%
  topEntityBudgetPct:  number;   // ex: 0.85 = 85%
  roas7d:              number;
  cac7d:               number;
  cac30d:              number;
}

interface PatternDriftInput {
  patternId:            number;
  currentBudgetEur:     number;
  currentPhase:         number;
  currentEmpireIndex:   number;
  currentAudienceSize?: number;
}

interface EmpireIndexInput {
  cmPct:              number;
  cashRunwayDays:     number;
  dependencyPct:      number;
  riskScore:          number;
  patternConfidence?: number;
}

interface PhaseCheckInput {
  revenueMonthly:   number;
  cmPct:            number;
  dataDays:         number;
  cashRunwayDays?:  number;
  dependencyPct?:   number;
}

// ── Agent ─────────────────────────────────────────────────────────────────

export class GuardrailsAgent extends AgentBase {
  readonly agentId = 'AGENT_GUARDRAILS';
  readonly taskTypes = [
    'guardrails.check_all',            // GF1-GF5 avant toute décision
    'guardrails.acquire_lock',         // Risque A : lock entité
    'guardrails.release_lock',         // Risque A : libérer lock
    'guardrails.check_pattern_drift',  // Risque B : dérive pattern
    'guardrails.evaluate_collapse',    // Risque C : over-optimization
    'guardrails.compute_empire_index', // Empire Index pondéré v2
    'guardrails.check_phase',          // Éligibilité de phase
    'guardrails.daily_scan',           // Cron quotidien 06:00 UTC
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'guardrails.check_all':            return this.checkAll(task);
      case 'guardrails.acquire_lock':         return this.acquireLock(task);
      case 'guardrails.release_lock':         return this.releaseLock(task);
      case 'guardrails.check_pattern_drift':  return this.checkPatternDrift(task);
      case 'guardrails.evaluate_collapse':    return this.evaluateCollapse(task);
      case 'guardrails.compute_empire_index': return this.computeEmpireIndex(task);
      case 'guardrails.check_phase':          return this.checkPhase(task);
      case 'guardrails.daily_scan':           return this.dailyScan(task);
      default: return { success: false, error: `Unknown task: ${task.taskType}` };
    }
  }

  // ── 1. GF1-GF5 : check complet ─────────────────────────────────────────

  private async checkAll(task: AgentTask): Promise<AgentResult> {
    const input = task.input as GuardrailCheckInput;

    const r = await db.query<{
      all_clear:         boolean;
      blocked_by:        string[];
      warnings:          string[];
      complexity_score:  number;
      active_guardrails: string[];
    }>(
      `SELECT * FROM guardian.run_all_checks($1,$2,$3,$4)`,
      [task.tenantId, input.actionType, input.actionValueEur ?? 0, input.agentId ?? null]
    );

    const result = r.rows[0];
    if (!result.all_clear) {
      logger.warn(`[GUARDRAILS] BLOCKED — ${result.blocked_by?.join(' | ')}`);
    }
    if (result.warnings?.length) {
      logger.info(`[GUARDRAILS] WARN — ${result.warnings.join(' | ')}`);
    }

    return {
      success: true,
      output: {
        allClear:         result.all_clear,
        blockedBy:        result.blocked_by  ?? [],
        warnings:         result.warnings    ?? [],
        complexityScore:  result.complexity_score,
        activeGuardrails: result.active_guardrails ?? [],
      },
    };
  }

  // ── 2. Agent Conflicts — acquire lock ──────────────────────────────────

  private async acquireLock(task: AgentTask): Promise<AgentResult> {
    const { entityType, entityId, requestingAgent, lockIntent, ttlSeconds = 300 }
      = task.input as GuardrailCheckInput;

    if (!entityType || !entityId || !requestingAgent || !lockIntent) {
      return { success: false, error: 'Missing required lock fields' };
    }

    const r = await db.query<{
      acquired:       boolean;
      blocked_by:     string | null;
      blocked_intent: string | null;
      resolution:     string;
    }>(
      `SELECT * FROM systemic.acquire_entity_lock($1,$2,$3,$4,$5,$6)`,
      [task.tenantId, entityType, entityId, requestingAgent, lockIntent, ttlSeconds]
    );

    const row = r.rows[0];
    if (!row.acquired) {
      logger.warn(
        `[GUARDRAILS][CONFLICT] ${requestingAgent} blocked on ` +
        `${entityType}:${entityId} by ${row.blocked_by} (${row.blocked_intent})`
      );
    }

    return {
      success: true,
      output: { acquired: row.acquired, blockedBy: row.blocked_by, resolution: row.resolution },
    };
  }

  // ── 3. Release lock ─────────────────────────────────────────────────────

  private async releaseLock(task: AgentTask): Promise<AgentResult> {
    const { entityId, requestingAgent } = task.input as GuardrailCheckInput;
    await db.query(
      `SELECT systemic.release_entity_lock($1,$2,$3)`,
      [task.tenantId, entityId, requestingAgent]
    );
    return { success: true, output: { released: true } };
  }

  // ── 4. Data Drift ───────────────────────────────────────────────────────

  private async checkPatternDrift(task: AgentTask): Promise<AgentResult> {
    const input = task.input as PatternDriftInput;

    const r = await db.query<{
      drifted:        boolean;
      drift_type:     string | null;
      severity:       string;
      recommendation: string;
    }>(
      `SELECT * FROM systemic.check_pattern_drift($1,$2,$3,$4,$5,$6)`,
      [
        input.patternId, task.tenantId, input.currentBudgetEur,
        input.currentPhase, input.currentEmpireIndex,
        input.currentAudienceSize ?? null,
      ]
    );

    const row = r.rows[0];
    if (row.drifted) {
      logger.warn(
        `[GUARDRAILS][DRIFT] Pattern ${input.patternId} — ` +
        `${row.drift_type} [${row.severity}]`
      );
    }

    return {
      success: true,
      output: {
        drifted:       row.drifted,
        driftType:     row.drift_type,
        severity:      row.severity,
        recommendation: row.recommendation,
        patternValid:  !row.drifted || row.severity === 'minor',
      },
    };
  }

  // ── 5. Over-Optimization Collapse ──────────────────────────────────────

  private async evaluateCollapse(task: AgentTask): Promise<AgentResult> {
    const input = task.input as CollapseRiskInput;

    const r = await db.query<{
      collapse_risk:      string;
      critical_vectors:   string[];
      recommended_action: string;
      auto_action_needed: boolean;
    }>(
      `SELECT * FROM systemic.evaluate_collapse_risk($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        task.tenantId,
        input.avgCpm7d, input.avgCpm30d, input.avgFrequency7d,
        input.topCreativeAgeDays, input.topCreativeCtrDecay,
        input.topEntityBudgetPct,
        input.roas7d, input.cac7d, input.cac30d,
      ]
    );

    const row = r.rows[0];

    if (row.collapse_risk === 'critical') {
      logger.error(`[GUARDRAILS][COLLAPSE] CRITICAL — ${row.critical_vectors?.join(' | ')}`);
    } else if (row.collapse_risk === 'high') {
      logger.warn(`[GUARDRAILS][COLLAPSE] HIGH — ${task.tenantId}`);
    }

    // Dispatch urgence CEO si critical
    if (row.auto_action_needed) {
      await db.query(
        `INSERT INTO jobs.queue (tenant_id, task_type, payload, priority)
         VALUES ($1, 'orchestrator.emergency_mode', $2, 1)`,
        [
          task.tenantId,
          JSON.stringify({
            reason:            'OVER_OPTIMIZATION_COLLAPSE_RISK',
            collapseRisk:      row.collapse_risk,
            criticalVectors:   row.critical_vectors,
            recommendedAction: row.recommended_action,
          }),
        ]
      );
    }

    return {
      success: true,
      output: {
        collapseRisk:        row.collapse_risk,
        criticalVectors:     row.critical_vectors ?? [],
        recommendedAction:   row.recommended_action,
        autoActionTriggered: row.auto_action_needed,
      },
    };
  }

  // ── 6. Empire Index v2 ──────────────────────────────────────────────────

  private async computeEmpireIndex(task: AgentTask): Promise<AgentResult> {
    const input = task.input as EmpireIndexInput;

    const r = await db.query<{
      empire_index:      number;
      empire_mode:       string;
      score_cm:          number;
      score_pattern:     number;
      score_capital:     number;
      score_dependency:  number;
      score_risk:        number;
      hard_constraint:   boolean;
      constraint_reason: string | null;
    }>(
      `SELECT * FROM ops.compute_empire_index($1,$2,$3,$4,$5,$6)`,
      [
        task.tenantId, input.cmPct, input.cashRunwayDays,
        input.dependencyPct, input.riskScore, input.patternConfidence ?? 50,
      ]
    );

    const row = r.rows[0];

    // Persiste dans empire_state
    await db.query(
      `UPDATE ops.empire_state
       SET empire_index = $1, empire_mode = $2,
           hard_constraint_triggered = $3, constraint_reason = $4,
           last_computed_at = NOW()
       WHERE tenant_id = $5`,
      [row.empire_index, row.empire_mode, row.hard_constraint, row.constraint_reason, task.tenantId]
    );

    // Circuit breaker (GF2)
    await db.query(
      `SELECT * FROM guardian.check_circuit_breaker($1,$2,$3)`,
      [task.tenantId, row.empire_index, row.empire_mode]
    );

    logger.info(
      `[GUARDRAILS][EMPIRE] Index=${row.empire_index} Mode=${row.empire_mode} ` +
      `[CM=${row.score_cm} Pat=${row.score_pattern} Cap=${row.score_capital}]`
    );

    return {
      success: true,
      output: {
        empireIndex:      row.empire_index,
        empireMode:       row.empire_mode,
        breakdown: {
          cm: row.score_cm, pattern: row.score_pattern, capital: row.score_capital,
          dependency: row.score_dependency, risk: row.score_risk,
        },
        hardConstraint:   row.hard_constraint,
        constraintReason: row.constraint_reason,
      },
    };
  }

  // ── 7. Phase Eligibility ────────────────────────────────────────────────

  private async checkPhase(task: AgentTask): Promise<AgentResult> {
    const input = task.input as PhaseCheckInput;

    const r = await db.query<{
      phase_level: number;
      phase_name:  string;
      eligible:    boolean;
      missing:     string[];
    }>(
      `SELECT * FROM ops.check_phase_eligibility($1,$2,$3,$4,$5,$6)`,
      [
        task.tenantId, input.revenueMonthly, input.cmPct, input.dataDays,
        input.cashRunwayDays ?? null, input.dependencyPct ?? null,
      ]
    );

    const eligible = r.rows.filter(row => row.eligible);
    const maxPhase = eligible.length > 0 ? Math.max(...eligible.map(r => r.phase_level)) : 1;

    return {
      success: true,
      output: {
        maxEligiblePhase: maxPhase,
        eligiblePhases:   eligible.map(r => ({ level: r.phase_level, name: r.phase_name })),
        nextPhaseMissing: r.rows.find(r => !r.eligible)?.missing ?? [],
      },
    };
  }

  // ── 8. Daily Scan (cron 06:00 UTC) ─────────────────────────────────────

  private async dailyScan(task: AgentTask): Promise<AgentResult> {
    // Expire locks et silence windows
    await db.query(`
      UPDATE systemic.entity_locks SET released_at = NOW()
      WHERE released_at IS NULL AND lock_expires_at <= NOW()
    `);
    await db.query(`
      UPDATE guardian.agent_promotions SET silence_window_active = FALSE
      WHERE silence_window_active = TRUE AND silence_window_ends <= NOW()
    `);

    // Complexity score
    const cr = await db.query<{ complexity_score: number; threshold_exceeded: boolean }>(
      `SELECT * FROM guardian.compute_complexity_score($1)`, [task.tenantId]
    );

    // Empire index courant pour drift check
    const er = await db.query<{ empire_index: number }>(
      `SELECT empire_index FROM ops.empire_state WHERE tenant_id = $1`, [task.tenantId]
    );
    const empireIndex = er.rows[0]?.empire_index ?? 50;

    // Check drift sur tous les patterns actifs
    const patterns = await db.query<{ id: number }>(
      `SELECT id FROM intel.patterns WHERE tenant_id = $1 AND quality_gate_passed = TRUE`,
      [task.tenantId]
    );

    let drifted = 0;
    for (const p of patterns.rows) {
      const dr = await db.query<{ drifted: boolean; severity: string }>(
        `SELECT * FROM systemic.check_pattern_drift($1,$2,0,1,$3)`,
        [p.id, task.tenantId, empireIndex]
      );
      if (dr.rows[0]?.drifted && dr.rows[0]?.severity !== 'minor') drifted++;
    }

    logger.info(
      `[GUARDRAILS][DAILY] tenant=${task.tenantId} ` +
      `complexity=${cr.rows[0]?.complexity_score} drifted=${drifted}`
    );

    return {
      success: true,
      output: {
        complexityScore:       cr.rows[0]?.complexity_score,
        complexityExceeded:    cr.rows[0]?.threshold_exceeded,
        patternsChecked:       patterns.rows.length,
        patternsDrifted:       drifted,
      },
    };
  }
}
