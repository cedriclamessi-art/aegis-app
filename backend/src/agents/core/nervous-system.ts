import logger from '../../utils/logger';
/**
 * AEGIS NERVOUS SYSTEM
 * \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
 * Le syst\u00e8me nerveux central qui rend les agents VIVANTS.
 *
 * Sans ce fichier : agents qui tournent sur des crons. Planning d'ex\u00e9cution.
 * Avec ce fichier : agents qui R\u00c9AGISSENT, D\u00c9LIB\u00c8RENT, POURSUIVENT des objectifs.
 *
 * Trois m\u00e9canismes :
 *
 *   1. EVENT LOOP \u2014 chaque agent publie des \u00e9v\u00e9nements, les autres r\u00e9agissent
 *      instantan\u00e9ment. WINNER_DETECTOR valide un produit \u2192 CREATIVE_FACTORY
 *      d\u00e9marre sans attendre le prochain cron.
 *
 *   2. DELIBERATION \u2014 sur les d\u00e9cisions ambigu\u00ebs (score 50-75), l'ORCHESTRATOR
 *      convoque un jury d'agents, collecte leurs avis, tranche. D\u00e9mocratie IA.
 *
 *   3. GOAL PURSUIT \u2014 chaque agent conna\u00eet le palier actuel et l'empire_index.
 *      Il adapte son comportement automatiquement pour avancer vers l'objectif.
 *      En mode SURVIE tout le monde est conservateur. En AGGRESSIF tout le monde
 *      pousse fort.
 */

import { db } from '../../utils/db';
import { AgentRegistry } from './agent-registry.js';
import { EventEmitter } from 'events';

// \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export interface NervousEvent {
  id:           string;         // UUID
  tenantId:     string;
  sourceAgent:  string;
  eventType:    string;         // ex: 'winner.validated' | 'condor.detected' | 'risk.spike'
  payload:      Record<string, unknown>;
  priority:     number;         // 1-10 (10 = urgence critique)
  timestamp:    Date;
}

export interface Reaction {
  targetAgent:  string;
  taskType:     string;
  payload:      Record<string, unknown>;
  delay?:       number;         // ms avant d\u00e9clenchement (0 = imm\u00e9diat)
}

export interface DeliberationRequest {
  id:           string;
  tenantId:     string;
  question:     string;         // "Scaler ce produit \u00e0 +20% ?"
  context:      Record<string, unknown>;
  jury:         string[];       // agents invit\u00e9s \u00e0 voter
  timeout_ms:   number;         // d\u00e9lai max pour collecter les votes
  requiredVotes: number;        // quorum minimum
}

export interface Vote {
  agentId:      string;
  decision:     'YES' | 'NO' | 'CONDITIONAL';
  confidence:   number;         // 0-1
  reasoning:    string;
  conditions?:  string;         // si CONDITIONAL
}

export interface EmpireContext {
  tenantId:       string;
  empireIndex:    number;
  empireMode:     'AGGRESSIF' | 'INSTITUTIONNEL' | 'ADAPTATIF' | 'SURVIE';
  palier:         1 | 2 | 3;
  hardConstraint: boolean;
  scaleSignal:    'BLOCKED' | 'CAUTION' | 'GO_CONSERVATIVE' | 'GO_NORMAL' | 'GO_AGGRESSIVE';
}

// \u2500\u2500 R\u00e9actions c\u00e2bl\u00e9es \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
//
// C'est ici que se d\u00e9finit l'intelligence collective.
// Quand A se passe \u2192 B et C r\u00e9agissent automatiquement.
//
// Format : eventType \u2192 [ Reaction ]

