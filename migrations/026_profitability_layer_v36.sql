-- ============================================================
-- Migration 026 — AEGIS v3.6 Profitability & Intelligence Layer
-- 1. Contribution margin & real profitability
-- 2. Statistical significance (DCT winner validation)
-- 3. First-party attribution reconciliation
-- 4. Creative vision tagging
-- 5. Brief delivery preferences
-- 6. Forecasting & projections
-- ============================================================

-- ── 1. PRODUCT ECONOMICS ─────────────────────────────────────
-- COGS, return rates, platform fees per SKU/product

CREATE TABLE IF NOT EXISTS product_economics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  product_id      TEXT NOT NULL,                   -- Shopify product_id
  variant_id      TEXT,                             -- optional variant
  product_name    TEXT NOT NULL,
  selling_price   NUMERIC(10,2) NOT NULL,
  cogs            NUMERIC(10,2) NOT NULL,           -- cost of goods
  shipping_cost   NUMERIC(10,2) NOT NULL DEFAULT 0,
  return_rate     NUMERIC(4,3) NOT NULL DEFAULT 0.10, -- 0.10 = 10%
  platform_fee_pct NUMERIC(4,3) NOT NULL DEFAULT 0.029, -- Shopify 2.9%
  gross_margin    NUMERIC(10,2) GENERATED ALWAYS AS (
    selling_price - cogs - shipping_cost - (selling_price * platform_fee_pct)
  ) STORED,
  effective_gross_margin NUMERIC(4,3) GENERATED ALWAYS AS (
    (selling_price - cogs - shipping_cost - (selling_price * platform_fee_pct)) /
    NULLIF(selling_price, 0)
  ) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, product_id, COALESCE(variant_id, ''))
);

-- ── 2. PROFITABILITY METRICS ──────────────────────────────────
-- Real contribution margin per ad/campaign/period

CREATE TABLE IF NOT EXISTS profitability_metrics (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_start    TIMESTAMPTZ NOT NULL,
  period_end      TIMESTAMPTZ NOT NULL,
  granularity     TEXT NOT NULL CHECK (granularity IN ('hourly','daily','weekly')),
  entity_type     TEXT NOT NULL CHECK (entity_type IN ('ad','adset','campaign','platform','shop')),
  entity_id       TEXT,

  -- Raw metrics
  gross_revenue   NUMERIC(12,2) NOT NULL DEFAULT 0,
  refunded_amount NUMERIC(12,2) NOT NULL DEFAULT 0,  -- from Shopify refund events
  net_revenue     NUMERIC(12,2) GENERATED ALWAYS AS (gross_revenue - refunded_amount) STORED,
  ad_spend        NUMERIC(12,2) NOT NULL DEFAULT 0,
  cogs_total      NUMERIC(12,2) NOT NULL DEFAULT 0,
  shipping_total  NUMERIC(12,2) NOT NULL DEFAULT 0,
  platform_fees   NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Computed real profitability
  gross_profit    NUMERIC(12,2) GENERATED ALWAYS AS (
    (gross_revenue - refunded_amount) - cogs_total - shipping_total - platform_fees
  ) STORED,
  contribution_margin NUMERIC(12,2) GENERATED ALWAYS AS (
    (gross_revenue - refunded_amount) - cogs_total - shipping_total - platform_fees - ad_spend
  ) STORED,
  contribution_margin_pct NUMERIC(6,3) GENERATED ALWAYS AS (
    CASE WHEN gross_revenue > 0
    THEN ((gross_revenue - refunded_amount) - cogs_total - shipping_total - platform_fees - ad_spend)
         / (gross_revenue - refunded_amount)
    ELSE 0 END
  ) STORED,
  true_roas       NUMERIC(8,3) GENERATED ALWAYS AS (
    CASE WHEN ad_spend > 0
    THEN (gross_revenue - refunded_amount) / ad_spend
    ELSE 0 END
  ) STORED,
  orders          INTEGER NOT NULL DEFAULT 0,
  refunded_orders INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_profitability_shop_period ON profitability_metrics(shop_id, period_start DESC);
CREATE INDEX idx_profitability_entity ON profitability_metrics(shop_id, entity_type, entity_id);

-- ── 3. SHOPIFY REFUND EVENTS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS shopify_refund_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_order_id TEXT NOT NULL,
  shopify_refund_id TEXT NOT NULL UNIQUE,
  refund_amount   NUMERIC(10,2) NOT NULL,
  refund_reason   TEXT,
  line_items      JSONB NOT NULL DEFAULT '[]',
  refunded_at     TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refunds_shop ON shopify_refund_events(shop_id, refunded_at DESC);

-- ── 4. DCT STATISTICAL TESTS ──────────────────────────────────
CREATE TABLE IF NOT EXISTS dct_stat_tests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  dct_id          UUID NOT NULL,
  tested_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Test config
  confidence_threshold NUMERIC(4,3) NOT NULL DEFAULT 0.90,
  min_events_per_variant INTEGER NOT NULL DEFAULT 50,

  -- Results per variant
  variants_data   JSONB NOT NULL,  -- [{variant_id, impressions, conversions, conv_rate, z_score}]

  -- Winner declaration
  winner_variant_id TEXT,
  winner_confidence NUMERIC(6,4),  -- 0-1
  is_significant  BOOLEAN NOT NULL DEFAULT false,
  test_method     TEXT NOT NULL DEFAULT 'z_test', -- 'z_test' | 'chi_square'
  p_value         NUMERIC(8,6),
  sample_sizes    JSONB,           -- {variant_id: n}

  -- Status
  status          TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN (
    'insufficient_data',  -- not enough events yet
    'in_progress',        -- still collecting
    'significant',        -- winner found with required confidence
    'no_winner',          -- test complete, no significant difference
    'manually_overridden' -- human override
  )),
  recommendation  TEXT,           -- LLM-generated recommendation
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_dct_stat_tests_dct ON dct_stat_tests(shop_id, dct_id, tested_at DESC);

