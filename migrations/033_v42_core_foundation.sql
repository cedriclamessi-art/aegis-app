-- ============================================================
-- Migration 033 — AEGIS v4.2 — Core Foundation Tables
-- These tables are referenced throughout the codebase but were
-- missing from the migration chain (existed in earlier
-- development versions, not carried forward).
-- ============================================================

-- ── SET SEARCH PATH — agents use public schema ───────────────
-- All agent code queries without schema prefix (e.g. FROM shops)
-- This migration establishes the public-schema foundation.

-- ── SHOPS / TENANTS ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS shops (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name              TEXT NOT NULL,
  shopify_domain    TEXT UNIQUE,
  shopify_id        TEXT UNIQUE,
  plan_id           TEXT NOT NULL DEFAULT 'starter',
  base_currency     TEXT NOT NULL DEFAULT 'EUR',
  timezone          TEXT NOT NULL DEFAULT 'Europe/Paris',
  owner_email       TEXT NOT NULL,
  onboarded         BOOLEAN NOT NULL DEFAULT false,
  autopilot_mode    TEXT NOT NULL DEFAULT 'shadow'
    CHECK (autopilot_mode IN ('shadow','manual','semi_auto','full_auto')),
  feature_flags     JSONB NOT NULL DEFAULT '{}',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_shops_domain ON shops(shopify_domain) WHERE shopify_domain IS NOT NULL;

-- ── USER ACCOUNTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_accounts (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  email       TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','viewer')),
  password_hash TEXT,
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, email)
);

-- ── PLATFORM CREDENTIALS (encrypted) ─────────────────────────
CREATE TABLE IF NOT EXISTS platform_credentials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN (
    'meta','tiktok','google','klaviyo','shopify','ga4','pinterest','snapchat'
  )),
  -- All sensitive fields stored encrypted (AES-256 via pgcrypto or app-layer)
  access_token  TEXT,         -- encrypted
  refresh_token TEXT,         -- encrypted
  account_id    TEXT,
  property_id   TEXT,         -- GA4
  pixel_id      TEXT,
  extra         JSONB NOT NULL DEFAULT '{}',
  expires_at    TIMESTAMPTZ,
  is_active     BOOLEAN NOT NULL DEFAULT true,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, platform)
);

-- Alias used in older agent code
CREATE OR REPLACE VIEW shopify_credentials AS
  SELECT id, shop_id,
    access_token,
    extra->>'store_domain' AS store_domain
  FROM platform_credentials
  WHERE platform = 'shopify';

CREATE OR REPLACE VIEW klaviyo_config AS
  SELECT id, shop_id,
    access_token AS api_key,
    extra->>'list_id' AS default_list_id
  FROM platform_credentials
  WHERE platform = 'klaviyo';

-- ── AD METRICS (core performance table) ───────────────────────
CREATE TABLE IF NOT EXISTS ad_metrics (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform      TEXT NOT NULL CHECK (platform IN ('meta','tiktok','google','pinterest','snapchat')),
  entity_type   TEXT NOT NULL CHECK (entity_type IN ('account','campaign','adset','ad')),
  entity_id     TEXT NOT NULL,
  entity_name   TEXT,
  -- Daily metrics
  recorded_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  spend         NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue       NUMERIC(12,2) NOT NULL DEFAULT 0,
  impressions   INTEGER NOT NULL DEFAULT 0,
  clicks        INTEGER NOT NULL DEFAULT 0,
  conversions   INTEGER NOT NULL DEFAULT 0,
  roas          NUMERIC(8,4) GENERATED ALWAYS AS (
    CASE WHEN spend > 0 THEN revenue / spend ELSE 0 END
  ) STORED,
  cpa           NUMERIC(10,2) GENERATED ALWAYS AS (
    CASE WHEN conversions > 0 THEN spend / conversions ELSE 0 END
  ) STORED,
  ctr           NUMERIC(8,6) GENERATED ALWAYS AS (
    CASE WHEN impressions > 0 THEN clicks::numeric / impressions ELSE 0 END
  ) STORED,
  daily_budget  NUMERIC(10,2),
  status        TEXT NOT NULL DEFAULT 'active',
  UNIQUE(shop_id, platform, entity_id, DATE(recorded_at))
) PARTITION BY RANGE (recorded_at);

