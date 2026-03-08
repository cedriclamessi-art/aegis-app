-- ============================================================
-- Migration 035 — AEGIS v5.0
-- Tiered Trigger System · Verbatims · Reputation · Onboarding
-- Performance Pricing · Constitution Article 6
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- 1. PALIER SYSTEM — Le cœur de v5.0
--    Agents s'activent progressivement selon des seuils business
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS shop_tiers (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE UNIQUE,

  -- Current tier (1-5)
  current_tier      INTEGER NOT NULL DEFAULT 1
    CHECK (current_tier BETWEEN 1 AND 5),
  tier_entered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  tier_unlocked_by  TEXT,   -- 'auto' | 'manual:user@email.com'

  -- Progression metrics (evaluated daily)
  shadow_agreement_rate  NUMERIC(4,3),   -- from AGENT_SHADOW_MODE
  decisions_executed_30d INTEGER,         -- executed agent decisions last 30d
  avg_roas_30d           NUMERIC(6,2),
  days_no_critical_anomaly INTEGER DEFAULT 0,
  total_revenue_aegis    NUMERIC(12,2) DEFAULT 0, -- revenue attributed to AEGIS

  -- Tier history
  tier_history      JSONB NOT NULL DEFAULT '[]',
  -- [{"tier": 1, "entered": "2026-01-01", "exited": "2026-01-15", "trigger": "shadow_rate_75"}]

  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id)
);

-- Per-tier agent configuration
CREATE TABLE IF NOT EXISTS tier_agent_config (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tier          INTEGER NOT NULL CHECK (tier BETWEEN 1 AND 5),
  agent_name    TEXT NOT NULL,
  mode          TEXT NOT NULL CHECK (mode IN (
    'disabled',     -- agent doesn't run
    'observe',      -- runs but never executes
    'shadow',       -- runs, records would-have-done, no execution
    'suggest',      -- runs, posts suggestion to inbox, human approves
    'semi_auto',    -- runs, executes low-impact actions (<threshold), suggests high-impact
    'auto'          -- runs, executes all approved action types
  )),
  max_financial_impact  NUMERIC(10,2),  -- NULL = unlimited (for auto)
  requires_human_confirm BOOLEAN NOT NULL DEFAULT false,
  notes         TEXT,
  UNIQUE(tier, agent_name)
);

-- Tier unlock conditions (evaluated by AGENT_TIER_MANAGER)
CREATE TABLE IF NOT EXISTS tier_unlock_conditions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_tier       INTEGER NOT NULL,
  to_tier         INTEGER NOT NULL,
  condition_key   TEXT NOT NULL,  -- 'shadow_agreement_rate', 'days_live', etc.
  operator        TEXT NOT NULL CHECK (operator IN ('>=', '<=', '=', '>', '<')),
  threshold       NUMERIC(12,3) NOT NULL,
  mandatory       BOOLEAN NOT NULL DEFAULT true,
  description     TEXT NOT NULL,
  UNIQUE(from_tier, to_tier, condition_key)
);

-- Tier transition log
CREATE TABLE IF NOT EXISTS tier_transitions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id       UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  from_tier     INTEGER,
  to_tier       INTEGER NOT NULL,
  triggered_by  TEXT NOT NULL,  -- condition_key that tipped it
  metrics_at_transition JSONB NOT NULL DEFAULT '{}',
  transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  reversed_at   TIMESTAMPTZ,
  reversed_reason TEXT
);

