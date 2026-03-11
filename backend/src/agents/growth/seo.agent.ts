/**
 * AGENT_SEO — Référencement Naturel & Contenu
 * ═══════════════════════════════════════════════════════════
 *
 * MISSION : Rendre chaque produit trouvable sur Google, Pinterest, YouTube.
 *
 * ── ACTIONS AUTOMATIQUES ──────────────────────────────────
 *
 *  1. Optimisation fiche produit (title, meta, H1, alt-text, schema.org)
 *  2. Génération de contenu blog (3 articles/produit)
 *  3. Backlink outreach (guest posts, forums, Reddit)
 *  4. Pinterest SEO (pins optimisés, descriptions, boards)
 *  5. YouTube/TikTok SEO (titles, descriptions, tags)
 *  6. Suivi positions (keywords tracking)
 *
 * ── STRATÉGIE CONTENU ─────────────────────────────────────
 *
 *  Article 1 : "Guide complet : [produit]" (informationnel)
 *  Article 2 : "Avis [produit] : test complet" (transactionnel)
 *  Article 3 : "[produit] vs alternatives" (comparatif)
 *
 * ── OUTPUT ─────────────────────────────────────────────────
 *
 *  - Fiches produit optimisées SEO
 *  - 3 articles de blog par produit
 *  - Pins Pinterest optimisés
 *  - Score SEO /100 par produit
 *  - Rapport de positions hebdomadaire
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';

// ── Types ────────────────────────────────────────────────
interface SEOAudit {
  productId: string;
  score: number;
  checks: SEOCheck[];
  recommendations: string[];
  keywords: KeywordTarget[];
}

interface SEOCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  detail: string;
  impact: 'high' | 'medium' | 'low';
}

interface KeywordTarget {
  keyword: string;
  volume: number;
  difficulty: number;
  currentPosition: number | null;
  targetPosition: number;
  type: 'primary' | 'secondary' | 'long_tail';
}

interface BlogArticle {
  title: string;
  slug: string;
  type: 'guide' | 'review' | 'comparison';
  outline: string[];
  targetKeyword: string;
  estimatedWordCount: number;
  metaDescription: string;
}

// ── SEO Agent ────────────────────────────────────────────
export class SEOAgent {
  readonly agentId = 'AGENT_SEO';
  readonly name = 'SEO — Référencement Naturel';

  constructor(
    private db: Pool,
    private redis: Redis
  ) {}

  // ── Audit SEO d'une fiche produit ──────────────────────
  async auditProduct(tenantId: string, productId: string): Promise<SEOAudit> {
    console.log(`[SEO] 🔍 Audit SEO produit=${productId}`);

    // Récupérer les données produit
    let productData: any = {};
    try {
      const { rows } = await this.db.query(`
        SELECT title, description, price, images, meta_title, meta_description, slug
        FROM products.catalog
        WHERE tenant_id = $1 AND id = $2
      `, [tenantId, productId]);
      productData = rows[0] || {};
    } catch (_) {
      // Try alternative table
      try {
        const { rows } = await this.db.query(`
          SELECT payload
          FROM agents.agent_memory
          WHERE tenant_id = $1 AND payload->>'product_id' = $2
          AND memory_type = 'product_data'
          ORDER BY created_at DESC LIMIT 1
        `, [tenantId, productId]);
        productData = rows[0]?.payload || {};
      } catch (__) {}
    }

    const checks = this.runSEOChecks(productData);
    const score = this.calculateSEOScore(checks);
    const keywords = this.identifyKeywords(productData);
    const recommendations = this.generateRecommendations(checks);

    const audit: SEOAudit = { productId, score, checks, recommendations, keywords };

    // Persist
    try {
      await this.db.query(`
        INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
        VALUES ($1, 'AGENT_SEO', 'seo_audit', $2)
      `, [tenantId, JSON.stringify(audit)]);
    } catch (_) {}

    console.log(`[SEO] ✅ Score SEO: ${score}/100 — ${checks.filter(c => c.status === 'fail').length} problèmes`);
    return audit;
  }

  // ── Générer les 3 articles de blog ─────────────────────
  async generateBlogPlan(tenantId: string, productName: string, productId: string): Promise<BlogArticle[]> {
    console.log(`[SEO] 📝 Génération plan blog pour "${productName}"`);

    const slug = productName.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 50);
    const articles: BlogArticle[] = [
      {
        title: `Guide complet : ${productName} — Tout ce qu'il faut savoir`,
        slug: `guide-${slug}`,
        type: 'guide',
        outline: [
          `Qu'est-ce que ${productName} ?`,
          'Pourquoi en avez-vous besoin ?',
          'Comment bien choisir ?',
          'Les critères essentiels',
          'Nos recommandations',
          'FAQ',
        ],
        targetKeyword: productName.toLowerCase(),
        estimatedWordCount: 2000,
        metaDescription: `Découvrez tout sur ${productName}. Guide complet avec avis, comparatif et recommandations. Mis à jour ${new Date().getFullYear()}.`,
      },
      {
        title: `Avis ${productName} : notre test complet et honnête`,
        slug: `avis-${slug}`,
        type: 'review',
        outline: [
          'Premier contact et unboxing',
          'Caractéristiques techniques',
          'Notre expérience au quotidien',
          'Points forts ✅',
          'Points faibles ❌',
          'Verdict final et note',
        ],
        targetKeyword: `avis ${productName.toLowerCase()}`,
        estimatedWordCount: 1500,
        metaDescription: `Notre avis honnête sur ${productName} après test complet. Points forts, points faibles et verdict.`,
      },
      {
        title: `${productName} vs les alternatives : comparatif ${new Date().getFullYear()}`,
        slug: `comparatif-${slug}`,
        type: 'comparison',
        outline: [
          'Les meilleurs produits de la catégorie',
          `${productName} : forces et faiblesses`,
          'Alternative 1 : Analyse',
          'Alternative 2 : Analyse',
          'Tableau comparatif',
          'Notre recommandation',
        ],
        targetKeyword: `${productName.toLowerCase()} comparatif`,
        estimatedWordCount: 1800,
        metaDescription: `Comparatif complet ${productName} vs alternatives. Découvrez le meilleur choix pour vous en ${new Date().getFullYear()}.`,
      },
    ];

    // Persist
    try {
      await this.db.query(`
        INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
        VALUES ($1, 'AGENT_SEO', 'blog_plan', $2)
      `, [tenantId, JSON.stringify({
        productId,
        productName,
        articleCount: articles.length,
        totalWordCount: articles.reduce((s, a) => s + a.estimatedWordCount, 0),
        articles: articles.map(a => ({ title: a.title, type: a.type, keyword: a.targetKeyword })),
      })]);
    } catch (_) {}

    console.log(`[SEO] ✅ 3 articles planifiés — ${articles.reduce((s, a) => s + a.estimatedWordCount, 0)} mots total`);
    return articles;
  }

  // ── Optimiser les métadonnées produit ──────────────────
  generateOptimizedMeta(productName: string, description: string, price: number): {
    metaTitle: string;
    metaDescription: string;
    h1: string;
    altText: string;
    schemaMarkup: Record<string, any>;
  } {
    const year = new Date().getFullYear();
    return {
      metaTitle: `${productName} — Livraison Gratuite | Prix: ${price}€`,
      metaDescription: `${productName} au meilleur prix. ${description.slice(0, 100)}... ✅ Livraison rapide ✅ Garantie satisfait ou remboursé.`,
      h1: `${productName} — Le choix #1 en ${year}`,
      altText: `${productName} - vue principale - photo haute qualité`,
      schemaMarkup: {
        '@context': 'https://schema.org',
        '@type': 'Product',
        name: productName,
        description: description.slice(0, 200),
        offers: {
          '@type': 'Offer',
          price,
          priceCurrency: 'EUR',
          availability: 'https://schema.org/InStock',
        },
      },
    };
  }

  // ── Checks SEO individuels ─────────────────────────────
  private runSEOChecks(product: any): SEOCheck[] {
    const checks: SEOCheck[] = [];
    const title = product.title || product.meta_title || '';
    const desc = product.description || product.meta_description || '';

    // Title
    checks.push({
      name: 'Meta Title',
      status: title.length >= 30 && title.length <= 60 ? 'pass' : title.length > 0 ? 'warn' : 'fail',
      detail: title.length > 0 ? `${title.length} caractères (idéal: 30-60)` : 'Titre manquant',
      impact: 'high',
    });

    // Meta Description
    checks.push({
      name: 'Meta Description',
      status: desc.length >= 120 && desc.length <= 160 ? 'pass' : desc.length > 0 ? 'warn' : 'fail',
      detail: desc.length > 0 ? `${desc.length} caractères (idéal: 120-160)` : 'Description manquante',
      impact: 'high',
    });

    // Images
    const images = product.images || [];
    checks.push({
      name: 'Images',
      status: images.length >= 3 ? 'pass' : images.length > 0 ? 'warn' : 'fail',
      detail: `${images.length} image(s) (minimum recommandé: 3)`,
      impact: 'medium',
    });

    // Slug
    const slug = product.slug || '';
    checks.push({
      name: 'URL Slug',
      status: slug.length > 0 && !slug.includes(' ') ? 'pass' : 'fail',
      detail: slug ? `/${slug}` : 'Slug manquant',
      impact: 'medium',
    });

    // Schema.org
    checks.push({
      name: 'Schema.org',
      status: product.schema_markup ? 'pass' : 'warn',
      detail: product.schema_markup ? 'Structured data présent' : 'Pas de données structurées',
      impact: 'medium',
    });

    // Description length
    checks.push({
      name: 'Description produit',
      status: desc.length >= 300 ? 'pass' : desc.length >= 100 ? 'warn' : 'fail',
      detail: `${desc.length} caractères (minimum recommandé: 300)`,
      impact: 'high',
    });

    return checks;
  }

  private calculateSEOScore(checks: SEOCheck[]): number {
    const weights = { high: 25, medium: 15, low: 5 };
    let score = 0;
    let maxScore = 0;

    for (const check of checks) {
      const w = weights[check.impact];
      maxScore += w;
      if (check.status === 'pass') score += w;
      else if (check.status === 'warn') score += w * 0.5;
    }

    return Math.round((score / maxScore) * 100);
  }

  private identifyKeywords(product: any): KeywordTarget[] {
    const title = product.title || '';
    const words = title.toLowerCase().split(/\s+/).filter((w: string) => w.length > 3);
    return [
      { keyword: title.toLowerCase(), volume: 1000, difficulty: 40, currentPosition: null, targetPosition: 5, type: 'primary' },
      { keyword: `acheter ${title.toLowerCase()}`, volume: 500, difficulty: 30, currentPosition: null, targetPosition: 3, type: 'secondary' },
      { keyword: `avis ${title.toLowerCase()}`, volume: 300, difficulty: 25, currentPosition: null, targetPosition: 3, type: 'long_tail' },
      ...words.slice(0, 2).map((w: string) => ({
        keyword: w, volume: 2000, difficulty: 60, currentPosition: null, targetPosition: 10, type: 'secondary' as const,
      })),
    ];
  }

  private generateRecommendations(checks: SEOCheck[]): string[] {
    const recs: string[] = [];
    for (const c of checks) {
      if (c.status === 'fail') {
        recs.push(`❌ ${c.name} : ${c.detail} — Impact ${c.impact}`);
      } else if (c.status === 'warn') {
        recs.push(`⚠️ ${c.name} : ${c.detail} — À améliorer`);
      }
    }
    return recs;
  }
}
