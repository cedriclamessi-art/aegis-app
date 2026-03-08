/**
 * DCT Statistical Significance Service — AEGIS v3.6
 * Validates DCT winners with real statistics before scaling.
 * Uses Z-test for conversion rate comparison.
 * Min 50 events per variant + 90% confidence before declaring winner.
 *
 * Without this: AEGIS scales false winners.
 * With this: scaling only happens when math confirms it.
 */

import { Pool } from 'pg';
import Anthropic from '@anthropic-ai/sdk';

interface VariantData {
  variant_id:    string;
  name:          string;
  impressions:   number;
  conversions:   number;
  conv_rate:     number;
  spend:         number;
  revenue:       number;
  roas:          number;
}

interface TestResult {
  is_significant:  boolean;
  winner_id?:      string;
  winner_confidence: number;
  p_value:         number;
  status:          'insufficient_data' | 'in_progress' | 'significant' | 'no_winner';
  recommendation:  string;
  variants:        VariantData[];
  sample_sizes:    Record<string, number>;
  min_events_needed: number;
}

export class DCTStatTestService {
  private db:     Pool;
  private claude: Anthropic;

  // Configurable thresholds
  readonly MIN_EVENTS_PER_VARIANT = 50;
  readonly CONFIDENCE_THRESHOLD   = 0.90;   // 90% — configurable per shop

  constructor(db: Pool) {
    this.db    = db;
    this.claude = new Anthropic();
  }

  /**
   * Run statistical test on a DCT experiment.
   * Called by AGENT_DCT_322 every 12h and at end of test window.
   */
  async runTest(shopId: string, dctId: string, confidenceThreshold?: number): Promise<TestResult> {
    const threshold = confidenceThreshold ?? this.CONFIDENCE_THRESHOLD;

    // Fetch all variants for this DCT
    const { rows: variants } = await this.db.query<VariantData>(
      `SELECT
         v.id AS variant_id, v.name,
         COALESCE(m.impressions, 0) AS impressions,
         COALESCE(m.conversions, 0) AS conversions,
         COALESCE(m.spend, 0) AS spend,
         COALESCE(m.revenue, 0) AS revenue,
         CASE WHEN m.impressions > 0 THEN m.conversions::numeric / m.impressions ELSE 0 END AS conv_rate,
         CASE WHEN m.spend > 0 THEN m.revenue / m.spend ELSE 0 END AS roas
       FROM dct_variants v
       LEFT JOIN ad_metrics_latest m ON m.entity_id = v.meta_ad_id AND m.shop_id = $1
       WHERE v.dct_id = $2`,
      [shopId, dctId]
    );

    if (!variants.length) {
      return {
        is_significant: false, winner_confidence: 0, p_value: 1,
        status: 'insufficient_data',
        recommendation: 'No variant data found. Check Meta API connection.',
        variants: [], sample_sizes: {},
        min_events_needed: this.MIN_EVENTS_PER_VARIANT,
      };
    }

    // Check minimum sample size
    const minConversions = Math.min(...variants.map(v => v.conversions));
    if (minConversions < this.MIN_EVENTS_PER_VARIANT) {
      const result: TestResult = {
        is_significant: false, winner_confidence: 0, p_value: 1,
        status: 'in_progress',
        recommendation: `Continue testing. Minimum variant has ${minConversions} conversions, need ${this.MIN_EVENTS_PER_VARIANT}. Estimated ${this.estimateDaysToSignificance(variants)} days remaining.`,
        variants,
        sample_sizes: Object.fromEntries(variants.map(v => [v.variant_id, v.conversions])),
        min_events_needed: this.MIN_EVENTS_PER_VARIANT - minConversions,
      };
      await this.persistTest(shopId, dctId, result, threshold);
      return result;
    }

    // Run Z-test for each variant pair vs best
    const best = variants.reduce((a, b) => b.conv_rate > a.conv_rate ? b : a);
    const others = variants.filter(v => v.variant_id !== best.variant_id);

    let minPValue = 1;
    let maxConfidence = 0;

    for (const other of others) {
      const { pValue } = this.zTestTwoProportions(
        best.conversions, best.impressions,
        other.conversions, other.impressions
      );
      if (pValue < minPValue) {
        minPValue = pValue;
        maxConfidence = 1 - pValue;
      }
    }

    const isSignificant = maxConfidence >= threshold;
    const status = isSignificant ? 'significant' :
      maxConfidence > 0.7 ? 'in_progress' : 'no_winner';

    // Get LLM recommendation
    const recommendation = await this.generateRecommendation(
      best, variants, isSignificant, maxConfidence, minPValue
    );

    const result: TestResult = {
      is_significant: isSignificant,
      winner_id: isSignificant ? best.variant_id : undefined,
      winner_confidence: maxConfidence,
      p_value: minPValue,
      status,
      recommendation,
      variants,
      sample_sizes: Object.fromEntries(variants.map(v => [v.variant_id, v.conversions])),
      min_events_needed: 0,
    };

    await this.persistTest(shopId, dctId, result, threshold);
    return result;
  }

