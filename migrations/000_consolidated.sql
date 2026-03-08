-- ============================================================
-- AEGIS — Migration Consolidée (v1-final)
-- Exécuter UNE SEULE FOIS sur une base vierge
-- Ordre : schemas → core → jobs → agents → ops → store → ads → intel → risk → connectors → organic → schedule
-- ============================================================

-- ═══════════════════════════════════════════════════════════
-- SCHEMAS
-- ═══════════════════════════════════════════════════════════
CREATE SCHEMA IF NOT EXISTS saas;
CREATE SCHEMA IF NOT EXISTS events;
CREATE SCHEMA IF NOT EXISTS jobs;
CREATE SCHEMA IF NOT EXISTS agents;
CREATE SCHEMA IF NOT EXISTS ops;
CREATE SCHEMA IF NOT EXISTS store;
CREATE SCHEMA IF NOT EXISTS ads;
CREATE SCHEMA IF NOT EXISTS intel;
CREATE SCHEMA IF NOT EXISTS risk;
CREATE SCHEMA IF NOT EXISTS connectors;

-- ═══════════════════════════════════════════════════════════
-- EXTENSIONS
-- ═══════════════════════════════════════════════════════════
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════════════════
-- HELPER : updated_at automatique
-- ═══════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════
-- SAAS — Multi-tenant, billing, sécurité
-- ═══════════════════════════════════════════════════════════

