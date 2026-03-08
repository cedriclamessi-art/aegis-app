-- ============================================================
-- Migration 031 — AEGIS v4.1
-- Health Probes · Seasonal Calendar · PDF Report
-- GA4 Integration · Multi-currency · Natural Language Decisions
-- ============================================================

-- ── 1. HEALTH PROBES ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS health_probe_results (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  probe_name      TEXT NOT NULL,
  agent_target    TEXT NOT NULL,
  ran_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  passed          BOOLEAN NOT NULL,
  latency_ms      INTEGER,
  expected_output TEXT,
  actual_output   TEXT,
  error           TEXT,
  environment     TEXT NOT NULL DEFAULT 'production'
);

CREATE INDEX idx_probe_results ON health_probe_results(probe_name, ran_at DESC);

CREATE TABLE IF NOT EXISTS health_probe_status (
  probe_name      TEXT PRIMARY KEY,
  last_ran_at     TIMESTAMPTZ,
  last_passed     BOOLEAN,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  alerted         BOOLEAN NOT NULL DEFAULT false,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 2. SEASONAL CALENDAR ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS seasonal_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  event_name      TEXT NOT NULL,
  event_type      TEXT NOT NULL CHECK (event_type IN (
    'holiday','promotion','product_launch','seasonal','competitive'
  )),
  peak_date       DATE NOT NULL,
  phases          JSONB NOT NULL DEFAULT '{}',
  -- {
  --   "preparation": {"start_days_before": 21, "end_days_before": 6, "budget_multiplier": 1.3, "empire_mode": "balanced"},
  --   "acceleration": {"start_days_before": 5,  "end_days_before": 1, "budget_multiplier": 1.8, "empire_mode": "aggressive"},
  --   "peak":         {"start_days_before": 0,  "end_days_after":  1, "budget_multiplier": 2.2, "empire_mode": "aggressive"},
  --   "deceleration": {"start_days_after":  2,  "end_days_after":  5, "budget_multiplier": 0.7, "empire_mode": "conservative"}
  -- }
  is_active       BOOLEAN NOT NULL DEFAULT true,
  auto_apply      BOOLEAN NOT NULL DEFAULT false,
  current_phase   TEXT,  -- which phase is active right now (null if none)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, event_name, peak_date)
);

CREATE INDEX idx_seasonal_shop ON seasonal_events(shop_id, peak_date, is_active);

CREATE TABLE IF NOT EXISTS seasonal_phase_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  event_id        UUID NOT NULL REFERENCES seasonal_events(id) ON DELETE CASCADE,
  phase_name      TEXT NOT NULL,
  entered_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  exited_at       TIMESTAMPTZ,
  budget_multiplier_applied NUMERIC(4,2),
  empire_mode_set TEXT
);

-- ── 3. MONTHLY PDF REPORTS ────────────────────────────────────
CREATE TABLE IF NOT EXISTS monthly_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_month    DATE NOT NULL,  -- first day of month
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  pdf_path        TEXT,           -- file path or S3 key
  data_snapshot   JSONB NOT NULL DEFAULT '{}',  -- all data used to generate
  email_sent      BOOLEAN NOT NULL DEFAULT false,
  email_sent_at   TIMESTAMPTZ,
  UNIQUE(shop_id, period_month)
);

-- ── 4. GA4 INTEGRATION ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS ga4_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  session_date    DATE NOT NULL,
  source          TEXT,
  medium          TEXT,
  campaign        TEXT,
  sessions        INTEGER NOT NULL DEFAULT 0,
  users           INTEGER NOT NULL DEFAULT 0,
  new_users       INTEGER NOT NULL DEFAULT 0,
  bounce_rate     NUMERIC(5,4),
  pages_per_session NUMERIC(5,2),
  avg_session_duration INTEGER,  -- seconds
  transactions    INTEGER NOT NULL DEFAULT 0,
  revenue         NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, session_date, source, medium, campaign)
);

CREATE TABLE IF NOT EXISTS ga4_pixel_divergence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  divergence_date DATE NOT NULL,
  platform        TEXT NOT NULL,
  ga4_sessions    INTEGER,
  pixel_sessions  INTEGER,
  ga4_conversions INTEGER,
  pixel_conversions INTEGER,
  divergence_pct  NUMERIC(6,2) GENERATED ALWAYS AS (
    CASE WHEN ga4_conversions > 0
    THEN ABS(pixel_conversions - ga4_conversions)::numeric / ga4_conversions * 100
    ELSE 0 END
  ) STORED,
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, divergence_date, platform)
);

-- ── 5. MULTI-CURRENCY ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS currency_rates (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_currency   TEXT NOT NULL,  -- EUR, GBP, CHF, CAD
  to_currency     TEXT NOT NULL DEFAULT 'EUR',
  rate            NUMERIC(10,6) NOT NULL,
  fetched_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source          TEXT NOT NULL DEFAULT 'ecb',
  UNIQUE(from_currency, to_currency, DATE(fetched_at))
);

CREATE INDEX idx_rates_pair ON currency_rates(from_currency, to_currency, fetched_at DESC);

-- Add currency column to shops if not exists
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
    WHERE table_name='shops' AND column_name='base_currency') THEN
    ALTER TABLE shops ADD COLUMN base_currency TEXT NOT NULL DEFAULT 'EUR';
  END IF;
END $$;

-- ── 6. NATURAL LANGUAGE DECISION LOG ─────────────────────────
CREATE TABLE IF NOT EXISTS decision_narratives (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  decision_id     UUID NOT NULL REFERENCES agent_decisions(id) ON DELETE CASCADE,
  narrative_fr    TEXT NOT NULL,  -- human-readable French explanation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(decision_id)
);

CREATE INDEX idx_narratives_shop ON decision_narratives(shop_id, created_at DESC);

-- RLS
ALTER TABLE health_probe_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE seasonal_phase_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ga4_pixel_divergence ENABLE ROW LEVEL SECURITY;
ALTER TABLE currency_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE decision_narratives ENABLE ROW LEVEL SECURITY;

CREATE POLICY hpr_open ON health_probe_results USING (true);  -- global, no tenant
CREATE POLICY se_t  ON seasonal_events USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY spl_t ON seasonal_phase_log USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY mr_t  ON monthly_reports USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY ga4_t ON ga4_sessions USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY ga4d_t ON ga4_pixel_divergence USING (shop_id = current_setting('app.shop_id', true)::UUID);
CREATE POLICY cr_open ON currency_rates USING (true);  -- global
CREATE POLICY dn_t  ON decision_narratives USING (shop_id = current_setting('app.shop_id', true)::UUID);

COMMENT ON TABLE health_probe_results IS 'AEGIS v4.1 — Active end-to-end probes every 6h';
COMMENT ON TABLE seasonal_events IS 'AEGIS v4.1 — Seasonal calendar with phased budget multipliers';
COMMENT ON TABLE monthly_reports IS 'AEGIS v4.1 — Auto-generated PDF monthly reports';
COMMENT ON TABLE ga4_pixel_divergence IS 'AEGIS v4.1 — GA4 vs pixel cross-validation';
COMMENT ON TABLE decision_narratives IS 'AEGIS v4.1 — Natural language FR explanations of agent decisions';
