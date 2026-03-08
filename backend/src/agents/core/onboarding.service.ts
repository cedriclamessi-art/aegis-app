/**
 * OnboardingService v3.7
 * Step-by-step wizard state. 6 steps to full AEGIS activation.
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';

const STEPS = [
  { step: 1, label: 'Connect Shopify',         required_env: 'SHOPIFY_TOKEN' },
  { step: 2, label: 'Connect Meta Ads',         required_env: 'META_ACCESS_TOKEN' },
  { step: 3, label: 'Set product margins',      required_table: 'product_economics' },
  { step: 4, label: 'Configure guardrails',     required_table: 'guardrail_configs' },
  { step: 5, label: 'Launch first DCT',         required_table: 'dct_experiments' },
  { step: 6, label: 'Configure brief delivery', required_table: 'brief_delivery_preferences' },
];

export class OnboardingService {
  constructor(private db: Pool, private redis: Redis) {}

  async getState(shopId: string): Promise<unknown> {
    const { rows } = await this.db.query(`SELECT * FROM onboarding_state WHERE shop_id = $1`, [shopId]);
    if (!rows[0]) {
      await this.db.query(`INSERT INTO onboarding_state (shop_id) VALUES ($1) ON CONFLICT DO NOTHING`, [shopId]);
      return this.getState(shopId);
    }
    const state = rows[0];

    // Auto-detect completed steps
    const auto = await this.autoDetectCompletedSteps(shopId);
    const allCompleted = [...new Set([...state.completed_steps, ...auto])];

    return {
      current_step: state.current_step,
      completed_steps: allCompleted,
      steps: STEPS.map(s => ({
        ...s,
        completed: allCompleted.includes(s.step),
        is_current: s.step === state.current_step,
      })),
      completed: allCompleted.length >= 6,
      completion_pct: Math.round((allCompleted.length / 6) * 100),
    };
  }

  private async autoDetectCompletedSteps(shopId: string): Promise<number[]> {
    const completed: number[] = [];

    const checks = [
      { step: 1, query: `SELECT 1 FROM shopify_credentials WHERE shop_id = $1 LIMIT 1` },
      { step: 2, query: `SELECT 1 FROM platform_credentials WHERE shop_id = $1 AND platform = 'meta' LIMIT 1` },
      { step: 3, query: `SELECT 1 FROM product_economics WHERE shop_id = $1 LIMIT 1` },
      { step: 4, query: `SELECT 1 FROM guardrail_configs WHERE shop_id = $1 LIMIT 1` },
      { step: 5, query: `SELECT 1 FROM dct_experiments WHERE shop_id = $1 LIMIT 1` },
      { step: 6, query: `SELECT 1 FROM brief_delivery_preferences WHERE shop_id = $1 AND enabled = true LIMIT 1` },
    ];

    for (const check of checks) {
      try {
        const { rows } = await this.db.query(check.query, [shopId]);
        if (rows.length > 0) completed.push(check.step);
      } catch { /* table may not exist yet */ }
    }

    return completed;
  }

  async completeStep(shopId: string, step: number): Promise<void> {
    await this.db.query(`
      UPDATE onboarding_state SET
        current_step = GREATEST(current_step, $1 + 1),
        completed_steps = array_append(ARRAY(SELECT DISTINCT UNNEST(completed_steps || ARRAY[$1::int])), 0) - 0,
        updated_at = NOW()
      WHERE shop_id = $2`, [step, shopId]);
  }
}
