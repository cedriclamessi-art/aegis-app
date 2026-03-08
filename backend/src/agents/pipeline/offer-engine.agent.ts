/**
 * AGENT_OFFER_ENGINE
 * ==================
 * Construit l'offre commerciale autour du produit validé.
 * 3 packs de prix · bonus · garantie · promesse principale.
 *
 * Basé sur la doctrine Hormozi (Offer Optimization) :
 *   - Dream Outcome × Perceived Likelihood × Time to Value / Effort & Sacrifice
 * Intégré avec AGENT_MONEY_MODEL pour les séquences upsell.
 */
import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import logger from '../../utils/logger';

interface OfferInput {
  productId:      string;
  costPrice:      number;      // coût produit
  shippingCost:   number;      // coût livraison
  targetMarginPct: number;     // marge cible % (ex: 35)
  niche?:         string;
  competitors?:   Array<{ name: string; price: number }>;
}

interface OfferPack {
  id:             string;      // 'starter' | 'bestseller' | 'premium'
  name:           string;
  price:          number;
  items:          string[];    // ce qui est inclus
  bonus:          string[];
  guarantee:      string;
  badge?:         string;      // 'BEST VALUE', '⭐ BEST SELLER'
  contributionMargin: number;  // €
  contributionPct:    number;  // %
}

interface OfferOutput {
  packs:          OfferPack[];
  mainPromise:    string;
  mainAngle:      string;
  guarantee:      string;
  urgencyTrigger: string;
}

export class OfferEngineAgent extends AgentBase {
  readonly agentId = 'AGENT_OFFER_ENGINE';
  readonly taskTypes = [
    'offer.build_packs',     // Construit les 3 packs
    'offer.optimize_price',  // Optimise les prix selon données réelles
    'offer.generate_upsell', // Séquences upsell / cross-sell
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'offer.build_packs':      return this.buildPacks(task);
      case 'offer.optimize_price':   return this.optimizePrice(task);
      case 'offer.generate_upsell':  return this.generateUpsell(task);
      default: return { success: false, error: `Unknown: ${task.taskType}` };
    }
  }

  private async buildPacks(task: AgentTask): Promise<AgentResult> {
    const input = task.input as OfferInput;

    // Récupère données produit
    const pr = await db.query<{ name: string; description: string; price: number }>(
      `SELECT name, description, price FROM store.products WHERE id = $1 AND tenant_id = $2`,
      [input.productId, task.tenantId]
    );
    if (!pr.rows[0]) return { success: false, error: 'Produit introuvable' };

    const { name, price: supplierPrice } = pr.rows[0];
    const cost = input.costPrice + input.shippingCost + supplierPrice * 0.03; // 3% frais paiement

    // Prix cibles selon marge (prix = coût / (1 - marge%))
    const targetMult = 1 / (1 - input.targetMarginPct / 100);
    const basePrice  = Math.ceil(cost * targetMult / 5) * 5; // arrondi à 5€

    const packs: OfferPack[] = [
      {
        id: 'starter',
        name: 'Starter',
        price: basePrice,
        items: [`1× ${name}`, 'Guide d\'utilisation PDF'],
        bonus: ['Livraison rapide'],
        guarantee: 'Satisfait ou remboursé 30 jours',
        contributionMargin: basePrice - cost,
        contributionPct: Math.round((basePrice - cost) / basePrice * 100),
      },
      {
        id: 'bestseller',
        name: 'Pack 2',
        price: Math.round(basePrice * 1.8),
        items: [`2× ${name}`, 'Guide premium PDF', 'Accès vidéos tutoriels'],
        bonus: ['Livraison express offerte', 'Support prioritaire 30j'],
        guarantee: 'Satisfait ou remboursé 60 jours',
        badge: '⭐ BEST SELLER',
        contributionMargin: Math.round(basePrice * 1.8) - cost * 2,
        contributionPct: Math.round((Math.round(basePrice * 1.8) - cost * 2) / Math.round(basePrice * 1.8) * 100),
      },
      {
        id: 'premium',
        name: 'Pack Premium',
        price: Math.round(basePrice * 3.2),
        items: [`4× ${name}`, 'Guide + vidéos', 'Boîte cadeau incluse'],
        bonus: ['Livraison express', 'Support VIP 90j', 'Programme fidélité'],
        guarantee: 'Satisfait ou remboursé 90 jours + cadeau conservé',
        badge: '💎 MEILLEURE VALEUR',
        contributionMargin: Math.round(basePrice * 3.2) - cost * 4,
        contributionPct: Math.round((Math.round(basePrice * 3.2) - cost * 4) / Math.round(basePrice * 3.2) * 100),
      },
    ];

    const offer: OfferOutput = {
      packs,
      mainPromise: `Obtenez des résultats visibles dès la première utilisation — ou remboursé.`,
      mainAngle:   input.niche ? `Conçu pour ${input.niche}` : 'La solution que vous attendiez',
      guarantee:   '60 jours satisfait ou remboursé sans question',
      urgencyTrigger: 'Offre valable uniquement pendant les stocks actuels',
    };

    // Persiste l'offre
    await db.query(
      `INSERT INTO store.offers (tenant_id, product_id, offer_data, status)
       VALUES ($1, $2, $3, 'draft')
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET offer_data = EXCLUDED.offer_data`,
      [task.tenantId, input.productId, JSON.stringify(offer)]
    );

    // Notifie AGENT_LANDING_BUILDER
    await db.query(
      `SELECT agents.send_message($1,'AGENT_LANDING_BUILDER','build.landing_page',$2,$3,4)`,
      [this.agentId, JSON.stringify({ productId: input.productId }), task.tenantId]
    );

    logger.info(`[OFFER_ENGINE] ${packs.length} packs générés pour ${name}`);

    return {
      success: true,
      output: { offer, bestSellerPack: packs[1] },
    };
  }

  private async optimizePrice(task: AgentTask): Promise<AgentResult> {
    const { productId, currentConversionRate, currentRoas } = task.input as {
      productId: string; currentConversionRate: number; currentRoas: number;
    };

    // Règle simple : si CVR < 1.5% → baisser pack starter de 10%
    // Si ROAS > 3 et CVR > 3% → monter premium de 15%
    const adjustments: string[] = [];

    if (currentConversionRate < 1.5) {
      adjustments.push('Réduire prix Starter de 10% — CVR trop faible');
    }
    if (currentRoas > 3 && currentConversionRate > 3) {
      adjustments.push('Augmenter Pack Premium de 15% — marge solide + forte conversion');
    }

    return { success: true, output: { adjustments } };
  }

  private async generateUpsell(task: AgentTask): Promise<AgentResult> {
    const { productId } = task.input as { productId: string };

    // Notifie AGENT_MONEY_MODEL pour séquences Hormozi
    await db.query(
      `SELECT agents.send_message($1,'AGENT_MONEY_MODEL','sequence.build_upsell',$2,$3,5)`,
      [this.agentId, JSON.stringify({ productId }), task.tenantId]
    );

    return { success: true, output: { dispatched: 'AGENT_MONEY_MODEL' } };
  }
}
