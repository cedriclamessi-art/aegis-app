/**
 * AGENT_THRESHOLD_CALIBRATOR v6.0
 * Élimine les valeurs hardcodées du code.
 * Tous les seuils vivent dans dynamic_thresholds et sont recalibrés
 * statistiquement à partir des données réelles de chaque shop +
 * des benchmarks sectoriels.
 *
 * Plus jamais de PR pour changer un seuil.
 * Plus jamais de seuil faux pour un secteur différent de la beauté FR.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';

export class AgentThresholdCalibrator extends BaseAgent {
  readonly name = 'AGENT_THRESHOLD_CALIBRATOR';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'calibrate_all':   return this.calibrateAll(task);
      case 'get_threshold':   return this.getThreshold(task);
      case 'set_threshold':   return this.setThreshold(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  /**
   * Recalibration mensuelle de tous les seuils.
   * Utilise les données réelles + benchmarks + analyse statistique.
   */
  private async calibrateAll(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const calibrated: any[] = [];

    // ── 1. ROAS thresholds — depuis les benchmarks ─────────
    const { rows: roasBench } = await this.db.query(`
      SELECT p50, p75 FROM industry_benchmarks
      WHERE metric_key='roas_meta'
        AND (SELECT industry FROM shops WHERE id=$1) = industry
        AND (SELECT market FROM shops WHERE id=$1) = market
      ORDER BY computed_at DESC LIMIT 1`, [shop_id]);

    if (roasBench[0]) {
      const p50 = parseFloat(roasBench[0].p50);
      const p75 = parseFloat(roasBench[0].p75);

      // T2→T3 ROAS = médiane sectorielle (pas un chiffre inventé)
      await this.updateThreshold(shop_id, 'tier2_to_3_roas_min', p50,
        'benchmark', `Médiane sectorielle ROAS: ${p50.toFixed(2)}×`, p50 * 0.8, p50 * 1.5);

      // T3→T4 ROAS = P75 sectoriel
      await this.updateThreshold(shop_id, 'tier3_to_4_roas_min', p75,
        'benchmark', `P75 sectoriel ROAS: ${p75.toFixed(2)}×`, p75 * 0.8, p75 * 1.5);

      calibrated.push({ key: 'tier2_to_3_roas_min', new_value: p50, method: 'benchmark' });
      calibrated.push({ key: 'tier3_to_4_roas_min', new_value: p75, method: 'benchmark' });
    }

    // ── 2. Stop-loss CPA — depuis les données historiques ──
    const { rows: cpaData } = await this.db.query(`
      SELECT
        percentile_cont(0.75) WITHIN GROUP (ORDER BY cpa) AS cpa_p75,
        percentile_cont(0.90) WITHIN GROUP (ORDER BY cpa) AS cpa_p90,
        AVG(cpa) AS avg_cpa
      FROM ad_metrics WHERE shop_id=$1
        AND recorded_at > NOW() - INTERVAL '90 days'
        AND cpa > 0`, [shop_id]);

    if (cpaData[0]?.avg_cpa) {
      const avgCpa = parseFloat(cpaData[0].avg_cpa);
      const p90Cpa = parseFloat(cpaData[0].cpa_p90);
      // Stop-loss = P90 / avg CPA = "combien de fois la médiane avant de couper"
      const multiplier = avgCpa > 0 ? p90Cpa / avgCpa : 2.0;
      const clampedMult = Math.max(1.5, Math.min(4.0, multiplier));

      await this.updateThreshold(shop_id, 'stop_loss_cpa_multiplier', clampedMult,
        'statistical', `P90 CPA ${p90Cpa.toFixed(0)}€ / Avg ${avgCpa.toFixed(0)}€ = ${clampedMult.toFixed(1)}×`,
        1.5, 4.0);
      calibrated.push({ key: 'stop_loss_cpa_multiplier', new_value: clampedMult, method: 'statistical' });
    }

    // ── 3. DCT p-value — calibré selon volume de conversions ─
    const { rows: convData } = await this.db.query(`
      SELECT COUNT(*) AS total_conv
      FROM attribution_events WHERE shop_id=$1
        AND event_time > NOW() - INTERVAL '30 days'`, [shop_id]);

    const monthlyConv = parseInt(convData[0]?.total_conv ?? 0);
    // Plus de conversions → peut se permettre un p-value plus strict
    const dctPvalue = monthlyConv > 500 ? 0.01 : monthlyConv > 200 ? 0.05 : 0.10;
    await this.updateThreshold(shop_id, 'dct_winner_pvalue', dctPvalue,
      'statistical', `${monthlyConv} conv/mois → seuil p=${dctPvalue}`, 0.01, 0.10);
    calibrated.push({ key: 'dct_winner_pvalue', new_value: dctPvalue, method: 'statistical' });

    // ── 4. NPS thresholds — adaptatif depuis l'historique ──
    const { rows: npsHist } = await this.db.query(`
      SELECT AVG(nps_score) AS avg_nps, STDDEV(nps_score) AS std_nps
      FROM verbatim_insights WHERE shop_id=$1`, [shop_id]);

    if (npsHist[0]?.avg_nps) {
      const avgNps = parseFloat(npsHist[0].avg_nps);
      const stdNps = parseFloat(npsHist[0].std_nps ?? 10);
      // Article 6 se déclenche si NPS < avg - 1.5 stddev (déviation significative)
      const article6Threshold = Math.max(20, avgNps - 1.5 * stdNps);
      await this.updateThreshold(shop_id, 'article6_nps_threshold', article6Threshold,
        'adaptive', `avg ${avgNps.toFixed(0)} - 1.5σ(${stdNps.toFixed(0)}) = ${article6Threshold.toFixed(0)}`,
        15, 50);
      calibrated.push({ key: 'article6_nps_threshold', new_value: article6Threshold, method: 'adaptive' });
    }

    // ── 5. Scale confidence — depuis le taux de succès historique ──
    const { rows: scalePerf } = await this.db.query(`
      SELECT
        COUNT(*) FILTER (WHERE outcome='positive') AS positive,
        COUNT(*) AS total
      FROM action_outcomes
      WHERE shop_id=$1 AND agent_name='AGENT_SCALE'
        AND created_at > NOW() - INTERVAL '60 days'`, [shop_id]);

    if (parseInt(scalePerf[0]?.total ?? 0) > 20) {
      const successRate = parseInt(scalePerf[0].positive) / parseInt(scalePerf[0].total);
      // Si le taux de succès est bon, on peut baisser le seuil de confiance
      const confMin = successRate > 0.80 ? 0.70 : successRate > 0.65 ? 0.80 : 0.88;
      await this.updateThreshold(shop_id, 'scale_confidence_min', confMin,
        'adaptive', `Taux succès scale ${(successRate*100).toFixed(0)}% → confiance min ${confMin}`,
        0.60, 0.95);
      calibrated.push({ key: 'scale_confidence_min', new_value: confMin, method: 'adaptive' });
    }

    return { success: true, data: { thresholds_calibrated: calibrated.length, calibrated } };
  }

  /** Lit un seuil depuis la DB — shop-specific ou global fallback. */
  private async getThreshold(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { threshold_key } = payload as any;

    // Cherche d'abord un seuil shop-specific, sinon global
    const { rows } = await this.db.query(`
      SELECT current_value, default_value, min_value, max_value,
             calibration_method, confidence, description, unit
      FROM dynamic_thresholds
      WHERE threshold_key=$1
        AND (shop_id=$2 OR shop_id IS NULL)
      ORDER BY (shop_id IS NOT NULL) DESC
      LIMIT 1`, [threshold_key, shop_id]);

    if (!rows[0]) return { success: false, message: `Threshold ${threshold_key} not found` };
    return { success: true, data: rows[0] };
  }

  private async setThreshold(task: AgentTask): Promise<AgentResult> {
    const { shop_id, payload } = task;
    const { threshold_key, value, reason } = payload as any;

    await this.db.query(`
      INSERT INTO dynamic_thresholds (shop_id, threshold_key, current_value, default_value, calibration_method, calibration_rationale, description)
      VALUES ($1,$2,$3,$3,'manual',$4,$4)
      ON CONFLICT (shop_id, threshold_key) DO UPDATE SET
        current_value=$3, calibration_method='manual', calibration_rationale=$4,
        last_calibrated_at=NOW(),
        value_history=value_history || jsonb_build_object('value',current_value,'set_at',NOW(),'method',calibration_method)`,
      [shop_id, threshold_key, value, reason]);

    return { success: true, data: { threshold_key, new_value: value } };
  }

  private async updateThreshold(
    shopId: string, key: string, value: number,
    method: string, rationale: string,
    min?: number, max?: number
  ): Promise<void> {
    // Clamp to bounds
    const clamped = min !== undefined && max !== undefined
      ? Math.max(min, Math.min(max, value))
      : value;

    await this.db.query(`
      INSERT INTO dynamic_thresholds
        (shop_id, threshold_key, current_value, default_value, min_value, max_value,
         calibration_method, calibration_rationale, description, last_calibrated_at)
      VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$7,NOW())
      ON CONFLICT (shop_id, threshold_key) DO UPDATE SET
        current_value=$3,
        calibration_method=$6, calibration_rationale=$7,
        last_calibrated_at=NOW(),
        value_history=CASE
          WHEN (dynamic_thresholds.current_value != $3)
          THEN dynamic_thresholds.value_history ||
            jsonb_build_object('value',dynamic_thresholds.current_value,'set_at',NOW(),'method',dynamic_thresholds.calibration_method)
          ELSE dynamic_thresholds.value_history
        END`,
      [shopId, key, clamped, min ?? null, max ?? null, method, rationale]);
  }
}
