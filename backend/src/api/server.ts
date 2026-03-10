/**
 * AEGIS API Server v4.0 — Production-Hardened
 * JWT auth · Rate limiting · Audit log · WebSocket · Security headers · Health check
 */
import express, { Request, Response, NextFunction } from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import * as crypto from 'crypto';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';

// ── JWT Secret — CRASH if missing (no fallback) ─────────────
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET || JWT_SECRET.length < 32) {
  throw new Error('FATAL: JWT_SECRET env var missing or too short (min 32 chars). Generate with: openssl rand -hex 64');
}

// ── Allowed origins for CORS ─────────────────────────────────
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000,http://localhost:3001,http://127.0.0.1:3000').split(',').map(s => s.trim());

// ── Middleware ────────────────────────────────────────────────
const rateLimiter = (maxReq: number, windowMs = 60000) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const db = (req as any).db as Pool;
    const id = (req as any).user?.id ?? req.ip;
    const endpoint = req.path;
    const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);

    try {
      const { rows } = await db.query(`
        INSERT INTO rate_limit_log (identifier, endpoint, request_count, window_start)
        VALUES ($1,$2,1,$3)
        ON CONFLICT (identifier, endpoint, window_start)
        DO UPDATE SET request_count = rate_limit_log.request_count + 1
        RETURNING request_count`, [id, endpoint, windowStart]);

      if (rows[0].request_count > maxReq) {
        return res.status(429).json({ error: 'Rate limit exceeded', retry_after: Math.ceil(windowMs / 1000) });
      }
    } catch (err) {
      // Non-blocking but log it
      if (process.env.NODE_ENV !== 'production') console.warn('Rate limiter DB error:', (err as Error).message);
    }
    next();
  };

const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const payload = jwt.verify(token, JWT_SECRET) as any;
    (req as any).user = payload;
    // Validate shopId belongs to the user (only use from token, not query params)
    (req as any).shopId = payload.default_shop_id;
    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

