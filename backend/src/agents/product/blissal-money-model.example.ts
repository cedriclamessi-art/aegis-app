/**
 * BLISSAL — Money Model Complet (Exemple pré-configuré)
 * ══════════════════════════════════════════════════════
 *
 * Séquence d'offres complète pour une marque DTC d'exfoliation
 * (serviette exfoliante), marché français.
 *
 * Math Hormozi :
 *   CAC Meta estimé    : 20€
 *   COGS               : 7€ (serviette + packaging)
 *   Total coûts        : 27€ / client acquis
 *
 *   Stage 1 Attraction : 29€ × 100% = 29€ → CAC couvert ✓
 *   Stage 2 Upsell     : 49€ × 45%  = 22€
 *   Stage 3 Downsell   : 14€ × 30%  = 4.2€
 *   Stage 4 Continuity : 19€ × 25%  = 4.75€
 *   ─────────────────────────────────────────
 *   Total revenue/client : 29 + 22 + 4.2 + 4.75 = 60€
 *   Profit net/client    : 60 - 27 = 33€
 *   Ratio Hormozi        : 60/27 = 2.22x ✓ (seuil > 1.5x)
 *
 * Pour importer ce modèle dans AEGIS :
 *   await agentBus.dispatch({
 *     taskType: 'money_model.import_preset',
 *     tenantId: YOUR_TENANT_ID,
 *     input: { preset: 'blissal' }
 *   });
 */

