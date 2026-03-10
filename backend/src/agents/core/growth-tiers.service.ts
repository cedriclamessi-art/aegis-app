/**
 * GROWTH TIERS SERVICE — Les 4 Paliers Stratégiques AEGIS
 * ═══════════════════════════════════════════════════════════
 *
 * Gère la progression d'un business à travers les 4 paliers de croissance :
 *
 *   PALIER 1 — VALIDATION      (0 → 1 Million €)
 *   Trouver un produit gagnant, valider le marché, premières ventes.
 *
 *   PALIER 2 — STRUCTURATION   (1 → 10 Millions €)
 *   Stabiliser l'acquisition, optimiser la conversion, augmenter la rétention.
 *
 *   PALIER 3 — EXPANSION       (10 → 120 Millions €)
 *   Multi-canal, brand building, optimisation des marges, expansion marché.
 *
 *   PALIER 4 — DOMINATION      (120 Millions € → ∞)
 *   Multi-marques, allocation capital, innovation, domination compétitive.
 *
 * Le service évalue quotidiennement le CA annualisé et ajuste le palier.
 * Chaque transition déclenche un changement de stratégie AEGIS.
 */

import { Pool } from 'pg';

// ── Types ────────────────────────────────────────────────────────────────

export interface GrowthTier {
  tier:             number;        // 1-4
  name:             string;        // VALIDATION | STRUCTURATION | EXPANSION | DOMINATION
  label:            string;        // "0 → 1 Million €"
  revenueMin:       number;
  revenueMax:       number | null; // null for tier 4 (∞)
  mission:          string;
  strategicFocus:   string[];
  primaryAgents:    string[];
  kpiTargets:       Record<string, number>;
}

export interface ShopGrowthStatus {
  shopId:           string;
  currentTier:      number;
  tierName:         string;
  revenueAnnual:    number;
  revenueMonthly:   number;
  progressPct:      number;
  nextTierAt:       number | null;   // Revenue needed for next tier
  tierConfig:       GrowthTier;
  tierHistory:      any[];
}

export interface TierTransitionResult {
  transitioned:     boolean;
  fromTier:         number;
  toTier:           number;
  revenue:          number;
  announcement:     string;
}

// ── Growth Tier Definitions ──────────────────────────────────────────────

export const GROWTH_TIERS: GrowthTier[] = [
  {
    tier: 1, name: 'VALIDATION', label: '0 → 1 Million €',
    revenueMin: 0, revenueMax: 1_000_000,
    mission: 'Transformer une idée en business validé.',
    strategicFocus: [
      'Détecter des produits gagnants',
      'Analyser la demande',
      'Construire rapidement une boutique',
      'Créer les premières publicités',
      'Tester différents angles marketing',
      'Trouver un ROAS rentable',
      'Identifier un winner product',
    ],
    primaryAgents: ['AGENT_SPY', 'AGENT_STORE_BUILDER', 'AGENT_CREATIVE_FACTORY', 'AGENT_META_TESTING', 'AGENT_PROFITABILITY'],
    kpiTargets: { target_roas: 2.0, target_cpa_max: 25, target_conversion_rate: 2.0, min_products_tested: 5 },
  },
  {
    tier: 2, name: 'STRUCTURATION', label: '1 → 10 Millions €',
    revenueMin: 1_000_000, revenueMax: 10_000_000,
    mission: 'Transformer un produit gagnant en machine de croissance stable.',
    strategicFocus: [
      'Stabiliser l\'acquisition',
      'Améliorer le taux de conversion',
      'Augmenter le panier moyen',
      'Améliorer la rétention',
      'Structurer les campagnes',
      'Optimiser les créatives',
    ],
    primaryAgents: ['AGENT_SCALE', 'AGENT_DCT_ITERATION', 'AGENT_AOV', 'AGENT_KLAVIYO', 'AGENT_EMAIL_RECOVERY', 'AGENT_DAYPARTING'],
    kpiTargets: { target_roas: 2.5, target_repeat_rate: 15, target_aov_growth: 10, target_ltv_90d: 60 },
  },
  {
    tier: 3, name: 'EXPANSION', label: '10 → 120 Millions €',
    revenueMin: 10_000_000, revenueMax: 120_000_000,
    mission: 'Transformer une marque rentable en empire e-commerce.',
    strategicFocus: [
      'Multiplier les canaux d\'acquisition',
      'Orchestrer plusieurs marchés',
      'Améliorer la brand equity',
      'Optimiser la marge',
      'Anticiper les chutes de performance',
      'Gérer plusieurs funnels',
    ],
    primaryAgents: ['AGENT_BUDGET_OPTIMIZER', 'AGENT_STRATEGIES', 'AGENT_COMPETITIVE_INTEL', 'AGENT_PRICING', 'AGENT_REPUTATION', 'AGENT_TIKTOK_ORGANIC'],
    kpiTargets: { target_roas: 3.0, target_channels: 3, target_brand_search_pct: 20, target_margin_pct: 30 },
  },
  {
    tier: 4, name: 'DOMINATION', label: '120 Millions € → ∞',
    revenueMin: 120_000_000, revenueMax: null,
    mission: 'Créer un système capable de croître sans plafond.',
    strategicFocus: [
      'Piloter plusieurs marques',
      'Allouer le capital intelligemment',
      'Détecter de nouvelles opportunités',
      'Industrialiser l\'innovation',
      'Protéger l\'avantage concurrentiel',
      'Mutualiser les données et l\'intelligence',
    ],
    primaryAgents: ['AGENT_STRATEGIES', 'AGENT_BUDGET_OPTIMIZER', 'AGENT_SPY', 'AGENT_GHOST', 'AGENT_RISK_ENGINE', 'AGENT_FORECASTER'],
    kpiTargets: { target_roas: 3.5, target_brands: 2, target_empire_index: 80, target_dependency_max: 40 },
  },
];

