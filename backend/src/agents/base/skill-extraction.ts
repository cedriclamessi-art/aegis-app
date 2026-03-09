/**
 * Skill Extraction — Autonomous learning and capability discovery
 * =================================================================
 * Sources: Jeffallan/claude-skills, daymade/claude-code-skills,
 *          alirezarezvani/claude-skills, coreyhaines31/marketing-skills
 *
 * Learns from agent executions to:
 *   1. Extract reusable skills from successful runs
 *   2. Build a skill library that agents can reference
 *   3. Recommend skills for new tasks
 *   4. Track skill effectiveness over time
 *   5. Enable skill sharing between agents
 *
 * Skill types:
 *   prompt    — Proven prompt templates
 *   workflow  — Multi-step action sequences
 *   rule      — Business rules discovered from data
 *   template  — Content templates (emails, ads, pages)
 *   strategy  — High-level strategic patterns
 *
 * E-commerce specific skills:
 *   - Winning ad angle patterns
 *   - High-converting headline formulas
 *   - Optimal pricing strategies per niche
 *   - Audience targeting patterns
 *   - Landing page section orders
 */

// ── Types ─────────────────────────────────────────────────────────────────

export type SkillType = 'prompt' | 'workflow' | 'rule' | 'template' | 'strategy';

export interface Skill {
  id:              string;
  name:            string;
  type:            SkillType;
  description:     string;
  category:        string;         // e.g., 'ads', 'copy', 'pricing', 'audience'

  // Content
  content:         string;         // The actual skill (prompt, template, etc.)
  parameters?:     SkillParameter[];
  examples?:       SkillExample[];

  // Provenance
  extractedFrom:   string;         // Agent ID that generated it
  shopId?:         string;
  pipelineId?:     string;
  extractedAt:     Date;

  // Effectiveness
  timesUsed:       number;
  successRate:     number;         // 0-1
  avgRoasImpact:   number;         // Average ROAS improvement when used
  lastUsedAt?:     Date;
  rating:          number;         // 0-5

  // Tags
  tags:            string[];
  niche?:          string;         // Product niche this skill works best for
  locale?:         string;         // Language/region (e.g., 'fr', 'en', 'fr-FR')

  // Status
  verified:        boolean;        // Manually verified as good
  deprecated:      boolean;
}

export interface SkillParameter {
  name:          string;
  description:   string;
  type:          'string' | 'number' | 'boolean' | 'array';
  required:      boolean;
  defaultValue?: unknown;
}

export interface SkillExample {
  input:   Record<string, unknown>;
  output:  string;
  roas?:   number;
  context?: string;
}

export interface SkillRecommendation {
  skill:        Skill;
  relevance:    number;           // 0-1
  reason:       string;
}

export interface SkillUsageRecord {
  skillId:    string;
  agentId:    string;
  shopId?:    string;
  usedAt:     Date;
  success:    boolean;
  roasBefore?: number;
  roasAfter?:  number;
}

// ── Built-in Skills ───────────────────────────────────────────────────────

