import { Express, Request, Response } from 'express';
import { Pool } from 'pg';
import { PipelineOrchestrator } from '../agents/pipeline/pipeline-orchestrator';

/**
 * Registers all pipeline-related API routes.
 *
 * Routes:
 *   POST /api/pipeline/start           - Start a new pipeline run
 *   GET  /api/pipeline/:pipelineId     - Get pipeline status
 *   POST /api/pipeline/:pipelineId/advance - Advance to next step
 *   GET  /api/pipeline/shop/:shopId    - List pipelines for a shop
 *   POST /api/pipeline/:pipelineId/retry   - Retry a failed/paused step
 */
export function registerPipelineRoutes(app: Express, db: Pool): void {
  const orchestrator = new PipelineOrchestrator(db);

  // ---------------------------------------------------------------------------
  // POST /api/pipeline/start
  // Body: { shopId: string, productUrl: string }
  // Starts a new pipeline run and returns its initial state.
  // ---------------------------------------------------------------------------
  app.post('/api/pipeline/start', async (req: Request, res: Response) => {
    try {
      const { shopId, productUrl } = req.body;

      if (!shopId || !productUrl) {
        return res.status(400).json({
          error: 'Missing required fields: shopId and productUrl',
        });
      }

      const pipeline = await orchestrator.start(shopId, productUrl);

      return res.status(201).json(pipeline);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/start] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // GET /api/pipeline/:pipelineId
  // Returns the full pipeline status including all step details.
  // ---------------------------------------------------------------------------
  app.get('/api/pipeline/:pipelineId', async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;

      const pipeline = await orchestrator.getStatus(pipelineId);

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
  // Advances the pipeline to the next step in the sequence.
  // ---------------------------------------------------------------------------
  app.post('/api/pipeline/:pipelineId/advance', async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;

      const pipeline = await orchestrator.advance(pipelineId);

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
  // Lists all pipeline runs for a given shop, most recent first (limit 20).
  // ---------------------------------------------------------------------------
  app.get('/api/pipeline/shop/:shopId', async (req: Request, res: Response) => {
    try {
      const { shopId } = req.params;

      const pipelines = await orchestrator.listByShop(shopId);

      return res.json(pipelines);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Internal server error';
      console.error('[pipeline/shop] Error:', message);
      return res.status(500).json({ error: message });
    }
  });

  // ---------------------------------------------------------------------------
  // POST /api/pipeline/:pipelineId/retry
  // Retries a failed or paused step by resetting it to 'pending' and advancing.
  // ---------------------------------------------------------------------------
  app.post('/api/pipeline/:pipelineId/retry', async (req: Request, res: Response) => {
    try {
      const { pipelineId } = req.params;

      const pipeline = await orchestrator.retry(pipelineId);

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
