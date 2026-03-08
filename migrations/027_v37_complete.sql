-- ============================================================
-- Migration 027 — AEGIS v3.7 Complete Feature Layer
-- RFM · DCT iteration · Klaviyo · Pricing · Knowledge base
-- Sync Guardian · ROI Tracker · Auth · WebSocket · Health
-- Audit log · Onboarding · User prefs · Notifications
-- ============================================================

-- ── 1. RFM CUSTOMER SEGMENTATION ─────────────────────────────
CREATE TABLE IF NOT EXISTS customers (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_cid     TEXT NOT NULL,
  email           TEXT,
  first_order_at  TIMESTAMPTZ,
  last_order_at   TIMESTAMPTZ,
  total_orders    INTEGER NOT NULL DEFAULT 0,
  total_revenue   NUMERIC(12,2) NOT NULL DEFAULT 0,
  avg_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  UNIQUE(shop_id, shopify_cid)
);

CREATE TABLE IF NOT EXISTS customer_rfm (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  recency_days    INTEGER NOT NULL,
  frequency       INTEGER NOT NULL,
  monetary        NUMERIC(12,2) NOT NULL,
  r_score         INTEGER NOT NULL CHECK (r_score BETWEEN 1 AND 5),
  f_score         INTEGER NOT NULL CHECK (f_score BETWEEN 1 AND 5),
  m_score         INTEGER NOT NULL CHECK (m_score BETWEEN 1 AND 5),
  rfm_score       INTEGER GENERATED ALWAYS AS (r_score * 100 + f_score * 10 + m_score) STORED,
  segment         TEXT NOT NULL CHECK (segment IN (
    'champions','loyal','potential_loyal','new_customers',
    'at_risk','cant_lose','hibernating','lost'
  )),
  ltv_predicted   NUMERIC(12,2),
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, customer_id)
);

CREATE INDEX idx_rfm_shop_segment ON customer_rfm(shop_id, segment);

