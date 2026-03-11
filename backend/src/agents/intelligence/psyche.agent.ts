/**
 * AGENT_PSYCHE — Psychologie & Persuasion Engine 🧠
 * ═══════════════════════════════════════════════════════════
 *
 * MISSION : Pour chaque produit, analyser la psychologie du client et
 * concevoir une stratégie de persuasion éthique basée sur 70+ modèles mentaux.
 *
 * PSYCHE est le CERVEAU qui nourrit tous les autres agents :
 *   → STORE reçoit la copy strategy
 *   → CREATIVE FACTORY reçoit les angles psychologiques
 *   → ADS reçoit les objections à adresser
 *   → TRAFFIC reçoit les hooks persuasifs
 *   → SEO reçoit le langage client
 *   → SUPPORT reçoit les réponses aux objections
 *
 * ── ANALYSE EN 4 PHASES ─────────────────────────────────────
 *
 *  Phase 1 : COMPRENDRE LE CLIENT
 *    - Avatar client idéal (démographie, psychographie)
 *    - Problème qu'ils essaient de résoudre
 *    - Objections / hésitations
 *    - Langage utilisé pour décrire leur douleur
 *    - Croyances existantes
 *    - Niveau de conscience (Schwartz: Unaware → Most Aware)
 *
 *  Phase 2 : COMPRENDRE LE PRODUIT
 *    - Transformation apportée (état A → état B)
 *    - Différenciation vs alternatives
 *    - "Job to be Done" (Christensen)
 *    - Valeur perçue vs coût réel
 *
 *  Phase 3 : SÉLECTION MODÈLES MENTAUX (5-10 parmi 70+)
 *    - Selon le type de produit
 *    - Selon les défis marketing identifiés
 *    - Selon le niveau de conscience du trafic
 *
 *  Phase 4 : STRATÉGIE DE PERSUASION
 *    - Copy strategy (titres, sous-titres, CTA)
 *    - Angles créatifs (5 angles psychologiques)
 *    - Pricing strategy (ancrage, cadrage)
 *    - Objection handling (réponses par modèle)
 *    - Métriques à surveiller
 *
 * ── 70+ MODÈLES MENTAUX DISPONIBLES ────────────────────────
 *
 *  CONVERSION : Loi de Hick, Énergie d'activation, BJ Fogg, Paradoxe du choix
 *  PRIX : Ancrage, Cadrage, Comptabilité mentale, Aversion à la perte
 *  CONFIANCE : Autorité, Preuve sociale, Réciprocité, Effet de halo
 *  URGENCE : Rareté, FOMO, Effet Zeigarnik, Fenêtre temporelle
 *  RÉTENTION : Effet de dotation, Coûts irrécupérables, Biais du statu quo
 *  ÉMOTION : Storytelling, Contraste, Peak-End Rule, Identité
 *
 * ── OUTPUT ───────────────────────────────────────────────────
 *
 *  - Document stratégique complet par produit
 *  - Instructions spécifiques pour chaque agent
 *  - Score de persuasion estimé /100
 *  - Objection map avec réponses
 */

import { Pool } from 'pg';
import { Redis } from 'ioredis';

// ── Types ────────────────────────────────────────────────
interface CustomerAvatar {
  demographics: {
    age_range: string;
    gender: string;
    location: string;
    income_level: string;
  };
  psychographics: {
    values: string[];
    interests: string[];
    pain_points: string[];
    desires: string[];
    language_patterns: string[];   // How they describe their problem
  };
  awareness_level: 'unaware' | 'problem_aware' | 'solution_aware' | 'product_aware' | 'most_aware';
  objections: Objection[];
  beliefs: string[];               // Existing beliefs to leverage or overcome
}

interface Objection {
  objection: string;
  severity: 'high' | 'medium' | 'low';
  mental_model: string;
  response: string;
  copy_example: string;
}

interface MentalModel {
  id: string;
  name: string;
  category: 'conversion' | 'pricing' | 'trust' | 'urgency' | 'retention' | 'emotion';
  description: string;
  when_to_use: string[];
  application: string;
  copy_template: string;
}

interface PersuasionStrategy {
  product_id: string;
  product_name: string;
  avatar: CustomerAvatar;
  job_to_be_done: string;
  transformation: { state_before: string; state_after: string };
  selected_models: MentalModel[];
  copy_strategy: CopyStrategy;
  creative_angles: CreativeAngle[];
  pricing_strategy: PricingStrategy;
  objection_map: Objection[];
  agent_instructions: AgentInstructions;
  persuasion_score: number;
  ethical_check: boolean;
}

interface CopyStrategy {
  headline: string;
  subheadline: string;
  problem_section: string;
  solution_section: string;
  cta_text: string;
  cta_subtext: string;
  social_proof_angle: string;
  guarantee_copy: string;
}

interface CreativeAngle {
  angle_id: number;
  name: string;
  mental_model: string;
  hook: string;
  concept: string;
  emotion_target: string;
  platform: 'tiktok' | 'meta' | 'all';
}

