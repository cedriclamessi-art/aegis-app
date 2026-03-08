/**
 * AGENT_BEHAVIORAL_LEARNING v6.0
 * Extrait des patterns comportementaux universels depuis toutes les sources.
 * Ces patterns sont platform-agnostic : si Meta ferme demain,
 * la connaissance reste intacte et applicable sur TikTok, Pinterest, ou
 * toute future plateforme.
 *
 * Sources fusionnées :
 *   verbatims → pourquoi les clients achètent (qualitatif)
 *   attribution → quand et comment ils achètent (quantitatif)
 *   RFM → qui revient et qui churne (comportemental)
 *   creative_knowledge → quel contenu résonne (créatif)
 *   anomalies → ce qui casse la performance (négatif)
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from '../core/llm-audit.service';

export class AgentBehavioralLearning extends BaseAgent {
  readonly name = 'AGENT_BEHAVIORAL_LEARNING';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'extract_patterns':   return this.extractPatterns(task);
      case 'validate_pattern':   return this.validatePattern(task);
      case 'get_patterns':       return this.getPatterns(task);
      case 'apply_to_agent':     return this.applyToAgent(task);
      case 'cross_validate':     return this.crossValidate(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /**
   * Extraction hebdomadaire — fusionne toutes les sources de signal
   * et génère / met à jour les patterns comportementaux.
   */
  private async extractPatterns(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const patterns: any[] = [];

    // ── SIGNAL 1: Verbatims → buying triggers ──────────────
    const { rows: verbatimInsights } = await this.db.query(`
      SELECT top_buying_angles, top_objections, top_keywords, nps_score,
             sample_size, creative_recommendations
      FROM verbatim_insights
      WHERE shop_id=$1 ORDER BY generated_at DESC LIMIT 1`, [shop_id]);

    if (verbatimInsights[0]?.sample_size >= 20) {
      const angles = verbatimInsights[0].top_buying_angles as any[];
      for (const angle of (angles ?? []).slice(0, 3)) {
        if (angle.pct > 0.15) {  // >15% des réponses
          patterns.push({
            pattern_type: 'buying_trigger',
            pattern_name: `angle_${angle.angle}`,
            description:  `${(angle.pct*100).toFixed(0)}% des clients citent "${angle.angle}" comme moteur d'achat`,
            confidence:   Math.min(0.95, angle.pct * 2),
            sample_size:  verbatimInsights[0].sample_size,
            effect_size:  angle.pct,
            action_recommendation: `Prioriser l'angle "${angle.angle}" dans les créatifs et le copy`,
            source_signals: [{ type: 'verbatim', count: verbatimInsights[0].sample_size }],
          });
        }
      }

      // Objections → resolvers
      const objections = verbatimInsights[0].top_objections as any[];
      for (const obj of (objections ?? []).slice(0, 2)) {
        patterns.push({
          pattern_type: 'objection_resolver',
          pattern_name: `objection_${obj.type}`,
          description:  `Objection "${obj.type}" présente chez ${obj.count} clients — nécessite une réponse active`,
          confidence:   0.80,
          sample_size:  verbatimInsights[0].sample_size,
          action_recommendation: this.getObjectionRecommendation(obj.type),
          source_signals: [{ type: 'verbatim', count: obj.count }],
        });
      }
    }

    // ── SIGNAL 2: Attribution → channel preference ────────
    const { rows: attrData } = await this.db.query(`
      SELECT
        converting_channel,
        COUNT(*) AS conversions,
        AVG(time_to_convert_hours) AS avg_hours,
        COUNT(*) FILTER (WHERE touchpoints = 1)::numeric / COUNT(*) AS single_touch_rate
      FROM attribution_events
      WHERE shop_id=$1 AND event_time > NOW() - INTERVAL '30 days'
      GROUP BY converting_channel
      ORDER BY conversions DESC`, [shop_id]);

    for (const ch of attrData.slice(0, 3)) {
      patterns.push({
        pattern_type: 'channel_preference',
        pattern_name: `best_channel_${ch.converting_channel}`,
        description:  `${ch.converting_channel} génère ${ch.conversions} conversions, ${parseFloat(ch.avg_hours).toFixed(0)}h de cycle moyen`,
        confidence:   Math.min(0.90, parseInt(ch.conversions) / 100),
        sample_size:  parseInt(ch.conversions),
        effect_size:  parseFloat(ch.single_touch_rate),
        applies_to_channels: [ch.converting_channel],
        action_recommendation: `Allouer plus de budget à ${ch.converting_channel} en priorité`,
        source_signals: [{ type: 'attribution', count: ch.conversions }],
      });
    }

    // ── SIGNAL 3: RFM → retention / churn signals ─────────
    const { rows: rfmData } = await this.db.query(`
      SELECT
        segment,
        COUNT(*) AS count,
        AVG(frequency) AS avg_freq,
        AVG(monetary) AS avg_monetary,
        AVG(recency_days) AS avg_recency
      FROM customer_rfm cr
      JOIN customers c ON c.id = cr.customer_id
      WHERE c.shop_id=$1 AND cr.computed_at > NOW() - INTERVAL '7 days'
      GROUP BY segment`, [shop_id]);

    const totalCustomers = rfmData.reduce((s: number, r: any) => s + parseInt(r.count), 0);
    for (const seg of rfmData) {
      const pct = parseInt(seg.count) / Math.max(totalCustomers, 1);
      if (seg.segment === 'at_risk' && pct > 0.15) {
        patterns.push({
          pattern_type: 'churn_signal',
          pattern_name: 'high_at_risk_segment',
          description:  `${(pct*100).toFixed(0)}% de la base est "at_risk" — LTV en danger`,
          confidence:   0.85,
          sample_size:  parseInt(seg.count),
          action_recommendation: 'Déclencher une campagne de réactivation Klaviyo urgente',
          source_signals: [{ type: 'rfm', count: seg.count }],
        });
      }
      if (seg.segment === 'champions' && parseFloat(seg.avg_freq) > 1.5) {
        patterns.push({
          pattern_type: 'upsell_moment',
          pattern_name: 'champions_repeat_buyers',
          description:  `Champions avec fréquence ${parseFloat(seg.avg_freq).toFixed(1)}× — prêts pour un bundle ou produit complémentaire`,
          confidence:   0.80,
          sample_size:  parseInt(seg.count),
          action_recommendation: 'Proposer une offre bundle aux champions actifs',
          source_signals: [{ type: 'rfm', count: seg.count }],
        });
      }
    }

    // ── SIGNAL 4: Creative performance → resonance ────────
    const { rows: creativeData } = await this.db.query(`
      SELECT hook_type, content_angle, AVG(roas) AS avg_roas,
             COUNT(*) AS tests, AVG(ctr) AS avg_ctr
      FROM creative_knowledge
      WHERE shop_id=$1 AND valid_until > NOW() AND confidence > 0.7
      GROUP BY hook_type, content_angle
      ORDER BY avg_roas DESC LIMIT 5`, [shop_id]);

    for (const cr of creativeData) {
      patterns.push({
        pattern_type: 'creative_resonance',
        pattern_name: `creative_${cr.hook_type}_${cr.content_angle}`,
        description:  `Hook "${cr.hook_type}" + angle "${cr.content_angle}" → ROAS ${parseFloat(cr.avg_roas).toFixed(2)}× sur ${cr.tests} tests`,
        confidence:   Math.min(0.92, parseInt(cr.tests) * 0.1),
        sample_size:  parseInt(cr.tests),
        effect_size:  parseFloat(cr.avg_roas),
        action_recommendation: `Systématiser hook ${cr.hook_type} avec angle ${cr.content_angle}`,
        source_signals: [{ type: 'creative_test', count: cr.tests }],
      });
    }

    // ── Persiste tous les patterns ─────────────────────────
    let upserted = 0;
    for (const p of patterns) {
      await this.db.query(`
        INSERT INTO behavioral_patterns
          (shop_id, pattern_type, pattern_name, description, sample_size, confidence,
           effect_size, action_recommendation, source_signals, applies_to_channels)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (shop_id, pattern_type, pattern_name) DO UPDATE SET
          description=$4, sample_size=$5, confidence=$6, effect_size=$7,
          action_recommendation=$8, source_signals=$9,
          last_confirmed_at=NOW(), is_active=true`,
        [shop_id, p.pattern_type, p.pattern_name, p.description,
         p.sample_size, p.confidence, p.effect_size ?? null,
         p.action_recommendation, JSON.stringify(p.source_signals),
         p.applies_to_channels ? `{${(p.applies_to_channels as string[]).join(',')}}` : '{}']);
      upserted++;
    }

    // Met à jour le knowledge graph
    await this.updateKnowledgeGraph(shop_id, patterns);

    await this.remember(shop_id, {
      memory_key: 'behavioral_patterns_updated', memory_type: 'observation',
      value: {
        patterns_extracted: upserted,
        top_pattern: patterns[0]?.pattern_name ?? 'none',
        message: `${upserted} patterns comportementaux extraits et mis à jour`,
        severity: 'info',
      },
      ttl_hours: 168,
    });

    return { success: true, data: { patterns_extracted: upserted, patterns } };
  }

  /** Valide un pattern existant avec de nouvelles données. */
  private async validatePattern(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { pattern_id, new_sample_size, new_effect_size, p_value } = payload as any;

    const { rows: [p] } = await this.db.query(
      `SELECT * FROM behavioral_patterns WHERE id=$1 AND shop_id=$2`, [pattern_id, shop_id]);
    if (!p) return { success: false, message: 'Pattern not found' };

    // Bayesian update: combine ancien et nouveau
    const totalSample  = p.sample_size + new_sample_size;
    const weightedConf = (p.confidence * p.sample_size + Math.min(0.95, 1 - (p_value ?? 0.05)) * new_sample_size) / totalSample;
    const weightedEff  = p.effect_size && new_effect_size
      ? (p.effect_size * p.sample_size + new_effect_size * new_sample_size) / totalSample
      : p.effect_size;

    await this.db.query(`
      UPDATE behavioral_patterns SET
        sample_size=$1, confidence=$2, effect_size=$3, p_value=$4,
        last_confirmed_at=NOW()
      WHERE id=$5`,
      [totalSample, weightedConf, weightedEff, p_value ?? p.p_value, pattern_id]);

    return { success: true, data: { updated_confidence: weightedConf, total_sample: totalSample } };
  }

  /** Retourne les patterns actifs pour un agent. */
  private async getPatterns(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { pattern_type, min_confidence } = (payload ?? {}) as any;

    const { rows } = await this.db.query(`
      SELECT * FROM behavioral_patterns
      WHERE shop_id=$1 AND is_active=true
        AND ($2::text IS NULL OR pattern_type=$2)
        AND confidence >= $3
      ORDER BY confidence DESC, sample_size DESC
      LIMIT 20`,
      [shop_id, pattern_type ?? null, min_confidence ?? 0.6]);

    return { success: true, data: { patterns: rows } };
  }

  /** Injecte les patterns pertinents dans le contexte d'un agent. */
  private async applyToAgent(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { agent_name, context } = payload as any;

    // Sélectionne les patterns pertinents pour cet agent
    const relevantTypes: Record<string, string[]> = {
      'AGENT_SCALE':            ['buying_trigger', 'creative_resonance'],
      'AGENT_EMAIL_RECOVERY':   ['buying_trigger', 'objection_resolver', 'channel_preference'],
      'AGENT_KLAVIYO':          ['retention_signal', 'churn_signal', 'upsell_moment'],
      'AGENT_CREATIVE_KNOWLEDGE':['creative_resonance', 'buying_trigger'],
      'AGENT_PRICING':          ['price_sensitivity', 'buying_trigger'],
      'AGENT_DCT_ITERATION':    ['creative_resonance'],
    };

    const types = relevantTypes[agent_name] ?? [];
    if (!types.length) return { success: true, data: { patterns: [] } };

    const { rows } = await this.db.query(`
      SELECT pattern_name, description, action_recommendation, confidence, effect_size
      FROM behavioral_patterns
      WHERE shop_id=$1 AND is_active=true AND confidence >= 0.70
        AND pattern_type = ANY($2::text[])
      ORDER BY confidence DESC LIMIT 5`,
      [shop_id, types]);

    return { success: true, data: { patterns: rows, context_enriched: rows.length > 0 } };
  }

  /** Validation cross-clients (anonymisée). */
  private async crossValidate(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Pour chaque pattern local, vérifie si le même pattern existe chez d'autres shops
    const { rows: localPatterns } = await this.db.query(`
      SELECT id, pattern_type, pattern_name, confidence, effect_size
      FROM behavioral_patterns
      WHERE shop_id=$1 AND is_active=true AND confidence > 0.75`, [shop_id]);

    let validated = 0;
    for (const p of localPatterns) {
      // Compte les shops qui ont le même pattern (anonymisé)
      const { rows: others } = await this.db.query(`
        SELECT COUNT(DISTINCT shop_id) AS n,
               AVG(confidence) AS avg_conf,
               AVG(effect_size) AS avg_effect
        FROM behavioral_patterns
        WHERE pattern_type=$1 AND pattern_name=$2
          AND shop_id != $3 AND is_active=true AND confidence > 0.65`,
        [p.pattern_type, p.pattern_name, shop_id]);

      if (parseInt(others[0]?.n ?? 0) >= 2) {
        const crossLift = parseFloat(others[0]?.avg_effect ?? p.effect_size ?? 0);
        await this.db.query(`
          UPDATE behavioral_patterns SET
            cross_client_validated=true, cross_client_lift=$1,
            confidence=LEAST(0.98, confidence + 0.05)
          WHERE id=$2`, [crossLift, p.id]);
        validated++;
      }
    }

    return { success: true, data: { patterns_cross_validated: validated } };
  }

  private async updateKnowledgeGraph(shopId: string, patterns: any[]): Promise<void> {
    for (const p of patterns.slice(0, 5)) {
      const { rows: [node] } = await this.db.query(`
        INSERT INTO knowledge_graph_nodes (shop_id, node_type, node_key, node_label, metadata)
        VALUES ($1,'pattern',$2,$3,$4)
        ON CONFLICT DO NOTHING RETURNING id`,
        [shopId, p.pattern_name, p.description, JSON.stringify({ confidence: p.confidence })]);

      if (node) {
        // Connecte au noeud agent correspondant
        const agentKey = this.getAgentForPattern(p.pattern_type);
        if (agentKey) {
          await this.db.query(`
            INSERT INTO knowledge_graph_nodes (shop_id, node_type, node_key, node_label)
            VALUES ($1,'agent',$2,$2) ON CONFLICT DO NOTHING`, [shopId, agentKey]);

          await this.db.query(`
            INSERT INTO knowledge_graph_edges (shop_id, from_node_id, to_node_id, relation_type, weight)
            SELECT $1, n1.id, n2.id, 'informs', $2
            FROM knowledge_graph_nodes n1, knowledge_graph_nodes n2
            WHERE n1.shop_id=$1 AND n1.node_key=$3
              AND n2.shop_id=$1 AND n2.node_key=$4
            ON CONFLICT DO NOTHING`,
            [shopId, p.confidence, p.pattern_name, agentKey]);
        }
      }
    }
  }

  private getObjectionRecommendation(objType: string): string {
    const map: Record<string, string> = {
      price:       'Ajouter garantie satisfait-remboursé ou offre d\'essai',
      trust:       'Renforcer preuves sociales (UGC, avis, résultats avant/après)',
      need_clarity:'Clarifier la proposition de valeur — le bénéfice principal n\'est pas évident',
      competitor:  'Mettre en avant la différenciation vs Ecovia dans le copy',
    };
    return map[objType] ?? 'Adresser directement cette objection dans les créatifs';
  }

  private getAgentForPattern(patternType: string): string | null {
    const map: Record<string, string> = {
      buying_trigger:    'AGENT_CREATIVE_KNOWLEDGE',
      objection_resolver:'AGENT_EMAIL_RECOVERY',
      retention_signal:  'AGENT_KLAVIYO',
      churn_signal:      'AGENT_KLAVIYO',
      upsell_moment:     'AGENT_KLAVIYO',
      creative_resonance:'AGENT_DCT_ITERATION',
      price_sensitivity: 'AGENT_PRICING',
      channel_preference:'AGENT_BUDGET_OPTIMIZER',
    };
    return map[patternType] ?? null;
  }
}
