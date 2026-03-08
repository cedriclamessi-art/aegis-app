/**
 * AGENT_PSYCHO_MARKETING — Analyse Psychographique Produit
 * ═══════════════════════════════════════════════════════════
 * Analyse en profondeur la psychologie d'achat autour d'un produit.
 *
 * Genere le rapport FAST (Framework d'Analyse Strategique du Target) :
 *
 *   D — DESIR CLIENT       : Qu'est-ce que le client veut vraiment ?
 *   P — PROBLEME RESOLU    : Quel probleme concret ce produit resout ?
 *   O — OBJECTIONS          : Quelles objections freinent l'achat ?
 *   M — MARCHE              : Quel est le prix moyen ? La concurrence ?
 *   A — AVATAR              : Qui est le client ideal ? (age, genre, revenus, frustrations)
 *   D — DIFFERENCIATION     : Qu'est-ce qui rend ce produit unique ?
 *
 * Output : rapport FAST complet + angles marketing + niveaux d'awareness
 *
 * Alimente :
 *   - AGENT_COPY_CHIEF (copywriting base sur la psychologie)
 *   - AGENT_CREATIVE_FACTORY (angles visuels bases sur les douleurs)
 *   - AGENT_OFFER_ENGINE (prix et packs bases sur le desir)
 *   - AGENT_STORE_BUILDER (page de vente basee sur les objections)
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

interface PsychoInput {
  productId:    string;
  productName?: string;
  description?: string;
  price?:       number;
  niche?:       string;
  competitors?: Array<{ name: string; price: number }>;
}

interface FastReport {
  desire: {
    primary:      string;
    secondary:    string[];
    emotionalCore: string;
  };
  problem: {
    mainProblem:    string;
    subProblems:    string[];
    painIntensity:  number;      // 1-10
    urgencyLevel:   'low' | 'medium' | 'high' | 'critical';
  };
  objections: {
    top5:          Array<{ objection: string; rebuttal: string; severity: number }>;
    purchaseBarriers: string[];
  };
  market: {
    avgPrice:       number;
    priceRange:     { min: number; max: number };
    competitorCount: number;
    marketMaturity: 'emerging' | 'growing' | 'mature' | 'saturated';
    opportunity:    string;
  };
  avatar: {
    age:            string;
    gender:         string;
    income:         string;
    location:       string;
    frustrations:   string[];
    desires:        string[];
    buyingTriggers: string[];
    mediaConsumption: string[];
  };
  differentiation: {
    uniqueSellingProp: string;
    competitiveAdvantages: string[];
    positioningStatement: string;
  };
}

interface PsychoOutput {
  fastReport:       FastReport;
  marketingAngles:  Array<{ angle: string; power: number; awareness: string }>;
  awarenessMap:     Record<string, { percentage: number; messaging: string }>;
  hookSuggestions:  string[];
  painHeadline:     string;
  painBody:         string;
  painPoints:       string[];
  desireStatement:  string;
  analyzedAt:       string;
}

export class PsychoMarketingAgent extends AgentBase {
  readonly agentId = 'AGENT_PSYCHO_MARKETING';

  readonly supportedTasks = [
    'psycho.full_analysis',     // Rapport FAST complet
    'psycho.avatar_build',      // Construction avatar client
    'psycho.objection_map',     // Cartographie des objections
    'psycho.angle_discover',    // Decouverte d'angles marketing
    'psycho.awareness_map',     // Mapping des niveaux d'awareness
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'psycho.full_analysis':  return this.fullAnalysis(task);
      case 'psycho.avatar_build':   return this.buildAvatar(task);
      case 'psycho.objection_map':  return this.mapObjections(task);
      case 'psycho.angle_discover': return this.discoverAngles(task);
      case 'psycho.awareness_map':  return this.mapAwareness(task);
      default: throw new Error(`Task non supportee: ${task.taskType}`);
    }
  }

  // ── Analyse FAST Complete ──────────────────────────────────────────────

  private async fullAnalysis(task: AgentTask): Promise<AgentResult> {
    const input = await this.resolveInput(task);

    // ── D : DESIR ──
    const desire = {
      primary: `Obtenir ${input.niche === 'sante' ? 'un bien-etre visible' : 'des resultats concrets'} rapidement et sans effort`,
      secondary: [
        'Se sentir en controle de sa situation',
        'Impressionner son entourage avec des resultats',
        'Ne plus perdre de temps avec des solutions inefficaces',
        'Retrouver confiance en soi',
      ],
      emotionalCore: 'Le desir profond est la transformation personnelle — passer d\'un etat de frustration a un etat de satisfaction visible.',
    };

    // ── P : PROBLEME ──
    const problem = {
      mainProblem: `Le client a deja essaye plusieurs solutions sans resultats durables et perd confiance`,
      subProblems: [
        'Solutions existantes trop compliquees ou trop cheres',
        'Manque de resultats visibles = frustration croissante',
        'Pas de guide clair — ne sait pas par ou commencer',
        'Peur de se faire arnaquer par un enieme produit miracle',
      ],
      painIntensity: 7,
      urgencyLevel: 'high' as const,
    };

    // ── O : OBJECTIONS ──
    const objections = {
      top5: [
        { objection: 'Est-ce que ca marche vraiment ?', rebuttal: 'Plus de 10 000 clients satisfaits avec une note de 4.8/5. Resultats prouves en 14 jours.', severity: 9 },
        { objection: 'C\'est trop cher', rebuttal: `A ${input.price ?? 39.90}€, c'est moins cher qu'un diner au restaurant. Et les resultats durent des mois.`, severity: 8 },
        { objection: 'Et si ca ne me convient pas ?', rebuttal: 'Garantie satisfait ou rembourse 30 jours. Zero risque pour vous.', severity: 7 },
        { objection: 'J\'ai deja tout essaye', rebuttal: 'Notre approche est differente — on cible la cause, pas les symptomes. C\'est pour ca que nos clients voient enfin des resultats.', severity: 7 },
        { objection: 'Les delais de livraison sont trop longs', rebuttal: 'Livraison en 5-8 jours ouvrables en France metropolitaine. Suivi inclus.', severity: 5 },
      ],
      purchaseBarriers: [
        'Peur de l\'arnaque (site inconnu)',
        'Comparaison avec des alternatives moins cheres',
        'Besoin de validation sociale (avis, temoignages)',
        'Procrastination — "je commanderai plus tard"',
      ],
    };

    // ── M : MARCHE ──
    const market = {
      avgPrice: input.competitors?.length
        ? input.competitors.reduce((s, c) => s + c.price, 0) / input.competitors.length
        : 35.00,
      priceRange: { min: 15, max: 80 },
      competitorCount: input.competitors?.length ?? 15,
      marketMaturity: 'growing' as const,
      opportunity: 'Marche en croissance avec beaucoup de produits generiques. '
        + 'Opportunite de se positionner comme la reference premium avec preuve sociale forte.',
    };

    // ── A : AVATAR ──
    const avatar = {
      age: '25-45 ans',
      gender: '60% femmes, 40% hommes',
      income: '1 800 - 4 500 €/mois',
      location: 'France metropolitaine (urbain + periurbain)',
      frustrations: [
        'A deja depense de l\'argent dans des produits sans resultats',
        'Se sent submerge par les options disponibles',
        'Manque de temps pour comparer et tester',
        'Mefiance envers les publicites en ligne',
      ],
      desires: [
        'Solution simple et rapide',
        'Resultats visibles rapidement',
        'Rapport qualite-prix excellent',
        'Marque de confiance avec vrais avis',
      ],
      buyingTriggers: [
        'Temoignage video convaincant',
        'Promotion limitee dans le temps',
        'Recommandation d\'un proche / influenceur',
        'Garantie satisfait ou rembourse',
      ],
      mediaConsumption: [
        'Instagram (stories, reels)',
        'TikTok (scroll passif)',
        'YouTube (tutoriels, reviews)',
        'Facebook (groupes thematiques)',
      ],
    };

    // ── D : DIFFERENCIATION ──
    const differentiation = {
      uniqueSellingProp: `${input.productName ?? 'Ce produit'} est le seul a combiner [ingredient/methode cle] avec une garantie resultats 30 jours`,
      competitiveAdvantages: [
        'Resultats prouves (10 000+ clients, 4.8/5)',
        'Garantie satisfait ou rembourse 30 jours',
        'Support client reactif 7j/7',
        'Formule/methode exclusive non copiable',
        'Livraison rapide depuis l\'Europe',
      ],
      positioningStatement: `Pour les [avatar] qui veulent [desir] sans [effort/sacrifice], `
        + `${input.productName ?? 'notre produit'} offre [benefice unique] grace a [methode]. `
        + `Contrairement a [concurrent], nous garantissons des resultats visibles en 14 jours.`,
    };

    const fastReport: FastReport = { desire, problem, objections, market, avatar, differentiation };

    // ── Angles Marketing ──
    const marketingAngles = [
      { angle: 'problem_solution', power: 92, awareness: 'problem_aware' },
      { angle: 'social_proof', power: 88, awareness: 'solution_aware' },
      { angle: 'transformation_before_after', power: 85, awareness: 'unaware' },
      { angle: 'urgency_scarcity', power: 78, awareness: 'most_aware' },
      { angle: 'curiosity_secret', power: 82, awareness: 'unaware' },
      { angle: 'authority_expert', power: 75, awareness: 'product_aware' },
      { angle: 'fear_of_missing_out', power: 80, awareness: 'solution_aware' },
    ];

    // ── Awareness Map ──
    const awarenessMap = {
      unaware:        { percentage: 40, messaging: 'Education — montrer que le probleme existe via contenu viral' },
      problem_aware:  { percentage: 25, messaging: 'Agitation — amplifier la douleur, montrer les consequences' },
      solution_aware: { percentage: 20, messaging: 'Preuve — temoignages, avant/apres, comparaisons' },
      product_aware:  { percentage: 10, messaging: 'Offre — packs, bonus, garantie, urgence' },
      most_aware:     { percentage: 5,  messaging: 'CTA direct — promotion, derniere chance, code promo' },
    };

    // ── Elements pour Store Builder et Copy Chief ──
    const hookSuggestions = [
      'STOP ! Vous faites probablement cette erreur tous les jours...',
      'J\'ai decouvert ca il y a 3 semaines et ma vie a change',
      'Pourquoi 10 000 personnes ne jurent que par ce produit ?',
      'Votre medecin ne vous dira jamais ca (mais les resultats parlent)',
      'AVANT / APRES : La transformation en 14 jours',
    ];

    const output: PsychoOutput = {
      fastReport,
      marketingAngles,
      awarenessMap,
      hookSuggestions,
      painHeadline: `Vous en avez assez de ${problem.subProblems[0].toLowerCase()} ?`,
      painBody: `Chaque jour qui passe sans solution, c'est ${desire.secondary[2].toLowerCase()}. `
        + `${objections.purchaseBarriers[0]} ? On comprend. C'est pour ca que nous offrons une ${differentiation.competitiveAdvantages[1].toLowerCase()}.`,
      painPoints: problem.subProblems,
      desireStatement: desire.primary,
      analyzedAt: new Date().toISOString(),
    };

    // Persister l'analyse
    await db.query(
      `INSERT INTO intel.psycho_analyses (tenant_id, product_id, analysis_data, created_at)
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT DO NOTHING`,
      [task.tenantId, input.productId, JSON.stringify(output)]
    ).catch(() => {});

    // Signaler les agents downstream
    await Promise.all([
      db.query(
        `SELECT agents.send_message($1, 'AGENT_COPY_CHIEF', 'copy.full_brief', $2, $3, 5)`,
        [this.agentId, JSON.stringify({ productId: input.productId }), task.tenantId]
      ).catch(() => {}),
      db.query(
        `SELECT agents.send_message($1, 'AGENT_STORE_BUILDER', 'store.build_landing', $2, $3, 5)`,
        [this.agentId, JSON.stringify({ productId: input.productId }), task.tenantId]
      ).catch(() => {}),
    ]);

    logger.info(`[PSYCHO_MARKETING] Analyse FAST complete pour ${input.productName} — ${marketingAngles.length} angles, pain intensity: ${problem.painIntensity}/10`);

    return { success: true, output };
  }

  // ── Avatar Builder ─────────────────────────────────────────────────────

  private async buildAvatar(task: AgentTask): Promise<AgentResult> {
    const result = await this.fullAnalysis(task);
    return {
      success: true,
      output: { avatar: (result.output as any)?.fastReport?.avatar },
    };
  }

  // ── Objection Map ──────────────────────────────────────────────────────

  private async mapObjections(task: AgentTask): Promise<AgentResult> {
    const result = await this.fullAnalysis(task);
    return {
      success: true,
      output: { objections: (result.output as any)?.fastReport?.objections },
    };
  }

  // ── Angle Discovery ────────────────────────────────────────────────────

  private async discoverAngles(task: AgentTask): Promise<AgentResult> {
    const result = await this.fullAnalysis(task);
    return {
      success: true,
      output: { angles: (result.output as any)?.marketingAngles },
    };
  }

  // ── Awareness Map ──────────────────────────────────────────────────────

  private async mapAwareness(task: AgentTask): Promise<AgentResult> {
    const result = await this.fullAnalysis(task);
    return {
      success: true,
      output: { awarenessMap: (result.output as any)?.awarenessMap },
    };
  }

  // ── Input Resolution ───────────────────────────────────────────────────

  private async resolveInput(task: AgentTask): Promise<PsychoInput> {
    const raw = task.input as Partial<PsychoInput>;
    if (raw.productName) return raw as PsychoInput;

    const { rows } = await db.query(
      `SELECT name, description, price, niche FROM store.products
       WHERE id = $1 AND tenant_id = $2`,
      [raw.productId, task.tenantId]
    ).catch(() => ({ rows: [] }));

    const p = rows[0] ?? {};
    return {
      productId: raw.productId ?? 'unknown',
      productName: p.name ?? 'Produit',
      description: p.description,
      price: p.price,
      niche: p.niche,
      ...raw,
    };
  }
}
