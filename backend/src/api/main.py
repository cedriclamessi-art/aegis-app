"""
AEGIS FastAPI — v3.7
Production-grade API with auth, rate limiting, WebSocket, audit log.
Replaces all mocked dashboard data with real DB queries.
"""

from fastapi import FastAPI, HTTPException, Depends, WebSocket, WebSocketDisconnect, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
import asyncpg, aioredis, asyncio, json, hashlib, os, time
from datetime import datetime, timedelta
from typing import Optional
import jwt

app = FastAPI(title="AEGIS API", version="3.7.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"])

security = HTTPBearer()
JWT_SECRET = os.getenv("JWT_SECRET", "aegis-secret-change-in-production")

# ── DB & Redis pool ────────────────────────────────────────
pool: asyncpg.Pool = None
redis: aioredis.Redis = None

@app.on_event("startup")
async def startup():
    global pool, redis
    pool  = await asyncpg.create_pool(os.getenv("DATABASE_URL"))
    redis = await aioredis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

@app.on_event("shutdown")
async def shutdown():
    await pool.close()
    await redis.close()

# ── Rate limiting ─────────────────────────────────────────
async def rate_limit(request: Request, identifier: str, endpoint: str, limit: int = 60):
    window = datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    key = f"rate:{identifier}:{endpoint}:{window}"
    count = await redis.incr(key)
    if count == 1: await redis.expire(key, 65)
    if count > limit:
        raise HTTPException(status_code=429, detail="Rate limit exceeded")

# ── Auth ──────────────────────────────────────────────────
async def get_current_user(creds: HTTPAuthorizationCredentials = Depends(security)):
    try:
        payload = jwt.decode(creds.credentials, JWT_SECRET, algorithms=["HS256"])
        return payload
    except Exception:
        raise HTTPException(status_code=401, detail="Invalid token")

async def get_shop_id(user: dict = Depends(get_current_user)) -> str:
    return user.get("shop_id", "")

def set_rls(conn, shop_id: str):
    return conn.execute(f"SET app.shop_id = '{shop_id}'")

# ── Audit log helper ──────────────────────────────────────
async def audit(shop_id: str, actor_id: str, action: str, entity_type: str = None,
                entity_id: str = None, changes: dict = None, request: Request = None):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        await conn.execute(
            """INSERT INTO audit_log (shop_id, actor_type, actor_id, action, entity_type, entity_id, changes, ip_address)
               VALUES ($1,'user',$2,$3,$4,$5,$6,$7)""",
            shop_id, actor_id, action, entity_type, entity_id,
            json.dumps(changes) if changes else None,
            str(request.client.host) if request else None
        )

# ══════════════════════════════════════════════════════════
# AUTH ENDPOINTS
# ══════════════════════════════════════════════════════════

@app.post("/auth/login")
async def login(body: dict, request: Request):
    await rate_limit(request, str(request.client.host), "login", 10)
    async with pool.acquire() as conn:
        user = await conn.fetchrow("SELECT * FROM user_accounts WHERE email=$1 AND is_active=true", body["email"])
        if not user: raise HTTPException(401, "Invalid credentials")
        # In production: verify bcrypt hash
        import hashlib
        if hashlib.sha256(body["password"].encode()).hexdigest() != user["password_hash"]:
            raise HTTPException(401, "Invalid credentials")
        shop = await conn.fetchrow(
            "SELECT shop_id FROM shop_users WHERE user_id=$1 LIMIT 1", user["id"])
        shop_id = str(shop["shop_id"]) if shop else None
        token = jwt.encode({"user_id": str(user["id"]), "shop_id": shop_id,
                            "role": user["role"], "exp": datetime.utcnow() + timedelta(days=7)},
                           JWT_SECRET, algorithm="HS256")
        await conn.execute("UPDATE user_accounts SET last_login_at=NOW() WHERE id=$1", user["id"])
        return {"token": token, "shop_id": shop_id, "role": user["role"]}

# ══════════════════════════════════════════════════════════
# DASHBOARD ENDPOINTS
# ══════════════════════════════════════════════════════════