export const BLISSAL_MONEY_MODEL = {
  name: 'Money Model Blissal — Marché FR',
  product: 'Serviette exfoliante premium',
  targetCac: 20,
  targetCogs: 7,

  steps: [
    // ══════════════════════════════════════════════════════
    // ÉTAPE 1 — ATTRACTION : Win Your Money Back
    // Objectif : convertir le cold traffic, couvrir le CAC
    // ══════════════════════════════════════════════════════
    {
      stepOrder:         1,
      stepType:          'attraction',
      offerType:         'WIN_MONEY_BACK',
      title:             'Challenge Exfoliation 30 Jours — Résultat ou Remboursé',
      hook:              'Tu paries sur toi-même. À ce tarif, tu ne peux pas perdre.',
      priceMain:         29.00,
      priceAnchor:       null,
      priceFallback:     null,
      triggerCondition:  'First ad impression / landing page',
      psychologyLever:   'COMMITMENT',

      salesScript: `Pendant 30 jours, utilise notre serviette exfoliante 3 fois par semaine.
Si tu ne vois pas une différence visible sur ta peau — on te rembourse intégralement, sans question.
Prends une photo avant. On se revoit dans 30 jours. Paye uniquement si tu es convaincu.`,

      objectionHandlers: [
        {
          objection: "C'est trop cher pour tester.",
          response:  "Si ça marche, tu récupères rien — juste une peau transformée. Si ça marche pas, tu récupères tout. Le seul risque c'est 30 jours de ta routine.",
        },
        {
          objection: "J'ai déjà essayé des produits exfoliants sans résultat.",
          response:  "La plupart des gommages agissent en surface. Notre serviette atteint les couches mortes plus profondes — c'est pour ça qu'on peut faire cette garantie.",
        },
      ],

      ifYesGoTo: 2,  // → Upsell Anchor
      ifNoGoTo:  3,  // → Downsell Payment Plan

      // Briefs créatifs générés
      creativeBriefs: {
        meta_ad: {
          format:  '4:5 / 9:16 story',
          hook:    '30 jours. Résultat visible. Ou remboursé.',
          angle:   'Zéro risque — tu paries sur ton résultat',
          cta:     'Essayer maintenant →',
          tone:    'social_proof',
          copy:    `J'ai essayé 12 gommages. Aucun n'avait une garantie comme ça.
→ Challenge 30 jours
→ Photo avant/après
→ Remboursement si aucune différence
Sinon t'as juste une peau transformée.`,
        },
        tiktok_video: {
          format:   '9:16 / 30 secondes',
          hook_0_3: "POV : tu trouves un produit qui te rembourse si ça marche pas 👀",
          structure: [
            '0-3s : hook "Ils remboursent si ça marche pas??"',
            '3-15s : démonstration serviette + peau avant/après',
            '15-25s : explication du challenge et de la garantie',
            '25-30s : CTA + urgency (48h pour ce prix)',
          ],
          cta: 'Lien en bio — challenge 30j à 29€',
        },
      },
    },

    // ══════════════════════════════════════════════════════
    // ÉTAPE 2 — UPSELL : Anchor Upsell → Classic Upsell
    // Objectif : faire le vrai profit, 45% take rate cible
    // ══════════════════════════════════════════════════════
    {
      stepOrder:         2,
      stepType:          'upsell',
      offerType:         'ANCHOR_UPSELL',
      title:             'Kit Complet Exfoliation — Résultats 3x Plus Rapides',
      hook:              'Tu ne vas pas exfolier sans le gel — c\'est comme une brosse sans dentifrice.',
      priceMain:         49.00,    // Bundle serviette + gel + guide
      priceAnchor:       129.00,   // Kit premium (anchor psychologique)
      priceFallback:     null,
      triggerCondition:  'Immediately after YES to step 1',
      psychologyLever:   'ANCHORING',

      salesScript: `Notre kit complet inclut la serviette, le gel exfoliant BHA/AHA, et le guide 30 jours — 129€.
Si tu veux juste l'essentiel pour doubler tes résultats : serviette + gel à 49€.
La serviette seule exfolie. Le gel amplifie. Ensemble, c'est 3x plus rapide.
Ton challenge démarre mieux avec les deux — tu veux qu'on l'ajoute?`,

      objectionHandlers: [
        {
          objection: "J'ai déjà commandé, je veux pas en rajouter.",
          response:  "Je comprends. Mais dans 2 semaines quand tu voudras accélérer les résultats, le gel sera à prix normal. Là t'as -38% parce que t'es déjà client.",
        },
        {
          objection: "C'est quoi exactement le gel?",
          response:  "Acides BHA et AHA naturels. Prépare les pores avant la serviette. Les gens qui utilisent les deux voient des résultats en 10 jours au lieu de 21.",
        },
      ],

      abVariants: [
        { label: 'Formule BHA',  description: 'Pores dilatés, peau grasse — plus puissant' },
        { label: 'Formule AHA',  description: 'Teint terne, peau sèche — plus doux' },
      ],

      ifYesGoTo: 4,  // → Continuity
      ifNoGoTo:  3,  // → Downsell Feature

      creativeBriefs: {
        meta_ad: {
          format: '4:5',
          hook:   'T\'as commandé la serviette. Voilà pourquoi le gel change tout.',
          angle:  'Post-purchase upsell : complémentarité produit',
          cta:    'Ajouter le gel → 49€ au lieu de 79€',
          tone:   'authority',
        },
      },
    },

    // ══════════════════════════════════════════════════════
    // ÉTAPE 3 — DOWNSELL : Feature Downsell
    // Objectif : sauver le NON à l'upsell
    // ══════════════════════════════════════════════════════
    {
      stepOrder:         3,
      stepType:          'downsell',
      offerType:         'FEATURE_DOWNSELL',
      title:             'Format Découverte — Gel Exfoliant 30ml',
      hook:              'Commence avec le petit format. Si ça marche, tu agrandis.',
      priceMain:         14.00,    // Mini format gel uniquement
      priceAnchor:       null,
      priceFallback:     null,
      triggerCondition:  'NO to step 2 Upsell',
      psychologyLever:   'RECIPROCITY',

      salesScript: `Si 49€ c'est trop pour l'instant — j'ai le gel en format découverte 30ml à 14€.
Tu testes pendant 2 semaines. Si t'es convaincu, tu passes au format full.
On retire la garantie étendue mais tu gardes le produit.
Ça marche pour toi?`,

      objectionHandlers: [
        {
          objection: "Non merci, juste la serviette.",
          response:  "OK parfait. Et si dans 2 semaines tu veux accélérer — reviens sur le site, le gel sera là.",
        },
        {
          objection: "14€ pour 30ml c'est cher.",
          response:  "C'est 2 semaines de gel BHA. Un tube de 120ml c'est 42€. Là tu paies 14€ pour savoir si ça marche sur ta peau avant d'investir plus.",
        },
      ],

      ifYesGoTo: 4,  // → Continuity
      ifNoGoTo:  4,  // → Continuity quand même (offre indépendante)

      creativeBriefs: {
        email: {
          subject:  'Tu n\'as pas pris le gel. Voilà pourquoi tu devrait reconsidérer.',
          preview:  '14€. Format découverte. Aucun risque.',
          tone:     'empathy',
          cta:      'Tester le format 30ml →',
        },
      },
    },

    // ══════════════════════════════════════════════════════
    // ÉTAPE 4 — CONTINUITY : Continuity Bonus + Waived Fee
    // Objectif : cash récurrent garanti
    // ══════════════════════════════════════════════════════
    {
      stepOrder:         4,
      stepType:          'continuity',
      offerType:         'CONTINUITY_BONUS',
      title:             'Abonnement Blissal — 1 Recharge/Mois + Accès Communauté',
      hook:              'Si tu t\'abonnes aujourd\'hui, le 1er mois de gel est offert.',
      priceMain:         19.00,    // /mois
      priceAnchor:       null,
      priceFallback:     null,
      triggerCondition:  'After any purchase (step 1, 2 or 3)',
      psychologyLever:   'SCARCITY',

      salesScript: `Si tu t'abonnes aujourd'hui — je t'inclus 1 gel 60ml offert pour ce mois-ci (valeur 28€).
C'est uniquement pour les clients qui décident maintenant.
Chaque mois tu reçois 1 recharge de gel + accès au groupe privé avec les protocoles avancés.
Tu peux annuler quand tu veux — mais les gens restent en moyenne 8 mois parce que ça marche.`,

      objectionHandlers: [
        {
          objection: "Je veux pas m'engager sur un abonnement.",
          response:  "T'as raison d'être prudent. C'est pour ça qu'on annule à tout moment en 2 clics. Mais si tu pars dans les 3 premiers mois, les frais d'activation de 39€ s'appliquent — ça nous protège tous les deux.",
        },
        {
          objection: "Je veux d'abord finir ce que j'ai commandé.",
          response:  "Parfait. Le bonus gel offert t'attend jusqu'à la fin du mois. Si tu t'inscris avant le {{end_of_month}}, tu le reçois avec ta prochaine commande.",
        },
      ],

      // Variante Waived Fee (présentée en même temps)
      waiveFeeVariant: {
        monthlyFee:       19.00,
        activationFee:    39.00,   // waivé si engagement 6 mois
        commitmentMonths: 6,
        script: `Option 1 : mois-à-mois à 19€/mois — avec 39€ de frais d'activation si tu quittes dans les 3 premiers mois.
Option 2 : engage-toi sur 6 mois — je supprime les frais d'activation et tu bloques ton tarif à vie.
90% de nos abonnés choisissent l'option 2.`,
      },

      ifYesGoTo: null,  // Fin du funnel
      ifNoGoTo:  null,  // Fin du funnel — client acquis

      creativeBriefs: {
        email: {
          subject:  '🎁 Ton gel offert expire dans 48h',
          preview:  'Abonnement Blissal — 1er mois de gel offert si tu t\'inscris avant dimanche.',
          tone:     'urgency',
          sections: ['bonus_reveal', 'product_value', 'community_proof', 'cta_subscribe'],
        },
        sms: {
          copy:    'Blissal : ton gel 60ml offert (28€) expire dimanche. Abonnement 19€/mois, annulable. → lien',
          timing:  '24h après l\'achat',
          tone:    'scarcity',
        },
      },
    },
  ],

  // ══════════════════════════════════════════════════════
  // MATH HORMOZI — Validation 30 jours
  // ══════════════════════════════════════════════════════
  hormozi30dMath: {
    assumptions: {
      traffic:          100,    // 100 personnes voient l'offre
      cacPerCustomer:   20,     // €
      cogsPerCustomer:  7,      // €
    },
    funnel: [
      {
        step:             'Attraction (Challenge 30j)',
        presentedRate:    1.00,    // 100% voient l'offre
        conversionRate:   0.42,    // 42% achètent
        customersIn:      100,
        customersOut:     42,
        avgOrderValue:    29,
        revenueGenerated: 1218,    // 42 × 29€
      },
      {
        step:             'Upsell (Kit Bundle)',
        presentedRate:    1.00,    // tous les acheteurs voient l'upsell
        conversionRate:   0.45,    // 45% prennent le bundle
        customersIn:      42,
        customersOut:     19,      // 19 prennent le bundle
        avgOrderValue:    49,
        revenueGenerated: 931,     // 19 × 49€
      },
      {
        step:             'Downsell (Mini gel 14€)',
        presentedRate:    1.00,    // les 23 qui ont dit NON à l'upsell
        conversionRate:   0.30,    // 30% prennent le downsell
        customersIn:      23,
        customersOut:     7,
        avgOrderValue:    14,
        revenueGenerated: 98,      // 7 × 14€
      },
      {
        step:             'Continuity (19€/mois)',
        presentedRate:    1.00,    // tous les acheteurs voient la continuity
        conversionRate:   0.25,    // 25% s'abonnent
        customersIn:      42,
        customersOut:     10,      // 10 abonnés
        avgOrderValue:    19,
        revenueGenerated: 190,     // 10 × 19€ (premier mois)
        recurringMonthly: 190,     // cash récurrent
      },
    ],
    totals: {
      totalRevenueJ30:  2437,      // 1218 + 931 + 98 + 190
      totalCostsJ30:    1134,      // 42 clients × (20 CAC + 7 COGS)
      netProfitJ30:     1303,
      roi:              '115%',
      hormozi_ratio:    2.15,      // 2437 / 1134 = 2.15x ✓
      verdict:          '🟢 EXCELLENT — Ratio Hormozi 2.15x. Scale max.',
      note:             'Sans compter le recurring 190€/mois à partir du mois 2.',
    },
  },
};

// Helpers d'import
export function getBlissalModelForTenant(_tenantId: string) {
  return {
    ...BLISSAL_MONEY_MODEL,
    llmContext: {
      brand:          'Blissal',
      niche:          'Soin de la peau / Exfoliation',
      market:         'France',
      targetAudience: 'Femmes 25-45 ans, soucieuses de leur peau, budget moyen-élevé',
      brandVoice:     'Direct, honnête, résultat-prouvé — anti-bullshit beauté',
      mainBenefit:    'Peau lisse et lumineuse visible en 14 jours',
      competitors:    ['Ecovia', 'Gant Kessa', 'Gommage Nuxe'],
      differentiator: 'Technologie fibre micro-abrasive + garantie résultat 30j',
    },
  };
}
