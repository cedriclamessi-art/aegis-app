/**
 * AGENT_TRAFFIC — Acquisition Organique Multi-Canal
 * ═══════════════════════════════════════════════════════════
 *
 * MISSION : Générer du trafic organique massif sans dépenser en pub.
 *
 * Stratégie principale : 5 comptes TikTok par produit
 * Chaque compte a un angle différent pour maximiser la portée.
 *
 * ── STRATÉGIE 5 COMPTES / PRODUIT ─────────────────────────
 *
 *  Compte 1 : UGC / Témoignage client
 *  Compte 2 : Démonstration produit
 *  Compte 3 : Behind the scenes / Marque
 *  Compte 4 : Éducatif / Tips & Hacks
 *  Compte 5 : Réactions / Trends
 *
 * ── CANAUX SUPPORTÉS ──────────────────────────────────────
 *
 *  - TikTok (principal)
 *  - Instagram Reels
 *  - YouTube Shorts
 *  - Pinterest (pins + idea pins)
 *
 * ── OUTPUT ─────────────────────────────────────────────────
 *
 *  - Calendrier de publication (3 posts/jour/compte = 15/jour)
 *  - Briefs créatifs pour chaque post
 *  - Tracking views/engagement par compte
 *  - A/B test des angles qui performent
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';

// ── Types ────────────────────────────────────────────────
interface TrafficAccount {
  id: string;
  platform: 'tiktok' | 'instagram' | 'youtube' | 'pinterest';
  angle: 'ugc' | 'demo' | 'brand' | 'educational' | 'trends';
  handle: string;
  productId: string;
  status: 'active' | 'paused' | 'setup';
  metrics: AccountMetrics;
}

interface AccountMetrics {
  followers: number;
  totalViews: number;
  avgEngagement: number;
  postsPublished: number;
  lastPostAt: string | null;
}

interface ContentBrief {
  accountAngle: string;
  hook: string;
  script: string;
  callToAction: string;
  hashtags: string[];
  bestPostTime: string;
  format: 'vertical_video' | 'carousel' | 'story' | 'pin';
}

// ── Les 5 angles par produit ─────────────────────────────
const ACCOUNT_ANGLES = [
  {
    angle: 'ugc' as const,
    name: 'UGC / Témoignage',
    description: 'Contenu client authentique, unboxing, avis réels',
    contentTypes: ['unboxing', 'review', 'haul', 'routine'],
    postFrequency: 3,
  },
  {
    angle: 'demo' as const,
    name: 'Démonstration',
    description: 'Montrer le produit en action, avant/après, tutoriel',
    contentTypes: ['demo', 'before_after', 'tutorial', 'howto'],
    postFrequency: 3,
  },
  {
    angle: 'brand' as const,
    name: 'Behind the Scenes',
    description: 'Coulisses de la marque, packaging, valeurs',
    contentTypes: ['bts', 'packaging', 'team', 'values'],
    postFrequency: 2,
  },
  {
    angle: 'educational' as const,
    name: 'Éducatif / Tips',
    description: 'Contenu éducatif, hacks, astuces liés au produit',
    contentTypes: ['tips', 'hacks', 'myths', 'science'],
    postFrequency: 3,
  },
  {
    angle: 'trends' as const,
    name: 'Réactions / Trends',
    description: 'Surfer sur les trends TikTok avec le produit',
    contentTypes: ['trend', 'reaction', 'duet', 'stitch'],
    postFrequency: 4,
  },
];

// ── TRAFFIC Agent ────────────────────────────────────────
export class TrafficAgent {
  readonly agentId = 'AGENT_TRAFFIC';
  readonly name = 'Traffic — Acquisition Organique';

  constructor(
    private db: Pool,
    private redis: Redis
  ) {}

  // ── Setup 5 comptes pour un produit ────────────────────
  async setupProductAccounts(tenantId: string, productId: string, productName: string): Promise<TrafficAccount[]> {
    console.log(`[TRAFFIC] 📱 Setup 5 comptes pour "${productName}"`);
    const accounts: TrafficAccount[] = [];

    for (const angleDef of ACCOUNT_ANGLES) {
      const handle = this.generateHandle(productName, angleDef.angle);
      const account: TrafficAccount = {
        id: `${productId}-${angleDef.angle}`,
        platform: 'tiktok',
        angle: angleDef.angle,
        handle,
        productId,
        status: 'setup',
        metrics: { followers: 0, totalViews: 0, avgEngagement: 0, postsPublished: 0, lastPostAt: null },
      };

      // Persist
      try {
        await this.db.query(`
          INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
          VALUES ($1, 'AGENT_TRAFFIC', 'account_setup', $2)
        `, [tenantId, JSON.stringify({
          ...account,
          angleDef,
          productName,
          setupAt: new Date().toISOString(),
        })]);
      } catch (_) {}

      accounts.push(account);
    }

    console.log(`[TRAFFIC] ✅ 5 comptes configurés: ${accounts.map(a => a.angle).join(', ')}`);
    return accounts;
  }

  // ── Générer le calendrier hebdomadaire ─────────────────
  async generateWeeklyCalendar(tenantId: string, productId: string): Promise<ContentBrief[]> {
    const briefs: ContentBrief[] = [];
    const daysOfWeek = ['Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi', 'Dimanche'];
    const bestTimes = ['7h00', '12h00', '18h00', '20h00', '21h00'];

    for (const angleDef of ACCOUNT_ANGLES) {
      for (let day = 0; day < 7; day++) {
        for (let post = 0; post < angleDef.postFrequency && post < 3; post++) {
          const contentType = angleDef.contentTypes[post % angleDef.contentTypes.length];
          briefs.push({
            accountAngle: angleDef.name,
            hook: this.generateHook(contentType, angleDef.angle),
            script: `${daysOfWeek[day]} — ${angleDef.name} — ${contentType}`,
            callToAction: this.generateCTA(angleDef.angle),
            hashtags: this.generateHashtags(angleDef.angle),
            bestPostTime: bestTimes[post % bestTimes.length],
            format: 'vertical_video',
          });
        }
      }
    }

    // Persist calendar
    try {
      await this.db.query(`
        INSERT INTO agents.agent_memory (tenant_id, agent_id, memory_type, payload)
        VALUES ($1, 'AGENT_TRAFFIC', 'weekly_calendar', $2)
      `, [tenantId, JSON.stringify({
        productId,
        totalPosts: briefs.length,
        postsPerDay: Math.round(briefs.length / 7),
        generatedAt: new Date().toISOString(),
      })]);
    } catch (_) {}

    return briefs;
  }

  // ── Tracker les performances ───────────────────────────
  async trackPerformance(tenantId: string, productId: string): Promise<Record<string, AccountMetrics>> {
    const results: Record<string, AccountMetrics> = {};

    try {
      const { rows } = await this.db.query(`
        SELECT payload
        FROM agents.agent_memory
        WHERE tenant_id = $1
          AND agent_id = 'AGENT_TRAFFIC'
          AND memory_type = 'performance_update'
          AND payload->>'productId' = $2
        ORDER BY created_at DESC
        LIMIT 5
      `, [tenantId, productId]);

      for (const r of rows) {
        const p = r.payload;
        if (p?.angle) {
          results[p.angle] = p.metrics || { followers: 0, totalViews: 0, avgEngagement: 0, postsPublished: 0, lastPostAt: null };
        }
      }
    } catch (_) {}

    return results;
  }

  // ── Helpers ────────────────────────────────────────────
  private generateHandle(productName: string, angle: string): string {
    const slug = productName.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12);
    const suffix = { ugc: 'reviews', demo: 'official', brand: 'bts', educational: 'tips', trends: 'vibes' }[angle] || 'shop';
    return `@${slug}_${suffix}`;
  }

  private generateHook(contentType: string, angle: string): string {
    const hooks: Record<string, string[]> = {
      ugc: ['J\'ai testé et...', 'Mon avis honnête 🤔', 'Pourquoi tout le monde en parle'],
      demo: ['Regardez ce que ça fait 👀', 'Avant / Après en 30 secondes', 'Comment ça marche réellement'],
      brand: ['On vous montre les coulisses 🎬', 'Comment on emballe vos commandes', 'Notre mission'],
      educational: ['3 choses que vous ne saviez pas', 'Le hack que personne ne connaît', 'Arrêtez de faire cette erreur'],
      trends: ['POV: vous découvrez ce produit', 'Quand tu réalises que...', 'Ce trend mais version upgrade'],
    };
    const list = hooks[angle] || hooks.demo;
    return list[Math.floor(Math.random() * list.length)];
  }

  private generateCTA(angle: string): string {
    const ctas: Record<string, string> = {
      ugc: 'Lien dans la bio pour essayer 🔗',
      demo: 'Disponible maintenant — lien bio 👇',
      brand: 'Suivez-nous pour plus de coulisses ✨',
      educational: 'Save ce post pour plus tard 📌',
      trends: 'Commentez si vous avez déjà essayé 💬',
    };
    return ctas[angle] || 'Lien dans la bio 🔗';
  }

  private generateHashtags(angle: string): string[] {
    const base = ['#fyp', '#pourtoi', '#viral', '#trending'];
    const specific: Record<string, string[]> = {
      ugc: ['#review', '#honest', '#unboxing', '#haul'],
      demo: ['#demo', '#tutorial', '#howto', '#satisfying'],
      brand: ['#behindthescenes', '#smallbusiness', '#packaging', '#brand'],
      educational: ['#tips', '#hacks', '#didyouknow', '#learnontiktok'],
      trends: ['#trend', '#foryou', '#duet', '#stitch'],
    };
    return [...base, ...(specific[angle] || [])];
  }
}
