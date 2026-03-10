/**
 * FLIGHT PHASE — Aviation Process Mapping for AEGIS Pipeline
 * ═══════════════════════════════════════════════════════════
 *
 * Maps the 11-step pipeline to 5 aviation flight phases:
 *
 *   ✈️  PREFLIGHT    — Analyse du marché et du produit
 *       Steps: INGEST → ANALYZE → VALIDATE
 *       "On vérifie la demande, la concurrence, les signaux de potentiel."
 *
 *   🛫 TAKEOFF      — Construction de l'infrastructure
 *       Steps: BUILD_OFFER → BUILD_PAGE → CREATE_ADS
 *       "On crée la boutique, les créatives, les campagnes."
 *
 *   ✈️  CRUISE       — Croissance
 *       Steps: LAUNCH_TEST → ANALYZE_RESULTS
 *       "Le système optimise, teste, améliore, scale."
 *
 *   ⚡ TURBULENCE   — Quand les performances chutent
 *       Steps: PROTECT (triggered on anomaly)
 *       "AEGIS détecte le problème, ajuste, corrige la stratégie."
 *
 *   🤖 AUTOPILOT    — Quand tout est stable
 *       Steps: SCALE → LEARN (+ Ralph Loop)
 *       "AEGIS gère l'optimisation, le scaling, l'allocation budgétaire."
 *
 * Ce module ne modifie PAS le PipelineOrchestrator existant.
 * Il fournit une couche de lecture qui traduit les steps en phases.
 */

import { Pool } from 'pg';
import { PipelineState, PipelineStep } from './pipeline-orchestrator';

// ── Types ────────────────────────────────────────────────────────────────

export type FlightPhase = 'PREFLIGHT' | 'TAKEOFF' | 'CRUISE' | 'TURBULENCE' | 'AUTOPILOT';

export interface PhaseStatus {
  phase:      FlightPhase;
  label:      string;
  emoji:      string;
  status:     'pending' | 'active' | 'completed' | 'turbulence' | 'standby';
  steps:      string[];
  progressPct: number;
  description: string;
}

export interface FlightStatus {
  pipelineId:     string;
  shopId:         string;
  currentPhase:   FlightPhase;
  phases:         PhaseStatus[];
  overallProgress: number;
  flightTime:     number;           // ms since pipeline start
  eta:            string | null;     // estimated completion time
  turbulenceEvents: TurbulenceEvent[];
}

export interface TurbulenceEvent {
  at:         string;
  reason:     string;
  resolved:   boolean;
  duration:   number | null;        // ms
}

// ── Phase Mapping Configuration ──────────────────────────────────────────

const PHASE_MAP: Record<FlightPhase, {
  label: string;
  emoji: string;
  steps: string[];
  description: string;
}> = {
  PREFLIGHT: {
    label: 'Preflight',
    emoji: '✈️',
    steps: ['INGEST', 'ANALYZE', 'VALIDATE'],
    description: 'Analyse du marché et du produit. Vérification de la demande, concurrence, et potentiel.',
  },
  TAKEOFF: {
    label: 'Takeoff',
    emoji: '🛫',
    steps: ['BUILD_OFFER', 'BUILD_PAGE', 'CREATE_ADS'],
    description: 'Construction de l\'infrastructure. Boutique, créatives, et campagnes.',
  },
  CRUISE: {
    label: 'Cruise',
    emoji: '🚀',
    steps: ['LAUNCH_TEST', 'ANALYZE_RESULTS'],
    description: 'Croissance. Le système optimise, teste, améliore, et scale.',
  },
  TURBULENCE: {
    label: 'Turbulence Control',
    emoji: '⚡',
    steps: ['PROTECT'],
    description: 'Détection de problèmes. AEGIS ajuste les campagnes et corrige la stratégie.',
  },
  AUTOPILOT: {
    label: 'Autopilot',
    emoji: '🤖',
    steps: ['SCALE', 'LEARN'],
    description: 'Pilotage automatique. Optimisation, scaling, allocation budgétaire.',
  },
};

const PHASES_ORDER: FlightPhase[] = ['PREFLIGHT', 'TAKEOFF', 'CRUISE', 'TURBULENCE', 'AUTOPILOT'];

// ── Step to Phase Lookup ─────────────────────────────────────────────────

const STEP_TO_PHASE: Record<string, FlightPhase> = {};
for (const [phase, config] of Object.entries(PHASE_MAP)) {
  for (const step of config.steps) {
    STEP_TO_PHASE[step] = phase as FlightPhase;
  }
}

// ── Flight Phase Service ─────────────────────────────────────────────────

export class FlightPhaseService {
  constructor(private db: Pool) {}

  /**
   * Get the flight status for a pipeline.
   * Translates the 11-step pipeline state into 5 aviation phases.
   */
  getFlightStatus(pipeline: PipelineState): FlightStatus {
    const phases = this.computePhases(pipeline);
    const currentPhase = this.determineCurrentPhase(pipeline, phases);
    const flightTime = Date.now() - new Date(pipeline.createdAt).getTime();

    // Estimate completion based on average step time
    const completedSteps = pipeline.steps.filter(s => s.status === 'completed');
    const remainingSteps = pipeline.steps.length - completedSteps.length;
    let eta: string | null = null;

    if (completedSteps.length > 0 && remainingSteps > 0) {
      const avgStepTime = completedSteps.reduce((sum, s) => {
        if (s.startedAt && s.completedAt) {
          return sum + (new Date(s.completedAt).getTime() - new Date(s.startedAt).getTime());
        }
        return sum;
      }, 0) / completedSteps.length;

      const estimatedRemaining = avgStepTime * remainingSteps;
      eta = new Date(Date.now() + estimatedRemaining).toISOString();
    }

    // Detect turbulence events
    const turbulenceEvents = this.detectTurbulence(pipeline);

    return {
      pipelineId:      pipeline.id,
      shopId:          pipeline.shopId,
      currentPhase,
      phases,
      overallProgress: Math.round((completedSteps.length / pipeline.steps.length) * 100),
      flightTime,
      eta,
      turbulenceEvents,
    };
  }