-- ── 2. DCT ITERATION QUEUE ─────────────────────────────────
CREATE TABLE IF NOT EXISTS dct_iteration_queue (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  parent_dct_id   UUID NOT NULL,
  trigger_reason  TEXT NOT NULL,  -- 'fatigue'|'winner_found'|'scheduled'
  winner_tags     JSONB NOT NULL DEFAULT '{}',  -- tags from winner to inherit
  iteration_number INTEGER NOT NULL DEFAULT 1,
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','generating','launched','cancelled')),
  generated_dct_id UUID,
  scheduled_for   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 3. KLAVIYO SYNC ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS klaviyo_sync_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  sync_type       TEXT NOT NULL CHECK (sync_type IN ('rfm_segments','event','profile','flow_trigger')),
  records_synced  INTEGER NOT NULL DEFAULT 0,
  errors          INTEGER NOT NULL DEFAULT 0,
  synced_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS klaviyo_config (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE UNIQUE,
  api_key         TEXT NOT NULL,  -- stored encrypted
  list_id_champions    TEXT,
  list_id_at_risk      TEXT,
  list_id_lost         TEXT,
  list_id_new          TEXT,
  flow_id_post_purchase TEXT,
  flow_id_winback      TEXT,
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 4. PRICING TESTS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_tests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL,
  variant_id_a    TEXT NOT NULL,
  variant_id_b    TEXT NOT NULL,
  price_a         NUMERIC(10,2) NOT NULL,
  price_b         NUMERIC(10,2) NOT NULL,
  start_date      DATE NOT NULL DEFAULT CURRENT_DATE,
  end_date        DATE,
  sessions_a      INTEGER NOT NULL DEFAULT 0,
  sessions_b      INTEGER NOT NULL DEFAULT 0,
  conversions_a   INTEGER NOT NULL DEFAULT 0,
  conversions_b   INTEGER NOT NULL DEFAULT 0,
  revenue_a       NUMERIC(12,2) NOT NULL DEFAULT 0,
  revenue_b       NUMERIC(12,2) NOT NULL DEFAULT 0,
  margin_a        NUMERIC(12,2) NOT NULL DEFAULT 0,
  margin_b        NUMERIC(12,2) NOT NULL DEFAULT 0,
  winner_price    NUMERIC(10,2),
  confidence      NUMERIC(4,3),
  p_value         NUMERIC(8,6),
  status          TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running','significant','no_difference','ended')),
  recommendation  TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. CREATIVE KNOWLEDGE BASE ─────────────────────────────
CREATE TABLE IF NOT EXISTS creative_knowledge (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  insight_type    TEXT NOT NULL CHECK (insight_type IN ('winner_pattern','loser_pattern','audience_insight','seasonal','competitive')),
  title           TEXT NOT NULL,
  insight         TEXT NOT NULL,  -- human-readable LLM-generated insight
  evidence        JSONB NOT NULL DEFAULT '{}',  -- supporting data
  tags            TEXT[] NOT NULL DEFAULT '{}',
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0.8,
  valid_from      DATE NOT NULL DEFAULT CURRENT_DATE,
  valid_until     DATE,  -- null = still valid
  superseded_by   UUID REFERENCES creative_knowledge(id),
  times_applied   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_knowledge_shop_type ON creative_knowledge(shop_id, insight_type);
CREATE INDEX idx_knowledge_tags ON creative_knowledge USING gin(tags);

-- ── 6. SYNC GUARDIAN STATE ─────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_sync_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  entity_type     TEXT NOT NULL,
  entity_id       TEXT NOT NULL,
  aegis_value     JSONB NOT NULL,   -- what AEGIS thinks the value is
  platform_value  JSONB NOT NULL,   -- what the platform actually has
  diverged_at     TIMESTAMPTZ,
  human_override  BOOLEAN NOT NULL DEFAULT false,
  override_detected_at TIMESTAMPTZ,
  aegis_paused_until   TIMESTAMPTZ,  -- AEGIS won't touch this entity until
  resolved_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, platform, entity_type, entity_id)
);

CREATE INDEX idx_sync_state_diverged ON platform_sync_state(shop_id, human_override) WHERE human_override = true;

-- ── 7. ROI TRACKER ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS aegis_roi_ledger (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_month    DATE NOT NULL,  -- first day of month
  agent_name      TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  actions_count   INTEGER NOT NULL DEFAULT 0,
  revenue_attributed NUMERIC(12,2) NOT NULL DEFAULT 0,  -- incremental revenue
  cost_saved      NUMERIC(12,2) NOT NULL DEFAULT 0,      -- wastage prevented
  methodology     TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, period_month, agent_name, action_type)
);

CREATE TABLE IF NOT EXISTS aegis_roi_summary (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_month    DATE NOT NULL,
  total_revenue_attributed NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_cost_saved         NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_impact    NUMERIC(12,2) GENERATED ALWAYS AS (total_revenue_attributed + total_cost_saved) STORED,
  best_agent      TEXT,
  best_agent_impact NUMERIC(12,2),
  aegis_subscription_cost NUMERIC(10,2) NOT NULL DEFAULT 199,  -- monthly SaaS fee
  roi_multiple    NUMERIC(8,2) GENERATED ALWAYS AS (
    CASE WHEN aegis_subscription_cost > 0
    THEN (total_revenue_attributed + total_cost_saved) / aegis_subscription_cost
    ELSE 0 END
  ) STORED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, period_month)
);

