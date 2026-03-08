-- ============================================================
-- MIGRATION 023 — SOC2 / GDPR / MULTI-RÉGION
-- ============================================================

-- A. DATA RETENTION (SOC2 CC6.7)
CREATE TABLE IF NOT EXISTS compliance.retention_policies (
    id              SERIAL PRIMARY KEY,
    table_name      VARCHAR(100) NOT NULL UNIQUE,
    schema_name     VARCHAR(50)  NOT NULL,
    retention_days  INTEGER      NOT NULL,
    deletion_method VARCHAR(20)  NOT NULL DEFAULT 'delete'
                      CHECK (deletion_method IN ('delete','anonymize','archive')),
    last_purge_at   TIMESTAMPTZ,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE SCHEMA IF NOT EXISTS compliance;

-- Politiques par défaut
INSERT INTO compliance.retention_policies (table_name, schema_name, retention_days, deletion_method) VALUES
('audit_log',       'auth',    365,  'archive'),
('sessions',        'auth',    30,   'delete'),
('messages',        'agents',  90,   'delete'),
('queue',           'jobs',    180,  'archive'),
('quarantine',      'jobs',    90,   'delete'),
('support_tickets', 'ops',     730,  'anonymize'),
('alerts',          'ops',     365,  'delete'),
('performance_daily','ads',    730,  'archive')
ON CONFLICT (table_name) DO NOTHING;

-- B. DSAR (Data Subject Access Request — GDPR Art. 15)
CREATE TABLE IF NOT EXISTS compliance.dsar_requests (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID        REFERENCES saas.tenants(id),
    requester_email VARCHAR(255) NOT NULL,
    request_type    VARCHAR(20) NOT NULL CHECK (request_type IN ('access','deletion','portability','rectification')),
    status          VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','rejected')),
    deadline_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
    completed_at    TIMESTAMPTZ,
    data_export_url VARCHAR(500),
    notes           TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- C. INCIDENT LOG (SOC2 CC7.3)
CREATE TABLE IF NOT EXISTS compliance.incidents (
    id              BIGSERIAL   PRIMARY KEY,
    severity        VARCHAR(20) NOT NULL CHECK (severity IN ('P0','P1','P2','P3')),
    title           VARCHAR(200) NOT NULL,
    description     TEXT,
    affected_tenants UUID[]      DEFAULT '{}',
    detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    root_cause      TEXT,
    remediation     TEXT,
    reported_by     VARCHAR(100),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- D. CHANGE LOG (SOC2 CC8.1 — changements système tracés)
CREATE TABLE IF NOT EXISTS compliance.change_log (
    id          BIGSERIAL   PRIMARY KEY,
    change_type VARCHAR(50) NOT NULL,  -- 'migration'|'config'|'agent_update'|'access_change'
    entity      VARCHAR(100),
    description TEXT        NOT NULL,
    changed_by  VARCHAR(100),
    approved_by VARCHAR(100),
    environment VARCHAR(20) DEFAULT 'prod',
    git_sha     VARCHAR(40),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- E. MULTI-RÉGION — Read replica routing
CREATE TABLE IF NOT EXISTS ops.regions (
    id          VARCHAR(20) PRIMARY KEY,
    name        VARCHAR(60) NOT NULL,
    db_url      VARCHAR(500),            -- read replica URL (chiffré en prod)
    latency_ms  INTEGER,
    is_primary  BOOLEAN     NOT NULL DEFAULT FALSE,
    is_active   BOOLEAN     NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO ops.regions (id, name, is_primary, is_active) VALUES
('eu-west', 'Europe West (Paris)', TRUE, TRUE),
('us-east', 'US East (N. Virginia)', FALSE, FALSE),
('ap-se',   'Asia Pacific (Singapore)', FALSE, FALSE)
ON CONFLICT DO NOTHING;

-- F. ENCRYPTION AT REST LOG (SOC2 CC6.7)
CREATE TABLE IF NOT EXISTS compliance.encryption_status (
    table_name      VARCHAR(100) PRIMARY KEY,
    schema_name     VARCHAR(50)  NOT NULL,
    encrypted_cols  TEXT[]       NOT NULL DEFAULT '{}',
    encryption_algo VARCHAR(30)  DEFAULT 'pgcrypto/aes256',
    last_rotated_at TIMESTAMPTZ,
    rotation_policy_days INTEGER DEFAULT 365,
    verified_at     TIMESTAMPTZ
);

INSERT INTO compliance.encryption_status (table_name, schema_name, encrypted_cols) VALUES
('connectors',     'integrations', ARRAY['access_token_enc','refresh_token_enc']),
('users',          'auth',         ARRAY['totp_secret']),
('subscriptions',  'billing',      ARRAY[]::TEXT[])
ON CONFLICT DO NOTHING;

-- G. PURGE AUTOMATIQUE (appelé via cron)
CREATE OR REPLACE FUNCTION compliance.purge_expired_data()
RETURNS TABLE (table_name VARCHAR, rows_affected BIGINT)
LANGUAGE plpgsql AS $$
DECLARE
    pol compliance.retention_policies%ROWTYPE;
    n   BIGINT;
BEGIN
    FOR pol IN SELECT * FROM compliance.retention_policies WHERE is_active = TRUE LOOP
        BEGIN
            IF pol.deletion_method = 'delete' THEN
                EXECUTE format(
                    'WITH del AS (DELETE FROM %I.%I WHERE created_at < NOW() - ($1 || '' days'')::INTERVAL RETURNING 1) SELECT COUNT(*) FROM del',
                    pol.schema_name, pol.table_name
                ) USING pol.retention_days INTO n;
            END IF;

            UPDATE compliance.retention_policies
            SET last_purge_at = NOW()
            WHERE id = pol.id;

            table_name := pol.schema_name || '.' || pol.table_name;
            rows_affected := COALESCE(n, 0);
            RETURN NEXT;
        EXCEPTION WHEN OTHERS THEN
            table_name := pol.schema_name || '.' || pol.table_name || ' [ERROR]';
            rows_affected := -1;
            RETURN NEXT;
        END;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION compliance.purge_expired_data IS
'Cron daily: SELECT * FROM compliance.purge_expired_data();
 SOC2 CC6.7 — Suppression automatique des données expirées selon politique.';