// ── Service Implementation ───────────────────────────────────────────────

export class GrowthTierService {
  constructor(private db: Pool) {}

  /**
   * Évalue le palier actuel d'un shop basé sur son CA annualisé.
   * Met à jour si nécessaire et retourne le statut.
   */
  async evaluate(shopId: string): Promise<TierTransitionResult> {
    // Ensure shop has a growth_tiers entry
    await this.db.query(`
      INSERT INTO growth_tiers (shop_id, current_tier, tier_name)
      VALUES ($1, 1, 'VALIDATION')
      ON CONFLICT (shop_id) DO NOTHING`, [shopId]);

    // Calculate annualized revenue
    const { rows: [rev] } = await this.db.query(`
      SELECT
        COALESCE(SUM(revenue), 0) AS rev_30d,
        COALESCE(SUM(revenue), 0) * 12 AS rev_annual
      FROM (
        SELECT COALESCE(
          (SELECT SUM(total_amount) FROM orders
           WHERE shop_id = $1 AND created_at > NOW() - INTERVAL '30 days'),
          (SELECT SUM(revenue) FROM ad_metrics
           WHERE shop_id = $1 AND recorded_at > NOW() - INTERVAL '30 days')
        ) AS revenue
      ) sub`, [shopId]);

    const monthlyRevenue = parseFloat(rev?.rev_30d || 0);
    const annualRevenue  = parseFloat(rev?.rev_annual || 0);

    // Determine correct tier from revenue
    const newTier = this.tierFromRevenue(annualRevenue);

    // Get current tier
    const { rows: [current] } = await this.db.query(
      `SELECT current_tier FROM growth_tiers WHERE shop_id = $1`, [shopId]);
    const currentTier = current?.current_tier || 1;

    // Calculate progress within tier
    const tierConfig = GROWTH_TIERS[newTier - 1];
    const progressPct = this.calculateProgress(annualRevenue, tierConfig);

    // Update revenue and progress
    await this.db.query(`
      UPDATE growth_tiers SET
        revenue_annual_eur  = $1,
        revenue_monthly_eur = $2,
        tier_progress_pct   = $3,
        strategic_focus     = $4,
        updated_at          = NOW()
      WHERE shop_id = $5`,
      [annualRevenue, monthlyRevenue, progressPct,
       JSON.stringify(tierConfig.strategicFocus), shopId]);

    // Check for tier transition
    if (newTier !== currentTier) {
      return this.applyTransition(shopId, currentTier, newTier, annualRevenue);
    }

    return {
      transitioned: false,
      fromTier:     currentTier,
      toTier:       currentTier,
      revenue:      annualRevenue,
      announcement: '',
    };
  }