@app.get("/dashboard/summary")
async def dashboard_summary(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        # Empire Index
        empire = await conn.fetchrow(
            "SELECT score FROM empire_index WHERE shop_id=$1 ORDER BY created_at DESC LIMIT 1", shop_id)
        # KPIs
        kpis = await conn.fetchrow(
            """SELECT COALESCE(SUM(revenue),0) AS revenue_24h,
                      COALESCE(AVG(roas),0) AS roas,
                      COALESCE(AVG(cpa),0) AS cpa,
                      COALESCE(SUM(spend),0) AS spend,
                      COUNT(CASE WHEN status='active' THEN 1 END) AS active_ads
               FROM ad_metrics WHERE shop_id=$1 AND recorded_at > NOW() - INTERVAL '24 hours'""", shop_id)
        # World state
        world = await conn.fetchrow("SELECT * FROM world_state WHERE shop_id=$1", shop_id)
        # ROI this month
        roi = await conn.fetchrow(
            "SELECT * FROM aegis_roi_summary WHERE shop_id=$1 ORDER BY period_month DESC LIMIT 1", shop_id)
        return {
            "empire_index": float(empire["score"]) if empire else 0,
            "empire_mode": world["empire_mode"] if world else "balanced",
            "kpis": dict(kpis) if kpis else {},
            "roi_this_month": dict(roi) if roi else None,
            "risk_level": world["risk_level"] if world else "medium",
        }

@app.get("/dashboard/agent-feed")
async def agent_feed(shop_id: str = Depends(get_shop_id), limit: int = 20):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            """SELECT agent_name, decision_type, decision_made, confidence, created_at, executed
               FROM agent_decisions WHERE shop_id=$1 ORDER BY created_at DESC LIMIT $2""",
            shop_id, limit)
        return [dict(r) for r in rows]