interface PricingStrategy {
  anchor_price: number;
  selling_price: number;
  framing: string;           // "2,60€/mois" instead of "79€"
  comparison: string;        // "Moins cher qu'une séance chez l'esthéticienne"
  guarantee: string;
  urgency_element: string;
}

interface AgentInstructions {
  store: string;
  creative_factory: string;
  ads: string;
  traffic: string;
  seo: string;
  support: string;
}

// ── 70+ Modèles Mentaux ─────────────────────────────────
const MENTAL_MODELS: MentalModel[] = [
  // CONVERSION
  {
    id: 'hicks_law', name: 'Loi de Hick', category: 'conversion',
    description: 'Plus il y a de choix, plus la décision est lente',
    when_to_use: ['trop_options', 'abandon_panier', 'page_complexe'],
    application: 'Réduire les choix à 3 options maximum',
    copy_template: 'Le plus populaire : [OPTION]'
  },
  {
    id: 'activation_energy', name: 'Énergie d\'activation', category: 'conversion',
    description: 'Réduire la friction au minimum pour faciliter l\'action',
    when_to_use: ['faible_conversion', 'formulaire_long', 'processus_complexe'],
    application: 'Checkout en 1 clic, auto-fill, minimal steps',
    copy_template: 'En 30 secondes, c\'est réglé'
  },
  {
    id: 'bj_fogg', name: 'Modèle BJ Fogg', category: 'conversion',
    description: 'Behavior = Motivation × Ability × Trigger',
    when_to_use: ['premiere_action', 'engagement_faible', 'nouveau_client'],
    application: 'Aligner le CTA avec un moment de haute motivation',
    copy_template: 'Commencez maintenant — c\'est gratuit pendant 30 jours'
  },
  {
    id: 'choice_paradox', name: 'Paradoxe du choix', category: 'conversion',
    description: 'Trop de choix paralyse la décision',
    when_to_use: ['catalogue_large', 'variants_multiples'],
    application: 'Highlighter "Le choix préféré" ou "Recommandé"',
    copy_template: '⭐ Le plus vendu — choisi par 73% des clients'
  },

  // PRICING
  {
    id: 'anchoring', name: 'Ancrage de prix', category: 'pricing',
    description: 'Le premier prix vu influence la perception des suivants',
    when_to_use: ['prix_eleve', 'lancement', 'promo'],
    application: 'Montrer le prix barré avant le prix réel',
    copy_template: '~~[PRIX_ORIGINAL]~~ → [PRIX_PROMO] (-[PERCENT]%)'
  },
  {
    id: 'framing', name: 'Cadrage', category: 'pricing',
    description: 'Présenter le prix sous un angle favorable',
    when_to_use: ['prix_eleve', 'abonnement', 'produit_durable'],
    application: 'Diviser par jour/mois au lieu du prix total',
    copy_template: 'Seulement [PRIX_JOUR]€/jour pour [BENEFICE]'
  },
  {
    id: 'mental_accounting', name: 'Comptabilité mentale', category: 'pricing',
    description: 'Les gens catégorisent l\'argent différemment selon la source',
    when_to_use: ['prix_eleve', 'luxe_abordable'],
    application: 'Comparer à une dépense quotidienne acceptée',
    copy_template: 'Le prix d\'un café par jour pour [TRANSFORMATION]'
  },
  {
    id: 'loss_aversion', name: 'Aversion à la perte', category: 'pricing',
    description: 'La douleur de perdre > le plaisir de gagner (×2.5)',
    when_to_use: ['hesitation', 'consideration_longue', 'prix_eleve'],
    application: 'Montrer ce qu\'ils perdent en n\'achetant PAS',
    copy_template: 'Combien de [PROBLEME] allez-vous encore subir ?'
  },

  // TRUST
  {
    id: 'authority', name: 'Autorité', category: 'trust',
    description: 'Les gens suivent les experts et figures d\'autorité',
    when_to_use: ['nouveau_brand', 'sante', 'technique'],
    application: 'Certifications, experts, mentions presse',
    copy_template: 'Recommandé par [EXPERT] · Certifié [CERTIFICATION]'
  },
  {
    id: 'social_proof', name: 'Preuve sociale', category: 'trust',
    description: 'Si d\'autres l\'achètent, c\'est que c\'est bien',
    when_to_use: ['toujours', 'nouveau_produit', 'categorie_competitive'],
    application: 'Nombre de clients, avis, UGC, logos presse',
    copy_template: 'Rejoint par [NOMBRE]+ [AVATAR] satisfait(e)s'
  },
  {
    id: 'reciprocity', name: 'Réciprocité', category: 'trust',
    description: 'Donner quelque chose crée l\'obligation de rendre',
    when_to_use: ['lead_gen', 'premier_achat', 'upsell'],
    application: 'Offrir un guide, ebook, remise avant de vendre',
    copy_template: 'Recevez gratuitement [CADEAU] avec votre commande'
  },
  {
    id: 'halo_effect', name: 'Effet de halo', category: 'trust',
    description: 'Une qualité positive influence la perception globale',
    when_to_use: ['design_premium', 'packaging', 'brand_building'],
    application: 'Design premium, unboxing soigné, brand aesthetic',
    copy_template: 'L\'expérience [BRAND] — du colis à l\'utilisation'
  },

  // URGENCY
  {
    id: 'scarcity', name: 'Rareté', category: 'urgency',
    description: 'Ce qui est rare est perçu comme plus précieux',
    when_to_use: ['conversion_lente', 'promo', 'lancement'],
    application: 'Stock limité, édition limitée, temps limité',
    copy_template: 'Plus que [N] en stock à ce prix'
  },
  {
    id: 'fomo', name: 'FOMO', category: 'urgency',
    description: 'Fear Of Missing Out — peur de rater une opportunité',
    when_to_use: ['millennials', 'social_selling', 'trending'],
    application: 'Montrer les achats en temps réel, compteur',
    copy_template: '[N] personnes regardent ce produit en ce moment'
  },
  {
    id: 'zeigarnik', name: 'Effet Zeigarnik', category: 'urgency',
    description: 'On se souvient mieux des tâches inachevées',
    when_to_use: ['abandon_panier', 'lead_nurture', 'retargeting'],
    application: 'Rappeler la commande incomplète, progress bar',
    copy_template: 'Votre panier vous attend — finalisez en 1 clic'
  },

  // RETENTION
  {
    id: 'endowment', name: 'Effet de dotation', category: 'retention',
    description: 'On valorise plus ce qu\'on possède déjà',
    when_to_use: ['essai_gratuit', 'retour_client', 'upsell'],
    application: 'Essai gratuit, "gardez-le 30 jours"',
    copy_template: 'Essayez-le 30 jours — renvoyez-le si vous n\'êtes pas conquis(e)'
  },
  {
    id: 'sunk_cost', name: 'Coûts irrécupérables', category: 'retention',
    description: 'Plus on a investi, moins on veut abandonner',
    when_to_use: ['churn', 'abonnement', 'programme_fidelite'],
    application: 'Progress bar, niveaux, points accumulés',
    copy_template: 'Vous avez déjà économisé [MONTANT] — continuez !'
  },
  {
    id: 'status_quo_bias', name: 'Biais du statu quo', category: 'retention',
    description: 'Les gens préfèrent ne rien changer par défaut',
    when_to_use: ['abonnement', 'switch_cost', 'renouvellement'],
    application: 'Opt-out plutôt qu\'opt-in, renouvellement auto',
    copy_template: 'Continuez automatiquement — annulez à tout moment'
  },

  // EMOTION
  {
    id: 'storytelling', name: 'Storytelling', category: 'emotion',
    description: 'Les histoires activent plus de zones cérébrales que les faits',
    when_to_use: ['toujours', 'brand_building', 'emotional_product'],
    application: 'Raconter l\'histoire d\'un client transformé',
    copy_template: '"Avant [PRODUIT], je [PROBLEME]. Aujourd\'hui, je [TRANSFORMATION]."'
  },
  {
    id: 'contrast_effect', name: 'Effet de contraste', category: 'emotion',
    description: 'La différence entre deux options amplifie la perception',
    when_to_use: ['before_after', 'comparaison', 'upgrade'],
    application: 'Avant/après, avec/sans, nous vs concurrents',
    copy_template: 'AVANT : [DOULEUR] → APRÈS : [TRANSFORMATION]'
  },
  {
    id: 'peak_end', name: 'Peak-End Rule', category: 'emotion',
    description: 'On juge une expérience par son pic et sa fin',
    when_to_use: ['unboxing', 'post_achat', 'experience_client'],
    application: 'Unboxing premium + message de remerciement post-livraison',
    copy_template: 'Merci [PRENOM] — votre [PRODUIT] est en route !'
  },
  {
    id: 'identity', name: 'Identité', category: 'emotion',
    description: 'Les gens achètent ce qui confirme qui ils sont (ou veulent être)',
    when_to_use: ['lifestyle', 'communaute', 'tribe_building'],
    application: 'Positionner le produit comme marqueur d\'identité',
    copy_template: 'Pour celles/ceux qui [IDENTITE_ASPIRATION]'
  },
  {
    id: 'jobs_to_be_done', name: 'Jobs to be Done', category: 'emotion',
    description: 'Les gens n\'achètent pas un produit, ils "louent" une solution',
    when_to_use: ['toujours', 'positionnement', 'messaging'],
    application: 'Focus sur le résultat, pas le produit',
    copy_template: 'Pas [PRODUIT] — [RESULTAT_DESIRE]'
  },
];

