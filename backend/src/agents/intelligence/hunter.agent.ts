/**
 * AGENT_HUNTER — Chasseur de Produits Gagnants
 * ═══════════════════════════════════════════════════════════
 *
 * MISSION : Chaque semaine, livrer 5 produits gagnants prêts à lancer.
 *
 * HUNTER scrape en continu les meilleures sources (TikTok Shop, Amazon Movers,
 * AliExpress Hot, Shopify stores, Google Trends, Reddit) et analyse chaque
 * produit selon 12 critères pour attribuer un Product Score sur 100.
 *
 * ── 12 CRITÈRES D'ÉVALUATION ──────────────────────────────────
 *
 *  1. Marge potentielle (>60% = bonus)
 *  2. Viralité (engagement, UGC existant)
 *  3. Concurrence (saturation du marché)
 *  4. Facilité logistique (poids, fournisseurs fiables)
 *  5. Potentiel créatif (angles possibles)
 *  6. Saisonnalité (timing optimal)
 *  7. Risque légal/compliance
 *  8. Demande Google Trends (tendance 30j)
 *  9. Prix point sweet spot (15-70€)
 * 10. Repeat purchase potential (LTV)
 * 11. Storytelling factor (émotionnel vs fonctionnel)
 * 12. Ad creative potential (UGC-friendly, demo-friendly)
 *
 * ── OUTPUT ──────────────────────────────────────────────────────
 *
 *  Chaque lundi : Top 5 produits avec fiches complètes
 *  Table : hunter.discoveries (scores, sources, fiches)
 *  Interaction : l'utilisateur clique "Lancer" → pipeline auto
 *
 * ── SOURCES SCRAPÉES ────────────────────────────────────────────
 *
 *  - TikTok Shop Trending
 *  - Amazon Movers & Shakers
 *  - AliExpress Hot Products
 *  - Shopify Trending Stores (via spy.agent)
 *  - Google Trends (niches émergentes)
 *  - Reddit (r/shutupandtakemymoney, r/ineedthis)
 *  - Pinterest Trending Pins
 *
 * ── OUTILS EXTERNES (INSPIRATION & DONNÉES) ─────────────────
 *
 *  - WinningHunter (https://winninghunter.com) — Spy ads + trending products
 *  - AdHeart (https://adheart.me) — Creative intelligence + ad library
 *  - TrendTrack (https://www.trendtrack.io) — Trend detection + competitor analysis
 *  - DropMagic (https://dropmagic.ai) — Store builder inspiration
 *  - CopyFy (https://www.copyfy.io) — Product page templates
 *  - Freepik (https://www.freepik.com) — Creative asset workflow
 *  - SemRush (https://www.semrush.com) — SEO keyword & competitor data
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';

// ── Types ────────────────────────────────────────────────
interface ProductCandidate {
  name: string;
  sourceUrl: string;
  source: 'tiktok_shop' | 'amazon' | 'aliexpress' | 'shopify' | 'google_trends' | 'reddit' | 'pinterest' | 'winninghunter' | 'adheart' | 'trendtrack';
  imageUrl?: string;
  estimatedCost: number;
  estimatedPrice: number;
  category: string;
  rawData: Record<string, any>;
}

interface ScoredProduct extends ProductCandidate {
  scores: ProductScores;
  totalScore: number;
  grade: 'S' | 'A' | 'B' | 'C' | 'D';
  verdict: string;
  angles: string[];
  risks: string[];
}

interface ProductScores {
  margin: number;           // 1. Marge potentielle
  virality: number;         // 2. Viralité
  competition: number;      // 3. Concurrence (inversé: peu = mieux)
  logistics: number;        // 4. Facilité logistique
  creativePotential: number; // 5. Potentiel créatif
  seasonality: number;      // 6. Saisonnalité
  compliance: number;       // 7. Risque légal
  trendDemand: number;      // 8. Demande Google Trends
  pricePoint: number;       // 9. Prix sweet spot
  repeatPurchase: number;   // 10. Potentiel repeat
  storytelling: number;     // 11. Facteur storytelling
  adCreative: number;       // 12. Potentiel créatif pub
}

// ── Weights par critère ──────────────────────────────────
const WEIGHTS: Record<keyof ProductScores, number> = {
  margin: 15,
  virality: 12,
  competition: 10,
  logistics: 5,
  creativePotential: 10,
  seasonality: 5,
  compliance: 8,
  trendDemand: 10,
  pricePoint: 5,
  repeatPurchase: 8,
  storytelling: 5,
  adCreative: 7,
};

const TOTAL_WEIGHT = Object.values(WEIGHTS).reduce((a, b) => a + b, 0);

// ── HUNTER Agent ─────────────────────────────────────────
export class HunterAgent {
  readonly agentId = 'AGENT_HUNTER';
  readonly name = 'Hunter — Chasseur de Produits';

  constructor(
    private db: Pool,
    private redis: Redis
  ) {}

  // ── MAIN: Weekly Hunt ──────────────────────────────────
  async weeklyHunt(tenantId: string): Promise<ScoredProduct[]> {
    console.log(`[HUNTER] 🎯 Lancement de la chasse hebdomadaire — tenant=${tenantId}`);

    // 1. Collecter les candidats de toutes les sources
    const candidates = await this.collectCandidates(tenantId);
    console.log(`[HUNTER] ${candidates.length} candidats collectés`);

    // 2. Scorer chaque produit
    const scored = candidates.map(c => this.scoreProduct(c));

    // 3. Trier par score total
    scored.sort((a, b) => b.totalScore - a.totalScore);

    // 4. Prendre le Top 5
    const top5 = scored.slice(0, 5);

    // 5. Persister en base
    await this.persistDiscoveries(tenantId, top5);

    // 6. Notifier via agent_memory
    await this.notifyDiscoveries(tenantId, top5);

    console.log(`[HUNTER] ✅ Top 5 livré — scores: ${top5.map(p => p.totalScore).join(', ')}`);
    return top5;
  }

  // ── Collecter les candidats ────────────────────────────
  private async collectCandidates(tenantId: string): Promise<ProductCandidate[]> {
    const candidates: ProductCandidate[] = [];

    // Source 1: Produits depuis le scraper interne (si disponible)
    try {
      const { rows } = await this.db.query(`
        SELECT product_url, product_name, source, price, cost_estimate, category, raw_data
        FROM intel.scraped_products
        WHERE tenant_id = $1 AND scraped_at > NOW() - INTERVAL '7 days'
        ORDER BY engagement_score DESC NULLS LAST
        LIMIT 50
      `, [tenantId]);

      for (const r of rows) {
        candidates.push({
          name: r.product_name || 'Unknown',
          sourceUrl: r.product_url,
          source: r.source || 'aliexpress',
          estimatedCost: parseFloat(r.cost_estimate) || 5,
          estimatedPrice: parseFloat(r.price) || 25,
          category: r.category || 'general',
          rawData: r.raw_data || {},
        });
      }
    } catch (_) {
      // Table may not exist yet
    }

    // Source 2: Winners détectés par spy.agent
    try {
      const { rows } = await this.db.query(`
        SELECT payload
        FROM agents.agent_memory
        WHERE tenant_id = $1
          AND agent_id = 'AGENT_SPY'
          AND memory_type = 'winning_product'
          AND created_at > NOW() - INTERVAL '7 days'
        ORDER BY created_at DESC
        LIMIT 20
      `, [tenantId]);

      for (const r of rows) {
        const p = r.payload;
        if (p?.product_url) {
          candidates.push({
            name: p.product_name || p.title || 'Spy Discovery',
            sourceUrl: p.product_url,
            source: 'shopify',
            estimatedCost: p.cost_estimate || 8,
            estimatedPrice: p.price || 30,
            category: p.category || 'trending',
            rawData: p,
          });
        }
      }
    } catch (_) {}

    // Source 3: Trending from Ghost signals
    try {
      const { rows } = await this.db.query(`
        SELECT payload
        FROM agents.agent_memory
        WHERE tenant_id = $1
          AND agent_id = 'AGENT_GHOST'
          AND memory_type = 'ghost_signal'
          AND payload->>'mode' = 'opportunity'
          AND created_at > NOW() - INTERVAL '7 days'
        LIMIT 10
      `, [tenantId]);

      for (const r of rows) {
        const p = r.payload;
        if (p?.product_url) {
          candidates.push({
            name: p.description || 'Ghost Opportunity',
            sourceUrl: p.product_url,
            source: 'google_trends',
            estimatedCost: 6,
            estimatedPrice: 25,
            category: 'opportunity',
            rawData: p,
          });
        }
      }
    } catch (_) {}

    // Dédupliquer par URL
    const seen = new Set<string>();
    return candidates.filter(c => {
      if (seen.has(c.sourceUrl)) return false;
      seen.add(c.sourceUrl);
      return true;
    });
  }

  // ── Scorer un produit ──────────────────────────────────
  scoreProduct(candidate: ProductCandidate): ScoredProduct {
    const margin = this.scoreMargin(candidate);
    const virality = this.scoreVirality(candidate);
    const competition = this.scoreCompetition(candidate);
    const logistics = this.scoreLogistics(candidate);
    const creativePotential = this.scoreCreativePotential(candidate);
    const seasonality = this.scoreSeasonality(candidate);
    const compliance = this.scoreCompliance(candidate);
    const trendDemand = this.scoreTrendDemand(candidate);
    const pricePoint = this.scorePricePoint(candidate);
    const repeatPurchase = this.scoreRepeatPurchase(candidate);
    const storytelling = this.scoreStorytelling(candidate);
    const adCreative = this.scoreAdCreative(candidate);

    const scores: ProductScores = {
      margin, virality, competition, logistics, creativePotential,
      seasonality, compliance, trendDemand, pricePoint,
      repeatPurchase, storytelling, adCreative,
    };

    // Score pondéré sur 100
    const totalScore = Math.round(
      Object.entries(scores).reduce((sum, [key, val]) => {
        return sum + (val * WEIGHTS[key as keyof ProductScores]);
      }, 0) / TOTAL_WEIGHT
    );

    const grade = totalScore >= 90 ? 'S' : totalScore >= 75 ? 'A' : totalScore >= 60 ? 'B' : totalScore >= 40 ? 'C' : 'D';

    const angles = this.generateAngles(candidate, scores);
    const risks = this.identifyRisks(candidate, scores);

    const verdict = totalScore >= 80
      ? `🔥 Winner potentiel — marge ${Math.round(margin)}%, forte viralité`
      : totalScore >= 60
        ? `✅ Solide — bon potentiel avec optimisation`
        : `⚠️ Risqué — points faibles à surveiller`;

    return { ...candidate, scores, totalScore, grade, verdict, angles, risks };
  }

  // ── Scoring individuel ─────────────────────────────────
  private scoreMargin(p: ProductCandidate): number {
    const margin = ((p.estimatedPrice - p.estimatedCost) / p.estimatedPrice) * 100;
    if (margin >= 70) return 100;
    if (margin >= 60) return 85;
    if (margin >= 50) return 70;
    if (margin >= 40) return 50;
    return 30;
  }

  private scoreVirality(p: ProductCandidate): number {
    const data = p.rawData;
    const engagement = data.engagement_score || data.virality_score || 0;
    if (engagement > 80) return 100;
    if (engagement > 50) return 75;
    if (engagement > 20) return 50;
    if (data.ugc_count > 5) return 70;
    return 40;
  }

  private scoreCompetition(p: ProductCandidate): number {
    const data = p.rawData;
    const competitors = data.competitor_count || data.sellers_count || 10;
    if (competitors < 5) return 100;
    if (competitors < 15) return 75;
    if (competitors < 50) return 50;
    return 25;
  }

  private scoreLogistics(p: ProductCandidate): number {
    const data = p.rawData;
    const weight = data.weight_kg || 0.5;
    if (weight < 0.5) return 100;
    if (weight < 1) return 80;
    if (weight < 3) return 60;
    return 35;
  }

  private scoreCreativePotential(p: ProductCandidate): number {
    const data = p.rawData;
    if (data.is_visual || data.ugc_friendly) return 90;
    if (data.demo_friendly) return 85;
    if (p.category === 'beauty' || p.category === 'gadget' || p.category === 'home') return 75;
    return 50;
  }

  private scoreSeasonality(p: ProductCandidate): number {
    const now = new Date();
    const month = now.getMonth() + 1;
    const data = p.rawData;
    if (data.evergreen) return 90;
    // Q4 boost
    if (month >= 10 && month <= 12) return 80;
    return 65;
  }

  private scoreCompliance(p: ProductCandidate): number {
    const data = p.rawData;
    if (data.trademark_risk || data.patent_risk) return 20;
    if (data.medical_claim || data.regulated) return 30;
    return 85;
  }

  private scoreTrendDemand(p: ProductCandidate): number {
    const data = p.rawData;
    const trend = data.google_trend_score || data.trend_score || 50;
    if (trend > 80) return 100;
    if (trend > 50) return 70;
    return 40;
  }

  private scorePricePoint(p: ProductCandidate): number {
    const price = p.estimatedPrice;
    if (price >= 20 && price <= 60) return 100;
    if (price >= 15 && price <= 80) return 75;
    if (price >= 10 && price <= 100) return 55;
    return 30;
  }

  private scoreRepeatPurchase(p: ProductCandidate): number {
    const data = p.rawData;
    if (data.consumable || data.refill) return 95;
    if (data.accessory_ecosystem) return 80;
    if (p.category === 'beauty' || p.category === 'health') return 70;
    return 35;
  }

  private scoreStorytelling(p: ProductCandidate): number {
    const data = p.rawData;
    if (data.emotional_trigger || data.problem_solver) return 90;
    if (data.before_after) return 85;
    return 50;
  }

  private scoreAdCreative(p: ProductCandidate): number {
    const data = p.rawData;
    if (data.ugc_friendly && data.demo_friendly) return 100;
    if (data.ugc_friendly || data.demo_friendly) return 80;
    if (data.visual_impact) return 70;
    return 45;
  }

  // ── Générer les angles marketing ───────────────────────
  private generateAngles(_p: ProductCandidate, scores: ProductScores): string[] {
    const angles: string[] = [];
    if (scores.storytelling > 70) angles.push('Angle émotionnel / transformation');
    if (scores.virality > 70) angles.push('Angle viral / TikTok-ready');
    if (scores.margin > 80) angles.push('Angle premium / qualité perçue');
    if (scores.pricePoint > 80) angles.push('Angle prix attractif / impulsion');
    if (scores.repeatPurchase > 70) angles.push('Angle abonnement / fidélité');
    if (scores.compliance > 80) angles.push('Angle confiance / certifié');
    if (angles.length === 0) angles.push('Angle fonctionnel / résolution de problème');
    return angles;
  }

  // ── Identifier les risques ─────────────────────────────
  private identifyRisks(_p: ProductCandidate, scores: ProductScores): string[] {
    const risks: string[] = [];
    if (scores.compliance < 50) risks.push('⚠️ Risque légal — vérifier marques/brevets');
    if (scores.competition < 40) risks.push('⚠️ Marché saturé — différenciation nécessaire');
    if (scores.margin < 50) risks.push('⚠️ Marge faible — optimiser le sourcing');
    if (scores.logistics < 50) risks.push('⚠️ Logistique complexe — poids/taille');
    if (scores.seasonality < 50) risks.push('⚠️ Produit saisonnier — timing critique');
    return risks;
  }

  // ── Persister en base ──────────────────────────────────
  private async persistDiscoveries(tenantId: string, products: ScoredProduct[]): Promise<void> {
    for (let i = 0; i < products.length; i++) {
      const p = products[i];
      try {
        await this.db.query(`
          INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
          VALUES ($1, 'AGENT_HUNTER', 'weekly_discovery', $2)
        `, [tenantId, JSON.stringify({
          rank: i + 1,
          name: p.name,
          sourceUrl: p.sourceUrl,
          source: p.source,
          totalScore: p.totalScore,
          grade: p.grade,
          verdict: p.verdict,
          margin: Math.round(((p.estimatedPrice - p.estimatedCost) / p.estimatedPrice) * 100),
          estimatedPrice: p.estimatedPrice,
          estimatedCost: p.estimatedCost,
          angles: p.angles,
          risks: p.risks,
          scores: p.scores,
          huntWeek: this.getCurrentWeek(),
        })]);
      } catch (e: any) {
        console.warn(`[HUNTER] Erreur persist discovery #${i + 1}:`, e.message);
      }
    }
  }

  // ── Notifier dans le Morning Brief ─────────────────────
  private async notifyDiscoveries(tenantId: string, products: ScoredProduct[]): Promise<void> {
    const summary = products.map((p, i) =>
      `${['🥇', '🥈', '🥉', '4.', '5.'][i]} ${p.name} — Score ${p.totalScore} — Marge ${Math.round(((p.estimatedPrice - p.estimatedCost) / p.estimatedPrice) * 100)}%`
    ).join('\n');

    try {
      await this.db.query(`
        INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
        VALUES ($1, 'AGENT_HUNTER', 'monday_brief', $2)
      `, [tenantId, JSON.stringify({
        type: 'weekly_hunt_results',
        title: '🎯 Top 5 Produits de la Semaine',
        summary,
        productCount: products.length,
        topScore: products[0]?.totalScore || 0,
        huntWeek: this.getCurrentWeek(),
      })]);
    } catch (_) {}

    // Cache in Redis for quick dashboard access
    try {
      const cacheKey = `hunter:top5:${tenantId}`;
      await this.redis.setex(cacheKey, 7 * 86400, JSON.stringify(products.map(p => ({
        rank: products.indexOf(p) + 1,
        name: p.name,
        sourceUrl: p.sourceUrl,
        totalScore: p.totalScore,
        grade: p.grade,
        margin: Math.round(((p.estimatedPrice - p.estimatedCost) / p.estimatedPrice) * 100),
        verdict: p.verdict,
        angles: p.angles,
      }))));
    } catch (_) {}
  }

  // ── API: Récupérer le Top 5 actuel ─────────────────────
  async getCurrentTop5(tenantId: string): Promise<any[]> {
    // Try Redis cache first
    try {
      const cached = await this.redis.get(`hunter:top5:${tenantId}`);
      if (cached) return JSON.parse(cached);
    } catch (_) {}

    // Fallback to DB
    const { rows } = await this.db.query(`
      SELECT payload
      FROM agents.agent_memory
      WHERE tenant_id = $1
        AND agent_id = 'AGENT_HUNTER'
        AND memory_type = 'weekly_discovery'
      ORDER BY created_at DESC
      LIMIT 5
    `, [tenantId]);

    return rows.map(r => r.payload);
  }

  private getCurrentWeek(): string {
    const now = new Date();
    const start = new Date(now.getFullYear(), 0, 1);
    const diff = now.getTime() - start.getTime();
    const week = Math.ceil(diff / (7 * 24 * 60 * 60 * 1000));
    return `${now.getFullYear()}-W${String(week).padStart(2, '0')}`;
  }
}
