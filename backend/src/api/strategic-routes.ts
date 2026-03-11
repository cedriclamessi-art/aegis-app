/**
 * AEGIS Strategic Routes — PSYCHE · HUNTER · TRAFFIC · SEO · SUPPORT
 * Endpoints for the 12 Strategic Agents ecosystem
 */
import { Express, Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import * as jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || '';

// ── Auth middleware ──────────────────────────────────
const stratAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

export function registerStrategicRoutes(app: Express, db: Pool): void {

  // ═══════════════════════════════════════════════════
  // HUNTER — Top 5 produits gagnants du lundi
  // ═══════════════════════════════════════════════════

  /** GET /api/hunter/top5 — Retrieve current week's top 5 discoveries */
  app.get('/api/hunter/top5', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const tenantId = user.tenant_id;

      // Current ISO week
      const now = new Date();
      const startOfYear = new Date(now.getFullYear(), 0, 1);
      const weekNum = Math.ceil(((now.getTime() - startOfYear.getTime()) / 86400000 + startOfYear.getDay() + 1) / 7);
      const huntWeek = `${now.getFullYear()}-W${String(weekNum).padStart(2, '0')}`;

      const { rows } = await db.query(`
        SELECT id, rank, product_name, source_url, source, total_score, grade,
               margin_pct, estimated_price, estimated_cost, verdict,
               angles, risks, scores, status, launched_at, created_at
        FROM intel.hunter_discoveries
        WHERE tenant_id = $1 AND hunt_week = $2
        ORDER BY rank ASC
        LIMIT 5
      `, [tenantId, huntWeek]);

      res.json({
        hunt_week: huntWeek,
        count: rows.length,
        products: rows,
        next_hunt: getNextMonday(),
      });
    } catch (err: any) {
      // Table might not exist yet — return empty
      res.json({ hunt_week: '', count: 0, products: [], next_hunt: getNextMonday() });
    }
  });

  /** GET /api/hunter/history — Past hunts */
  app.get('/api/hunter/history', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        SELECT hunt_week, COUNT(*) as total,
               COUNT(*) FILTER (WHERE status = 'launched') as launched,
               MAX(total_score) as best_score,
               MIN(created_at) as hunt_date
        FROM intel.hunter_discoveries
        WHERE tenant_id = $1
        GROUP BY hunt_week
        ORDER BY hunt_week DESC
        LIMIT 12
      `, [user.tenant_id]);
      res.json({ weeks: rows });
    } catch {
      res.json({ weeks: [] });
    }
  });

  /** POST /api/hunter/launch/:id — Launch a product from the top 5 */
  app.post('/api/hunter/launch/:id', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { id } = req.params;

      const { rows } = await db.query(`
        UPDATE intel.hunter_discoveries
        SET status = 'launched', launched_at = NOW()
        WHERE id = $1 AND tenant_id = $2 AND status = 'proposed'
        RETURNING *
      `, [id, user.tenant_id]);

      if (!rows.length) {
        return res.status(404).json({ error: 'Product not found or already launched' });
      }

      // Log the launch decision
      try {
        await db.query(`
          INSERT INTO agents.agent_memory (agent_id, tenant_id, memory_type, content)
          VALUES ('AGENT_HUNTER', $1, 'decision', $2)
        `, [user.tenant_id, JSON.stringify({
          action: 'product_launched',
          product_id: id,
          product_name: rows[0].product_name,
          score: rows[0].total_score,
          grade: rows[0].grade,
          launched_by: user.email,
          launched_at: new Date().toISOString(),
        })]);
      } catch { /* memory table may not exist */ }

      res.json({ success: true, product: rows[0], message: `${rows[0].product_name} lancé avec succès !` });
    } catch (err: any) {
      res.status(500).json({ error: 'Erreur lors du lancement' });
    }
  });

  /** POST /api/hunter/reject/:id — Reject a product */
  app.post('/api/hunter/reject/:id', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        UPDATE intel.hunter_discoveries
        SET status = 'rejected'
        WHERE id = $1 AND tenant_id = $2 AND status = 'proposed'
        RETURNING product_name
      `, [req.params.id, user.tenant_id]);

      if (!rows.length) return res.status(404).json({ error: 'Product not found' });
      res.json({ success: true, message: `${rows[0].product_name} rejeté` });
    } catch {
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ═══════════════════════════════════════════════════
  // PSYCHE — Psychologie & Persuasion Engine 🧠
  // ═══════════════════════════════════════════════════

  /** GET /api/psyche/strategy/:productId — Get existing persuasion strategy */
  app.get('/api/psyche/strategy/:productId', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        SELECT content
        FROM agents.agent_memory
        WHERE agent_id = 'AGENT_PSYCHE' AND tenant_id = $1
          AND memory_type = 'persuasion_strategy'
          AND content->>'product_id' = $2
        ORDER BY created_at DESC
        LIMIT 1
      `, [user.tenant_id, req.params.productId]);

      if (!rows.length) {
        return res.json({
          exists: false,
          strategy: null,
          message: 'Aucune stratégie PSYCHE pour ce produit. Lancez une analyse.',
        });
      }

      res.json({
        exists: true,
        strategy: rows[0].content,
      });
    } catch {
      res.json({ exists: false, strategy: null });
    }
  });

  /** POST /api/psyche/analyze — Trigger PSYCHE analysis for a product */
  app.post('/api/psyche/analyze', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { product_id, product_name, description, price, cost, category, niche } = req.body;

      if (!product_id || !product_name) {
        return res.status(400).json({ error: 'product_id and product_name required' });
      }

      // Store analysis request in agent memory for PSYCHE to pick up
      await db.query(`
        INSERT INTO agents.agent_memory (agent_id, tenant_id, memory_type, content)
        VALUES ('AGENT_PSYCHE', $1, 'analysis_request', $2)
      `, [user.tenant_id, JSON.stringify({
        product_id,
        product_name,
        description: description || '',
        price: price || 30,
        cost: cost || 10,
        category: category || 'default',
        niche: niche || '',
        requested_by: user.email,
        requested_at: new Date().toISOString(),
        status: 'pending',
      })]);

      // Try to run PSYCHE analysis inline if agent is available
      try {
        const { PsycheAgent } = require('../agents/intelligence/psyche.agent');
        const Redis = require('ioredis');
        const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379');
        const psyche = new PsycheAgent(db, redis);
        const strategy = await psyche.analyzeProduct(user.tenant_id, product_id, {
          name: product_name,
          description: description || '',
          price: price || 30,
          cost: cost || 10,
          category: category || 'default',
          niche: niche || '',
        });
        redis.disconnect();
        res.json({
          success: true,
          strategy,
          message: `Analyse PSYCHE terminée — score de persuasion : ${strategy.persuasion_score}/100`,
        });
      } catch (agentErr: any) {
        // Agent not available — request queued
        res.json({
          success: true,
          queued: true,
          message: 'Analyse PSYCHE mise en file d\'attente. Résultat sous 2h.',
        });
      }
    } catch (err: any) {
      res.status(500).json({ error: 'Erreur lors de l\'analyse PSYCHE' });
    }
  });

  /** GET /api/psyche/models — List available mental models */
  app.get('/api/psyche/models', stratAuth, async (_req: Request, res: Response) => {
    res.json({
      total: 22,
      categories: {
        conversion: ['Loi de Hick', 'Énergie d\'activation', 'Modèle BJ Fogg', 'Paradoxe du choix'],
        pricing: ['Ancrage de prix', 'Cadrage', 'Comptabilité mentale', 'Aversion à la perte'],
        trust: ['Autorité', 'Preuve sociale', 'Réciprocité', 'Effet de halo'],
        urgency: ['Rareté', 'FOMO', 'Effet Zeigarnik'],
        retention: ['Effet de dotation', 'Coûts irrécupérables', 'Biais du statu quo'],
        emotion: ['Storytelling', 'Effet de contraste', 'Peak-End Rule', 'Identité', 'Jobs to be Done'],
      },
    });
  });

  // ═══════════════════════════════════════════════════
  // TRAFFIC — Comptes organiques multi-plateforme
  // ═══════════════════════════════════════════════════

  /** GET /api/traffic/accounts — List traffic accounts */
  app.get('/api/traffic/accounts', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        SELECT content->>'product_id' as product_id,
               content->>'product_name' as product_name,
               content->'accounts' as accounts,
               created_at
        FROM agents.agent_memory
        WHERE agent_id = 'AGENT_TRAFFIC' AND tenant_id = $1
          AND memory_type = 'traffic_setup'
        ORDER BY created_at DESC
        LIMIT 20
      `, [user.tenant_id]);
      res.json({ accounts: rows });
    } catch {
      res.json({ accounts: [] });
    }
  });

  /** GET /api/traffic/calendar/:productId — Weekly content calendar */
  app.get('/api/traffic/calendar/:productId', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        SELECT content->'calendar' as calendar,
               content->>'week' as week,
               created_at
        FROM agents.agent_memory
        WHERE agent_id = 'AGENT_TRAFFIC' AND tenant_id = $1
          AND memory_type = 'content_calendar'
          AND content->>'product_id' = $2
        ORDER BY created_at DESC
        LIMIT 1
      `, [user.tenant_id, req.params.productId]);
      res.json(rows[0] ?? { calendar: [], week: '' });
    } catch {
      res.json({ calendar: [], week: '' });
    }
  });

  // ═══════════════════════════════════════════════════
  // SEO — Audit & Blog Plan
  // ═══════════════════════════════════════════════════

  /** GET /api/seo/audit/:productId — SEO audit for a product */
  app.get('/api/seo/audit/:productId', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        SELECT content
        FROM agents.agent_memory
        WHERE agent_id = 'AGENT_SEO' AND tenant_id = $1
          AND memory_type = 'seo_audit'
          AND content->>'product_id' = $2
        ORDER BY created_at DESC
        LIMIT 1
      `, [user.tenant_id, req.params.productId]);
      res.json(rows[0]?.content ?? { score: 0, checks: [], recommendations: [] });
    } catch {
      res.json({ score: 0, checks: [], recommendations: [] });
    }
  });

  /** GET /api/seo/blog-plan/:productId — Blog plan for a product */
  app.get('/api/seo/blog-plan/:productId', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        SELECT content
        FROM agents.agent_memory
        WHERE agent_id = 'AGENT_SEO' AND tenant_id = $1
          AND memory_type = 'blog_plan'
          AND content->>'product_id' = $2
        ORDER BY created_at DESC
        LIMIT 1
      `, [user.tenant_id, req.params.productId]);
      res.json(rows[0]?.content ?? { articles: [] });
    } catch {
      res.json({ articles: [] });
    }
  });

  // ═══════════════════════════════════════════════════
  // SUPPORT — SAV automatisé
  // ═══════════════════════════════════════════════════

  /** GET /api/support/stats — Support statistics */
  app.get('/api/support/stats', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const days = parseInt(req.query.days as string) || 30;
      const { rows } = await db.query(`
        SELECT content
        FROM agents.agent_memory
        WHERE agent_id = 'AGENT_SUPPORT' AND tenant_id = $1
          AND memory_type = 'support_stats'
        ORDER BY created_at DESC
        LIMIT 1
      `, [user.tenant_id]);
      res.json(rows[0]?.content ?? {
        total_tickets: 0,
        auto_resolved: 0,
        escalated: 0,
        avg_response_ms: 0,
        resolution_rate: 0,
        top_issues: [],
      });
    } catch {
      res.json({ total_tickets: 0, auto_resolved: 0, escalated: 0 });
    }
  });

  /** GET /api/support/faq — Dynamic FAQ */
  app.get('/api/support/faq', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { rows } = await db.query(`
        SELECT content->'faq' as faq
        FROM agents.agent_memory
        WHERE agent_id = 'AGENT_SUPPORT' AND tenant_id = $1
          AND memory_type = 'faq_update'
        ORDER BY created_at DESC
        LIMIT 1
      `, [user.tenant_id]);
      res.json({ faq: rows[0]?.faq ?? [] });
    } catch {
      res.json({ faq: [] });
    }
  });

  /** POST /api/support/ticket — Submit a new support ticket */
  app.post('/api/support/ticket', stratAuth, async (req: Request, res: Response) => {
    try {
      const user = (req as any).user;
      const { subject, message } = req.body;
      if (!subject || !message) {
        return res.status(400).json({ error: 'subject and message required' });
      }

      // Triage the ticket
      const ticketTypes = ['tracking', 'return', 'refund', 'defect', 'question', 'complaint', 'chargeback'];
      const lowerMsg = (subject + ' ' + message).toLowerCase();
      let type = 'question';
      if (lowerMsg.includes('suivi') || lowerMsg.includes('colis') || lowerMsg.includes('tracking')) type = 'tracking';
      else if (lowerMsg.includes('retour') || lowerMsg.includes('renvoyer')) type = 'return';
      else if (lowerMsg.includes('remboursement') || lowerMsg.includes('rembourser')) type = 'refund';
      else if (lowerMsg.includes('cassé') || lowerMsg.includes('défaut') || lowerMsg.includes('abîmé')) type = 'defect';
      else if (lowerMsg.includes('plainte') || lowerMsg.includes('inacceptable')) type = 'complaint';
      else if (lowerMsg.includes('chargeback') || lowerMsg.includes('litige')) type = 'chargeback';

      const priority = ['chargeback', 'complaint'].includes(type) ? 'high' : 'normal';

      // Store ticket in memory
      await db.query(`
        INSERT INTO agents.agent_memory (agent_id, tenant_id, memory_type, content)
        VALUES ('AGENT_SUPPORT', $1, 'ticket', $2)
      `, [user.tenant_id, JSON.stringify({
        subject, message,
        email: user.email,
        type, priority,
        auto_classified: true,
        created_at: new Date().toISOString(),
      })]);

      res.json({
        success: true,
        ticket: { subject, type, priority },
        message: priority === 'high'
          ? 'Ticket prioritaire créé — un agent humain va intervenir rapidement.'
          : 'Ticket créé — réponse automatique sous 2 minutes.',
      });
    } catch {
      res.status(500).json({ error: 'Erreur lors de la création du ticket' });
    }
  });

  // ═══════════════════════════════════════════════════
  // AGENTS OVERVIEW — Dashboard des 11 agents
  // ═══════════════════════════════════════════════════

  /** GET /api/strategic/overview — All 12 strategic agents status */
  app.get('/api/strategic/overview', stratAuth, async (req: Request, res: Response) => {
    try {
      const { rows } = await db.query(`
        SELECT agent_id, name, category, is_active, schedule_cron, description
        FROM agents.registry
        WHERE agent_id IN (
          'AGENT_HUNTER','AGENT_PSYCHE','AGENT_INTEL','AGENT_STORE','AGENT_ADS',
          'AGENT_CREATIVE_FACTORY','AGENT_TRAFFIC','AGENT_SEO',
          'AGENT_SUPPORT','AGENT_POST_PURCHASE','AGENT_COMPLIANCE','AGENT_GHOST'
        )
        ORDER BY agent_id
      `);
      res.json({ agents: rows, total: rows.length });
    } catch {
      // Fallback: return static list
      const staticAgents = [
        { agent_id: 'AGENT_HUNTER', name: 'Hunter', category: 'intelligence', is_active: true },
        { agent_id: 'AGENT_PSYCHE', name: 'PSYCHE — Persuasion Engine', category: 'intelligence', is_active: true },
        { agent_id: 'AGENT_INTEL', name: 'Intel', category: 'intelligence', is_active: true },
        { agent_id: 'AGENT_STORE', name: 'Store Builder', category: 'operations', is_active: true },
        { agent_id: 'AGENT_ADS', name: 'Ads Manager', category: 'growth', is_active: true },
        { agent_id: 'AGENT_CREATIVE_FACTORY', name: 'Creative Factory', category: 'creative', is_active: true },
        { agent_id: 'AGENT_TRAFFIC', name: 'Traffic', category: 'growth', is_active: true },
        { agent_id: 'AGENT_SEO', name: 'SEO', category: 'growth', is_active: true },
        { agent_id: 'AGENT_SUPPORT', name: 'Support', category: 'retention', is_active: true },
        { agent_id: 'AGENT_POST_PURCHASE', name: 'Post Purchase', category: 'retention', is_active: true },
        { agent_id: 'AGENT_COMPLIANCE', name: 'Compliance', category: 'operations', is_active: true },
        { agent_id: 'AGENT_GHOST', name: 'Ghost', category: 'intelligence', is_active: true },
      ];
      res.json({ agents: staticAgents, total: 12 });
    }
  });

  console.log('✅ Strategic routes (PSYCHE/HUNTER/TRAFFIC/SEO/SUPPORT) chargées');
}

// ── Helper ──────────────────────────────────────────
function getNextMonday(): string {
  const now = new Date();
  const day = now.getDay();
  const diff = day === 0 ? 1 : 8 - day;
  const next = new Date(now);
  next.setDate(now.getDate() + diff);
  next.setHours(6, 0, 0, 0);
  return next.toISOString();
}