// ── Challenge → Models mapping ──────────────────────────
const CHALLENGE_MODELS: Record<string, string[]> = {
  'low_conversion':     ['hicks_law', 'activation_energy', 'bj_fogg', 'choice_paradox'],
  'price_objection':    ['anchoring', 'framing', 'mental_accounting', 'loss_aversion'],
  'low_trust':          ['authority', 'social_proof', 'reciprocity', 'halo_effect'],
  'no_urgency':         ['scarcity', 'fomo', 'zeigarnik', 'loss_aversion'],
  'cart_abandonment':   ['endowment', 'sunk_cost', 'zeigarnik', 'activation_energy'],
  'low_engagement':     ['storytelling', 'identity', 'contrast_effect', 'peak_end'],
  'high_competition':   ['jobs_to_be_done', 'identity', 'contrast_effect', 'social_proof'],
  'new_brand':          ['authority', 'social_proof', 'reciprocity', 'storytelling'],
  'premium_price':      ['anchoring', 'framing', 'halo_effect', 'identity'],
  'impulse_purchase':   ['scarcity', 'fomo', 'social_proof', 'activation_energy'],
};

// ── Product Category → Default Challenges ───────────────
const CATEGORY_CHALLENGES: Record<string, string[]> = {
  'beauty':     ['price_objection', 'low_trust', 'high_competition'],
  'health':     ['low_trust', 'price_objection', 'no_urgency'],
  'tech':       ['price_objection', 'low_conversion', 'cart_abandonment'],
  'gadget':     ['impulse_purchase', 'low_engagement', 'no_urgency'],
  'fashion':    ['high_competition', 'impulse_purchase', 'low_engagement'],
  'home':       ['price_objection', 'no_urgency', 'cart_abandonment'],
  'fitness':    ['low_trust', 'high_competition', 'no_urgency'],
  'pet':        ['impulse_purchase', 'low_engagement', 'low_trust'],
  'kids':       ['low_trust', 'price_objection', 'impulse_purchase'],
  'default':    ['low_conversion', 'price_objection', 'low_trust'],
};

