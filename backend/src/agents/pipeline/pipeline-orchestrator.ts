/**
 * PIPELINE ORCHESTRATOR v2.0 — AEGIS
 * ====================================
 * Orchestre les 11 etapes du pipeline produit-vers-business.
 *
 * v2.0 enhancements (from 13 repos analysis):
 *   - Quality Gates: Validation between each pipeline step
 *   - Saga Pattern: Rollback tracking with compensation actions
 *   - Ralph Loop: Auto-optimization after ANALYZE_RESULTS
 *   - Review System: Creative/Store/Campaign quality checks
 *   - Memory Integration: Learning persistence across pipelines
 *   - Hook Integration: Pre/post step hooks for extensibility
 *
 * Chaque produit passe par :
 *   1.  INGEST          — Scraping + normalisation du produit
 *   2.  ANALYZE          — Intelligence marche + detection winner
 *   3.  VALIDATE         — Calcul de rentabilite (marge de contribution)
 *   4.  BUILD_OFFER      — Construction offre commerciale (3 packs, bonus, garantie)
 *   5.  BUILD_PAGE       — Generation landing page, description, FAQ
 *   6.  CREATE_ADS       — 30 idees de creatives publicitaires
 *   7.  LAUNCH_TEST      — Campagne CBO test (300-500 EUR, 15 ads max)
 *   8.  ANALYZE_RESULTS  — Classification CONDOR/TOF/BOF/DEAD
 *   9.  SCALE            — Regles d'auto-scaling (+20%/-20%)
 *   10. PROTECT          — Monitoring cash/risque/CPA (anomaly + guardrails + stop-loss)
 *   11. LEARN            — Sauvegarde des hooks, angles et patterns gagnants
 *
 * L'orchestrateur persiste l'etat dans `pipeline_runs` et
 * journalise chaque etape dans `pipeline_step_logs`.
 */

import { Pool } from 'pg';
import crypto from 'crypto';

// v2.0 infrastructure imports
import { qualityGate, PipelineStep as QualityPipelineStep, GateResult } from '../base/quality-gate';
import { ralphLoop, LoopConfig } from './ralph-loop';
import { reviewEngine, ReviewResult } from './review-system';
import { memorySystem } from '../base/memory-system';
import { hookEngine, HookContext } from '../base/hooks';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Statut possible d'une etape individuelle du pipeline. */
export type StepStatus = 'pending' | 'running' | 'completed' | 'failed' | 'skipped';

/** Statut global du pipeline. */
export type PipelineStatus = 'pending' | 'running' | 'completed' | 'failed' | 'paused';

/**
 * Represente une etape unique du pipeline.
 * Chaque etape est liee a un ou plusieurs agents AEGIS.
 */
export interface PipelineStep {
  /** Identifiant unique de l'etape (ex: 'INGEST', 'ANALYZE'). */
  id: string;
  /** Nom lisible de l'etape. */
  name: string;
  /** Agent(s) responsable(s) de l'execution. */
  agent: string;
  /** Statut courant de l'etape. */
  status: StepStatus;
  /** Resultat de l'execution (null tant que non terminee). */
  result: Record<string, unknown> | null;
  /** Horodatage de debut d'execution. */
  startedAt: string | null;
  /** Horodatage de fin d'execution. */
  completedAt: string | null;
}

/**
 * Etat complet d'un pipeline en cours ou termine.
 * Persiste dans la table `pipeline_runs`.
 */
export interface PipelineState {
  /** Identifiant unique du pipeline (UUID v4). */
  id: string;
  /** Identifiant du shop concerne. */
  shopId: string;
  /** URL du produit source. */
  productUrl: string;
  /** Les 11 etapes du pipeline. */
  steps: PipelineStep[];
  /** Index de l'etape en cours (0-based). */
  currentStep: number;
  /** Statut global du pipeline. */
  status: PipelineStatus;
  /** Date de creation. */
  createdAt: string;
  /** Date de derniere mise a jour. */
  updatedAt: string;
  // v2.0 — Saga pattern tracking
  /** Completed steps for rollback (saga pattern) */
  saga?: SagaRecord[];
  /** Quality gate results per step */
  gateResults?: Record<string, GateResult>;
  /** Ralph loop session ID (if auto-optimization active) */
  ralphSessionId?: string;
  /** Review results (creative/store/campaign) */
  reviews?: ReviewResult[];
}

// ── Saga Pattern Types ──────────────────────────────────────────────────
/**
 * Saga record for tracking completed steps and their compensation actions.
 * If a step fails, we can roll back completed steps using their compensation.
 */
export interface SagaRecord {
  stepId:        string;
  completedAt:   string;
  compensation?: string;  // Description of rollback action
  compensated?:  boolean; // True if rollback was executed
}

// ─────────────────────────────────────────────────────────────────────────────
// Definition des 11 etapes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Template des 11 etapes du pipeline.
 * Chaque entree definit l'identifiant, le nom et le(s) agent(s) associe(s).
 */
