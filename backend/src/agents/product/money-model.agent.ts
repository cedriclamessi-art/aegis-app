/**
 * AGENT_MONEY_MODEL — Séquenceur d'Offres Hormozi
 * ══════════════════════════════════════════════════════════════
 *
 * Mission : construire et optimiser des Money Models complets
 * basés sur le framework $100M Money Models d'Alex Hormozi.
 *
 * Les 13 offres gérées :
 *
 * ATTRACTION (acquérir en couvrant le CAC)
 *   WIN_MONEY_BACK    — résultat ou remboursé
 *   GIVEAWAY          — concours → non-gagnants reçoivent discount
 *   DECOY             — offre basique vs offre premium en contraste
 *   BUY_X_GET_Y       — achète X, reçois Y gratuitement
 *   PAY_LESS_NOW      — 0€ maintenant ou -30% payé maintenant
 *
 * UPSELL (faire le vrai profit)
 *   CLASSIC_UPSELL    — tu ne peux pas avoir X sans Y
 *   MENU_UPSELL       — unsell + prescribe + A/B
 *   ANCHOR_UPSELL     — montrer le premium d'abord, anchor le prix
 *   ROLLOVER_UPSELL   — créditer l'achat initial vers offre supérieure
 *
 * DOWNSELL (sauver les NON)
 *   PAYMENT_PLAN      — même prix, étalé dans le temps
 *   TRIAL_PENALTY     — essai gratuit avec condition
 *   FEATURE_DOWNSELL  — retirer une feature, baisser le prix
 *
 * CONTINUITY (cash récurrent garanti)
 *   CONTINUITY_BONUS  — bonus exclusif si abonnement maintenant
 *   CONTINUITY_DISCOUNT — 3 mois offerts si engagement 12 mois
 *   WAIVED_FEE        — frais activation waivés si engagement long
 *
 * Objectif Hormozi : ratio revenue/CAC+COGS > 1.5x en < 30 jours
 *
 * Intégrations :
 *   ← AGENT_WINNER_DETECTOR  : produit gagnant en input
 *   ← AGENT_CAPI             : vraies conversions par étape
 *   → AGENT_CREATIVE_FACTORY : briefs pour chaque étape
 *   → AGENT_META_TESTING     : A/B sur les scripts d'offre
 *   → AGENT_CEO              : alertes si funnel sous-performant
 * ══════════════════════════════════════════════════════════════
 */

import Anthropic from '@anthropic-ai/sdk';
import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';
import { logger } from '../../utils/logger';

// ─── Types ──────────────────────────────────────────────────

type StepType = 'attraction' | 'upsell' | 'downsell' | 'continuity';

type OfferType =
  // Attraction
  | 'WIN_MONEY_BACK' | 'GIVEAWAY' | 'DECOY' | 'BUY_X_GET_Y' | 'PAY_LESS_NOW'
  // Upsell
  | 'CLASSIC_UPSELL' | 'MENU_UPSELL' | 'ANCHOR_UPSELL' | 'ROLLOVER_UPSELL'
  // Downsell
  | 'PAYMENT_PLAN' | 'TRIAL_PENALTY' | 'FEATURE_DOWNSELL'
  // Continuity
  | 'CONTINUITY_BONUS' | 'CONTINUITY_DISCOUNT' | 'WAIVED_FEE';

type PsychologyLever =
  | 'ANCHORING' | 'RECIPROCITY' | 'SCARCITY' | 'SOCIAL_PROOF'
  | 'LOSS_AVERSION' | 'COMMITMENT' | 'AUTHORITY';

interface ProductContext {
  id: string;
  title: string;
  price: number;
  cogs: number;           // coût de production estimé
  description: string;
  category: string;
  targetAudience: string;
  mainBenefit: string;
  winnerScore?: number;   // score AGENT_WINNER_DETECTOR
}