// ══════════════════════════════════════════════════════════
export class PsycheAgent {
  readonly agentId = 'AGENT_PSYCHE';
  readonly name = 'PSYCHE — Psychologie & Persuasion Engine';

  constructor(private db: Pool, private redis: Redis) {}

  // ── Main: Analyze product and generate strategy ─────────
  async analyzeProduct(
    tenantId: string,
    productId: string,
    productData: {
      name: string;
      description: string;
      price: number;
      cost: number;
      category: string;
      images?: string[];
      niche?: string;
      target_avatar?: string;
    }
  ): Promise<PersuasionStrategy> {

    // Phase 1: Build customer avatar
    const avatar = this.buildAvatar(productData);

    // Phase 2: Identify job to be done + transformation
    const jobToBeDone = this.identifyJTBD(productData);
    const transformation = this.identifyTransformation(productData);

    // Phase 3: Detect challenges and select mental models
    const challenges = this.detectChallenges(productData, avatar);
    const selectedModels = this.selectModels(challenges);

    // Phase 4: Generate persuasion strategy
    const copyStrategy = this.generateCopyStrategy(productData, avatar, selectedModels, jobToBeDone);
    const creativeAngles = this.generateCreativeAngles(productData, avatar, selectedModels);
    const pricingStrategy = this.generatePricingStrategy(productData, selectedModels);
    const objectionMap = this.generateObjectionMap(productData, avatar, selectedModels);

    // Phase 5: Generate agent instructions
    const agentInstructions = this.generateAgentInstructions(
      productData, avatar, selectedModels, copyStrategy, creativeAngles, pricingStrategy, objectionMap
    );

    // Calculate persuasion score
    const persuasionScore = this.calculatePersuasionScore(selectedModels, avatar, productData);

    // Ethical check
    const ethicalCheck = this.ethicalCheck(selectedModels, copyStrategy);

    const strategy: PersuasionStrategy = {
      product_id: productId,
      product_name: productData.name,
      avatar,
      job_to_be_done: jobToBeDone,
      transformation,
      selected_models: selectedModels,
      copy_strategy: copyStrategy,
      creative_angles: creativeAngles,
      pricing_strategy: pricingStrategy,
      objection_map: objectionMap,
      agent_instructions: agentInstructions,
      persuasion_score: persuasionScore,
      ethical_check: ethicalCheck,
    };

    // Persist strategy
    await this.persistStrategy(tenantId, productId, strategy);

    return strategy;
  }