@app.get("/dashboard/morning-brief")
async def morning_brief(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        brief = await conn.fetchrow(
            "SELECT * FROM morning_briefs WHERE shop_id=$1 AND DATE(generated_at)=CURRENT_DATE LIMIT 1", shop_id)
        return dict(brief) if brief else {"message": "No brief yet today"}

# ══════════════════════════════════════════════════════════
# CAMPAIGNS
# ══════════════════════════════════════════════════════════

@app.get("/campaigns")
async def get_campaigns(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            """SELECT entity_id, platform, status, SUM(spend) AS spend,
                      AVG(roas) AS roas, AVG(cpa) AS cpa, SUM(revenue) AS revenue,
                      SUM(conversions) AS conversions
               FROM ad_metrics_latest WHERE shop_id=$1
               GROUP BY entity_id, platform, status
               ORDER BY spend DESC LIMIT 50""", shop_id)
        return [dict(r) for r in rows]

# ══════════════════════════════════════════════════════════
# AGENTS
# ══════════════════════════════════════════════════════════

@app.get("/agents")
async def get_agents(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        confidence = await conn.fetch(
            "SELECT agent_name, decision_type, current_score FROM agent_confidence WHERE shop_id=$1", shop_id)
        decisions_today = await conn.fetch(
            """SELECT agent_name, COUNT(*) AS actions_today
               FROM agent_decisions WHERE shop_id=$1 AND DATE(created_at)=CURRENT_DATE
               GROUP BY agent_name""", shop_id)
        conf_map = {f"{r['agent_name']}:{r['decision_type']}": float(r['current_score']) for r in confidence}
        dec_map  = {r['agent_name']: int(r['actions_today']) for r in decisions_today}
        return {"confidence": conf_map, "actions_today": dec_map}

# ══════════════════════════════════════════════════════════
# GUARDRAILS
# ══════════════════════════════════════════════════════════

@app.get("/guardrails")
async def get_guardrails(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch("SELECT * FROM guardrail_configs WHERE shop_id=$1 ORDER BY key", shop_id)
        return [dict(r) for r in rows]

@app.patch("/guardrails/{guardrail_id}")
async def update_guardrail(guardrail_id: str, body: dict, request: Request,
                            shop_id: str = Depends(get_shop_id),
                            user: dict = Depends(get_current_user)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        old = await conn.fetchrow("SELECT * FROM guardrail_configs WHERE id=$1 AND shop_id=$2", guardrail_id, shop_id)
        if not old: raise HTTPException(404, "Guardrail not found")
        await conn.execute(
            "UPDATE guardrail_configs SET value=$1, updated_at=NOW() WHERE id=$2",
            body["value"], guardrail_id)
        await audit(shop_id, user["user_id"], "update_guardrail", "guardrail", guardrail_id,
                    {"value": {"before": old["value"], "after": body["value"]}}, request)
    return {"success": True}

# ══════════════════════════════════════════════════════════
# ANOMALIES
# ══════════════════════════════════════════════════════════

@app.get("/anomalies")
async def get_anomalies(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            """SELECT * FROM anomalies WHERE shop_id=$1 AND auto_resolved=false
               ORDER BY created_at DESC LIMIT 50""", shop_id)
        return [dict(r) for r in rows]

@app.post("/anomalies/{anomaly_id}/acknowledge")
async def acknowledge_anomaly(anomaly_id: str, shop_id: str = Depends(get_shop_id),
                               user: dict = Depends(get_current_user)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        await conn.execute(
            "UPDATE anomalies SET acknowledged=true, acknowledged_by=$1, acknowledged_at=NOW() WHERE id=$2",
            user["user_id"], anomaly_id)
    return {"success": True}

# ══════════════════════════════════════════════════════════
# ANALYTICS — REAL PROFITABILITY
# ══════════════════════════════════════════════════════════

@app.get("/analytics/profitability")
async def profitability(shop_id: str = Depends(get_shop_id), days: int = 30):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            """SELECT entity_type, entity_id, SUM(gross_revenue) AS gross_revenue,
                      SUM(refunded_amount) AS refunded, SUM(ad_spend) AS spend,
                      SUM(contribution_margin) AS contribution_margin,
                      AVG(true_roas) AS true_roas
               FROM profitability_metrics
               WHERE shop_id=$1 AND period_start > NOW() - ($2 || ' days')::interval
               GROUP BY entity_type, entity_id ORDER BY contribution_margin DESC LIMIT 30""",
            shop_id, str(days))
        return [dict(r) for r in rows]

@app.get("/analytics/attribution-inflation")
async def attribution_inflation(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            """SELECT platform, AVG(attribution_inflation_pct) AS avg_inflation,
                      AVG(shopify_actual_conversions) AS real_conv,
                      AVG(platform_reported_conversions) AS reported_conv
               FROM attribution_reconciliation WHERE shop_id=$1 AND period_date > NOW()-INTERVAL '30 days'
               GROUP BY platform ORDER BY avg_inflation DESC""", shop_id)
        return [dict(r) for r in rows]

# ══════════════════════════════════════════════════════════
# HEALTH CHECK
# ══════════════════════════════════════════════════════════

@app.get("/health")
async def health_check():
    checks = {"api": "ok", "db": "unknown", "redis": "unknown", "agents": "unknown"}
    try:
        async with pool.acquire() as conn:
            await conn.execute("SELECT 1")
            checks["db"] = "ok"
    except Exception as e: checks["db"] = f"error: {e}"
    try:
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as e: checks["redis"] = f"error: {e}"
    try:
        async with pool.acquire() as conn:
            last_run = await conn.fetchval(
                "SELECT MAX(last_run_at) FROM shop_scheduler_state")
            if last_run and (datetime.utcnow() - last_run).seconds < 1800:
                checks["agents"] = "ok"
            else: checks["agents"] = "stale"
    except: pass
    status = "healthy" if all(v == "ok" for v in checks.values()) else "degraded"
    return {"status": status, "checks": checks, "version": "3.7.0", "ts": datetime.utcnow().isoformat()}

# ══════════════════════════════════════════════════════════
# EXPORTS
# ══════════════════════════════════════════════════════════

@app.get("/export/analytics.csv")
async def export_analytics_csv(shop_id: str = Depends(get_shop_id)):
    from fastapi.responses import StreamingResponse
    import io, csv
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            "SELECT * FROM ad_metrics WHERE shop_id=$1 AND recorded_at > NOW()-INTERVAL '30 days' ORDER BY recorded_at DESC LIMIT 10000", shop_id)
    buf = io.StringIO()
    writer = csv.DictWriter(buf, fieldnames=rows[0].keys() if rows else [])
    writer.writeheader()
    for r in rows: writer.writerow(dict(r))
    buf.seek(0)
    return StreamingResponse(buf, media_type="text/csv",
                             headers={"Content-Disposition": "attachment; filename=aegis-analytics.csv"})

@app.get("/export/brief.pdf")
async def export_brief_pdf(shop_id: str = Depends(get_shop_id)):
    from fastapi.responses import Response
    # Minimal PDF generation using reportlab
    try:
        from reportlab.pdfgen import canvas
        from reportlab.lib.pagesizes import A4
        import io
        buf = io.BytesIO()
        c = canvas.Canvas(buf, pagesize=A4)
        c.setFont("Helvetica-Bold", 18)
        c.drawString(50, 780, "AEGIS Morning Brief")
        c.setFont("Helvetica", 12)
        c.drawString(50, 750, f"Generated: {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC")
        c.save()
        buf.seek(0)
        return Response(buf.read(), media_type="application/pdf",
                       headers={"Content-Disposition": "attachment; filename=aegis-brief.pdf"})
    except ImportError:
        raise HTTPException(500, "reportlab not installed")

# ══════════════════════════════════════════════════════════
# WEBSOCKET — REAL-TIME AGENT FEED
# ══════════════════════════════════════════════════════════

class ConnectionManager:
    def __init__(self):
        self.connections: dict[str, list[WebSocket]] = {}

    async def connect(self, ws: WebSocket, shop_id: str):
        await ws.accept()
        self.connections.setdefault(shop_id, []).append(ws)

    def disconnect(self, ws: WebSocket, shop_id: str):
        if shop_id in self.connections:
            self.connections[shop_id] = [c for c in self.connections[shop_id] if c != ws]

    async def broadcast(self, shop_id: str, data: dict):
        for ws in self.connections.get(shop_id, []):
            try: await ws.send_json(data)
            except: pass

manager = ConnectionManager()

@app.websocket("/ws/{shop_id}")
async def websocket_endpoint(ws: WebSocket, shop_id: str):
    await manager.connect(ws, shop_id)
    # Subscribe to Redis channel for this shop
    pubsub = redis.pubsub()
    await pubsub.psubscribe(f"aegis:events", f"aegis:world_state:{shop_id}", f"aegis:deliberation:{shop_id}")
    try:
        async def redis_listener():
            async for msg in pubsub.listen():
                if msg["type"] == "pmessage":
                    try:
                        data = json.loads(msg["data"])
                        await manager.broadcast(shop_id, data)
                    except: pass
        listener_task = asyncio.create_task(redis_listener())
        while True:
            try:
                await asyncio.wait_for(ws.receive_text(), timeout=30)
            except asyncio.TimeoutError:
                await ws.send_json({"type": "ping"})
    except WebSocketDisconnect:
        manager.disconnect(ws, shop_id)
        listener_task.cancel()
    except Exception:
        manager.disconnect(ws, shop_id)

# ══════════════════════════════════════════════════════════
# ONBOARDING
# ══════════════════════════════════════════════════════════

@app.get("/onboarding")
async def get_onboarding(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        row = await conn.fetchrow("SELECT * FROM onboarding_state WHERE shop_id=$1", shop_id)
        if not row:
            await conn.execute("INSERT INTO onboarding_state (shop_id) VALUES ($1) ON CONFLICT DO NOTHING", shop_id)
            row = await conn.fetchrow("SELECT * FROM onboarding_state WHERE shop_id=$1", shop_id)
        return dict(row)

@app.post("/onboarding/complete-step")
async def complete_step(body: dict, shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        step = body["step"]
        await conn.execute(
            """UPDATE onboarding_state
               SET completed_steps = completed_steps || $1::jsonb,
                   current_step = GREATEST(current_step, $2),
                   is_complete = (SELECT bool_and(s.value->>'complete' = 'true')
                                  FROM jsonb_each(steps) s),
                   updated_at = NOW()
               WHERE shop_id=$3""",
            json.dumps(step), step + 1, shop_id)
    return {"success": True}

# ══════════════════════════════════════════════════════════
# ROI
# ══════════════════════════════════════════════════════════

@app.get("/roi")
async def get_roi(shop_id: str = Depends(get_shop_id)):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            "SELECT * FROM aegis_roi_summary WHERE shop_id=$1 ORDER BY period_month DESC LIMIT 6", shop_id)
        return [dict(r) for r in rows]

# ══════════════════════════════════════════════════════════
# AUDIT LOG
# ══════════════════════════════════════════════════════════

@app.get("/audit-log")
async def get_audit_log(shop_id: str = Depends(get_shop_id), limit: int = 100):
    async with pool.acquire() as conn:
        await set_rls(conn, shop_id)
        rows = await conn.fetch(
            "SELECT * FROM audit_log WHERE shop_id=$1 ORDER BY created_at DESC LIMIT $2", shop_id, limit)
        return [dict(r) for r in rows]

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