const auditLog = (action: string, entityType?: string) =>
  async (req: Request, res: Response, next: NextFunction) => {
    const db = (req as any).db as Pool;
    const user = (req as any).user;
    const shopId = (req as any).shopId;

    res.on('finish', async () => {
      // Log ALL actions (success AND failure) for security monitoring
      try {
        await db.query(`
          INSERT INTO audit_log (shop_id, user_id, action, entity_type, entity_id, ip_address, user_agent, status_code)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [shopId, user?.id, action, entityType, req.params.id ?? null, req.ip, req.headers['user-agent'], res.statusCode]);
      } catch (err) {
        if (process.env.NODE_ENV !== 'production') console.warn('Audit log error:', (err as Error).message);
      }
    });
    next();
  };

export function createApp(db: Pool, redis: Redis) {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req, _res, next) => { (req as any).db = db; (req as any).redis = redis; next(); });

  // ── Security Headers ───────────────────────────────────────
  app.use((_req, res, next) => {
    res.header('X-Content-Type-Options', 'nosniff');
    res.header('X-Frame-Options', 'DENY');
    res.header('X-XSS-Protection', '1; mode=block');
    res.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  // ── CORS (whitelist-based) ─────────────────────────────────
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin && ALLOWED_ORIGINS.includes(origin)) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── Serve UI statically ────────────────────────────────
  const path = require('path');
  const uiPath = path.resolve(__dirname, '../../../ui');
  app.use('/ui', express.static(uiPath, { maxAge: '1h' }));
  app.get('/login', (_req, res) => res.sendFile(path.join(uiPath, 'login.html')));
  app.get('/register', (_req, res) => res.sendFile(path.join(uiPath, 'register.html')));
  app.get('/landing', (_req, res) => res.sendFile(path.join(uiPath, 'aegis-landing.html')));
  app.get('/', (_req, res) => res.sendFile(path.join(uiPath, 'aegis-landing.html')));

  // ── DASHBOARD API (real DB data) ─────────────────────────
  try {
    const { registerDashboardRoutes } = require('./dashboard-routes');
    registerDashboardRoutes(app, db);
  } catch (err: any) {
    console.warn('Dashboard routes non chargees:', err.message);
  }

  // ── PIPELINE ROUTES ──────────────────────────────────────
  try {
    const { registerPipelineRoutes } = require('./pipeline-routes');
    registerPipelineRoutes(app, db);
  } catch (err: any) {
    console.warn('Pipeline routes non chargees:', err.message);
  }

  // ── GROWTH + FLIGHT + GHOST + EMPIRE ROUTES ─────────────
  try {
    const { registerGrowthRoutes } = require('./growth-routes');
    registerGrowthRoutes(app, db);
  } catch (err: any) {
    console.warn('Growth routes non chargees:', err.message);
  }

  // ── AUTH (legacy — kept for backward compat) ──────────────
  app.post('/api/auth/login-legacy', rateLimiter(10), async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });

    try {
      const { rows } = await db.query(`SELECT id, email, password_hash, role, full_name FROM user_accounts WHERE email = $1 AND is_active = true`, [email]);
      if (!rows[0]) return res.status(401).json({ error: 'Invalid credentials' });

      const valid = await bcrypt.compare(password, rows[0].password_hash);
      if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

      await db.query(`UPDATE user_accounts SET last_login_at = NOW() WHERE id = $1`, [rows[0].id]);

      const { rows: shops } = await db.query(`
        SELECT s.id, s.name, usa.role FROM user_shop_access usa
        JOIN shops s ON s.id = usa.shop_id WHERE usa.user_id = $1`, [rows[0].id]);

      const token = jwt.sign({
        id: rows[0].id, email: rows[0].email, role: rows[0].role,
        shops: shops.map(s => s.id), default_shop_id: shops[0]?.id,
      }, JWT_SECRET, { expiresIn: '7d' });

      res.json({ token, user: { id: rows[0].id, email: rows[0].email, name: rows[0].full_name, role: rows[0].role }, shops });
    } catch (err) {
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  // NOTE: /api/auth/register is handled by dashboard-routes.ts (saas schema, tenant isolation).
  // Legacy register endpoint removed to avoid duplicate/conflicting implementations.

  // ── HEALTH CHECK (/health + /healthz) ──────────────────────
  const healthHandler = async (_req: Request, res: Response) => {
    const checks: Record<string, boolean> = {};

    try { await db.query('SELECT 1'); checks.database = true; }
    catch { checks.database = false; }

    try { await redis.ping(); checks.redis = true; }
    catch { checks.redis = false; }

    checks.jwt_configured = !!process.env.JWT_SECRET;
    checks.anthropic_key = !!process.env.ANTHROPIC_API_KEY;

    const healthy = checks.database && checks.redis;
    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'ok' : 'degraded',
      checks,
      version: '7.2.0',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  };
  app.get('/health', healthHandler);
  app.get('/healthz', healthHandler);

  // ── DASHBOARD APIs ─────────────────────────────────────────
  app.get('/api/shops/:shopId/world-state', requireAuth, async (req, res) => {
    try {
      // Validate user has access to this shop
      const user = (req as any).user;
      if (user.default_shop_id !== req.params.shopId && !user.shops?.includes(req.params.shopId)) {
        return res.status(403).json({ error: 'Access denied to this shop' });
      }
      const { rows } = await db.query(`SELECT * FROM world_state WHERE shop_id = $1`, [req.params.shopId]);
      res.json(rows[0] ?? null);
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/metrics', requireAuth, rateLimiter(60), async (req, res) => {
    try {
      const { period = '24h' } = req.query;
      // FIXED: Parameterized interval instead of string interpolation (SQL injection fix)
      const intervalMap: Record<string, string> = { '7d': '7 days', '30d': '30 days', '24h': '24 hours' };
      const interval = intervalMap[period as string] || '24 hours';
      const { rows } = await db.query(`
        SELECT DATE_TRUNC('hour', recorded_at) AS ts,
               SUM(revenue) AS revenue, SUM(spend) AS spend,
               AVG(roas) AS roas, AVG(cpa) AS cpa, SUM(conversions) AS conversions
        FROM ad_metrics WHERE shop_id = $1 AND recorded_at > NOW() - $2::INTERVAL
        GROUP BY ts ORDER BY ts ASC`, [req.params.shopId, interval]);
      res.json({ metrics: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/profitability', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT entity_id, entity_type, contribution_margin, contribution_margin_pct,
               true_roas, orders, refunded_orders, net_revenue, ad_spend
        FROM profitability_metrics
        WHERE shop_id = $1 AND period_end > NOW() - INTERVAL '24 hours'
        ORDER BY contribution_margin DESC LIMIT 50`, [req.params.shopId]);
      res.json({ profitability: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/agents/decisions', requireAuth, async (req, res) => {
    try {
      const { limit = '50', agent } = req.query;
      const parsedLimit = Math.min(Math.max(parseInt(limit as string, 10) || 50, 1), 200);
      let q = `SELECT id, agent_name, decision_type, subject_id, decision_made, confidence, executed, created_at
               FROM agent_decisions WHERE shop_id = $1`;
      const params: any[] = [req.params.shopId];
      if (agent && typeof agent === 'string' && /^[a-zA-Z0-9_-]+$/.test(agent)) {
        params.push(agent);
        q += ` AND agent_name = $${params.length}`;
      }
      params.push(parsedLimit);
      q += ` ORDER BY created_at DESC LIMIT $${params.length}`;
      const { rows } = await db.query(q, params);
      res.json({ decisions: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/anomalies', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT id, anomaly_type, severity, description, auto_resolved, created_at
        FROM anomalies WHERE shop_id = $1 AND auto_resolved = false
        ORDER BY created_at DESC LIMIT 30`, [req.params.shopId]);
      res.json({ anomalies: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/rfm', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT segment, COUNT(*) AS count, AVG(monetary) AS avg_ltv
        FROM customer_rfm WHERE shop_id = $1 GROUP BY segment ORDER BY count DESC`, [req.params.shopId]);
      res.json({ segments: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/forecast', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`SELECT * FROM forecasts WHERE shop_id = $1 ORDER BY generated_at DESC LIMIT 1`, [req.params.shopId]);
      res.json(rows[0] ?? null);
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/roi', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT period_month, total_revenue_gain, aegis_cost, roi_pct
        FROM aegis_roi_summary WHERE shop_id = $1 ORDER BY period_month DESC LIMIT 6`, [req.params.shopId]);
      res.json({ roi_history: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/creative-insights', requireAuth, async (req, res) => {
    try {
      await db.query('REFRESH MATERIALIZED VIEW CONCURRENTLY creative_tag_performance');
      const { rows } = await db.query(`
        SELECT content_angle, hook_type, has_human_face, face_gender,
               creative_count, avg_ctr, avg_roas, total_impressions
        FROM creative_tag_performance WHERE shop_id = $1
        ORDER BY avg_roas DESC LIMIT 20`, [req.params.shopId]);
      res.json({ patterns: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/knowledge', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT id, knowledge_type, description, confidence, created_at
        FROM creative_knowledge WHERE shop_id = $1 AND valid_until IS NULL
        ORDER BY confidence DESC, created_at DESC LIMIT 20`, [req.params.shopId]);
      res.json({ knowledge: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.get('/api/shops/:shopId/sync-status', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`
        SELECT platform, entity_type, human_override, override_detected_at
        FROM platform_sync_state WHERE shop_id = $1 AND human_override = true
        ORDER BY override_detected_at DESC`, [req.params.shopId]);
      res.json({ overrides: rows });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  // Config changes with audit
  app.patch('/api/shops/:shopId/guardrails/:key',
    requireAuth, auditLog('guardrail_update', 'guardrail'), async (req, res) => {
    try {
      const { value, reason } = req.body;
      if (value === undefined) return res.status(400).json({ error: 'value is required' });

      const { rows: [current] } = await db.query(
        `SELECT value FROM guardrail_configs WHERE shop_id = $1 AND key = $2`, [req.params.shopId, req.params.key]);

      await db.query(`
        INSERT INTO guardrail_configs (shop_id, key, value) VALUES ($1,$2,$3)
        ON CONFLICT (shop_id, key) DO UPDATE SET value = $3`, [req.params.shopId, req.params.key, value]);

      await db.query(`
        INSERT INTO config_changelog (shop_id, changed_by, change_type, entity_type, config_key, value_before, value_after, change_reason)
        VALUES ($1,$2,'guardrail','shop',$3,$4,$5,$6)`,
        [req.params.shopId, (req as any).user.email, req.params.key,
         JSON.stringify(current?.value), JSON.stringify(value), reason]);

      res.json({ success: true, key: req.params.key, value });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  // Onboarding
  app.get('/api/shops/:shopId/onboarding', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`SELECT * FROM onboarding_state WHERE shop_id = $1`, [req.params.shopId]);
      res.json(rows[0] ?? null);
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.patch('/api/shops/:shopId/onboarding/step/:step', requireAuth, async (req, res) => {
    try {
      const step = parseInt(req.params.step, 10);
      if (isNaN(step) || step < 0 || step > 10) return res.status(400).json({ error: 'Invalid step' });
      await db.query(`
        UPDATE onboarding_state SET
          current_step = GREATEST(current_step, $1 + 1),
          completed_steps = array_append(completed_steps, $1),
          completed = ($1 >= 6),
          completed_at = CASE WHEN $1 >= 6 THEN NOW() ELSE NULL END,
          updated_at = NOW()
        WHERE shop_id = $2`, [step, req.params.shopId]);
      res.json({ success: true, step_completed: step });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  // User preferences
  app.get('/api/me/preferences', requireAuth, async (req, res) => {
    try {
      const { rows } = await db.query(`SELECT * FROM user_preferences WHERE user_id = $1`, [(req as any).user.id]);
      res.json(rows[0] ?? {});
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  app.put('/api/me/preferences', requireAuth, async (req, res) => {
    try {
      const { theme, sidebar_collapsed, dashboard_layout, notification_prefs } = req.body;
      await db.query(`
        INSERT INTO user_preferences (user_id, theme, sidebar_collapsed, dashboard_layout, notification_prefs)
        VALUES ($1,$2,$3,$4,$5)
        ON CONFLICT (user_id) DO UPDATE SET
          theme=$2, sidebar_collapsed=$3, dashboard_layout=$4, notification_prefs=$5, updated_at=NOW()`,
        [(req as any).user.id, theme ?? 'dark', sidebar_collapsed ?? false,
         JSON.stringify(dashboard_layout ?? {}), JSON.stringify(notification_prefs ?? {})]);
      res.json({ success: true });
    } catch { res.status(500).json({ error: 'Internal server error' }); }
  });

  // ── WEBSOCKET ─────────────────────────────────────────────
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: '/ws' });
  const clients = new Map<string, { ws: WebSocket; shopId: string; userId: string }>();

  wss.on('connection', async (ws, req) => {
    const token = new URL(req.url!, 'http://x').searchParams.get('token');
    if (!token) { ws.close(1008, 'No token'); return; }

    let user: any;
    try { user = jwt.verify(token, JWT_SECRET); }
    catch { ws.close(1008, 'Invalid token'); return; }

    const connId = crypto.randomUUID();
    clients.set(connId, { ws, shopId: user.default_shop_id, userId: user.id });
    ws.send(JSON.stringify({ type: 'connected', connection_id: connId }));

    ws.on('message', (data) => {
      try {
        const msg = JSON.parse(data.toString());
        if (msg.type === 'subscribe' && typeof msg.shop_id === 'string') {
          const client = clients.get(connId);
          if (client) clients.set(connId, { ...client, shopId: msg.shop_id });
        }
        if (msg.type === 'ping') ws.send(JSON.stringify({ type: 'pong' }));
      } catch {
        // Invalid message format — ignore silently
      }
    });

    ws.on('close', () => clients.delete(connId));
  });

  // Redis → WebSocket bridge
  if (redis.status === 'ready') {
    try {
      const sub = redis.duplicate();
      sub.on('error', () => {});
      sub.psubscribe('aegis:*');
      sub.on('pmessage', (_pattern, channel, message) => {
        const shopId = channel.split(':')[2];
        if (!shopId) return;
        for (const [, client] of clients) {
          if (client.shopId === shopId && client.ws.readyState === WebSocket.OPEN) {
            client.ws.send(JSON.stringify({ channel, data: JSON.parse(message) }));
          }
        }
      });
    } catch {
      console.warn('Redis pub/sub indisponible — WebSocket bridge desactive');
    }
  }

  return { app, server, wss };
}