  // ── Phase 1: Build Customer Avatar ──────────────────────
  private buildAvatar(product: any): CustomerAvatar {
    const cat = product.category?.toLowerCase() || 'default';
    const price = product.price || 30;

    // Infer demographics from category + price
    const demographics = {
      age_range: price > 50 ? '25-45' : '18-35',
      gender: ['beauty', 'fashion', 'kids'].includes(cat) ? 'femme majorité' : 'mixte',
      location: 'France/Belgique/Suisse',
      income_level: price > 80 ? 'moyen-haut' : price > 30 ? 'moyen' : 'tout budget',
    };

    // Infer pain points
    const painPointsByCategory: Record<string, string[]> = {
      beauty: ['peau imparfaite', 'routine trop longue', 'produits qui ne marchent pas'],
      health: ['douleurs récurrentes', 'fatigue chronique', 'manque de résultats'],
      tech: ['outil qui plante', 'trop complexe', 'pas productif'],
      gadget: ['ennui', 'envie de nouveauté', 'besoin de praticité'],
      fitness: ['pas de résultats', 'motivation en baisse', 'manque de temps'],
      home: ['espace mal organisé', 'tâches ménagères pénibles', 'confort insuffisant'],
      default: ['insatisfaction actuelle', 'recherche d\'amélioration', 'frustration quotidienne'],
    };

    const desires: Record<string, string[]> = {
      beauty: ['peau parfaite', 'confiance en soi', 'routine simple et efficace'],
      health: ['énergie au quotidien', 'bien-être durable', 'solution naturelle'],
      tech: ['productivité maximale', 'simplification', 'impression professionnelle'],
      gadget: ['effet wow', 'praticité au quotidien', 'être le premier à avoir'],
      fitness: ['corps en forme', 'discipline facile', 'résultats visibles rapides'],
      default: ['amélioration de vie', 'gain de temps', 'satisfaction personnelle'],
    };

    return {
      demographics,
      psychographics: {
        values: ['qualité', 'rapport qualité-prix', 'authenticité'],
        interests: this.inferInterests(cat),
        pain_points: painPointsByCategory[cat] || painPointsByCategory.default,
        desires: desires[cat] || desires.default,
        language_patterns: this.inferLanguagePatterns(cat, product),
      },
      awareness_level: 'problem_aware', // Default for cold traffic
      objections: [],
      beliefs: this.inferBeliefs(cat),
    };
  }

  // ── Phase 2: Jobs to be Done ────────────────────────────
  private identifyJTBD(product: any): string {
    const name = (product.name || '').toLowerCase();
    const desc = (product.description || '').toLowerCase();
    const cat = product.category?.toLowerCase() || '';

    // Pattern matching for common JTBD
    if (name.includes('miroir') || name.includes('mirror')) return 'Avoir un maquillage parfait chaque jour';
    if (name.includes('posture')) return 'Ne plus avoir mal au dos et se tenir droit naturellement';
    if (name.includes('projector') || name.includes('galaxy')) return 'Transformer sa chambre en expérience immersive';
    if (name.includes('printer') || name.includes('imprimante')) return 'Capturer et partager des souvenirs instantanément';
    if (name.includes('massager') || name.includes('massage')) return 'Se détendre et soulager les tensions après une longue journée';
    if (name.includes('water bottle') || name.includes('gourde')) return 'Rester hydraté facilement sans y penser';
    if (cat === 'beauty') return `Avoir une peau/apparence parfaite sans effort`;
    if (cat === 'health') return `Retrouver bien-être et énergie naturellement`;
    if (cat === 'fitness') return `Atteindre ses objectifs physiques sans prise de tête`;
    return `Résoudre [${product.name}] simplement et efficacement`;
  }

  private identifyTransformation(product: any): { state_before: string; state_after: string } {
    const cat = product.category?.toLowerCase() || 'default';
    const transformations: Record<string, { state_before: string; state_after: string }> = {
      beauty:  { state_before: 'Frustrée par sa routine beauté', state_after: 'Confiante, rayonnante, routine simplifiée' },
      health:  { state_before: 'Fatigué(e), douleurs, mal-être', state_after: 'Énergique, soulagé(e), bien dans son corps' },
      tech:    { state_before: 'Perdu(e), improductif(ve), frustré(e)', state_after: 'Organisé(e), efficace, impressionnant(e)' },
      gadget:  { state_before: 'Ennuyé(e), curieux(se)', state_after: 'Épaté(e), amusé(e), "il me faut ça"' },
      fitness: { state_before: 'Démotivé(e), pas de résultats', state_after: 'En forme, discipliné(e), résultats visibles' },
      home:    { state_before: 'Espace chaotique, tâches pénibles', state_after: 'Intérieur organisé, vie simplifiée' },
      default: { state_before: 'Insatisfaction, frustration quotidienne', state_after: 'Satisfaction, problème résolu' },
    };
    return transformations[cat] || transformations.default;
  }

  // ── Phase 3: Detect Challenges & Select Models ──────────
  private detectChallenges(product: any, avatar: CustomerAvatar): string[] {
    const cat = product.category?.toLowerCase() || 'default';
    const price = product.price || 30;
    const challenges = new Set<string>(CATEGORY_CHALLENGES[cat] || CATEGORY_CHALLENGES.default);

    // Price-based challenges
    if (price > 60) challenges.add('premium_price');
    if (price < 20) challenges.add('impulse_purchase');

    // New brand always needs trust
    challenges.add('new_brand');

    return Array.from(challenges);
  }

  private selectModels(challenges: string[]): MentalModel[] {
    const selectedIds = new Set<string>();

    // For each challenge, pick the top 2 most relevant models
    for (const challenge of challenges) {
      const modelIds = CHALLENGE_MODELS[challenge] || [];
      modelIds.slice(0, 2).forEach(id => selectedIds.add(id));
    }

    // Always include jobs_to_be_done and storytelling
    selectedIds.add('jobs_to_be_done');
    selectedIds.add('storytelling');

    // Limit to 10 max
    const ids = Array.from(selectedIds).slice(0, 10);
    return ids
      .map(id => MENTAL_MODELS.find(m => m.id === id))
      .filter((m): m is MentalModel => !!m);
  }

