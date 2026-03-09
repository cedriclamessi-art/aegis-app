import { Express, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import jwt from 'jsonwebtoken';
import { PipelineOrchestrator } from '../agents/pipeline/pipeline-orchestrator';

const JWT_SECRET = process.env.JWT_SECRET || '';

/**
 * Auth middleware for pipeline routes.
 * Validates JWT, extracts shopId from token for tenant isolation.
 */
const pipelineAuth = async (req: Request, res: Response, next: NextFunction) => {
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
 * Registers all pipeline-related API routes (all authenticated).
 *
 * Routes:
 *   POST /api/pipeline/start               - Start a new pipeline run
 *   GET  /api/pipeline/:pipelineId         - Get pipeline status
 *   POST /api/pipeline/:pipelineId/advance - Advance to next step
 *   GET  /api/pipeline/shop/:shopId        - List pipelines for a shop
 *   POST /api/pipeline/:pipelineId/retry   - Retry a failed/paused step
 */
export function registerPipelineRoutes(app: Express, db: Pool): void {
  const orchestrator = new PipelineOrchestrator();

  // ---------------------------------------------------------------------------
  // POST /api/pipeline/start
  // Body: { productUrl: string }
  // shopId extracted from JWT token (tenant isolation).
  // ---------------------------------------------------------------------------
  app.post('/api/pipeline/start', pipelineAuth, async (req: Request, res: Response) => {
    try {
      const shopId = (req as any).shopId;
      const { productUrl } = req.body;

      if (!productUrl) {
        return res.status(400).json({ error: 'Missing required field: productUrl' });
      }

      const pipeline = await orchestrator.startPipeline(shopId, productUrl, db);
      return res.status(201).json(pipeline);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/start] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/pipeline/:pipelineId
  // ---------------------------------------------------------------------------
  app.get('/api/pipeline/:pipelineId', pipelineAuth, async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const pipeline = await orchestrator.getPipelineStatus(pipelineId, db);

      if (!pipeline) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      return res.json(pipeline);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/status] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/pipeline/:pipelineId/advance
  // ---------------------------------------------------------------------------
  app.post('/api/pipeline/:pipelineId/advance', pipelineAuth, async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const pipeline = await orchestrator.advancePipeline(pipelineId, db);

      if (!pipeline) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      return res.json(pipeline);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/advance] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/pipeline/shop/:shopId
  // Enforces tenant isolation: user can only list their own shop's pipelines.
  // ---------------------------------------------------------------------------
  app.get('/api/pipeline/shop/:shopId', pipelineAuth, async (req: Request, res: Response) => {
    try {
      const userShopId = (req as any).shopId;
      const { shopId } = req.params;

      if (shopId !== userShopId) {
        return res.status(403).json({ error: 'Acces refuse a ce shop' });
      }

      const pipelines = await orchestrator.listByShop(shopId, db);
      return res.json(pipelines);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/shop] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/pipeline/:pipelineId/retry
  // ---------------------------------------------------------------------------
  app.post('/api/pipeline/:pipelineId/retry', pipelineAuth, async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;
      const pipeline = await orchestrator.retry(pipelineId, db);

      if (!pipeline) {
        return res.status(404).json({ error: 'Pipeline not found' });
      }

      return res.json(pipeline);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/retry] Error:', message);
      return res.status(500).json({ error: message });
    }
  });
}