interface MoneyModelStep {
  stepOrder: number;
  stepType: StepType;
  offerType: OfferType;
  title: string;
  hook: string;
  priceMain: number;
  priceAnchor?: number;
  priceFallback?: number;
  triggerCondition: string;
  psychologyLever: PsychologyLever;
  salesScript: string;
  objectionHandlers: Array<{ objection: string; response: string }>;
  abVariants?: Array<{ label: string; description: string }>;
  ifYesGoTo: number;
  ifNoGoTo: number;
}

interface ModelConfig {
  steps: MoneyModelStep[];
  targetCac: number;
  targetCogs: number;
  targetProfit30d: number;
  hormozi30dMath: {
    attractionRevenue: number;
    upsellRevenue: number;
    downsellRevenue: number;
    continuityRevenue: number;
    totalRevenue: number;
    netProfit: number;
    ratio: number;
    verdict: string;
  };
}

interface StepPerf {
  stepType: string;
  offerType: string;
  title: string;
  conversionRate: number | null;
  targetRate: number;
  healthStatus: string;
  revenue7d: number;
  presented7d: number;
}

// ─── Benchmarks Hormozi ──────────────────────────────────────

const TARGET_CONVERSION_RATES: Record<StepType, number> = {
  attraction:  0.40,
  upsell:      0.30,
  downsell:    0.25,
  continuity:  0.20,
};

// ─── Agent ───────────────────────────────────────────────────

export class MoneyModelAgent extends AgentBase {
  readonly agentId = 'AGENT_MONEY_MODEL';
  readonly taskTypes = [
    'money_model.build',           // construire une séquence pour un produit
    'money_model.optimize',        // optimiser une séquence existante
    'money_model.generate_briefs', // générer les briefs créatifs
    'money_model.health_check',    // analyser la santé du funnel
    'money_model.daily_review',    // revue quotidienne (cron)
    'money_model.compute_math',    // calculer le ratio Hormozi 30j
  ];

  private llm = new Anthropic();

  // ══════════════════════════════════════════════════════════
  // EXECUTE
  // ══════════════════════════════════════════════════════════