-- ── 5. ATTRIBUTION ────────────────────────────────────────────
-- First-party order reconciliation across platforms

CREATE TABLE IF NOT EXISTS attribution_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_order_id TEXT NOT NULL,
  event_id        TEXT NOT NULL UNIQUE,  -- dedup key sent to all platforms

  -- Platform claims for this order
  platform_claims JSONB NOT NULL DEFAULT '[]',
  -- [{platform, ad_id, campaign_id, timestamp, window_hours, click_type}]

  -- Resolved attribution
  attributed_platform TEXT,  -- final attributed platform
  attributed_ad_id    TEXT,
  attribution_model   TEXT NOT NULL DEFAULT 'last_click',  -- 'last_click'|'linear'|'data_driven'
  attribution_confidence NUMERIC(3,2),

  -- Order value
  order_value     NUMERIC(10,2) NOT NULL,
  order_at        TIMESTAMPTZ NOT NULL,

  -- Dedup flags
  is_duplicate    BOOLEAN NOT NULL DEFAULT false,
  duplicate_of    UUID REFERENCES attribution_events(id),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_attribution_shop_order ON attribution_events(shop_id, shopify_order_id);
CREATE INDEX idx_attribution_platform ON attribution_events(shop_id, attributed_platform);
CREATE UNIQUE INDEX idx_attribution_event_id ON attribution_events(event_id);

-- Platform attribution totals (deduplicated) vs raw
CREATE TABLE IF NOT EXISTS attribution_reconciliation (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_date     DATE NOT NULL,
  platform        TEXT NOT NULL,

  -- What platforms report
  platform_reported_conversions INTEGER NOT NULL DEFAULT 0,
  platform_reported_revenue     NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- What Shopify actually recorded (deduplicated)
  shopify_actual_conversions    INTEGER NOT NULL DEFAULT 0,
  shopify_actual_revenue        NUMERIC(12,2) NOT NULL DEFAULT 0,

  -- Inflation factor
  attribution_inflation_pct     NUMERIC(6,2) GENERATED ALWAYS AS (
    CASE WHEN shopify_actual_conversions > 0
    THEN ((platform_reported_conversions - shopify_actual_conversions)::numeric
          / shopify_actual_conversions) * 100
    ELSE 0 END
  ) STORED,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, period_date, platform)
);

