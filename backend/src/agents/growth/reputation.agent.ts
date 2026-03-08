/**
 * AGENT_REPUTATION v5.0
 * Monitore les avis Trustpilot, Google, commentaires sociaux.
 * Calcule un NPS opérationnel composite.
 * Déclenche l'Article 6 : si NPS < 30 → bloque l'acquisition 48h.
 * "Inutile de dépenser €300/j pour acquérir des clients si le produit a un problème."
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { LLMAuditService } from '../core/llm-audit.service';

const NPS_CRITICAL_THRESHOLD  = 30;   // Article 6 trigger
const REVIEWS_SPIKE_THRESHOLD  = 3;   // > 3 négatives en 24h
const ACQUISITION_BLOCK_HOURS  = 48;

export class AgentReputation extends BaseAgent {
  readonly name = 'AGENT_REPUTATION';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'scan':          return this.scan(task);
      case 'check_article6':return this.checkArticle6(task);
      case 'get_dashboard': return this.getDashboard(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /** Scan quotidien de toutes les sources. */
  private async scan(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    const results: any[] = [];

    // 1. NPS interne (depuis customer_verbatims)
    const { rows: npsData } = await this.db.query(`
      SELECT
        AVG(nps_score) * 10 AS avg_nps,
        COUNT(*) AS count,
        COUNT(*) FILTER (WHERE nps_score >= 9) AS promoters,
        COUNT(*) FILTER (WHERE nps_score <= 6) AS detractors
      FROM customer_verbatims
      WHERE shop_id=$1 AND nps_score IS NOT NULL
        AND responded_at > NOW() - INTERVAL '30 days'`, [shop_id]);

    if (npsData[0]?.count > 0) {
      const nps = parseFloat(npsData[0].avg_nps ?? 0);
      await this.db.query(`
        INSERT INTO reputation_scores
          (shop_id, platform, score, review_count, positive_count, negative_count)
        VALUES ($1,'internal_nps',$2,$3,$4,$5)
        ON CONFLICT (shop_id, platform, DATE(recorded_at)) DO UPDATE SET
          score=$2, review_count=$3, positive_count=$4, negative_count=$5`,
        [shop_id, nps, npsData[0].count, npsData[0].promoters, npsData[0].detractors]);
      results.push({ platform: 'internal_nps', score: nps });
    }

    // 2. Trustpilot (si API key configurée)
    try {
      const tp = await this.scanTrustpilot(shop_id);
      if (tp) results.push(tp);
    } catch { /* non-critique */ }

    // 3. Commentaires Meta (sentiment analysis sur derniers 50 comments)
    try {
      const meta = await this.scanMetaComments(shop_id);
      if (meta) results.push(meta);
    } catch { /* non-critique */ }

    // 4. Check Article 6
    await this.checkArticle6({ ...task, type: 'check_article6' });

    return { success: true, data: { platforms_scanned: results.length, results } };
  }

  /** Vérifie si l'Article 6 doit être déclenché. */
  private async checkArticle6(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;

    // Score NPS composite (moyenne pondérée des sources)
    const { rows: scores } = await this.db.query(`
      SELECT platform, score FROM reputation_scores
      WHERE shop_id=$1
        AND recorded_at > NOW() - INTERVAL '7 days'
      ORDER BY recorded_at DESC`, [shop_id]);

    if (!scores.length) return { success: true, data: { article6: false } };

    // NPS interne pèse 60%, Trustpilot 30%, Meta 10%
    const weights: Record<string, number> = {
      internal_nps: 0.6, trustpilot: 0.3, meta_comments: 0.1
    };

    let weightedSum = 0, totalWeight = 0;
    for (const s of scores) {
      const w = weights[s.platform] ?? 0.1;
      weightedSum += parseFloat(s.score) * w;
      totalWeight += w;
    }
    const compositeNps = totalWeight > 0 ? weightedSum / totalWeight : 0;

    // Spike de reviews négatives en 24h
    const { rows: [spike] } = await this.db.query(`
      SELECT COUNT(*) AS n FROM reputation_scores
      WHERE shop_id=$1 AND negative_count > 0
        AND recorded_at > NOW() - INTERVAL '24 hours'`, [shop_id]);
    const negativeSpike = parseInt(spike?.n ?? 0) >= REVIEWS_SPIKE_THRESHOLD;

    const shouldBlock = compositeNps < NPS_CRITICAL_THRESHOLD || negativeSpike;

    if (shouldBlock) {
      const blockedUntil = new Date(Date.now() + ACQUISITION_BLOCK_HOURS * 3600000);

      await this.db.query(`
        INSERT INTO reputation_alerts
          (shop_id, alert_type, current_score, threshold, acquisition_blocked, blocked_until, details)
        VALUES ($1,$2,$3,$4,true,$5,$6)`,
        [shop_id,
         compositeNps < NPS_CRITICAL_THRESHOLD ? 'nps_critical' : 'reviews_spike_negative',
         compositeNps, NPS_CRITICAL_THRESHOLD, blockedUntil,
         JSON.stringify({ composite_nps: compositeNps, negative_spike: negativeSpike })]);

      // Article 6 : bloque la constitution pour les actions d'acquisition
      await this.db.query(`
        INSERT INTO constitution_whitelist (shop_id, destination_type, destination_id, approved_by, purpose)
        VALUES ($1,'article_6_block','acquisition_blocked','AGENT_REPUTATION',$2)
        ON CONFLICT DO NOTHING`,
        [shop_id, `NPS ${compositeNps.toFixed(0)} < ${NPS_CRITICAL_THRESHOLD} — acquisition bloquée jusqu'au ${blockedUntil.toLocaleDateString('fr-FR')}`]);

      await this.emit('anomaly_critical', {
        shop_id,
        type:    'article_6_reputation',
        title:   `Article 6 — Acquisition bloquée 48h`,
        message: `NPS composite ${compositeNps.toFixed(0)}/100 sous le seuil de ${NPS_CRITICAL_THRESHOLD}. AEGIS a suspendu les dépenses d'acquisition pour protéger la marque.`,
        severity:'critical',
      });

      await this.remember(shop_id, {
        memory_key: 'article_6_active', memory_type: 'warning',
        value: {
          composite_nps: compositeNps, blocked_until: blockedUntil.toISOString(),
          message: `Article 6 actif — NPS ${compositeNps.toFixed(0)}/100. Acquisition suspendue jusqu'au ${blockedUntil.toLocaleDateString('fr-FR')}.`,
          severity: 'critical',
        },
        ttl_hours: ACQUISITION_BLOCK_HOURS + 2,
      });
    }

    return { success: true, data: { article6_triggered: shouldBlock, composite_nps: compositeNps, blocked_until: shouldBlock ? new Date(Date.now() + ACQUISITION_BLOCK_HOURS * 3600000) : null } };
  }

  private async scanTrustpilot(shopId: string): Promise<any | null> {
    const { rows } = await this.db.query(
      `SELECT value FROM platform_credentials WHERE shop_id=$1 AND platform='trustpilot'`, [shopId]);
    if (!rows[0]) return null;

    try {
      const res  = await fetch(
        `https://api.trustpilot.com/v1/business-units/find?name=${rows[0].value.domain}`,
        { headers: { apikey: rows[0].value.api_key } });
      const data = await res.json() as any;
      const score = parseFloat(data.score?.trustScore ?? 0) * 20; // 0-5 → 0-100

      await this.db.query(`
        INSERT INTO reputation_scores (shop_id, platform, score, review_count)
        VALUES ($1,'trustpilot',$2,$3)
        ON CONFLICT (shop_id, platform, DATE(recorded_at)) DO UPDATE SET score=$2, review_count=$3`,
        [shopId, score, data.numberOfReviews?.total ?? 0]);

      return { platform: 'trustpilot', score };
    } catch { return null; }
  }

  private async scanMetaComments(shopId: string): Promise<any | null> {
    // Pull recent ad comments from Meta API and run sentiment
    const { rows: comments } = await this.db.query(`
      SELECT content FROM meta_ad_comments
      WHERE shop_id=$1 AND created_at > NOW() - INTERVAL '48 hours'
      LIMIT 50`, [shopId]).catch(() => ({ rows: [] }));

    if (!comments.length) return null;

    const llm = new LLMAuditService(this.db);
    try {
      const { text } = await llm.call({
        shop_id: shopId, agent_name: this.name, call_purpose: 'comment_sentiment',
        max_tokens: 100,
        messages: [{
          role: 'user',
          content: `Analyse le sentiment de ces ${comments.length} commentaires publicitaires Meta.
Réponds UNIQUEMENT en JSON: {"positive": N, "neutral": N, "negative": N, "score": 0-100}
Commentaires: ${comments.slice(0,20).map((c: any) => c.content).join(' | ')}`
        }]
      });
      const s    = JSON.parse(text.replace(/```json|```/g, '').trim());
      const total = s.positive + s.neutral + s.negative;
      if (total === 0) return null;

      await this.db.query(`
        INSERT INTO reputation_scores
          (shop_id, platform, score, review_count, positive_count, negative_count)
        VALUES ($1,'meta_comments',$2,$3,$4,$5)
        ON CONFLICT (shop_id, platform, DATE(recorded_at)) DO UPDATE SET
          score=$2, review_count=$3, positive_count=$4, negative_count=$5`,
        [shopId, s.score, total, s.positive, s.negative]);

      return { platform: 'meta_comments', score: s.score };
    } catch { return null; }
  }

  private async getDashboard(task: AgentTask): Promise<AgentResult> {
    const { rows: scores } = await this.db.query(`
      SELECT DISTINCT ON (platform) platform, score, review_count, recorded_at
      FROM reputation_scores WHERE shop_id=$1
      ORDER BY platform, recorded_at DESC`, [task.shop_id]);

    const { rows: alerts } = await this.db.query(`
      SELECT * FROM reputation_alerts WHERE shop_id=$1 AND acknowledged=false
      ORDER BY created_at DESC LIMIT 5`, [task.shop_id]);

    return { success: true, data: { scores, alerts } };
  }
}
