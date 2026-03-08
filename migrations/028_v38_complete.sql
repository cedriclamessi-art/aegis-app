-- ============================================================
-- Migration 028 — AEGIS v3.8
-- Dayparting · Pixel Health · AOV · Audience Intel
-- Competitive Intelligence · Deploy infrastructure
-- ============================================================

-- ── 1. DAYPARTING ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS hourly_performance (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  day_of_week     INTEGER NOT NULL CHECK (day_of_week BETWEEN 0 AND 6), -- 0=Sun
  hour_of_day     INTEGER NOT NULL CHECK (hour_of_day BETWEEN 0 AND 23),
  avg_roas        NUMERIC(6,3) NOT NULL DEFAULT 0,
  avg_cpa         NUMERIC(8,2) NOT NULL DEFAULT 0,
  avg_cvr         NUMERIC(6,4) NOT NULL DEFAULT 0,
  avg_ctr         NUMERIC(6,4) NOT NULL DEFAULT 0,
  total_spend     NUMERIC(12,2) NOT NULL DEFAULT 0,
  total_conversions INTEGER NOT NULL DEFAULT 0,
  sample_days     INTEGER NOT NULL DEFAULT 0,
  performance_index NUMERIC(5,2) NOT NULL DEFAULT 1.0, -- 1.0 = baseline, 1.5 = 50% better
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, platform, day_of_week, hour_of_day)
);

CREATE INDEX idx_hourly_perf_shop ON hourly_performance(shop_id, platform);

CREATE TABLE IF NOT EXISTS daypart_schedules (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  is_active       BOOLEAN NOT NULL DEFAULT true,
  budget_multipliers JSONB NOT NULL DEFAULT '{}',
  -- {"0": {"8": 1.2, "19": 1.8, "23": 0.4}, "6": {"10": 1.5}}
  -- day_of_week -> hour -> multiplier
  max_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 2.0,
  min_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 0.2,
  last_applied_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, platform)
);

-- ── 2. PIXEL HEALTH ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pixel_health_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  checked_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Funnel event counts (last hour)
  sessions_1h         INTEGER NOT NULL DEFAULT 0,
  view_content_1h     INTEGER NOT NULL DEFAULT 0,
  add_to_cart_1h      INTEGER NOT NULL DEFAULT 0,
  initiate_checkout_1h INTEGER NOT NULL DEFAULT 0,
  purchase_1h         INTEGER NOT NULL DEFAULT 0,

  -- Computed funnel rates
  vc_rate       NUMERIC(5,4) GENERATED ALWAYS AS (
    CASE WHEN sessions_1h > 0 THEN view_content_1h::numeric / sessions_1h ELSE 0 END
  ) STORED,
  atc_rate      NUMERIC(5,4) GENERATED ALWAYS AS (
    CASE WHEN view_content_1h > 0 THEN add_to_cart_1h::numeric / view_content_1h ELSE 0 END
  ) STORED,
  ic_rate       NUMERIC(5,4) GENERATED ALWAYS AS (
    CASE WHEN add_to_cart_1h > 0 THEN initiate_checkout_1h::numeric / add_to_cart_1h ELSE 0 END
  ) STORED,
  purchase_rate NUMERIC(5,4) GENERATED ALWAYS AS (
    CASE WHEN initiate_checkout_1h > 0 THEN purchase_1h::numeric / initiate_checkout_1h ELSE 0 END
  ) STORED,

  -- Baseline rates (30-day avg)
  baseline_vc_rate  NUMERIC(5,4),
  baseline_atc_rate NUMERIC(5,4),
  baseline_ic_rate  NUMERIC(5,4),
  baseline_purchase_rate NUMERIC(5,4),

  -- Issues detected
  issues          JSONB NOT NULL DEFAULT '[]',
  -- [{event, issue_type, current_rate, baseline_rate, drop_pct, severity}]
  health_score    INTEGER NOT NULL DEFAULT 100, -- 0-100
  status          TEXT NOT NULL DEFAULT 'healthy' CHECK (status IN ('healthy','degraded','broken','no_data'))
);

CREATE INDEX idx_pixel_health_shop ON pixel_health_snapshots(shop_id, platform, checked_at DESC);

-- ── 3. AOV OPTIMIZATION ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS bundle_tests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  bundle_name     TEXT NOT NULL,
  product_ids     TEXT[] NOT NULL,
  bundle_price    NUMERIC(10,2) NOT NULL,
  individual_price NUMERIC(10,2) NOT NULL,  -- sum of individual prices
  discount_pct    NUMERIC(4,2) NOT NULL DEFAULT 0,
  impressions     INTEGER NOT NULL DEFAULT 0,
  clicks          INTEGER NOT NULL DEFAULT 0,
  add_to_cart     INTEGER NOT NULL DEFAULT 0,
  conversions     INTEGER NOT NULL DEFAULT 0,
  revenue         NUMERIC(12,2) NOT NULL DEFAULT 0,
  avg_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  status          TEXT NOT NULL DEFAULT 'testing' CHECK (status IN ('testing','winner','loser','paused')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS aov_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_date     DATE NOT NULL,
  avg_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  median_order_value NUMERIC(10,2) NOT NULL DEFAULT 0,
  orders_with_bundle INTEGER NOT NULL DEFAULT 0,
  orders_single   INTEGER NOT NULL DEFAULT 0,
  upsell_rate     NUMERIC(4,3) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, period_date)
);