const BUILT_IN_SKILLS: Omit<Skill, 'id' | 'extractedAt' | 'timesUsed' | 'successRate' | 'avgRoasImpact' | 'rating' | 'verified' | 'deprecated'>[] = [
  // ── Ad Copy Skills ────────────────────────────────────────────────
  {
    name: 'Problem-Agitate-Solve Hook',
    type: 'template',
    description: 'PAS framework for ad hooks — identify problem, agitate it, present solution',
    category: 'copy',
    content: `Hook Template (PAS):
1. PROBLEM: "Vous en avez marre de [PROBLEME] ?"
2. AGITATE: "[CONSEQUENCE NEGATIVE] peut ruiner votre [ENJEU]..."
3. SOLVE: "[PRODUIT] — la solution que [NOMBRE] personnes utilisent déjà"

Variables: PROBLEME, CONSEQUENCE_NEGATIVE, ENJEU, PRODUIT, NOMBRE`,
    parameters: [
      { name: 'PROBLEME', description: 'Client pain point', type: 'string', required: true },
      { name: 'PRODUIT', description: 'Product name', type: 'string', required: true },
    ],
    extractedFrom: 'AGENT_COPY_CHIEF',
    tags: ['hook', 'pas', 'facebook', 'french'],
    locale: 'fr',
    lastUsedAt: undefined,
  },
  {
    name: 'Social Proof Headline',
    type: 'template',
    description: 'Headlines using social proof numbers',
    category: 'copy',
    content: `Headline Templates:
- "[NOMBRE]+ clients satisfaits en [DUREE]"
- "Rejoint par [NOMBRE] personnes cette semaine"
- "Note [NOTE]/5 — [NOMBRE] avis vérifiés"
- "#1 en [CATEGORIE] sur [PLATEFORME]"`,
    extractedFrom: 'AGENT_COPY_CHIEF',
    tags: ['headline', 'social-proof', 'french'],
    locale: 'fr',
    lastUsedAt: undefined,
  },
  {
    name: 'Urgency CTA Formula',
    type: 'template',
    description: 'Call-to-action with urgency triggers',
    category: 'copy',
    content: `CTA Templates:
- "Commander maintenant — Stock limité ([STOCK] restants)"
- "Profitez de -[REDUCTION]% — Offre expire dans [TEMPS]"
- "Livraison GRATUITE aujourd'hui seulement"
- "Essayer sans risque — Garantie [JOURS] jours"`,
    extractedFrom: 'AGENT_PSYCHO_MARKETING',
    tags: ['cta', 'urgency', 'french'],
    locale: 'fr',
    lastUsedAt: undefined,
  },

  // ── Pricing Skills ────────────────────────────────────────────────
  {
    name: 'Charm Pricing Strategy',
    type: 'rule',
    description: 'Use .99 or .97 pricing for perceived value',
    category: 'pricing',
    content: `Rule: Set selling price to end in .99 or .97
- Products < 50€: use .97 (e.g., 29.97€)
- Products 50-100€: use .99 (e.g., 79.99€)
- Products > 100€: use .00 (e.g., 199.00€ — premium perception)
- Always maintain minimum 30% margin after charm pricing`,
    extractedFrom: 'AGENT_OFFER_ENGINE',
    tags: ['pricing', 'psychology', 'margin'],
    lastUsedAt: undefined,
  },
  {
    name: 'Bundle Pricing Formula',
    type: 'strategy',
    description: 'Create perceived value with bundle pricing',
    category: 'pricing',
    content: `Strategy: Offer 3-tier pricing
- Tier 1: Single product at full price
- Tier 2: "Most Popular" — 2x product at 1.7x price (-15%)
- Tier 3: "Best Value" — 3x product at 2.2x price (-27%)
Default highlight: Tier 2 (anchor effect)`,
    extractedFrom: 'AGENT_OFFER_ENGINE',
    tags: ['pricing', 'bundle', 'strategy'],
    lastUsedAt: undefined,
  },

  // ── Landing Page Skills ───────────────────────────────────────────
  {
    name: 'High-Converting Section Order',
    type: 'workflow',
    description: 'Optimal landing page section order for e-commerce',
    category: 'landing-page',
    content: `Section Order (proven 3.2+ ROAS):
1. Hero — Product image + headline + CTA
2. Social Proof — Testimonials + star rating
3. Problem/Solution — Pain points + how product solves
4. Benefits — 3-4 key benefits with icons
5. How It Works — 3-step process
6. Testimonials — 3-5 detailed reviews with photos
7. FAQ — 5-7 common objections answered
8. Guarantee — Money-back guarantee badge
9. Final CTA — Urgency + CTA button
10. Footer — Legal + contact`,
    extractedFrom: 'AGENT_STORE_BUILDER',
    tags: ['landing-page', 'sections', 'conversion'],
    lastUsedAt: undefined,
  },

  // ── Audience Skills ───────────────────────────────────────────────
  {
    name: 'Facebook Audience Layering',
    type: 'strategy',
    description: 'Multi-layer audience targeting for Facebook Ads',
    category: 'audience',
    content: `Audience Strategy:
Layer 1 (TOF - Cold): Interest-based targeting
- 3-5 interest groups of 2-10M people
- Exclude purchasers + engaged visitors

Layer 2 (MOF - Warm): Engagement retargeting
- Website visitors (7d, 14d, 30d windows)
- Video viewers (50%+, 75%+)
- Page engagers (90d)

Layer 3 (BOF - Hot): Purchase intent
- Add-to-cart (7d)
- Checkout initiated (14d)
- Past purchasers (lookalike)`,
    extractedFrom: 'AGENT_AUDIENCE_FINDER',
    tags: ['audience', 'facebook', 'targeting', 'funnel'],
    lastUsedAt: undefined,
  },

  // ── Campaign Strategy Skills ──────────────────────────────────────
  {
    name: 'Test-Iterate-Scale Framework',
    type: 'strategy',
    description: 'Campaign lifecycle management',
    category: 'campaign',
    content: `Framework:
Phase 1 — TEST (Days 1-3): Budget 30-50€/day
- Launch 3-5 ad sets with different audiences
- 2-3 creatives per ad set
- Kill at < 1.0 ROAS after 48h

Phase 2 — ITERATE (Days 4-14): Budget 50-100€/day
- Keep winners (ROAS > 2.0)
- Test new creatives on winning audiences
- A/B test headlines and hooks

Phase 3 — SCALE (Days 14+): Budget 100-500€/day
- Increase budget 20-30% every 3 days
- Add lookalike audiences
- Monitor frequency (kill if > 3.0)`,
    extractedFrom: 'AGENT_RALPH',
    tags: ['campaign', 'scaling', 'framework', 'ralph'],
    lastUsedAt: undefined,
  },
];

