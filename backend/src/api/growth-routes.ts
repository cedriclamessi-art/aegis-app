/**
 * AEGIS Growth & Flight API Routes
 * ═══════════════════════════════════
 * Endpoints for:
 *   - Growth Tiers (4 paliers stratégiques)
 *   - Flight Phases (aviation process)
 *   - Ghost signals
 *   - Empire Index v2
 *
 * All routes require JWT authentication.
 */

import { Express, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { GrowthTierService } from '../agents/core/growth-tiers.service';
import { FlightPhaseService, getFlightSummary } from '../agents/pipeline/flight-phase';
import { PipelineOrchestrator } from '../agents/pipeline/pipeline-orchestrator';

const JWT_SECRET = process.env.JWT_SECRET || '';

/**
 * Auth middleware (same pattern as pipeline-routes).
 */
const growthAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'Non authentifie' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = payload;
    (req as any).shopId = payload.default_shop_id || payload.tenant_id;
    next();
  } catch {
    res.status(401).json({ error: 'Token invalide ou expire' });
  }
};

/**
 * Register all growth-related API routes.
 */
export function registerGrowthRoutes(app: Express, db: Pool): void {
  const growthService = new GrowthTierService(db);
  const flightService = new FlightPhaseService(db);
  const orchestrator  = new PipelineOrchestrator();

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GROWTH TIERS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /api/growth/tiers
   * Returns all 4 tier definitions.
   */
  app.get('/api/growth/tiers', growthAuth, async (_req: Request, res: Response) => {
    try {
      const tiers = growthService.getTierDefinitions();
      return res.json({ tiers });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/growth/status
   * Returns the current growth status for the authenticated shop.
   */
  app.get('/api/growth/status', growthAuth, async (req: Request, res: Response) => {
    try {
      const shopId = (req as any).shopId;
      const status = await growthService.getStatus(shopId);
      return res.json(status);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/growth/evaluate
   * Triggers a manual growth tier evaluation.
   */
  app.post('/api/growth/evaluate', growthAuth, async (req: Request, res: Response) => {
    try {
      const shopId = (req as any).shopId;
      const result = await growthService.evaluate(shopId);
      return res.json(result);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return res.status(500).json({ error: message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // FLIGHT PHASES (Aviation Process)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /api/flight/phases
   * Returns the 5 flight phase definitions.
   */
  app.get('/api/flight/phases', growthAuth, async (_req: Request, res: Response) => {
    try {
      const phases = flightService.getPhaseDefinitions();
      return res.json({ phases });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return res.status(500).json({ error: message });
    }
  });

  /**
   * GET /api/flight/:pipelineId
   * Returns the flight status for a specific pipeline.
   */
  app.get('/api/flight/:pipelineId', growthAuth, async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const pipeline = await orchestrator.getPipelineStatus(pipelineId, db);
      if (!pipeline) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      const flightStatus = flightService.getFlightStatus(pipeline);
      const summary = getFlightSummary(flightStatus);

      return res.json({ ...flightStatus, summary });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return res.status(500).json({ error: message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AUTO-ADVANCE (Le Rêve AEGIS)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * POST /api/pipeline/:pipelineId/auto
   * Triggers full automatic pipeline execution.
   * This is THE dream: paste URL → everything happens.
   */
  app.post('/api/pipeline/:pipelineId/auto', growthAuth, async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const pipeline = await orchestrator.autoAdvance(pipelineId, db);
      const flightStatus = flightService.getFlightStatus(pipeline);

      return res.json({
        pipeline,
        flight: flightStatus,
        summary: getFlightSummary(flightStatus),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/auto] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  /**
   * POST /api/launch
   * THE DREAM ENDPOINT.
   * Body: { productUrl: string }
   * Creates a pipeline AND auto-advances it through all 11 steps.
   * Returns the final state + flight status.
   */
  app.post('/api/launch', growthAuth, async (req: Request, res: Response) => {
    try {
      const shopId = (req as any).shopId;
      const { productUrl } = req.body;

      if (!productUrl) {
        return res.status(400).json({ error: 'Missing required field: productUrl' });
      }

      // 1. Create pipeline (starts with step 1)
      const pipeline = await orchestrator.startPipeline(shopId, productUrl, db);

      // 2. Auto-advance through all steps
      const finalState = await orchestrator.autoAdvance(pipeline.id, db);

      // 3. Get flight status
      const flightStatus = flightService.getFlightStatus(finalState);

      // 4. Evaluate growth tier
      const growthStatus = await growthService.evaluate(shopId);

      return res.status(201).json({
        pipeline:   finalState,
        flight:     flightStatus,
        growth:     growthStatus,
        summary:    getFlightSummary(flightStatus),
        message:    finalState.status === 'completed'
          ? '🚀 Pipeline complété ! AEGIS a analysé, créé, lancé et optimisé automatiquement.'
          : `⚡ Pipeline en pause à l'étape ${finalState.currentStep + 1}/${finalState.steps.length}. Intervention requise.`,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[launch] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // GHOST SIGNALS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /api/ghost/signals
   * Returns active ghost signals for the shop.
   */
  app.get('/api/ghost/signals', growthAuth, async (req: Request, res: Response) => {
    try {
      const shopId = (req as any).shopId;
      const { rows } = await db.query(`
        SELECT memory_key, value, created_at, expires_at
        FROM agent_memory
        WHERE shop_id = $1
          AND memory_type = 'ghost_signal'
          AND expires_at > NOW()
        ORDER BY created_at DESC
        LIMIT 50`, [shopId]);

      const signals = rows.map((r: any) => ({
        ...(typeof r.value === 'string' ? JSON.parse(r.value) : r.value),
        createdAt: r.created_at,
        expiresAt: r.expires_at,
      }));

      return res.json({
        total:    signals.length,
        alerts:   signals.filter((s: any) => s.severity === 'alert'),
        murmurs:  signals.filter((s: any) => s.severity === 'murmur'),
        whispers: signals.filter((s: any) => s.severity === 'whisper'),
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return res.status(500).json({ error: message });
    }
  });

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EMPIRE INDEX v2
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  /**
   * GET /api/empire/index
   * Returns the current Empire Index v2 for the shop.
   */
  app.get('/api/empire/index', growthAuth, async (req: Request, res: Response) => {
    try {
      const shopId = (req as any).shopId;

      // Get empire state
      const { rows: [empire] } = await db.query(
        `SELECT * FROM ops.empire_state WHERE tenant_id = $1`, [shopId]);

      // Get growth tier
      const { rows: [growth] } = await db.query(
        `SELECT * FROM growth_tiers WHERE shop_id = $1`, [shopId]);

      // Get world state
      const { rows: [world] } = await db.query(
        `SELECT * FROM world_state WHERE shop_id = $1`, [shopId]);

      return res.json({
        empireIndex: parseFloat(empire?.empire_index || world?.empire_index || 50),
        empireMode:  empire?.empire_mode || world?.empire_mode || 'ADAPTATIF',
        growthTier:  {
          tier:      growth?.current_tier || 1,
          name:      growth?.tier_name || 'VALIDATION',
          revenue:   parseFloat(growth?.revenue_annual_eur || 0),
          progress:  parseFloat(growth?.tier_progress_pct || 0),
        },
        components: {
          contributionMargin: parseFloat(empire?.score_capital || 0),
          patternConfidence:  parseFloat(empire?.score_condor || 0),
          capitalStrength:    parseFloat(empire?.score_capital || 0),
          ltv:                parseFloat(empire?.score_ltv || 0),
          brandPower:         parseFloat(empire?.score_brand_power || 0),
          marketingEfficiency: parseFloat(empire?.score_marketing_eff || 0),
          dependencyHealth:   parseFloat(empire?.score_dependency || 0),
          riskControl:        parseFloat(empire?.score_risk || 0),
        },
        hardConstraint: empire?.hard_constraint_triggered || false,
        constraintReason: empire?.constraint_reason || null,
        roas24h:     parseFloat(world?.roas_24h || 0),
        spend24h:    parseFloat(world?.spend_24h || 0),
        activeAds:   parseInt(world?.active_ads || 0),
        riskLevel:   world?.risk_level || 'low',
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      return res.status(500).json({ error: message });
    }
  });
}