-- ── 4. AUDIENCE INTELLIGENCE ─────────────────────────────────
CREATE TABLE IF NOT EXISTS audience_segments (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  platform        TEXT NOT NULL,
  segment_type    TEXT NOT NULL CHECK (segment_type IN ('interest','demographic','custom','lookalike','geo')),
  segment_key     TEXT NOT NULL,   -- e.g. 'yoga_wellness', 'f_25_34_paris', 'lookalike_champions'
  segment_label   TEXT NOT NULL,
  roas            NUMERIC(6,3) NOT NULL DEFAULT 0,
  cpa             NUMERIC(8,2) NOT NULL DEFAULT 0,
  ctr             NUMERIC(6,4) NOT NULL DEFAULT 0,
  cvr             NUMERIC(6,4) NOT NULL DEFAULT 0,
  spend_total     NUMERIC(12,2) NOT NULL DEFAULT 0,
  conversions     INTEGER NOT NULL DEFAULT 0,
  frequency       NUMERIC(5,2) NOT NULL DEFAULT 0,
  saturation_pct  NUMERIC(5,2) NOT NULL DEFAULT 0,  -- % of audience reached
  recommendation  TEXT CHECK (recommendation IN ('scale','maintain','test','pause','exclude')),
  last_analyzed   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, platform, segment_type, segment_key)
);

CREATE INDEX idx_audience_shop ON audience_segments(shop_id, platform, recommendation);

CREATE TABLE IF NOT EXISTS audience_recommendations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  rec_type        TEXT NOT NULL CHECK (rec_type IN ('new_audience','exclude','refresh_seed','scale','pause')),
  priority        TEXT NOT NULL CHECK (priority IN ('urgent','high','medium','low')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  estimated_impact TEXT,
  segment_data    JSONB,
  actioned        BOOLEAN NOT NULL DEFAULT false,
  actioned_at     TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '7 days',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 5. COMPETITIVE INTELLIGENCE (temporal) ───────────────────
CREATE TABLE IF NOT EXISTS competitor_patterns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  pattern_type    TEXT NOT NULL CHECK (pattern_type IN (
    'launch_cadence',    -- how often they launch new creatives
    'budget_cycle',      -- when they increase/decrease budgets
    'seasonal_ramp',     -- pre-holiday behavior
    'hook_reuse',        -- they reuse your hooks after N days
    'platform_shift'     -- moving budget between platforms
  )),
  description     TEXT NOT NULL,
  confidence      NUMERIC(3,2) NOT NULL DEFAULT 0.7,
  evidence        JSONB NOT NULL DEFAULT '[]',
  next_predicted_action TEXT,
  next_predicted_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, competitor_name, pattern_type)
);

CREATE TABLE IF NOT EXISTS competitive_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  competitor_name TEXT NOT NULL,
  alert_type      TEXT NOT NULL,
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  urgency         TEXT NOT NULL CHECK (urgency IN ('now','this_week','monitor')),
  recommended_action TEXT,
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 6. DEPLOY STATE ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS deploy_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  version         TEXT NOT NULL,
  migration_number INTEGER NOT NULL,
  status          TEXT NOT NULL CHECK (status IN ('pending','running','success','failed','rolled_back')),
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  error_message   TEXT,
  rolled_back     BOOLEAN NOT NULL DEFAULT false,
  deployed_by     TEXT
);

-- RLS
ALTER TABLE hourly_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE daypart_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE pixel_health_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE bundle_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE aov_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE audience_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitor_patterns ENABLE ROW LEVEL SECURITY;
ALTER TABLE competitive_alerts ENABLE ROW LEVEL SECURITY;

CREATE POLICY hp_t  ON hourly_performance USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ds_t  ON daypart_schedules USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ph_t  ON pixel_health_snapshots USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY bt_t  ON bundle_tests USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY aov_t ON aov_snapshots USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY as_t  ON audience_segments USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ar_t  ON audience_recommendations USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY cp_t  ON competitor_patterns USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ca_t  ON competitive_alerts USING (shop_id = current_setting('app.shop_id')::UUID);

COMMENT ON TABLE hourly_performance IS 'AEGIS v3.8 — Hourly conversion profiles for dayparting';
COMMENT ON TABLE pixel_health_snapshots IS 'AEGIS v3.8 — Funnel event QA, detects silent pixel breaks';
COMMENT ON TABLE audience_segments IS 'AEGIS v3.8 — Per-segment performance + saturation tracking';
COMMENT ON TABLE competitor_patterns IS 'AEGIS v3.8 — Temporal pattern recognition on competitor behavior';
