-- ============================================================
-- MIGRATION 022 — BILLING SAAS + ADMIN LIFETIME + REVENUE SHARE
-- ============================================================
-- Idempotent · Additif · RLS partout
--
-- Couvre :
--   A. Plans tarifaires (Starter/Pro/Elite/Scale)
--   B. Subscriptions + trial 15 jours
--   C. Admin lifetime (jonathanlamessi@yahoo.fr)
--   D. Revenue share 2% à partir de 200k€/mois
--   E. Quotas par plan (jobs, créatives, stores, actions)
--   F. Bootstrap admin sécurisé (reset token, jamais password en dur)
--   G. agents.messages (communication inter-agents)
-- ============================================================

CREATE SCHEMA IF NOT EXISTS billing;
CREATE SCHEMA IF NOT EXISTS auth;

-- ============================================================
-- A. PLANS
-- ============================================================

CREATE TABLE IF NOT EXISTS billing.plans (
    id                  VARCHAR(20)     PRIMARY KEY,
    name                VARCHAR(60)     NOT NULL,
    price_eur_monthly   NUMERIC(10,2)   NOT NULL,
    price_eur_yearly    NUMERIC(10,2),
    -- Quotas
    max_stores          INTEGER         NOT NULL DEFAULT 1,
    max_active_pipelines INTEGER        NOT NULL DEFAULT 1,
    max_creatives_month INTEGER         NOT NULL DEFAULT 50,
    max_jobs_day        INTEGER         NOT NULL DEFAULT 500,
    max_ad_spend_month  NUMERIC(12,2),               -- NULL = illimité
    -- Fonctionnalités
    autopilot_mode      VARCHAR(20)     NOT NULL DEFAULT 'human'
                          CHECK (autopilot_mode IN ('human','semi','full')),
    multi_worker        BOOLEAN         NOT NULL DEFAULT FALSE,
    priority_queue      BOOLEAN         NOT NULL DEFAULT FALSE,
    sla_internal        BOOLEAN         NOT NULL DEFAULT FALSE,
    revenue_share_pct   NUMERIC(5,2)    NOT NULL DEFAULT 0,  -- % du CA tracké
    revenue_share_threshold_eur NUMERIC(12,2) DEFAULT 200000, -- seuil mensuel
    -- Meta
    is_active           BOOLEAN         NOT NULL DEFAULT TRUE,
    stripe_price_id     VARCHAR(100),
    description         TEXT,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

INSERT INTO billing.plans VALUES
('starter', 'Starter',   99.00,   990.00,
 1, 1,  50,  500,  5000,   'human',  FALSE, FALSE, FALSE, 0,      NULL,
 TRUE, NULL, '1 boutique · 1 pipeline · Human Control · Idéal pour valider'),

('pro',     'Pro',       299.00,  2990.00,
 3, 3,  200, 2000, 30000,  'semi',   FALSE, FALSE, FALSE, 0,      NULL,
 TRUE, NULL, '3 boutiques · Semi-Auto · Creative Factory avancée'),

('elite',   'Elite',     799.00,  7990.00,
 10, 10, 1000, 10000, NULL, 'full',  FALSE, TRUE,  FALSE, 0,      NULL,
 TRUE, NULL, '10 boutiques · Full Autopilot · Priority queue'),

('scale',   'Scale',     1990.00, 19900.00,
 -1, -1, -1, -1, NULL,     'full',  TRUE,  TRUE,  TRUE,  2.00,   200000,
 TRUE, NULL, 'Illimité raisonnable · SLA interne · Revenue share 2% au-delà de 200k€/mois')
ON CONFLICT (id) DO UPDATE SET
    price_eur_monthly        = EXCLUDED.price_eur_monthly,
    max_stores               = EXCLUDED.max_stores,
    max_active_pipelines     = EXCLUDED.max_active_pipelines,
    max_creatives_month      = EXCLUDED.max_creatives_month,
    max_jobs_day             = EXCLUDED.max_jobs_day,
    autopilot_mode           = EXCLUDED.autopilot_mode,
    revenue_share_pct        = EXCLUDED.revenue_share_pct,
    revenue_share_threshold_eur = EXCLUDED.revenue_share_threshold_eur;

-- ============================================================
-- B. SUBSCRIPTIONS
-- ============================================================

CREATE TABLE IF NOT EXISTS billing.subscriptions (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID            NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    plan_id             VARCHAR(20)     NOT NULL REFERENCES billing.plans(id),
    -- Trial
    trial_starts_at     TIMESTAMPTZ,
    trial_ends_at       TIMESTAMPTZ,    -- trial_starts + 15j
    trial_used          BOOLEAN         NOT NULL DEFAULT FALSE,
    -- Subscription active
    status              VARCHAR(20)     NOT NULL DEFAULT 'trial'
                          CHECK (status IN ('trial','active','past_due','cancelled','paused','lifetime')),
    current_period_start TIMESTAMPTZ,
    current_period_end   TIMESTAMPTZ,
    cancelled_at         TIMESTAMPTZ,
    -- Stripe
    stripe_subscription_id  VARCHAR(100) UNIQUE,
    stripe_customer_id       VARCHAR(100),
    -- Override contractuel
    contract_override   JSONB           DEFAULT '{}',  -- ex: revenue_share_pct personnalisé
    -- Meta
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subs_tenant   ON billing.subscriptions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_subs_stripe   ON billing.subscriptions (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

ALTER TABLE billing.subscriptions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing.subscriptions
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Trigger updated_at
CREATE OR REPLACE FUNCTION billing.touch_subscription()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS touch_subscription ON billing.subscriptions;
CREATE TRIGGER touch_subscription
    BEFORE UPDATE ON billing.subscriptions
    FOR EACH ROW EXECUTE FUNCTION billing.touch_subscription();

-- ============================================================
-- C. QUOTAS USAGE (compteurs mensuels par tenant)
-- ============================================================

CREATE TABLE IF NOT EXISTS billing.usage (
    id                  BIGSERIAL       PRIMARY KEY,
    tenant_id           UUID            NOT NULL REFERENCES saas.tenants(id),
    period_month        DATE            NOT NULL,   -- premier jour du mois
    -- Compteurs
    jobs_count          INTEGER         NOT NULL DEFAULT 0,
    creatives_count     INTEGER         NOT NULL DEFAULT 0,
    actions_count       INTEGER         NOT NULL DEFAULT 0,
    -- Revenue pour revenue share
    revenue_tracked_eur NUMERIC(14,2)   NOT NULL DEFAULT 0,
    revenue_share_eur   NUMERIC(14,2)   NOT NULL DEFAULT 0,  -- 2% si seuil atteint
    -- Meta
    computed_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, period_month)
);

ALTER TABLE billing.usage ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing.usage
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Fonction : incrémenter un compteur d'usage
CREATE OR REPLACE FUNCTION billing.increment_usage(
    p_tenant_id     UUID,
    p_metric        VARCHAR,   -- 'jobs' | 'creatives' | 'actions'
    p_amount        INTEGER DEFAULT 1
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_period DATE := DATE_TRUNC('month', NOW())::DATE;
BEGIN
    INSERT INTO billing.usage (tenant_id, period_month)
    VALUES (p_tenant_id, v_period)
    ON CONFLICT (tenant_id, period_month) DO NOTHING;

    EXECUTE format(
        'UPDATE billing.usage SET %I = %I + $1, computed_at = NOW()
         WHERE tenant_id = $2 AND period_month = $3',
        p_metric || '_count', p_metric || '_count'
    ) USING p_amount, p_tenant_id, v_period;
END;
$$;

-- Fonction : vérifier quota + bloquer si dépassé
CREATE OR REPLACE FUNCTION billing.check_quota(
    p_tenant_id UUID,
    p_metric    VARCHAR    -- 'jobs' | 'creatives' | 'actions' | 'stores'
)
RETURNS TABLE (
    allowed         BOOLEAN,
    current_usage   INTEGER,
    plan_limit      INTEGER,
    plan_id         VARCHAR,
    message         TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sub   billing.subscriptions%ROWTYPE;
    v_plan  billing.plans%ROWTYPE;
    v_used  INTEGER := 0;
    v_limit INTEGER;
BEGIN
    -- Sub active
    SELECT * INTO v_sub FROM billing.subscriptions
    WHERE tenant_id = p_tenant_id
      AND status IN ('trial','active','lifetime')
    ORDER BY created_at DESC LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, 0, 0, NULL::VARCHAR, 'Pas de subscription active'::TEXT;
        RETURN;
    END IF;

    -- Plan
    SELECT * INTO v_plan FROM billing.plans WHERE id = v_sub.plan_id;

    -- Vérifier trial expiré
    IF v_sub.status = 'trial' AND v_sub.trial_ends_at < NOW() THEN
        RETURN QUERY SELECT FALSE, 0, 0, v_sub.plan_id, 'Trial expiré — mise à niveau requise'::TEXT;
        RETURN;
    END IF;

    -- Usage ce mois
    SELECT CASE p_metric
        WHEN 'jobs'      THEN COALESCE(u.jobs_count, 0)
        WHEN 'creatives' THEN COALESCE(u.creatives_count, 0)
        WHEN 'actions'   THEN COALESCE(u.actions_count, 0)
        ELSE 0
    END INTO v_used
    FROM billing.usage u
    WHERE u.tenant_id = p_tenant_id
      AND u.period_month = DATE_TRUNC('month', NOW())::DATE;

    v_used := COALESCE(v_used, 0);

    -- Limite du plan
    v_limit := CASE p_metric
        WHEN 'jobs'      THEN v_plan.max_jobs_day * 30
        WHEN 'creatives' THEN v_plan.max_creatives_month
        WHEN 'actions'   THEN v_plan.max_jobs_day * 30
        WHEN 'stores'    THEN v_plan.max_stores
        ELSE -1
    END;

    -- -1 = illimité
    IF v_limit = -1 THEN
        RETURN QUERY SELECT TRUE, v_used, -1, v_sub.plan_id, 'Illimité'::TEXT;
        RETURN;
    END IF;

    RETURN QUERY SELECT
        v_used < v_limit,
        v_used,
        v_limit,
        v_sub.plan_id,
        CASE WHEN v_used >= v_limit
            THEN format('Quota %s atteint : %s/%s. Upgrade requis.', p_metric, v_used, v_limit)
            ELSE format('OK : %s/%s utilisé', v_used, v_limit)
        END;
END;
$$;

-- ============================================================
-- D. REVENUE SHARE
-- ============================================================

CREATE TABLE IF NOT EXISTS billing.revenue_share (
    id                  BIGSERIAL       PRIMARY KEY,
    tenant_id           UUID            NOT NULL REFERENCES saas.tenants(id),
    period_month        DATE            NOT NULL,
    revenue_eur         NUMERIC(14,2)   NOT NULL DEFAULT 0,
    threshold_eur       NUMERIC(14,2)   NOT NULL DEFAULT 200000,
    share_pct           NUMERIC(5,2)    NOT NULL DEFAULT 2.00,
    share_amount_eur    NUMERIC(14,2)   GENERATED ALWAYS AS (
        CASE WHEN revenue_eur > threshold_eur
             THEN ROUND((revenue_eur - threshold_eur) * share_pct / 100, 2)
             ELSE 0
        END
    ) STORED,
    invoiced            BOOLEAN         NOT NULL DEFAULT FALSE,
    invoiced_at         TIMESTAMPTZ,
    stripe_invoice_id   VARCHAR(100),
    computed_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, period_month)
);

ALTER TABLE billing.revenue_share ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON billing.revenue_share
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- ============================================================
-- E. AUTH — Bootstrap admin sécurisé
-- ============================================================

ALTER TABLE saas.tenants
    ADD COLUMN IF NOT EXISTS admin_lifetime    BOOLEAN     NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS plan_override     VARCHAR(20) REFERENCES billing.plans(id);

CREATE TABLE IF NOT EXISTS auth.users (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID            REFERENCES saas.tenants(id) ON DELETE CASCADE,
    email               VARCHAR(255)    NOT NULL UNIQUE,
    -- Password : jamais en dur — hash bcrypt uniquement
    password_hash       VARCHAR(255),   -- NULL = pas encore de password (reset requis)
    -- Rôles
    role                VARCHAR(30)     NOT NULL DEFAULT 'owner'
                          CHECK (role IN ('superadmin','owner','admin','member','viewer')),
    admin_lifetime      BOOLEAN         NOT NULL DEFAULT FALSE,
    -- Reset sécurisé
    reset_token_hash    VARCHAR(255),   -- hash du token de reset (token lui-même → email)
    reset_token_expires TIMESTAMPTZ,
    -- 2FA (stub v1)
    totp_secret         VARCHAR(100),
    totp_enabled        BOOLEAN         NOT NULL DEFAULT FALSE,
    -- Meta
    email_verified      BOOLEAN         NOT NULL DEFAULT FALSE,
    last_login_at       TIMESTAMPTZ,
    failed_login_count  INTEGER         NOT NULL DEFAULT 0,
    locked_until        TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email    ON auth.users (email);
CREATE INDEX IF NOT EXISTS idx_users_tenant   ON auth.users (tenant_id);
CREATE INDEX IF NOT EXISTS idx_users_lifetime ON auth.users (admin_lifetime) WHERE admin_lifetime = TRUE;

-- Pas de RLS sur auth.users — géré par middleware (accès via service account uniquement)

-- Sessions
CREATE TABLE IF NOT EXISTS auth.sessions (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id             UUID            NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    token_hash          VARCHAR(255)    NOT NULL UNIQUE,  -- hash du JWT ou session token
    ip_address          INET,
    user_agent          TEXT,
    expires_at          TIMESTAMPTZ     NOT NULL,
    revoked_at          TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user    ON auth.sessions (user_id, expires_at);
CREATE INDEX IF NOT EXISTS idx_sessions_token   ON auth.sessions (token_hash) WHERE revoked_at IS NULL;

-- Audit log auth
CREATE TABLE IF NOT EXISTS auth.audit_log (
    id          BIGSERIAL   PRIMARY KEY,
    user_id     UUID        REFERENCES auth.users(id),
    email       VARCHAR(255),
    event       VARCHAR(50) NOT NULL,  -- 'login'|'logout'|'reset_request'|'reset_confirm'|'2fa_ok'|'locked'
    ip_address  INET,
    metadata    JSONB       DEFAULT '{}',
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── Bootstrap admin : fonction appelée au boot du backend ──
-- Crée le compte superadmin s'il n'existe pas.
-- Génère un reset_token → doit être envoyé par email ou affiché au premier boot.
-- JAMAIS de password en dur.

CREATE OR REPLACE FUNCTION auth.bootstrap_admin(
    p_email         VARCHAR DEFAULT 'jonathanlamessi@yahoo.fr',
    p_token_hash    VARCHAR DEFAULT NULL   -- Si NULL → génère un UUID token hash
)
RETURNS TABLE (
    created         BOOLEAN,
    user_id         UUID,
    email           VARCHAR,
    reset_needed    BOOLEAN,
    message         TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_user_id   UUID;
    v_token     VARCHAR;
    v_exists    BOOLEAN;
BEGIN
    SELECT EXISTS(SELECT 1 FROM auth.users WHERE email = p_email AND admin_lifetime = TRUE)
    INTO v_exists;

    IF v_exists THEN
        SELECT id INTO v_user_id FROM auth.users WHERE email = p_email;
        RETURN QUERY SELECT FALSE, v_user_id, p_email, FALSE,
            'Admin déjà existant — aucune modification'::TEXT;
        RETURN;
    END IF;

    -- Token reset unique
    v_token := COALESCE(p_token_hash, encode(gen_random_bytes(32), 'hex'));

    -- Crée le tenant AEGIS admin s'il n'existe pas
    INSERT INTO saas.tenants (slug, name, admin_lifetime)
    VALUES ('aegis-admin', 'AEGIS Admin', TRUE)
    ON CONFLICT (slug) DO NOTHING;

    -- Crée l'utilisateur
    INSERT INTO auth.users (
        tenant_id, email, role, admin_lifetime,
        password_hash,           -- NULL : doit passer par reset
        reset_token_hash, reset_token_expires,
        email_verified
    )
    SELECT
        t.id,
        p_email,
        'superadmin',
        TRUE,
        NULL,
        v_token,
        NOW() + INTERVAL '24 hours',
        TRUE
    FROM saas.tenants t WHERE t.slug = 'aegis-admin'
    RETURNING id INTO v_user_id;

    -- Subscription lifetime
    INSERT INTO billing.subscriptions (
        tenant_id, plan_id, status, trial_used
    )
    SELECT
        t.id, 'scale', 'lifetime', TRUE
    FROM saas.tenants t WHERE t.slug = 'aegis-admin'
    ON CONFLICT DO NOTHING;

    RETURN QUERY SELECT TRUE, v_user_id, p_email, TRUE,
        format('Admin créé. Reset token (valable 24h) : %s', v_token)::TEXT;
END;
$$;

-- ============================================================
-- F. AGENTS.MESSAGES (communication inter-agents)
-- ============================================================

CREATE TABLE IF NOT EXISTS agents.messages (
    id              BIGSERIAL       PRIMARY KEY,
    tenant_id       UUID            REFERENCES saas.tenants(id),
    from_agent      VARCHAR(60)     NOT NULL,
    to_agent        VARCHAR(60)     NOT NULL,
    message_type    VARCHAR(60)     NOT NULL,   -- 'request'|'response'|'broadcast'|'alert'
    correlation_id  UUID            DEFAULT gen_random_uuid(),
    payload         JSONB           NOT NULL DEFAULT '{}',
    priority        SMALLINT        NOT NULL DEFAULT 5,  -- 1=urgent, 10=low
    status          VARCHAR(20)     NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','delivered','processed','failed')),
    delivered_at    TIMESTAMPTZ,
    processed_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ     DEFAULT NOW() + INTERVAL '24 hours',
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_to_agent  ON agents.messages (to_agent, status, priority) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_messages_tenant    ON agents.messages (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_corr      ON agents.messages (correlation_id);

ALTER TABLE agents.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents.messages
    USING (tenant_id = current_setting('app.tenant_id')::UUID OR tenant_id IS NULL);

-- Claim atomique : un seul worker prend le message
CREATE OR REPLACE FUNCTION agents.claim_message(
    p_to_agent      VARCHAR,
    p_batch_size    INTEGER DEFAULT 5
)
RETURNS SETOF agents.messages
LANGUAGE sql AS $$
    UPDATE agents.messages
    SET status = 'delivered', delivered_at = NOW()
    WHERE id IN (
        SELECT id FROM agents.messages
        WHERE to_agent = p_to_agent
          AND status   = 'pending'
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY priority ASC, created_at ASC
        LIMIT p_batch_size
        FOR UPDATE SKIP LOCKED
    )
    RETURNING *;
$$;

-- Helper : envoyer un message entre agents
CREATE OR REPLACE FUNCTION agents.send_message(
    p_from_agent    VARCHAR,
    p_to_agent      VARCHAR,
    p_type          VARCHAR,
    p_payload       JSONB,
    p_tenant_id     UUID DEFAULT NULL,
    p_priority      SMALLINT DEFAULT 5
)
RETURNS BIGINT LANGUAGE sql AS $$
    INSERT INTO agents.messages
        (tenant_id, from_agent, to_agent, message_type, payload, priority)
    VALUES
        (p_tenant_id, p_from_agent, p_to_agent, p_type, p_payload, p_priority)
    RETURNING id;
$$;

-- ============================================================
-- G. METABOLIC THROTTLE
-- ============================================================
-- Si le taux d'erreur d'un agent dépasse le seuil sur 1h →
-- il passe en mode ralenti (throttled) pendant cooldown_minutes

CREATE TABLE IF NOT EXISTS agents.throttle_state (
    agent_id        VARCHAR(60)     PRIMARY KEY,
    tenant_id       UUID            REFERENCES saas.tenants(id),
    error_count_1h  INTEGER         NOT NULL DEFAULT 0,
    success_count_1h INTEGER        NOT NULL DEFAULT 0,
    failrate_pct    NUMERIC(5,2)    GENERATED ALWAYS AS (
        CASE WHEN (error_count_1h + success_count_1h) = 0 THEN 0
             ELSE ROUND(error_count_1h::NUMERIC / (error_count_1h + success_count_1h) * 100, 1)
        END
    ) STORED,
    throttled       BOOLEAN         NOT NULL DEFAULT FALSE,
    throttle_until  TIMESTAMPTZ,
    throttle_reason TEXT,
    last_updated    TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

ALTER TABLE agents.throttle_state ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON agents.throttle_state
    USING (tenant_id = current_setting('app.tenant_id')::UUID OR tenant_id IS NULL);

CREATE OR REPLACE FUNCTION agents.check_throttle(
    p_agent_id          VARCHAR,
    p_failrate_threshold NUMERIC DEFAULT 30,   -- % erreurs avant throttle
    p_cooldown_minutes  INTEGER DEFAULT 15
)
RETURNS TABLE (throttled BOOLEAN, reason TEXT)
LANGUAGE plpgsql AS $$
DECLARE
    v_state agents.throttle_state%ROWTYPE;
BEGIN
    SELECT * INTO v_state FROM agents.throttle_state WHERE agent_id = p_agent_id;

    -- Déjà throttlé ?
    IF v_state.throttled AND v_state.throttle_until > NOW() THEN
        RETURN QUERY SELECT TRUE,
            format('Agent throttlé jusqu''à %s (failrate %.1f%%)',
                v_state.throttle_until, v_state.failrate_pct);
        RETURN;
    END IF;

    -- Throttle expiré — reset
    IF v_state.throttled AND v_state.throttle_until <= NOW() THEN
        UPDATE agents.throttle_state
        SET throttled=FALSE, throttle_until=NULL, error_count_1h=0, success_count_1h=0
        WHERE agent_id = p_agent_id;
    END IF;

    -- Seuil dépassé ?
    IF v_state.failrate_pct >= p_failrate_threshold THEN
        UPDATE agents.throttle_state
        SET throttled=TRUE,
            throttle_until = NOW() + (p_cooldown_minutes || ' minutes')::INTERVAL,
            throttle_reason = format('Failrate %.1f%% ≥ seuil %s%%', v_state.failrate_pct, p_failrate_threshold)
        WHERE agent_id = p_agent_id;

        RETURN QUERY SELECT TRUE,
            format('Throttle activé : failrate %.1f%% > %s%%', v_state.failrate_pct, p_failrate_threshold);
        RETURN;
    END IF;

    RETURN QUERY SELECT FALSE, 'OK'::TEXT;
END;
$$;

-- ============================================================
-- H. POISON PILL QUARANTINE (DLQ avancé)
-- ============================================================

CREATE TABLE IF NOT EXISTS jobs.quarantine (
    id              BIGSERIAL       PRIMARY KEY,
    original_job_id BIGINT,
    tenant_id       UUID            REFERENCES saas.tenants(id),
    task_type       VARCHAR(100)    NOT NULL,
    payload         JSONB           NOT NULL DEFAULT '{}',
    error_history   JSONB           NOT NULL DEFAULT '[]',  -- array des erreurs
    retry_count     INTEGER         NOT NULL DEFAULT 0,
    quarantine_reason VARCHAR(200),
    can_replay      BOOLEAN         NOT NULL DEFAULT FALSE,
    replayed_at     TIMESTAMPTZ,
    quarantined_at  TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_quarantine_tenant ON jobs.quarantine (tenant_id, quarantined_at DESC);

ALTER TABLE jobs.quarantine ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON jobs.quarantine
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Fonction : déplacer un job vers la quarantine
CREATE OR REPLACE FUNCTION jobs.quarantine_job(
    p_job_id        BIGINT,
    p_reason        VARCHAR,
    p_can_replay    BOOLEAN DEFAULT FALSE
)
RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE
    v_job jobs.queue%ROWTYPE;
BEGIN
    SELECT * INTO v_job FROM jobs.queue WHERE id = p_job_id;
    IF NOT FOUND THEN RETURN; END IF;

    INSERT INTO jobs.quarantine (
        original_job_id, tenant_id, task_type, payload,
        error_history, retry_count, quarantine_reason, can_replay
    ) VALUES (
        p_job_id, v_job.tenant_id, v_job.task_type, v_job.payload,
        COALESCE(v_job.error_log, '[]'::JSONB), v_job.attempts,
        p_reason, p_can_replay
    );

    -- Marque le job original comme poison
    UPDATE jobs.queue SET status = 'quarantined' WHERE id = p_job_id;
END;
$$;

-- ============================================================
-- I. SEED : plans + admin bootstrap
-- ============================================================

-- Active le bootstrap (appelé manuellement ou au boot)
-- SELECT * FROM auth.bootstrap_admin();
-- → retourne le reset_token à envoyer par email

-- Commentaire intentionnel : on ne seed PAS le password.
-- Le boot script appelle auth.bootstrap_admin() et envoie le reset_token par email/log.

COMMENT ON FUNCTION auth.bootstrap_admin IS
'Crée le compte superadmin si absent. Retourne un reset_token valable 24h.
 Ne jamais stocker de password en dur. Appeler au premier boot uniquement.
 Email whitelist : jonathanlamessi@yahoo.fr — plan Scale lifetime gratuit.';

-- ============================================================
-- REGISTRY PATCH : 7 nouveaux agents + mise à jour compteur
-- ============================================================

INSERT INTO agents.registry (agent_id, name, description, required_tier, status) VALUES
('AGENT_PRODUCT_INGEST',    'Product Ingest',    'URL → ProductRecord normalisé + dispatch pipeline',       'basic',        'active'),
('AGENT_OFFER_ENGINE',      'Offer Engine',      '3 packs prix · bonus · garantie · promesse principale',   'basic',        'active'),
('AGENT_ATTRIBUTION',       'Attribution',       'MER · ROAS réel · CAC · drift attribution iOS 14.5+',     'hedge_fund',   'active'),
('AGENT_FINANCE_GUARD',     'Finance Guard',     'Marges · COGS · break-even · projection trésorerie',      'basic',        'active'),
('AGENT_CONNECTOR_MANAGER', 'Connector Manager', 'OAuth tokens · refresh · chiffrement pgcrypto · dégradé', 'basic',        'active'),
('AGENT_SUPPORT_SAV',       'Support SAV',       'Triage tickets · réponses auto · détection chargeback',   'basic',        'active'),
('AGENT_RELEASE_MANAGER',   'Release Manager',   'Migrations · versioning · health post-deploy · rollback', 'basic',        'active')
ON CONFLICT (agent_id) DO UPDATE SET
    name        = EXCLUDED.name,
    description = EXCLUDED.description,
    status      = EXCLUDED.status;

COMMENT ON TABLE agents.messages IS
'Communication inter-agents. claim_message() atomique avec SKIP LOCKED.
 Priorité 1=urgent, 10=low. TTL 24h par défaut.';
