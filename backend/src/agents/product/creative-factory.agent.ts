/**
 * AGENT_CREATIVE_FACTORY \u2014 Phase 2 : Stimulus Psychologique
 * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * G\u00e9n\u00e8re la matrice compl\u00e8te :
 *   5 awareness \u00d7 3 angles \u00d7 2 concepts \u00d7 2 hooks biologiques
 * = jusqu'\u00e0 60 briefs par produit
 *
 * Formule CONDOR : (Angle \u00d7 (Avatar \u00d7 Awareness)) \u00d7 Concept \u00d7 Coherence Index
 * Entity ID compliant Meta 2026 : chaque it\u00e9ration change format/persona/d\u00e9cor/v\u00e9hicule
 */

import { AgentBase, AgentTask, AgentResult } from '../base/agent.base';
import { db } from '../../utils/db';

const AWARENESS_LEVELS = ['unaware', 'problem_aware', 'solution_aware', 'product_aware', 'most_aware'] as const;
type AwarenessLevel = typeof AWARENESS_LEVELS[number];

const CONCEPT_TYPES = ['UGC', 'founder', 'demo', 'visual_metaphor', 'POV', 'testimonial', 'transformation'] as const;

export class CreativeFactoryAgent extends AgentBase {
  readonly agentId = 'AGENT_CREATIVE_FACTORY';

