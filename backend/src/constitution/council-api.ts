/**
 * Council API v4.0
 * Dashboard endpoints for Constitutional Council management.
 */
import { Router, Request, Response } from 'express';
import { ConstitutionalCouncil } from './council.agent';
import { CONSTITUTION } from './constitution.config';
import { Pool } from 'pg';
import { Redis } from 'ioredis';

export function councilRouter(db: Pool, redis: Redis): Router {
  const router = Router();
  const council = new ConstitutionalCouncil(db, redis);

  /** GET /api/shops/:shopId/constitution/status — Overall council status */
  router.get('/:shopId/constitution/status', async (req: Request, res: Response) => {
    const status = await council.getConstitutionStatus(req.params.shopId);
    res.json(status);
  });

  /** GET /api/shops/:shopId/constitution/articles — The five articles */
  router.get('/:shopId/constitution/articles', async (_req: Request, res: Response) => {
    res.json({
      version:  CONSTITUTION.version,
      date:     CONSTITUTION.date,
      articles: CONSTITUTION.articles.map(a => ({
        id:          a.id,
        title:       a.title,
        description: a.description,
        // The check function itself is never exposed — only the definition
      })),
      note: 'Les articles sont codés dans le dépôt Git. Ils ne peuvent pas être modifiés via API.',
    });
  });

  /** GET /api/shops/:shopId/constitution/reviews — Recent review log */
  router.get('/:shopId/constitution/reviews', async (req: Request, res: Response) => {
    const { limit = 50, verdict } = req.query;
    let q = `SELECT * FROM constitution_reviews WHERE shop_id=$1`;
    const params: any[] = [req.params.shopId];
    if (verdict) { params.push(verdict); q += ` AND verdict=$${params.length}`; }
    params.push(Math.min(parseInt(limit as string), 200));
    q += ` ORDER BY reviewed_at DESC LIMIT $${params.length}`;
    const { rows } = await db.query(q, params);
    res.json({ reviews: rows, count: rows.length });
  });

  /** GET /api/shops/:shopId/constitution/violations — Violation history */
  router.get('/:shopId/constitution/violations', async (req: Request, res: Response) => {
    const { rows } = await db.query(`
      SELECT * FROM constitution_violations WHERE shop_id=$1
      ORDER BY created_at DESC LIMIT 100`, [req.params.shopId]);
    res.json({ violations: rows });
  });

  /** GET /api/shops/:shopId/constitution/suspensions — Active suspensions */
  router.get('/:shopId/constitution/suspensions', async (req: Request, res: Response) => {
    const { rows } = await db.query(`
      SELECT * FROM agent_suspensions WHERE shop_id=$1 AND lifted_at IS NULL
      ORDER BY suspended_at DESC`, [req.params.shopId]);
    res.json({ suspensions: rows });
  });

  /** POST /api/shops/:shopId/constitution/suspensions/:agent/lift — Lift a suspension */
  router.post('/:shopId/constitution/suspensions/:agent/lift', async (req: Request, res: Response) => {
    const user = (req as any).user;
    await council.liftSuspension(req.params.shopId, req.params.agent, user.email);
    // Audit log
    await db.query(`INSERT INTO audit_log (shop_id,user_id,action,entity_type,entity_id) VALUES ($1,$2,'suspension_lifted','agent',$3)`,
      [req.params.shopId, user.id, req.params.agent]);
    res.json({ success: true, message: `Suspension de ${req.params.agent} levée par ${user.email}` });
  });

  /** GET /api/shops/:shopId/constitution/whitelist — Approved destinations */
  router.get('/:shopId/constitution/whitelist', async (req: Request, res: Response) => {
    const { rows } = await db.query(`
      SELECT * FROM constitution_whitelist WHERE shop_id=$1 AND revoked_at IS NULL
      ORDER BY approved_at DESC`, [req.params.shopId]);
    res.json({ whitelist: rows });
  });

  /** POST /api/shops/:shopId/constitution/whitelist — Add approved destination */
  router.post('/:shopId/constitution/whitelist', async (req: Request, res: Response) => {
    const { destination_type, destination_id, purpose } = req.body;
    const user = (req as any).user;
    if (!destination_type || !destination_id || !purpose) {
      return res.status(400).json({ error: 'destination_type, destination_id, and purpose required' });
    }
    await council.addToWhitelist(req.params.shopId, {
      destinationType: destination_type,
      destinationId:   destination_id,
      approvedBy:      user.email,
      purpose,
    });
    await db.query(`INSERT INTO audit_log (shop_id,user_id,action,entity_type,entity_id,new_value) VALUES ($1,$2,'whitelist_add','destination',$3,$4)`,
      [req.params.shopId, user.id, destination_id, JSON.stringify({ destination_type, purpose })]);
    res.status(201).json({ success: true, destination_type, destination_id, approved_by: user.email });
  });

  /** DELETE /api/shops/:shopId/constitution/whitelist/:id — Revoke destination */
  router.delete('/:shopId/constitution/whitelist/:id', async (req: Request, res: Response) => {
    const user = (req as any).user;
    await db.query(`UPDATE constitution_whitelist SET revoked_at=NOW() WHERE id=$1 AND shop_id=$2`,
      [req.params.id, req.params.shopId]);
    await db.query(`INSERT INTO audit_log (shop_id,user_id,action,entity_type,entity_id) VALUES ($1,$2,'whitelist_revoke','destination',$3)`,
      [req.params.shopId, user.id, req.params.id]);
    res.json({ success: true });
  });

  /** POST /api/internal/council/review — Internal: agents call this before acting */
  router.post('/internal/council/review', async (req: Request, res: Response) => {
    const { shop_id, agent_name, action_type, action_payload, financial_impact, is_irreversible, destination_type, destination_id } = req.body;
    const review = await council.review(shop_id, agent_name, action_type, action_payload ?? {}, {
      financialImpact:  financial_impact,
      isIrreversible:   is_irreversible,
      destinationType:  destination_type,
      destinationId:    destination_id,
    });
    res.json(review);
  });

  return router;
}