  /**
   * Get the full growth status for a shop.
   */
  async getStatus(shopId: string): Promise<ShopGrowthStatus> {
    // Ensure entry exists
    await this.evaluate(shopId);

    const { rows: [gt] } = await this.db.query(
      `SELECT * FROM growth_tiers WHERE shop_id = $1`, [shopId]);

    const tier    = gt?.current_tier || 1;
    const config  = GROWTH_TIERS[tier - 1];
    const nextMax = config.revenueMax;

    return {
      shopId,
      currentTier:    tier,
      tierName:       config.name,
      revenueAnnual:  parseFloat(gt?.revenue_annual_eur || 0),
      revenueMonthly: parseFloat(gt?.revenue_monthly_eur || 0),
      progressPct:    parseFloat(gt?.tier_progress_pct || 0),
      nextTierAt:     nextMax,
      tierConfig:     config,
      tierHistory:    gt?.tier_history || [],
    };
  }

  /**
   * Get all 4 tier definitions.
   */
  getTierDefinitions(): GrowthTier[] {
    return GROWTH_TIERS;
  }

  /**
   * Get the tier config for a specific tier number.
   */
  getTierConfig(tier: number): GrowthTier {
    if (tier < 1 || tier > 4) throw new Error(`Invalid tier: ${tier}. Must be 1-4.`);
    return GROWTH_TIERS[tier - 1];
  }

  // ── Private Methods ────────────────────────────────────────────────────

  private tierFromRevenue(annualRevenue: number): number {
    if (annualRevenue >= 120_000_000) return 4;
    if (annualRevenue >= 10_000_000)  return 3;
    if (annualRevenue >= 1_000_000)   return 2;
    return 1;
  }

  private calculateProgress(revenue: number, tierConfig: GrowthTier): number {
    const min = tierConfig.revenueMin;
    const max = tierConfig.revenueMax;
    if (!max) return Math.min(100, (revenue / 200_000_000) * 100); // Tier 4: arbitrary 200M as "100%"
    const range = max - min;
    if (range <= 0) return 0;
    return Math.min(100, Math.max(0, ((revenue - min) / range) * 100));
  }

  private async applyTransition(
    shopId: string, fromTier: number, toTier: number, revenue: number
  ): Promise<TierTransitionResult> {
    const tierConfig = GROWTH_TIERS[toTier - 1];
    const promoted   = toTier > fromTier;

    const announcement = promoted
      ? `🚀 AEGIS a franchi le palier ${fromTier} ! Bienvenue au Palier ${toTier} — ${tierConfig.name}. ` +
        `Objectif : ${tierConfig.mission} ` +
        `CA annualisé : ${this.formatRevenue(revenue)}.`
      : `⚠️ Retour au Palier ${toTier} — ${tierConfig.name}. ` +
        `CA annualisé : ${this.formatRevenue(revenue)}. Les stratégies sont recalibrées.`;

    // Update growth_tiers
    await this.db.query(`
      UPDATE growth_tiers SET
        current_tier    = $1,
        tier_name       = $2,
        tier_history    = tier_history || $3::jsonb,
        strategic_focus = $4,
        entered_at      = NOW(),
        updated_at      = NOW()
      WHERE shop_id = $5`,
      [
        toTier,
        tierConfig.name,
        JSON.stringify({ tier: fromTier, exited: new Date().toISOString(), revenue_at_exit: revenue }),
        JSON.stringify(tierConfig.strategicFocus),
        shopId,
      ]);

    // Log transition
    await this.db.query(`
      INSERT INTO growth_tier_transitions
        (shop_id, from_tier, to_tier, revenue_at_transition, triggered_by, announcement)
      VALUES ($1, $2, $3, $4, 'revenue_threshold', $5)`,
      [shopId, fromTier, toTier, revenue, announcement]);

    // Update empire_state growth_tier
    await this.db.query(`
      UPDATE ops.empire_state SET growth_tier = $1
      WHERE tenant_id = $2`, [toTier, shopId]).catch(() => {});

    return { transitioned: true, fromTier, toTier, revenue, announcement };
  }

  private formatRevenue(eur: number): string {
    if (eur >= 1_000_000) return `${(eur / 1_000_000).toFixed(1)}M€`;
    if (eur >= 1_000)     return `${(eur / 1_000).toFixed(0)}K€`;
    return `${eur.toFixed(0)}€`;
  }
}