  readonly supportedTasks = [
    'creative.matrix_build',
    'creative.brief_generate',
    'creative.iterate',
    'creative.classify',
    'creative.condor_detect',
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'creative.matrix_build':   return this.buildMatrix(task);
      case 'creative.brief_generate': return this.generateBrief(task);
      case 'creative.iterate':        return this.iterate(task);
      case 'creative.condor_detect':  return this.detectCondors(task);
      default: throw new Error(`Task non support\u00e9e: ${task.taskType}`);
    }
  }

  // \u2500\u2500 Construire la matrice compl\u00e8te \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async buildMatrix(task: AgentTask): Promise<AgentResult> {
    const { productId, angles, awarenessLevels } = task.payload as {
      productId:      string;
      angles:         string[];
      awarenessLevels: string[];
    };

    // R\u00e9cup\u00e9rer le contexte FAST
    const ctx = await this.getProductContext(productId, task.tenantId);

    // G\u00e9n\u00e9rer les briefs pour chaque combinaison awareness \u00d7 angle \u00d7 concept
    const briefsToGenerate: BriefRequest[] = [];
    const targetLevels = (awarenessLevels.length >= 2 ? awarenessLevels : AWARENESS_LEVELS) as AwarenessLevel[];
    const targetAngles = angles.slice(0, 3); // max 3 angles
    const targetConcepts = ['UGC', 'testimonial', 'demo', 'POV', 'founder'].slice(0, 2);

    for (const level of targetLevels.slice(0, 5)) {
      for (const angle of targetAngles) {
        for (const concept of targetConcepts) {
          briefsToGenerate.push({ level, angle, concept });
        }
      }
    }

    // G\u00e9n\u00e9rer en batch via LLM (max 15 \u00e0 la fois pour rester sous les tokens)
    const batches = chunkArray(briefsToGenerate, 5);
    let totalGenerated = 0;

    for (const batch of batches) {
      const briefs = await this.generateBatch(batch, ctx, productId);
      totalGenerated += briefs.length;

      for (const brief of briefs) {
        await db.query(
          `INSERT INTO creative.awareness_matrix
             (tenant_id, product_id, awareness_level, marketing_angle, concept_type, persona_id,
              hook, relevance_signal, pain_amplification, desire_projection, emotional_gap,
              visual_proof, cta, hook_movement, hook_emotional, entity_id_variant, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16::jsonb,NOW())
           ON CONFLICT DO NOTHING`,
          [
            task.tenantId, productId,
            brief.level, brief.angle, brief.concept, brief.personaId ?? null,
            brief.hook, brief.relevanceSignal, brief.painAmplification,
            brief.desireProjection, brief.emotionalGap, brief.visualProof, brief.cta,
            brief.hookMovement, brief.hookEmotional,
            JSON.stringify(brief.entityIdVariant),
          ]
        );
      }
    }

    await this.trace('info', `Matrice cr\u00e9ative : ${totalGenerated} briefs g\u00e9n\u00e9r\u00e9s`, {
      productId, levelsCount: targetLevels.length, anglesCount: targetAngles.length,
    });

    // Signaler AGENT_META_TESTING que les cr\u00e9atives sont pr\u00eates
    await db.query(
      `INSERT INTO agents.messages (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
       VALUES ($1,$2,'AGENT_META_TESTING','EVENT','CREATIVES_READY',$3::jsonb,8,NOW())`,
      [task.tenantId, this.agentId, JSON.stringify({ productId, count: totalGenerated })]
    );

    return { success: true, output: { totalGenerated, productId } };
  }

  // \u2500\u2500 G\u00e9n\u00e9rer un batch de briefs \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async generateBatch(
    requests: BriefRequest[],
    ctx: ProductContext,
    productId: string
  ): Promise<CreativeBrief[]> {
    const prompt = `Tu g\u00e9n\u00e8res des briefs cr\u00e9atifs Meta Ads selon la m\u00e9thode CONDOR.
Produit : ${ctx.productName}
USP : ${JSON.stringify(ctx.usp)}
Personas : ${JSON.stringify(ctx.personas?.slice(0, 2))}

Pour chaque combinaison, g\u00e9n\u00e8re la structure cr\u00e9ative obligatoire en 7 \u00e9tapes.
RULE : Hook = 2 secondes MAX. \u00c9motionnel avant rationnel.
RULE : Entity ID = chaque brief doit sp\u00e9cifier ce qui le diff\u00e9rencie (format/persona/d\u00e9cor/v\u00e9hicule narratif).

Combinaisons \u00e0 g\u00e9n\u00e9rer :
${requests.map((r, i) => `${i + 1}. Awareness: ${r.level} | Angle: ${r.angle} | Concept: ${r.concept}`).join('\
')}

R\u00e9ponds UNIQUEMENT en JSON :
[
  {
    "level": "...", "angle": "...", "concept": "...",
    "hook": "...(2s max)",
    "relevanceSignal": "...(POR \u2014 pertinence imm\u00e9diate)",
    "painAmplification": "...(amplifier la douleur visc\u00e9ralement)",
    "desireProjection": "...(projeter dans le futur id\u00e9al)",
    "emotionalGap": "...(cr\u00e9er le manque)",
    "visualProof": "...(preuve visuelle concr\u00e8te)",
    "cta": "Pack A \u2014 X\u20ac | Pack B \u2014 Y\u20ac",
    "hookMovement": "...(hook visuel : mouvement qui capte l'attention)",
    "hookEmotional": "...(hook \u00e9motionnel : tension ou surprise)",
    "entityIdVariant": {
      "format": "...(Reel 9:16 / Story / Caroussel / etc.)",
      "persona": "...(qui parle/appara\u00eet)",
      "decor": "...(lieu/environnement)",
      "narrativeVehicle": "...(POV / T\u00e9moignage / D\u00e9monstration / Situation)"
    }
  }
]`;

    try {
      const raw = await this.callLLM({
        system: 'Expert cr\u00e9atif Meta Ads. R\u00e9ponds UNIQUEMENT en JSON valide, sans markdown.',
        user: prompt,
        maxTokens: 2000,
      });
      return JSON.parse(raw) as CreativeBrief[];
    } catch {
      // Fallback : retourner un brief minimal
      return requests.map(r => ({
        ...r,
        level: r.level,
        angle: r.angle,
        concept: r.concept,
        hook: `Stop scrolling \u2014 voici ce que ${r.level === 'unaware' ? 'personne ne te dit' : 'tu cherches'}`,
        relevanceSignal: 'Si tu as ce probl\u00e8me, lis jusqu\'au bout',
        painAmplification: 'Imagine encore 6 mois comme \u00e7a...',
        desireProjection: 'Et si dans 30 jours c\'\u00e9tait r\u00e9gl\u00e9 d\u00e9finitivement ?',
        emotionalGap: 'La solution existe d\u00e9j\u00e0. Tu ne la connais pas encore.',
        visualProof: 'R\u00e9sultat r\u00e9el \u2014 avant/apr\u00e8s',
        cta: 'Choisis ton pack \u2192',
        hookMovement: 'Zoom rapide sur le probl\u00e8me',
        hookEmotional: 'Regard cam\u00e9ra \u2014 silence 0.5s \u2014 puis parle',
        entityIdVariant: { format: 'Reel 9:16', persona: 'Utilisateur lambda', decor: 'Maison', narrativeVehicle: 'T\u00e9moignage' },
        personaId: null,
      }));
    }
  }

  // \u2500\u2500 It\u00e9rer sur les winners (Entity ID compliant) \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async iterate(task: AgentTask): Promise<AgentResult> {
    const { productId, winnerPatterns } = task.payload as {
      productId: string;
      winnerPatterns: WinnerPatterns;
    };

    // R\u00e9cup\u00e9rer les top winners existants
    const winners = await db.query(
      `SELECT * FROM creative.awareness_matrix
       WHERE tenant_id=$1 AND product_id=$2
         AND classification IN ('CONDOR','TOF_CREATOR')
       ORDER BY condor_score DESC NULLS LAST
       LIMIT 5`,
      [task.tenantId, productId]
    );

    const ctx = await this.getProductContext(productId, task.tenantId);
    let iterationsCreated = 0;

    for (const winner of winners.rows) {
      // Cr\u00e9er des variations qui changent 1 \u00e9l\u00e9ment Entity ID \u00e0 la fois
      const entityChanges: Array<{ field: keyof EntityIdVariant; value: string }> = [
        { field: 'format', value: this.getNextFormat(winner.entity_id_variant?.format) },
        { field: 'persona', value: this.getNextPersona(winner.entity_id_variant?.persona) },
        { field: 'decor', value: this.getNextDecor(winner.entity_id_variant?.decor) },
        { field: 'narrativeVehicle', value: this.getNextNarrativeVehicle(winner.entity_id_variant?.narrativeVehicle) },
      ];

      for (const change of entityChanges.slice(0, 2)) {
        const newEntityId = {
          ...(winner.entity_id_variant ?? {}),
          [change.field]: change.value,
        };

        // G\u00e9n\u00e9rer le nouveau brief avec cette variation
        const [newBrief] = await this.generateBatch(
          [{ level: winner.awareness_level, angle: winner.marketing_angle, concept: winner.concept_type }],
          ctx,
          productId
        );

        await db.query(
          `INSERT INTO creative.awareness_matrix
             (tenant_id, product_id, awareness_level, marketing_angle, concept_type,
              hook, relevance_signal, pain_amplification, desire_projection,
              emotional_gap, visual_proof, cta, hook_movement, hook_emotional,
              entity_id_variant, created_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15::jsonb,NOW())`,
          [
            task.tenantId, productId,
            winner.awareness_level, winner.marketing_angle, winner.concept_type,
            newBrief.hook, newBrief.relevanceSignal, newBrief.painAmplification,
            newBrief.desireProjection, newBrief.emotionalGap, newBrief.visualProof,
            newBrief.cta, newBrief.hookMovement, newBrief.hookEmotional,
            JSON.stringify(newEntityId),
          ]
        );

        iterationsCreated++;
      }
    }

    await this.trace('info', `${iterationsCreated} variations Entity ID cr\u00e9\u00e9es`, { productId });
    return { success: true, output: { iterationsCreated } };
  }

  private async detectCondors(task: AgentTask): Promise<AgentResult> {
    const condors = await db.query(
      `SELECT * FROM creative.awareness_matrix
       WHERE tenant_id=$1 AND condor_score >= 70
       ORDER BY condor_score DESC`,
      [task.tenantId]
    );
    return { success: true, output: { condors: condors.rows } };
  }

  // \u2500\u2500 Helpers \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

  private async getProductContext(productId: string, tenantId: string): Promise<ProductContext> {
    const r = await db.query(
      `SELECT p.name AS "productName", fa.usp, fa.personas, fa.ad_strategies AS "adStrategies",
              pe.break_even_roas, pe.contribution_margin_pct
       FROM store.products p
       LEFT JOIN intel.fast_analysis fa ON fa.product_id=p.id AND fa.tenant_id=p.tenant_id
       LEFT JOIN intel.product_equations pe ON pe.product_id=p.id AND pe.tenant_id=p.tenant_id
       WHERE p.id=$1 AND p.tenant_id=$2`,
      [productId, tenantId]
    );
    return r.rows[0] ?? { productName: productId };
  }

  private getNextFormat(current?: string): string {
    const formats = ['Reel 9:16', 'Story 9:16', 'Caroussel', 'Feed 1:1', 'Collection'];
    return formats.find(f => f !== current) ?? 'Reel 9:16';
  }

  private getNextPersona(current?: string): string {
    const personas = ['Femme 25-35', 'Homme 30-45', 'Cr\u00e9ateur UGC', 'Fondateur', 'Client avant/apr\u00e8s'];
    return personas.find(p => p !== current) ?? 'Client avant/apr\u00e8s';
  }

  private getNextDecor(current?: string): string {
    const decors = ['Maison / cuisine', 'Bureau', 'Ext\u00e9rieur / parc', 'Salle de bain', 'Voiture'];
    return decors.find(d => d !== current) ?? 'Bureau';
  }

  private getNextNarrativeVehicle(current?: string): string {
    const vehicles = ['T\u00e9moignage', 'D\u00e9monstration', 'POV', 'Situation relatable', 'Interview', 'R\u00e9v\u00e9lation'];
    return vehicles.find(v => v !== current) ?? 'D\u00e9monstration';
  }

  private async generateBrief(task: AgentTask): Promise<AgentResult> {
    return this.buildMatrix(task);
  }
}