  /**
   * Two-proportion Z-test.
   * H0: p1 == p2 (no difference between variants)
   * Returns p-value — if p < 0.10, 90% confident p1 > p2
   */
  private zTestTwoProportions(
    conv1: number, n1: number,
    conv2: number, n2: number
  ): { zScore: number; pValue: number } {
    if (n1 === 0 || n2 === 0) return { zScore: 0, pValue: 1 };

    const p1 = conv1 / n1;
    const p2 = conv2 / n2;
    const pPooled = (conv1 + conv2) / (n1 + n2);
    const se = Math.sqrt(pPooled * (1 - pPooled) * (1/n1 + 1/n2));

    if (se === 0) return { zScore: 0, pValue: 1 };

    const zScore = (p1 - p2) / se;

    // Normal CDF approximation (two-tailed)
    const pValue = 2 * (1 - this.normalCDF(Math.abs(zScore)));

    return { zScore, pValue };
  }

  // Abramowitz and Stegun approximation for normal CDF
  private normalCDF(z: number): number {
    const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
    const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
    const t = 1 / (1 + p * Math.abs(z));
    const poly = t * (a1 + t * (a2 + t * (a3 + t * (a4 + t * a5))));
    return 1 - poly * Math.exp(-z * z / 2);
  }

  private estimateDaysToSignificance(variants: VariantData[]): number {
    const rates = variants.map(v => v.conversions);
    const avgDaily = Math.max(...rates) / 2 || 1; // assume 2 days in so far
    const needed   = this.MIN_EVENTS_PER_VARIANT - Math.min(...rates);
    return Math.ceil(needed / avgDaily);
  }

  private async generateRecommendation(
    winner: VariantData, all: VariantData[],
    isSignificant: boolean, confidence: number, pValue: number
  ): Promise<string> {
    try {
      const variantSummary = all.map(v =>
        `${v.name}: ${v.conversions} conv, ${(v.conv_rate * 100).toFixed(2)}% CVR, ROAS ${v.roas.toFixed(2)}×`
      ).join(' | ');

      const resp = await this.claude.messages.create({
        model: 'claude-sonnet-4-5', max_tokens: 120,
        messages: [{
          role: 'user',
          content: `DCT test result. Confidence: ${(confidence*100).toFixed(1)}%. p-value: ${pValue.toFixed(4)}. Significant: ${isSignificant}.
Variants: ${variantSummary}
Winner candidate: ${winner.name} (${(winner.conv_rate*100).toFixed(2)}% CVR).
Give a 1-sentence action recommendation for the media buyer.`
        }]
      });
      return (resp.content[0] as {text: string}).text;
    } catch {
      return isSignificant
        ? `Scale "${winner.name}" — ${(confidence*100).toFixed(1)}% confidence it outperforms all other variants.`
        : `Continue testing — not enough confidence yet (${(confidence*100).toFixed(1)}%). Wait for more data.`;
    }
  }

  private async persistTest(
    shopId: string, dctId: string, result: TestResult, threshold: number
  ): Promise<void> {
    await this.db.query(
      `INSERT INTO dct_stat_tests
         (shop_id, dct_id, confidence_threshold, min_events_per_variant,
          variants_data, winner_variant_id, winner_confidence, is_significant,
          p_value, sample_sizes, status, recommendation)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [
        shopId, dctId, threshold, this.MIN_EVENTS_PER_VARIANT,
        JSON.stringify(result.variants),
        result.winner_id ?? null, result.winner_confidence,
        result.is_significant, result.p_value,
        JSON.stringify(result.sample_sizes),
        result.status, result.recommendation,
      ]
    );
  }
}