-- ── 6. CREATIVE TAGS ─────────────────────────────────────────
-- AI vision analysis of each creative asset

CREATE TABLE IF NOT EXISTS creative_tags (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  creative_id     TEXT NOT NULL,
  asset_url       TEXT NOT NULL,
  asset_type      TEXT NOT NULL CHECK (asset_type IN ('image','video','reel','story')),

  -- Vision-extracted tags
  has_human_face  BOOLEAN,
  face_gender     TEXT,          -- 'female'|'male'|'multiple'|'none'
  face_age_range  TEXT,          -- '18-24'|'25-34'|'35-44'|'45+'
  emotion_primary TEXT,          -- 'joy'|'surprise'|'trust'|'fear'|'anticipation'
  hook_type       TEXT,          -- 'question'|'pov'|'before_after'|'testimonial'|'demo'|'shock'
  content_angle   TEXT,          -- 'transformation'|'social_proof'|'pain'|'curiosity'|'urgency'
  visual_style    TEXT,          -- 'ugc'|'studio'|'lifestyle'|'animated'|'text_only'
  has_text_overlay BOOLEAN,
  text_overlay_content TEXT,
  dominant_colors TEXT[],        -- hex codes
  background_type TEXT,          -- 'bathroom'|'outdoor'|'studio'|'bedroom'|'none'
  product_visible BOOLEAN,
  duration_seconds NUMERIC(6,1), -- for video
  has_captions   BOOLEAN,
  has_music      BOOLEAN,
  energy_level   TEXT,           -- 'calm'|'medium'|'high'

  -- Performance correlation (filled after N days)
  avg_ctr         NUMERIC(6,4),
  avg_roas        NUMERIC(6,3),
  avg_hook_rate   NUMERIC(4,3),   -- % who watch past 3s
  total_impressions BIGINT DEFAULT 0,
  total_conversions INTEGER DEFAULT 0,

  -- Tagging metadata
  tagged_by       TEXT NOT NULL DEFAULT 'AGENT_CREATIVE_VISION',
  tag_confidence  NUMERIC(3,2) DEFAULT 0.85,
  raw_analysis    TEXT,           -- full LLM response
  tagged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, creative_id)
);

CREATE INDEX idx_creative_tags_shop ON creative_tags(shop_id);
CREATE INDEX idx_creative_tags_angle ON creative_tags(shop_id, content_angle);
CREATE INDEX idx_creative_tags_hook ON creative_tags(shop_id, hook_type);

-- Aggregate performance by tag dimension
CREATE MATERIALIZED VIEW IF NOT EXISTS creative_tag_performance AS
SELECT
  ct.shop_id,
  ct.content_angle,
  ct.hook_type,
  ct.has_human_face,
  ct.face_gender,
  ct.visual_style,
  ct.asset_type,
  COUNT(*)                     AS creative_count,
  AVG(ct.avg_ctr)              AS avg_ctr,
  AVG(ct.avg_roas)             AS avg_roas,
  AVG(ct.avg_hook_rate)        AS avg_hook_rate,
  SUM(ct.total_impressions)    AS total_impressions
FROM creative_tags ct
WHERE ct.total_impressions > 1000  -- min volume filter
GROUP BY ct.shop_id, ct.content_angle, ct.hook_type,
         ct.has_human_face, ct.face_gender, ct.visual_style, ct.asset_type;