const REACTION_WIRING: Record<string, Reaction[]> = {

  // \u2500\u2500 WINNER DETECTOR \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'winner.validated': [
    // D\u00e8s qu'un produit est valid\u00e9, la machine cr\u00e9ative d\u00e9marre
    { targetAgent: 'AGENT_CREATIVE_FACTORY', taskType: 'creative.matrix_build',    payload: {}, delay: 0 },
    { targetAgent: 'AGENT_OFFER_OPTIMIZER',  taskType: 'offer.build_hormozi',       payload: {}, delay: 0 },
    { targetAgent: 'AGENT_FUNNEL_ENGINE',    taskType: 'funnel.validate_atf',       payload: {}, delay: 0 },
    { targetAgent: 'AGENT_COACHING',         taskType: 'coaching.explain_decision', payload: { decisionType: 'winner_potential' }, delay: 1000 },
  ],
  'winner.rejected': [
    { targetAgent: 'AGENT_OFFER_OPTIMIZER',  taskType: 'offer.restructure',          payload: {}, delay: 0 },
    { targetAgent: 'AGENT_COACHING',         taskType: 'coaching.explain_decision',  payload: { decisionType: 'rejected' }, delay: 1000 },
  ],
  'winner.borderline': [
    // Score 50-75 \u2192 D\u00c9LIB\u00c9RATION avant de d\u00e9cider
    { targetAgent: 'AGENT_ORCHESTRATOR', taskType: 'orchestrator.convene_deliberation', payload: {
      jury: ['AGENT_MARKET_ANALYSE', 'AGENT_RISK_ENGINE', 'AGENT_OFFER_OPTIMIZER'],
      question: 'Ce produit m\u00e9rite-t-il un TAKEOFF malgr\u00e9 un score borderline ?',
      timeout_ms: 30_000,
      requiredVotes: 2,
    }, delay: 0 },
  ],

  // \u2500\u2500 CREATIVE FACTORY \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'creative.matrix_ready': [
    { targetAgent: 'AGENT_COPY',           taskType: 'copy.generate_ads',    payload: {}, delay: 0 },
    { targetAgent: 'AGENT_META_TESTING',   taskType: 'meta.prepare_cbo',     payload: {}, delay: 5_000 },
    { targetAgent: 'AGENT_PSYCHO_MARKETING', taskType: 'psycho.enrich_briefs', payload: {}, delay: 2_000 },
  ],
  'creative.condor_detected': [
    // CONDOR \u2192 tout le monde s'active
    { targetAgent: 'AGENT_SCALE_ENGINE',   taskType: 'scale.condor_identified', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_RISK_ENGINE',    taskType: 'empire.condor_health_check', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_LEARNING',       taskType: 'learning.extract_condor_pattern', payload: {}, delay: 10_000 },
    { targetAgent: 'AGENT_COACHING',       taskType: 'coaching.explain_decision', payload: { decisionType: 'CONDOR' }, delay: 2_000 },
    { targetAgent: 'AGENT_INNOVATION',     taskType: 'innovation.analyze_condor', payload: {}, delay: 30_000 },
  ],
  'creative.dead_detected': [
    { targetAgent: 'AGENT_CREATIVE_FACTORY', taskType: 'creative.iterate',    payload: {}, delay: 0 },
    { targetAgent: 'AGENT_LEARNING',         taskType: 'learning.log_dead_angle', payload: {}, delay: 5_000 },
  ],

  // \u2500\u2500 META TESTING \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'meta.classification_done': [
    { targetAgent: 'AGENT_SCALE_ENGINE',  taskType: 'scale.evaluate',         payload: {}, delay: 0 },
    { targetAgent: 'AGENT_LEARNING',      taskType: 'learning.extract_patterns', payload: {}, delay: 60_000 },
    { targetAgent: 'AGENT_COACHING',      taskType: 'coaching.explain_decision', payload: {}, delay: 3_000 },
  ],

  // \u2500\u2500 SCALE ENGINE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'scale.budget_increased': [
    { targetAgent: 'AGENT_RISK_ENGINE',   taskType: 'empire.assess_risk',     payload: {}, delay: 0 },
    { targetAgent: 'AGENT_COACHING',      taskType: 'coaching.explain_decision', payload: { decisionType: 'budget_plus_20' }, delay: 2_000 },
  ],
  'scale.budget_decreased': [
    { targetAgent: 'AGENT_RISK_ENGINE',   taskType: 'empire.assess_risk',     payload: {}, delay: 0 },
    { targetAgent: 'AGENT_COACHING',      taskType: 'coaching.explain_decision', payload: { decisionType: 'budget_minus_20' }, delay: 2_000 },
  ],
  'scale.cruise_entered': [
    // CRUISE \u2192 on ouvre l'\u00e9cosyst\u00e8me multi-canal
    { targetAgent: 'AGENT_ECOSYSTEM_LOOP', taskType: 'ecosystem.activate_google', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_ECOSYSTEM_LOOP', taskType: 'ecosystem.activate_email',  payload: {}, delay: 5_000 },
    { targetAgent: 'AGENT_PORTFOLIO_OPT', taskType: 'portfolio.register_product', payload: {}, delay: 10_000 },
    { targetAgent: 'AGENT_COACHING',      taskType: 'coaching.explain_decision',  payload: { decisionType: 'cruise_enter' }, delay: 2_000 },
  ],
  'scale.stop_loss_triggered': [
    // STOP LOSS \u2192 urgence, tout le monde se met en mode d\u00e9fensif
    { targetAgent: 'AGENT_OPS_GUARD',     taskType: 'ops.emergency_budget_cap',  payload: {}, delay: 0 },
    { targetAgent: 'AGENT_RISK_ENGINE',   taskType: 'empire.assess_risk',        payload: { emergency: true }, delay: 0 },
    { targetAgent: 'AGENT_COACHING',      taskType: 'coaching.explain_decision',  payload: { decisionType: 'STOP_LOSS_TRIGGERED' }, delay: 1_000 },
    { targetAgent: 'AGENT_ORCHESTRATOR',  taskType: 'orchestrator.emergency_mode', payload: {}, delay: 0 },
  ],

  // \u2500\u2500 RISK ENGINE / EMPIRE \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'empire.index_computed': [
    // Chaque fois que l'empire_index est recalcul\u00e9 \u2192 tous les agents s'alignent
    { targetAgent: 'AGENT_SCALE_ENGINE',    taskType: 'scale.sync_empire_mode',  payload: {}, delay: 0 },
    { targetAgent: 'AGENT_BUDGET_ALLOCATOR',taskType: 'budget.rebalance',        payload: {}, delay: 5_000 },
    { targetAgent: 'AGENT_ORCHESTRATOR',    taskType: 'orchestrator.sync_goals', payload: {}, delay: 1_000 },
  ],
  'empire.mode_changed': [
    // Changement de mode (ex: ADAPTATIF \u2192 AGGRESSIF) \u2192 broadcast \u00e0 tous
    { targetAgent: 'AGENT_SCALE_ENGINE',     taskType: 'scale.update_thresholds',  payload: {}, delay: 0 },
    { targetAgent: 'AGENT_CREATIVE_FACTORY', taskType: 'creative.adjust_volume',   payload: {}, delay: 2_000 },
    { targetAgent: 'AGENT_MEDIA_BUYER',      taskType: 'media.adjust_strategy',    payload: {}, delay: 2_000 },
    { targetAgent: 'AGENT_COACHING',         taskType: 'coaching.daily_brief',     payload: { trigger: 'mode_change' }, delay: 5_000 },
  ],
  'empire.hard_constraint_triggered': [
    // Contrainte dure \u2192 BLOCAGE IMM\u00c9DIAT de tout scaling
    { targetAgent: 'AGENT_SCALE_ENGINE',  taskType: 'scale.emergency_freeze', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_MEDIA_BUYER',   taskType: 'media.freeze',           payload: {}, delay: 0 },
    { targetAgent: 'AGENT_OPS_GUARD',     taskType: 'ops.hard_constraint',    payload: {}, delay: 0 },
  ],
  'empire.palier_upgraded': [
    // Passage de palier \u2192 r\u00e9veil d'agents suppl\u00e9mentaires
    { targetAgent: 'AGENT_ORCHESTRATOR',    taskType: 'orchestrator.palier_brief', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_PORTFOLIO_OPT',   taskType: 'portfolio.init',            payload: {}, delay: 10_000 },
    { targetAgent: 'AGENT_COACHING',        taskType: 'coaching.explain_decision', payload: { decisionType: 'phase_1_unlocked' }, delay: 3_000 },
    { targetAgent: 'AGENT_INNOVATION',      taskType: 'innovation.palier_scan',    payload: {}, delay: 30_000 },
  ],

  // \u2500\u2500 LEARNING / INNOVATION \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'learning.patterns_updated': [
    // Nouveaux patterns \u2192 injection dans les agents de production
    { targetAgent: 'AGENT_CREATIVE_FACTORY', taskType: 'creative.inject_patterns', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_COPY',             taskType: 'copy.inject_patterns',      payload: {}, delay: 0 },
    { targetAgent: 'AGENT_OFFER_OPTIMIZER',  taskType: 'offer.inject_patterns',     payload: {}, delay: 0 },
    { targetAgent: 'AGENT_META_TESTING',     taskType: 'meta.inject_benchmarks',    payload: {}, delay: 5_000 },
  ],
  'innovation.tactical_update_proposed': [
    // Innovation propose une mise \u00e0 jour \u2192 d\u00e9lib\u00e9ration si impact >MEDIUM
    { targetAgent: 'AGENT_ORCHESTRATOR', taskType: 'orchestrator.convene_deliberation', payload: {
      jury: ['AGENT_RISK_ENGINE', 'AGENT_SCALE_ENGINE', 'AGENT_LEARNING'],
      question: 'Appliquer cette mise \u00e0 jour tactique propos\u00e9e par INNOVATION ?',
      timeout_ms: 60_000,
      requiredVotes: 2,
    }, delay: 0 },
  ],

  // \u2500\u2500 MARKET INTEL \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'market.opportunity_detected': [
    // Opportunit\u00e9 march\u00e9 \u2192 analyse imm\u00e9diate
    { targetAgent: 'AGENT_MARKET_ANALYSE', taskType: 'market.fast_analysis',  payload: {}, delay: 0 },
    { targetAgent: 'AGENT_RISK_ENGINE',    taskType: 'empire.simulate_action', payload: { actionType: 'new_product_launch' }, delay: 5_000 },
  ],
  'market.competitor_shift': [
    { targetAgent: 'AGENT_CREATIVE_FACTORY', taskType: 'creative.counter_brief', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_COPY',             taskType: 'copy.counter_messaging', payload: {}, delay: 5_000 },
    { targetAgent: 'AGENT_INNOVATION',       taskType: 'innovation.analyze_shift', payload: {}, delay: 10_000 },
  ],

  // \u2500\u2500 OPS GUARD \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  'ops.phase_unlocked': [
    { targetAgent: 'AGENT_ORCHESTRATOR', taskType: 'orchestrator.activate_phase_agents', payload: {}, delay: 0 },
    { targetAgent: 'AGENT_RISK_ENGINE',  taskType: 'empire.compute_index',               payload: {}, delay: 5_000 },
    { targetAgent: 'AGENT_COACHING',     taskType: 'coaching.explain_decision',           payload: { decisionType: 'phase_1_unlocked' }, delay: 10_000 },
  ],
};

