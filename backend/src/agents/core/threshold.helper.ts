/**
 * ThresholdHelper v6.0
 * Helper universel pour lire les seuils depuis dynamic_thresholds.
 * Remplace toutes les constantes hardcodées dans le code.
 *
 * Usage:
 *   const t = new ThresholdHelper(db, shopId);
 *   const roas = await t.get('scale_roas_threshold');  // 2.5 par défaut, recalibré
 */
import { Pool } from 'pg';

const cache = new Map<string, { value: number; expires: number }>();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 min

export class ThresholdHelper {
  constructor(private db: Pool, private shopId: string) {}

  async get(key: string, fallback?: number): Promise<number> {
    const cacheKey = `${this.shopId}:${key}`;
    const cached   = cache.get(cacheKey);
    if (cached && cached.expires > Date.now()) return cached.value;

    const { rows } = await this.db.query(`
      SELECT current_value FROM dynamic_thresholds
      WHERE threshold_key=$1 AND (shop_id=$2 OR shop_id IS NULL)
      ORDER BY (shop_id IS NOT NULL) DESC LIMIT 1`,
      [key, this.shopId]);

    const value = rows[0] ? parseFloat(rows[0].current_value) : (fallback ?? 0);
    cache.set(cacheKey, { value, expires: Date.now() + CACHE_TTL_MS });
    return value;
  }

  async getMany(keys: string[]): Promise<Record<string, number>> {
    const { rows } = await this.db.query(`
      SELECT DISTINCT ON (threshold_key) threshold_key, current_value
      FROM dynamic_thresholds
      WHERE threshold_key = ANY($1::text[])
        AND (shop_id=$2 OR shop_id IS NULL)
      ORDER BY threshold_key, (shop_id IS NOT NULL) DESC`,
      [keys, this.shopId]);

    return Object.fromEntries(rows.map((r: any) => [r.threshold_key, parseFloat(r.current_value)]));
  }
}
