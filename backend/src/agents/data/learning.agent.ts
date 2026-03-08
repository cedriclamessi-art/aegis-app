/**
 * AGENT_INNOVATION \u2014 Veille tactique + mise \u00e0 jour des couches tactiques
 * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Mission : d\u00e9tecter quand les r\u00e8gles internes d'AEGIS deviennent obsol\u00e8tes
 *           et proposer des mises \u00e0 jour concr\u00e8tes bas\u00e9es sur la data r\u00e9elle.
 *
 * Ce qu'il surveille :
 *   \u2022 CPM spikes \u2192 saturation d'audience \u2192 changer les formats
 *   \u2022 Benchmarks CPA/ROAS qui d\u00e9rivent \u2192 r\u00e9viser les seuils winner_detector
 *   \u2022 Angles morts \u2192 retirer de la rotation cr\u00e9ative
 *   \u2022 Nouvelles r\u00e8gles Meta/TikTok \u2192 adapter l'Entity ID, les formats
 *   \u2022 R\u00e8gles de scale devenues sous-optimales \u2192 recalibrer +20%/+10%/-20%
 *
 * Cycle : lundis + jeudis \u00e0 9h \u2192 scan \u2192 propose \u2192 (humain valide) \u2192 applique
 *
 * Ce qui se met \u00e0 jour automatiquement (sans validation humaine) :
 *   \u2022 Benchmarks CPA/ROAS dans ops.runtime_config (si confidence >= 0.85)
 *   \u2022 Dead angles dans creative.awareness_matrix (d\u00e9sactivation)
 *   \u2022 Seuils scale +/- dans ops.runtime_config (si win_rate > 0.75 sur 30+ cas)
 *
 * Ce qui n\u00e9cessite validation humaine :
 *   \u2022 Changement de la formule winner (contribution margin threshold)
 *   \u2022 Nouveau pipeline funnel
 *   \u2022 Modification des guardrails financiers
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';

export class InnovationAgent extends AgentBase {
  readonly agentId = 'AGENT_INNOVATION';

  readonly supportedTasks = [
    'innovation.scan',
    'innovation.propose',
    'innovation.backlog',
    'innovation.brief',
    'innovation.apply_auto',  // auto-application des mises \u00e0 jour sans risque
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'innovation.scan':        return this.scan(task);
      case 'innovation.propose':     return this.propose(task);
      case 'innovation.apply_auto':  return this.applyAutoUpdates(task);
      case 'innovation.backlog':     return this.buildBacklog(task);
      default: throw new Error(`Task non support\u00e9e: ${task.taskType}`);
    }
  }

  // \u2500\u2500 1. Scan des signaux (lundis + jeudis) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async scan(task: AgentTask): Promise<AgentResult> {
    await this.trace('info', '\ud83d\udd2d Scan signaux tactiques', {});

    const signals = await Promise.all([
      this.detectCPMSpike(task.tenantId),
      this.detectBenchmarkDrift(task.tenantId),
      this.detectAudienceFatigue(task.tenantId),
      this.detectRuleObsolescence(task.tenantId),
      this.detectPatternFromLearning(task.tenantId),
    ]);

    const allSignals = signals.flat().filter(Boolean) as Signal[];
    let saved = 0;

    for (const signal of allSignals) {
      await db.query(
        `INSERT INTO innovation.signals
           (signal_type, platform, source, title, description, evidence, severity, confidence)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [
          signal.signal_type, signal.platform, signal.source,
          signal.title, signal.description,
          JSON.stringify(signal.evidence),
          signal.severity, signal.confidence,
        ]
      );
      saved++;
    }

    if (saved > 0) {
      // D\u00e9clencher la phase de proposition
      await db.query(
        `INSERT INTO jobs.queue (tenant_id, task_type, payload, priority, scheduled_at)
         VALUES ($1, 'innovation.propose', $2::jsonb, 6, NOW() + INTERVAL '5 minutes')`,
        [task.tenantId, JSON.stringify({ signalsCount: saved })]
      );
    }

    await this.trace('info', `${saved} signaux d\u00e9tect\u00e9s`, { saved });
    return { success: true, output: { signalsDetected: saved, signals: allSignals.map(s => s.title) } };
  }

  // \u2500\u2500 D\u00e9tection CPM spike (saturation audience) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async detectCPMSpike(tenantId: string | undefined): Promise<Signal[]> {
    const r = await db.query(
      `SELECT
         p.platform,
         AVG(ap.cpm)       AS avg_cpm_recent,
         PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY ap.cpm) AS median_cpm_30d
       FROM ads.performance_hourly ap
       JOIN ads.entities ae ON ae.id = ap.entity_id
       JOIN store.products p ON p.id = ae.product_id
       WHERE ap.tenant_id = $1
         AND ap.recorded_at >= NOW() - INTERVAL '7 days'
         AND ap.cpm IS NOT NULL
       GROUP BY p.platform`,
      [tenantId]
    );

    const signals: Signal[] = [];
    for (const row of r.rows) {
      const spike = (Number(row.avg_cpm_recent) / Number(row.median_cpm_30d)) - 1;
      if (spike > 0.3) {  // CPM en hausse de +30%
        signals.push({
          signal_type: 'cpm_spike',
          platform: row.platform,
          source: 'performance_data',
          title: `CPM spike +${(spike * 100).toFixed(0)}% sur ${row.platform}`,
          description: `Le CPM a augment\u00e9 de ${(spike * 100).toFixed(0)}% cette semaine vs la m\u00e9diane 30j. Signal de saturation d'audience ou de changement d'algo.`,
          evidence: { avg_cpm_recent: row.avg_cpm_recent, median_cpm_30d: row.median_cpm_30d, spike_pct: spike * 100 },
          severity: spike > 0.6 ? 'high' : 'medium',
          confidence: Math.min(0.7 + spike * 0.5, 0.95),
        });
      }
    }
    return signals;
  }

  // \u2500\u2500 D\u00e9tection d\u00e9rive des benchmarks CPA/ROAS \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async detectBenchmarkDrift(tenantId: string | undefined): Promise<Signal[]> {
    // Comparer CPA actuel (7j) vs benchmark stock\u00e9 dans ops.runtime_config
    const r = await db.query(
      `SELECT
         AVG(c.cpa)        AS avg_cpa_recent,
         AVG(c.roas)       AS avg_roas_recent,
         (SELECT value::decimal FROM ops.runtime_config
          WHERE key = 'guardrails.cpa_benchmark' AND (tenant_id=$1 OR tenant_id IS NULL) LIMIT 1) AS cpa_benchmark,
         (SELECT value::decimal FROM ops.runtime_config
          WHERE key = 'guardrails.roas_min_seed' AND (tenant_id=$1 OR tenant_id IS NULL) LIMIT 1) AS roas_benchmark
       FROM ads.cbo_campaigns c
       WHERE c.tenant_id = $1
         AND c.updated_at >= NOW() - INTERVAL '7 days'
         AND c.cpa IS NOT NULL`,
      [tenantId]
    );

    const signals: Signal[] = [];
    if (r.rows[0]?.avg_cpa_recent && r.rows[0]?.cpa_benchmark) {
      const drift = Math.abs(Number(r.rows[0].avg_cpa_recent) - Number(r.rows[0].cpa_benchmark))
                    / Number(r.rows[0].cpa_benchmark);
      if (drift > 0.20) {  // d\u00e9rive >20%
        signals.push({
          signal_type: 'benchmark_drift',
          platform: 'meta',
          source: 'performance_data',
          title: `Benchmark CPA d\u00e9vi\u00e9 de ${(drift * 100).toFixed(0)}%`,
          description: `CPA r\u00e9el (${Number(r.rows[0].avg_cpa_recent).toFixed(2)}\u20ac) vs benchmark (${Number(r.rows[0].cpa_benchmark).toFixed(2)}\u20ac). Le seuil winner_detector est peut-\u00eatre mal calibr\u00e9.`,
          evidence: { avg_cpa_recent: r.rows[0].avg_cpa_recent, cpa_benchmark: r.rows[0].cpa_benchmark, drift_pct: drift * 100 },
          severity: drift > 0.4 ? 'high' : 'medium',
          confidence: 0.80,
        });
      }
    }
    return signals;
  }

  // \u2500\u2500 D\u00e9tection fatigue audience \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async detectAudienceFatigue(tenantId: string | undefined): Promise<Signal[]> {
    const r = await db.query(
      `SELECT
         AVG(c.frequency) AS avg_freq,
         AVG(c.roas)      AS avg_roas
       FROM ads.cbo_campaigns c
       WHERE c.tenant_id = $1
         AND c.updated_at >= NOW() - INTERVAL '7 days'
         AND c.frequency IS NOT NULL`,
      [tenantId]
    );

    const signals: Signal[] = [];
    const freq = Number(r.rows[0]?.avg_freq ?? 0);
    if (freq > 3.0) {
      signals.push({
        signal_type: 'audience_fatigue',
        platform: 'meta',
        source: 'performance_data',
        title: `Fatigue audience \u2014 fr\u00e9quence moyenne ${freq.toFixed(1)}`,
        description: `Fr\u00e9quence > 3.0 = l'audience a vu les ads trop souvent. Il faut de nouvelles cr\u00e9atives avec des Entity IDs diff\u00e9rents, ou \u00e9largir le ciblage.`,
        evidence: { avg_frequency: freq, avg_roas: r.rows[0]?.avg_roas },
        severity: freq > 5.0 ? 'critical' : 'high',
        confidence: 0.90,
      });
    }
    return signals;
  }

  // \u2500\u2500 D\u00e9tection r\u00e8gles obsol\u00e8tes \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async detectRuleObsolescence(tenantId: string | undefined): Promise<Signal[]> {
    // V\u00e9rifier si les r\u00e8gles de scale (+20%/+10%/-20%) correspondent \u00e0 la data r\u00e9elle
    const r = await db.query(
      `SELECT
         sd.action,
         COUNT(*) FILTER (WHERE sd.roas_at_decision > 1.5) AS success_count,
         COUNT(*) AS total_count
       FROM ads.scale_decisions sd
       WHERE sd.tenant_id = $1
         AND sd.decision_at >= NOW() - INTERVAL '30 days'
       GROUP BY sd.action
       HAVING COUNT(*) >= 5`,
      [tenantId]
    );

    const signals: Signal[] = [];
    for (const row of r.rows) {
      const winRate = Number(row.success_count) / Number(row.total_count);
      if (winRate < 0.45) {  // moins de 45% de succ\u00e8s \u2192 r\u00e8gle sous-optimale
        signals.push({
          signal_type: 'rule_obsolescence',
          platform: 'meta',
          source: 'performance_data',
          title: `R\u00e8gle "${row.action}" sous-performante (win rate ${(winRate * 100).toFixed(0)}%)`,
          description: `La r\u00e8gle de scale "${row.action}" ne fonctionne que dans ${(winRate * 100).toFixed(0)}% des cas sur les 30 derniers jours. Elle devrait \u00eatre recalibr\u00e9e.`,
          evidence: { action: row.action, win_rate: winRate, sample: row.total_count },
          severity: 'medium',
          confidence: Math.min(0.5 + (1 - winRate), 0.90),
        });
      }
    }
    return signals;
  }

  // \u2500\u2500 Patterns re\u00e7us de AGENT_LEARNING \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async detectPatternFromLearning(tenantId: string | undefined): Promise<Signal[]> {
    // Lire les messages DATA_PUSH de LEARNING non encore trait\u00e9s
    const r = await db.query(
      `SELECT payload FROM agents.messages
       WHERE to_agent = $1 AND from_agent = 'AGENT_LEARNING'
         AND message_type = 'DATA_PUSH' AND status = 'read'
         AND created_at >= NOW() - INTERVAL '7 days'
       LIMIT 5`,
      [this.agentId]
    );

    const signals: Signal[] = [];
    for (const row of r.rows) {
      const payload = row.payload as Record<string, unknown>;
      if (payload?.deadAnglesCount && Number(payload.deadAnglesCount) > 3) {
        signals.push({
          signal_type: 'competitor_creative_shift',
          platform: 'all',
          source: 'performance_data',
          title: `${payload.deadAnglesCount} angles morts cette semaine`,
          description: `${payload.deadAnglesCount} angles marketing ne convertissent plus. Renouveler la matrice cr\u00e9ative.`,
          evidence: payload,
          severity: 'medium',
          confidence: 0.85,
        });
      }
    }
    return signals;
  }

  // \u2500\u2500 2. G\u00e9n\u00e9rer des propositions de mise \u00e0 jour \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async propose(task: AgentTask): Promise<AgentResult> {
    // R\u00e9cup\u00e9rer les signaux r\u00e9cents non trait\u00e9s
    const signals = await db.query(
      `SELECT * FROM innovation.signals
       WHERE acted_upon = FALSE
         AND detected_at >= NOW() - INTERVAL '7 days'
       ORDER BY severity DESC, confidence DESC
       LIMIT 20`
    );

    let proposed = 0;
    const autoApply: Update[] = [];
    const needsHuman: Update[] = [];

    for (const signal of signals.rows) {
      const updates = this.buildUpdatesFromSignal(signal);
      for (const update of updates) {
        await db.query(
          `INSERT INTO innovation.tactical_updates
             (signal_id, update_type, target_agent, target_config_key,
              description, current_value, proposed_value, rationale, status)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,'proposed')`,
          [
            signal.id,
            update.update_type, update.target_agent, update.target_config_key,
            update.description,
            JSON.stringify(update.current_value),
            JSON.stringify(update.proposed_value),
            update.rationale,
          ]
        );
        proposed++;

        if (update.auto_apply) autoApply.push(update);
        else needsHuman.push(update);
      }
    }

    // Auto-appliquer les mises \u00e0 jour sans risque
    if (autoApply.length > 0) {
      await db.query(
        `INSERT INTO jobs.queue (tenant_id, task_type, payload, priority, scheduled_at)
         VALUES ($1, 'innovation.apply_auto', $2::jsonb, 5, NOW() + INTERVAL '10 minutes')`,
        [task.tenantId, JSON.stringify({ updates: autoApply })]
      );
    }

    // Notifier l'humain pour les mises \u00e0 jour qui n\u00e9cessitent validation
    if (needsHuman.length > 0) {
      await db.query(
        `INSERT INTO agents.messages
           (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
         VALUES ($1,$2,'AGENT_ORCHESTRATOR','ALERT','TACTICAL_UPDATES_PENDING',$3::jsonb,7,NOW())`,
        [
          task.tenantId, this.agentId,
          JSON.stringify({
            count: needsHuman.length,
            message: `${needsHuman.length} mises \u00e0 jour tactiques en attente de validation humaine.`,
            view: 'SELECT * FROM innovation.pending_updates;',
            updates: needsHuman.map(u => u.description),
          }),
        ]
      );
    }

    return { success: true, output: { proposed, autoApply: autoApply.length, needsHuman: needsHuman.length } };
  }

  // \u2500\u2500 Construire les mises \u00e0 jour depuis un signal \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private buildUpdatesFromSignal(signal: Record<string, unknown>): Update[] {
    const builders: Record<string, (s: Record<string, unknown>) => Update[]> = {

      cpm_spike: (s) => [{
        update_type:       'agent_config',
        target_agent:      'AGENT_CREATIVE_FACTORY',
        target_config_key: null,
        description:       `CPM spike +${(s.evidence as Record<string, unknown>)?.spike_pct ?? 0}% \u2192 forcer renouvellement Entity ID`,
        current_value:     { rotation: 'normal' },
        proposed_value:    { rotation: 'forced', forceEntityChange: true, urgency: 'high' },
        rationale:         `CPM en hausse = saturation. Changer format/persona/d\u00e9cor imm\u00e9diatement.`,
        auto_apply:        true,
      }],

      benchmark_drift: (s) => [{
        update_type:       'guardrail_update',
        target_agent:      'AGENT_WINNER_DETECTOR',
        target_config_key: 'winner.min_contribution_margin_pct',
        description:       `Recalibrer le seuil CPA dans winner_detector`,
        current_value:     { cpa_benchmark: (s.evidence as Record<string, unknown>)?.cpa_benchmark },
        proposed_value:    { cpa_benchmark: (s.evidence as Record<string, unknown>)?.avg_cpa_recent },
        rationale:         `Le CPA r\u00e9el s'est \u00e9loign\u00e9 de ${(s.evidence as Record<string, unknown>)?.drift_pct ?? 0}% du benchmark. Mise \u00e0 jour n\u00e9cessaire.`,
        auto_apply:        Number((s.confidence as number) ?? 0) >= 0.85,
      }],

      audience_fatigue: (s) => [{
        update_type:       'agent_config',
        target_agent:      'AGENT_CREATIVE_FACTORY',
        target_config_key: null,
        description:       `Fatigue audience (fr\u00e9quence ${(s.evidence as Record<string, unknown>)?.avg_frequency}) \u2192 g\u00e9n\u00e9rer nouvelles cr\u00e9atives urgentes`,
        current_value:     null,
        proposed_value:    {
          priority: 'urgent',
          instruction: 'G\u00e9n\u00e9rer 10 nouvelles cr\u00e9atives avec entity_id_variants compl\u00e8tement diff\u00e9rents.',
          trigger: 'audience_fatigue',
        },
        rationale:         `Fr\u00e9quence > 3.0 confirme que l'audience est satur\u00e9e. Nouvelles cr\u00e9atives obligatoires.`,
        auto_apply:        true,
      }],

      rule_obsolescence: (s) => [{
        update_type:       'rule_update',
        target_agent:      'AGENT_SCALE_ENGINE',
        target_config_key: `scale.${(s.evidence as Record<string, unknown>)?.action}_win_rate`,
        description:       `R\u00e8gle "${(s.evidence as Record<string, unknown>)?.action}" recalibr\u00e9e`,
        current_value:     { win_rate: 0.75 },
        proposed_value:    { win_rate: (s.evidence as Record<string, unknown>)?.win_rate, requires_review: true },
        rationale:         (s.description as string),
        auto_apply:        false,  // Toujours valider humainement les r\u00e8gles de scale
      }],
    };

    const builder = builders[signal.signal_type as string];
    return builder ? builder(signal) : [];
  }

  // \u2500\u2500 3. Auto-application des mises \u00e0 jour sans risque \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async applyAutoUpdates(task: AgentTask): Promise<AgentResult> {
    const { updates } = task.payload as { updates: Update[] };
    let applied = 0;

    for (const update of updates) {
      if (update.update_type === 'guardrail_update' && update.target_config_key) {
        // Mettre \u00e0 jour ops.runtime_config
        const newValue = JSON.stringify(
          (update.proposed_value as Record<string, unknown>)?.cpa_benchmark ??
          (update.proposed_value as Record<string, unknown>)
        );

        await db.query(
          `UPDATE ops.runtime_config
           SET value = $1, updated_at = NOW()
           WHERE key = $2 AND is_locked = FALSE`,
          [newValue, update.target_config_key]
        );

        await this.trace('info', `Guardrail mis \u00e0 jour : ${update.target_config_key} = ${newValue}`, {});
        applied++;
      }

      if (update.update_type === 'agent_config') {
        // Envoyer instruction directement \u00e0 l'agent concern\u00e9
        await db.query(
          `INSERT INTO agents.messages
             (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
           VALUES ($1,$2,$3,'COMMAND','AUTO_CONFIG_UPDATE',$4::jsonb,7,NOW())`,
          [
            task.tenantId, this.agentId, update.target_agent,
            JSON.stringify({
              update:    update.proposed_value,
              rationale: update.rationale,
              auto:      true,
            }),
          ]
        );
        applied++;
      }

      // Marquer comme appliqu\u00e9
      await db.query(
        `UPDATE innovation.tactical_updates
         SET status='applied', applied_at=NOW()
         WHERE description=$1 AND status='proposed'`,
        [update.description]
      );
    }

    await this.trace('info', `${applied} mises \u00e0 jour tactiques auto-appliqu\u00e9es`, { applied });
    return { success: true, output: { applied } };
  }

  private async buildBacklog(task: AgentTask): Promise<AgentResult> {
    return this.propose(task);
  }
}

// \u2500\u2500 Types \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface Signal {
  signal_type: string;
  platform:    string;
  source:      string;
  title:       string;
  description: string;
  evidence:    Record<string, unknown>;
  severity:    string;
  confidence:  number;
}

interface Update {
  update_type:       string;
  target_agent:      string;
  target_config_key: string | null;
  description:       string;
  current_value:     unknown;
  proposed_value:    unknown;
  rationale:         string;
  auto_apply:        boolean;
}