CREATE TABLE saas.tenants (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name                VARCHAR(200) NOT NULL,
    slug                VARCHAR(100) UNIQUE NOT NULL,
    -- Feature flags (3 niveaux)
    agent_mode          VARCHAR(30)  NOT NULL DEFAULT 'basic',
    -- basic | hedge_fund | full_organism
    autopilot_mode      VARCHAR(30)  NOT NULL DEFAULT 'human_validate',
    -- human_validate | semi_auto | full_auto
    guardrails_locked   BOOLEAN      NOT NULL DEFAULT TRUE,
    -- Billing
    plan_id             VARCHAR(50)  NOT NULL DEFAULT 'trial',
    plan_status         VARCHAR(30)  NOT NULL DEFAULT 'trialing',
    trial_ends_at       TIMESTAMPTZ  DEFAULT NOW() + INTERVAL '15 days',
    -- Admin
    admin_lifetime      BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Runtime
    stage               VARCHAR(20)  NOT NULL DEFAULT 'seed',
    -- seed | growth_1m | scale_10m | enterprise_100m
    kill_switch_active  BOOLEAN      NOT NULL DEFAULT FALSE,
    kill_switch_reason  TEXT,
    worker_throttle_pct INTEGER      NOT NULL DEFAULT 100,
    settings            JSONB        NOT NULL DEFAULT '{}',
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE TABLE saas.users (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) UNIQUE NOT NULL,
    password_hash   VARCHAR(255),            -- bcrypt — jamais en dur
    role            VARCHAR(30)  NOT NULL DEFAULT 'member',
    -- super_admin | admin | member | viewer
    admin_lifetime  BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_enabled     BOOLEAN      NOT NULL DEFAULT FALSE,
    mfa_secret_enc  TEXT,                    -- TOTP chiffré via vault
    invite_token    VARCHAR(128),            -- usage unique
    invite_expires  TIMESTAMPTZ,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Whitelist admin à vie — accès via invitation+reset, jamais password en dur
CREATE TABLE saas.admin_whitelist (
    email       VARCHAR(255) PRIMARY KEY,
    granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    granted_by  VARCHAR(100) NOT NULL DEFAULT 'bootstrap'
);
INSERT INTO saas.admin_whitelist (email) VALUES ('jonathanlamessi@yahoo.fr')
ON CONFLICT DO NOTHING;

-- Auth tokens (reset password, invite, refresh JWT)
CREATE TABLE saas.auth_tokens (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     UUID NOT NULL REFERENCES saas.users(id) ON DELETE CASCADE,
    type        VARCHAR(30) NOT NULL, -- reset | invite | refresh
    token_hash  VARCHAR(128) NOT NULL UNIQUE, -- SHA-256 du token brut
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_auth_tokens_hash ON saas.auth_tokens(token_hash) WHERE used_at IS NULL;

CREATE TABLE saas.plans (
    id                      VARCHAR(50) PRIMARY KEY,
    name                    VARCHAR(100) NOT NULL,
    price_monthly           NUMERIC(10,2),
    price_yearly            NUMERIC(10,2),
    stripe_price_monthly    VARCHAR(100),
    stripe_price_yearly     VARCHAR(100),
    agent_mode_allowed      VARCHAR(30) NOT NULL DEFAULT 'basic',
    autopilot_mode_allowed  VARCHAR(30) NOT NULL DEFAULT 'human_validate',
    limits                  JSONB NOT NULL DEFAULT '{}',
    is_active               BOOLEAN NOT NULL DEFAULT TRUE,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO saas.plans VALUES
('trial',   'Trial',    0,    0,    NULL, NULL, 'basic',         'human_validate', '{"stores":1,"ad_accounts":1,"products_active":1,"jobs_per_month":50,"creatives":10,"trial_days":15}', TRUE, NOW()),
('starter', 'Starter',  149,  1490, NULL, NULL, 'basic',         'semi_auto',      '{"stores":1,"ad_accounts":1,"products_active":1,"jobs_per_month":300,"creatives":50}',              TRUE, NOW()),
('growth',  'Growth',   499,  4990, NULL, NULL, 'hedge_fund',    'semi_auto',      '{"stores":3,"ad_accounts":3,"products_active":5,"jobs_per_month":2000,"creatives":300}',            TRUE, NOW()),
('scale',   'Scale',    1990, 19900,NULL, NULL, 'full_organism', 'full_auto',      '{"stores":-1,"ad_accounts":-1,"products_active":-1,"jobs_per_month":-1,"creatives":-1,"sla":true}',TRUE, NOW())
ON CONFLICT (id) DO UPDATE SET
    price_monthly=EXCLUDED.price_monthly, limits=EXCLUDED.limits,
    agent_mode_allowed=EXCLUDED.agent_mode_allowed, autopilot_mode_allowed=EXCLUDED.autopilot_mode_allowed;

CREATE TABLE saas.subscriptions (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id               UUID NOT NULL REFERENCES saas.tenants(id),
    plan_id                 VARCHAR(50) NOT NULL REFERENCES saas.plans(id),
    stripe_subscription_id  VARCHAR(100),
    stripe_customer_id      VARCHAR(100),
    status                  VARCHAR(30) NOT NULL DEFAULT 'trialing',
    trial_ends_at           TIMESTAMPTZ,
    current_period_end      TIMESTAMPTZ,
    canceled_at             TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Entitlements (droits permanents, ex: admin_lifetime)
CREATE TABLE saas.entitlements (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID REFERENCES saas.tenants(id),
    user_id         UUID REFERENCES saas.users(id),
    entitlement     VARCHAR(100) NOT NULL,
    -- admin_lifetime | full_organism_access | unlimited_jobs
    granted_by      VARCHAR(100),
    granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ,     -- NULL = permanent
    is_active       BOOLEAN NOT NULL DEFAULT TRUE
);

-- Ledger billing (append-only, jamais UPDATE/DELETE)
CREATE TABLE saas.billing_ledger (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL REFERENCES saas.tenants(id),
    type        VARCHAR(50) NOT NULL,
    amount      NUMERIC(12,2) NOT NULL,
    currency    VARCHAR(3) NOT NULL DEFAULT 'EUR',
    description TEXT,
    stripe_id   VARCHAR(100),
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Revenue share (2% au-delà de 200k€/mois)
CREATE TABLE saas.revenue_share (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES saas.tenants(id),
    period_month        DATE NOT NULL,
    tracked_revenue     NUMERIC(12,2) NOT NULL DEFAULT 0,
    cumulative_revenue  NUMERIC(12,2) NOT NULL DEFAULT 0,
    threshold           NUMERIC(12,2) NOT NULL DEFAULT 200000,
    share_rate          NUMERIC(5,4)  NOT NULL DEFAULT 0.02,
    share_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
    status              VARCHAR(20)   NOT NULL DEFAULT 'tracking',
    stripe_invoice_id   VARCHAR(100),
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, period_month)
);

-- ═══════════════════════════════════════════════════════════
-- EVENTS — Event bus idempotent avec replay
-- ═══════════════════════════════════════════════════════════

CREATE TABLE events.outbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    aggregate_type  VARCHAR(100) NOT NULL,
    aggregate_id    UUID,
    event_type      VARCHAR(200) NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    correlation_id  VARCHAR(64),
    published       BOOLEAN NOT NULL DEFAULT FALSE,
    published_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_outbox_unpub ON events.outbox(published, created_at) WHERE published = FALSE;

CREATE TABLE events.inbox (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    event_id        UUID REFERENCES events.outbox(id),
    event_type      VARCHAR(200) NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    consumer        VARCHAR(100),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(event_id, consumer)   -- idempotence stricte
);
CREATE INDEX idx_events_inbox_pending ON events.inbox(consumer, status, created_at) WHERE status = 'pending';

-- ═══════════════════════════════════════════════════════════
-- JOBS — Queue, DLQ, Attempts
-- ═══════════════════════════════════════════════════════════

CREATE TABLE jobs.queue (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    agent_id        VARCHAR(50),
    task_type       VARCHAR(150) NOT NULL,
    payload         JSONB NOT NULL DEFAULT '{}',
    priority        INTEGER NOT NULL DEFAULT 5,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | claimed | completed | failed | cancelled
    claimed_by      VARCHAR(100),
    claimed_at      TIMESTAMPTZ,
    heartbeat_at    TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    retry_count     INTEGER NOT NULL DEFAULT 0,
    max_retries     INTEGER NOT NULL DEFAULT 3,
    last_error      TEXT,
    output          JSONB NOT NULL DEFAULT '{}',
    correlation_id  VARCHAR(64),
    pipeline_run_id UUID,
    scheduled_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_jobs_claim  ON jobs.queue(status, priority DESC, scheduled_at) WHERE status = 'pending';
CREATE INDEX idx_jobs_tenant ON jobs.queue(tenant_id, status, created_at);
CREATE INDEX idx_jobs_pipe   ON jobs.queue(pipeline_run_id) WHERE pipeline_run_id IS NOT NULL;

CREATE TABLE jobs.dlq (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    original_job_id UUID REFERENCES jobs.queue(id),
    tenant_id       UUID,
    task_type       VARCHAR(150),
    payload         JSONB,
    error_message   TEXT,
    attempts        INTEGER NOT NULL DEFAULT 0,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | replayed | discarded
    failed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    replayed_at     TIMESTAMPTZ,
    discarded_at    TIMESTAMPTZ
);

CREATE TABLE jobs.attempts (
    id              BIGSERIAL PRIMARY KEY,
    job_id          UUID NOT NULL REFERENCES jobs.queue(id),
    attempt_number  INTEGER NOT NULL,
    worker_id       VARCHAR(100),
    started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at    TIMESTAMPTZ,
    success         BOOLEAN,
    error           TEXT,
    duration_ms     INTEGER
);

-- Claim atomique avec SKIP LOCKED + throttle + kill-switch
CREATE OR REPLACE FUNCTION jobs.claim_next(
    p_worker_id    VARCHAR,
    p_task_types   TEXT[],
    p_throttle_pct INTEGER DEFAULT 100
) RETURNS SETOF jobs.queue AS $$
BEGIN
    IF p_throttle_pct < 100 AND random() * 100 > p_throttle_pct THEN RETURN; END IF;
    RETURN QUERY
    UPDATE jobs.queue SET
        status       = 'claimed',
        claimed_by   = p_worker_id,
        claimed_at   = NOW(),
        heartbeat_at = NOW(),
        updated_at   = NOW()
    WHERE id = (
        SELECT q.id FROM jobs.queue q
        LEFT JOIN saas.tenants t ON t.id = q.tenant_id
        WHERE q.status = 'pending'
          AND q.task_type = ANY(p_task_types)
          AND q.scheduled_at <= NOW()
          AND (t.kill_switch_active IS NULL OR t.kill_switch_active = FALSE)
          AND (
            -- Feature flag : n'exécuter que si le tenant a le niveau requis
            NOT EXISTS (
              SELECT 1 FROM agents.registry ar
              WHERE ar.agent_id = q.agent_id
                AND ar.required_level = 'hedge_fund'
                AND t.agent_mode = 'basic'
            )
            AND NOT EXISTS (
              SELECT 1 FROM agents.registry ar
              WHERE ar.agent_id = q.agent_id
                AND ar.required_level = 'full_organism'
                AND t.agent_mode IN ('basic','hedge_fund')
            )
          )
        ORDER BY q.priority DESC, q.scheduled_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
    )
    RETURNING *;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════
-- AGENTS — Registry, Messages, Decisions, Schedule, Traces
-- ═══════════════════════════════════════════════════════════

CREATE TABLE agents.registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        VARCHAR(50) UNIQUE NOT NULL,
    name            VARCHAR(100) NOT NULL,
    category        VARCHAR(50),
    description     TEXT,
    required_level  VARCHAR(30) NOT NULL DEFAULT 'basic',
    -- basic | hedge_fund | full_organism
    capabilities    JSONB NOT NULL DEFAULT '[]',
    task_types      JSONB NOT NULL DEFAULT '[]',
    is_plugin       BOOLEAN NOT NULL DEFAULT FALSE,
    is_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    status          VARCHAR(20) NOT NULL DEFAULT 'idle',
    last_heartbeat  TIMESTAMPTZ,
    version         VARCHAR(20) NOT NULL DEFAULT '1.0.0',
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed des 23 agents (3 niveaux)
INSERT INTO agents.registry (agent_id, name, category, required_level, task_types) VALUES
-- ── NIVEAU 1 : basic (9 agents) ─────────────────────────
('AGENT_INGEST',           'Product Ingest',         'product',    'basic',
 '["product.ingest","product.analyze","product.enrich"]'),
('AGENT_OFFER',            'Offer Engine',            'product',    'basic',
 '["offer.build","offer.optimize","offer.bundle","offer.upsell"]'),
('AGENT_COPY',             'Copy Chief',              'product',    'basic',
 '["copy.page","copy.ads","copy.email","copy.variations"]'),
('AGENT_CREATIVE',         'Creative Factory',        'creative',   'basic',
 '["creative.brief","image.generate","video.plan","creative.variations"]'),
('AGENT_STORE_BUILDER',    'Store Builder',           'product',    'basic',
 '["store.build","store.deploy","landing.build","store.faq"]'),
('AGENT_MEDIA_BUYER',      'Media Buyer',             'ads',        'basic',
 '["media.plan","media.launch","media.scale","media.dark_post"]'),
('AGENT_ANALYTICS',        'Analytics',               'data',       'basic',
 '["analytics.track","analytics.report","attribution.basic"]'),
('AGENT_OPS_GUARD',        'Ops Guard',               'health',     'basic',
 '["ops.budget_cap","ops.stop_loss","ops.alert"]'),
('AGENT_STRATEGY_ORGANIC', 'Strategy & Organic Growth','product',   'basic',
 '["strategy.organic_plan","ugc.generate_scripts","ugc.batch_production","content.calendar_build","content.repurpose","audience.persona_build","brand.voice_define","organic.performance_review","organic.growth_loop"]'),

-- ── NIVEAU 2 : hedge_fund (+5 agents) ───────────────────
('AGENT_RISK_ENGINE',      'Risk Engine',             'data',       'hedge_fund',
 '["risk.evaluate","risk.stop_loss","risk.drawdown","risk.kill_switch"]'),
('AGENT_BUDGET_ALLOCATOR', 'Budget Allocator',        'ads',        'hedge_fund',
 '["budget.allocate","budget.rebalance","budget.position_size"]'),
('AGENT_PORTFOLIO_OPT',    'Portfolio Optimizer',     'ads',        'hedge_fund',
 '["portfolio.scale","portfolio.kill","portfolio.arbitrage"]'),
('AGENT_FRAUD_GUARD',      'Fraud Guard',             'health',     'hedge_fund',
 '["fraud.detect","fraud.spike","fraud.bot","fraud.pixel"]'),
('AGENT_RECOVERY',         'Auto Recovery',           'health',     'hedge_fund',
 '["recovery.retry","recovery.rollback","recovery.resync"]'),

-- ── NIVEAU 3 : full_organism (+9 agents) ────────────────
('AGENT_ORCHESTRATOR',     'Orchestrator',            'core',       'full_organism',
 '["pipeline.start","pipeline.resume","orchestrator.arbitrate","orchestrator.assign"]'),
('AGENT_POLICY_GOVERNOR',  'Policy Governor',         'core',       'full_organism',
 '["policy.check","policy.enforce","policy.audit","policy.veto"]'),
('AGENT_MARKET_INTEL',     'Market Intelligence',     'data',       'full_organism',
 '["intel.scrape_google_trends","intel.scrape_tiktok","intel.scrape_amazon","intel.scrape_meta","intel.full_scan","intel.analyze_competitors"]'),
('AGENT_LEARNING',         'Learning Engine',         'data',       'full_organism',
 '["learn.extract_patterns","learn.score_winners","learn.update_model","learn.weekly_report"]'),
('AGENT_EXPERIMENTS',      'Experiments',             'data',       'full_organism',
 '["experiment.create","experiment.evaluate","experiment.conclude","experiment.ab_test"]'),
('AGENT_HEALTH_SRE',       'Health SRE',              'health',     'full_organism',
 '["health.check","health.heal","health.slo","health.audit","health.dlq_replay"]'),
('AGENT_LEGAL_SCRAPING',   'Legal Scraping',          'health',     'full_organism',
 '["legal.check_robots","legal.tos_verify","legal.consent","legal.gdpr"]'),
('AGENT_INNOVATION',       'Innovation',              'core',       'full_organism',
 '["innovation.propose","innovation.scan","innovation.backlog","innovation.brief"]'),
('AGENT_PSYCHO_MARKETING', 'Psycho Marketing',        'product',    'full_organism',
 '["psycho.mental_models","psycho.anchoring","psycho.scarcity","psycho.social_proof_page"]')
ON CONFLICT (agent_id) DO UPDATE SET
    name=EXCLUDED.name, category=EXCLUDED.category,
    required_level=EXCLUDED.required_level, task_types=EXCLUDED.task_types, updated_at=NOW();

-- Messages inter-agents (structurés, taggés, expirables)
CREATE TABLE agents.messages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    from_agent      VARCHAR(50) NOT NULL,
    to_agent        VARCHAR(50),          -- NULL = broadcast
    to_agents       JSONB NOT NULL DEFAULT '[]',
    message_type    VARCHAR(50) NOT NULL,
    -- COMMAND | QUERY | RESPONSE | EVENT | ALERT | DATA_PUSH | BROADCAST
    tags            JSONB NOT NULL DEFAULT '[]',
    subject         VARCHAR(300),
    payload         JSONB NOT NULL DEFAULT '{}',
    context         JSONB NOT NULL DEFAULT '{}',
    priority        INTEGER NOT NULL DEFAULT 5,
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    requires_ack    BOOLEAN NOT NULL DEFAULT FALSE,
    ack_deadline    TIMESTAMPTZ,
    response_to     UUID REFERENCES agents.messages(id),
    correlation_id  VARCHAR(64),
    pipeline_run_id UUID,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '2 hours',
    delivered_at    TIMESTAMPTZ,
    read_at         TIMESTAMPTZ,
    acted_at        TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_agents_msgs_inbox     ON agents.messages(to_agent, status, priority DESC, created_at) WHERE status='pending';
CREATE INDEX idx_agents_msgs_broadcast ON agents.messages(status, created_at) WHERE to_agent IS NULL AND status='pending';
CREATE INDEX idx_agents_msgs_corr      ON agents.messages(correlation_id, created_at);

-- Décisions arbitrées (vote pondéré → ORCHESTRATOR)
CREATE TABLE agents.decisions (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID,
    subject          VARCHAR(500) NOT NULL,
    decision_type    VARCHAR(100),
    proposals        JSONB NOT NULL DEFAULT '[]',
    -- [{ agent_id, proposal, risk_score, expected_uplift, confidence, blast_radius, proof[] }]
    vote_weights     JSONB NOT NULL DEFAULT '{}',
    -- { "AGENT_RISK_ENGINE": 2.0, "AGENT_MEDIA_BUYER": 1.0 }
    winning_proposal JSONB,
    final_decision   VARCHAR(100),  -- approved | rejected | deferred
    decided_by       VARCHAR(50),   -- ORCHESTRATOR | POLICY_GOVERNOR | human
    justification    TEXT,
    policy_blocked   BOOLEAN NOT NULL DEFAULT FALSE,
    policy_reason    TEXT,
    pipeline_run_id  UUID,
    correlation_id   VARCHAR(64),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    decided_at       TIMESTAMPTZ
);

-- Métriques agents (agrégées par heure)
CREATE TABLE agents.metrics (
    id              BIGSERIAL PRIMARY KEY,
    agent_id        VARCHAR(50) NOT NULL,
    tenant_id       UUID,
    metric_type     VARCHAR(100) NOT NULL,
    value           NUMERIC,
    metadata        JSONB NOT NULL DEFAULT '{}',
    period_hour     TIMESTAMPTZ NOT NULL DEFAULT date_trunc('hour', NOW()),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(agent_id, metric_type, period_hour, COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'))
);

-- Planning agents (source de vérité des crons + triggers)
CREATE TABLE agents.schedule (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id         VARCHAR(50) NOT NULL,
    task_type        VARCHAR(150) NOT NULL,
    required_level   VARCHAR(30) NOT NULL DEFAULT 'basic',
    schedule_type    VARCHAR(20) NOT NULL, -- cron | interval | trigger | on_demand
    cron_expr        VARCHAR(100),
    interval_ms      BIGINT,
    trigger_event    VARCHAR(200),
    priority         INTEGER NOT NULL DEFAULT 5,
    is_enabled       BOOLEAN NOT NULL DEFAULT TRUE,
    tenant_scope     VARCHAR(20) NOT NULL DEFAULT 'per_tenant',
    conditions       JSONB NOT NULL DEFAULT '{}',
    payload_template JSONB NOT NULL DEFAULT '{}',
    last_run_at      TIMESTAMPTZ,
    next_run_at      TIMESTAMPTZ,
    run_count        INTEGER NOT NULL DEFAULT 0,
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Traces immutables (partitionnées par année)
CREATE TABLE agents.traces (
    id          BIGSERIAL,
    agent_id    VARCHAR(50) NOT NULL,
    tenant_id   UUID,
    task_id     UUID,
    level       VARCHAR(10) NOT NULL DEFAULT 'info',
    action      VARCHAR(200),
    message     TEXT,
    metadata    JSONB NOT NULL DEFAULT '{}',
    duration_ms INTEGER,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);
CREATE TABLE agents.traces_2025 PARTITION OF agents.traces FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE agents.traces_2026 PARTITION OF agents.traces FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE agents.traces_2027 PARTITION OF agents.traces FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- ═══════════════════════════════════════════════════════════
-- OPS — Alertes, Config runtime, Kill switch, Audit
-- ═══════════════════════════════════════════════════════════

CREATE TABLE ops.alerts (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    level           VARCHAR(20) NOT NULL, -- info | warning | critical | emergency
    type            VARCHAR(100) NOT NULL,
    title           VARCHAR(300) NOT NULL,
    message         TEXT,
    agent_id        VARCHAR(50),
    resource_type   VARCHAR(50),
    resource_id     UUID,
    resolved        BOOLEAN NOT NULL DEFAULT FALSE,
    resolved_at     TIMESTAMPTZ,
    resolved_by     VARCHAR(100),
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Config runtime (modifiable sans redeploy, garde-fous locked)
CREATE TABLE ops.runtime_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,             -- NULL = global
    key             VARCHAR(200) NOT NULL,
    value           JSONB NOT NULL,
    description     TEXT,
    is_locked       BOOLEAN NOT NULL DEFAULT FALSE,
    locked_by       VARCHAR(50),
    changed_by      VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(COALESCE(tenant_id,'00000000-0000-0000-0000-000000000000'), key)
);

-- Garde-fous (is_locked=TRUE — modification nécessite super_admin + audit)
INSERT INTO ops.runtime_config (tenant_id, key, value, description, is_locked, locked_by) VALUES
(NULL, 'guardrails.roas_min_seed',        '"1.5"',   'ROAS minimum phase seed',            TRUE, 'SYSTEM'),
(NULL, 'guardrails.roas_min_growth',      '"2.0"',   'ROAS minimum phase growth',          TRUE, 'SYSTEM'),
(NULL, 'guardrails.roas_min_scale',       '"2.5"',   'ROAS minimum phase scale',           TRUE, 'SYSTEM'),
(NULL, 'guardrails.max_loss_day_seed',    '"500"',   'Max loss/jour seed (€)',             TRUE, 'SYSTEM'),
(NULL, 'guardrails.max_loss_day_growth',  '"2000"',  'Max loss/jour growth (€)',           TRUE, 'SYSTEM'),
(NULL, 'guardrails.max_loss_day_scale',   '"10000"', 'Max loss/jour scale (€)',            TRUE, 'SYSTEM'),
(NULL, 'guardrails.drawdown_max_pct',     '"20"',    'Max drawdown % avant réduction',     TRUE, 'SYSTEM'),
(NULL, 'guardrails.volatility_throttle',  '"0.35"',  'Variance ROAS > 35% → throttle',    TRUE, 'SYSTEM'),
(NULL, 'guardrails.scaling_cooldown_h',   '"4"',     'Cooldown entre 2 scalings (h)',      TRUE, 'SYSTEM'),
(NULL, 'guardrails.error_rate_max_pct',   '"15"',    'Error rate max avant throttle',      TRUE, 'SYSTEM'),
(NULL, 'policy.full_auto_min_days_green', '"7"',     'Jours green requis avant Full Auto', TRUE, 'SYSTEM')
ON CONFLICT DO NOTHING;

-- Kill switch log (append-only absolu)
CREATE TABLE ops.kill_switch_log (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID NOT NULL,
    action      VARCHAR(10) NOT NULL, -- activate | deactivate
    reason      TEXT,
    triggered_by VARCHAR(100),
    is_global   BOOLEAN NOT NULL DEFAULT FALSE,
    metadata    JSONB NOT NULL DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Audit log global (immuable, partitionné)
CREATE TABLE ops.audit_log (
    id            BIGSERIAL,
    tenant_id     UUID,
    user_id       UUID,
    agent_id      VARCHAR(50),
    action        VARCHAR(200) NOT NULL,
    resource_type VARCHAR(100),
    resource_id   UUID,
    old_value     JSONB,
    new_value     JSONB,
    ip_address    INET,
    request_id    VARCHAR(64),
    metadata      JSONB NOT NULL DEFAULT '{}',
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);
CREATE TABLE ops.audit_log_2025 PARTITION OF ops.audit_log FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE ops.audit_log_2026 PARTITION OF ops.audit_log FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE ops.audit_log_2027 PARTITION OF ops.audit_log FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

-- ═══════════════════════════════════════════════════════════
-- CONNECTORS — Vault, registry, call log
-- ═══════════════════════════════════════════════════════════

CREATE TABLE connectors.registry (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    provider        VARCHAR(50) NOT NULL,  -- meta | tiktok | google_ads | shopify | stripe
    name            VARCHAR(100) NOT NULL,
    status          VARCHAR(20) NOT NULL DEFAULT 'active',
    -- active | paused | error | circuit_open
    circuit_state   VARCHAR(20) NOT NULL DEFAULT 'closed',
    circuit_failures INTEGER NOT NULL DEFAULT 0,
    circuit_opened_at TIMESTAMPTZ,
    last_success_at TIMESTAMPTZ,
    last_error_at   TIMESTAMPTZ,
    last_error      TEXT,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, provider)
);

-- Vault tokens (chiffrés pgcrypto — jamais en clair)
CREATE TABLE connectors.token_vault (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    connector_id    UUID REFERENCES connectors.registry(id),
    token_type      VARCHAR(50) NOT NULL,  -- access | refresh | webhook_secret | api_key
    token_enc       BYTEA NOT NULL,        -- pgp_sym_encrypt(token, VAULT_KEY)
    expires_at      TIMESTAMPTZ,
    scope           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Store/retrieve sécurisé (clé depuis env, jamais en dur)
CREATE OR REPLACE FUNCTION connectors.vault_store(
    p_tenant_id  UUID,
    p_connector_id UUID,
    p_token_type VARCHAR,
    p_token      TEXT,
    p_expires_at TIMESTAMPTZ DEFAULT NULL
) RETURNS UUID AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO connectors.token_vault (tenant_id, connector_id, token_type, token_enc, expires_at)
    VALUES (p_tenant_id, p_connector_id, p_token_type,
            pgp_sym_encrypt(p_token, current_setting('app.vault_key')), p_expires_at)
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_id;
    RETURN v_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION connectors.vault_retrieve(p_vault_id UUID) RETURNS TEXT AS $$
    SELECT pgp_sym_decrypt(token_enc, current_setting('app.vault_key'))
    FROM connectors.token_vault WHERE id = p_vault_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE TABLE connectors.oauth_states (
    state       VARCHAR(128) PRIMARY KEY,
    tenant_id   UUID NOT NULL,
    provider    VARCHAR(50) NOT NULL,
    redirect_uri TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '10 minutes'
);

CREATE TABLE connectors.call_log (
    id              BIGSERIAL,
    tenant_id       UUID,
    connector_id    UUID REFERENCES connectors.registry(id),
    provider        VARCHAR(50) NOT NULL,
    method          VARCHAR(10),
    endpoint        VARCHAR(500),
    status_code     INTEGER,
    duration_ms     INTEGER,
    success         BOOLEAN NOT NULL DEFAULT TRUE,
    error           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);
CREATE TABLE connectors.call_log_2025 PARTITION OF connectors.call_log FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE connectors.call_log_2026 PARTITION OF connectors.call_log FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- ═══════════════════════════════════════════════════════════
-- STORE — Produits, Offres, Pages, Assets, Pipelines
-- ═══════════════════════════════════════════════════════════

CREATE TABLE store.products (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    url             TEXT NOT NULL,
    url_hash        VARCHAR(64) NOT NULL,
    title           VARCHAR(500),
    description     TEXT,
    price           NUMERIC(10,2),
    currency        VARCHAR(3) NOT NULL DEFAULT 'EUR',
    images          JSONB NOT NULL DEFAULT '[]',
    raw_data        JSONB NOT NULL DEFAULT '{}',
    normalized_data JSONB NOT NULL DEFAULT '{}',
    market_context  JSONB NOT NULL DEFAULT '{}',  -- enrichi AGENT_MARKET_INTEL
    status          VARCHAR(30) NOT NULL DEFAULT 'pending',
    -- pending | ingesting | enriched | ready | archived
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, url_hash)
);

CREATE TABLE store.offers (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    product_id      UUID REFERENCES store.products(id),
    offer_type      VARCHAR(50),  -- standalone | bundle | subscription | upsell
    title           VARCHAR(500),
    price           NUMERIC(10,2),
    compare_at      NUMERIC(10,2),
    currency        VARCHAR(3) NOT NULL DEFAULT 'EUR',
    bundles         JSONB NOT NULL DEFAULT '[]',
    upsells         JSONB NOT NULL DEFAULT '[]',
    guarantee       JSONB NOT NULL DEFAULT '{}',
    subscription    JSONB NOT NULL DEFAULT '{}',
    cogs            NUMERIC(10,2),
    margin_pct      NUMERIC(5,2),
    break_even_cac  NUMERIC(10,2),
    is_active       BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store.pages (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    product_id      UUID REFERENCES store.products(id),
    page_type       VARCHAR(30),  -- pdp | landing | upsell | thank_you
    sections        JSONB NOT NULL DEFAULT '[]',
    cro_checklist   JSONB NOT NULL DEFAULT '[]',
    seo_data        JSONB NOT NULL DEFAULT '{}',
    shopify_page_id VARCHAR(100),
    status          VARCHAR(20) NOT NULL DEFAULT 'draft',
    version         INTEGER NOT NULL DEFAULT 1,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store.assets (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    product_id      UUID REFERENCES store.products(id),
    asset_type      VARCHAR(50) NOT NULL,  -- image | video | copy | email | brief
    content_hash    VARCHAR(64) NOT NULL,
    content         JSONB,
    storage_path    TEXT,
    storage_url     TEXT,
    mime_type       VARCHAR(50),
    format          VARCHAR(20),   -- 1:1 | 4:5 | 9:16 | 16:9 | 2:3
    provider        VARCHAR(50),
    version         INTEGER NOT NULL DEFAULT 1,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store.pipeline_runs (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES saas.tenants(id),
    product_id       UUID REFERENCES store.products(id),
    agent_mode       VARCHAR(30) NOT NULL DEFAULT 'basic',
    autopilot_mode   VARCHAR(30) NOT NULL DEFAULT 'human_validate',
    status           VARCHAR(40) NOT NULL DEFAULT 'pending',
    -- pending | running | awaiting_approval | completed | failed | cancelled
    current_step     VARCHAR(60),
    steps_log        JSONB NOT NULL DEFAULT '[]',
    approval_pending BOOLEAN NOT NULL DEFAULT FALSE,
    approval_step    VARCHAR(60),
    error_message    TEXT,
    correlation_id   VARCHAR(64),
    market_context   JSONB NOT NULL DEFAULT '{}',
    metadata         JSONB NOT NULL DEFAULT '{}',
    started_at       TIMESTAMPTZ,
    completed_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE store.pipeline_approvals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pipeline_run_id UUID NOT NULL REFERENCES store.pipeline_runs(id),
    tenant_id       UUID NOT NULL,
    step            VARCHAR(60) NOT NULL,
    risk_score      NUMERIC(4,3),
    expected_uplift NUMERIC(8,4),
    confidence      NUMERIC(4,3),
    blast_radius    VARCHAR(20),  -- low | medium | high
    preview_data    JSONB NOT NULL DEFAULT '{}',
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | approved | rejected | expired
    reviewed_by     UUID REFERENCES saas.users(id),
    review_note     TEXT,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '24 hours',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_at     TIMESTAMPTZ
);

-- ═══════════════════════════════════════════════════════════
-- ADS — Entités, Actions, Performance
-- ═══════════════════════════════════════════════════════════

CREATE TABLE ads.entities (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    pipeline_run_id UUID REFERENCES store.pipeline_runs(id),
    platform        VARCHAR(30) NOT NULL,  -- meta | tiktok | google_ads
    entity_type     VARCHAR(20) NOT NULL,  -- campaign | adset | ad
    parent_id       UUID REFERENCES ads.entities(id),
    external_id     VARCHAR(200),
    name            VARCHAR(500),
    status          VARCHAR(30) NOT NULL DEFAULT 'draft',
    daily_budget    NUMERIC(12,2),
    currency        VARCHAR(3) NOT NULL DEFAULT 'EUR',
    config          JSONB NOT NULL DEFAULT '{}',
    -- Niveau 2 : portfolio data
    position_size   NUMERIC(5,4),
    confidence      NUMERIC(4,3),
    is_winner       BOOLEAN,
    is_loser        BOOLEAN,
    paused_by       VARCHAR(50),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE ads.actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    entity_id       UUID REFERENCES ads.entities(id),
    action_type     VARCHAR(50) NOT NULL,
    -- create | update | pause | resume | delete | scale | budget_update
    payload         JSONB NOT NULL DEFAULT '{}',
    -- Gouvernance (niveau 2+)
    risk_score      NUMERIC(4,3),
    expected_uplift NUMERIC(8,4),
    confidence      NUMERIC(4,3),
    blast_radius    VARCHAR(20),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending',
    -- pending | approved | rejected | executed | failed
    approved_by     VARCHAR(100),
    rejected_by     VARCHAR(100),
    policy_blocked  BOOLEAN NOT NULL DEFAULT FALSE,
    executed_at     TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ads_actions_pending ON ads.actions(status, created_at) WHERE status='pending';

CREATE TABLE ads.performance_hourly (
    id            BIGSERIAL,
    tenant_id     UUID NOT NULL,
    entity_id     UUID NOT NULL REFERENCES ads.entities(id),
    platform      VARCHAR(30),
    hour          TIMESTAMPTZ NOT NULL,
    spend         NUMERIC(12,2) NOT NULL DEFAULT 0,
    impressions   BIGINT       NOT NULL DEFAULT 0,
    clicks        INTEGER      NOT NULL DEFAULT 0,
    conversions   INTEGER      NOT NULL DEFAULT 0,
    revenue       NUMERIC(12,2) NOT NULL DEFAULT 0,
    roas          NUMERIC(8,4),
    cpa           NUMERIC(10,2),
    cpm           NUMERIC(10,2),
    ctr           NUMERIC(8,6),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(entity_id, hour)
) PARTITION BY RANGE (hour);
CREATE TABLE ads.performance_2025 PARTITION OF ads.performance_hourly FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE ads.performance_2026 PARTITION OF ads.performance_hourly FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');

-- ═══════════════════════════════════════════════════════════
-- INTEL — Organic (niveau 1) + Market (niveau 3) + Patterns
-- ═══════════════════════════════════════════════════════════

-- ── Organic Growth (AGENT_STRATEGY_ORGANIC — niveau 1) ───

CREATE TABLE intel.organic_strategies (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES saas.tenants(id),
    product_id       UUID REFERENCES store.products(id),
    name             VARCHAR(300) NOT NULL,
    status           VARCHAR(20) NOT NULL DEFAULT 'draft',
    brand_voice      JSONB NOT NULL DEFAULT '{}',
    -- { tone, persona, forbidden[], pillars[] }
    target_personas  JSONB NOT NULL DEFAULT '[]',
    content_pillars  JSONB NOT NULL DEFAULT '[]',
    platforms        JSONB NOT NULL DEFAULT '[]',
    kpis             JSONB NOT NULL DEFAULT '{}',
    content_rhythm   JSONB NOT NULL DEFAULT '{}',
    growth_loops     JSONB NOT NULL DEFAULT '[]',
    roadmap_90d      JSONB NOT NULL DEFAULT '[]',
    active_from      TIMESTAMPTZ,
    review_cycle_days INTEGER NOT NULL DEFAULT 30,
    last_reviewed_at TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE intel.ugc_scripts (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES saas.tenants(id),
    product_id       UUID REFERENCES store.products(id),
    strategy_id      UUID REFERENCES intel.organic_strategies(id),
    title            VARCHAR(300) NOT NULL,
    script_type      VARCHAR(50) NOT NULL,
    -- hook_reel | transformation | ingredient_focus | objection_killer |
    -- social_proof | routine_hack | trend_hijack | educational |
    -- storytime | day_in_life | comparison | comment_reply
    format           VARCHAR(20) NOT NULL DEFAULT '9:16',
    platform         VARCHAR(30) NOT NULL,
    duration_seconds INTEGER,
    hook             TEXT NOT NULL,
    hook_variants    JSONB NOT NULL DEFAULT '[]',  -- 5 variantes
    script_body      TEXT NOT NULL,                -- avec timecodes
    cta              VARCHAR(200),
    hashtags         JSONB NOT NULL DEFAULT '[]',
    music_mood       VARCHAR(100),
    visual_notes     TEXT,
    predicted_score  NUMERIC(4,1),
    hook_score       NUMERIC(4,1),
    persona_target   VARCHAR(100),
    content_pillar   VARCHAR(80),
    status           VARCHAR(20) NOT NULL DEFAULT 'ready',
    -- ready | assigned | in_production | published | archived
    assigned_to      VARCHAR(200),
    published_at     TIMESTAMPTZ,
    external_url     TEXT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_ugc_scripts_ready  ON intel.ugc_scripts(status, predicted_score DESC) WHERE status='ready';
CREATE INDEX idx_ugc_scripts_tenant ON intel.ugc_scripts(tenant_id, platform, status);

CREATE TABLE intel.content_calendar (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID NOT NULL REFERENCES saas.tenants(id),
    strategy_id       UUID REFERENCES intel.organic_strategies(id),
    script_id         UUID REFERENCES intel.ugc_scripts(id),
    platform          VARCHAR(30) NOT NULL,
    content_type      VARCHAR(50) NOT NULL,
    title             VARCHAR(300),
    scheduled_at      TIMESTAMPTZ NOT NULL,
    best_time_slot    BOOLEAN NOT NULL DEFAULT FALSE,
    status            VARCHAR(20) NOT NULL DEFAULT 'scheduled',
    -- scheduled | in_production | ready | published | missed | skipped
    published_at      TIMESTAMPTZ,
    external_post_id  VARCHAR(200),
    external_url      TEXT,
    -- Résultats
    views             BIGINT  NOT NULL DEFAULT 0,
    likes             INTEGER NOT NULL DEFAULT 0,
    comments          INTEGER NOT NULL DEFAULT 0,
    shares            INTEGER NOT NULL DEFAULT 0,
    saves             INTEGER NOT NULL DEFAULT 0,
    follows_gained    INTEGER NOT NULL DEFAULT 0,
    link_clicks       INTEGER NOT NULL DEFAULT 0,
    revenue_attributed NUMERIC(12,2) NOT NULL DEFAULT 0,
    engagement_rate   NUMERIC(8,6),
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_calendar_upcoming ON intel.content_calendar(scheduled_at, status) WHERE status IN ('scheduled','ready');

CREATE TABLE intel.hook_library (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID REFERENCES saas.tenants(id),
    hook_text     TEXT NOT NULL,
    hook_type     VARCHAR(50),
    platform      VARCHAR(30),
    category      VARCHAR(100),
    avg_view_rate NUMERIC(5,4),
    usage_count   INTEGER NOT NULL DEFAULT 0,
    win_rate      NUMERIC(5,4) NOT NULL DEFAULT 0,
    score         NUMERIC(4,1) NOT NULL DEFAULT 0,
    source        VARCHAR(50) NOT NULL DEFAULT 'generated',
    -- generated | tested | imported | competitor
    is_evergreen  BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_hooks_score ON intel.hook_library(score DESC, platform, category);

CREATE TABLE intel.creator_briefs (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id      UUID NOT NULL REFERENCES saas.tenants(id),
    script_id      UUID REFERENCES intel.ugc_scripts(id),
    strategy_id    UUID REFERENCES intel.organic_strategies(id),
    brief_type     VARCHAR(30) NOT NULL DEFAULT 'ugc',
    title          VARCHAR(300),
    objective      TEXT,
    mandatory_points JSONB NOT NULL DEFAULT '[]',
    forbidden      JSONB NOT NULL DEFAULT '[]',
    visual_refs    JSONB NOT NULL DEFAULT '[]',
    product_key_info JSONB NOT NULL DEFAULT '{}',
    brand_voice_summary TEXT,
    deadline       TIMESTAMPTZ,
    deliverables   JSONB NOT NULL DEFAULT '[]',
    usage_rights   TEXT NOT NULL DEFAULT 'Tous droits cédés — 12 mois — toutes plateformes',
    compensation   VARCHAR(200),
    status         VARCHAR(20) NOT NULL DEFAULT 'draft',
    sent_to        VARCHAR(300),
    sent_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE intel.repurposing_map (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID NOT NULL REFERENCES saas.tenants(id),
    source_id           UUID NOT NULL REFERENCES intel.ugc_scripts(id),
    derived_id          UUID REFERENCES intel.ugc_scripts(id),
    repurpose_type      VARCHAR(80) NOT NULL,
    -- trim_to_15s | add_subtitles | extract_hook | carousel_from_video |
    -- blog_from_script | thread_from_reel | pin_from_screenshot
    target_platform     VARCHAR(30) NOT NULL,
    status              VARCHAR(20) NOT NULL DEFAULT 'queued',
    notes               TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE intel.audience_analytics (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id        UUID NOT NULL REFERENCES saas.tenants(id),
    platform         VARCHAR(30) NOT NULL,
    date             DATE NOT NULL,
    followers_total  BIGINT  NOT NULL DEFAULT 0,
    followers_gained INTEGER NOT NULL DEFAULT 0,
    followers_lost   INTEGER NOT NULL DEFAULT 0,
    avg_views        BIGINT  NOT NULL DEFAULT 0,
    avg_engagement   NUMERIC(8,6),
    link_clicks      INTEGER NOT NULL DEFAULT 0,
    revenue_organic  NUMERIC(12,2) NOT NULL DEFAULT 0,
    viral_pieces     INTEGER NOT NULL DEFAULT 0,
    best_performer_id UUID REFERENCES intel.content_calendar(id),
    best_performer_views BIGINT,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, platform, date)
);

-- ── Market Intel (AGENT_MARKET_INTEL — niveau 3) ─────────

CREATE TABLE intel.signals (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    source          VARCHAR(80) NOT NULL,
    signal_type     VARCHAR(100) NOT NULL,
    subject         VARCHAR(500),
    data            JSONB NOT NULL DEFAULT '{}',
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    relevance_score NUMERIC(5,2) NOT NULL DEFAULT 0,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    is_processed    BOOLEAN NOT NULL DEFAULT FALSE,
    processed_at    TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_intel_signals_unprocessed ON intel.signals(is_processed, relevance_score DESC) WHERE is_processed=FALSE;

CREATE TABLE intel.patterns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    pattern_type    VARCHAR(80) NOT NULL,
    -- hook | angle | offer | creative | audience | copy_structure
    title           VARCHAR(300),
    data            JSONB NOT NULL DEFAULT '{}',
    score           NUMERIC(5,2) NOT NULL DEFAULT 0,
    win_rate        NUMERIC(5,4) NOT NULL DEFAULT 0,
    avg_roas        NUMERIC(8,2),
    usage_count     INTEGER NOT NULL DEFAULT 0,
    sample_size     INTEGER NOT NULL DEFAULT 0,
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE intel.experiments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    name            VARCHAR(300) NOT NULL,
    hypothesis      TEXT,
    variable        VARCHAR(100),
    control         JSONB NOT NULL,
    variants        JSONB NOT NULL,
    traffic_split   JSONB NOT NULL DEFAULT '{}',
    metric_primary  VARCHAR(100),
    status          VARCHAR(20) NOT NULL DEFAULT 'draft',
    started_at      TIMESTAMPTZ,
    concluded_at    TIMESTAMPTZ,
    winner          VARCHAR(100),
    conclusion      TEXT,
    statistical_sig NUMERIC(4,3),
    results         JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Feed intel actif (tous agents le lisent)
CREATE TABLE intel.feed (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    feed_type       VARCHAR(100) NOT NULL,
    title           VARCHAR(500) NOT NULL,
    summary         TEXT,
    action_hint     TEXT,
    target_agents   JSONB NOT NULL DEFAULT '[]',
    data_refs       JSONB NOT NULL DEFAULT '[]',
    priority        INTEGER NOT NULL DEFAULT 5,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '48 hours',
    consumed_by     JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_intel_feed_active ON intel.feed(priority DESC, expires_at) WHERE expires_at > NOW();

-- Market data brut (niveau 3)
CREATE TABLE intel.market_data (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    source          VARCHAR(50) NOT NULL,
    -- google_trends | tiktok_creative | tiktok_ads | meta_ad_library |
    -- amazon_bsr | competitor | keyword_planner
    data_type       VARCHAR(80) NOT NULL,
    subject         VARCHAR(500),
    raw_data        JSONB NOT NULL DEFAULT '{}',
    processed_data  JSONB NOT NULL DEFAULT '{}',
    signals         JSONB NOT NULL DEFAULT '[]',
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0.5,
    expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
    scraped_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE intel.trending_keywords (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword         VARCHAR(500) NOT NULL,
    language        VARCHAR(10) NOT NULL DEFAULT 'fr',
    country         VARCHAR(5)  NOT NULL DEFAULT 'FR',
    source          VARCHAR(50) NOT NULL,
    category        VARCHAR(100),
    trend_score     NUMERIC(8,2),
    trend_direction VARCHAR(10),  -- rising | falling | stable | breakout
    weekly_change   NUMERIC(8,2),
    related_terms   JSONB NOT NULL DEFAULT '[]',
    seasonal        BOOLEAN NOT NULL DEFAULT FALSE,
    last_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(keyword, source, country)
);
CREATE INDEX idx_trending_score ON intel.trending_keywords(trend_score DESC, trend_direction, last_updated_at);

CREATE TABLE intel.viral_creatives (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source           VARCHAR(30) NOT NULL,
    platform_id      VARCHAR(200),
    advertiser       VARCHAR(300),
    product_category VARCHAR(100),
    format           VARCHAR(20),
    hook_text        TEXT,
    cta              VARCHAR(100),
    estimated_spend  VARCHAR(50),
    run_duration_days INTEGER,
    engagement_rate  NUMERIC(6,4),
    viral_score      NUMERIC(5,2),
    angles           JSONB NOT NULL DEFAULT '[]',
    country          VARCHAR(5) NOT NULL DEFAULT 'FR',
    detected_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_viral_score ON intel.viral_creatives(viral_score DESC, detected_at DESC);

-- ═══════════════════════════════════════════════════════════
-- RISK — Limits, Stop-loss, Drawdown, Incidents (niveau 2+)
-- ═══════════════════════════════════════════════════════════

CREATE TABLE risk.limits (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    limit_type      VARCHAR(80) NOT NULL,
    entity_scope    VARCHAR(30) NOT NULL DEFAULT 'account',
    entity_id       UUID,
    value           NUMERIC NOT NULL,
    stage           VARCHAR(20) NOT NULL DEFAULT 'seed',
    is_override     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, limit_type, entity_scope,
           COALESCE(entity_id, '00000000-0000-0000-0000-000000000000'::UUID))
);

CREATE TABLE risk.stop_loss_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    event_type      VARCHAR(80) NOT NULL,
    -- roas_below_min | daily_loss_exceeded | drawdown_max |
    -- volatility_spike | pixel_freeze | fraud_detected | kill_switch
    entity_type     VARCHAR(30),
    entity_id       UUID,
    triggered_by    VARCHAR(50),
    rule_violated   VARCHAR(200),
    metric_value    NUMERIC,
    threshold_value NUMERIC,
    action_taken    VARCHAR(100),
    resolved_at     TIMESTAMPTZ,
    metadata        JSONB NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    -- append-only — jamais de UPDATE/DELETE
);

CREATE TABLE risk.drawdown (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id),
    period_date     DATE NOT NULL,
    peak_value      NUMERIC(12,2),
    current_value   NUMERIC(12,2),
    drawdown_pct    NUMERIC(5,2),
    drawdown_abs    NUMERIC(12,2),
    risk_level      VARCHAR(20) NOT NULL DEFAULT 'low',
    action_taken    VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(tenant_id, period_date)
);

CREATE TABLE risk.state_expectations (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID,
    entity_type     VARCHAR(50) NOT NULL,
    entity_id       UUID NOT NULL,
    expected_state  JSONB NOT NULL,
    actual_state    JSONB,
    drift_detected  BOOLEAN NOT NULL DEFAULT FALSE,
    drift_score     NUMERIC(5,2) NOT NULL DEFAULT 0,
    auto_repaired   BOOLEAN NOT NULL DEFAULT FALSE,
    repair_action   TEXT,
    checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE risk.incidents (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID REFERENCES saas.tenants(id),
    severity          VARCHAR(20) NOT NULL,  -- low | medium | high | critical | p0
    title             VARCHAR(300) NOT NULL,
    description       TEXT,
    agent_id          VARCHAR(50),
    affected_entities JSONB NOT NULL DEFAULT '[]',
    timeline          JSONB NOT NULL DEFAULT '[]',
    status            VARCHAR(20) NOT NULL DEFAULT 'open',
    resolved_at       TIMESTAMPTZ,
    postmortem        TEXT,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- PLANNING — Schedule de tous les agents (source de vérité)
-- ═══════════════════════════════════════════════════════════

INSERT INTO agents.schedule
  (agent_id, task_type, required_level, schedule_type, cron_expr, priority, tenant_scope, conditions, payload_template)
VALUES
-- ── NIVEAU 1 : basic ────────────────────────────────────
('AGENT_OPS_GUARD',        'ops.budget_cap',           'basic',        'cron',    '*/10 * * * *',    10, 'per_tenant', '{}', '{}'),
('AGENT_ANALYTICS',        'analytics.track',          'basic',        'cron',    '0 * * * *',        7, 'per_tenant', '{}', '{}'),
-- STRATEGY ORGANIC
('AGENT_STRATEGY_ORGANIC', 'strategy.organic_plan',    'basic',        'cron',    '0 6 * * 1',        7, 'per_tenant', '{}', '{"scope":"weekly"}'),
('AGENT_STRATEGY_ORGANIC', 'ugc.batch_production',     'basic',        'cron',    '0 8 * * 2,5',      7, 'per_tenant', '{}', '{"batch_size":10}'),
('AGENT_STRATEGY_ORGANIC', 'content.calendar_build',   'basic',        'cron',    '0 7 1 * *',        6, 'per_tenant', '{}', '{"scope":"month"}'),
('AGENT_STRATEGY_ORGANIC', 'content.repurpose',        'basic',        'cron',    '0 10 * * *',       5, 'per_tenant', '{}', '{}'),
('AGENT_STRATEGY_ORGANIC', 'organic.performance_review','basic',        'cron',    '0 20 * * 0',       6, 'per_tenant', '{}', '{}'),
('AGENT_STRATEGY_ORGANIC', 'ugc.generate_scripts',     'basic',        'trigger', NULL,               8, 'per_tenant', '{}', '{"trigger":"viral_creative_detected"}'),
('AGENT_STRATEGY_ORGANIC', 'audience.persona_build',   'basic',        'trigger', NULL,               7, 'per_tenant', '{}', '{"trigger":"product.ingested"}'),
-- ── NIVEAU 2 : hedge_fund ───────────────────────────────
('AGENT_RISK_ENGINE',      'risk.evaluate',            'hedge_fund',   'cron',    '*/15 * * * *',    10, 'per_tenant', '{}', '{}'),
('AGENT_BUDGET_ALLOCATOR', 'budget.rebalance',         'hedge_fund',   'cron',    '0 */2 * * *',      8, 'per_tenant', '{}', '{}'),
('AGENT_FRAUD_GUARD',      'fraud.detect',             'hedge_fund',   'cron',    '*/5 * * * *',      9, 'per_tenant', '{}', '{}'),
-- ── NIVEAU 3 : full_organism ────────────────────────────
('AGENT_ORCHESTRATOR',     'pipeline.resume',          'full_organism','cron',    '*/5 * * * *',      9, 'per_tenant', '{"has_active_pipelines":true}', '{}'),
('AGENT_MARKET_INTEL',     'intel.scrape_google_trends','full_organism','cron',   '0 */4 * * *',      7, 'global',     '{}', '{"country":"FR"}'),
('AGENT_MARKET_INTEL',     'intel.scrape_tiktok',      'full_organism','cron',    '0 */3 * * *',      7, 'global',     '{}', '{"country":"FR"}'),
('AGENT_MARKET_INTEL',     'intel.scrape_amazon',      'full_organism','cron',    '0 6,14,22 * * *',  6, 'global',     '{}', '{"country":"FR"}'),
('AGENT_MARKET_INTEL',     'intel.scrape_meta',        'full_organism','cron',    '0 */6 * * *',      6, 'global',     '{}', '{"country":"FR"}'),
('AGENT_MARKET_INTEL',     'intel.full_scan',          'full_organism','cron',    '0 0 * * 1',        4, 'global',     '{}', '{"mode":"weekly_deep"}'),
('AGENT_LEARNING',         'learn.extract_patterns',   'full_organism','cron',    '0 3 * * *',        5, 'global',     '{}', '{}'),
('AGENT_EXPERIMENTS',      'experiment.evaluate',      'full_organism','cron',    '0 */6 * * *',      6, 'per_tenant', '{}', '{}'),
('AGENT_HEALTH_SRE',       'health.check',             'full_organism','cron',    '*/2 * * * *',      9, 'global',     '{}', '{}'),
('AGENT_INNOVATION',       'innovation.scan',          'full_organism','cron',    '0 9 * * 1,4',      3, 'global',     '{}', '{}')
ON CONFLICT DO NOTHING;

-- ═══════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════

ALTER TABLE saas.users             ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas.subscriptions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE saas.entitlements      ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.products         ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.offers           ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.pages            ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.assets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.pipeline_runs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.entities           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.actions            ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.organic_strategies ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.ugc_scripts      ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.content_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE connectors.registry    ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk.limits            ENABLE ROW LEVEL SECURITY;

-- Policy RLS (accès limité au tenant courant)
CREATE POLICY tenant_isolation ON store.products
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);
CREATE POLICY tenant_isolation ON store.offers
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);
CREATE POLICY tenant_isolation ON ads.entities
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);
CREATE POLICY tenant_isolation ON intel.ugc_scripts
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);
CREATE POLICY tenant_isolation ON intel.content_calendar
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);
CREATE POLICY tenant_isolation ON risk.limits
    USING (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- ═══════════════════════════════════════════════════════════
-- TRIGGERS updated_at automatiques
-- ═══════════════════════════════════════════════════════════
DO $$ DECLARE r RECORD; BEGIN
  FOR r IN
    VALUES
      ('saas','tenants'),('saas','users'),('saas','subscriptions'),('saas','revenue_share'),
      ('agents','registry'),('agents','schedule'),
      ('ops','runtime_config'),
      ('connectors','registry'),('connectors','token_vault'),
      ('store','products'),('store','offers'),('store','pages'),
      ('store','pipeline_runs'),
      ('ads','entities'),
      ('intel','organic_strategies'),('intel','ugc_scripts'),('intel','content_calendar'),
      ('intel','hook_library'),('intel','creator_briefs'),('intel','experiments'),('intel','patterns'),
      ('risk','limits'),('risk','incidents')
  LOOP
    EXECUTE format(
      'DROP TRIGGER IF EXISTS trg_updated_at ON %I.%I;
       CREATE TRIGGER trg_updated_at BEFORE UPDATE ON %I.%I
       FOR EACH ROW EXECUTE FUNCTION set_updated_at();',
      r.column1, r.column2, r.column1, r.column2
    );
  END LOOP;
END $$;

-- ============================================================
-- RLS PATCH — Tables tenant-scoped manquantes
-- Généré par audit automatique
-- ============================================================

-- saas
ALTER TABLE saas.billing_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas.billing_ledger USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE saas.revenue_share ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON saas.revenue_share USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- events
ALTER TABLE events.outbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events.outbox USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE events.inbox ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON events.inbox USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- jobs
ALTER TABLE jobs.queue ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON jobs.queue USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE jobs.dlq ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON jobs.dlq USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- agents
ALTER TABLE agents.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents.messages USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE agents.decisions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents.decisions USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE agents.metrics ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents.metrics USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE agents.traces ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents.traces USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ops
ALTER TABLE ops.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.alerts USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE ops.runtime_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.runtime_config USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE ops.kill_switch_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.kill_switch_log USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE ops.audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.audit_log USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- connectors
ALTER TABLE connectors.token_vault ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connectors.token_vault USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE connectors.oauth_states ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connectors.oauth_states USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE connectors.call_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON connectors.call_log USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- store
ALTER TABLE store.pipeline_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store.pipeline_approvals USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ads
ALTER TABLE ads.performance_hourly ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ads.performance_hourly USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- intel
ALTER TABLE intel.hook_library ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.hook_library USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.creator_briefs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.creator_briefs USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.repurposing_map ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.repurposing_map USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.audience_analytics ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.audience_analytics USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.signals ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.signals USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.patterns ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.patterns USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.experiments ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.experiments USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.feed ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.feed USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE intel.market_data ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.market_data USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- risk
ALTER TABLE risk.stop_loss_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk.stop_loss_events USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE risk.drawdown ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk.drawdown USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE risk.state_expectations ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk.state_expectations USING (tenant_id = current_setting('app.tenant_id')::UUID);

ALTER TABLE risk.incidents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON risk.incidents USING (tenant_id = current_setting('app.tenant_id')::UUID);
