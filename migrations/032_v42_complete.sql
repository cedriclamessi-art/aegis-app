-- ============================================================
-- Migration 032 — AEGIS v4.2
-- Global Calendar · Replenishment · Dashboard · Budget Optimizer
-- Email Recovery · Brief A/B · Mobile PWA
-- ============================================================

-- ── 1. GLOBAL CALENDAR (multi-region) ────────────────────────
-- Drop old single-region structure, replace with regional
CREATE TABLE IF NOT EXISTS seasonal_event_regions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id        UUID NOT NULL REFERENCES seasonal_events(id) ON DELETE CASCADE,
  region          TEXT NOT NULL,    -- FR, BE, CH, UK, US, CA, AU, DE, NL, MENA, GLOBAL
  peak_date       DATE NOT NULL,
  phases          JSONB NOT NULL DEFAULT '{}',
  active_audiences TEXT[] NOT NULL DEFAULT '{}',
  -- Meta audience targeting regions that this applies to
  is_active       BOOLEAN NOT NULL DEFAULT true,
  auto_apply      BOOLEAN NOT NULL DEFAULT false,
  current_phase   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(event_id, region)
);

CREATE INDEX idx_ser_event   ON seasonal_event_regions(event_id, region);
CREATE INDEX idx_ser_upcoming ON seasonal_event_regions(region, peak_date, is_active);

-- ── 2. REPLENISHMENT ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS product_inventory (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_product_id TEXT NOT NULL,
  shopify_variant_id TEXT NOT NULL,
  product_name    TEXT NOT NULL,
  sku             TEXT,
  current_stock   INTEGER NOT NULL DEFAULT 0,
  committed_stock INTEGER NOT NULL DEFAULT 0,  -- in open orders
  available_stock INTEGER GENERATED ALWAYS AS (current_stock - committed_stock) STORED,
  reorder_point   INTEGER NOT NULL DEFAULT 50,  -- auto-computed
  reorder_quantity INTEGER NOT NULL DEFAULT 200,
  supplier_lead_days INTEGER NOT NULL DEFAULT 21,
  avg_daily_sales NUMERIC(8,2) NOT NULL DEFAULT 0,
  days_of_stock   NUMERIC(8,2) GENERATED ALWAYS AS (
    CASE WHEN avg_daily_sales > 0
    THEN (current_stock - committed_stock)::numeric / avg_daily_sales
    ELSE 999 END
  ) STORED,
  last_synced_at  TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, shopify_variant_id)
);

CREATE TABLE IF NOT EXISTS replenishment_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id      UUID NOT NULL REFERENCES product_inventory(id),
  alert_type      TEXT NOT NULL CHECK (alert_type IN (
    'reorder_now',       -- stock will run out before lead time
    'reorder_soon',      -- 3 weeks buffer
    'seasonal_prep',     -- event coming, should stock up
    'overstock'          -- too much stock, slow down ads
  )),
  days_until_stockout NUMERIC(6,1),
  recommended_order_qty INTEGER,
  estimated_lost_revenue NUMERIC(10,2),
  seasonal_event  TEXT,
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_inventory_shop ON product_inventory(shop_id, days_of_stock ASC);
CREATE INDEX idx_repl_alerts    ON replenishment_alerts(shop_id, acknowledged, created_at DESC);

-- ── 3. BUDGET OPTIMIZER (inter-platform) ─────────────────────
CREATE TABLE IF NOT EXISTS platform_budget_allocation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_daily_budget NUMERIC(10,2) NOT NULL,
  allocations     JSONB NOT NULL DEFAULT '{}',
  -- {"meta": {"budget": 300, "pct": 60, "marginal_roas": 2.8},
  --  "tiktok": {"budget": 150, "pct": 30, "marginal_roas": 3.4},
  --  "google": {"budget": 50, "pct": 10, "marginal_roas": 1.9}}
  recommended_shift JSONB,
  -- {"from": "meta", "to": "tiktok", "amount": 50, "reason": "..."}
  applied         BOOLEAN NOT NULL DEFAULT false,
  applied_at      TIMESTAMPTZ
);