// \u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550

/**
 * AGENT_OFFER_OPTIMIZER \u2014 Phase 4 : Formule Hormozi
 * \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
 * Value = (Dream Outcome \u00d7 Perceived Likelihood) / (Time \u00d7 Effort)
 *
 * Teste automatiquement : Bundle \u00b7 Decoy effect (3 packs) \u00b7 Bonus gratuit
 *                          Garantie forte \u00b7 Price anchoring \u00b7 Time compression
 */

export class OfferOptimizerAgent extends AgentBase {
  readonly agentId = 'AGENT_OFFER_OPTIMIZER';

  readonly supportedTasks = [
    'offer.stack_build',
    'offer.hormozi_score',
    'offer.decoy_price',
    'offer.test',
    'offer.impact_calculate',
  ];

  async execute(task: AgentTask): Promise<AgentResult> {
    switch (task.taskType) {
      case 'offer.stack_build':       return this.buildStack(task);
      case 'offer.hormozi_score':     return this.scoreHormozi(task);
      case 'offer.impact_calculate':  return this.calculateImpact(task);
      default: return this.buildStack(task);
    }
  }

  private async buildStack(task: AgentTask): Promise<AgentResult> {
    const { productId, basePrice, cogs, currentMarginPct } = task.payload as {
      productId:       string;
      basePrice:       number;
      cogs:            number;
      currentMarginPct?: number;
    };

    const ctx = await this.getProductCtx(productId, task.tenantId);

    // G\u00e9n\u00e9rer la structure de l'offre via LLM
    const prompt = `Tu es expert en offre irr\u00e9sistible (m\u00e9thode Hormozi + decoy pricing).
Produit : ${ctx.productName}
USP : ${JSON.stringify(ctx.usp)}
Prix de base : ${basePrice}\u20ac | COGS : ${cogs}\u20ac | Marge actuelle : ${currentMarginPct ?? 'inconnue'}%

G\u00e9n\u00e8re une offre stack optimis\u00e9e pour maximiser l'AOV et la valeur per\u00e7ue.

Formule Hormozi : Value = (Dream Outcome \u00d7 Perceived Likelihood) / (Time \u00d7 Effort)

R\u00e9ponds en JSON :
{
  "dreamOutcome": "...",
  "perceivedLikelihood": 85,
  "timeToResult": "en 14 jours",
  "effortRequired": "2 minutes par jour",
  "hormoziValueScore": 95.5,

  "packA": { "name": "Pack Starter", "price": ${Math.round(basePrice * 0.7)}, "contents": ["Produit x1"], "isAnchor": false },
  "packB": { "name": "Pack Recommand\u00e9 \u2b50", "price": ${Math.round(basePrice * 1.0)}, "contents": ["Produit x2", "Bonus X"], "isBestValue": true },
  "packC": { "name": "Pack Premium", "price": ${Math.round(basePrice * 1.8)}, "contents": ["Produit x3", "Bonus X", "Bonus Y", "Support VIP"], "isAnchor": true },

  "freeBonus": [{ "name": "Guide PDF", "valueEur": 27 }],
  "guaranteeDays": 30,
  "guaranteeText": "Satisfait ou rembours\u00e9 30 jours \u2014 sans justification",
  "anchorPrice": ${Math.round(basePrice * 2.5)},
  "anchorReason": "Valeur totale si achet\u00e9 s\u00e9par\u00e9ment",
  "urgencyType": "stock",
  "urgencyText": "Stock limit\u00e9 \u2014 Il reste X exemplaires",

  "explanation": "Pourquoi cette structure maximise les conversions"
}`;

    const raw = await this.callLLM({
      system: 'Expert en pricing psychologique et offre irr\u00e9sistible. R\u00e9ponds UNIQUEMENT en JSON valide.',
      user: prompt,
      maxTokens: 1200,
    });

    const offerData = JSON.parse(raw);

    // Calculer l'impact AOV
    const { aovImpact, newBreakEven, newMargin } = this.calculateImpactSync(
      basePrice, cogs, offerData, task.payload
    );

    const r = await db.query(
      `INSERT INTO store.offer_stacks
         (tenant_id, product_id,
          dream_outcome, perceived_likelihood, time_to_result, effort_required, hormozi_value_score,
          pack_a_name, pack_a_price, pack_a_contents,
          pack_b_name, pack_b_price, pack_b_contents, pack_b_is_best_value,
          pack_c_name, pack_c_price, pack_c_contents,
          free_bonus, guarantee_days, guarantee_text,
          anchor_price, anchor_reason, urgency_type, urgency_text,
          aov_impact_pct, break_even_roas_new, contribution_margin_new,
          is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,$11,$12,$13,$14,$15,$16,$17::jsonb,$18::jsonb,$19,$20,$21,$22,$23,$24,$25,$26,$27,TRUE)
       RETURNING id`,
      [
        task.tenantId, productId,
        offerData.dreamOutcome, offerData.perceivedLikelihood,
        offerData.timeToResult, offerData.effortRequired, offerData.hormoziValueScore,
        offerData.packA?.name, offerData.packA?.price, JSON.stringify(offerData.packA?.contents ?? []),
        offerData.packB?.name, offerData.packB?.price, JSON.stringify(offerData.packB?.contents ?? []), true,
        offerData.packC?.name, offerData.packC?.price, JSON.stringify(offerData.packC?.contents ?? []),
        JSON.stringify(offerData.freeBonus ?? []),
        offerData.guaranteeDays ?? 30, offerData.guaranteeText,
        offerData.anchorPrice, offerData.anchorReason,
        offerData.urgencyType ?? 'none', offerData.urgencyText,
        aovImpact, newBreakEven, newMargin,
      ]
    );

    // Signaler AGENT_STORE_BUILDER de reconstruire la landing page avec la nouvelle offre
    await db.query(
      `INSERT INTO agents.messages (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
       VALUES ($1,$2,'AGENT_STORE_BUILDER','COMMAND','REBUILD_OFFER_STACK',$3::jsonb,8,NOW())`,
      [
        task.tenantId, this.agentId,
        JSON.stringify({ productId, offerStackId: r.rows[0].id, aovImpact, newBreakEven }),
      ]
    );

    return {
      success: true,
      output: {
        offerStackId: r.rows[0].id,
        hormoziScore: offerData.hormoziValueScore,
        aovImpactPct: aovImpact,
        newBreakEven,
        newMargin,
        packBPrice: offerData.packB?.price,
      },
    };
  }