-- ── 7. BRIEF DELIVERY PREFERENCES ────────────────────────────
CREATE TABLE IF NOT EXISTS brief_delivery_preferences (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE UNIQUE,
  email_enabled   BOOLEAN NOT NULL DEFAULT false,
  email_address   TEXT,
  slack_enabled   BOOLEAN NOT NULL DEFAULT false,
  slack_webhook_url TEXT,
  slack_channel   TEXT DEFAULT '#aegis-alerts',
  whatsapp_enabled BOOLEAN NOT NULL DEFAULT false,
  whatsapp_number TEXT,           -- E.164 format +33...
  delivery_time   TIME NOT NULL DEFAULT '06:00:00',
  timezone        TEXT NOT NULL DEFAULT 'Europe/Paris',
  digest_format   TEXT NOT NULL DEFAULT 'full' CHECK (digest_format IN ('full','compact','kpi_only')),
  enabled         BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Brief delivery log
CREATE TABLE IF NOT EXISTS brief_delivery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  brief_date      DATE NOT NULL,
  channel         TEXT NOT NULL CHECK (channel IN ('email','slack','whatsapp')),
  status          TEXT NOT NULL CHECK (status IN ('sent','failed','skipped')),
  error_msg       TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── 8. FORECASTS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS forecasts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  forecast_horizon_days INTEGER NOT NULL DEFAULT 14,
  model_version   TEXT NOT NULL DEFAULT 'v1',

  -- Daily forecast array
  daily_forecasts JSONB NOT NULL,
  -- [{date, revenue_low, revenue_mid, revenue_high,
  --   spend_forecast, roas_forecast, cpa_forecast,
  --   confidence, flags: ['weekend_boost','promo','stock_risk']}]

  -- Aggregate 14d
  total_revenue_mid   NUMERIC(12,2),
  total_spend_mid     NUMERIC(12,2),
  avg_roas_forecast   NUMERIC(6,3),

  -- Risk flags
  stock_risks     JSONB NOT NULL DEFAULT '[]',
  -- [{sku, days_until_stockout, revenue_at_risk}]
  budget_warnings JSONB NOT NULL DEFAULT '[]',
  opportunities   JSONB NOT NULL DEFAULT '[]',

  -- Model inputs
  lookback_days   INTEGER NOT NULL DEFAULT 30,
  seasonality_applied BOOLEAN NOT NULL DEFAULT true,
  trending_signals JSONB,         -- from agent_memory
  confidence_overall NUMERIC(3,2),

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_forecasts_shop ON forecasts(shop_id, generated_at DESC);

-- RLS
ALTER TABLE product_economics ENABLE ROW LEVEL SECURITY;
ALTER TABLE profitability_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE shopify_refund_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE dct_stat_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE attribution_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE attribution_reconciliation ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_delivery_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE brief_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE forecasts ENABLE ROW LEVEL SECURITY;

CREATE POLICY pe_tenant   ON product_economics USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY pm_tenant   ON profitability_metrics USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY sre_tenant  ON shopify_refund_events USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY dst_tenant  ON dct_stat_tests USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ae_tenant   ON attribution_events USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ar_tenant   ON attribution_reconciliation USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ct_tenant   ON creative_tags USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY bdp_tenant  ON brief_delivery_preferences USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY bdl_tenant  ON brief_delivery_log USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY fc_tenant   ON forecasts USING (shop_id = current_setting('app.shop_id')::UUID);

COMMENT ON TABLE product_economics IS 'AEGIS v3.6 — COGS, margins, return rates per SKU';
COMMENT ON TABLE profitability_metrics IS 'AEGIS v3.6 — Real contribution margin with refunds factored in';
COMMENT ON TABLE dct_stat_tests IS 'AEGIS v3.6 — Statistical significance before declaring DCT winners';
COMMENT ON TABLE attribution_events IS 'AEGIS v3.6 — First-party order reconciliation, dedup across platforms';
COMMENT ON TABLE creative_tags IS 'AEGIS v3.6 — AI vision tagging of all creative assets';
COMMENT ON TABLE forecasts IS 'AEGIS v3.6 — 14-day revenue/spend/stock projections';
