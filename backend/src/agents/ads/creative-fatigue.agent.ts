/**
 * AGENT_CREATIVE_FATIGUE v7.0 — Hack #71
 * Surveille la saturation des créatifs Meta/TikTok.
 * Détecte quand un créatif commence à fatiguer l'audience :
 *   - CTR chute > 25% vs semaine 1
 *   - Fréquence > 3 en 7 jours
 *   - CPM augmente > 30%
 *
 * Recommande le remplacement avant que le ROAS ne s'effondre.
 * En T3+: retire automatiquement les créatifs en fatigue sévère.
 */
import { BaseAgent, AgentTask, AgentResult } from '../base/agent.base';
import { tierGate } from '../core/tier-gate.middleware';
import { ThresholdHelper } from '../core/threshold.helper';

export class AgentCreativeFatigue extends BaseAgent {
  readonly name = 'AGENT_CREATIVE_FATIGUE';

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.type) {
      case 'detect':      return this.detect(task);
      case 'retire':      return this.retire(task);
      case 'get_report':  return this.getReport(task);
      default: throw new Error(`Unknown: ${task.type}`);
    }
  }

  private async detect(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const t = new ThresholdHelper(this.db, shop_id);
    const freqThreshold = await t.get('creative_fatigue_frequency', 3.0);
    const ctrDropThreshold = await t.get('creative_fatigue_ctr_drop', 0.25);

    // Métriques par créatif : semaine 1 vs période courante
    const { rows } = await this.db.query(`
      WITH creative_metrics AS (
        SELECT
          creative_id,
          creative_name,
          AVG(frequency) AS freq_7d,
          AVG(ctr) FILTER (
            WHERE recorded_at BETWEEN MIN(recorded_at) OVER (PARTITION BY creative_id)
              AND MIN(recorded_at) OVER (PARTITION BY creative_id) + INTERVAL '7 days'
          ) AS ctr_week1,
          AVG(ctr) FILTER (WHERE recorded_at > NOW() - INTERVAL '3 days') AS ctr_current,
          AVG(cpm) FILTER (WHERE recorded_at < NOW() - INTERVAL '14 days') AS cpm_base,
          AVG(cpm) FILTER (WHERE recorded_at > NOW() - INTERVAL '3 days') AS cpm_current,
          AVG(thumb_stop_rate) AS avg_thumb_stop
        FROM ad_metrics
        WHERE shop_id=$1
          AND creative_id IS NOT NULL
          AND recorded_at > NOW() - INTERVAL '30 days'
        GROUP BY creative_id, creative_name
        HAVING COUNT(*) >= 5
      )
      SELECT *,
        CASE
          WHEN ctr_week1 > 0
          THEN (ctr_week1 - COALESCE(ctr_current, ctr_week1)) / ctr_week1
          ELSE 0
        END AS ctr_drop_pct,
        CASE
          WHEN cpm_base > 0
          THEN (COALESCE(cpm_current, cpm_base) - cpm_base) / cpm_base
          ELSE 0
        END AS cpm_increase_pct
      FROM creative_metrics`, [shop_id]);

    let detected = 0;
    for (const r of rows) {
      const ctrDrop    = parseFloat(r.ctr_drop_pct ?? 0);
      const cpmIncrease = parseFloat(r.cpm_increase_pct ?? 0);
      const freq        = parseFloat(r.freq_7d ?? 0);

      let level: string;
      if (ctrDrop >= 0.40 || freq >= freqThreshold * 1.5) level = 'severe';
      else if (ctrDrop >= ctrDropThreshold || freq >= freqThreshold || cpmIncrease >= 0.30) level = 'moderate';
      else if (ctrDrop >= 0.10 || freq >= freqThreshold * 0.75) level = 'mild';
      else level = 'none';

      if (level === 'none') continue;

      await this.db.query(`
        INSERT INTO creative_fatigue_signals
          (shop_id, creative_id, creative_name, frequency_7d, ctr_drop_pct,
           ctr_week1, ctr_current, cpm_increase_pct, thumb_stop_rate, fatigue_level)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
        ON CONFLICT (shop_id, creative_id, DATE(detected_at)) DO UPDATE SET
          frequency_7d=$4, ctr_drop_pct=$5, ctr_current=$7, fatigue_level=$10`,
        [shop_id, r.creative_id, r.creative_name, r.freq_7d,
         ctrDrop, r.ctr_week1, r.ctr_current, cpmIncrease,
         r.avg_thumb_stop, level]);

      if (level === 'severe' || level === 'moderate') {
        await this.remember(shop_id, {
          memory_key: `fatigue_${r.creative_id}`,
          memory_type: 'warning',
          value: {
            creative: r.creative_name, level,
            ctr_drop: `${(ctrDrop * 100).toFixed(0)}%`,
            frequency: freq.toFixed(1),
            message: `Fatigue ${level} sur "${r.creative_name}" — CTR -${(ctrDrop*100).toFixed(0)}%, fréquence ${freq.toFixed(1)}×`,
            severity: level === 'severe' ? 'critical' : 'warning',
          },
          ttl_hours: 72,
        });
      }

      detected++;
    }

    // Auto-retire si fatigue sévère et T3+
    if (detected > 0) {
      await this.retire({ ...task, type: 'retire' });
    }

    return { success: true, data: { creatives_analyzed: rows.length, fatigued: detected } };
  }

  private async retire(task: AgentTask): Promise<AgentResult> {
    const { shop_id } = task;
    const gate = await tierGate(this.db, shop_id, this.name, 0);

    const { rows: severe } = await this.db.query(`
      SELECT DISTINCT ON (creative_id) *
      FROM creative_fatigue_signals
      WHERE shop_id=$1 AND fatigue_level='severe'
        AND retired_at IS NULL AND action_taken IS NULL
      ORDER BY creative_id, detected_at DESC`, [shop_id]);

    let retired = 0;
    for (const f of severe) {
      if (gate.verdict === 'execute' || gate.verdict === 'semi_auto') {
        await this.emit('meta:pause_creative', {
          shop_id, creative_id: f.creative_id,
          reason: `Fatigue sévère — CTR -${(f.ctr_drop_pct * 100).toFixed(0)}%`,
        });

        await this.db.query(`
          UPDATE creative_fatigue_signals SET
            action_taken='paused', retired_at=NOW()
          WHERE id=$1`, [f.id]);

        await this.emit('creative:request_replacement', {
          shop_id, creative_name: f.creative_name,
          reason: `Remplacer ce créatif — fatigue sévère après ${f.frequency_7d?.toFixed(1)}× de fréquence`,
        });

        retired++;
      }
    }

    return { success: true, data: { retired, mode: gate.agent_mode } };
  }

  private async getReport(task: AgentTask): Promise<AgentResult> {
    const { rows } = await this.db.query(`
      SELECT DISTINCT ON (creative_id)
        creative_name, fatigue_level, ctr_drop_pct, frequency_7d,
        cpm_increase_pct, detected_at, action_taken
      FROM creative_fatigue_signals WHERE shop_id=$1
      ORDER BY creative_id, detected_at DESC
      LIMIT 20`, [task.shop_id]);
    return { success: true, data: { creatives: rows } };
  }
}