CREATE INDEX idx_tier_shop    ON shop_tiers(shop_id);
CREATE INDEX idx_transitions  ON tier_transitions(shop_id, transitioned_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 2. VERBATIMS — Feedback qualitatif post-achat
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS customer_verbatims (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id        TEXT NOT NULL,
  customer_email  TEXT NOT NULL,
  rfm_segment     TEXT,
  channel         TEXT NOT NULL DEFAULT 'email'
    CHECK (channel IN ('email', 'sms', 'post_delivery_popup')),

  -- Raw responses
  why_bought      TEXT,           -- "Pourquoi avez-vous acheté ?"
  main_benefit    TEXT,           -- "Quel bénéfice principal ?"
  hesitation      TEXT,           -- "Qu'est-ce qui vous a presque empêché d'acheter ?"
  nps_score       INTEGER CHECK (nps_score BETWEEN 0 AND 10),

  -- NLP analysis (filled by AGENT_VERBATIM)
  sentiment       TEXT CHECK (sentiment IN ('positive','neutral','negative')),
  detected_angle  TEXT,           -- 'transformation', 'ritual', 'social_proof', etc.
  key_words       TEXT[],
  objection_type  TEXT,           -- 'price', 'trust', 'need_clarity', 'competitor'
  insight_tags    TEXT[],

  -- Status
  analyzed        BOOLEAN NOT NULL DEFAULT false,
  survey_sent_at  TIMESTAMPTZ,
  responded_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS verbatim_insights (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sample_size     INTEGER NOT NULL,
  period_days     INTEGER NOT NULL DEFAULT 30,

  -- Aggregated insights
  top_buying_angles  JSONB NOT NULL DEFAULT '[]',
  -- [{"angle": "transformation", "pct": 0.42, "example_quote": "..."}]
  top_objections     JSONB NOT NULL DEFAULT '[]',
  top_keywords       JSONB NOT NULL DEFAULT '[]',
  nps_score          NUMERIC(4,1),
  nps_promoters_pct  NUMERIC(4,3),
  nps_detractors_pct NUMERIC(4,3),
  sentiment_breakdown JSONB NOT NULL DEFAULT '{}',
  -- {"positive": 0.72, "neutral": 0.18, "negative": 0.10}
  creative_recommendations TEXT,  -- LLM-generated action items
  UNIQUE(shop_id, generated_at::DATE)
);

CREATE INDEX idx_verbatims_shop ON customer_verbatims(shop_id, responded_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 3. REPUTATION — NPS + Avis + Article 6 Constitution
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS reputation_scores (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  platform        TEXT NOT NULL CHECK (platform IN (
    'trustpilot','google','meta_comments','tiktok_comments','internal_nps'
  )),
  score           NUMERIC(4,2),   -- 0-10 for NPS, 0-5 for star ratings
  review_count    INTEGER,
  positive_count  INTEGER,
  negative_count  INTEGER,
  sample_comments JSONB DEFAULT '[]',
  UNIQUE(shop_id, platform, DATE(recorded_at))
);

CREATE TABLE IF NOT EXISTS reputation_alerts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  alert_type      TEXT NOT NULL CHECK (alert_type IN (
    'nps_critical',         -- NPS < 30
    'reviews_spike_negative', -- >3 negative reviews in 24h
    'sentiment_degrading',  -- trending negative over 7d
    'article_6_triggered'   -- acquisition blocked by Article 6
  )),
  current_score   NUMERIC(6,2),
  threshold       NUMERIC(6,2),
  platform        TEXT,
  acquisition_blocked BOOLEAN NOT NULL DEFAULT false,
  blocked_until   TIMESTAMPTZ,
  details         JSONB DEFAULT '{}',
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reputation_shop ON reputation_scores(shop_id, platform, recorded_at DESC);
CREATE INDEX idx_rep_alerts      ON reputation_alerts(shop_id, acknowledged, created_at DESC);

-- ══════════════════════════════════════════════════════════════
-- 4. SELF-SERVICE ONBOARDING
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  current_step    TEXT NOT NULL DEFAULT 'shopify_connect',
  steps_completed TEXT[] NOT NULL DEFAULT '{}',
  -- ['shopify_connect', 'meta_connect', 'params_set', 'shadow_launched', 'brief_sent']
  params          JSONB NOT NULL DEFAULT '{}',
  -- {"max_daily_budget": 200, "cpa_target": 35, "product_margin_pct": 0.62}
  abandoned       BOOLEAN NOT NULL DEFAULT false,
  time_to_complete_minutes INTEGER,
  UNIQUE(shop_id)
);

CREATE TABLE IF NOT EXISTS onboarding_steps (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  step_name       TEXT NOT NULL,
  completed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  duration_seconds INTEGER,
  data            JSONB DEFAULT '{}',
  UNIQUE(shop_id, step_name)
);

-- ══════════════════════════════════════════════════════════════
-- 5. PERFORMANCE PRICING — €99 fixe + 3% ROI certifié
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS performance_billing (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  billing_month   DATE NOT NULL,  -- first day of month

  -- Base
  base_fee        NUMERIC(8,2) NOT NULL DEFAULT 99.00,

  -- Performance component
  certified_roi   NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- ROI attribué à AEGIS ce mois (from aegis_roi_summary)
  roi_baseline    NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- baseline revenue without AEGIS (prev month avg)
  roi_above_baseline NUMERIC(12,2) GENERATED ALWAYS AS
    (GREATEST(0, certified_roi - roi_baseline)) STORED,
  performance_pct NUMERIC(4,3) NOT NULL DEFAULT 0.03,  -- 3%
  performance_fee NUMERIC(8,2) GENERATED ALWAYS AS
    (GREATEST(0, certified_roi - roi_baseline) * 0.03) STORED,
  total_fee       NUMERIC(8,2) GENERATED ALWAYS AS
    (99.00 + GREATEST(0, certified_roi - roi_baseline) * 0.03) STORED,

  -- Invoice
  invoice_status  TEXT NOT NULL DEFAULT 'pending'
    CHECK (invoice_status IN ('pending','issued','paid','disputed')),
  invoice_url     TEXT,
  stripe_invoice_id TEXT,
  issued_at       TIMESTAMPTZ,
  paid_at         TIMESTAMPTZ,

  UNIQUE(shop_id, billing_month)
);

CREATE INDEX idx_perf_billing_shop ON performance_billing(shop_id, billing_month DESC);

-- ══════════════════════════════════════════════════════════════
-- 6. CONSTITUTION ARTICLE 6 — Veto si NPS critique
-- (la logique est dans constitution.config.ts)
-- Colonne de référence pour le tableau de bord
-- ══════════════════════════════════════════════════════════════

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name='constitution_reviews' AND column_name='article_6_nps'
  ) THEN
    ALTER TABLE constitution_reviews ADD COLUMN article_6_nps BOOLEAN DEFAULT false;
  END IF;
END $$;

-- RLS
ALTER TABLE shop_tiers                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tier_transitions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_verbatims        ENABLE ROW LEVEL SECURITY;
ALTER TABLE verbatim_insights         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_scores         ENABLE ROW LEVEL SECURITY;
ALTER TABLE reputation_alerts         ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_sessions       ENABLE ROW LEVEL SECURITY;
ALTER TABLE onboarding_steps          ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_billing       ENABLE ROW LEVEL SECURITY;

CREATE POLICY st_t   ON shop_tiers             USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY tt_t   ON tier_transitions       USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY cv_t   ON customer_verbatims     USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY vi_t   ON verbatim_insights      USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY rs_t   ON reputation_scores      USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY ra_t   ON reputation_alerts      USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY os_t   ON onboarding_sessions    USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY oss_t  ON onboarding_steps       USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY pb_t   ON performance_billing    USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY tac_open ON tier_agent_config USING (true);  -- global config
CREATE POLICY tuc_open ON tier_unlock_conditions USING (true);

COMMENT ON TABLE shop_tiers             IS 'AEGIS v5.0 — Tier progression per shop (1-5)';
COMMENT ON TABLE tier_agent_config      IS 'AEGIS v5.0 — Agent mode per tier';
COMMENT ON TABLE customer_verbatims     IS 'AEGIS v5.0 — Post-purchase qualitative feedback';
COMMENT ON TABLE performance_billing    IS 'AEGIS v5.0 — €99 + 3% performance model';
