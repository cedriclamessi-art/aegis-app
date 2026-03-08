/**
 * AGENT_WINNER_DETECTOR \u2014 Phase 1 : Intel Winner Detector
 * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Syst\u00e8me : calcul math\u00e9matique \u2192 verdict WINNER_POTENTIAL ou REJET
 *
 * Conditions de validation :
 *   \u2713 Contribution Margin \u2265 30%
 *   \u2713 AOV \u2265 60\u20ac
 *   \u2713 TAM estim\u00e9 large
 *   \u2713 Minimum 3 angles marketing
 *   \u2713 Minimum 2 niveaux d'awareness
 *
 * Si valid\u00e9 \u2192 signal TAKEOFF vers AGENT_CREATIVE_FACTORY + AGENT_FUNNEL_ENGINE
 * Sinon    \u2192 signal OPTIMISE_OFFER vers AGENT_OFFER_OPTIMIZER
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';

interface ProductEquationInput {
  productId:           string;
  sellingPrice:        number;
  cogs:                number;
  shippingCost:        number;
  paymentFees:         number;
  estimatedCpa:        number;
  estimatedTamEur?:    number;
  estimatedRepeatRate?: number;
}

interface WinnerEvaluation {
  contributionMargin:    number;
  contributionMarginPct: number;
  breakEvenRoas:         number;
  ltv30d:                number;
  ltv60d:                number;
  ltv90d:                number;
  profitPotential:       number;
  marketingAngles:       string[];
  awarenessLevels:       string[];
  verdict:               'winner_potential' | 'optimise_offer' | 'rejected';
  reasons:               string[];
  winnerScore:           number;
}

export class WinnerDetectorAgent extends AgentBase {
  readonly agentId = 'AGENT_WINNER_DETECTOR';

  readonly supportedTasks = [
    'winner.evaluate',    // calcul complet + verdict
    'winner.score',       // recalcul score uniquement
    'winner.validate',    // validation manuelle \u2192 TAKEOFF
    'winner.reject',      // rejet manuel
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'winner.evaluate': return this.evaluate(task);
      case 'winner.score':    return this.recalcScore(task);
      case 'winner.validate': return this.manualValidate(task);
      case 'winner.reject':   return this.manualReject(task);
      default: throw new Error(`Task non support\u00e9e: ${task.taskType}`);
    }
  }

  // \u2500\u2500 \u00c9valuation compl\u00e8te \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async evaluate(task: AgentTask): Promise<AgentResult> {
    const input = task.payload as ProductEquationInput;

    await this.trace('info', `\u00c9valuation produit ${input.productId}`, input);

    // 1. Calculer l'\u00e9quation \u00e9conomique
    const eq = this.calculateEquation(input);

    // 2. G\u00e9n\u00e9rer les angles marketing via LLM
    const { angles, awarenessLevels } = await this.generateAnglesAndAwareness(
      input.productId,
      task.tenantId
    );

    // 3. Calcul LTV
    const ltv = this.calculateLTV(
      input.sellingPrice,
      input.estimatedRepeatRate ?? 0,
      [30, 60, 90]
    );

    // 4. Score et verdict
    const { verdict, reasons, score } = this.computeVerdict({
      ...eq,
      marketingAngles: angles,
      awarenessLevels,
      aov: input.sellingPrice,
      tamEur: input.estimatedTamEur ?? 0,
    });

    const evaluation: WinnerEvaluation = {
      ...eq,
      ...ltv,
      marketingAngles: angles,
      awarenessLevels,
      verdict,
      reasons,
      winnerScore: score,
    };

    // 5. Sauvegarder
    await db.query(
      `INSERT INTO intel.product_equations (
         tenant_id, product_id,
         selling_price, cogs, shipping_cost, payment_fees, estimated_cpa,
         estimated_tam_eur, estimated_repeat_rate,
         ltv_30d, ltv_60d, ltv_90d, profit_potential,
         marketing_angles, awareness_levels, angles_count, awareness_count,
         verdict, verdict_reasons, winner_score, validated_at
       ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14::jsonb,$15::jsonb,$16,$17,$18,$19::jsonb,$20,$21)
       ON CONFLICT (tenant_id, product_id) DO UPDATE SET
         selling_price=EXCLUDED.selling_price, cogs=EXCLUDED.cogs,
         estimated_cpa=EXCLUDED.estimated_cpa,
         ltv_30d=EXCLUDED.ltv_30d, ltv_90d=EXCLUDED.ltv_90d,
         marketing_angles=EXCLUDED.marketing_angles, awareness_levels=EXCLUDED.awareness_levels,
         angles_count=EXCLUDED.angles_count, awareness_count=EXCLUDED.awareness_count,
         verdict=EXCLUDED.verdict, verdict_reasons=EXCLUDED.verdict_reasons,
         winner_score=EXCLUDED.winner_score, validated_at=EXCLUDED.validated_at,
         updated_at=NOW()`,
      [
        task.tenantId, input.productId,
        input.sellingPrice, input.cogs, input.shippingCost, input.paymentFees, input.estimatedCpa,
        input.estimatedTamEur ?? null, input.estimatedRepeatRate ?? 0,
        ltv['ltv_30d'], ltv['ltv_60d'], ltv['ltv_90d'],
        eq.contributionMargin * (input.estimatedTamEur ?? 0),
        JSON.stringify(angles), JSON.stringify(awarenessLevels),
        angles.length, awarenessLevels.length,
        verdict, JSON.stringify(reasons), score,
        verdict === 'winner_potential' ? new Date() : null,
      ]
    );

    // 6. Signaler aux agents selon le verdict
    await this.signalDownstream(task, input.productId, verdict, evaluation);

    return {
      success: true,
      output: {
        verdict,
        winnerScore:          score,
        contributionMargin:   eq.contributionMargin,
        contributionMarginPct: eq.contributionMarginPct,
        breakEvenRoas:        eq.breakEvenRoas,
        ltv30d:               ltv['ltv_30d'],
        ltv90d:               ltv['ltv_90d'],
        anglesCount:          angles.length,
        awarenessCount:       awarenessLevels.length,
        reasons,
      },
    };
  }

  // \u2500\u2500 Calcul de l'\u00e9quation \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private calculateEquation(input: ProductEquationInput) {
    const variableCost = input.cogs + input.shippingCost + input.paymentFees;
    const contributionMargin = input.sellingPrice - variableCost - input.estimatedCpa;
    const contributionMarginPct = input.sellingPrice > 0
      ? (contributionMargin / input.sellingPrice) * 100 : 0;
    const breakEvenRoas = (input.sellingPrice - variableCost) > 0
      ? input.sellingPrice / (input.sellingPrice - variableCost) : 0;

    return {
      contributionMargin:    Math.round(contributionMargin * 100) / 100,
      contributionMarginPct: Math.round(contributionMarginPct * 100) / 100,
      breakEvenRoas:         Math.round(breakEvenRoas * 100) / 100,
    };
  }

  // \u2500\u2500 LTV projections \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private calculateLTV(price: number, repeatRate: number, horizons: number[]) {
    // LTV = price + (price \u00d7 repeatRate/100) \u00d7 (horizon/30)
    const result: Record<string, number> = {};
    for (const days of horizons) {
      const repeats = (repeatRate / 100) * (days / 30);
      result[`ltv_${days}d`] = Math.round(price * (1 + repeats) * 100) / 100;
    }
    return result;
  }

  // \u2500\u2500 G\u00e9n\u00e9rer angles marketing + niveaux awareness via LLM \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async generateAnglesAndAwareness(
    productId: string,
    tenantId:  string
  ): Promise<{ angles: string[]; awarenessLevels: string[] }> {
    // R\u00e9cup\u00e9rer le contexte produit + analyse FAST
    const r = await db.query(
      `SELECT p.name, p.metadata,
              fa.usp, fa.mass_desire, fa.competitor_insights, fa.ad_strategies
       FROM store.products p
       LEFT JOIN intel.fast_analysis fa ON fa.product_id = p.id AND fa.tenant_id = p.tenant_id
       WHERE p.id = $1`,
      [productId]
    );
    const product = r.rows[0] ?? {};

    const context = product.ad_strategies
      ? `Analyse FAST disponible. USP: ${JSON.stringify(product.usp)}. Angles existants: ${JSON.stringify(product.ad_strategies)}.`
      : `Produit: ${product.name ?? productId}`;

    const response = await this.callLLM({
      system: 'Tu es expert en marketing direct. R\u00e9ponds UNIQUEMENT en JSON valide, sans markdown.',
      user: `Pour ce produit, g\u00e9n\u00e8re les angles marketing et niveaux d'awareness exploitables.
${context}

R\u00e9ponds en JSON :
{
  "angles": ["Angle 1 concret", "Angle 2 concret", "Angle 3 concret", "..."],
  "awarenessLevels": ["unaware", "problem_aware", "solution_aware", "product_aware", "most_aware"],
  "explanation": "Pourquoi ces angles fonctionnent pour ce march\u00e9"
}

G\u00e9n\u00e8re MINIMUM 3 angles et identifie MINIMUM 2 niveaux d'awareness r\u00e9ellement exploitables.`,
      maxTokens: 800,
    });

    try {
      const parsed = JSON.parse(response) as { angles: string[]; awarenessLevels: string[] };
      return {
        angles:         parsed.angles ?? [],
        awarenessLevels: parsed.awarenessLevels ?? [],
      };
    } catch {
      return {
        angles:         ['Transformation', 'Probl\u00e8me \u2192 Solution', 'Identit\u00e9 sociale'],
        awarenessLevels: ['problem_aware', 'solution_aware'],
      };
    }
  }

  // \u2500\u2500 Verdict final \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private computeVerdict(data: {
    contributionMarginPct: number;
    aov:                   number;
    tamEur:                number;
    marketingAngles:       string[];
    awarenessLevels:       string[];
  }): { verdict: 'winner_potential' | 'optimise_offer' | 'rejected'; reasons: string[]; score: number } {
    const reasons: string[] = [];
    let score = 0;

    // Contribution Margin \u2265 30%
    if (data.contributionMarginPct >= 30) {
      reasons.push(`\u2713 Marge contribution: ${data.contributionMarginPct.toFixed(1)}%`);
      score += 30;
    } else if (data.contributionMarginPct >= 15) {
      reasons.push(`\u26a0 Marge contribution faible: ${data.contributionMarginPct.toFixed(1)}% (min 30%)`);
      score += 10;
    } else {
      reasons.push(`\u2717 Marge contribution insuffisante: ${data.contributionMarginPct.toFixed(1)}% (min 30%)`);
    }

    // AOV \u2265 60\u20ac
    if (data.aov >= 60) {
      reasons.push(`\u2713 AOV: ${data.aov}\u20ac`);
      score += 25;
    } else if (data.aov >= 40) {
      reasons.push(`\u26a0 AOV limite: ${data.aov}\u20ac (min 60\u20ac recommand\u00e9)`);
      score += 10;
    } else {
      reasons.push(`\u2717 AOV trop faible: ${data.aov}\u20ac (min 60\u20ac)`);
    }

    // TAM
    if (data.tamEur > 1_000_000) {
      reasons.push(`\u2713 TAM large: ${(data.tamEur / 1_000_000).toFixed(1)}M\u20ac`);
      score += 20;
    } else if (data.tamEur > 100_000) {
      reasons.push(`\u26a0 TAM moyen: ${(data.tamEur / 1_000).toFixed(0)}K\u20ac`);
      score += 10;
    } else {
      reasons.push(`\u26a0 TAM non estim\u00e9 ou faible`);
      score += 5;
    }

    // Angles marketing \u2265 3
    if (data.marketingAngles.length >= 3) {
      reasons.push(`\u2713 ${data.marketingAngles.length} angles marketing identifi\u00e9s`);
      score += 15;
    } else {
      reasons.push(`\u2717 Seulement ${data.marketingAngles.length} angle(s) (min 3)`);
    }

    // Awareness levels \u2265 2
    if (data.awarenessLevels.length >= 2) {
      reasons.push(`\u2713 ${data.awarenessLevels.length} niveaux d'awareness exploitables`);
      score += 10;
    } else {
      reasons.push(`\u2717 Seulement ${data.awarenessLevels.length} niveau(x) d'awareness (min 2)`);
    }

    // Verdict
    let verdict: 'winner_potential' | 'optimise_offer' | 'rejected';
    if (score >= 70 && data.contributionMarginPct >= 30 && data.aov >= 60) {
      verdict = 'winner_potential';
    } else if (score >= 40) {
      verdict = 'optimise_offer';
    } else {
      verdict = 'rejected';
    }

    return { verdict, reasons, score };
  }

  // \u2500\u2500 Signalement downstream \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async signalDownstream(
    task: AgentTask,
    productId: string,
    verdict: string,
    evaluation: WinnerEvaluation
  ): Promise<void> {
    if (verdict === 'winner_potential') {
      // \u2192 TAKEOFF : activer Creative Factory + Funnel Engine + Offer Optimizer
      for (const agent of ['AGENT_CREATIVE_FACTORY', 'AGENT_FUNNEL_ENGINE', 'AGENT_OFFER_OPTIMIZER', 'AGENT_META_TESTING']) {
        await this.sendMessage(task.tenantId, agent, 'COMMAND', 'TAKEOFF', {
          productId,
          winnerScore: evaluation.winnerScore,
          contributionMarginPct: evaluation.contributionMarginPct,
          breakEvenRoas: evaluation.breakEvenRoas,
          ltv30d: evaluation.ltv30d,
          angles: evaluation.marketingAngles,
          awarenessLevels: evaluation.awarenessLevels,
          instruction: 'Produit valid\u00e9 winner. D\u00e9marre ta phase imm\u00e9diatement.',
        });
      }
      await this.trace('info', `\ud83c\udfc6 TAKEOFF d\u00e9clench\u00e9 pour ${productId} (score: ${evaluation.winnerScore})`, { verdict });
    } else if (verdict === 'optimise_offer') {
      await this.sendMessage(task.tenantId, 'AGENT_OFFER_OPTIMIZER', 'COMMAND', 'OPTIMISE_OFFER', {
        productId,
        reasons: evaluation.reasons,
        contributionMarginPct: evaluation.contributionMarginPct,
        instruction: 'Marge insuffisante. Optimiser l\'offre (bundle, decoy, garantie) pour atteindre 30%.',
      });
      await this.trace('info', `\u2699 OPTIMISE_OFFER pour ${productId}`, { verdict });
    } else {
      await this.sendMessage(task.tenantId, 'AGENT_INGEST', 'EVENT', 'PRODUCT_REJECTED', {
        productId,
        reasons: evaluation.reasons,
        winnerScore: evaluation.winnerScore,
      });
      await this.trace('warn', `\u2717 Produit rejet\u00e9 ${productId} (score: ${evaluation.winnerScore})`, { verdict });
    }
  }

  private async recalcScore(task: AgentTask): Promise<AgentResult> {
    return this.evaluate(task);
  }

  private async manualValidate(task: AgentTask): Promise<AgentResult> {
    const { productId } = task.payload as { productId: string };
    await db.query(
      `UPDATE intel.product_equations SET verdict='takeoff', validated_at=NOW(), updated_at=NOW()
       WHERE tenant_id=$1 AND product_id=$2`,
      [task.tenantId, productId]
    );
    await this.signalDownstream(task, productId, 'winner_potential', {} as WinnerEvaluation);
    return { success: true, output: { verdict: 'takeoff', productId } };
  }

  private async manualReject(task: AgentTask): Promise<AgentResult> {
    const { productId, reason } = task.payload as { productId: string; reason: string };
    await db.query(
      `UPDATE intel.product_equations SET verdict='rejected', verdict_reasons=$3::jsonb, updated_at=NOW()
       WHERE tenant_id=$1 AND product_id=$2`,
      [task.tenantId, productId, JSON.stringify([reason])]
    );
    return { success: true, output: { verdict: 'rejected', productId } };
  }

  private async sendMessage(
    tenantId: string, toAgent: string, type: string, subject: string, payload: unknown
  ): Promise<void> {
    await db.query(
      `INSERT INTO agents.messages (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
       VALUES ($1,$2,$3,$4,$5,$6::jsonb,8,NOW())`,
      [tenantId, this.agentId, toAgent, type, subject, JSON.stringify(payload)]
    );
  }
}