CREATE TABLE IF NOT EXISTS ad_metrics_2025 PARTITION OF ad_metrics
  FOR VALUES FROM ('2025-01-01') TO ('2026-01-01');
CREATE TABLE IF NOT EXISTS ad_metrics_2026 PARTITION OF ad_metrics
  FOR VALUES FROM ('2026-01-01') TO ('2027-01-01');
CREATE TABLE IF NOT EXISTS ad_metrics_2027 PARTITION OF ad_metrics
  FOR VALUES FROM ('2027-01-01') TO ('2028-01-01');

CREATE INDEX idx_adm_shop_platform ON ad_metrics(shop_id, platform, recorded_at DESC);
CREATE INDEX idx_adm_entity        ON ad_metrics(shop_id, entity_type, entity_id, recorded_at DESC);

-- Latest snapshot view (replaces ad_metrics_latest table refs)
CREATE OR REPLACE VIEW ad_metrics_latest AS
  SELECT DISTINCT ON (shop_id, platform, entity_id)
    *
  FROM ad_metrics
  ORDER BY shop_id, platform, entity_id, recorded_at DESC;

-- ── AD SETS ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ad_sets (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  adset_id        TEXT NOT NULL,
  adset_name      TEXT NOT NULL,
  campaign_id     TEXT,
  daily_budget    NUMERIC(10,2),
  status          TEXT NOT NULL DEFAULT 'active',
  targeting_regions TEXT[] NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, platform, adset_id)
);

CREATE INDEX idx_adsets_shop ON ad_sets(shop_id, platform, status);

-- ── GUARDRAIL CONFIGS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS guardrail_configs (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  key         TEXT NOT NULL,
  value       TEXT NOT NULL,
  unit        TEXT,
  description TEXT,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_by  TEXT,
  UNIQUE(shop_id, key)
);

-- Default guardrails inserted on shop creation
CREATE OR REPLACE FUNCTION insert_default_guardrails()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO guardrail_configs (shop_id, key, value, unit, description) VALUES
    (NEW.id, 'max_cpa',         '50',   'EUR', 'Max cost per acquisition'),
    (NEW.id, 'max_daily_spend', '500',  'EUR', 'Max daily ad spend'),
    (NEW.id, 'min_roas',        '2.0',  'x',   'Minimum return on ad spend'),
    (NEW.id, 'max_budget_delta','0.5',  'pct', 'Max budget change per action (50%)'),
    (NEW.id, 'min_ad_age_hours','24',   'h',   'Minimum age before killing an ad')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_default_guardrails ON shops;
CREATE TRIGGER trg_default_guardrails
  AFTER INSERT ON shops
  FOR EACH ROW EXECUTE FUNCTION insert_default_guardrails();