-- ── 8. AUTHENTICATION ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email           TEXT NOT NULL UNIQUE,
  password_hash   TEXT NOT NULL,
  full_name       TEXT,
  role            TEXT NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','admin','analyst','viewer')),
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_login_at   TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_shop_access (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  role            TEXT NOT NULL DEFAULT 'analyst',
  granted_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, shop_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  token_hash      TEXT NOT NULL UNIQUE,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sessions_token ON sessions(token_hash) WHERE expires_at > NOW();

-- ── 9. AUDIT LOG ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID REFERENCES shops(id) ON DELETE SET NULL,
  user_id         UUID REFERENCES user_accounts(id) ON DELETE SET NULL,
  agent_name      TEXT,
  action          TEXT NOT NULL,
  entity_type     TEXT,
  entity_id       TEXT,
  old_value       JSONB,
  new_value       JSONB,
  ip_address      INET,
  user_agent      TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_shop ON audit_log(shop_id, created_at DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, created_at DESC);

-- ── 10. USER PREFERENCES ───────────────────────────────────
CREATE TABLE IF NOT EXISTS user_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE UNIQUE,
  theme           TEXT NOT NULL DEFAULT 'dark',
  sidebar_collapsed BOOLEAN NOT NULL DEFAULT false,
  default_shop_id UUID REFERENCES shops(id),
  dashboard_layout JSONB NOT NULL DEFAULT '{}',
  notification_prefs JSONB NOT NULL DEFAULT '{"email":true,"slack":false,"whatsapp":false}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 11. ONBOARDING STATE ───────────────────────────────────
CREATE TABLE IF NOT EXISTS onboarding_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE UNIQUE,
  current_step    INTEGER NOT NULL DEFAULT 1,
  completed_steps INTEGER[] NOT NULL DEFAULT '{}',
  steps           JSONB NOT NULL DEFAULT '{
    "1": {"label":"Connect Shopify","completed":false},
    "2": {"label":"Connect Meta Ads","completed":false},
    "3": {"label":"Set product margins","completed":false},
    "4": {"label":"Configure guardrails","completed":false},
    "5": {"label":"Launch first DCT","completed":false},
    "6": {"label":"Configure brief delivery","completed":false}
  }',
  completed       BOOLEAN NOT NULL DEFAULT false,
  completed_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 12. RATE LIMITING ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS rate_limit_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  identifier      TEXT NOT NULL,  -- IP or user_id
  endpoint        TEXT NOT NULL,
  request_count   INTEGER NOT NULL DEFAULT 1,
  window_start    TIMESTAMPTZ NOT NULL DEFAULT DATE_TRUNC('minute', NOW()),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(identifier, endpoint, window_start)
);

CREATE INDEX idx_rate_limit ON rate_limit_log(identifier, endpoint, window_start);

-- ── 13. WEBSOCKET SUBSCRIPTIONS ────────────────────────────
CREATE TABLE IF NOT EXISTS ws_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id   TEXT NOT NULL,
  user_id         UUID REFERENCES user_accounts(id) ON DELETE CASCADE,
  shop_id         UUID REFERENCES shops(id) ON DELETE CASCADE,
  channels        TEXT[] NOT NULL DEFAULT '{}',
  connected_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_ping_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_ws_shop ON ws_subscriptions(shop_id);

-- RLS
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_rfm ENABLE ROW LEVEL SECURITY;
ALTER TABLE dct_iteration_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_sync_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE klaviyo_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE pricing_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_knowledge ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_sync_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE aegis_roi_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE aegis_roi_summary ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY cust_tenant   ON customers USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY rfm_tenant    ON customer_rfm USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY dct_iter_t    ON dct_iteration_queue USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY klav_log_t    ON klaviyo_sync_log USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY klav_cfg_t    ON klaviyo_config USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY pricing_t     ON pricing_tests USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY knowledge_t   ON creative_knowledge USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY sync_t        ON platform_sync_state USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY roi_ledger_t  ON aegis_roi_ledger USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY roi_sum_t     ON aegis_roi_summary USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY audit_t       ON audit_log USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY onboard_t     ON onboarding_state USING (shop_id = current_setting('app.shop_id')::UUID);

COMMENT ON TABLE customer_rfm IS 'AEGIS v3.7 — RFM segmentation. Champions/Loyal/At-risk/Hibernating/Lost';
COMMENT ON TABLE dct_iteration_queue IS 'AEGIS v3.7 — Auto DCT iteration when winner fatigues';
COMMENT ON TABLE creative_knowledge IS 'AEGIS v3.7 — Long-term creative knowledge base. LLM narrative insights';
COMMENT ON TABLE platform_sync_state IS 'AEGIS v3.7 — Sync Guardian. Detects human overrides, pauses AEGIS actions';
COMMENT ON TABLE aegis_roi_summary IS 'AEGIS v3.7 — AEGIS own ROI. Revenue attributed + cost saved vs subscription';
COMMENT ON TABLE audit_log IS 'AEGIS v3.7 — Full audit trail. Who changed what, when, from where';