  async execute(task: AgentTask): Promise<AgentResult> {
    const { taskType, tenantId, input } = task;
    logger.info({ agent: this.agentId, taskType, tenantId }, 'Starting task');

    try {
      switch (taskType) {
        case 'money_model.build':
          return await this.buildMoneyModel(tenantId!, input as { productId: string; targetCac?: number; preferredAttraction?: OfferType });

        case 'money_model.optimize':
          return await this.optimizeModel(tenantId!, input as { modelId: string });

        case 'money_model.generate_briefs':
          return await this.generateCreativeBriefs(tenantId!, input as { modelId: string; briefTypes?: string[] });

        case 'money_model.health_check':
          return await this.healthCheck(tenantId!, input as { modelId?: string });

        case 'money_model.daily_review':
          return await this.dailyReview(tenantId!);

        case 'money_model.compute_math':
          return await this.computeHormoziMath(tenantId!, input as { modelId: string });

        default:
          return { success: false, error: `Unknown taskType: ${taskType}` };
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ agent: this.agentId, taskType, err: msg }, 'Task failed');
      return { success: false, error: msg, retryable: true };
    }
  }

  // ══════════════════════════════════════════════════════════
  // TASK 1 : CONSTRUIRE UN MONEY MODEL COMPLET
  // ══════════════════════════════════════════════════════════

  private async buildMoneyModel(
    tenantId: string,
    input: { productId: string; targetCac?: number; preferredAttraction?: OfferType }
  ): Promise<AgentResult> {

    // 1. Charger le produit
    const product = await this.loadProduct(input.productId);
    if (!product) {
      return { success: false, error: `Product ${input.productId} not found` };
    }

    logger.info({ agent: this.agentId, product: product.title }, 'Building Money Model');

    // 2. Construire le contexte pour le LLM
    const context = this.buildProductContext(product, input.targetCac);

    // 3. Générer la séquence avec le LLM
    const modelConfig = await this.generateSequenceWithLLM(context, input.preferredAttraction);

    // 4. Persister en base
    const modelId = await this.persistModel(tenantId, product, modelConfig, context);

    // 5. Notifier AGENT_CREATIVE_FACTORY
    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_CREATIVE_FACTORY',
      messageType: 'COMMAND',
      subject: 'money_model_ready',
      payload: {
        modelId,
        productId: input.productId,
        stepsCount: modelConfig.steps.length,
        action: 'generate_briefs_for_all_steps',
      },
      tenantId,
    });

    // 6. Notifier AGENT_CEO si ratio Hormozi insuffisant
    if (modelConfig.hormozi30dMath.ratio < 1.5) {
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_CEO',
        messageType: 'ALERT',
        subject: 'money_model_ratio_low',
        payload: {
          modelId,
          product: product.title,
          ratio: modelConfig.hormozi30dMath.ratio,
          verdict: modelConfig.hormozi30dMath.verdict,
          recommendation: 'Augmenter le prix ou améliorer l\'offre d\'attraction avant de scaler.',
        },
        tenantId,
        priority: 7,
      });
    }

    return {
      success: true,
      output: {
        modelId,
        stepsBuilt: modelConfig.steps.length,
        hormozi30dMath: modelConfig.hormozi30dMath,
        steps: modelConfig.steps.map(s => ({
          order: s.stepOrder,
          type: s.stepType,
          offer: s.offerType,
          title: s.title,
          price: s.priceMain,
        })),
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 2 : OPTIMISER UN MODÈLE EXISTANT
  // ══════════════════════════════════════════════════════════

  private async optimizeModel(
    tenantId: string,
    input: { modelId: string }
  ): Promise<AgentResult> {

    // Charger le modèle et ses perfs
    const modelData = await db.query(`
      SELECT mm.*, row_to_json(p) AS product
      FROM offers.money_models mm
      LEFT JOIN store.products p ON p.id = mm.product_id
      WHERE mm.id = $1 AND mm.tenant_id = $2
    `, [input.modelId, tenantId]);

    if (!modelData.rows.length) {
      return { success: false, error: 'Model not found' };
    }

    // Charger la santé du funnel
    const health = await db.query(`
      SELECT * FROM offers.funnel_health
      WHERE model_id = $1
      ORDER BY step_order
    `, [input.modelId]);

    const underperforming = health.rows.filter(
      (s: StepPerf) => s.health_status === 'needs_optimization' && s.presented_7d > 10
    );

    if (underperforming.length === 0) {
      return {
        success: true,
        output: { message: 'All steps are healthy. No optimization needed.', modelId: input.modelId },
      };
    }

    const optimizations: Array<{ stepId: string; changes: Record<string, unknown> }> = [];

    for (const step of underperforming) {
      const newScript = await this.regenerateScript(step, modelData.rows[0]);

      await db.query(`
        UPDATE offers.model_steps
        SET sales_script = $1, version = version + 1, updated_at = NOW()
        WHERE id = $2
      `, [newScript, step.step_id]);

      optimizations.push({ stepId: step.step_id, changes: { sales_script: 'regenerated' } });

      // Brief créatif mis à jour
      await this.send({
        fromAgent: this.agentId,
        toAgent: 'AGENT_CREATIVE_FACTORY',
        messageType: 'COMMAND',
        subject: 'step_optimized',
        payload: {
          stepId: step.step_id,
          modelId: input.modelId,
          stepType: step.step_type,
          offerType: step.offer_type,
          currentCr: step.conversion_rate,
          targetCr: step.target_rate,
          action: 'regenerate_brief',
        },
        tenantId,
      });
    }

    // Mettre à jour le modèle
    await db.query(`
      UPDATE offers.money_models
      SET last_optimized_at = NOW(),
          optimizations_count = optimizations_count + 1,
          updated_at = NOW()
      WHERE id = $1
    `, [input.modelId]);

    logger.info({ agent: this.agentId, modelId: input.modelId, optimizations: optimizations.length },
      'Model optimized');

    return {
      success: true,
      output: {
        modelId: input.modelId,
        stepsOptimized: optimizations.length,
        underperformingSteps: underperforming.map((s: StepPerf) => ({
          type: s.step_type,
          offer: s.offer_type,
          currentCr: s.conversion_rate,
          target: s.target_rate,
        })),
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 3 : GÉNÉRER LES BRIEFS CRÉATIFS
  // ══════════════════════════════════════════════════════════

  private async generateCreativeBriefs(
    tenantId: string,
    input: { modelId: string; briefTypes?: string[] }
  ): Promise<AgentResult> {

    const steps = await db.query(`
      SELECT ms.*, mm.llm_context, mm.name AS model_name
      FROM offers.model_steps ms
      JOIN offers.money_models mm ON mm.id = ms.model_id
      WHERE ms.model_id = $1 AND ms.is_active = TRUE
      ORDER BY ms.step_order
    `, [input.modelId]);

    const briefTypes = input.briefTypes ?? ['meta_ad', 'tiktok_video'];
    const briefs: Array<Record<string, unknown>> = [];

    for (const step of steps.rows) {
      for (const briefType of briefTypes) {
        const briefContent = await this.generateBriefForStep(step, briefType);

        const result = await db.query(`
          INSERT INTO offers.creative_briefs
            (step_id, tenant_id, brief_type, objective, psychology, hook_options,
             angle, cta, tone, format_specs, generated_copy, generated_at, status)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW(),'generated')
          RETURNING id
        `, [
          step.id,
          tenantId,
          briefType,
          briefContent.objective,
          briefContent.psychology,
          JSON.stringify(briefContent.hookOptions),
          briefContent.angle,
          briefContent.cta,
          briefContent.tone,
          JSON.stringify(briefContent.formatSpecs),
          briefContent.generatedCopy,
        ]);

        briefs.push({ briefId: result.rows[0].id, stepType: step.step_type, briefType });
      }
    }

    // Push vers AGENT_CREATIVE_FACTORY pour production
    await this.send({
      fromAgent: this.agentId,
      toAgent: 'AGENT_CREATIVE_FACTORY',
      messageType: 'DATA_PUSH',
      subject: 'briefs_ready',
      payload: { modelId: input.modelId, briefs, totalBriefs: briefs.length },
      tenantId,
    });

    return {
      success: true,
      output: { modelId: input.modelId, briefsGenerated: briefs.length, briefs },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 4 : HEALTH CHECK DU FUNNEL
  // ══════════════════════════════════════════════════════════

  private async healthCheck(
    tenantId: string,
    input: { modelId?: string }
  ): Promise<AgentResult> {

    const whereClause = input.modelId
      ? 'WHERE fh.model_id = $1 AND fh.tenant_id = $2'
      : 'WHERE fh.tenant_id = $1';
    const params = input.modelId ? [input.modelId, tenantId] : [tenantId];

    const query = `
      SELECT
        fh.*,
        CASE
          WHEN fh.health_status = 'healthy' THEN '🟢'
          WHEN fh.health_status = 'needs_optimization' THEN '🔴'
          ELSE '⚪'
        END AS icon
      FROM offers.funnel_health fh
      ${whereClause}
      ORDER BY fh.model_id, fh.step_order
    `;

    const result = await db.query(query, params);

    // Calculer score global par modèle
    const modelScores: Record<string, { healthy: number; total: number; score: number }> = {};
    for (const row of result.rows) {
      if (!modelScores[row.model_id]) modelScores[row.model_id] = { healthy: 0, total: 0, score: 0 };
      modelScores[row.model_id].total++;
      if (row.health_status === 'healthy') modelScores[row.model_id].healthy++;
    }
    for (const [modelId, scores] of Object.entries(modelScores)) {
      scores.score = Math.round((scores.healthy / scores.total) * 100);
      await db.query(`
        UPDATE offers.money_models SET funnel_health_score = $1 WHERE id = $2
      `, [scores.score, modelId]);
    }

    const needsAction = result.rows.filter((r: { health_status: string }) =>
      r.health_status === 'needs_optimization'
    );

    return {
      success: true,
      output: {
        steps: result.rows,
        modelScores,
        stepsNeedingAction: needsAction.length,
        recommendations: needsAction.map((s: StepPerf & { model_id: string; model_name: string; icon: string }) => ({
          model: s.model_name,
          step: s.step_type,
          offer: s.offer_type,
          current: `${Math.round((s.conversion_rate ?? 0) * 100)}%`,
          target: `${Math.round(s.target_rate * 100)}%`,
          gap: `${Math.round(((s.conversion_rate ?? 0) - s.target_rate) * 100)}pp`,
          action: this.getOptimizationRecommendation(s),
        })),
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 5 : DAILY REVIEW (cron 6h)
  // ══════════════════════════════════════════════════════════

  private async dailyReview(tenantId: string): Promise<AgentResult> {
    logger.info({ agent: this.agentId, tenantId }, 'Daily Money Model review');

    // Charger tous les modèles actifs
    const models = await db.query(`
      SELECT id, name, funnel_health_score FROM offers.money_models
      WHERE tenant_id = $1 AND stage = 'active'
    `, [tenantId]);

    const actions: string[] = [];

    for (const model of models.rows) {
      // Health check
      const health = await this.healthCheck(tenantId, { modelId: model.id });
      const stepsNeedingAction = (health.output as { stepsNeedingAction: number }).stepsNeedingAction;

      if (stepsNeedingAction > 0) {
        // Auto-optimize
        await this.optimizeModel(tenantId, { modelId: model.id });
        actions.push(`Optimized ${model.name}: ${stepsNeedingAction} steps`);
      }

      // Check Hormozi math
      const math = await this.computeHormoziMath(tenantId, { modelId: model.id });
      const mathOutput = math.output as { hormozi_ratio?: number; verdict?: string };
      if (mathOutput.hormozi_ratio && mathOutput.hormozi_ratio < 1.5) {
        await this.send({
          fromAgent: this.agentId,
          toAgent: 'AGENT_CEO',
          messageType: 'ALERT',
          subject: 'hormozi_ratio_degraded',
          payload: {
            modelId: model.id,
            modelName: model.name,
            ratio: mathOutput.hormozi_ratio,
            verdict: mathOutput.verdict,
          },
          tenantId,
          priority: 8,
        });
        actions.push(`Alert CEO: ${model.name} ratio ${mathOutput.hormozi_ratio}x`);
      }
    }

    return {
      success: true,
      output: { modelsReviewed: models.rows.length, actions },
    };
  }

  // ══════════════════════════════════════════════════════════
  // TASK 6 : CALCULER LE RATIO HORMOZI 30 JOURS
  // ══════════════════════════════════════════════════════════

  private async computeHormoziMath(
    tenantId: string,
    input: { modelId: string }
  ): Promise<AgentResult> {
    const result = await db.query(
      `SELECT * FROM offers.compute_30day_math($1)`,
      [input.modelId]
    );

    if (!result.rows.length) {
      return { success: false, error: 'Model not found or no data' };
    }

    const row = result.rows[0];
    return {
      success: true,
      output: {
        model_id: row.model_id,
        avg_cac: row.avg_cac,
        avg_cogs: row.avg_cogs,
        by_stage: {
          attraction:  row.attraction_revenue,
          upsell:      row.upsell_revenue,
          downsell:    row.downsell_revenue,
          continuity:  row.continuity_revenue,
        },
        total_revenue_30d: row.total_30d_revenue,
        total_cost_30d:    row.total_30d_cost,
        net_profit_30d:    row.net_profit_30d,
        cac_covered:       row.cac_covered,
        hormozi_ratio:     row.hormozi_ratio,
        verdict:           row.verdict,
      },
    };
  }

  // ══════════════════════════════════════════════════════════
  // LLM — GÉNÉRER LA SÉQUENCE D'OFFRES
  // ══════════════════════════════════════════════════════════

  private async generateSequenceWithLLM(
    context: ProductContext & { targetCac: number },
    preferredAttraction?: OfferType
  ): Promise<ModelConfig> {

    const templatesResult = await db.query(`
      SELECT offer_type, step_type, display_name, description,
             psychology_lever, target_cr, price_logic, trigger_logic, script_template
      FROM offers.offer_templates
      ORDER BY step_type, offer_type
    `);

    const templates = templatesResult.rows;

    const prompt = `Tu es un expert en $100M Money Models (Alex Hormozi).

PRODUIT :
- Nom : ${context.title}
- Prix actuel : ${context.price}€
- COGS (coût prod) : ${context.cogs}€
- Catégorie : ${context.category}
- Audience cible : ${context.targetAudience}
- Bénéfice principal : ${context.mainBenefit}
- Description : ${context.description}

CONTRAINTES FINANCIÈRES :
- CAC estimé (Meta Ads) : ${context.targetCac}€
- Objectif : couvrir le CAC + COGS en < 30 jours
- Ratio cible Hormozi : > 1.5x (idéal 2.5x)

${preferredAttraction ? `PRÉFÉRENCE ATTRACTION : utilise ${preferredAttraction}` : ''}

OFFRES DISPONIBLES :
${templates.map((t: {
  offer_type: string;
  display_name: string;
  step_type: string;
  price_logic: string;
  trigger_logic: string;
  script_template: string;
  psychology_lever: string;
  target_cr: number;
}) => `- ${t.offer_type} (${t.step_type.toUpperCase()}) : ${t.display_name}\n  Prix : ${t.price_logic}\n  Déclencher : ${t.trigger_logic}`).join('\n')}

MISSION :
Construis la séquence d'offres optimale pour ce produit.
Tu dois sélectionner EXACTEMENT :
- 1 offre ATTRACTION (couvre le CAC)
- 1-2 offres UPSELL (fait le profit)
- 1 offre DOWNSELL (sauve les NON)
- 1 offre CONTINUITY (cash récurrent)

Pour chaque étape, génère :
- Un titre accrocheur (max 60 chars)
- Un hook émotionnel court
- Un prix précis calculé selon la logique
- Un script de vente de 3-5 phrases
- 2 objection handlers
- La logique if_yes / if_no

Réponds UNIQUEMENT en JSON valide avec cette structure :
{
  "steps": [
    {
      "stepOrder": 1,
      "stepType": "attraction",
      "offerType": "WIN_MONEY_BACK",
      "title": "...",
      "hook": "...",
      "priceMain": 29.00,
      "priceAnchor": null,
      "priceFallback": null,
      "triggerCondition": "First contact",
      "psychologyLever": "COMMITMENT",
      "salesScript": "...",
      "objectionHandlers": [
        {"objection": "...", "response": "..."},
        {"objection": "...", "response": "..."}
      ],
      "abVariants": null,
      "ifYesGoTo": 2,
      "ifNoGoTo": 3
    }
  ],
  "hormozi30dMath": {
    "attractionRevenue": 12.0,
    "upsellRevenue": 18.0,
    "downsellRevenue": 8.0,
    "continuityRevenue": 5.0,
    "totalRevenue": 43.0,
    "netProfit": 15.0,
    "ratio": 1.88,
    "verdict": "🟡 CORRECT..."
  }
}`;

    const response = await this.llm.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 4000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('LLM returned no valid JSON');

    const parsed = JSON.parse(jsonMatch[0]) as {
      steps: MoneyModelStep[];
      hormozi30dMath: ModelConfig['hormozi30dMath'];
    };

    return {
      steps: parsed.steps,
      targetCac: context.targetCac,
      targetCogs: context.cogs,
      targetProfit30d: parsed.hormozi30dMath.netProfit,
      hormozi30dMath: parsed.hormozi30dMath,
    };
  }

  // ══════════════════════════════════════════════════════════
  // LLM — RÉGÉNÉRER UN SCRIPT D'ÉTAPE
  // ══════════════════════════════════════════════════════════

  private async regenerateScript(
    step: {
      offer_type: string;
      step_type: string;
      title: string;
      price_main: number;
      psychology_lever: string;
      conversion_rate: number;
      target_rate: number;
    },
    model: { llm_context: Record<string, unknown>; name: string }
  ): Promise<string> {

    const prompt = `Tu es un expert en copywriting de vente Hormozi.

L'étape "${step.title}" (${step.offer_type}) a un taux de conversion de ${Math.round(step.conversion_rate * 100)}% 
alors que la cible est ${Math.round(step.target_rate * 100)}%.

Levier psychologique : ${step.psychology_lever}
Prix : ${step.price_main}€
Contexte produit : ${JSON.stringify(model.llm_context)}

Génère un nouveau script de vente de 3-5 phrases pour améliorer ce taux.
Le script doit utiliser le levier ${step.psychology_lever} de manière naturelle.
Réponds UNIQUEMENT avec le script, sans intro ni explication.`;

    const response = await this.llm.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 500,
      messages: [{ role: 'user', content: prompt }],
    });

    return response.content[0].type === 'text' ? response.content[0].text : '';
  }

  // ══════════════════════════════════════════════════════════
  // LLM — GÉNÉRER UN BRIEF CRÉATIF
  // ══════════════════════════════════════════════════════════

  private async generateBriefForStep(
    step: {
      offer_type: string;
      step_type: string;
      title: string;
      hook: string;
      price_main: number;
      sales_script: string;
      psychology_lever: string;
      llm_context: Record<string, unknown>;
    },
    briefType: string
  ): Promise<{
    objective: string;
    psychology: string;
    hookOptions: string[];
    angle: string;
    cta: string;
    tone: string;
    formatSpecs: Record<string, unknown>;
    generatedCopy: string;
  }> {

    const formatSpecs: Record<string, Record<string, unknown>> = {
      meta_ad:      { aspect_ratio: '4:5', duration_sec: null, headline_max_chars: 40, body_max_chars: 125 },
      tiktok_video: { aspect_ratio: '9:16', duration_sec: 30, hook_duration_sec: 3, cta_at_sec: 25 },
      email:        { subject_max_chars: 60, preview_max_chars: 90, body_sections: ['hook', 'story', 'offer', 'cta'] },
      landing_copy: { headline_max_chars: 60, subhead_max_chars: 120, sections: ['hero', 'pain', 'solution', 'proof', 'offer', 'cta'] },
    };

    const prompt = `Brief créatif pour : ${briefType.toUpperCase()}

Étape du funnel : ${step.step_type} / ${step.offer_type}
Titre de l'offre : ${step.title}
Hook : ${step.hook}
Prix : ${step.price_main}€
Script de vente : ${step.sales_script}
Levier psychologique : ${step.psychology_lever}
Contexte : ${JSON.stringify(step.llm_context)}

Génère un brief créatif complet en JSON :
{
  "objective": "Ce que le ${briefType} doit accomplir",
  "psychology": "Levier psychologique utilisé et pourquoi",
  "hookOptions": ["Hook 1", "Hook 2", "Hook 3"],
  "angle": "Angle narratif principal",
  "cta": "Call-to-action",
  "tone": "urgency|authority|empathy|social_proof",
  "generatedCopy": "Copy complet pour ce format"
}

Réponds UNIQUEMENT en JSON valide.`;

    const response = await this.llm.messages.create({
      model: 'claude-sonnet-4-20250514',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '{}';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const parsed = jsonMatch ? JSON.parse(jsonMatch[0]) : {};

    return {
      objective:     parsed.objective ?? '',
      psychology:    parsed.psychology ?? '',
      hookOptions:   parsed.hookOptions ?? [],
      angle:         parsed.angle ?? '',
      cta:           parsed.cta ?? '',
      tone:          parsed.tone ?? 'urgency',
      formatSpecs:   formatSpecs[briefType] ?? {},
      generatedCopy: parsed.generatedCopy ?? '',
    };
  }

  // ══════════════════════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════════════════════

  private async loadProduct(productId: string): Promise<Record<string, unknown> | null> {
    const result = await db.query(`
      SELECT p.*, wd.winner_score, wd.market_validation
      FROM store.products p
      LEFT JOIN (
        SELECT product_id, winner_score, market_validation
        FROM intel.experiments
        WHERE product_id = $1
        ORDER BY created_at DESC LIMIT 1
      ) wd ON wd.product_id = p.id
      WHERE p.id = $1
    `, [productId]);
    return result.rows[0] ?? null;
  }

  private buildProductContext(
    product: Record<string, unknown>,
    targetCac?: number
  ): ProductContext & { targetCac: number } {
    const normalized = product.normalized_data as Record<string, unknown> ?? {};
    return {
      id:             product.id as string,
      title:          (product.title as string) ?? 'Produit',
      price:          parseFloat(product.price as string) ?? 29,
      cogs:           parseFloat(product.price as string) * 0.25 ?? 7,  // COGS = ~25% du prix
      description:    (product.description as string) ?? '',
      category:       (normalized.category as string) ?? 'DTC',
      targetAudience: (normalized.target_audience as string) ?? 'Adultes 25-45 ans',
      mainBenefit:    (normalized.main_benefit as string) ?? 'Résultat visible',
      winnerScore:    product.winner_score as number,
      targetCac:      targetCac ?? 20,
    };
  }

  private async persistModel(
    tenantId: string,
    product: Record<string, unknown>,
    config: ModelConfig,
    context: ProductContext
  ): Promise<string> {

    const client = await db.connect();
    try {
      await client.query('BEGIN');

      // Créer le modèle
      const modelResult = await client.query(`
        INSERT INTO offers.money_models
          (tenant_id, product_id, name, stage, target_cac, target_cogs,
           target_profit_30d, llm_context)
        VALUES ($1,$2,$3,'active',$4,$5,$6,$7)
        RETURNING id
      `, [
        tenantId,
        product.id,
        `Money Model — ${product.title}`,
        config.targetCac,
        config.targetCogs,
        config.targetProfit30d,
        JSON.stringify({
          title: context.title,
          price: context.price,
          category: context.category,
          targetAudience: context.targetAudience,
          mainBenefit: context.mainBenefit,
        }),
      ]);

      const modelId = modelResult.rows[0].id;

      // Créer les étapes
      for (const step of config.steps) {
        await client.query(`
          INSERT INTO offers.model_steps
            (model_id, tenant_id, step_order, step_type, offer_type, title, hook,
             price_main, price_anchor, price_fallback, trigger_condition,
             psychology_lever, sales_script, objection_handlers, ab_variants,
             if_yes_go_to, if_no_go_to)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
        `, [
          modelId, tenantId,
          step.stepOrder, step.stepType, step.offerType,
          step.title, step.hook,
          step.priceMain, step.priceAnchor ?? null, step.priceFallback ?? null,
          step.triggerCondition, step.psychologyLever,
          step.salesScript,
          JSON.stringify(step.objectionHandlers),
          step.abVariants ? JSON.stringify(step.abVariants) : null,
          step.ifYesGoTo, step.ifNoGoTo,
        ]);
      }

      await client.query('COMMIT');
      return modelId;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  private getOptimizationRecommendation(step: StepPerf): string {
    const cr = step.conversion_rate ?? 0;
    const gap = step.target_rate - cr;

    if (step.offer_type === 'ANCHOR_UPSELL' && gap > 0.1) {
      return 'Augmenter l\'écart entre anchor et main offer. L\'anchor n\'est pas assez élevé.';
    }
    if (step.offer_type === 'PAYMENT_PLAN' && gap > 0.05) {
      return 'Fractionner en 3 versements au lieu de 2. Aligner sur les dates de paye.';
    }
    if (step.step_type === 'continuity' && gap > 0.05) {
      return 'Ajouter un bonus exclusif pour augmenter la valeur perçue de l\'abonnement.';
    }
    if (step.step_type === 'attraction' && gap > 0.10) {
      return 'Script d\'attraction trop faible. Tester un Decoy ou Win Money Back si pas en place.';
    }
    return 'Régénérer le script avec un levier psychologique plus fort.';
  }
}

export default MoneyModelAgent;