  // ── Phase 4: Generate Strategy Components ───────────────

  private generateCopyStrategy(
    product: any, avatar: CustomerAvatar,
    models: MentalModel[], jtbd: string
  ): CopyStrategy {
    const name = product.name || 'Produit';
    const mainPain = avatar.psychographics.pain_points[0] || 'problème';
    const mainDesire = avatar.psychographics.desires[0] || 'solution';

    return {
      headline: `${mainDesire} — sans effort, dès aujourd'hui`,
      subheadline: `${name} : la solution que ${avatar.demographics.age_range} adoptent pour ${jtbd.toLowerCase()}`,
      problem_section: `Vous connaissez cette frustration ? ${mainPain}. Vous avez déjà essayé ${avatar.psychographics.pain_points[2] || 'des alternatives'}... sans résultat durable.`,
      solution_section: `${name} a été conçu pour une seule chose : vous faire passer de "${avatar.psychographics.pain_points[0]}" à "${avatar.psychographics.desires[0]}". En quelques jours, pas en quelques mois.`,
      cta_text: `Je veux ${mainDesire.toLowerCase()}`,
      cta_subtext: 'Livraison gratuite · Satisfait ou remboursé 30j',
      social_proof_angle: `Rejoint par 10,000+ personnes qui ont dit stop à "${mainPain}"`,
      guarantee_copy: 'Testez-le 30 jours. Si vous n\'êtes pas convaincu(e), on vous rembourse intégralement. Sans question.',
    };
  }

  private generateCreativeAngles(
    product: any, avatar: CustomerAvatar, models: MentalModel[]
  ): CreativeAngle[] {
    const angles: CreativeAngle[] = [
      {
        angle_id: 1, name: 'Problème/Solution', mental_model: 'loss_aversion',
        hook: `T'en as marre de ${avatar.psychographics.pain_points[0]} ?`,
        concept: 'Montrer le problème frustrant → révéler le produit comme solution',
        emotion_target: 'frustration → soulagement', platform: 'tiktok',
      },
      {
        angle_id: 2, name: 'Témoignage / UGC', mental_model: 'social_proof',
        hook: `J'ai essayé ${product.name} pendant 14 jours — voici le résultat`,
        concept: 'Client(e) réel(le) partage son expérience before/after',
        emotion_target: 'confiance → envie', platform: 'all',
      },
      {
        angle_id: 3, name: 'Comparaison / Contraste', mental_model: 'contrast_effect',
        hook: `Avec vs Sans ${product.name} — la différence est flagrante`,
        concept: 'Split screen montrant l\'avant/après ou avec/sans',
        emotion_target: 'surprise → conviction', platform: 'meta',
      },
      {
        angle_id: 4, name: 'Humour / Relatable', mental_model: 'identity',
        hook: `POV: Tu réalises que ${avatar.psychographics.pain_points[0]}`,
        concept: 'Scénario humoristique relatable → le produit comme solution inattendue',
        emotion_target: 'amusement → identification', platform: 'tiktok',
      },
      {
        angle_id: 5, name: 'Aspiration / Lifestyle', mental_model: 'storytelling',
        hook: `Comment j'ai transformé ma routine grâce à un seul produit`,
        concept: 'Montrer le lifestyle aspirationnel permis par le produit',
        emotion_target: 'aspiration → désir', platform: 'all',
      },
    ];
    return angles;
  }

  private generatePricingStrategy(product: any, models: MentalModel[]): PricingStrategy {
    const price = product.price || 30;
    const anchorMultiplier = price > 50 ? 2 : 1.8;
    const anchorPrice = Math.round(price * anchorMultiplier);
    const dailyCost = (price / 365).toFixed(2);
    const monthlyCost = (price / 12).toFixed(2);

    return {
      anchor_price: anchorPrice,
      selling_price: price,
      framing: price > 50 ? `${monthlyCost}€/mois d'utilisation` : `${dailyCost}€/jour`,
      comparison: this.getPriceComparison(price),
      guarantee: '30 jours satisfait ou remboursé — sans condition',
      urgency_element: `Dernières ${Math.floor(Math.random() * 20) + 5} unités à ce prix`,
    };
  }