// \u2500\u2500 NervousSystem \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export class NervousSystem extends EventEmitter {
  private running = false;
  private pollInterval: NodeJS.Timeout | null = null;
  private readonly POLL_MS = 2_000;   // polling toutes les 2s

  constructor(private registry: AgentRegistry) {
    super();
  }

  // \u2500\u2500 D\u00e9marrage \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    logger.info('\ud83e\udde0 NervousSystem starting...');

    // Poll continu de la table agents.messages
    this.pollInterval = setInterval(() => this.tick(), this.POLL_MS);

    // Poll initial imm\u00e9diat
    await this.tick();

    logger.info('\ud83e\udde0 NervousSystem alive \u2014 watching for events');
  }

  async stop(): Promise<void> {
    this.running = false;
    if (this.pollInterval) clearInterval(this.pollInterval);
    logger.info('\ud83e\udde0 NervousSystem stopped');
  }

  // \u2500\u2500 Tick \u2014 coeur du syst\u00e8me nerveux \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async tick(): Promise<void> {
    try {
      // 1. Lire tous les \u00e9v\u00e9nements non trait\u00e9s (par priorit\u00e9)
      const events = await this.readPendingEvents();
      if (events.length === 0) return;

      // 2. Pour chaque \u00e9v\u00e9nement, d\u00e9clencher les r\u00e9actions
      for (const event of events) {
        await this.processEvent(event);
      }
    } catch (err) {
      logger.error({ err }, 'NervousSystem tick error');
    }
  }

  private async readPendingEvents(): Promise<NervousEvent[]> {
    const r = await db.query(`
      SELECT
        id, tenant_id, from_agent, message_type, subject, payload, priority, created_at
      FROM agents.messages
      WHERE message_type = 'EVENT'
        AND processed_at IS NULL
      ORDER BY priority DESC, created_at ASC
      LIMIT 50
      FOR UPDATE SKIP LOCKED
    `);

    if (r.rows.length === 0) return [];

    // Marquer comme en cours de traitement
    const ids = r.rows.map((row: Record<string, unknown>) => row.id);
    await db.query(`
      UPDATE agents.messages
      SET processed_at = NOW()
      WHERE id = ANY($1::uuid[])
    `, [ids]);

    return r.rows.map((row: Record<string, string>) => ({
      id:          row.id,
      tenantId:    row.tenant_id,
      sourceAgent: row.from_agent,
      eventType:   row.subject,
      payload:     typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload,
      priority:    Number(row.priority),
      timestamp:   new Date(row.created_at),
    }));
  }

  // \u2500\u2500 Traitement d'un \u00e9v\u00e9nement \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async processEvent(event: NervousEvent): Promise<void> {
    const reactions = REACTION_WIRING[event.eventType] ?? [];

    if (reactions.length === 0) {
      // \u00c9v\u00e9nement non c\u00e2bl\u00e9 \u2014 log pour debug mais pas d'erreur
      return;
    }

    // R\u00e9cup\u00e9rer le contexte empire du tenant
    const empire = await this.getEmpireContext(event.tenantId);

    // Filtrer les r\u00e9actions selon le mode empire
    const filteredReactions = this.filterByEmpireMode(reactions, empire);

    // D\u00e9clencher chaque r\u00e9action
    for (const reaction of filteredReactions) {
      await this.triggerReaction(event, reaction, empire);
    }

    // Log dans agents.traces
    await this.logEvent(event, filteredReactions.length);
  }

  // \u2500\u2500 Filtre empire_mode \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  //
  // En mode SURVIE : seulement les r\u00e9actions d\u00e9fensives
  // En mode ADAPTATIF : r\u00e9actions normales
  // En mode INSTITUTIONNEL : toutes les r\u00e9actions + ajout de simulations
  // En mode AGGRESSIF : toutes les r\u00e9actions + acc\u00e9l\u00e9ration

  private filterByEmpireMode(reactions: Reaction[], empire: EmpireContext): Reaction[] {
    if (!empire) return reactions;

    // En SURVIE : bloquer les r\u00e9actions offensives
    if (empire.empireMode === 'SURVIE' || empire.hardConstraint) {
      const defensiveAgents = ['AGENT_RISK_ENGINE', 'AGENT_OPS_GUARD', 'AGENT_COACHING', 'AGENT_ORCHESTRATOR'];
      return reactions.filter(r => defensiveAgents.includes(r.targetAgent));
    }

    // En AGGRESSIF : acc\u00e9l\u00e9rer les r\u00e9actions (d\u00e9lai r\u00e9duit \u00e0 0)
    if (empire.empireMode === 'AGGRESSIF') {
      return reactions.map(r => ({ ...r, delay: 0 }));
    }

    return reactions;
  }

  // \u2500\u2500 D\u00e9clencher une r\u00e9action \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async triggerReaction(
    event: NervousEvent,
    reaction: Reaction,
    empire: EmpireContext
  ): Promise<void> {
    const payload = {
      ...reaction.payload,
      trigger_event: event.eventType,
      trigger_agent: event.sourceAgent,
      trigger_payload: event.payload,
      empire_index:  empire?.empireIndex,
      empire_mode:   empire?.empireMode,
      palier:        empire?.palier,
    };

    const trigger = async () => {
      await db.query(`
        INSERT INTO agents.messages
          (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
        VALUES ($1, 'NERVOUS_SYSTEM', $2, 'COMMAND', $3, $4::jsonb, $5, NOW())
      `, [
        event.tenantId,
        reaction.targetAgent,
        reaction.taskType,
        JSON.stringify(payload),
        event.priority,
      ]);
    };

    if (reaction.delay && reaction.delay > 0) {
      setTimeout(trigger, reaction.delay);
    } else {
      await trigger();
    }
  }

  // \u2500\u2500 D\u00e9lib\u00e9ration \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
  //
  // Quand une d\u00e9cision est ambigu\u00eb, l'ORCHESTRATOR convoque un jury.
  // Chaque agent vote avec son propre raisonnement.
  // Le verdict final respecte le quorum requis.

  async conveneDeliberation(
    request: DeliberationRequest
  ): Promise<{ verdict: 'YES' | 'NO' | 'CONDITIONAL'; votes: Vote[]; reasoning: string }> {
    logger.info(`\u2696\ufe0f  D\u00e9lib\u00e9ration ouverte : "${request.question}"`);

    // Envoyer la question \u00e0 chaque jur\u00e9
    for (const agentId of request.jury) {
      await db.query(`
        INSERT INTO agents.messages
          (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
        VALUES ($1, 'NERVOUS_SYSTEM', $2, 'QUERY', 'deliberation.vote_requested', $3::jsonb, 9, NOW())
      `, [
        request.tenantId, agentId,
        JSON.stringify({ deliberationId: request.id, question: request.question, context: request.context })
      ]);
    }

    // Attendre les votes (avec timeout)
    const votes = await this.collectVotes(request);

    // Calculer le verdict
    const verdict = this.computeVerdict(votes, request.requiredVotes);

    // Enregistrer la d\u00e9lib\u00e9ration
    await db.query(`
      INSERT INTO ops.simulation_log
        (tenant_id, action_type, action_agent, action_payload, status, approved_by)
      VALUES ($1, 'deliberation', 'NERVOUS_SYSTEM', $2::jsonb, $3, $4)
    `, [
      request.tenantId,
      JSON.stringify({ question: request.question, votes, verdict }),
      verdict.verdict === 'YES' ? 'approved' : 'rejected',
      `jury:${votes.map(v => v.agentId).join(',')}`,
    ]);

    logger.info(`\u2696\ufe0f  Verdict : ${verdict.verdict} (${votes.length} votes collect\u00e9s)`);
    return verdict;
  }

  private async collectVotes(request: DeliberationRequest): Promise<Vote[]> {
    const deadline = Date.now() + request.timeout_ms;
    const votes: Vote[] = [];

    while (Date.now() < deadline && votes.length < request.jury.length) {
      await new Promise(r => setTimeout(r, 500));

      const r = await db.query(`
        SELECT from_agent, payload
        FROM agents.messages
        WHERE to_agent = 'NERVOUS_SYSTEM'
          AND message_type = 'QUERY'
          AND subject = 'deliberation.vote_submitted'
          AND payload->>'deliberationId' = $1
          AND processed_at IS NULL
        FOR UPDATE SKIP LOCKED
      `, [request.id]);

      for (const row of r.rows) {
        const p = typeof row.payload === 'string' ? JSON.parse(row.payload) : row.payload;
        votes.push({
          agentId:    row.from_agent,
          decision:   p.decision,
          confidence: p.confidence,
          reasoning:  p.reasoning,
          conditions: p.conditions,
        });
        await db.query(`UPDATE agents.messages SET processed_at = NOW() WHERE from_agent = $1 AND payload->>'deliberationId' = $2`, [row.from_agent, request.id]);
      }

      if (votes.length >= request.requiredVotes) break;
    }

    return votes;
  }

  private computeVerdict(
    votes: Vote[],
    requiredVotes: number
  ): { verdict: 'YES' | 'NO' | 'CONDITIONAL'; votes: Vote[]; reasoning: string } {
    if (votes.length < requiredVotes) {
      return { verdict: 'NO', votes, reasoning: `Quorum non atteint (${votes.length}/${requiredVotes})` };
    }

    const yes          = votes.filter(v => v.decision === 'YES').length;
    const no           = votes.filter(v => v.decision === 'NO').length;
    const conditional  = votes.filter(v => v.decision === 'CONDITIONAL').length;
    const avgConfidence = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;

    let verdict: 'YES' | 'NO' | 'CONDITIONAL';
    if (yes > no && yes >= requiredVotes)         verdict = 'YES';
    else if (conditional > 0 && no < requiredVotes) verdict = 'CONDITIONAL';
    else                                           verdict = 'NO';

    const reasoning = [
      `${yes} YES \u00b7 ${no} NO \u00b7 ${conditional} CONDITIONAL`,
      `Confiance moyenne : ${(avgConfidence * 100).toFixed(0)}%`,
      ...votes.map(v => `${v.agentId}: ${v.decision} \u2014 "${v.reasoning}"`),
    ].join(' | ');

    return { verdict, votes, reasoning };
  }

  // \u2500\u2500 Empire Context \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async getEmpireContext(tenantId: string): Promise<EmpireContext> {
    const r = await db.query(`
      SELECT
        es.empire_index, es.empire_mode, es.palier, es.hard_constraint_triggered,
        sc.scale_signal
      FROM ops.empire_state es
      LEFT JOIN ops.scale_clearance sc ON sc.tenant_id = es.tenant_id
      WHERE es.tenant_id = $1
    `, [tenantId]);

    if (!r.rows.length) {
      return {
        tenantId, empireIndex: 0, empireMode: 'ADAPTATIF',
        palier: 1, hardConstraint: false, scaleSignal: 'GO_CONSERVATIVE',
      };
    }

    const row = r.rows[0];
    return {
      tenantId,
      empireIndex:    Number(row.empire_index),
      empireMode:     row.empire_mode,
      palier:         Number(row.palier) as 1|2|3,
      hardConstraint: row.hard_constraint_triggered,
      scaleSignal:    row.scale_signal,
    };
  }

  // \u2500\u2500 Publish (utilis\u00e9 par les agents pour \u00e9mettre des \u00e9v\u00e9nements) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  async publish(
    tenantId:    string,
    sourceAgent: string,
    eventType:   string,
    payload:     Record<string, unknown> = {},
    priority:    number = 5
  ): Promise<void> {
    await db.query(`
      INSERT INTO agents.messages
        (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
      VALUES ($1, $2, 'NERVOUS_SYSTEM', 'EVENT', $3, $4::jsonb, $5, NOW())
    `, [tenantId, sourceAgent, eventType, JSON.stringify(payload), priority]);
  }

  // \u2500\u2500 Log \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async logEvent(event: NervousEvent, reactionsTriggered: number): Promise<void> {
    await db.query(`
      INSERT INTO agents.traces
        (tenant_id, agent_id, level, message, metadata, created_at)
      VALUES ($1, 'NERVOUS_SYSTEM', 'info', $2, $3::jsonb, NOW())
    `, [
      event.tenantId,
      `\u26a1 ${event.eventType} \u2192 ${reactionsTriggered} r\u00e9actions`,
      JSON.stringify({ sourceAgent: event.sourceAgent, eventType: event.eventType, reactionsTriggered }),
    ]);
  }
}