-- ── SHOPIFY ORDER ITEMS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS shopify_order_items (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_order_id  TEXT NOT NULL,
  shopify_product_id TEXT NOT NULL,
  shopify_variant_id TEXT NOT NULL,
  product_title     TEXT,
  quantity          INTEGER NOT NULL DEFAULT 1,
  price             NUMERIC(10,2) NOT NULL,
  currency          TEXT NOT NULL DEFAULT 'EUR',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_order_items_shop    ON shopify_order_items(shop_id, created_at DESC);
CREATE INDEX idx_order_items_variant ON shopify_order_items(shop_id, shopify_variant_id, created_at DESC);

-- ── CAPI EVENTS (public schema alias) ────────────────────────
-- analytics.capi_events exists in 017_capi_relay.sql
-- Agents query FROM capi_events (no schema prefix) — create view
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema='analytics' AND table_name='capi_events'
  ) THEN
    EXECUTE 'CREATE OR REPLACE VIEW capi_events AS SELECT * FROM analytics.capi_events';
    EXECUTE 'CREATE OR REPLACE VIEW capi_config  AS SELECT * FROM analytics.capi_config';
  ELSE
    -- Standalone (no analytics schema): create directly
    CREATE TABLE IF NOT EXISTS capi_events (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
      platform    TEXT NOT NULL,
      event_id    TEXT NOT NULL,
      event_name  TEXT NOT NULL,
      event_time  TIMESTAMPTZ NOT NULL,
      pixel_id    TEXT,
      customer_email TEXT,
      order_id    TEXT,
      value       NUMERIC(10,2),
      currency    TEXT DEFAULT 'EUR',
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(platform, event_id)
    );
  END IF;
END;
$$;

-- ── WORLD STATE ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS world_state (
  shop_id              UUID PRIMARY KEY REFERENCES shops(id) ON DELETE CASCADE,
  empire_index         NUMERIC(5,2) NOT NULL DEFAULT 50,
  empire_mode          TEXT NOT NULL DEFAULT 'balanced'
    CHECK (empire_mode IN ('conservative','balanced','aggressive')),
  roas_24h             NUMERIC(8,4),
  cpa_24h              NUMERIC(10,2),
  spend_today          NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_today        NUMERIC(12,2) NOT NULL DEFAULT 0,
  active_anomalies     JSONB NOT NULL DEFAULT '[]',
  active_signals       JSONB NOT NULL DEFAULT '[]',
  seasonal_override    JSONB,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── AGENT SCHEDULE (populated by seed below) ─────────────────
CREATE TABLE IF NOT EXISTS agent_schedule (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        TEXT NOT NULL,  -- e.g. AGENT_SCALE
  task_type       TEXT NOT NULL,
  schedule_type   TEXT NOT NULL DEFAULT 'interval' CHECK (schedule_type IN ('interval','cron','trigger')),
  interval_ms     INTEGER,
  cron_expr       TEXT,
  tenant_scope    TEXT NOT NULL DEFAULT 'all',
  payload_template JSONB NOT NULL DEFAULT '{}',
  conditions      JSONB NOT NULL DEFAULT '{}',
  priority        INTEGER NOT NULL DEFAULT 5,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  next_run_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_schedule_next ON agent_schedule(next_run_at, is_active);

-- ── RLS ───────────────────────────────────────────────────────
ALTER TABLE shops                ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_accounts        ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_credentials ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_metrics           ENABLE ROW LEVEL SECURITY;
ALTER TABLE ad_sets              ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_configs    ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_order_items  ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_state          ENABLE ROW LEVEL SECURITY;

CREATE POLICY shops_tenant ON shops
  USING (id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY ua_tenant ON user_accounts
  USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY pc_tenant ON platform_credentials
  USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY adm_tenant ON ad_metrics
  USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY ads_tenant ON ad_sets
  USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY gc_tenant ON guardrail_configs
  USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY soi_tenant ON shopify_order_items
  USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY ws_tenant ON world_state
  USING (shop_id = current_setting('app.shop_id', true)::UUID);

COMMENT ON TABLE shops             IS 'AEGIS v4.2 — Core tenant table';
COMMENT ON TABLE ad_metrics        IS 'AEGIS v4.2 — Daily performance metrics, partitioned by year';
COMMENT ON TABLE ad_metrics_latest IS 'View: latest snapshot per entity';
COMMENT ON TABLE guardrail_configs IS 'AEGIS v4.2 — Per-shop guardrail thresholds, default-populated on shop creation';
COMMENT ON TABLE world_state       IS 'AEGIS v4.2 — Live world state per shop, updated by AGENT_ORCHESTRATOR';
