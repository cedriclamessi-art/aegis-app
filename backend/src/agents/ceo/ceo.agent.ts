/**
 * AGENT_CEO \u2014 Directeur G\u00e9n\u00e9ral Autonome avec M\u00e9moire d'Apprentissage
 * \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
 *
 * AGENT_CEO dirige les 32 agents d'AEGIS.
 *
 * Il apprend de ses erreurs via une boucle ferm\u00e9e :
 *   1. Chaque d\u00e9cision est logu\u00e9e dans learning.ceo_decisions
 *   2. 48-72h apr\u00e8s, l'outcome r\u00e9el est mesur\u00e9 et compar\u00e9 \u00e0 la pr\u00e9diction
 *   3. Si \u00e9cart > 30% \u2192 pattern d'erreur extrait dans learning.ceo_mistakes
 *   4. La m\u00e9moire est inject\u00e9e dans le prompt LLM avant toute d\u00e9cision similaire
 *
 * R\u00e9sultat : le CEO ne r\u00e9p\u00e8te pas les m\u00eames erreurs. Il am\u00e9liore sa pr\u00e9cision
 * de d\u00e9cision \u00e0 chaque cycle. Les m\u00e9moires les plus co\u00fbteuses ont le plus de poids.
 *
 * 11 t\u00e2ches :
 *   ceo.morning_brief            Quotidien 6h30
 *   ceo.situation_assessment     Toutes les 4h
 *   ceo.validate_major_decision  Sur demande (>500\u20ac impact)
 *   ceo.crisis_response          Sur alerte critique
 *   ceo.palier_review            Hebdomadaire
 *   ceo.board_report             Mensuel
 *   ceo.agent_realignment        Sur d\u00e9rive d\u00e9tect\u00e9e
 *   ceo.strategic_pivot          Sur changement empire_mode
 *   ceo.close_decision_loop      Nuit \u2014 mesure outcomes r\u00e9els
 *   ceo.extract_mistake          Extraction pattern erreur
 *   ceo.consolidate_memory       Lundi 4h \u2014 ajuste les poids m\u00e9moire
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';

// \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface SystemSnapshot {
  tenantId:         string;
  empireIndex:      number;
  empireMode:       string;
  palier:           number;
  palierProgress:   number;
  hardConstraint:   boolean;
  constraintReason: string | null;
  cashRunwayDays:   number;
  cashBalance:      number;
  revenueToday:     number;
  marginPct:        number;
  activeCondors:    number;
  avgFatigue:       number;
  decayCount:       number;
  scaleSignal:      string;
  agentsError:      number;
  pendingDecisions: number;
  activeAlerts:     { severity: string; title: string; agentId: string }[];
}

interface CeoMemory {
  id:            string;
  memoryTitle:   string;
  memoryContent: string;
  weight:        number;
}

// \u2500\u2500 AGENT_CEO \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

export class CeoAgent extends AgentBase {
  readonly agentId   = 'AGENT_CEO';
  readonly taskTypes = [
    'ceo.morning_brief',
    'ceo.situation_assessment',
    'ceo.validate_major_decision',
    'ceo.crisis_response',
    'ceo.palier_review',
    'ceo.board_report',
    'ceo.agent_realignment',
    'ceo.strategic_pivot',
    'ceo.close_decision_loop',   // NOUVEAU \u2014 fermeture boucle apprentissage
    'ceo.extract_mistake',       // NOUVEAU \u2014 extraction pattern d'erreur
    'ceo.consolidate_memory',    // NOUVEAU \u2014 consolidation hebdo m\u00e9moire
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    await this.heartbeat();
    switch (task.taskType) {
      case 'ceo.morning_brief':           return this.morningBrief(task);
      case 'ceo.situation_assessment':    return this.situationAssessment(task);
      case 'ceo.validate_major_decision': return this.validateMajorDecision(task);
      case 'ceo.crisis_response':         return this.crisisResponse(task);
      case 'ceo.palier_review':           return this.palierReview(task);
      case 'ceo.board_report':            return this.boardReport(task);
      case 'ceo.agent_realignment':       return this.agentRealignment(task);
      case 'ceo.strategic_pivot':         return this.strategicPivot(task);
      case 'ceo.close_decision_loop':     return this.closeDecisionLoop(task);
      case 'ceo.extract_mistake':         return this.extractMistake(task);
      case 'ceo.consolidate_memory':      return this.consolidateMemory(task);
      default: return { success: false, error: `Unknown task: ${task.taskType}` };
    }
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // M\u00c9MOIRE \u2014 Le coeur du syst\u00e8me d'apprentissage
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  /**
   * Charge les souvenirs pertinents depuis learning.ceo_active_memory
   * Tri\u00e9s par poids descendant \u2014 erreurs les plus co\u00fbteuses en premier
   */
  private async loadMemory(scope: string, empireMode?: string): Promise<CeoMemory[]> {
    const r = await db.query(`
      SELECT id, memory_title AS "memoryTitle", memory_content AS "memoryContent", weight
      FROM learning.ceo_active_memory
      WHERE memory_scope = $1
        AND (empire_mode_context IS NULL OR empire_mode_context = $2)
      LIMIT 6
    `, [scope, empireMode ?? 'ADAPTATIF']);

    if (r.rows.length > 0) {
      await db.query(`
        UPDATE learning.ceo_memory
        SET times_applied = times_applied + 1, updated_at = NOW()
        WHERE id = ANY($1::uuid[])
      `, [r.rows.map((x: CeoMemory) => x.id)]);
    }

    return r.rows as CeoMemory[];
  }

  /**
   * Formate les m\u00e9moires pour injection dans le prompt LLM
   * Les erreurs avec le plus grand poids apparaissent en premier
   */
  private buildMemoryPrompt(memories: CeoMemory[]): string {
    if (!memories.length) return '';
    const sorted = [...memories].sort((a, b) => b.weight - a.weight);
    const lines  = sorted.map(m =>
      `[SOUVENIR poids=${m.weight.toFixed(1)}] ${m.memoryTitle}\
${m.memoryContent}`
    );
    return `\
\
M\u00c9MOIRE CEO \u2014 Le\u00e7ons apprises de tes erreurs pass\u00e9es (APPLIQUE-LES) :\
\
${lines.join('\
\
')}`;
  }

  /**
   * Enregistre chaque d\u00e9cision pour la boucle d'apprentissage
   * L'outcome r\u00e9el sera mesur\u00e9 48-72h apr\u00e8s par le cron close_decision_loop
   */
  private async logDecision(params: {
    tenantId:        string;
    snap:            SystemSnapshot;
    decisionType:    string;
    requestingAgent?: string;
    decision:        'APPROVED' | 'REJECTED' | 'BLOCKED';
    reasoning:       string;
    conditions?:     string;
    predictedOutcome: 'positive' | 'neutral' | 'negative';
    predictedImpact:  number;
    confidence:       number;
    payload:          Record<string, unknown>;
    simulationId?:    string;
  }): Promise<string> {
    const r = await db.query(`
      INSERT INTO learning.ceo_decisions
        (tenant_id, decision_type, requesting_agent,
         empire_index_at, empire_mode_at, cash_runway_at, palier_at,
         impact_eur, decision_payload,
         decision, reasoning, conditions,
         predicted_outcome, predicted_impact_eur, confidence_score,
         simulation_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id
    `, [
      params.tenantId, params.decisionType, params.requestingAgent ?? null,
      params.snap.empireIndex, params.snap.empireMode,
      params.snap.cashRunwayDays, params.snap.palier,
      params.predictedImpact, JSON.stringify(params.payload),
      params.decision, params.reasoning, params.conditions ?? null,
      params.predictedOutcome, params.predictedImpact, params.confidence,
      params.simulationId ?? null,
    ]);
    return r.rows[0].id as string;
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 1. MORNING BRIEF \u2014 avec m\u00e9moire inject\u00e9e
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async morningBrief(task: AgentTask): Promise<AgentResult> {
    await this.trace('info', '\u2600\ufe0f CEO Morning Brief', {}, task.id);

    const snap      = await this.readSnapshot(task.tenantId!);
    const memories  = await this.loadMemory('morning_brief', snap.empireMode);
    const memPrompt = this.buildMemoryPrompt(memories);

    const raw = await this.callLLM({
      system: `Tu es le CEO d'AEGIS, syst\u00e8me e-commerce autonome de 32 agents IA.
Chaque matin tu lis l'\u00e9tat complet du syst\u00e8me et tu donnes des ordres du jour pr\u00e9cis.
Sois direct, chiffr\u00e9, actionnable. R\u00e9ponds UNIQUEMENT en JSON valide.`,
      user: `MORNING BRIEF ${new Date().toLocaleDateString('fr-FR')}

Empire Index : ${snap.empireIndex}/100  |  Mode : ${snap.empireMode}
Palier ${snap.palier} (${this.palierLabel(snap.palier)}) \u2014 ${snap.palierProgress.toFixed(1)}%
Revenue today : ${snap.revenueToday}\u20ac  |  Marge : ${snap.marginPct}%
Cash Runway : ${snap.cashRunwayDays}j  |  Cash : ${snap.cashBalance}\u20ac
CONDORs : ${snap.activeCondors}  |  Fatigue : ${snap.avgFatigue}/100  |  Decay : ${snap.decayCount}
Scale Signal : ${snap.scaleSignal}
Hard Constraint : ${snap.hardConstraint}${snap.constraintReason ? ' \u2014 ' + snap.constraintReason : ''}
Agents en erreur : ${snap.agentsError}  |  Alertes : ${snap.activeAlerts.length}
OBJECTIF PALIER ${snap.palier} : ${this.palierObjective(snap.palier)}${memPrompt}

{
  "todayFocus": "Objectif du jour en 1 phrase",
  "topPriority": "La chose la plus importante aujourd'hui",
  "risks": ["risque \u00e0 surveiller"],
  "opportunities": ["opportunit\u00e9 \u00e0 saisir"],
  "agentDirectives": [
    { "agentId": "AGENT_XXX", "instruction": "Directive pr\u00e9cise et actionnable", "priority": "HIGH|MEDIUM|LOW", "context": "Pourquoi maintenant" }
  ],
  "ceoMessage": "2 lignes directes et motivantes pour l'utilisateur",
  "memoriesApplied": ["r\u00e8gle m\u00e9moire appliqu\u00e9e si pertinent"]
}`,
      maxTokens: 1500,
    });

    let brief: Record<string, unknown> = {};
    try { brief = JSON.parse(raw); }
    catch { brief = { todayFocus: 'Optimiser le pipeline', agentDirectives: [], ceoMessage: 'AEGIS travaille pour toi.' }; }

    const directives = (brief.agentDirectives as Array<{
      agentId: string; instruction: string; priority: string; context: string;
    }> ?? []);

    for (const d of directives) {
      await this.send({
        fromAgent: this.agentId, toAgent: d.agentId,
        messageType: 'COMMAND', subject: 'ceo.daily_directive',
        payload: { instruction: d.instruction, priority: d.priority, context: d.context,
                   empireMode: snap.empireMode, palier: snap.palier, todayFocus: brief.todayFocus },
        tenantId: task.tenantId,
        priority: d.priority === 'HIGH' ? 8 : d.priority === 'MEDIUM' ? 6 : 4,
      });
    }

    await this.send({
      fromAgent: this.agentId, toAgent: 'AGENT_COACHING',
      messageType: 'COMMAND', subject: 'coaching.ceo_morning_brief',
      payload: { date: new Date().toISOString(), empireIndex: snap.empireIndex, empireMode: snap.empireMode,
                 palier: snap.palier, todayFocus: brief.todayFocus, topPriority: brief.topPriority,
                 risks: brief.risks, opportunities: brief.opportunities, ceoMessage: brief.ceoMessage,
                 memoriesApplied: brief.memoriesApplied },
      tenantId: task.tenantId, priority: 6,
    });

    if (snap.hardConstraint) await this.activateDefensiveMode(task.tenantId!, snap);
    if (snap.agentsError > 0) {
      await this.send({ fromAgent: this.agentId, toAgent: 'AGENT_RECOVERY',
        messageType: 'COMMAND', subject: 'recovery.scan_and_repair',
        payload: { trigger: 'ceo_morning_brief' }, tenantId: task.tenantId, priority: 9 });
    }

    // Logger pour la boucle d'apprentissage
    await this.logDecision({
      tenantId: task.tenantId!, snap, decisionType: 'morning_brief',
      decision: 'APPROVED', reasoning: brief.todayFocus as string ?? '',
      predictedOutcome: 'positive', predictedImpact: snap.revenueToday,
      confidence: 0.7, payload: { directivesCount: directives.length },
    });

    return {
      success: true,
      output: { snapshot: snap, directivesSent: directives.length,
                todayFocus: brief.todayFocus, memoriesUsed: memories.length },
    };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 2. SITUATION ASSESSMENT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async situationAssessment(task: AgentTask): Promise<AgentResult> {
    const snap    = await this.readSnapshot(task.tenantId!);
    const actions = await this.detectAndCorrect(snap, task.tenantId!);

    await db.query(`
      INSERT INTO ops.empire_state (tenant_id, empire_index, empire_mode, active_mode, palier, last_evaluated_at)
      VALUES ($1,$2,$3,'FULL_AUTO',$4,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET
        empire_index=EXCLUDED.empire_index, empire_mode=EXCLUDED.empire_mode, last_evaluated_at=NOW()
    `, [task.tenantId, snap.empireIndex, snap.empireMode, snap.palier]);

    return { success: true, output: { snapshot: snap, correctiveActions: actions } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 3. VALIDATE MAJOR DECISION \u2014 avec m\u00e9moire inject\u00e9e dans le prompt
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async validateMajorDecision(task: AgentTask): Promise<AgentResult> {
    const { requestingAgent, decisionType, impactEur, payload, simulationId } = task.input as {
      requestingAgent: string; decisionType: string; impactEur: number;
      payload: Record<string, unknown>; simulationId?: string;
    };

    const snap     = await this.readSnapshot(task.tenantId!);
    const memories = await this.loadMemory('approve_scale', snap.empireMode);
    const memPrompt = this.buildMemoryPrompt(memories);

    // \u2500\u2500 R\u00e8gles CEO non n\u00e9gociables (bypasse le LLM) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    if (snap.hardConstraint) {
      const decId = await this.logDecision({
        tenantId: task.tenantId!, snap, decisionType, requestingAgent,
        decision: 'BLOCKED', reasoning: 'Hard constraint actif : ' + (snap.constraintReason ?? snap.empireMode),
        predictedOutcome: 'neutral', predictedImpact: 0, confidence: 1.0, payload, simulationId,
      });
      await this.blockDecision(task, requestingAgent, decisionType, simulationId,
        `Hard constraint : ${snap.constraintReason ?? snap.empireMode}`);
      return { success: true, output: { approved: false, reason: 'hard_constraint', decisionId: decId } };
    }

    if (snap.cashRunwayDays < 14 && impactEur > 0) {
      const decId = await this.logDecision({
        tenantId: task.tenantId!, snap, decisionType, requestingAgent,
        decision: 'BLOCKED', reasoning: `Cash runway ${snap.cashRunwayDays}j < 14j minimum`,
        predictedOutcome: 'neutral', predictedImpact: 0, confidence: 1.0, payload, simulationId,
      });
      await this.blockDecision(task, requestingAgent, decisionType, simulationId,
        `Cash runway insuffisant : ${snap.cashRunwayDays}j (min 14j)`);
      return { success: true, output: { approved: false, reason: 'insufficient_runway', decisionId: decId } };
    }

    if (snap.empireMode === 'SURVIE' && impactEur > 100) {
      const decId = await this.logDecision({
        tenantId: task.tenantId!, snap, decisionType, requestingAgent,
        decision: 'BLOCKED', reasoning: 'Mode SURVIE actif \u2014 aucune d\u00e9pense >100\u20ac',
        predictedOutcome: 'neutral', predictedImpact: 0, confidence: 1.0, payload, simulationId,
      });
      await this.blockDecision(task, requestingAgent, decisionType, simulationId, 'Mode SURVIE actif');
      return { success: true, output: { approved: false, reason: 'survie_mode', decisionId: decId } };
    }

    // \u2500\u2500 \u00c9valuation LLM avec m\u00e9moire inject\u00e9e \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
    const evalRaw = await this.callLLM({
      system: 'CEO e-commerce. \u00c9value les d\u00e9cisions strat\u00e9giques. JSON strict uniquement.',
      user: `D\u00c9CISION \u00c0 VALIDER

Type         : ${decisionType}
Impact       : ${impactEur}\u20ac
Demand\u00e9 par  : ${requestingAgent}
D\u00e9tails      : ${JSON.stringify(payload)}

CONTEXTE EMPIRE
Index : ${snap.empireIndex}/100  |  Mode : ${snap.empireMode}
Runway: ${snap.cashRunwayDays}j  |  Cash : ${snap.cashBalance}\u20ac
CONDORs : ${snap.activeCondors}  |  Fatigue : ${snap.avgFatigue}/100  |  Decay : ${snap.decayCount}
Scale Signal : ${snap.scaleSignal}${memPrompt}

Approuves-tu cette d\u00e9cision en tenant compte de ta m\u00e9moire ?
{
  "approved": true,
  "reasoning": "2-3 phrases directes",
  "conditions": null,
  "predicted_outcome": "positive",
  "predicted_impact_eur": 0,
  "confidence": 0.7,
  "memory_applied": "r\u00e8gle m\u00e9moire appliqu\u00e9e ou null"
}`,
      maxTokens: 400,
    });

    let ev: {
      approved: boolean; reasoning: string; conditions?: string;
      predicted_outcome: string; predicted_impact_eur: number;
      confidence: number; memory_applied?: string;
    };
    try { ev = JSON.parse(evalRaw); }
    catch { ev = { approved: !snap.hardConstraint && snap.empireMode !== 'SURVIE',
                   reasoning: '\u00c9valuation auto.', predicted_outcome: 'neutral',
                   predicted_impact_eur: impactEur * 0.8, confidence: 0.5 }; }

    // Logger la d\u00e9cision
    const decisionId = await this.logDecision({
      tenantId: task.tenantId!, snap, decisionType, requestingAgent,
      decision: ev.approved ? 'APPROVED' : 'REJECTED',
      reasoning: ev.reasoning, conditions: ev.conditions,
      predictedOutcome: ev.predicted_outcome as 'positive' | 'neutral' | 'negative',
      predictedImpact: ev.predicted_impact_eur, confidence: ev.confidence,
      payload, simulationId,
    });

    // Incr\u00e9menter prevented_errors si une m\u00e9moire a chang\u00e9 la d\u00e9cision
    if (ev.memory_applied && memories.length > 0) {
      const relevantMem = memories.find(m =>
        ev.memory_applied!.toLowerCase().includes(m.memoryTitle.toLowerCase().substring(0, 20))
      );
      if (relevantMem) {
        await db.query(
          `UPDATE learning.ceo_memory SET prevented_errors = prevented_errors + 1 WHERE id = $1`,
          [relevantMem.id]
        );
      }
    }

    if (simulationId) {
      await db.query(`
        UPDATE ops.simulation_log SET
          status=$1, approved_by='AGENT_CEO',
          executed_at=CASE WHEN $1='approved' THEN NOW() ELSE NULL END
        WHERE id=$2
      `, [ev.approved ? 'approved' : 'rejected', simulationId]);
    }

    await this.send({
      fromAgent: this.agentId, toAgent: requestingAgent,
      messageType: 'RESPONSE',
      subject: ev.approved ? 'ceo.decision_approved' : 'ceo.decision_rejected',
      payload: { approved: ev.approved, reasoning: ev.reasoning, conditions: ev.conditions,
                 empireIndex: snap.empireIndex, decisionId },
      tenantId: task.tenantId, priority: 9,
    });

    await this.trace('info',
      `${ev.approved ? '\u2705 APPROUV\u00c9' : '\u274c REJET\u00c9'} : ${decisionType} (confiance ${(ev.confidence * 100).toFixed(0)}% \u2014 ${memories.length} souvenirs)`,
      { requestingAgent, impactEur, memoriesUsed: memories.length, memoryApplied: ev.memory_applied, decisionId },
      task.id
    );

    return { success: true, output: { ...ev, decisionId, memoriesUsed: memories.length } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 4. CRISIS RESPONSE
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async crisisResponse(task: AgentTask): Promise<AgentResult> {
    const { alertType, severity, triggerAgent, details } = task.input as {
      alertType: string; severity: string; triggerAgent: string; details: Record<string, unknown>;
    };

    await this.trace('warn', `\ud83d\udea8 CEO Crisis: ${alertType} [${severity}]`, details, task.id);

    const snap     = await this.readSnapshot(task.tenantId!);
    const memories = await this.loadMemory('crisis_response', snap.empireMode);
    const protocol = this.getCrisisProtocol(alertType, snap);

    await Promise.all(protocol.immediateActions.map(action =>
      this.send({
        fromAgent: this.agentId, toAgent: action.targetAgent,
        messageType: 'COMMAND', subject: action.command,
        payload: { ...action.payload, crisisType: alertType, ceoOverride: true, severity },
        tenantId: task.tenantId, priority: 10,
      })
    ));

    await this.send({
      fromAgent: this.agentId, toAgent: 'AGENT_COACHING',
      messageType: 'COMMAND', subject: 'coaching.crisis_explanation',
      payload: { crisisType: alertType, severity, whatHappened: details,
                 whatCEODid: protocol.immediateActions.map(a => a.description),
                 expectedOutcome: protocol.expectedOutcome, estimatedResMin: protocol.estimatedResolutionMin },
      tenantId: task.tenantId, priority: 8,
    });

    await db.query(`
      INSERT INTO risk.incidents (tenant_id, severity, title, agent_id, status)
      VALUES ($1,$2,$3,'AGENT_CEO','investigating')
    `, [task.tenantId, severity, `[CEO] Crisis: ${alertType}`]);

    await this.logDecision({
      tenantId: task.tenantId!, snap, decisionType: 'crisis_protocol', requestingAgent: triggerAgent,
      decision: 'APPROVED', reasoning: `Protocol ${protocol.name} activ\u00e9`,
      predictedOutcome: 'positive', predictedImpact: 0, confidence: 0.9,
      payload: { alertType, protocol: protocol.name, memoriesUsed: memories.length },
    });

    return {
      success: true,
      output: { protocol: protocol.name, actionsTriggered: protocol.immediateActions.length, memoriesUsed: memories.length },
    };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 5. PALIER REVIEW \u2014 avec m\u00e9moire inject\u00e9e
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async palierReview(task: AgentTask): Promise<AgentResult> {
    const snap     = await this.readSnapshot(task.tenantId!);
    const memories = await this.loadMemory('palier_review', snap.empireMode);
    const memPrompt = this.buildMemoryPrompt(memories);

    const raw = await this.callLLM({
      system: 'CEO empire e-commerce autonome. JSON strict uniquement.',
      user: `REVUE STRAT\u00c9GIQUE HEBDOMADAIRE \u2014 Palier ${snap.palier}

Empire Index : ${snap.empireIndex}/100  |  Mode : ${snap.empireMode}
Progression  : ${snap.palierProgress.toFixed(1)}%
Revenue      : ${snap.revenueToday}\u20ac/j  |  Marge : ${snap.marginPct}%
Cash Runway  : ${snap.cashRunwayDays}j  |  CONDORs : ${snap.activeCondors}
OBJECTIF : ${this.palierObjective(snap.palier)}${memPrompt}

{
  "palierAssessment": "\u00c9valuation honn\u00eate 2 phrases",
  "isOnTrack": true,
  "estimatedWeeks": 0,
  "criticalGaps": ["gap"],
  "weeklyPriorities": [{ "agentId": "AGENT_XXX", "directive": "action", "whyNow": "raison" }],
  "mustStop": ["activit\u00e9 \u00e0 arr\u00eater"],
  "mustAccelerate": ["activit\u00e9 \u00e0 acc\u00e9l\u00e9rer"],
  "ceoMessage": "2 lignes directes",
  "memoriesApplied": ["r\u00e8gle utilis\u00e9e"]
}`,
      maxTokens: 1200,
    });

    let review: Record<string, unknown> = {};
    try { review = JSON.parse(raw); }
    catch { review = { weeklyPriorities: [], ceoMessage: 'Cap sur l\'objectif.' }; }

    for (const p of (review.weeklyPriorities as Array<{ agentId: string; directive: string; whyNow: string }> ?? [])) {
      await this.send({
        fromAgent: this.agentId, toAgent: p.agentId,
        messageType: 'COMMAND', subject: 'ceo.weekly_priority',
        payload: { directive: p.directive, whyNow: p.whyNow, palier: snap.palier, empireMode: snap.empireMode },
        tenantId: task.tenantId, priority: 7,
      });
    }

    await this.send({
      fromAgent: this.agentId, toAgent: 'AGENT_COACHING',
      messageType: 'COMMAND', subject: 'coaching.ceo_palier_review',
      payload: { ...review, palier: snap.palier, progressPct: snap.palierProgress, empireIndex: snap.empireIndex },
      tenantId: task.tenantId, priority: 6,
    });

    return { success: true, output: { ...review, memoriesUsed: memories.length } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 6. BOARD REPORT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async boardReport(task: AgentTask): Promise<AgentResult> {
    const snap  = await this.readSnapshot(task.tenantId!);
    const month = await this.getMonthMetrics(task.tenantId!);

    const raw = await this.callLLM({
      system: 'CEO. Board reports niveau investisseur. JSON strict.',
      user: `BOARD REPORT MENSUEL
M\u00c9TRIQUES DU MOIS : ${JSON.stringify(month)}
\u00c9TAT : Index=${snap.empireIndex} Mode=${snap.empireMode} Palier=${snap.palier}
{
  "executiveSummary": "3 phrases",
  "kpis": { "revenueEur": 0, "growthPct": 0, "marginPct": 0, "cashRunwayDays": 0, "empireIndex": 0 },
  "milestones": [], "keyDecisions": [], "challenges": [],
  "nextMonthFocus": ["priorit\u00e9 1", "priorit\u00e9 2", "priorit\u00e9 3"],
  "riskRegister": [{ "risk": "...", "mitigation": "...", "level": "HIGH" }],
  "investorMessage": "2 lignes de confiance"
}`,
      maxTokens: 2000,
    });

    let report: Record<string, unknown> = {};
    try { report = JSON.parse(raw); } catch { report = { executiveSummary: 'Rapport g\u00e9n\u00e9r\u00e9.', kpis: {} }; }

    await db.query(`
      INSERT INTO coaching.reports
        (tenant_id, report_type, period_start, period_end, summary, next_focus, key_metrics, progress_score)
      VALUES ($1,'monthly',date_trunc('month',NOW()),NOW(),$2,$3,$4::jsonb,$5)
    `, [task.tenantId, report.executiveSummary,
        (report.nextMonthFocus as string[] ?? []).join(' | '),
        JSON.stringify(report.kpis ?? {}), Math.round(snap.empireIndex)]);

    return { success: true, output: { report, empireIndex: snap.empireIndex } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 7. AGENT REALIGNMENT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async agentRealignment(task: AgentTask): Promise<AgentResult> {
    const { agentId, issue } = task.input as { agentId: string; issue: string };
    const snap = await this.readSnapshot(task.tenantId!);

    await this.send({
      fromAgent: this.agentId, toAgent: agentId,
      messageType: 'COMMAND', subject: 'ceo.realignment_directive',
      payload: { issue, expectedBehavior: this.getExpectedBehavior(agentId, snap),
                 empireMode: snap.empireMode, palier: snap.palier },
      tenantId: task.tenantId, priority: 8,
    });

    return { success: true, output: { agentRealigned: agentId } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 8. STRATEGIC PIVOT
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async strategicPivot(task: AgentTask): Promise<AgentResult> {
    const { fromMode, toMode, reason } = task.input as {
      fromMode: string; toMode: string; reason: string;
    };

    const snap       = await this.readSnapshot(task.tenantId!);
    const directives = this.getPivotDirectives(fromMode, toMode, snap);

    await this.broadcast({ fromMode, toMode, reason, empireIndex: snap.empireIndex,
                           behaviorChanges: directives.behaviorChanges },
      'ceo.empire_mode_changed', task.tenantId);

    for (const d of directives.agentDirectives) {
      await this.send({
        fromAgent: this.agentId, toAgent: d.agentId,
        messageType: 'COMMAND', subject: 'ceo.pivot_directive',
        payload: { pivotFrom: fromMode, pivotTo: toMode, newBehavior: d.newBehavior, reason },
        tenantId: task.tenantId, priority: 9,
      });
    }

    await this.send({
      fromAgent: this.agentId, toAgent: 'AGENT_COACHING',
      messageType: 'COMMAND', subject: 'coaching.ceo_pivot_explanation',
      payload: { fromMode, toMode, reason, whatChanges: directives.behaviorChanges,
                 userMessage: directives.userMessage },
      tenantId: task.tenantId, priority: 7,
    });

    await this.logDecision({
      tenantId: task.tenantId!, snap, decisionType: 'strategic_pivot',
      requestingAgent: 'AGENT_RISK_ENGINE',
      decision: 'APPROVED', reasoning: `Pivot ${fromMode} \u2192 ${toMode} : ${reason}`,
      predictedOutcome: 'positive', predictedImpact: 0, confidence: 0.85,
      payload: { fromMode, toMode, reason },
    });

    return { success: true, output: { pivot: `${fromMode}\u2192${toMode}`, directivesIssued: directives.agentDirectives.length } };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 9. CLOSE DECISION LOOP \u2014 fermeture de boucle d'apprentissage
  //    Appel\u00e9e chaque nuit par AGENT_RISK_ENGINE sur les d\u00e9cisions 48-72h
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async closeDecisionLoop(task: AgentTask): Promise<AgentResult> {
    const { decisionId, actualOutcome, actualImpact } = task.input as {
      decisionId: string; actualOutcome: string; actualImpact: number;
    };

    const r = await db.query(`
      SELECT * FROM ops.ceo_close_decision_loop($1, $2, $3, $4)
    `, [task.tenantId, decisionId, actualOutcome, actualImpact]);

    if (!r.rows.length) return { success: false, error: 'Decision not found' };

    const { was_correct, error_magnitude, error_category, should_extract } = r.rows[0];

    await this.trace(
      was_correct ? 'info' : 'warn',
      was_correct
        ? `\u2705 Boucle ferm\u00e9e : d\u00e9cision correcte (${error_category})`
        : `\u26a0\ufe0f  Boucle ferm\u00e9e : ERREUR ${error_category} \u2014 magnitude ${Number(error_magnitude).toFixed(0)}%`,
      { decisionId, actualOutcome, actualImpact, errorCategory: error_category, magnitude: error_magnitude },
      task.id
    );

    // D\u00e9clencher l'extraction si erreur significative
    if (should_extract) {
      await this.send({
        fromAgent: this.agentId, toAgent: this.agentId,
        messageType: 'COMMAND', subject: 'ceo.extract_mistake',
        payload: { decisionId, errorCategory: error_category, errorMagnitude: error_magnitude },
        tenantId: task.tenantId, priority: 7,
      });
    }

    return {
      success: true,
      output: { wasCorrect: was_correct, errorMagnitude: error_magnitude,
                errorCategory: error_category, mistakeWillBeExtracted: should_extract },
    };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 10. EXTRACT MISTAKE \u2014 extrait le pattern d'erreur et l'\u00e9crit en m\u00e9moire
  //     Le CEO analyse sa propre erreur avec le LLM et cr\u00e9e une r\u00e8gle
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async extractMistake(task: AgentTask): Promise<AgentResult> {
    const { decisionId, errorCategory, errorMagnitude } = task.input as {
      decisionId: string; errorCategory: string; errorMagnitude: number;
    };

    // Charger la d\u00e9cision compl\u00e8te
    const decR = await db.query(`
      SELECT * FROM learning.ceo_decisions WHERE id = $1
    `, [decisionId]);
    if (!decR.rows.length) return { success: false, error: 'Decision not found' };
    const dec = decR.rows[0];

    // Charger les d\u00e9cisions similaires pass\u00e9es pour le contexte
    const simiR = await db.query(`
      SELECT decision, reasoning, actual_outcome, error_magnitude, error_category
      FROM learning.ceo_decisions
      WHERE tenant_id = $1 AND decision_type = $2 AND was_correct = FALSE AND id != $3
      ORDER BY created_at DESC LIMIT 3
    `, [dec.tenant_id, dec.decision_type, decisionId]);

    // LLM analyse l'erreur et extrait le pattern
    const analysisRaw = await this.callLLM({
      system: 'Expert en r\u00e9trospective de d\u00e9cisions strat\u00e9giques. JSON strict uniquement.',
      user: `ANALYSE D'ERREUR CEO \u2014 Post-mortem

D\u00c9CISION INCORRECTE :
Type          : ${dec.decision_type}
D\u00e9cision prise: ${dec.decision}
Raisonnement  : ${dec.reasoning}
Contexte      : Index=${dec.empire_index_at} Mode=${dec.empire_mode_at} Runway=${dec.cash_runway_at}j
Payload       : ${JSON.stringify(dec.decision_payload)}
Pr\u00e9diction    : ${dec.predicted_outcome} (${dec.predicted_impact_eur}\u20ac, confiance ${dec.confidence_score})
R\u00e9alit\u00e9       : ${dec.actual_outcome} (${dec.actual_impact_eur}\u20ac)
Cat\u00e9gorie     : ${errorCategory}  |  Magnitude : ${errorMagnitude.toFixed(0)}%

ERREURS SIMILAIRES PASS\u00c9ES :
${JSON.stringify(simiR.rows, null, 2)}

Analyse cette erreur et extrait la r\u00e8gle \u00e0 ne plus r\u00e9p\u00e9ter :
{
  "mistakeType": "nom_court_sans_espaces",
  "whatHappened": "Ce qui s'est pass\u00e9 concr\u00e8tement (1-2 phrases)",
  "whyItWasWrong": "Pourquoi cette d\u00e9cision \u00e9tait incorrecte (1-2 phrases)",
  "whatToDoInstead": "R\u00e8gle pr\u00e9cise et v\u00e9rifiable la prochaine fois (1-2 phrases)",
  "detectionRule": { "field": "avg_fatigue", "operator": ">", "threshold": 65 },
  "memoryTitle": "Titre court max 80 chars",
  "memoryContent": "Texte complet pour injection dans prompt LLM : contexte + erreur + r\u00e8gle extraite",
  "estimatedLossEur": 0,
  "severity": "LOW|MEDIUM|HIGH|CRITICAL"
}`,
      maxTokens: 700,
    });

    let analysis: Record<string, unknown> = {};
    try { analysis = JSON.parse(analysisRaw); }
    catch { return { success: false, error: `Analyse \u00e9chou\u00e9: ${analysisRaw.substring(0, 100)}` }; }

    // V\u00e9rifier si ce pattern existe d\u00e9j\u00e0 (upsert avec mise \u00e0 jour du poids)
    const existR = await db.query(`
      SELECT id, occurrences, total_loss_eur FROM learning.ceo_mistakes
      WHERE (tenant_id = $1 OR tenant_id IS NULL) AND mistake_type = $2 AND decision_type = $3
    `, [dec.tenant_id, analysis.mistakeType, dec.decision_type]);

    if (existR.rows.length > 0) {
      const ex          = existR.rows[0];
      const newOcc      = Number(ex.occurrences) + 1;
      const newLoss     = Number(ex.total_loss_eur) + Number(analysis.estimatedLossEur ?? 0);
      const newWeight   = Math.min(5.0, 1.0 + newOcc * 0.5 + errorMagnitude / 100);

      await db.query(`
        UPDATE learning.ceo_mistakes SET
          occurrences=$1, total_loss_eur=$2, memory_weight=$3,
          last_seen_at=NOW(), last_decision_id=$4,
          avg_error_magnitude=(avg_error_magnitude+$5)/2, updated_at=NOW()
        WHERE id=$6
      `, [newOcc, newLoss, newWeight, decisionId, errorMagnitude, ex.id]);

      await db.query(`
        UPDATE learning.ceo_memory SET
          weight=$1, memory_content=$2, updated_at=NOW()
        WHERE memory_scope=$3 AND memory_title=$4
      `, [newWeight, analysis.memoryContent, dec.decision_type, analysis.memoryTitle]);

      await this.trace('warn',
        `\ud83d\udd01 ERREUR R\u00c9P\u00c9T\u00c9E \u00d7${newOcc} : ${analysis.mistakeType} (poids=${newWeight.toFixed(1)}, perte cumul\u00e9e=${newLoss}\u20ac)`,
        { mistakeType: analysis.mistakeType, occurrences: newOcc, totalLoss: newLoss, newWeight },
        task.id
      );
    } else {
      // Nouveau pattern d'erreur
      await db.query(`
        INSERT INTO learning.ceo_mistakes
          (tenant_id, mistake_type, decision_type, empire_mode_context,
           what_happened, why_it_was_wrong, what_to_do_instead, detection_rule,
           avg_error_magnitude, total_loss_eur, last_decision_id, memory_weight)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12)
      `, [
        dec.tenant_id, analysis.mistakeType, dec.decision_type, dec.empire_mode_at,
        analysis.whatHappened, analysis.whyItWasWrong, analysis.whatToDoInstead,
        JSON.stringify(analysis.detectionRule ?? {}),
        errorMagnitude, analysis.estimatedLossEur ?? 0, decisionId,
        1.0 + errorMagnitude / 100,
      ]);

      // \u00c9crire en m\u00e9moire CEO pour injection future
      await db.query(`
        INSERT INTO learning.ceo_memory
          (tenant_id, memory_scope, empire_mode_context, memory_title, memory_content,
           source_type, source_decision_ids, weight)
        VALUES ($1,$2,$3,$4,$5,'mistake',ARRAY[$6::uuid],$7)
        ON CONFLICT DO NOTHING
      `, [
        dec.tenant_id, dec.decision_type, dec.empire_mode_at,
        analysis.memoryTitle, analysis.memoryContent,
        decisionId, 1.0 + errorMagnitude / 100,
      ]);

      await this.trace('warn',
        `\ud83c\udd95 NOUVEAU PATTERN ERREUR extrait : ${analysis.mistakeType} (s\u00e9v\u00e9rit\u00e9: ${analysis.severity})`,
        { severity: analysis.severity, estimatedLoss: analysis.estimatedLossEur,
          rule: analysis.whatToDoInstead }, task.id
      );
    }

    // Informer COACHING \u2014 l'utilisateur voit que le CEO a appris
    await this.send({
      fromAgent: this.agentId, toAgent: 'AGENT_COACHING',
      messageType: 'EVENT', subject: 'ceo.learned_from_mistake',
      payload: { mistakeType: analysis.mistakeType, decisionType: dec.decision_type,
                 newRule: analysis.memoryTitle, errorMagnitude, severity: analysis.severity },
      tenantId: dec.tenant_id, priority: 5,
    });

    return {
      success: true,
      output: { mistakeExtracted: analysis.mistakeType, memoryWritten: analysis.memoryTitle,
                severity: analysis.severity, estimatedLoss: analysis.estimatedLossEur },
    };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // 11. CONSOLIDATE MEMORY \u2014 Lundi 4h, ajuste les poids de la m\u00e9moire
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async consolidateMemory(task: AgentTask): Promise<AgentResult> {
    // D\u00e9sactiver les m\u00e9moires jamais utilis\u00e9es depuis 30j
    const deactivated = await db.query(`
      UPDATE learning.ceo_memory SET is_active=FALSE, updated_at=NOW()
      WHERE is_active=TRUE
        AND (tenant_id=$1 OR tenant_id IS NULL)
        AND updated_at < NOW() - INTERVAL '30 days'
        AND times_applied < 3
      RETURNING id
    `, [task.tenantId]);

    // Booster les m\u00e9moires qui ont prouv\u00e9 leur valeur
    const boosted = await db.query(`
      UPDATE learning.ceo_memory
      SET weight=LEAST(5.0, weight+0.5), updated_at=NOW()
      WHERE is_active=TRUE
        AND (tenant_id=$1 OR tenant_id IS NULL)
        AND prevented_errors > 2
        AND updated_at > NOW() - INTERVAL '7 days'
      RETURNING id
    `, [task.tenantId]);

    // Recalculer le poids des mistakes selon leur co\u00fbt r\u00e9el
    await db.query(`
      UPDATE learning.ceo_mistakes mk SET
        memory_weight = LEAST(5.0,
          1.0
          + (occurrences * 0.4)
          + (avg_error_magnitude / 100)
          + CASE WHEN total_loss_eur > 1000 THEN 1.0 ELSE 0 END
          + CASE WHEN total_loss_eur > 5000 THEN 1.0 ELSE 0 END
        ),
        updated_at = NOW()
      WHERE tenant_id=$1 OR tenant_id IS NULL
    `, [task.tenantId]);

    const stats = await db.query(`
      SELECT COUNT(*) FILTER (WHERE is_active) AS active,
             COUNT(*) FILTER (WHERE NOT is_active) AS inactive,
             AVG(weight) FILTER (WHERE is_active) AS avg_weight,
             SUM(prevented_errors) AS total_prevented
      FROM learning.ceo_memory WHERE tenant_id=$1 OR tenant_id IS NULL
    `, [task.tenantId]);

    await this.trace('info', '\ud83e\udde0 M\u00e9moire CEO consolid\u00e9e', {
      deactivated: deactivated.rowCount, boosted: boosted.rowCount, stats: stats.rows[0],
    }, task.id);

    return {
      success: true,
      output: { memoriesDeactivated: deactivated.rowCount, memoriesBoosted: boosted.rowCount,
                activeMemories: stats.rows[0]?.active, totalPrevented: stats.rows[0]?.total_prevented,
                avgWeight: Number(stats.rows[0]?.avg_weight ?? 0).toFixed(2) },
    };
  }

  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550
  // HELPERS
  // \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

  private async readSnapshot(tenantId: string): Promise<SystemSnapshot> {
    const [empire, capital, snap, agents, alerts, pending] = await Promise.all([
      db.query(`SELECT es.empire_index,es.empire_mode,es.palier,es.palier_progress_pct,
                       es.hard_constraint_triggered,es.constraint_reason,sc.scale_signal
                FROM ops.empire_state es
                LEFT JOIN ops.scale_clearance sc ON sc.tenant_id=es.tenant_id
                WHERE es.tenant_id=$1`, [tenantId]),
      db.query(`SELECT cash_runway_days,cash_balance_eur FROM ops.capital_live WHERE tenant_id=$1`, [tenantId]),
      db.query(`SELECT revenue_eur,contribution_margin_pct,active_condors,avg_fatigue_score,
                       (SELECT COUNT(*) FROM creative.awareness_matrix
                        WHERE empire_condor_flag=TRUE AND decay_detected=TRUE AND tenant_id=$1) AS decay_count
                FROM ops.snapshot_daily WHERE tenant_id=$1 AND snapshot_date=CURRENT_DATE`, [tenantId]),
      db.query(`SELECT COUNT(*) FILTER (WHERE status='running') AS r,
                       COUNT(*) FILTER (WHERE status='error') AS e
                FROM agent_registry WHERE status!='disabled'`),
      db.query(`SELECT severity,title,agent_id FROM risk.incidents
                WHERE tenant_id=$1 AND status IN ('open','investigating') LIMIT 10`, [tenantId]),
      db.query(`SELECT COUNT(*) AS cnt FROM ops.simulation_log
                WHERE tenant_id=$1 AND status='proposed'`, [tenantId]),
    ]);

    const e=empire.rows[0]??{}, c=capital.rows[0]??{}, s=snap.rows[0]??{}, a=agents.rows[0]??{};
    return {
      tenantId,
      empireIndex:      Number(e.empire_index??0),
      empireMode:       e.empire_mode??'ADAPTATIF',
      palier:           Number(e.palier??1),
      palierProgress:   Number(e.palier_progress_pct??0),
      hardConstraint:   Boolean(e.hard_constraint_triggered),
      constraintReason: e.constraint_reason??null,
      cashRunwayDays:   Number(c.cash_runway_days??0),
      cashBalance:      Number(c.cash_balance_eur??0),
      revenueToday:     Number(s.revenue_eur??0),
      marginPct:        Number(s.contribution_margin_pct??0),
      activeCondors:    Number(s.active_condors??0),
      avgFatigue:       Number(s.avg_fatigue_score??0),
      decayCount:       Number(s.decay_count??0),
      scaleSignal:      e.scale_signal??'GO_CONSERVATIVE',
      agentsError:      Number(a.e??0),
      pendingDecisions: Number(pending.rows[0]?.cnt??0),
      activeAlerts:     alerts.rows.map((r: Record<string,unknown>) => ({
        severity: r.severity as string, title: r.title as string, agentId: r.agent_id as string,
      })),
    };
  }

  private async detectAndCorrect(snap: SystemSnapshot, tenantId: string): Promise<string[]> {
    const actions: string[] = [];
    if (snap.empireIndex < 40) {
      await this.send({ fromAgent: this.agentId, toAgent: 'AGENT_RISK_ENGINE',
        messageType: 'COMMAND', subject: 'empire.emergency_assessment',
        payload: { urgent: true }, tenantId, priority: 10 });
      actions.push('emergency_assessment');
    }
    if (snap.activeCondors === 0 && snap.avgFatigue > 70) {
      await this.send({ fromAgent: this.agentId, toAgent: 'AGENT_CREATIVE_FACTORY',
        messageType: 'COMMAND', subject: 'creative.emergency_refresh',
        payload: { urgent: true }, tenantId, priority: 9 });
      actions.push('creative_refresh');
    }
    if (snap.cashRunwayDays < 30 && snap.cashRunwayDays > 0) {
      await this.send({ fromAgent: this.agentId, toAgent: 'AGENT_BUDGET_ALLOCATOR',
        messageType: 'COMMAND', subject: 'budget.conservative_mode',
        payload: { runwayDays: snap.cashRunwayDays }, tenantId, priority: 10 });
      actions.push('budget_conservative');
    }
    return actions;
  }

  private async activateDefensiveMode(tenantId: string, snap: SystemSnapshot): Promise<void> {
    await Promise.all(
      [['AGENT_SCALE_ENGINE','scale.freeze_all'],
       ['AGENT_MEDIA_BUYER','media.pause_aggressive'],
       ['AGENT_BUDGET_ALLOCATOR','budget.survival_mode']].map(([agent,cmd]) =>
        this.send({ fromAgent: this.agentId, toAgent: agent, messageType: 'COMMAND', subject: cmd,
          payload: { reason: snap.constraintReason ?? snap.empireMode, ceoOverride: true },
          tenantId, priority: 10 })
      )
    );
  }

  private async blockDecision(task: AgentTask, agent: string, type: string,
                               simId: string | undefined, reason: string): Promise<void> {
    if (simId) await db.query(
      `UPDATE ops.simulation_log SET status='rejected',approved_by='AGENT_CEO',rejection_reason=$1 WHERE id=$2`,
      [reason, simId]
    );
    await this.send({ fromAgent: this.agentId, toAgent: agent, messageType: 'RESPONSE',
      subject: 'ceo.decision_blocked',
      payload: { blocked: true, reason, blockedBy: 'AGENT_CEO', decisionType: type },
      tenantId: task.tenantId, priority: 9 });
  }

  private getCrisisProtocol(alertType: string, snap: SystemSnapshot) {
    const protocols: Record<string, {
      name: string;
      immediateActions: { targetAgent: string; command: string; payload: Record<string,unknown>; description: string }[];
      expectedOutcome: string;
      estimatedResolutionMin: number;
    }> = {
      stop_loss_triggered: {
        name: 'STOP_LOSS', estimatedResolutionMin: 60, expectedOutcome: 'Stabilisation dans 30min',
        immediateActions: [
          { targetAgent: 'AGENT_SCALE_ENGINE', command: 'scale.emergency_freeze',  payload: {},                                    description: 'Gel imm\u00e9diat de tous les scalings' },
          { targetAgent: 'AGENT_OPS_GUARD',    command: 'ops.budget_cap',          payload: { maxDaily: snap.revenueToday * 0.2 }, description: 'Cap budg\u00e9taire \u00e0 20% du revenue' },
          { targetAgent: 'AGENT_RISK_ENGINE',  command: 'empire.assess_risk',      payload: { emergency: true },                   description: 'R\u00e9\u00e9valuation risk_score' },
        ],
      },
      all_condors_fatigued: {
        name: 'CREATIVE_CRISIS', estimatedResolutionMin: 4320, expectedOutcome: 'Nouveaux CONDORs 48-72h',
        immediateActions: [
          { targetAgent: 'AGENT_CREATIVE_FACTORY', command: 'creative.emergency_matrix', payload: { urgent: true }, description: '30 briefs en urgence' },
          { targetAgent: 'AGENT_SCALE_ENGINE',     command: 'scale.reduce_fatigued',     payload: { reductionPct: 30 }, description: '-30% d\u00e9penses cr\u00e9atives mortes' },
          { targetAgent: 'AGENT_LEARNING',         command: 'learning.emergency_extract', payload: {},                description: 'Extraction patterns survie' },
        ],
      },
      cash_runway_critical: {
        name: 'RUNWAY_CRITICAL', estimatedResolutionMin: 0, expectedOutcome: 'Pr\u00e9servation tr\u00e9sorerie',
        immediateActions: [
          { targetAgent: 'AGENT_BUDGET_ALLOCATOR', command: 'budget.survival_mode', payload: { maxDaily: 50 }, description: 'Mode survie minimum vital' },
          { targetAgent: 'AGENT_SCALE_ENGINE',     command: 'scale.freeze_all',     payload: {},              description: 'Gel total du scaling' },
        ],
      },
    };
    return protocols[alertType] ?? {
      name: 'GENERIC', expectedOutcome: '\u00c9valuation en cours', estimatedResolutionMin: 30,
      immediateActions: [
        { targetAgent: 'AGENT_OPS_GUARD', command: 'ops.assess_situation', payload: {}, description: '\u00c9valuation g\u00e9n\u00e9rale' },
      ],
    };
  }

  private getPivotDirectives(from: string, to: string, snap: SystemSnapshot) {
    const t: Record<string, {
      behaviorChanges: string[];
      agentDirectives: { agentId: string; newBehavior: string }[];
      userMessage: string;
    }> = {
      'ADAPTATIF\u2192AGGRESSIF': {
        behaviorChanges: ['SCALE_ENGINE : +20% d\u00e8s marge >10%', 'CREATIVE_FACTORY : 60 briefs/sem'],
        agentDirectives: [
          { agentId: 'AGENT_SCALE_ENGINE',     newBehavior: 'Scale +20% d\u00e8s marge >10%' },
          { agentId: 'AGENT_CREATIVE_FACTORY', newBehavior: '60 briefs/semaine \u2014 volume max' },
          { agentId: 'AGENT_BUDGET_ALLOCATOR', newBehavior: '40% du cash sur les CONDORs actifs' },
        ],
        userMessage: `Empire Index ${snap.empireIndex}/100 \u2014 AGGRESSIF activ\u00e9. Les agents poussent fort.`,
      },
      'ADAPTATIF\u2192SURVIE': {
        behaviorChanges: ['Tous scalings gel\u00e9s', 'Budget minimum vital 50\u20ac/j'],
        agentDirectives: [
          { agentId: 'AGENT_SCALE_ENGINE',     newBehavior: 'GEL TOTAL. Z\u00e9ro scaling.' },
          { agentId: 'AGENT_CREATIVE_FACTORY', newBehavior: 'Angles gratuits uniquement \u2014 5 briefs max.' },
        ],
        userMessage: `Empire Index critique (${snap.empireIndex}/100). Mode SURVIE activ\u00e9. D\u00e9penses gel\u00e9es.`,
      },
      'SURVIE\u2192ADAPTATIF': {
        behaviorChanges: ['Reprise prudente', 'Scale conservateur +10% max'],
        agentDirectives: [
          { agentId: 'AGENT_SCALE_ENGINE',     newBehavior: 'Reprise prudente. +10% max si marge >15%.' },
          { agentId: 'AGENT_CREATIVE_FACTORY', newBehavior: '15 briefs/semaine sur angles prouv\u00e9s.' },
        ],
        userMessage: `Empire Index ${snap.empireIndex}/100. Sortie de SURVIE. Reprise prudente en ADAPTATIF.`,
      },
      'AGGRESSIF\u2192INSTITUTIONNEL': {
        behaviorChanges: ['Retour seuils standard', 'PORTFOLIO_OPT activ\u00e9', 'Diversification canaux'],
        agentDirectives: [
          { agentId: 'AGENT_SCALE_ENGINE',  newBehavior: 'R\u00e8gles standard \u2014 s\u00e9curiser les gains.' },
          { agentId: 'AGENT_PORTFOLIO_OPT', newBehavior: 'G\u00e9rer et optimiser le portefeuille multi-produits.' },
        ],
        userMessage: 'Mode INSTITUTIONNEL \u2014 on s\u00e9curise les acquis. Croissance durable.',
      },
    };
    const key = `${from}\u2192${to}`;
    return t[key] ?? {
      behaviorChanges: [`Adaptation au mode ${to}`], agentDirectives: [],
      userMessage: `Pivot ${from}\u2192${to} en cours.`,
    };
  }

  private getExpectedBehavior(agentId: string, snap: SystemSnapshot): string {
    const b: Record<string, Record<string, string>> = {
      'AGENT_SCALE_ENGINE':     { 'AGGRESSIF': '+20% d\u00e8s marge >10%', 'INSTITUTIONNEL': '+20% si >15%', 'ADAPTATIF': '+10% max', 'SURVIE': 'Gel total' },
      'AGENT_CREATIVE_FACTORY': { 'AGGRESSIF': '60 briefs/sem', 'INSTITUTIONNEL': '30 briefs/sem', 'ADAPTATIF': '15 briefs/sem', 'SURVIE': '5 briefs gratuits' },
      'AGENT_BUDGET_ALLOCATOR': { 'AGGRESSIF': '40% cash sur CONDORs', 'INSTITUTIONNEL': '25% max', 'ADAPTATIF': '15% max', 'SURVIE': '50\u20ac/j' },
    };
    return b[agentId]?.[snap.empireMode] ?? `Fonctionner en mode ${snap.empireMode} selon les guardrails standard.`;
  }

  private async getMonthMetrics(tenantId: string): Promise<Record<string, unknown>> {
    const r = await db.query(`
      SELECT SUM(revenue_eur) AS revenue, AVG(contribution_margin_pct) AS margin,
             AVG(empire_index) AS avg_empire, MIN(cash_runway_days) AS min_runway
      FROM ops.snapshot_daily
      WHERE tenant_id=$1 AND snapshot_date >= date_trunc('month',NOW())
    `, [tenantId]);
    return r.rows[0] ?? {};
  }

  private palierLabel     = (p: number) => ({ 1: '0\u21921M\u20ac', 2: '1M\u219210M\u20ac', 3: '10M\u2192120M\u20ac' }[p] ?? '');
  private palierObjective = (p: number) => ({
    1: 'Premier CONDOR \u2014 atteindre 1 000\u20ac/jour stable en CRUISE',
    2: 'Scaler les CONDORs \u2014 5 000\u20ac/jour pour activer l\'Ecosystem Loop',
    3: 'Empire multi-marques \u2014 30 000\u20ac/jour + expansion internationale',
  }[p] ?? '');

  private async callLLM(opts: { system: string; user: string; maxTokens: number }): Promise<string> {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514', max_tokens: opts.maxTokens,
        system: opts.system, messages: [{ role: 'user', content: opts.user }],
      }),
    });
    const data = await res.json() as { content: { type: string; text: string }[] };
    return data.content.find(b => b.type === 'text')?.text ?? '';
  }
}