CREATE INDEX idx_budget_alloc_shop ON platform_budget_allocation(shop_id, recorded_at DESC);

-- ── 4. EMAIL RECOVERY (smart cart abandonment) ────────────────
CREATE TABLE IF NOT EXISTS cart_abandonment_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_email  TEXT NOT NULL,
  session_id      TEXT,
  cart_value      NUMERIC(10,2) NOT NULL,
  product_ids     TEXT[] NOT NULL DEFAULT '{}',
  rfm_segment     TEXT,               -- from AGENT_RFM
  converting_angle TEXT,              -- from AGENT_ATTRIBUTION
  best_creative_hook TEXT,            -- current winning hook
  klaviyo_flow_id TEXT,
  flow_content_injected JSONB,       -- what we injected
  recovered       BOOLEAN NOT NULL DEFAULT false,
  recovered_at    TIMESTAMPTZ,
  recovery_order_id TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cart_shop ON cart_abandonment_events(shop_id, recovered, created_at DESC);

-- ── 5. BRIEF A/B TRACKING ──────────────────────────────────
CREATE TABLE IF NOT EXISTS brief_delivery_experiments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  variant         TEXT NOT NULL CHECK (variant IN ('A','B')),
  -- A = current format, B = new format
  format          TEXT NOT NULL CHECK (format IN ('slack_long','slack_short','email_long','email_short')),
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  opened          BOOLEAN NOT NULL DEFAULT false,
  opened_at       TIMESTAMPTZ,
  actions_taken_2h INTEGER NOT NULL DEFAULT 0,
  -- decisions made in dashboard within 2h of brief delivery
  cta_clicked     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_brief_exp_shop ON brief_delivery_experiments(shop_id, delivered_at DESC);

CREATE TABLE IF NOT EXISTS brief_ab_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  variant_a_opens       NUMERIC(4,3),
  variant_b_opens       NUMERIC(4,3),
  variant_a_actions     NUMERIC(4,2),
  variant_b_actions     NUMERIC(4,2),
  winner          TEXT CHECK (winner IN ('A','B','no_difference')),
  confidence      NUMERIC(4,3),
  recommendation  TEXT,
  UNIQUE(shop_id, period_start)
);

-- ── 6. PWA / MOBILE ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES user_accounts(id) ON DELETE CASCADE,
  endpoint        TEXT NOT NULL,
  auth_key        TEXT NOT NULL,
  p256dh_key      TEXT NOT NULL,
  device_label    TEXT,
  subscribed_events TEXT[] NOT NULL DEFAULT '{"anomaly_critical","constitutional_veto","stock_critical"}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, endpoint)
);

-- RLS
ALTER TABLE seasonal_event_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE replenishment_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE platform_budget_allocation ENABLE ROW LEVEL SECURITY;
ALTER TABLE cart_abandonment_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_delivery_experiments ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_ab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY ser_t  ON seasonal_event_regions USING (
  event_id IN (SELECT id FROM seasonal_events WHERE shop_id = current_setting('app.shop_id',true)::UUID));
CREATE POLICY pi_t   ON product_inventory USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY ra_t   ON replenishment_alerts USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY pba_t  ON platform_budget_allocation USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY cae_t  ON cart_abandonment_events USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY bde_t  ON brief_delivery_experiments USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY bar_t  ON brief_ab_results USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY ps_t   ON push_subscriptions USING (shop_id = current_setting('app.shop_id',true)::UUID);

COMMENT ON TABLE seasonal_event_regions IS 'AEGIS v4.2 — Per-region peak dates for global events';
COMMENT ON TABLE product_inventory IS 'AEGIS v4.2 — Stock levels with days_of_stock computed column';
COMMENT ON TABLE platform_budget_allocation IS 'AEGIS v4.2 — Inter-platform budget shift recommendations';
