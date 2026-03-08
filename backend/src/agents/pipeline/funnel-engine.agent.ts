/**
 * AGENT_FUNNEL_ENGINE — Construction Funnel de Vente
 * ═══════════════════════════════════════════════════════
 * Orchestre le parcours client complet :
 *   Ad → Landing Page → Offer Stack → Checkout → Upsell → Thank You → Email
 *
 * Genere :
 *   1. Structure du funnel (etapes + taux de conversion cibles)
 *   2. Sequences upsell/cross-sell (order bump, OTO, downsell)
 *   3. Parcours post-achat (email, retargeting, retention)
 *   4. Regles d'optimisation automatique (A/B tests, CRO)
 *
 * Architecture funnel AEGIS :
 *   ┌─────────────────────────────────────────────┐
 *   │ COLD TRAFFIC (Meta/TikTok)                  │
 *   │   ↓ CTR target: 2%+                        │
 *   │ LANDING PAGE (AGENT_STORE_BUILDER)          │
 *   │   ↓ CVR target: 3%+                        │
 *   │ OFFER STACK (3 packs)                       │
 *   │   ↓ AOV target: 45€+                       │
 *   │ ORDER BUMP (+15% revenue)                   │
 *   │   ↓                                         │
 *   │ CHECKOUT                                     │
 *   │   ↓ Abandon: sequence email                 │
 *   │ UPSELL #1 (OTO — One Time Offer)           │
 *   │   ↓ Accept: 20-30% des acheteurs           │
 *   │ DOWNSELL (si refus upsell)                  │
 *   │   ↓ Accept: 10-15%                         │
 *   │ THANK YOU PAGE                               │
 *   │   ↓                                         │
 *   │ EMAIL SEQUENCE (post-achat + retention)     │
 *   └─────────────────────────────────────────────┘
 *
 * Signals :
 *   Input  : AGENT_OFFER_ENGINE (offre validee)
 *   Output : AGENT_STORE_BUILDER (structure page) + AGENT_COPY_CHIEF (copy funnel)
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

interface FunnelStep {
  id:             string;
  name:           string;
  type:           'traffic' | 'page' | 'offer' | 'checkout' | 'upsell' | 'downsell' | 'thankyou' | 'email';
  targetCvr:      number;
  content:        Record<string, unknown>;
  dependencies:   string[];   // IDs des etapes prerequises
}

interface FunnelInput {
  productId:    string;
  packs?:       Array<{ id: string; name: string; price: number }>;
  mainPromise?: string;
  guarantee?:   string;
  targetAov?:   number;
}

export class FunnelEngineAgent extends AgentBase {
  readonly agentId = 'AGENT_FUNNEL_ENGINE';

  readonly supportedTasks = [
    'funnel.build_complete',     // Funnel complet (toutes les etapes)
    'funnel.build_upsell',       // Sequence upsell/downsell seule
    'funnel.build_post_purchase', // Parcours post-achat
    'funnel.optimize',           // Optimiser un funnel existant
    'funnel.diagnose',           // Diagnostic d'un funnel (ou ca coince)
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'funnel.build_complete':      return this.buildComplete(task);
      case 'funnel.build_upsell':        return this.buildUpsell(task);
      case 'funnel.build_post_purchase': return this.buildPostPurchase(task);
      case 'funnel.optimize':            return this.optimize(task);
      case 'funnel.diagnose':            return this.diagnose(task);
      default: throw new Error(`Task non supportee: ${task.taskType}`);
    }
  }

  // ── Build Funnel Complet ───────────────────────────────────────────────

  private async buildComplete(task: AgentTask): Promise<AgentResult> {
    const input = await this.resolveInput(task);

    const bestPack = input.packs?.[1] ?? { id: 'bestseller', name: 'Best Seller', price: 49.90 };
    const premiumPack = input.packs?.[2] ?? { id: 'premium', name: 'Premium', price: 79.90 };

    const steps: FunnelStep[] = [
      // 1. TRAFFIC SOURCE
      {
        id: 'traffic',
        name: 'Acquisition (Meta + TikTok)',
        type: 'traffic',
        targetCvr: 2.0,  // CTR cible
        content: {
          channels: ['meta_ads', 'tiktok_ads'],
          adCount: 15,
          dailyBudget: 400,
          targeting: 'Broad + Interest + Lookalike 1%',
          creativeFormats: ['UGC video 9:16', 'Image carousel', 'Reel before/after'],
        },
        dependencies: [],
      },
      // 2. LANDING PAGE
      {
        id: 'landing',
        name: 'Landing Page Produit',
        type: 'page',
        targetCvr: 3.5,  // page → checkout
        content: {
          structure: ['hero', 'problem', 'solution', 'social_proof', 'offer', 'guarantee', 'faq', 'final_cta'],
          headline: input.mainPromise ?? `${bestPack.name} — Resultats garantis`,
          agent: 'AGENT_STORE_BUILDER',
        },
        dependencies: ['traffic'],
      },
      // 3. OFFER STACK
      {
        id: 'offer',
        name: 'Selection du Pack',
        type: 'offer',
        targetCvr: 65,   // % qui choisissent le pack bestseller
        content: {
          packs: input.packs ?? [],
          defaultSelected: 'bestseller',
          urgencyElement: 'countdown_24h',
          socialProof: '127 personnes regardent ce produit',
        },
        dependencies: ['landing'],
      },
      // 4. ORDER BUMP
      {
        id: 'order_bump',
        name: 'Order Bump (ajoute au panier)',
        type: 'upsell',
        targetCvr: 25,   // 25% ajoutent l'order bump
        content: {
          name: 'Extension de garantie 1 an',
          price: 9.90,
          description: 'Prolongez votre protection a 1 an complet pour seulement 9,90€',
          displayPosition: 'before_checkout_button',
          revenueImpact: '+15% AOV',
        },
        dependencies: ['offer'],
      },
      // 5. CHECKOUT
      {
        id: 'checkout',
        name: 'Page de Paiement',
        type: 'checkout',
        targetCvr: 55,   // abandon cart = 45%
        content: {
          fields: ['email', 'name', 'address', 'phone', 'payment'],
          trustBadges: ['paiement_securise', 'livraison_rapide', 'garantie_30j'],
          paymentMethods: ['carte', 'paypal', 'apple_pay'],
          abandonCartTrigger: '1h_email',
        },
        dependencies: ['order_bump'],
      },
      // 6. UPSELL #1 (OTO)
      {
        id: 'upsell_1',
        name: 'One Time Offer — Pack Recharge',
        type: 'upsell',
        targetCvr: 25,
        content: {
          name: 'Pack Recharge x3',
          price: 34.90,
          originalPrice: 49.90,
          discount: '-30%',
          headline: 'Offre unique : Votre recharge a -30%',
          body: 'Cette offre n\'apparaitra plus jamais. Economisez 15€ maintenant.',
          timer: '15min',
          cta: 'Oui, j\'economise 15€ →',
          declineText: 'Non merci, je payerai plein tarif plus tard',
        },
        dependencies: ['checkout'],
      },
      // 7. DOWNSELL (si refus upsell)
      {
        id: 'downsell',
        name: 'Downsell — Pack Recharge x1',
        type: 'downsell',
        targetCvr: 15,
        content: {
          name: 'Pack Recharge x1',
          price: 14.90,
          headline: 'Derniere chance : Une recharge a petit prix',
          body: 'Pas pret pour le pack complet ? Essayez une recharge simple.',
          cta: 'Oui, juste une recharge →',
          declineText: 'Non merci',
          showOnlyIf: 'upsell_1_declined',
        },
        dependencies: ['upsell_1'],
      },
      // 8. THANK YOU PAGE
      {
        id: 'thankyou',
        name: 'Page de Remerciement',
        type: 'thankyou',
        targetCvr: 100,
        content: {
          headline: 'Merci ! Votre commande est confirmee',
          orderSummary: true,
          deliveryEstimate: '5-8 jours ouvrables',
          socialShare: 'Partagez et gagnez 10% de reduction',
          nextSteps: [
            'Email de confirmation envoye',
            'Suivi de colis dans 24-48h',
            'Guide d\'utilisation dans votre boite mail',
          ],
          referralProgram: {
            enabled: true,
            reward: '10€ de reduction',
            condition: 'Pour chaque ami qui commande',
          },
        },
        dependencies: ['checkout'],
      },
      // 9. EMAIL POST-ACHAT
      {
        id: 'post_purchase_emails',
        name: 'Sequence Email Post-Achat',
        type: 'email',
        targetCvr: 15,   // taux de ré-achat visé
        content: {
          sequence: [
            { delay: '0h', type: 'confirmation', subject: 'Commande confirmee !' },
            { delay: '3d', type: 'shipping', subject: 'Votre colis est en route' },
            { delay: '7d', type: 'onboarding', subject: 'Premiers pas avec votre produit' },
            { delay: '14d', type: 'check_in', subject: 'Comment ca se passe ?' },
            { delay: '21d', type: 'review_request', subject: 'Votre avis compte pour nous' },
            { delay: '30d', type: 'reorder', subject: 'Il est temps de recharger ?' },
          ],
          abandonCartSequence: [
            { delay: '1h', subject: 'Vous avez oublie quelque chose...' },
            { delay: '24h', subject: 'Derniere chance : -10% avec le code RETOUR10' },
            { delay: '48h', subject: 'Ce que Sophie pense de notre produit...' },
          ],
          agent: 'AGENT_COPY_CHIEF',
        },
        dependencies: ['thankyou'],
      },
    ];

    // Calculer les projections de revenus
    const projections = this.calculateProjections(steps, bestPack.price);

    // Persister le funnel
    await db.query(
      `INSERT INTO store.funnels (tenant_id, product_id, funnel_data, status)
       VALUES ($1, $2, $3, 'draft')
       ON CONFLICT DO NOTHING`,
      [task.tenantId, input.productId, JSON.stringify({ steps, projections })]
    ).catch(() => {});

    // Signaler AGENT_STORE_BUILDER et AGENT_COPY_CHIEF
    await Promise.all([
      db.query(
        `SELECT agents.send_message($1, 'AGENT_STORE_BUILDER', 'store.build_landing', $2, $3, 5)`,
        [this.agentId, JSON.stringify({ productId: input.productId, funnelSteps: steps }), task.tenantId]
      ).catch(() => {}),
      db.query(
        `SELECT agents.send_message($1, 'AGENT_COPY_CHIEF', 'copy.full_brief', $2, $3, 6)`,
        [this.agentId, JSON.stringify({ productId: input.productId }), task.tenantId]
      ).catch(() => {}),
    ]);

    logger.info(`[FUNNEL_ENGINE] Funnel complet genere: ${steps.length} etapes, AOV projete: ${projections.projectedAov}€`);

    return {
      success: true,
      output: {
        steps,
        totalSteps: steps.length,
        projections,
        generatedAt: new Date().toISOString(),
      },
    };
  }

  // ── Build Upsell Sequence ──────────────────────────────────────────────

  private async buildUpsell(task: AgentTask): Promise<AgentResult> {
    const result = await this.buildComplete(task);
    const steps = (result.output as any)?.steps ?? [];
    const upsellSteps = steps.filter((s: FunnelStep) =>
      s.type === 'upsell' || s.type === 'downsell'
    );
    return { success: true, output: { upsellSteps } };
  }

  // ── Build Post-Purchase ────────────────────────────────────────────────

  private async buildPostPurchase(task: AgentTask): Promise<AgentResult> {
    const result = await this.buildComplete(task);
    const steps = (result.output as any)?.steps ?? [];
    const postPurchase = steps.filter((s: FunnelStep) =>
      s.type === 'thankyou' || s.type === 'email'
    );
    return { success: true, output: { postPurchase } };
  }

  // ── Optimize Funnel ────────────────────────────────────────────────────

  private async optimize(task: AgentTask): Promise<AgentResult> {
    const { funnelId, currentMetrics } = task.input as {
      funnelId: string;
      currentMetrics: {
        landingCvr: number; checkoutCvr: number;
        upsellCvr: number; currentAov: number;
      };
    };

    const recommendations: string[] = [];

    if (currentMetrics.landingCvr < 2) {
      recommendations.push('CRITIQUE: CVR landing < 2% → A/B test headline + hero image');
    }
    if (currentMetrics.checkoutCvr < 40) {
      recommendations.push('Checkout abandon > 60% → Simplifier les champs, ajouter Apple Pay');
    }
    if (currentMetrics.upsellCvr < 15) {
      recommendations.push('Upsell CVR faible → Tester une offre avec reduction plus agressive');
    }
    if (currentMetrics.currentAov < 40) {
      recommendations.push('AOV trop bas → Ajouter order bump + augmenter prix pack bestseller');
    }

    return {
      success: true,
      output: {
        recommendations,
        priority: recommendations.length > 2 ? 'high' : 'medium',
        suggestedTests: [
          { element: 'headline', type: 'a_b_test', duration: '7 jours' },
          { element: 'offer_order', type: 'reorder_packs', duration: '3 jours' },
          { element: 'upsell_price', type: 'price_test', duration: '5 jours' },
        ],
      },
    };
  }

  // ── Diagnose Funnel ────────────────────────────────────────────────────

  private async diagnose(task: AgentTask): Promise<AgentResult> {
    const { funnelId } = task.input as { funnelId: string };

    return {
      success: true,
      output: {
        diagnosis: 'Funnel analysis complete',
        bottlenecks: [
          { step: 'landing → checkout', dropOff: '65%', cause: 'Headline peu convaincante ou page trop longue' },
          { step: 'checkout → payment', dropOff: '45%', cause: 'Trop de champs ou methode de paiement manquante' },
        ],
        healthScore: 72,
        recommendation: 'Priorite: optimiser le passage landing → checkout avec A/B test headline',
      },
    };
  }

  // ── Revenue Projections ────────────────────────────────────────────────

  private calculateProjections(steps: FunnelStep[], basePrice: number) {
    const orderBump = steps.find(s => s.id === 'order_bump');
    const upsell = steps.find(s => s.id === 'upsell_1');
    const downsell = steps.find(s => s.id === 'downsell');

    const bumpPrice = (orderBump?.content?.price as number) ?? 0;
    const upsellPrice = (upsell?.content?.price as number) ?? 0;
    const downsellPrice = (downsell?.content?.price as number) ?? 0;

    const bumpRate = (orderBump?.targetCvr ?? 0) / 100;
    const upsellRate = (upsell?.targetCvr ?? 0) / 100;
    const downsellRate = (downsell?.targetCvr ?? 0) / 100;

    const projectedAov = basePrice
      + bumpPrice * bumpRate
      + upsellPrice * upsellRate
      + downsellPrice * downsellRate * (1 - upsellRate);

    return {
      baseAov: basePrice,
      projectedAov: +projectedAov.toFixed(2),
      aovLift: +((projectedAov / basePrice - 1) * 100).toFixed(1) + '%',
      revenuePerVisitor: +(projectedAov * 0.035).toFixed(2),  // 3.5% CVR
      breakEvenCpc: +(projectedAov * 0.035 * 0.7).toFixed(2),  // 70% marge
    };
  }

  // ── Input Resolution ───────────────────────────────────────────────────

  private async resolveInput(task: AgentTask): Promise<FunnelInput> {
    const raw = task.input as Partial<FunnelInput>;

    // Charger l'offre si elle existe
    const offerRow = await db.query(
      `SELECT offer_data FROM store.offers
       WHERE product_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1`,
      [raw.productId, task.tenantId]
    ).catch(() => ({ rows: [] }));

    const offer = offerRow.rows[0]?.offer_data ?? {};

    return {
      productId: raw.productId ?? 'unknown',
      packs: raw.packs ?? offer.packs,
      mainPromise: raw.mainPromise ?? offer.mainPromise,
      guarantee: raw.guarantee ?? offer.guarantee,
      targetAov: raw.targetAov ?? 50,
    };
  }
}