// ── Skill Extraction Engine ───────────────────────────────────────────────

class SkillExtractionEngine {
  private skills: Map<string, Skill> = new Map();
  private usageLog: SkillUsageRecord[] = [];

  constructor() {
    // Load built-in skills
    for (const skillDef of BUILT_IN_SKILLS) {
      const skill: Skill = {
        ...skillDef,
        id: `skill_${skillDef.category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        extractedAt: new Date(),
        timesUsed: 0,
        successRate: 0.8, // Assumed good baseline
        avgRoasImpact: 0,
        rating: 4.0,
        verified: true,
        deprecated: false,
      };
      this.skills.set(skill.id, skill);
    }
  }

  // ── Extract skill from execution ────────────────────────────────────

  extract(params: {
    name:           string;
    type:           SkillType;
    description:    string;
    category:       string;
    content:        string;
    agentId:        string;
    shopId?:        string;
    tags?:          string[];
    niche?:         string;
    locale?:        string;
    parameters?:    SkillParameter[];
    examples?:      SkillExample[];
  }): Skill {
    const skill: Skill = {
      id: `skill_${params.category}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      name: params.name,
      type: params.type,
      description: params.description,
      category: params.category,
      content: params.content,
      parameters: params.parameters,
      examples: params.examples,
      extractedFrom: params.agentId,
      shopId: params.shopId,
      extractedAt: new Date(),
      timesUsed: 0,
      successRate: 0,
      avgRoasImpact: 0,
      rating: 0,
      tags: params.tags || [],
      niche: params.niche,
      locale: params.locale,
      verified: false,
      deprecated: false,
    };

    this.skills.set(skill.id, skill);
    return skill;
  }

  // ── Recommend skills ────────────────────────────────────────────────

  recommend(params: {
    category?:  string;
    tags?:      string[];
    niche?:     string;
    locale?:    string;
    agentId?:   string;
    limit?:     number;
  }): SkillRecommendation[] {
    let candidates = Array.from(this.skills.values())
      .filter(s => !s.deprecated);

    // Apply filters
    if (params.category) {
      candidates = candidates.filter(s => s.category === params.category);
    }
    if (params.locale) {
      candidates = candidates.filter(s => !s.locale || s.locale === params.locale);
    }
    if (params.niche) {
      candidates = candidates.filter(s => !s.niche || s.niche === params.niche);
    }

    // Score and rank
    const recommendations: SkillRecommendation[] = candidates.map(skill => {
      let relevance = 0.5; // Base
      let reasons: string[] = [];

      // Tag matching
      if (params.tags) {
        const tagOverlap = params.tags.filter(t => skill.tags.includes(t)).length;
        if (tagOverlap > 0) {
          relevance += 0.1 * tagOverlap;
          reasons.push(`${tagOverlap} matching tags`);
        }
      }

      // Success rate bonus
      if (skill.successRate > 0.8) {
        relevance += 0.15;
        reasons.push(`${(skill.successRate * 100).toFixed(0)}% success rate`);
      }

      // Usage bonus (popular skills)
      if (skill.timesUsed > 10) {
        relevance += 0.1;
        reasons.push(`Used ${skill.timesUsed} times`);
      }

      // Verified bonus
      if (skill.verified) {
        relevance += 0.1;
        reasons.push('Verified');
      }

      // ROAS impact
      if (skill.avgRoasImpact > 0) {
        relevance += 0.1;
        reasons.push(`+${skill.avgRoasImpact.toFixed(1)}x ROAS impact`);
      }

      // Rating bonus
      if (skill.rating >= 4.0) {
        relevance += 0.05;
      }

      return {
        skill,
        relevance: Math.min(1, relevance),
        reason: reasons.join(', ') || 'General match',
      };
    });

    return recommendations
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, params.limit || 10);
  }

