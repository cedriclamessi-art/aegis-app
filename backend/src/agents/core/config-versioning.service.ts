/**
 * ConfigVersioningService — AEGIS v3.5
 * Every guardrail / config change is versioned.
 * 7 days later, AGENT_EVALUATOR fills in metrics_7d_after.
 * This creates a before/after changelog — A/B test on your own rules.
 */

import { Pool } from 'pg';

export class ConfigVersioningService {
  constructor(private db: Pool) {}

  /**
   * Record a config change. Call this whenever any setting changes.
   * @param shopId
   * @param changedBy  user_id or agent_name
   * @param opts       change details
   */
  async recordChange(
    shopId:    string,
    changedBy: string,
    opts: {
      change_type:  string;   // 'guardrail' | 'budget' | 'threshold' | 'strategy' | 'mode'
      entity_type:  string;
      entity_id?:   string;
      config_key:   string;
      value_before: unknown;
      value_after:  unknown;
      change_reason?: string;
    }
  ): Promise<string> {
    // Snapshot current metrics at time of change
    const { rows: metrics } = await this.db.query(
      `SELECT
         AVG(roas) AS roas, AVG(cpa) AS cpa,
         SUM(spend) AS spend
       FROM ad_metrics_latest WHERE shop_id = $1`,
      [shopId]
    );

    const { rows: empire } = await this.db.query(
      `SELECT score FROM empire_index WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 1`, [shopId]
    );

    const metricsSnapshot = {
      roas:          parseFloat(metrics[0]?.roas ?? 0),
      cpa:           parseFloat(metrics[0]?.cpa ?? 0),
      spend:         parseFloat(metrics[0]?.spend ?? 0),
      empire_index:  parseFloat(empire[0]?.score ?? 0),
      captured_at:   new Date().toISOString(),
    };

    const { rows } = await this.db.query(
      `INSERT INTO config_changelog
         (shop_id, changed_by, change_type, entity_type, entity_id,
          config_key, value_before, value_after, change_reason, metrics_at_change)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        shopId, changedBy, opts.change_type, opts.entity_type, opts.entity_id ?? null,
        opts.config_key,
        JSON.stringify(opts.value_before), JSON.stringify(opts.value_after),
        opts.change_reason ?? null, JSON.stringify(metricsSnapshot),
      ]
    );

    return rows[0].id;
  }

  /**
   * Fill in 7-day metrics for a config change.
   * Called by AGENT_EVALUATOR 7 days after the change.
   */
  async recordOutcome(changeId: string, shopId: string): Promise<void> {
    const { rows: metrics } = await this.db.query(
      `SELECT AVG(roas) AS roas, AVG(cpa) AS cpa, SUM(spend) AS spend
       FROM ad_metrics_latest WHERE shop_id = $1`,
      [shopId]
    );
    const { rows: empire } = await this.db.query(
      `SELECT score FROM empire_index WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 1`, [shopId]
    );
    const { rows: change } = await this.db.query(
      `SELECT metrics_at_change FROM config_changelog WHERE id = $1`, [changeId]
    );

    const before  = change[0]?.metrics_at_change ?? {};
    const after   = { roas: parseFloat(metrics[0]?.roas ?? 0), empire_index: parseFloat(empire[0]?.score ?? 0) };
    const delta   = before.empire_index
      ? ((after.empire_index - before.empire_index) / before.empire_index) * 100
      : 0;

    await this.db.query(
      `UPDATE config_changelog
       SET metrics_7d_after  = $1,
           performance_delta = $2
       WHERE id = $3`,
      [JSON.stringify(after), delta.toFixed(2), changeId]
    );
  }

  /**
   * Get the changelog for a shop, optionally filtered by change_type.
   */
  async getChangelog(
    shopId:      string,
    changeType?: string,
    limit = 50
  ): Promise<unknown[]> {
    let q = `SELECT * FROM config_changelog WHERE shop_id = $1`;
    const params: unknown[] = [shopId];
    if (changeType) { params.push(changeType); q += ` AND change_type = $${params.length}`; }
    q += ` ORDER BY created_at DESC LIMIT ${limit}`;
    const { rows } = await this.db.query(q, params);
    return rows;
  }
}
