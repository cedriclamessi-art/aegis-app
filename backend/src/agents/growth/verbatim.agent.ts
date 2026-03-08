/**
 * AGENT_VERBATIM v5.0
 * Collecte et analyse les verbatims post-achat.
 * Envoie un email 3 jours après livraison (3 questions, 30 secondes).
 * Alimente AGENT_CREATIVE_KNOWLEDGE avec les vrais mots des clients.
 * "Pourquoi avez-vous acheté ? Quel bénéfice ? Qu'est-ce qui vous a presque arrêté ?"
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from '../core/llm-audit.service';

export class AgentVerbatim extends BaseAgent {
  readonly name = 'AGENT_VERBATIM';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'send_surveys':     return this.sendSurveys(task);
      case 'analyze_response': return this.analyzeResponse(task);
      case 'generate_insights':return this.generateInsights(task);
      case 'get_insights':     return this.getInsights(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Envoie les surveys aux commandes livrées il y a 3 jours. */
  private async sendSurveys(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Commandes livrées il y a 3 jours, pas encore enquêtées
    const { rows: orders } = await this.db.query(`
      SELECT o.id, o.customer_email, o.shopify_order_id,
             cr.segment AS rfm_segment
      FROM shopify_orders o
      LEFT JOIN customer_verbatims cv ON cv.order_id = o.shopify_order_id AND cv.shop_id = o.shop_id
      LEFT JOIN customer_rfm cr ON cr.customer_id = o.customer_id
      WHERE o.shop_id=$1
        AND o.fulfilled_at BETWEEN NOW() - INTERVAL '4 days' AND NOW() - INTERVAL '3 days'
        AND cv.id IS NULL
      LIMIT 50`, [shop_id]);

    let sent = 0;
    for (const order of orders) {
      const surveyToken = Buffer.from(`${order.id}:${shop_id}:${Date.now()}`).toString('base64url');
      const surveyUrl   = `${process.env.NEXT_PUBLIC_APP_URL}/survey/${surveyToken}`;

      // Envoie via Klaviyo / Resend
      await this.emit('delivery:send_survey', {
        shop_id,
        to:          order.customer_email,
        subject:     'Votre avis sur Blissal (30 secondes)',
        survey_url:  surveyUrl,
        rfm_segment: order.rfm_segment,
      });

      // Log l'envoi
      await this.db.query(`
        INSERT INTO customer_verbatims
          (shop_id, order_id, customer_email, rfm_segment, survey_sent_at)
        VALUES ($1,$2,$3,$4,NOW())
        ON CONFLICT DO NOTHING`,
        [shop_id, order.shopify_order_id, order.customer_email, order.rfm_segment ?? 'unknown']);

      sent++;
    }

    return { success: true, data: { surveys_sent: sent } };
  }

  /** Appelé quand un client répond au survey (webhook POST /survey/respond). */
  private async analyzeResponse(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { order_id, why_bought, main_benefit, hesitation, nps_score } = payload as any;

    // NLP analysis via Claude
    const llm = new LLMAuditService(this.db);
    let analysis: any = {};
    try {
      const { text } = await llm.call({
        shop_id, agent_name: this.name, call_purpose: 'verbatim_analysis',
        max_tokens: 200,
        messages: [{
          role: 'user',
          content: `Analyse ce verbatim client pour une marque de serviettes exfoliantes (Blissal).

Pourquoi acheté: "${why_bought ?? ''}"
Bénéfice principal: "${main_benefit ?? ''}"
Hésitation: "${hesitation ?? ''}"
NPS: ${nps_score ?? 'N/A'}/10

Réponds UNIQUEMENT en JSON:
{
  "sentiment": "positive|neutral|negative",
  "detected_angle": "transformation|ritual|social_proof|price_value|gift|recommendation|curiosity|health",
  "key_words": ["mot1","mot2","mot3"],
  "objection_type": "price|trust|need_clarity|competitor|none",
  "insight_tags": ["tag1","tag2"]
}`
        }]
      });
      analysis = JSON.parse(text.replace(/```json|```/g, '').trim());
    } catch {
      analysis = { sentiment: 'neutral', detected_angle: 'unknown', key_words: [], objection_type: 'none', insight_tags: [] };
    }

    await this.db.query(`
      UPDATE customer_verbatims SET
        why_bought=$1, main_benefit=$2, hesitation=$3, nps_score=$4,
        sentiment=$5, detected_angle=$6, key_words=$7,
        objection_type=$8, insight_tags=$9,
        analyzed=true, responded_at=NOW()
      WHERE shop_id=$10 AND order_id=$11`,
      [why_bought, main_benefit, hesitation, nps_score,
       analysis.sentiment, analysis.detected_angle,
       analysis.key_words, analysis.objection_type,
       analysis.insight_tags, shop_id, order_id]);

    // Si sample ≥ 200 ou tous les 7 jours, regénère les insights
    const { rows: [cnt] } = await this.db.query(
      `SELECT COUNT(*) AS n FROM customer_verbatims WHERE shop_id=$1 AND analyzed=true`, [shop_id]);
    if (parseInt(cnt.n) % 50 === 0) {
      await this.generateInsights({ ...task, type: 'generate_insights' });
    }

    return { success: true, data: { analysis } };
  }

  /** Synthèse agrégée des 30 derniers jours — alimente AGENT_CREATIVE_KNOWLEDGE. */
  private async generateInsights(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const { rows: verbatims } = await this.db.query(`
      SELECT sentiment, detected_angle, key_words, objection_type, insight_tags, nps_score
      FROM customer_verbatims
      WHERE shop_id=$1 AND analyzed=true
        AND responded_at > NOW() - INTERVAL '30 days'`, [shop_id]);

    if (verbatims.length < 10) {
      return { success: true, data: { message: 'Insufficient data (< 10 responses)' } };
    }

    // Agrégations
    const angles: Record<string, number> = {};
    const objections: Record<string, number> = {};
    const keywords: Record<string, number> = {};
    let totalNps = 0, npsCount = 0, positive = 0, neutral = 0, negative = 0;

    for (const v of verbatims) {
      if (v.detected_angle) angles[v.detected_angle] = (angles[v.detected_angle] ?? 0) + 1;
      if (v.objection_type && v.objection_type !== 'none')
        objections[v.objection_type] = (objections[v.objection_type] ?? 0) + 1;
      for (const kw of (v.key_words ?? [])) keywords[kw] = (keywords[kw] ?? 0) + 1;
      if (v.nps_score != null) { totalNps += v.nps_score * 10; npsCount++; }
      if (v.sentiment === 'positive') positive++;
      else if (v.sentiment === 'negative') negative++;
      else neutral++;
    }

    const topAngles = Object.entries(angles)
      .sort(([,a],[,b]) => b - a).slice(0, 5)
      .map(([angle, count]) => ({ angle, pct: count / verbatims.length }));

    const topKeywords = Object.entries(keywords)
      .sort(([,a],[,b]) => b - a).slice(0, 10)
      .map(([word, count]) => ({ word, count }));

    const nps = npsCount > 0 ? totalNps / npsCount : 0;
    const promotersPct = verbatims.filter((v: any) => v.nps_score >= 9).length / verbatims.length;
    const detractorsPct = verbatims.filter((v: any) => v.nps_score <= 6).length / verbatims.length;

    // Recommendations créatives via LLM
    const llm = new LLMAuditService(this.db);
    let recommendations = '';
    try {
      const { text } = await llm.call({
        shop_id, agent_name: this.name, call_purpose: 'verbatim_creative_recommendations',
        max_tokens: 250,
        messages: [{
          role: 'user',
          content: `Sur la base de ${verbatims.length} verbatims clients Blissal (serviettes exfoliantes FR):

Top angles d'achat: ${topAngles.map(a => `${a.angle} (${(a.pct*100).toFixed(0)}%)`).join(', ')}
Top mots-clés: ${topKeywords.slice(0,5).map(k => k.word).join(', ')}
Top objections: ${Object.entries(objections).slice(0,3).map(([k,v]) => `${k}(${v})`).join(', ')}
NPS moyen: ${nps.toFixed(1)}/100

Donne 3 recommandations créatives concrètes pour les prochains visuels/copy Meta.
Format: liste courte, actionnable, spécifique à ce qu'ils ont dit.`
        }]
      });
      recommendations = text;
    } catch {
      recommendations = `Angle dominant: ${topAngles[0]?.angle ?? 'inconnu'}. Exploiter davantage dans les créatifs.`;
    }

    await this.db.query(`
      INSERT INTO verbatim_insights
        (shop_id, sample_size, period_days, top_buying_angles, top_objections,
         top_keywords, nps_score, nps_promoters_pct, nps_detractors_pct,
         sentiment_breakdown, creative_recommendations)
      VALUES ($1,$2,30,$3,$4,$5,$6,$7,$8,$9,$10)
      ON CONFLICT (shop_id, (generated_at::DATE)) DO UPDATE SET
        sample_size=$2, top_buying_angles=$3, top_objections=$4,
        top_keywords=$5, nps_score=$6, creative_recommendations=$10`,
      [shop_id, verbatims.length,
       JSON.stringify(topAngles),
       JSON.stringify(Object.entries(objections).map(([type,count]) => ({ type, count }))),
       JSON.stringify(topKeywords),
       nps, promotersPct, detractorsPct,
       JSON.stringify({ positive: positive/verbatims.length, neutral: neutral/verbatims.length, negative: negative/verbatims.length }),
       recommendations]);

    // Injecte dans creative_knowledge
    await this.emit('creative:verbatim_insights', {
      shop_id, top_angles: topAngles, top_keywords: topKeywords, recommendations,
    });

    await this.remember(shop_id, {
      memory_key: 'verbatim_insights_latest', memory_type: 'observation',
      value: {
        sample_size: verbatims.length, nps: nps.toFixed(1),
        top_angle: topAngles[0]?.angle,
        top_objection: Object.keys(objections)[0] ?? 'none',
        message: `${verbatims.length} verbatims analysés. NPS ${nps.toFixed(0)}/100. Angle dominant: ${topAngles[0]?.angle}`,
        severity: nps < 30 ? 'warning' : 'info',
      },
      ttl_hours: 168,
    });

    return { success: true, data: { sample_size: verbatims.length, nps, top_angles: topAngles, recommendations } };
  }

  private async getInsights(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT * FROM verbatim_insights WHERE shop_id=$1
      ORDER BY generated_at DESC LIMIT 3`, [task.shop_id]);
    return { success: true, data: { insights: rows } };
  }
}