  // ── Use skill ───────────────────────────────────────────────────────

  use(skillId: string, agentId: string, shopId?: string): Skill | undefined {
    const skill = this.skills.get(skillId);
    if (!skill) return undefined;

    skill.timesUsed++;
    skill.lastUsedAt = new Date();

    this.usageLog.push({
      skillId,
      agentId,
      shopId,
      usedAt: new Date(),
      success: true, // Updated later via recordOutcome
    });

    return skill;
  }

  // ── Record outcome ──────────────────────────────────────────────────

  recordOutcome(skillId: string, success: boolean, roasBefore?: number, roasAfter?: number): void {
    const skill = this.skills.get(skillId);
    if (!skill) return;

    // Update success rate (moving average)
    const totalUses = skill.timesUsed || 1;
    skill.successRate = (
      (skill.successRate * (totalUses - 1)) + (success ? 1 : 0)
    ) / totalUses;

    // Update ROAS impact
    if (roasBefore !== undefined && roasAfter !== undefined) {
      const impact = roasAfter - roasBefore;
      skill.avgRoasImpact = (
        (skill.avgRoasImpact * (totalUses - 1)) + impact
      ) / totalUses;
    }

    // Update latest usage record
    const lastRecord = [...this.usageLog].reverse().find((r: SkillUsageRecord) => r.skillId === skillId);
    if (lastRecord) {
      lastRecord.success = success;
      lastRecord.roasBefore = roasBefore;
      lastRecord.roasAfter = roasAfter;
    }
  }

  // ── Get skill ───────────────────────────────────────────────────────

  getSkill(skillId: string): Skill | undefined {
    return this.skills.get(skillId);
  }

  // ── Search skills ───────────────────────────────────────────────────

  search(query: string): Skill[] {
    const lower = query.toLowerCase();
    return Array.from(this.skills.values())
      .filter(s =>
        s.name.toLowerCase().includes(lower) ||
        s.description.toLowerCase().includes(lower) ||
        s.tags.some(t => t.toLowerCase().includes(lower)) ||
        s.category.toLowerCase().includes(lower)
      )
      .sort((a, b) => b.rating - a.rating);
  }

  // ── List by category ────────────────────────────────────────────────

  listByCategory(category: string): Skill[] {
    return Array.from(this.skills.values())
      .filter(s => s.category === category && !s.deprecated)
      .sort((a, b) => b.successRate - a.successRate);
  }

  // ── Get categories ──────────────────────────────────────────────────

  getCategories(): Array<{ category: string; count: number }> {
    const counts: Record<string, number> = {};
    for (const skill of this.skills.values()) {
      if (!skill.deprecated) {
        counts[skill.category] = (counts[skill.category] || 0) + 1;
      }
    }
    return Object.entries(counts)
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count);
  }

  // ── Verify / Deprecate ──────────────────────────────────────────────

  verify(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) skill.verified = true;
  }

  deprecate(skillId: string): void {
    const skill = this.skills.get(skillId);
    if (skill) skill.deprecated = true;
  }

  rate(skillId: string, rating: number): void {
    const skill = this.skills.get(skillId);
    if (skill) skill.rating = Math.max(0, Math.min(5, rating));
  }

  // ── Stats ───────────────────────────────────────────────────────────

  getStats(): {
    totalSkills:     number;
    verifiedSkills:  number;
    avgSuccessRate:  number;
    topCategories:   string[];
    mostUsed:        Array<{ name: string; uses: number }>;
  } {
    const skills = Array.from(this.skills.values()).filter(s => !s.deprecated);

    return {
      totalSkills: skills.length,
      verifiedSkills: skills.filter(s => s.verified).length,
      avgSuccessRate: skills.length > 0
        ? skills.reduce((s, sk) => s + sk.successRate, 0) / skills.length
        : 0,
      topCategories: this.getCategories().slice(0, 5).map(c => c.category),
      mostUsed: skills
        .filter(s => s.timesUsed > 0)
        .sort((a, b) => b.timesUsed - a.timesUsed)
        .slice(0, 5)
        .map(s => ({ name: s.name, uses: s.timesUsed })),
    };
  }
}

// ── Singleton Export ──────────────────────────────────────────────────────

export const skillExtraction = new SkillExtractionEngine();
