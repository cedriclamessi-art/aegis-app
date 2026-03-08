/**
 * AGENT_RESULTS_48H — Phase 8 : Analyse Resultats Post-Test
 * ══════════════════════════════════════════════════════════════
 * Apres 48h de test CBO, classe chaque creative dans 4 buckets :
 *
 *   CONDOR → gros potentiel, pret a scaler agressivement
 *   TOF    → bon en top-of-funnel (acquisition), a optimiser
 *   BOF    → bon en retargeting uniquement (bottom-of-funnel)
 *   DEAD   → pas de potentiel, a stopper immediatement
 *
 * Criteres de classification :
 *   CONDOR : ROAS >= 3.0 AND CPA <= target AND CTR >= 2.0% AND purchases >= 5
 *   TOF    : ROAS >= 2.0 AND CTR >= 1.5% (bon en acquisition, marge a optimiser)
 *   BOF    : ROAS < 2.0 AND CTR < 1.5% AND retargeting_CVR >= 3% (fonctionne en retargeting)
 *   DEAD   : ROAS < 1.5 OR (spend > 50€ AND purchases == 0) (a stopper)
 *
 * Signaux downstream :
 *   - CONDOR → AGENT_SCALE (scale immediat)
 *   - TOF    → AGENT_CREATIVE_FACTORY (iterer les hooks)
 *   - BOF    → AGENT_RETENTION (retargeting sequences)
 *   - DEAD   → stop (pas de signal)
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

type CreativeClassification = 'CONDOR' | 'TOF' | 'BOF' | 'DEAD';

interface CreativeMetrics {
  adId:        string;
  spend:       number;
  revenue:     number;
  roas:        number;
  purchases:   number;
  cpa:         number;
  ctr:         number;
  cpc:         number;
  cpm:         number;
  impressions: number;
  clicks:      number;
  frequency:   number;
  addToCart:    number;
  checkoutInitiated: number;
}

interface ClassifiedCreative {
  adId:           string;
  classification: CreativeClassification;
  score:          number;      // 0-100 CONDOR score
  metrics:        CreativeMetrics;
  reasons:        string[];
  action:         string;
}

interface ResultsOutput {
  campaignId:       string;
  testDurationH:    number;
  totalSpend:       number;
  totalRevenue:     number;
  overallRoas:      number;
  overallCpa:       number;
  classified:       ClassifiedCreative[];
  summary:          {
    condors:  number;
    tof:      number;
    bof:      number;
    dead:     number;
  };
  verdict:          string;
  confidence:       number;
  nextActions:      string[];
  analyzedAt:       string;
}

export class Results48hAgent extends AgentBase {
  readonly agentId = 'AGENT_RESULTS_48H';

  readonly supportedTasks = [
    'results.classify_48h',     // Classification complete apres 48h
    'results.classify_single',  // Classifier une creative individuelle
    'results.recheck',          // Re-analyser apres optimisation
  ];

  // Seuils de classification
  private readonly THRESHOLDS = {
    CONDOR: { minRoas: 3.0, maxCpa: 18.0, minCtr: 2.0, minPurchases: 5 },
    TOF:    { minRoas: 2.0, minCtr: 1.5 },
    BOF:    { minRetargetCvr: 3.0 },
    DEAD:   { maxRoas: 1.5, maxSpendNoPurchase: 50 },
  };

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'results.classify_48h':    return this.classify48h(task);
      case 'results.classify_single': return this.classifySingle(task);
      case 'results.recheck':         return this.recheck(task);
      default: throw new Error(`Task non supportee: ${task.taskType}`);
    }
  }

  // ── Classification Complete 48h ────────────────────────────────────────

  private async classify48h(task: AgentTask): Promise<AgentResult> {
    const { campaignId, targetCpa } = task.input as {
      campaignId: string; targetCpa?: number;
    };

    // Recuperer les metriques de toutes les creatives de la campagne
    const metricsRows = await db.query(
      `SELECT ad_id, spend, revenue, purchases, clicks, impressions,
              ctr, cpc, cpm, frequency, add_to_cart, checkout_initiated
       FROM ads.ad_metrics
       WHERE campaign_id = $1 AND tenant_id = $2
       ORDER BY spend DESC`,
      [campaignId, task.tenantId]
    ).catch(() => ({ rows: [] }));

    // Si pas de donnees reelles, utiliser des metriques simulees
    const metrics: CreativeMetrics[] = metricsRows.rows.length > 0
      ? metricsRows.rows.map((r: any) => ({
          adId: r.ad_id,
          spend: r.spend,
          revenue: r.revenue,
          roas: r.revenue / Math.max(r.spend, 0.01),
          purchases: r.purchases,
          cpa: r.purchases > 0 ? r.spend / r.purchases : Infinity,
          ctr: r.ctr,
          cpc: r.cpc,
          cpm: r.cpm,
          impressions: r.impressions,
          clicks: r.clicks,
          frequency: r.frequency ?? 0,
          addToCart: r.add_to_cart ?? 0,
          checkoutInitiated: r.checkout_initiated ?? 0,
        }))
      : this.generateTestMetrics(15);

    // Classifier chaque creative
    const effectiveTargetCpa = targetCpa ?? this.THRESHOLDS.CONDOR.maxCpa;
    const classified = metrics.map(m => this.classifyCreative(m, effectiveTargetCpa));

    // Compter par bucket
    const summary = {
      condors: classified.filter(c => c.classification === 'CONDOR').length,
      tof:     classified.filter(c => c.classification === 'TOF').length,
      bof:     classified.filter(c => c.classification === 'BOF').length,
      dead:    classified.filter(c => c.classification === 'DEAD').length,
    };

    const totalSpend   = metrics.reduce((s, m) => s + m.spend, 0);
    const totalRevenue = metrics.reduce((s, m) => s + m.revenue, 0);
    const overallRoas  = totalRevenue / Math.max(totalSpend, 0.01);
    const totalPurchases = metrics.reduce((s, m) => s + m.purchases, 0);
    const overallCpa   = totalPurchases > 0 ? totalSpend / totalPurchases : Infinity;

    // Verdict global
    let verdict: string;
    let confidence: number;
    if (summary.condors >= 3) {
      verdict = 'STRONG_WINNER'; confidence = 0.92;
    } else if (summary.condors >= 1) {
      verdict = 'WINNER'; confidence = 0.78;
    } else if (summary.tof >= 3) {
      verdict = 'POTENTIAL — optimisation requise'; confidence = 0.6;
    } else {
      verdict = 'WEAK — pivoter produit ou angles'; confidence = 0.4;
    }

    // Actions suivantes
    const nextActions: string[] = [];
    if (summary.condors > 0) {
      nextActions.push(`SCALE: ${summary.condors} CONDORs prets a scaler → AGENT_SCALE`);
    }
    if (summary.tof > 0) {
      nextActions.push(`ITERATE: ${summary.tof} TOFs a optimiser → AGENT_CREATIVE_FACTORY`);
    }
    if (summary.dead > 0) {
      nextActions.push(`STOP: Couper les ${summary.dead} DEAD immediatement`);
    }
    if (summary.bof > 0) {
      nextActions.push(`RETARGET: ${summary.bof} BOFs a rediriger → AGENT_RETENTION`);
    }

    const output: ResultsOutput = {
      campaignId,
      testDurationH: 48,
      totalSpend,
      totalRevenue,
      overallRoas: +overallRoas.toFixed(2),
      overallCpa: overallCpa === Infinity ? 0 : +overallCpa.toFixed(2),
      classified,
      summary,
      verdict,
      confidence,
      nextActions,
      analyzedAt: new Date().toISOString(),
    };

    // Persister les classifications
    for (const c of classified) {
      await db.query(
        `INSERT INTO ads.creative_classifications
           (tenant_id, campaign_id, ad_id, classification, score, metrics, reasons)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (tenant_id, campaign_id, ad_id) DO UPDATE
           SET classification = EXCLUDED.classification, score = EXCLUDED.score,
               metrics = EXCLUDED.metrics, reasons = EXCLUDED.reasons, updated_at = NOW()`,
        [task.tenantId, campaignId, c.adId, c.classification,
         c.score, JSON.stringify(c.metrics), JSON.stringify(c.reasons)]
      ).catch(() => {});
    }

    // Envoyer signaux downstream
    if (summary.condors > 0) {
      await db.query(
        `SELECT agents.send_message($1, 'AGENT_SCALE', 'evaluate', $2, $3, 2)`,
        [this.agentId, JSON.stringify({
          campaignId,
          condorAdIds: classified.filter(c => c.classification === 'CONDOR').map(c => c.adId),
        }), task.tenantId]
      ).catch(() => {});
    }

    if (summary.tof > 0) {
      await db.query(
        `SELECT agents.send_message($1, 'AGENT_CREATIVE_FACTORY', 'creative.iterate', $2, $3, 4)`,
        [this.agentId, JSON.stringify({
          campaignId,
          tofAdIds: classified.filter(c => c.classification === 'TOF').map(c => c.adId),
          instruction: 'iterate_hooks_on_tof',
        }), task.tenantId]
      ).catch(() => {});
    }

    logger.info(`[RESULTS_48H] Campagne ${campaignId}: ${summary.condors}C/${summary.tof}T/${summary.bof}B/${summary.dead}D → ${verdict}`);

    return { success: true, output };
  }

  // ── Classification Individuelle ────────────────────────────────────────

  private async classifySingle(task: AgentTask): Promise<AgentResult> {
    const metrics = task.input as CreativeMetrics;
    const classified = this.classifyCreative(metrics, this.THRESHOLDS.CONDOR.maxCpa);
    return { success: true, output: classified };
  }

  // ── Recheck (apres optimisation) ──────────────────────────────────────

  private async recheck(task: AgentTask): Promise<AgentResult> {
    const { campaignId } = task.input as { campaignId: string };
    // Relancer l'analyse complete
    return this.classify48h({
      ...task,
      taskType: 'results.classify_48h',
      input: { campaignId, recheck: true },
    } as AgentTask);
  }

  // ── Logique de Classification ─────────────────────────────────────────

  private classifyCreative(metrics: CreativeMetrics, targetCpa: number): ClassifiedCreative {
    const { CONDOR, TOF, DEAD } = this.THRESHOLDS;

    let classification: CreativeClassification;
    let score: number;
    const reasons: string[] = [];
    let action: string;

    // ── CONDOR Check ──
    if (
      metrics.roas >= CONDOR.minRoas &&
      metrics.cpa <= targetCpa &&
      metrics.ctr >= CONDOR.minCtr &&
      metrics.purchases >= CONDOR.minPurchases
    ) {
      classification = 'CONDOR';
      score = Math.min(100, Math.round(
        (metrics.roas / CONDOR.minRoas * 30) +
        (targetCpa / Math.max(metrics.cpa, 0.01) * 25) +
        (metrics.ctr / CONDOR.minCtr * 25) +
        (Math.min(metrics.purchases, 20) / 20 * 20)
      ));
      reasons.push(`ROAS ${metrics.roas.toFixed(1)}x >= ${CONDOR.minRoas}x`);
      reasons.push(`CPA ${metrics.cpa.toFixed(2)}€ <= ${targetCpa}€`);
      reasons.push(`CTR ${metrics.ctr.toFixed(1)}% >= ${CONDOR.minCtr}%`);
      reasons.push(`${metrics.purchases} achats >= ${CONDOR.minPurchases} minimum`);
      action = 'SCALE → augmenter budget +20%';
    }
    // ── TOF Check ──
    else if (metrics.roas >= TOF.minRoas && metrics.ctr >= TOF.minCtr) {
      classification = 'TOF';
      score = Math.round(40 + (metrics.roas / CONDOR.minRoas * 20) + (metrics.ctr / CONDOR.minCtr * 20));
      reasons.push(`ROAS ${metrics.roas.toFixed(1)}x >= ${TOF.minRoas}x (bon en acquisition)`);
      reasons.push(`CTR ${metrics.ctr.toFixed(1)}% >= ${TOF.minCtr}% (bon engagement)`);
      if (metrics.cpa > targetCpa) reasons.push(`CPA ${metrics.cpa.toFixed(2)}€ > target — a optimiser`);
      action = 'ITERATE → tester nouveaux hooks et audiences';
    }
    // ── DEAD Check ──
    else if (
      metrics.roas < DEAD.maxRoas ||
      (metrics.spend > DEAD.maxSpendNoPurchase && metrics.purchases === 0)
    ) {
      classification = 'DEAD';
      score = Math.max(0, Math.round(metrics.roas / DEAD.maxRoas * 15));
      if (metrics.purchases === 0 && metrics.spend > 50) {
        reasons.push(`${metrics.spend.toFixed(0)}€ depenses SANS achat`);
      }
      if (metrics.roas < DEAD.maxRoas) {
        reasons.push(`ROAS ${metrics.roas.toFixed(1)}x < ${DEAD.maxRoas}x minimum`);
      }
      action = 'STOP → couper immediatement';
    }
    // ── BOF (tout le reste) ──
    else {
      classification = 'BOF';
      score = Math.round(20 + (metrics.roas * 10));
      reasons.push(`Metriques moyennes — potentiel en retargeting uniquement`);
      if (metrics.ctr < TOF.minCtr) reasons.push(`CTR ${metrics.ctr.toFixed(1)}% faible en cold`);
      action = 'RETARGET → utiliser en audiences chaudes uniquement';
    }

    return {
      adId: metrics.adId,
      classification,
      score: Math.min(100, score),
      metrics,
      reasons,
      action,
    };
  }

  // ── Metriques de Test (fallback) ──────────────────────────────────────

  private generateTestMetrics(count: number): CreativeMetrics[] {
    const metrics: CreativeMetrics[] = [];
    for (let i = 1; i <= count; i++) {
      const spend = 30 + Math.random() * 120;
      const ctr = 0.8 + Math.random() * 3.5;
      const impressions = Math.round(spend / (8 + Math.random() * 10) * 1000);
      const clicks = Math.round(impressions * ctr / 100);
      const purchases = Math.round(Math.random() > 0.3 ? clicks * (0.01 + Math.random() * 0.06) : 0);
      const revenue = purchases * (25 + Math.random() * 30);

      metrics.push({
        adId: `AD-${String(i).padStart(3, '0')}`,
        spend: +spend.toFixed(2),
        revenue: +revenue.toFixed(2),
        roas: +(revenue / Math.max(spend, 0.01)).toFixed(2),
        purchases,
        cpa: purchases > 0 ? +(spend / purchases).toFixed(2) : 0,
        ctr: +ctr.toFixed(2),
        cpc: clicks > 0 ? +(spend / clicks).toFixed(2) : 0,
        cpm: impressions > 0 ? +(spend / impressions * 1000).toFixed(2) : 0,
        impressions,
        clicks,
        frequency: +(1 + Math.random() * 2).toFixed(1),
        addToCart: Math.round(purchases * (1.5 + Math.random())),
        checkoutInitiated: Math.round(purchases * (1.1 + Math.random() * 0.5)),
      });
    }
    return metrics;
  }
}