  private generateObjectionMap(
    product: any, avatar: CustomerAvatar, models: MentalModel[]
  ): Objection[] {
    const price = product.price || 30;
    return [
      {
        objection: 'C\'est trop cher',
        severity: 'high',
        mental_model: 'anchoring',
        response: `Ancrage à ~~${Math.round(price * 2)}€~~ + cadrage "${(price/30).toFixed(2)}€/jour"`,
        copy_example: `Vous investissez ${(price/30).toFixed(2)}€/jour pour ${avatar.psychographics.desires[0]}`,
      },
      {
        objection: 'J\'ai déjà essayé, ça ne marche pas',
        severity: 'high',
        mental_model: 'contrast_effect',
        response: 'Montrer la différence technique vs alternatives',
        copy_example: `Contrairement aux autres, ${product.name} utilise [TECHNOLOGIE_UNIQUE]`,
      },
      {
        objection: 'Ça marche vraiment ?',
        severity: 'medium',
        mental_model: 'social_proof',
        response: 'Preuve sociale massive + témoignages vidéo',
        copy_example: `${Math.floor(Math.random() * 30 + 20)}K+ clients satisfaits · Note 4.8/5`,
      },
      {
        objection: 'Et si ça ne me plaît pas ?',
        severity: 'medium',
        mental_model: 'endowment',
        response: 'Garantie 30 jours + effet de dotation',
        copy_example: 'Gardez-le 30 jours. S\'il ne vous convainc pas, renvoyez-le — on vous rembourse.',
      },
      {
        objection: 'Je vais y réfléchir',
        severity: 'low',
        mental_model: 'scarcity',
        response: 'Rareté + coût de l\'inaction',
        copy_example: `Chaque jour sans ${product.name}, c'est un jour de plus avec ${avatar.psychographics.pain_points[0]}`,
      },
    ];
  }

  // ── Phase 5: Agent Instructions ─────────────────────────
  private generateAgentInstructions(
    product: any, avatar: CustomerAvatar, models: MentalModel[],
    copy: CopyStrategy, angles: CreativeAngle[],
    pricing: PricingStrategy, objections: Objection[]
  ): AgentInstructions {
    const modelNames = models.map(m => m.name).join(', ');
    return {
      store: `PSYCHE → STORE : Utiliser la copy strategy fournie. Headline: "${copy.headline}". ` +
        `CTA: "${copy.cta_text}". Prix ancré ~~${pricing.anchor_price}€~~ → ${pricing.selling_price}€. ` +
        `Garantie: "${copy.guarantee_copy}". Preuve sociale: "${copy.social_proof_angle}". ` +
        `Modèles appliqués: ${modelNames}.`,

      creative_factory: `PSYCHE → CREATIVE : Générer 30+ créatifs sur 5 angles psychologiques: ` +
        angles.map(a => `${a.angle_id}. ${a.name} (${a.mental_model}) — Hook: "${a.hook}"`).join('; ') +
        `. Émotion cible par angle définie. Priorité TikTok pour angles 1,4 et Meta pour angle 3.`,

      ads: `PSYCHE → ADS : Adresser les objections dans les ads. Top 3 objections: ` +
        objections.slice(0, 3).map(o => `"${o.objection}" → ${o.mental_model}: ${o.copy_example}`).join('; ') +
        `. Pricing: montrer ~~${pricing.anchor_price}€~~ → ${pricing.selling_price}€ dans les ads.`,

      traffic: `PSYCHE → TRAFFIC : Hooks pour les 5 comptes TikTok: ` +
        angles.filter(a => a.platform === 'tiktok' || a.platform === 'all')
          .map(a => `Compte ${a.name}: "${a.hook}"`).join('; ') +
        `. Langage du client: "${avatar.psychographics.language_patterns[0] || 'naturel et authentique'}".`,

      seo: `PSYCHE → SEO : Utiliser le langage client dans le contenu blog. Termes clés: ` +
        avatar.psychographics.pain_points.join(', ') +
        `. Intentions de recherche: "${avatar.psychographics.desires[0]}", ` +
        `"comment résoudre ${avatar.psychographics.pain_points[0]}". JTBD: "${product.jtbd || 'non défini'}".`,

      support: `PSYCHE → SUPPORT : Réponses FAQ basées sur les objections analysées. ` +
        objections.map(o => `Q: "${o.objection}" → R: "${o.copy_example}"`).join('; ') +
        `. Ton de marque: empathique, confiant, non-agressif.`,
    };
  }

  // ── Scoring ─────────────────────────────────────────────
  private calculatePersuasionScore(
    models: MentalModel[], avatar: CustomerAvatar, product: any
  ): number {
    let score = 50; // Base score

    // More models = better coverage (+2 per model, max 20)
    score += Math.min(models.length * 2, 20);

    // Category coverage (at least 3 categories covered)
    const categories = new Set(models.map(m => m.category));
    score += Math.min(categories.size * 4, 24);

    // Price vs perceived value alignment
    const price = product.price || 30;
    const margin = product.cost ? ((price - product.cost) / price) * 100 : 50;
    if (margin > 60) score += 6;

    // Cap at 100
    return Math.min(Math.round(score), 100);
  }

  // ── Ethical Check ───────────────────────────────────────
  private ethicalCheck(models: MentalModel[], copy: CopyStrategy): boolean {
    // Ensure we don't use dark patterns
    const darkPatternKeywords = ['dernière chance', 'ferme dans', 'plus jamais', 'regretterez'];
    const allCopy = Object.values(copy).join(' ').toLowerCase();
    const hasDarkPattern = darkPatternKeywords.some(kw => allCopy.includes(kw));
    return !hasDarkPattern;
  }

