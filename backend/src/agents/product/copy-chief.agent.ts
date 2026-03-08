/**
 * AGENT_COPY_CHIEF — Copywriting Marketing Automatise
 * ════════════════════════════════════════════════════════
 * Genere tout le copywriting pour les pages produit, pubs et emails.
 *
 * Frameworks utilises :
 *   - PAS   (Problem → Agitation → Solution)
 *   - AIDA  (Attention → Interest → Desire → Action)
 *   - BAB   (Before → After → Bridge)
 *   - 4U    (Useful → Urgent → Unique → Ultra-specific)
 *   - QUEST (Qualify → Understand → Educate → Stimulate → Transition)
 *
 * Genere :
 *   - Headlines (10 variations par produit)
 *   - Body copy (PAS, AIDA, BAB)
 *   - CTA variations (urgence, curiosite, benefice)
 *   - Email sequences (welcome, abandon cart, post-achat)
 *   - Ad copy (hooks + body + CTA)
 *
 * Alimente : AGENT_STORE_BUILDER + AGENT_CREATIVE_FACTORY
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

interface CopyInput {
  productId:    string;
  productName:  string;
  description?: string;
  niche?:       string;
  targetAvatar?: string;
  painPoints?:  string[];
  benefits?:    string[];
  price?:       number;
  guarantee?:   string;
}

interface HeadlineVariation {
  text:      string;
  framework: string;
  type:      'curiosity' | 'benefit' | 'urgency' | 'social_proof' | 'fear';
  score:     number;
}

export class CopyChiefAgent extends AgentBase {
  readonly agentId = 'AGENT_COPY_CHIEF';

  readonly supportedTasks = [
    'copy.headlines',         // Generer 10 headlines
    'copy.product_page',     // Copy complete page produit
    'copy.ad_copy',          // Copy publicitaire (hooks + body + CTA)
    'copy.email_sequence',   // Sequence email (welcome, abandon, post-achat)
    'copy.cta_variations',   // Variations CTA
    'copy.full_brief',       // Brief complet (tout en un)
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'copy.headlines':      return this.generateHeadlines(task);
      case 'copy.product_page':   return this.generateProductPageCopy(task);
      case 'copy.ad_copy':        return this.generateAdCopy(task);
      case 'copy.email_sequence': return this.generateEmailSequence(task);
      case 'copy.cta_variations': return this.generateCtaVariations(task);
      case 'copy.full_brief':     return this.generateFullBrief(task);
      default: throw new Error(`Task non supportee: ${task.taskType}`);
    }
  }

  // ── Headlines (10 variations) ──────────────────────────────────────────

  private async generateHeadlines(task: AgentTask): Promise<AgentResult> {
    const input = await this.resolveInput(task);

    const headlines: HeadlineVariation[] = [
      // Curiosite
      { text: `La methode secrete que les pros utilisent pour [benefice]`,
        framework: 'curiosity_gap', type: 'curiosity', score: 85 },
      { text: `Pourquoi 95% des gens se trompent sur [probleme] (et comment l'eviter)`,
        framework: 'curiosity_gap', type: 'curiosity', score: 82 },
      // Benefice direct
      { text: `${input.productName} : [benefice principal] en seulement 14 jours`,
        framework: 'benefit_first', type: 'benefit', score: 88 },
      { text: `Comment obtenir [resultat] sans [effort/sacrifice]`,
        framework: 'how_to', type: 'benefit', score: 84 },
      // Urgence
      { text: `DERNIERE CHANCE : [offre] expire dans 24h`,
        framework: '4U', type: 'urgency', score: 76 },
      { text: `Stock limite — Plus que 47 unites disponibles`,
        framework: 'scarcity', type: 'urgency', score: 74 },
      // Preuve sociale
      { text: `Rejoint par 10 000+ clients satisfaits — Decouvrez pourquoi`,
        framework: 'social_proof', type: 'social_proof', score: 80 },
      { text: `Note 4.8/5 : "${input.productName}" est le choix n1 en France`,
        framework: 'authority', type: 'social_proof', score: 78 },
      // Peur de manquer
      { text: `Ce que vos concurrents savent deja (et pas vous)`,
        framework: 'FOMO', type: 'fear', score: 81 },
      { text: `Arretez de perdre de l'argent — La solution existe`,
        framework: 'PAS', type: 'fear', score: 79 },
    ];

    return {
      success: true,
      output: {
        headlines: headlines.sort((a, b) => b.score - a.score),
        bestHeadline: headlines.sort((a, b) => b.score - a.score)[0],
        totalGenerated: headlines.length,
      },
    };
  }

  // ── Product Page Copy (PAS + AIDA) ─────────────────────────────────────

  private async generateProductPageCopy(task: AgentTask): Promise<AgentResult> {
    const input = await this.resolveInput(task);

    const copy = {
      // PAS Framework
      pas: {
        problem: `Vous en avez assez de ${input.painPoints?.[0] ?? 'chercher sans trouver de solution'} ? `
          + `Vous n'etes pas seul. Des milliers de personnes vivent la meme frustration chaque jour.`,
        agitation: `Chaque jour qui passe sans solution, c'est du temps, de l'argent et de l'energie perdus. `
          + `Et le pire ? Les "solutions" classiques ne font qu'aggraver le probleme.`,
        solution: `${input.productName} a ete concu specifiquement pour resoudre ce probleme. `
          + `Resultat ? ${input.benefits?.[0] ?? 'Des resultats visibles des la premiere utilisation'}.`,
      },
      // AIDA Framework
      aida: {
        attention: `DECOUVERTE : La methode qui change tout`,
        interest: `${input.productName} combine les dernieres avancees pour offrir une solution unique. `
          + `Contrairement aux alternatives, notre approche cible directement la source du probleme.`,
        desire: `Imaginez : dans 14 jours, ${input.benefits?.[1] ?? 'votre quotidien est transforme'}. `
          + `Plus de compromis, plus de frustration. Juste des resultats concrets.`,
        action: `Profitez de l'offre de lancement maintenant → Livraison rapide + ${input.guarantee ?? 'Garantie 30 jours'}`,
      },
      // BAB Framework
      bab: {
        before: `Avant ${input.productName} : stress, frustration, solutions qui ne marchent pas.`,
        after: `Apres ${input.productName} : serenite, resultats visibles, confiance retrouvee.`,
        bridge: `Le pont entre les deux ? Une decision simple. Cliquez ci-dessous.`,
      },
      // Bullet points persuasifs
      bullets: [
        `Resultats prouves en 7-14 jours d'utilisation`,
        `Formule exclusive non disponible en magasin`,
        `Plus de 10 000 clients satisfaits en France`,
        `Garantie ${input.guarantee ?? 'satisfait ou rembourse 30 jours'}`,
        `Livraison rapide en 5-8 jours ouvrables`,
        `Support client reactif 7j/7`,
      ],
    };

    // Persister le copywriting
    await db.query(
      `INSERT INTO store.copy_assets (tenant_id, product_id, copy_type, copy_data, status)
       VALUES ($1, $2, 'product_page', $3, 'draft')
       ON CONFLICT DO NOTHING`,
      [task.tenantId, input.productId, JSON.stringify(copy)]
    ).catch(() => {});

    logger.info(`[COPY_CHIEF] Product page copy genere pour ${input.productName}`);

    return { success: true, output: copy };
  }

  // ── Ad Copy (Hooks + Body + CTA) ───────────────────────────────────────

  private async generateAdCopy(task: AgentTask): Promise<AgentResult> {
    const input = await this.resolveInput(task);

    const adCopies = [
      // Hook emotionnel
      {
        hook: `J'ai decouvert ${input.productName} il y a 3 semaines... et ma vie a change.`,
        body: `Je pensais que c'etait juste un produit de plus. Mais apres 14 jours, les resultats parlent d'eux-memes.`,
        cta: `Lien en bio 👇`,
        angle: 'testimonial',
        awareness: 'solution_aware',
      },
      // Hook probleme
      {
        hook: `STOP ! Si vous faites encore ca, vous perdez votre temps.`,
        body: `La plupart des gens ignorent cette erreur. ${input.productName} resout exactement ce probleme.`,
        cta: `Decouvrir la solution →`,
        angle: 'problem_solution',
        awareness: 'problem_aware',
      },
      // Hook curiosite
      {
        hook: `Pourquoi tout le monde parle de ce produit en ce moment ?`,
        body: `10 000+ clients. 4.8/5 etoiles. Et un resultat que personne n'attendait.`,
        cta: `Voir les resultats →`,
        angle: 'social_proof',
        awareness: 'unaware',
      },
      // Hook urgence
      {
        hook: `DERNIERS JOURS : Cette offre disparait dimanche soir.`,
        body: `${input.productName} a prix lance. -30% seulement cette semaine. Ne ratez pas ca.`,
        cta: `J'en profite maintenant →`,
        angle: 'urgency',
        awareness: 'most_aware',
      },
      // Hook transformation
      {
        hook: `AVANT / APRES : Le resultat parle de lui-meme.`,
        body: `En seulement 14 jours, la transformation est visible. Pas de trucage, juste ${input.productName}.`,
        cta: `Commencer ma transformation →`,
        angle: 'transformation',
        awareness: 'product_aware',
      },
    ];

    return {
      success: true,
      output: {
        adCopies,
        totalVariations: adCopies.length,
        bestForCold: adCopies.find(a => a.awareness === 'unaware'),
        bestForWarm: adCopies.find(a => a.awareness === 'most_aware'),
      },
    };
  }

  // ── Email Sequence ─────────────────────────────────────────────────────

  private async generateEmailSequence(task: AgentTask): Promise<AgentResult> {
    const input = await this.resolveInput(task);

    const sequence = {
      welcome: {
        subject: `Bienvenue ! Votre acces a ${input.productName} est pret`,
        preview: 'Voici comment commencer en 2 minutes...',
        body: `Merci pour votre confiance ! Voici vos premiers pas avec ${input.productName}...`,
      },
      abandonCart: [
        {
          delay: '1h',
          subject: `Oups, vous avez oublie quelque chose...`,
          body: `Votre panier vous attend ! ${input.productName} est toujours disponible.`,
        },
        {
          delay: '24h',
          subject: `Derniere chance : ${input.productName} a -10%`,
          body: `Pour vous remercier de votre interet, voici un code promo exclusif...`,
        },
        {
          delay: '48h',
          subject: `Ce que Marie pense de ${input.productName}...`,
          body: `"Les resultats sont incroyables..." — Decouvrez son temoignage.`,
        },
      ],
      postPurchase: [
        {
          delay: '0',
          subject: `Commande confirmee ! Votre ${input.productName} arrive bientot`,
          body: `Merci ! Votre commande est en preparation. Voici votre suivi...`,
        },
        {
          delay: '7d',
          subject: `Comment se passent vos premiers jours ?`,
          body: `Ca fait une semaine ! Dites-nous comment ca se passe. Des questions ?`,
        },
        {
          delay: '14d',
          subject: `Vos premiers resultats avec ${input.productName}`,
          body: `A ce stade, vous devriez commencer a voir les premiers changements...`,
        },
      ],
    };

    return { success: true, output: sequence };
  }

  // ── CTA Variations ─────────────────────────────────────────────────────

  private async generateCtaVariations(task: AgentTask): Promise<AgentResult> {
    const input = await this.resolveInput(task);

    return {
      success: true,
      output: {
        primary: [
          'Je veux mes resultats →',
          'Oui, je commande maintenant',
          `Commander ${input.productName} →`,
          'Profiter de l\'offre →',
        ],
        urgency: [
          'Derniere chance — Commander →',
          'J\'en profite avant la fin du stock',
          'Oui, je ne veux pas rater ca',
        ],
        curiosity: [
          'Decouvrir le secret →',
          'Voir les resultats →',
          'En savoir plus →',
        ],
        softCta: [
          'En apprendre plus',
          'Voir les details',
          'Comment ca marche ?',
        ],
      },
    };
  }

  // ── Full Brief ─────────────────────────────────────────────────────────

  private async generateFullBrief(task: AgentTask): Promise<AgentResult> {
    const [headlines, productPage, adCopy, emails, ctas] = await Promise.all([
      this.generateHeadlines(task),
      this.generateProductPageCopy(task),
      this.generateAdCopy(task),
      this.generateEmailSequence(task),
      this.generateCtaVariations(task),
    ]);

    logger.info(`[COPY_CHIEF] Full brief genere pour produit ${(task.input as any)?.productId}`);

    return {
      success: true,
      output: {
        headlines: headlines.output,
        productPage: productPage.output,
        adCopy: adCopy.output,
        emails: emails.output,
        ctas: ctas.output,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  // ── Input Resolution ───────────────────────────────────────────────────

  private async resolveInput(task: AgentTask): Promise<CopyInput> {
    const raw = task.input as Partial<CopyInput>;
    if (raw.productName) return raw as CopyInput;

    // Charger depuis la DB si seulement productId fourni
    const { rows } = await db.query(
      `SELECT name, description, price, niche FROM store.products
       WHERE id = $1 AND tenant_id = $2`,
      [raw.productId, task.tenantId]
    ).catch(() => ({ rows: [] }));

    const p = rows[0] ?? {};
    return {
      productId: raw.productId ?? 'unknown',
      productName: p.name ?? raw.productName ?? 'Produit',
      description: p.description ?? raw.description,
      niche: p.niche ?? raw.niche,
      price: p.price ?? raw.price,
      ...raw,
    };
  }
}