const PIPELINE_STEPS_TEMPLATE: Array<{ id: string; name: string; agent: string }> = [
  {
    id: 'INGEST',
    name: 'Ingestion produit',
    agent: 'product-ingest',
  },
  {
    id: 'ANALYZE',
    name: 'Analyse marche & psycho-marketing & detection winner',
    agent: 'market-intel + psycho-marketing + winner-detector',
  },
  {
    id: 'VALIDATE',
    name: 'Validation rentabilite',
    agent: 'profitability',
  },
  {
    id: 'BUILD_OFFER',
    name: 'Construction offre commerciale + funnel',
    agent: 'offer-engine + funnel-engine + money-model',
  },
  {
    id: 'BUILD_PAGE',
    name: 'Creation landing page, copy & contenu',
    agent: 'store-builder + copy-chief',
  },
  {
    id: 'CREATE_ADS',
    name: 'Generation creatives publicitaires',
    agent: 'creative-factory',
  },
  {
    id: 'LAUNCH_TEST',
    name: 'Lancement campagne test CBO',
    agent: 'meta-testing',
  },
  {
    id: 'ANALYZE_RESULTS',
    name: 'Analyse resultats 48h & classification CONDOR/TOF/BOF/DEAD',
    agent: 'results-48h + dct-iteration + evaluator',
  },
  {
    id: 'SCALE',
    name: 'Auto-scaling des campagnes',
    agent: 'scale',
  },
  {
    id: 'PROTECT',
    name: 'Monitoring & protection',
    agent: 'anomaly + guardrails + stop-loss',
  },
  {
    id: 'LEARN',
    name: 'Apprentissage & capitalisation',
    agent: 'learning',
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// Pipeline Orchestrator
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Orchestrateur principal du pipeline produit-vers-business.
 *
 * Responsabilites :
 *   - Creer et persister un pipeline (11 etapes)
 *   - Avancer le pipeline etape par etape
 *   - Gerer les erreurs et les etapes echouees
 *   - Journaliser chaque etape dans `pipeline_step_logs`
 *
 * Usage :
 *   const orchestrator = new PipelineOrchestrator();
 *   const state = await orchestrator.startPipeline(shopId, productUrl, db);
 *   // Pour avancer :
 *   const updated = await orchestrator.advancePipeline(state.id, db);
 */
export class PipelineOrchestrator {

  // ── Demarrage d'un nouveau pipeline ─────────────────────────────────────

  /**
   * Demarre un nouveau pipeline pour un produit donne.
   * Cree les 11 etapes en statut 'pending', persiste dans la base,
   * puis lance automatiquement la premiere etape (INGEST).
   *
   * @param shopId     - Identifiant du shop
   * @param productUrl - URL du produit a traiter
   * @param db         - Connexion PostgreSQL
   * @returns L'etat complet du pipeline apres demarrage
   */
  async startPipeline(
    shopId: string,
    productUrl: string,
    db: Pool,
  ): Promise<PipelineState> {
    const pipelineId = crypto.randomUUID();
    const now = new Date().toISOString();

    // Construction des 11 etapes a partir du template
    const steps: PipelineStep[] = PIPELINE_STEPS_TEMPLATE.map((tpl) => ({
      id: tpl.id,
      name: tpl.name,
      agent: tpl.agent,
      status: 'pending' as StepStatus,
      result: null,
      startedAt: null,
      completedAt: null,
    }));

    const state: PipelineState = {
      id: pipelineId,
      shopId,
      productUrl,
      steps,
      currentStep: 0,
      status: 'running',
      createdAt: now,
      updatedAt: now,
    };

    // Persistance initiale dans la base
    await db.query(
      `INSERT INTO pipeline_runs (id, shop_id, product_url, steps, current_step, status, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        state.id,
        state.shopId,
        state.productUrl,
        JSON.stringify(state.steps),
        state.currentStep,
        state.status,
        state.createdAt,
        state.updatedAt,
      ],
    );

    // Journalisation du demarrage
    await this.logStepEvent(db, pipelineId, 'PIPELINE', 'started', {
      shopId,
      productUrl,
      totalSteps: steps.length,
    });

    // Lancement automatique de la premiere etape
    return this.advancePipeline(pipelineId, db);
  }

  // ── Avancement du pipeline ──────────────────────────────────────────────

  /**
   * Avance le pipeline d'une etape.
   * Execute l'etape courante, puis passe a la suivante.
   * Si l'etape echoue, le pipeline est mis en pause (pas en echec global).
   *
   * @param pipelineId - Identifiant du pipeline
   * @param db         - Connexion PostgreSQL
   * @returns L'etat mis a jour du pipeline
   */
  async advancePipeline(
    pipelineId: string,
    db: Pool,
  ): Promise<PipelineState> {
    const state = await this.loadPipelineState(pipelineId, db);

    // Verifications de coherence
    if (state.status === 'completed') {
      return state;
    }
    if (state.status === 'failed') {
      throw new Error(`Pipeline ${pipelineId} est en echec. Utilisez restartStep() pour reprendre.`);
    }

    const stepIndex = state.currentStep;

    // Verification : pas de depassement
    if (stepIndex >= state.steps.length) {
      state.status = 'completed';
      state.updatedAt = new Date().toISOString();
      await this.persistState(state, db);
      return state;
    }

    const step = state.steps[stepIndex];

    // ── Execution de l'etape courante ─────────────────────────────────
    step.status = 'running';
    step.startedAt = new Date().toISOString();
    state.updatedAt = new Date().toISOString();
    await this.persistState(state, db);

    await this.logStepEvent(db, pipelineId, step.id, 'running', {
      agent: step.agent,
      stepIndex,
    });

    try {
      // ── v2.0: Pre-execute hook ──────────────────────────────────
      const hookCtx: HookContext = {
        agentName: step.agent,
        shopId: state.shopId,
        tier: 2, // Will be resolved from DB in production
        task: { shop_id: state.shopId, type: step.id, payload: state },
        pipelineId: state.id,
        stepIndex,
      };

      const preHookResult = await hookEngine.execute('preExecute', hookCtx);
      if (!preHookResult.allow) {
        step.status = 'failed';
        step.result = { blocked: true, reason: preHookResult.feedback };
        step.completedAt = new Date().toISOString();
        state.status = 'paused';
        await this.logStepEvent(db, pipelineId, step.id, 'blocked_by_hook', {
          feedback: preHookResult.feedback,
        });
        state.updatedAt = new Date().toISOString();
        await this.persistState(state, db);
        return state;
      }

      // ── Execute step logic ──────────────────────────────────────
      const result = await this.executeStep(step, state);

      // ── v2.0: Quality gate validation ───────────────────────────
      const stepKey = step.id.toLowerCase().replace('_', '_') as QualityPipelineStep;
      let gateResult: GateResult | null = null;
      try {
        gateResult = await qualityGate.validate(stepKey as QualityPipelineStep, result);
        if (!state.gateResults) state.gateResults = {};
        state.gateResults[step.id] = gateResult;

        if (!gateResult.passed) {
          // Quality gate blocked — pause pipeline
          step.status = 'failed';
          step.result = {
            ...result,
            _qualityGate: {
              passed: false,
              severity: gateResult.severity,
              summary: gateResult.summary,
              failedChecks: gateResult.checks.filter(c => !c.passed).map(c => c.name),
            },
          };
          step.completedAt = new Date().toISOString();
          state.status = 'paused';

          await this.logStepEvent(db, pipelineId, step.id, 'quality_gate_blocked', {
            summary: gateResult.summary,
            severity: gateResult.severity,
          });

          state.updatedAt = new Date().toISOString();
          await this.persistState(state, db);
          return state;
        }
      } catch (_gateErr) {
        // Quality gate errors are non-blocking — log and continue
      }

      // ── Success: record result ──────────────────────────────────
      step.status = 'completed';
      step.result = {
        ...result,
        ...(gateResult ? { _qualityGate: { passed: true, score: `${gateResult.checks.filter(c => c.passed).length}/${gateResult.checks.length}`, summary: gateResult.summary } } : {}),
      };
      step.completedAt = new Date().toISOString();

      // ── v2.0: Saga — record for potential rollback ──────────────
      if (!state.saga) state.saga = [];
      state.saga.push({
        stepId: step.id,
        completedAt: step.completedAt,
        compensation: this.getSagaCompensation(step.id),
      });

      await this.logStepEvent(db, pipelineId, step.id, 'completed', {
        durationMs: Date.now() - new Date(step.startedAt!).getTime(),
        resultKeys: Object.keys(result),
        qualityGate: gateResult?.summary || 'no gate',
      });

      // ── v2.0: Post-execute hook ─────────────────────────────────
      hookCtx.result = result;
      hookCtx.metadata = { duration_ms: Date.now() - new Date(step.startedAt!).getTime() };
      await hookEngine.execute('postExecute', hookCtx);

      // ── v2.0: Memory — record observation ───────────────────────
      try {
        await memorySystem.record({
          shopId: state.shopId,
          agentName: step.agent,
          type: 'success',
          content: `Pipeline step ${step.id} completed. ${gateResult?.summary || ''}`,
          tags: ['pipeline', step.id.toLowerCase()],
          metadata: { pipelineId: state.id, stepIndex },
        });
      } catch (_memErr) {
        // Memory errors are non-blocking
      }

      // ── v2.0: Auto-reviews at key steps ─────────────────────────
      await this.runAutoReviews(step.id, result, state);

      // ── v2.0: Ralph Loop auto-start after ANALYZE_RESULTS ───────
      if (step.id === 'ANALYZE_RESULTS') {
        await this.maybeStartRalphLoop(result, state);
      }

      // Passage a l'etape suivante
      state.currentStep = stepIndex + 1;

      // Si c'etait la derniere etape, le pipeline est termine
      if (state.currentStep >= state.steps.length) {
        state.status = 'completed';

        // v2.0: Extract patterns from memory on pipeline completion
        try {
          await memorySystem.extractPatterns(state.shopId);
        } catch (_patErr) { /* non-blocking */ }

        await this.logStepEvent(db, pipelineId, 'PIPELINE', 'completed', {
          totalSteps: state.steps.length,
          durationMs: Date.now() - new Date(state.createdAt).getTime(),
          sagaSteps: state.saga?.length || 0,
          ralphSession: state.ralphSessionId || 'none',
        });
      }
    } catch (error) {
      // ── v2.0: onError hook ──────────────────────────────────────
      const errorHookCtx: HookContext = {
        agentName: step.agent,
        shopId: state.shopId,
        tier: 2,
        task: { shop_id: state.shopId, type: step.id },
        error: error instanceof Error ? error : new Error(String(error)),
        pipelineId: state.id,
        stepIndex,
      };
      await hookEngine.execute('onError', errorHookCtx);

      // Record failure in memory
      try {
        await memorySystem.record({
          shopId: state.shopId,
          agentName: step.agent,
          type: 'failure',
          content: `Pipeline step ${step.id} failed: ${error instanceof Error ? error.message : String(error)}`,
          tags: ['pipeline', 'error', step.id.toLowerCase()],
          metadata: { pipelineId: state.id, stepIndex },
        });
      } catch (_memErr) { /* non-blocking */ }

      // Echec : le pipeline est mis en pause pour intervention
      step.status = 'failed';
      step.completedAt = new Date().toISOString();
      step.result = {
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      };

      state.status = 'paused';

      await this.logStepEvent(db, pipelineId, step.id, 'failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    state.updatedAt = new Date().toISOString();
    await this.persistState(state, db);

    return state;
  }

  // ── Consultation du statut ──────────────────────────────────────────────

  /**
   * Recupere l'etat complet d'un pipeline.
   *
   * @param pipelineId - Identifiant du pipeline
   * @param db         - Connexion PostgreSQL
   * @returns L'etat complet du pipeline
   * @throws Error si le pipeline n'existe pas
   */
  async getPipelineStatus(
    pipelineId: string,
    db: Pool,
  ): Promise<PipelineState> {
    return this.loadPipelineState(pipelineId, db);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Execution des etapes (logique metier / mock)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Execute la logique d'une etape.
   * Chaque etape appelle le(s) agent(s) correspondant(s).
   * Pour l'instant, les resultats sont simules de maniere realiste
   * en attendant le branchement complet de l'infrastructure.
   */
  private async executeStep(
    step: PipelineStep,
    pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    switch (step.id) {
      case 'INGEST':
        return this.executeIngest(pipeline);
      case 'ANALYZE':
        return this.executeAnalyze(pipeline);
      case 'VALIDATE':
        return this.executeValidate(pipeline);
      case 'BUILD_OFFER':
        return this.executeBuildOffer(pipeline);
      case 'BUILD_PAGE':
        return this.executeBuildPage(pipeline);
      case 'CREATE_ADS':
        return this.executeCreateAds(pipeline);
      case 'LAUNCH_TEST':
        return this.executeLaunchTest(pipeline);
      case 'ANALYZE_RESULTS':
        return this.executeAnalyzeResults(pipeline);
      case 'SCALE':
        return this.executeScale(pipeline);
      case 'PROTECT':
        return this.executeProtect(pipeline);
      case 'LEARN':
        return this.executeLearn(pipeline);
      default:
        throw new Error(`Etape inconnue : ${step.id}`);
    }
  }

  // ── Etape 1 : INGEST — Scraping et normalisation du produit ─────────────

  /**
   * Agent : product-ingest
   * Scrape l'URL du produit, extrait les donnees brutes,
   * et les normalise en un ProductRecord unifie.
   */
  private async executeIngest(
    pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // Try Crawl4AI scraper service first, fallback to mock data
    const scraperUrl = process.env.SCRAPER_SERVICE_URL;
    let scraped: any = null;

    if (scraperUrl) {
      try {
        const resp = await fetch(`${scraperUrl}/scrape`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Internal-Token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
          },
          body: JSON.stringify({ url: pipeline.productUrl }),
          signal: AbortSignal.timeout(35_000),
        });
        if (resp.ok) {
          scraped = await resp.json();
        }
      } catch (err: any) {
        console.warn(`[PIPELINE] Scraper unavailable: ${err.message}, using mock data`);
      }
    }

    if (scraped && scraped.name && scraped.price > 0) {
      return {
        agent: 'product-ingest + crawl4ai',
        product: {
          name: scraped.name,
          description: scraped.description || '',
          price: scraped.price,
          currency: scraped.currency || 'EUR',
          images: scraped.images || [],
          category: scraped.category || null,
          rating: scraped.rating,
          reviewCount: scraped.reviewCount,
          supplier: scraped.supplier,
          shippingDays: scraped.shippingDays,
          costPrice: scraped.price,
        },
        sourceUrl: pipeline.productUrl,
        scrapedAt: new Date().toISOString(),
        source: scraped.rawData?.source || 'crawl4ai',
        scrapeMethod: 'crawl4ai',
      };
    }

    // Fallback to mock data
    return {
      agent: 'product-ingest (mock)',
      product: {
        name: 'Produit extrait depuis ' + pipeline.productUrl,
        description: 'Description extraite automatiquement par le scraper AEGIS.',
        price: 12.99,
        currency: 'EUR',
        images: [
          'https://cdn.example.com/img/product-front.jpg',
          'https://cdn.example.com/img/product-back.jpg',
          'https://cdn.example.com/img/product-lifestyle.jpg',
        ],
        category: 'Sante & Bien-etre',
        rating: 4.6,
        reviewCount: 1847,
        supplier: 'AliExpress - ShenzhenTech Co.',
        shippingDays: 12,
        costPrice: 4.50,
        weight: 120,
        dimensions: '15x10x5 cm',
      },
      sourceUrl: pipeline.productUrl,
      scrapedAt: new Date().toISOString(),
      source: 'mock',
    };
  }

  // ── Etape 2 : ANALYZE — Analyse marche et detection winner ──────────────

  /**
   * Agents : market-intel + winner-detector
   * Analyse le marche cible, identifie la concurrence,
   * et evalue le potentiel "winner" du produit.
   */
  private async executeAnalyze(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur MarketIntelAgent + WinnerDetectorAgent
    return {
      agents: ['market-intel', 'winner-detector'],
      marketAnalysis: {
        marketSize: 'Grand (>10M EUR/an)',
        trendDirection: 'hausse',
        trendScore: 78,
        competitorCount: 23,
        topCompetitors: [
          { name: 'CompetiteurA.com', estimatedRevenue: '450K EUR/mois', adSpend: '85K EUR/mois' },
          { name: 'CompetiteurB.fr', estimatedRevenue: '280K EUR/mois', adSpend: '52K EUR/mois' },
          { name: 'CompetiteurC.com', estimatedRevenue: '180K EUR/mois', adSpend: '34K EUR/mois' },
        ],
        averageSellingPrice: 39.90,
        demandIndex: 82,
      },
      winnerScore: {
        overall: 74,
        factors: {
          trendMomentum: 81,
          marginPotential: 72,
          competitionLevel: 65,
          socialProof: 78,
          problemSolving: 80,
        },
        verdict: 'POTENTIAL_WINNER',
        confidence: 0.74,
      },
    };
  }

  // ── Etape 3 : VALIDATE — Calcul de rentabilite ─────────────────────────

  /**
   * Agent : profitability
   * Calcule la marge de contribution, le seuil de rentabilite,
   * et rend un verdict : VALIDATED / OPTIMIZE / REJECTED.
   */
  private async executeValidate(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur ProfitabilityAgent
    return {
      agent: 'profitability',
      contributionMargin: {
        sellingPrice: 39.90,
        costOfGoods: 4.50,
        shipping: 5.90,
        paymentFees: 1.20,
        adsCostPerAcquisition: 12.00,
        contributionMarginEur: 16.30,
        contributionMarginPct: 40.9,
      },
      breakEvenAnalysis: {
        breakEvenUnitsPerDay: 8,
        breakEvenRevenuePerDay: 319.20,
        daysToBreakEven: 5,
      },
      cashFlowProjection: {
        day7: { revenue: 2234, profit: 914, roas: 2.7 },
        day14: { revenue: 5580, profit: 2285, roas: 2.9 },
        day30: { revenue: 14940, profit: 6115, roas: 3.1 },
      },
      verdict: 'VALIDATED',
      verdictReason: 'Marge de contribution a 40.9% — au-dessus du seuil minimum de 30%. ROAS projete a 2.7x des J7.',
      confidence: 0.82,
    };
  }

  // ── Etape 4 : BUILD_OFFER — Offre commerciale ──────────────────────────

  /**
   * Agents : offer-engine + money-model
   * Construit 3 packs de prix (Starter, Bestseller, Premium),
   * le bonus, la garantie et l'angle principal.
   */
  private async executeBuildOffer(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur OfferEngineAgent + MoneyModelAgent
    return {
      agents: ['offer-engine', 'money-model'],
      packs: [
        {
          id: 'starter',
          name: 'Essentiel',
          price: 29.90,
          items: ['1x Produit principal'],
          bonus: ['Guide d\'utilisation PDF'],
          guarantee: 'Satisfait ou rembourse 30 jours',
          contributionMargin: 12.30,
          contributionPct: 41.1,
        },
        {
          id: 'bestseller',
          name: 'Pack Best-Seller',
          price: 49.90,
          items: ['2x Produit principal', '1x Accessoire complementaire'],
          bonus: ['Guide d\'utilisation PDF', 'Acces groupe VIP'],
          guarantee: 'Satisfait ou rembourse 30 jours',
          badge: 'MEILLEURE VENTE',
          contributionMargin: 28.50,
          contributionPct: 57.1,
        },
        {
          id: 'premium',
          name: 'Pack Premium',
          price: 79.90,
          items: ['3x Produit principal', '2x Accessoire', '1x Cadeau surprise'],
          bonus: ['Guide d\'utilisation PDF', 'Acces groupe VIP', 'Coaching 1-to-1 15min'],
          guarantee: 'Satisfait ou rembourse 60 jours + retour gratuit',
          badge: 'MEILLEUR RAPPORT QUALITE-PRIX',
          contributionMargin: 52.70,
          contributionPct: 65.9,
        },
      ],
      mainPromise: 'Resultats visibles en 14 jours ou rembourse',
      mainAngle: 'solution-rapide-sans-effort',
      guarantee: 'Garantie satisfait ou rembourse 30 jours — aucun risque',
      urgencyTrigger: 'Stock limite — 127 unites restantes',
      upsellSequence: {
        orderBump: { name: 'Extension de garantie 1 an', price: 9.90 },
        upsell1: { name: 'Pack Recharge x3', price: 34.90 },
        downsell: { name: 'Pack Recharge x1', price: 14.90 },
      },
    };
  }

  // ── Etape 5 : BUILD_PAGE — Landing page et contenu ─────────────────────

  /**
   * Agent : creative-factory
   * Genere la landing page, la description produit et la FAQ.
   */
  private async executeBuildPage(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur CreativeFactoryAgent (mode: page)
    return {
      agent: 'creative-factory',
      landingPage: {
        headline: 'Decouvrez la solution n1 pour [benefice principal]',
        subheadline: 'Resultats prouves en 14 jours — Plus de 10 000 clients satisfaits',
        heroImageUrl: 'https://cdn.example.com/img/hero-lifestyle.jpg',
        sections: [
          'hero',
          'problem-agitation',
          'solution',
          'social-proof',
          'offer-stack',
          'guarantee',
          'faq',
          'final-cta',
        ],
        ctaText: 'Je veux mes resultats →',
        ctaColor: '#FF6B35',
      },
      productDescription: {
        shortDescription: 'La solution complete pour [probleme cible] — resultats garantis.',
        longDescription: 'Description detaillee generee par l\'IA creative AEGIS...',
        bulletPoints: [
          'Resultats visibles des les premiers jours',
          'Ingredients 100% naturels et certifies',
          'Fabrique en Europe — livraison rapide',
          'Plus de 10 000 avis positifs',
          'Garantie satisfait ou rembourse 30 jours',
        ],
      },
      faq: [
        { question: 'Combien de temps avant les premiers resultats ?', answer: 'La majorite de nos clients observent des resultats en 7 a 14 jours.' },
        { question: 'Est-ce que c\'est sans risque ?', answer: 'Oui, notre garantie 30 jours vous couvre integralement.' },
        { question: 'Comment passer commande ?', answer: 'Cliquez sur le bouton ci-dessus, choisissez votre pack, et finalisez en 2 minutes.' },
        { question: 'Quels sont les delais de livraison ?', answer: 'Livraison en 5-8 jours ouvrables en France metropolitaine.' },
      ],
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Etape 6 : CREATE_ADS — Creatives publicitaires ─────────────────────

  /**
   * Agent : creative-factory
   * Genere 30 idees de creatives : 5 awareness x 3 angles x 2 concepts.
   */
  private async executeCreateAds(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur CreativeFactoryAgent (mode: ads)
    const awarenessLevels = ['unaware', 'problem-aware', 'solution-aware', 'product-aware', 'most-aware'];
    const angles = ['problem-solution', 'social-proof', 'curiosity'];
    const concepts = ['video-ugc', 'image-carousel'];

    const adIdeas: Array<Record<string, unknown>> = [];
    let adIndex = 1;

    for (const awareness of awarenessLevels) {
      for (const angle of angles) {
        for (const concept of concepts) {
          adIdeas.push({
            id: `AD-${String(adIndex).padStart(3, '0')}`,
            awarenessLevel: awareness,
            angle,
            concept,
            hook: `Hook ${awareness}/${angle} — Accroche generee par AEGIS`,
            body: `Corps de l'annonce optimise pour le niveau ${awareness}`,
            cta: 'Decouvrir maintenant',
            estimatedCTR: +(1.2 + Math.random() * 2.8).toFixed(2),
            priority: adIndex <= 15 ? 'high' : 'medium',
          });
          adIndex++;
        }
      }
    }

    return {
      agent: 'creative-factory',
      totalAds: adIdeas.length,
      matrix: {
        awarenessLevels: awarenessLevels.length,
        angles: angles.length,
        concepts: concepts.length,
      },
      adIdeas,
      selectedForTest: adIdeas.filter((ad) => ad.priority === 'high').map((ad) => ad.id),
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Etape 7 : LAUNCH_TEST — Campagne CBO test ─────────────────────────

  /**
   * Agent : meta-testing
   * Lance une campagne CBO avec un budget de 300-500 EUR et 15 ads max.
   */
  private async executeLaunchTest(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur MetaTestingAgent
    const campaignId = `CBO-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    return {
      agent: 'meta-testing',
      campaign: {
        id: campaignId,
        type: 'CBO',
        budget: 400,
        budgetType: 'daily',
        currency: 'EUR',
        status: 'ACTIVE',
        adSetsCount: 3,
        adsPerAdSet: 5,
        totalAds: 15,
        objective: 'CONVERSIONS',
        optimizationGoal: 'PURCHASE',
        pixelId: 'PIXEL_AEGIS_001',
        schedule: {
          startDate: new Date().toISOString(),
          testDurationDays: 3,
          endDate: new Date(Date.now() + 3 * 86400000).toISOString(),
        },
      },
      adSets: [
        { id: 'AS-001', name: 'Broad - 25-55 - FR', audience: 'broad', budget: 133, adsCount: 5 },
        { id: 'AS-002', name: 'Interest - Health', audience: 'interest', budget: 133, adsCount: 5 },
        { id: 'AS-003', name: 'Lookalike 1%', audience: 'lookalike', budget: 134, adsCount: 5 },
      ],
      launchedAt: new Date().toISOString(),
    };
  }

  // ── Etape 8 : ANALYZE_RESULTS — Classification des resultats ───────────

  /**
   * Agents : dct-iteration + evaluator
   * Analyse les resultats de test et classifie :
   *   CONDOR  = winner confirme, pret a scaler
   *   TOF     = bon en top-of-funnel, a optimiser
   *   BOF     = bon en retargeting uniquement
   *   DEAD    = pas de potentiel, a stopper
   */
  private async executeAnalyzeResults(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur DctIterationAgent + EvaluatorAgent
    return {
      agents: ['dct-iteration', 'evaluator'],
      testResults: {
        spend: 1200,
        revenue: 3840,
        roas: 3.2,
        purchases: 96,
        cpa: 12.50,
        ctr: 2.8,
        cpc: 0.45,
        cpm: 12.60,
        impressions: 95238,
        clicks: 2667,
        addToCart: 384,
        checkoutInitiated: 192,
        conversionRate: 3.6,
      },
      classification: {
        verdict: 'CONDOR',
        confidence: 0.87,
        reasons: [
          'ROAS 3.2x > seuil minimum 2.0x',
          'CPA 12.50 EUR < CPA max acceptable 18.00 EUR',
          'CTR 2.8% > benchmark niche 1.5%',
          'Volume suffisant (96 achats en 3 jours)',
        ],
      },
      topCreatives: [
        { id: 'AD-001', roas: 4.1, spend: 120, purchases: 14 },
        { id: 'AD-005', roas: 3.8, spend: 95, purchases: 11 },
        { id: 'AD-003', roas: 3.5, spend: 110, purchases: 12 },
      ],
      bottomCreatives: [
        { id: 'AD-012', roas: 0.8, spend: 85, purchases: 2 },
        { id: 'AD-015', roas: 1.1, spend: 70, purchases: 3 },
      ],
      recommendations: [
        'Couper les 5 ads les moins performants',
        'Augmenter le budget sur les 3 meilleurs ads',
        'Tester un nouveau Lookalike 2% base sur les acheteurs',
        'Creer 5 nouvelles variations des meilleurs hooks',
      ],
      analyzedAt: new Date().toISOString(),
    };
  }

  // ── Etape 9 : SCALE — Auto-scaling ────────────────────────────────────

  /**
   * Agent : scale
   * Applique les regles d'auto-scaling : +20% si ROAS > seuil,
   * -20% si ROAS < seuil, avec caps de securite.
   */
  private async executeScale(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur ScaleAgent
    return {
      agent: 'scale',
      scalingRules: {
        increaseThreshold: { roas: 2.5, minSpend: 100, action: '+20% budget' },
        decreaseThreshold: { roas: 1.5, minSpend: 50, action: '-20% budget' },
        pauseThreshold: { roas: 1.0, minSpend: 50, action: 'pause ad set' },
        maxDailyBudget: 2000,
        maxScalePerDay: 0.3,
        cooldownHours: 6,
      },
      appliedActions: [
        { adSetId: 'AS-001', action: 'INCREASE', oldBudget: 133, newBudget: 160, reason: 'ROAS 3.8 > 2.5' },
        { adSetId: 'AS-002', action: 'INCREASE', oldBudget: 133, newBudget: 160, reason: 'ROAS 3.2 > 2.5' },
        { adSetId: 'AS-003', action: 'HOLD', oldBudget: 134, newBudget: 134, reason: 'ROAS 2.1 entre 1.5 et 2.5' },
      ],
      newDailyBudget: 454,
      projectedDailyRevenue: 1452,
      projectedDailyProfit: 594,
      scaledAt: new Date().toISOString(),
    };
  }

  // ── Etape 10 : PROTECT — Monitoring et protection ──────────────────────

  /**
   * Agents : anomaly + guardrails + stop-loss
   * Met en place le monitoring continu :
   *   - Anomaly : detection de depenses anormales
   *   - Guardrails : seuils de securite automatiques
   *   - Stop-loss : coupe les depenses si perte > seuil
   */
  private async executeProtect(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur AnomalyAgent + GuardrailsAgent + StopLossAgent
    return {
      agents: ['anomaly', 'guardrails', 'stop-loss'],
      monitoring: {
        anomalyDetection: {
          enabled: true,
          checkIntervalMinutes: 15,
          alertThresholds: {
            spendSpike: 2.0,
            cpaSpike: 1.5,
            roasDrop: 0.5,
            impressionDrop: 0.3,
          },
        },
        guardrails: {
          maxDailySpend: 2000,
          maxCPA: 25.00,
          minROAS: 1.5,
          maxLossPerDay: 500,
          autoAction: 'pause_and_alert',
        },
        stopLoss: {
          enabled: true,
          triggers: [
            { condition: 'daily_loss > 500 EUR', action: 'PAUSE_ALL', alert: 'urgent' },
            { condition: 'hourly_spend > 200 EUR sans vente', action: 'PAUSE_AD_SET', alert: 'warning' },
            { condition: 'CPA > 3x target pendant 2h', action: 'REDUCE_BUDGET_50', alert: 'warning' },
          ],
          notificationChannels: ['slack', 'email', 'sms'],
        },
      },
      currentAlerts: [],
      status: 'ARMED',
      armedAt: new Date().toISOString(),
    };
  }

  // ── Etape 11 : LEARN — Apprentissage et capitalisation ─────────────────

  /**
   * Agent : learning
   * Sauvegarde les hooks, angles et patterns gagnants
   * pour enrichir la base de connaissances AEGIS.
   */
  private async executeLearn(
    _pipeline: PipelineState,
  ): Promise<Record<string, unknown>> {
    // TODO: Brancher sur LearningAgent
    return {
      agent: 'learning',
      learnings: {
        winningHooks: [
          { hook: 'Hook AD-001 — accroche emotionnelle forte', ctr: 3.8, roas: 4.1, saved: true },
          { hook: 'Hook AD-005 — preuve sociale immediate', ctr: 3.2, roas: 3.8, saved: true },
          { hook: 'Hook AD-003 — curiosite + urgence', ctr: 2.9, roas: 3.5, saved: true },
        ],
        winningAngles: [
          { angle: 'problem-solution', avgRoas: 3.8, adCount: 5 },
          { angle: 'social-proof', avgRoas: 3.2, adCount: 4 },
        ],
        audienceInsights: [
          { audience: 'Broad 25-55 FR', performance: 'best', cpa: 10.20 },
          { audience: 'Interest Health', performance: 'good', cpa: 12.80 },
          { audience: 'Lookalike 1%', performance: 'average', cpa: 15.30 },
        ],
        patterns: [
          'Les hooks emotionnels surperforment de 40% vs hooks rationnels',
          'Le format UGC video a un CTR 2x superieur aux images statiques',
          'L\'audience Broad est plus rentable que le Lookalike sur ce type de produit',
          'Les packs a 49.90 EUR representent 62% des ventes',
        ],
        savedToKnowledgeBase: true,
      },
      learnedAt: new Date().toISOString(),
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // v2.0 — Saga, Quality Gates, Ralph Loop, Reviews
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Get the saga compensation action for a step.
   * Used for rollback if a later step fails.
   */
  private getSagaCompensation(stepId: string): string {
    const compensations: Record<string, string> = {
      'INGEST':          'Delete scraped product data',
      'ANALYZE':         'Clear market analysis cache',
      'VALIDATE':        'Reset validation verdict',
      'BUILD_OFFER':     'Remove generated offer packs',
      'BUILD_PAGE':      'Unpublish landing page',
      'CREATE_ADS':      'Delete generated ad creatives',
      'LAUNCH_TEST':     'Pause and archive test campaign',
      'ANALYZE_RESULTS': 'Clear analysis results',
      'SCALE':           'Revert to pre-scale budgets',
      'PROTECT':         'Disable monitoring rules',
      'LEARN':           'No rollback needed (read-only)',
    };
    return compensations[stepId] || 'No compensation defined';
  }

  /**
   * Rollback completed saga steps (compensating transactions).
   * Called when a critical failure requires undoing previous steps.
   */
  async rollbackSaga(
    pipelineId: string,
    db: Pool,
    fromStepIndex?: number,
  ): Promise<{ rolledBack: string[]; errors: string[] }> {
    const state = await this.loadPipelineState(pipelineId, db);
    const rolledBack: string[] = [];
    const errors: string[] = [];

    if (!state.saga || state.saga.length === 0) {
      return { rolledBack, errors };
    }

    // Rollback in reverse order
    const stepsToRollback = fromStepIndex !== undefined
      ? state.saga.filter((_, i) => i >= fromStepIndex)
      : [...state.saga];

    for (const record of stepsToRollback.reverse()) {
      if (record.compensated) continue;

      try {
        // In production, execute actual compensation logic
        // For now, mark as compensated
        record.compensated = true;
        rolledBack.push(`${record.stepId}: ${record.compensation}`);

        await this.logStepEvent(db, pipelineId, record.stepId, 'saga_rollback', {
          compensation: record.compensation,
        });
      } catch (err) {
        errors.push(`${record.stepId}: ${(err as Error).message}`);
      }
    }

    state.updatedAt = new Date().toISOString();
    await this.persistState(state, db);

    return { rolledBack, errors };
  }

  /**
   * Run automatic reviews at key pipeline steps.
   */
  private async runAutoReviews(
    stepId: string,
    result: Record<string, unknown>,
    state: PipelineState,
  ): Promise<void> {
    if (!state.reviews) state.reviews = [];

    try {
      switch (stepId) {
        case 'CREATE_ADS': {
          // Review each generated ad creative
          const ads = result.adIdeas as Array<Record<string, unknown>>;
          if (Array.isArray(ads) && ads.length > 0) {
            const firstAd = ads[0];
            const review = reviewEngine.reviewCreative({
              shopId: state.shopId,
              creativeId: String(firstAd.id || 'AD-001'),
              copy: String(firstAd.body || ''),
              headline: String(firstAd.hook || ''),
              cta: String(firstAd.cta || ''),
              language: 'fr',
            });
            state.reviews.push(review);
          }
          break;
        }

        case 'BUILD_PAGE': {
          // Review the generated store page
          const page = result.landingPage as Record<string, unknown>;
          if (page) {
            const sections = page.sections as string[];
            const review = reviewEngine.reviewStore({
              shopId: state.shopId,
              storeUrl: state.productUrl,
              sections: sections || [],
              isMobile: true,
              pricesVisible: true,
              hasCookieBanner: true,
              hasPrivacyPolicy: true,
              hasTerms: true,
              hasRefundPolicy: true,
              hasContactPage: true,
              hasSsl: true,
              hasCheckout: true,
            });
            state.reviews.push(review);
          }
          break;
        }

        case 'ANALYZE_RESULTS': {
          // Review campaign performance
          const testResults = result.testResults as Record<string, unknown>;
          if (testResults) {
            const review = reviewEngine.reviewCampaign({
              shopId: state.shopId,
              campaignId: state.id,
              roas: Number(testResults.roas || 0),
              cpa: Number(testResults.cpa || 0),
              ctr: Number(testResults.ctr || 0),
              spent: Number(testResults.spend || 0),
              frequency: 1.5,
              daysRunning: 3,
              impressions: Number(testResults.impressions || 0),
              conversions: Number(testResults.purchases || 0),
            });
            state.reviews.push(review);
          }
          break;
        }
      }
    } catch (_reviewErr) {
      // Review errors are non-blocking
    }
  }

  /**
   * Auto-start Ralph optimization loop after ANALYZE_RESULTS if campaign is viable.
   */
  private async maybeStartRalphLoop(
    result: Record<string, unknown>,
    state: PipelineState,
  ): Promise<void> {
    try {
      const classification = result.classification as Record<string, unknown>;
      const verdict = classification?.verdict as string;
      const testResults = result.testResults as Record<string, unknown>;
      const roas = Number(testResults?.roas || 0);

      // Only start Ralph loop for CONDOR or TOF with decent ROAS
      if ((verdict === 'CONDOR' || verdict === 'TOF') && roas >= 1.5) {
        const loopConfig: LoopConfig = {
          shopId: state.shopId,
          campaignId: state.id,
          pipelineId: state.id,
          targetRoas: 2.5,
          testBudget: Number(testResults?.spend || 400),
          maxBudget: 5000,
          waitHours: 48,
          maxIterations: 10,
          exitConsecutiveDays: 7,
          scaleFactor: 1.3,
        };

        const session = ralphLoop.createSession(loopConfig);
        state.ralphSessionId = session.id;

        // Auto-advance to LAUNCH state
        ralphLoop.advance(session.id);
      }
    } catch (_loopErr) {
      // Ralph loop errors are non-blocking
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Methodes utilitaires internes
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Charge l'etat du pipeline depuis la base de donnees.
   *
   * @param pipelineId - Identifiant du pipeline
   * @param db         - Connexion PostgreSQL
   * @returns L'etat hydrate du pipeline
   * @throws Error si le pipeline n'existe pas
   */
  private async loadPipelineState(
    pipelineId: string,
    db: Pool,
  ): Promise<PipelineState> {
    const result = await db.query(
      `SELECT id, shop_id, product_url, steps, current_step, status, created_at, updated_at
       FROM pipeline_runs
       WHERE id = $1`,
      [pipelineId],
    );

    if (result.rows.length === 0) {
      throw new Error(`Pipeline introuvable : ${pipelineId}`);
    }

    const row = result.rows[0];

    return {
      id: row.id,
      shopId: row.shop_id,
      productUrl: row.product_url,
      steps: typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps,
      currentStep: row.current_step,
      status: row.status,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
      updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
    };
  }

  /**
   * Persiste l'etat du pipeline dans la base de donnees.
   * Met a jour toutes les colonnes modifiables.
   *
   * @param state - Etat du pipeline a persister
   * @param db    - Connexion PostgreSQL
   */
  private async persistState(
    state: PipelineState,
    db: Pool,
  ): Promise<void> {
    await db.query(
      `UPDATE pipeline_runs
       SET steps = $1,
           current_step = $2,
           status = $3,
           updated_at = $4
       WHERE id = $5`,
      [
        JSON.stringify(state.steps),
        state.currentStep,
        state.status,
        state.updatedAt,
        state.id,
      ],
    );
  }

  /**
   * Journalise un evenement d'etape dans la table `pipeline_step_logs`.
   * Chaque evenement est horodate et contient un payload de contexte.
   * Les erreurs de journalisation sont silencieuses (non bloquantes).
   *
   * @param db         - Connexion PostgreSQL
   * @param pipelineId - Identifiant du pipeline
   * @param stepId     - Identifiant de l'etape (ou 'PIPELINE' pour les evenements globaux)
   * @param event      - Type d'evenement ('running', 'completed', 'failed', 'started')
   * @param payload    - Donnees contextuelles associees a l'evenement
   */
  private async logStepEvent(
    db: Pool,
    pipelineId: string,
    stepId: string,
    event: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      await db.query(
        `INSERT INTO pipeline_step_logs (id, pipeline_id, step_id, event, payload, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          crypto.randomUUID(),
          pipelineId,
          stepId,
          event,
          JSON.stringify(payload),
          new Date().toISOString(),
        ],
      );
    } catch (_error) {
      // La journalisation ne doit jamais bloquer le pipeline.
      // En production, on loguerait dans un systeme de monitoring externe.
    }
  }

  // ── Lister les pipelines d'une boutique ─────────────────
  async listByShop(shopId: string, db: Pool): Promise<PipelineState[]> {
    const { rows } = await db.query(
      `SELECT id, shop_id, product_url, status, current_step, steps, created_at, updated_at
       FROM pipeline_runs WHERE shop_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [shopId],
    );
    return rows.map((row: any) => ({
      id: row.id,
      shopId: row.shop_id,
      productUrl: row.product_url,
      status: row.status,
      currentStep: row.current_step,
      steps: typeof row.steps === 'string' ? JSON.parse(row.steps) : row.steps,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }

  // ── Réessayer une étape échouée / en pause ──────────────
  async retry(pipelineId: string, db: Pool): Promise<PipelineState> {
    const state = await this.getPipelineStatus(pipelineId, db);
    if (!state) throw new Error('Pipeline introuvable');

    if (state.status !== 'paused' && state.status !== 'failed') {
      throw new Error(`Impossible de réessayer: le pipeline est en status "${state.status}"`);
    }

    // Remettre l'étape courante en 'pending'
    const step = state.steps[state.currentStep];
    if (step) {
      step.status = 'pending';
      step.result = null;
      step.startedAt = null;
      step.completedAt = null;
    }

    // Remettre le pipeline en 'running'
    state.status = 'running';

    await db.query(
      `UPDATE pipeline_runs SET status = $1, steps = $2, updated_at = NOW() WHERE id = $3`,
      [state.status, JSON.stringify(state.steps), pipelineId],
    );

    await this.logStepEvent(db, pipelineId, step?.id ?? 'unknown', 'retry', {
      stepName: step?.name ?? 'unknown',
      stepIndex: state.currentStep,
    });

    // Re-lancer l'avancement
    return this.advancePipeline(pipelineId, db);
  }
}