  // ── Persistence ─────────────────────────────────────────
  private async persistStrategy(tenantId: string, productId: string, strategy: PersuasionStrategy) {
    try {
      await this.db.query(`
        INSERT INTO agents.agent_memory (agent_id, tenant_id, memory_type, content)
        VALUES ('AGENT_PSYCHE', $1, 'persuasion_strategy', $2)
      `, [tenantId, JSON.stringify({
        product_id: productId,
        product_name: strategy.product_name,
        persuasion_score: strategy.persuasion_score,
        ethical_check: strategy.ethical_check,
        models_count: strategy.selected_models.length,
        models_used: strategy.selected_models.map(m => m.name),
        avatar_summary: {
          awareness: strategy.avatar.awareness_level,
          top_pain: strategy.avatar.psychographics.pain_points[0],
          top_desire: strategy.avatar.psychographics.desires[0],
        },
        job_to_be_done: strategy.job_to_be_done,
        transformation: strategy.transformation,
        copy_strategy: strategy.copy_strategy,
        creative_angles: strategy.creative_angles.length,
        objections_mapped: strategy.objection_map.length,
        agent_instructions: strategy.agent_instructions,
        created_at: new Date().toISOString(),
      })]);

      // Cache in Redis for fast access by other agents
      try {
        await this.redis.setex(
          `psyche:strategy:${tenantId}:${productId}`,
          86400 * 7, // 7 days
          JSON.stringify(strategy)
        );
      } catch { /* Redis optional */ }

    } catch (err) {
      console.error(`[PSYCHE] Failed to persist strategy for ${productId}:`, err);
    }
  }

  // ── Get existing strategy (for other agents) ────────────
  async getStrategy(tenantId: string, productId: string): Promise<PersuasionStrategy | null> {
    // Try Redis first
    try {
      const cached = await this.redis.get(`psyche:strategy:${tenantId}:${productId}`);
      if (cached) return JSON.parse(cached);
    } catch { /* Redis optional */ }

    // Fallback to DB
    try {
      const { rows } = await this.db.query(`
        SELECT content FROM agents.agent_memory
        WHERE agent_id = 'AGENT_PSYCHE' AND tenant_id = $1
          AND memory_type = 'persuasion_strategy'
          AND content->>'product_id' = $2
        ORDER BY created_at DESC LIMIT 1
      `, [tenantId, productId]);
      return rows[0]?.content ?? null;
    } catch {
      return null;
    }
  }

  // ── Helpers ─────────────────────────────────────────────
  private inferInterests(category: string): string[] {
    const map: Record<string, string[]> = {
      beauty: ['beauté', 'skincare', 'maquillage', 'self-care', 'wellness'],
      health: ['santé', 'bien-être', 'médecine douce', 'nutrition'],
      tech: ['technologie', 'productivité', 'gadgets', 'innovation'],
      gadget: ['gadgets', 'tendances', 'tech', 'fun'],
      fitness: ['sport', 'musculation', 'yoga', 'nutrition sportive'],
      home: ['décoration', 'organisation', 'minimalisme', 'DIY'],
      fashion: ['mode', 'tendances', 'style', 'lookbook'],
      default: ['lifestyle', 'tendances', 'qualité de vie'],
    };
    return map[category] || map.default;
  }

  private inferLanguagePatterns(category: string, product: any): string[] {
    const map: Record<string, string[]> = {
      beauty: ['Je veux une peau parfaite', 'Ma routine est trop longue', 'Rien ne marche sur moi'],
      health: ['J\'ai mal depuis des mois', 'Je suis fatigué(e) en permanence', 'Je veux une solution naturelle'],
      tech: ['C\'est trop compliqué', 'J\'ai besoin de quelque chose de simple', 'Je perds du temps'],
      gadget: ['C\'est trop cool !', 'J\'en ai besoin', 'Cadeau parfait'],
      fitness: ['Je n\'arrive pas à être régulier(e)', 'Je veux des résultats rapides', 'Comment font les autres ?'],
      default: ['J\'en ai marre de ça', 'Il doit y avoir mieux', 'C\'est exactement ce qu\'il me faut'],
    };
    return map[category] || map.default;
  }

  private inferBeliefs(category: string): string[] {
    const map: Record<string, string[]> = {
      beauty: ['Les produits chers marchent mieux', 'Les influenceuses ont la peau parfaite naturellement'],
      health: ['Le naturel est meilleur', 'Si mon médecin ne le recommande pas, c\'est suspect'],
      tech: ['Apple = premium', 'Si c\'est compliqué, c\'est puissant'],
      default: ['Vous en avez pour votre argent', 'Les avis clients ne mentent pas'],
    };
    return map[category] || map.default;
  }

  private getPriceComparison(price: number): string {
    if (price < 15) return 'Moins cher qu\'un déjeuner au restaurant';
    if (price < 30) return 'Le prix de 2 cafés par semaine pendant un mois';
    if (price < 50) return 'Moins cher qu\'une séance chez l\'esthéticienne';
    if (price < 80) return 'Le prix d\'un dîner pour deux';
    if (price < 150) return 'Moins cher qu\'un week-end hôtel';
    return 'Un investissement qui se rentabilise en quelques utilisations';
  }
}