  /**
   * Get the current flight phase for a pipeline step ID.
   */
  getPhaseForStep(stepId: string): FlightPhase {
    return STEP_TO_PHASE[stepId] || 'CRUISE';
  }

  /**
   * Get all phase definitions.
   */
  getPhaseDefinitions(): typeof PHASE_MAP {
    return PHASE_MAP;
  }

  /**
   * Persist flight phase state to DB.
   */
  async persistFlightPhase(pipeline: PipelineState): Promise<void> {
    const status = this.getFlightStatus(pipeline);

    await this.db.query(`
      INSERT INTO flight_phases
        (shop_id, pipeline_id, current_phase, phase_progress, total_flight_time_ms, turbulence_events)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (pipeline_id) DO UPDATE SET
        current_phase        = EXCLUDED.current_phase,
        phase_progress       = EXCLUDED.phase_progress,
        total_flight_time_ms = EXCLUDED.total_flight_time_ms,
        turbulence_events    = EXCLUDED.turbulence_events,
        updated_at           = NOW()`,
      [
        pipeline.shopId,
        pipeline.id,
        status.currentPhase,
        JSON.stringify(Object.fromEntries(status.phases.map(p => [p.phase, {
          status: p.status, pct: p.progressPct, steps: p.steps,
        }]))),
        status.flightTime,
        JSON.stringify(status.turbulenceEvents),
      ]);
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private computePhases(pipeline: PipelineState): PhaseStatus[] {
    return PHASES_ORDER.map(phase => {
      const config = PHASE_MAP[phase];
      const phaseSteps = pipeline.steps.filter(s => config.steps.includes(s.id));

      const completedCount = phaseSteps.filter(s => s.status === 'completed').length;
      const runningCount   = phaseSteps.filter(s => s.status === 'running').length;
      const failedCount    = phaseSteps.filter(s => s.status === 'failed').length;

      let status: PhaseStatus['status'] = 'pending';
      if (completedCount === phaseSteps.length && phaseSteps.length > 0) {
        status = 'completed';
      } else if (runningCount > 0) {
        status = 'active';
      } else if (failedCount > 0) {
        status = phase === 'TURBULENCE' ? 'turbulence' : 'active';
      } else if (phase === 'TURBULENCE') {
        status = 'standby';
      }

      // Override: if TURBULENCE phase and we detect anomalies, activate
      if (phase === 'TURBULENCE' && this.hasActiveAnomalies(pipeline)) {
        status = 'turbulence';
      }

      const progressPct = phaseSteps.length > 0
        ? Math.round((completedCount / phaseSteps.length) * 100)
        : 0;

      return {
        phase,
        label:       config.label,
        emoji:       config.emoji,
        status,
        steps:       config.steps,
        progressPct,
        description: config.description,
      };
    });
  }

  private determineCurrentPhase(pipeline: PipelineState, phases: PhaseStatus[]): FlightPhase {
    // If pipeline is complete, we're in AUTOPILOT
    if (pipeline.status === 'completed') return 'AUTOPILOT';

    // If any step is failed/paused with anomaly reasons, we're in TURBULENCE
    const currentStep = pipeline.steps[pipeline.currentStep];
    if (currentStep?.id === 'PROTECT' || this.hasActiveAnomalies(pipeline)) {
      return 'TURBULENCE';
    }

    // Find the active phase
    const activePhase = phases.find(p => p.status === 'active');
    if (activePhase) return activePhase.phase;

    // Determine from current step
    if (currentStep) {
      return STEP_TO_PHASE[currentStep.id] || 'CRUISE';
    }

    return 'PREFLIGHT';
  }

  private hasActiveAnomalies(pipeline: PipelineState): boolean {
    // Check if PROTECT step has active alerts
    const protectStep = pipeline.steps.find(s => s.id === 'PROTECT');
    if (protectStep?.result) {
      const alerts = (protectStep.result as any)?.currentAlerts;
      return Array.isArray(alerts) && alerts.length > 0;
    }
    return false;
  }

  private detectTurbulence(pipeline: PipelineState): TurbulenceEvent[] {
    const events: TurbulenceEvent[] = [];

    // Check for failed steps (turbulence moments)
    for (const step of pipeline.steps) {
      if (step.status === 'failed' && step.completedAt) {
        events.push({
          at:       step.completedAt,
          reason:   `Step ${step.id} failed: ${(step.result as any)?.error || 'unknown'}`,
          resolved: pipeline.status !== 'paused',
          duration: null,
        });
      }
    }

    return events;
  }
}

// ── Convenience Functions ────────────────────────────────────────────────

/**
 * Get a human-readable flight status summary in French.
 */
export function getFlightSummary(status: FlightStatus): string {
  const phase = PHASE_MAP[status.currentPhase];
  const completedPhases = status.phases.filter(p => p.status === 'completed').length;

  return `${phase.emoji} ${phase.label} — ${status.overallProgress}% | ` +
         `${completedPhases}/${status.phases.length} phases complétées | ` +
         `${phase.description}`;
}

/**
 * Map a pipeline step ID to its flight phase.
 */
export function stepToPhase(stepId: string): FlightPhase {
  return STEP_TO_PHASE[stepId] || 'CRUISE';
}