  private calculateImpactSync(
    basePrice: number,
    cogs: number,
    offer: Record<string, unknown>,
    payload: Record<string, unknown>
  ): { aovImpact: number; newBreakEven: number; newMargin: number } {
    const newAov = (offer.packB as Record<string, unknown>)?.price as number ?? basePrice * 1.2;
    const aovImpact = ((newAov - basePrice) / basePrice) * 100;
    const shipping = (payload.shippingCost as number) ?? 5;
    const fees = (payload.paymentFees as number) ?? basePrice * 0.03;
    const variableCost = cogs + shipping + fees;
    const newBreakEven = variableCost > 0 ? newAov / (newAov - variableCost) : 0;
    const cpa = (payload.estimatedCpa as number) ?? 20;
    const newMargin = ((newAov - variableCost - cpa) / newAov) * 100;
    return {
      aovImpact: Math.round(aovImpact * 100) / 100,
      newBreakEven: Math.round(newBreakEven * 100) / 100,
      newMargin: Math.round(newMargin * 100) / 100,
    };
  }

  private async scoreHormozi(task: AgentTask): Promise<AgentResult> {
    return this.buildStack(task);
  }

  private async calculateImpact(task: AgentTask): Promise<AgentResult> {
    return this.buildStack(task);
  }

  private async getProductCtx(productId: string, tenantId: string) {
    const r = await db.query(
      `SELECT p.name AS "productName", fa.usp, fa.objections
       FROM store.products p
       LEFT JOIN intel.fast_analysis fa ON fa.product_id=p.id AND fa.tenant_id=p.tenant_id
       WHERE p.id=$1`,
      [productId]
    );
    return r.rows[0] ?? { productName: productId };
  }
}

// \u2500\u2500 Types locaux \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

interface BriefRequest { level: string; angle: string; concept: string }
interface EntityIdVariant { format?: string; persona?: string; decor?: string; narrativeVehicle?: string }
interface CreativeBrief extends BriefRequest {
  hook: string; relevanceSignal: string; painAmplification: string;
  desireProjection: string; emotionalGap: string; visualProof: string; cta: string;
  hookMovement: string; hookEmotional: string; entityIdVariant: EntityIdVariant; personaId?: null;
}
interface WinnerPatterns { winningAwarenessLevels?: string[]; winningConceptTypes?: string[]; nextIterationRecommendation?: string }
interface ProductContext { productName: string; usp?: unknown; personas?: unknown[]; adStrategies?: unknown; breakEvenRoas?: number; contributionMarginPct?: number }

function chunkArray<T>(arr: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(arr.length / size) }, (_, i) => arr.slice(i * size, i * size + size));
}
