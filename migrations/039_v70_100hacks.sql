-- ============================================================
-- Migration 039 — AEGIS v7.0 "100 Hacks"
-- 7 nouveaux agents couvrant les 28 gaps identifiés
-- Hacks: 85, 88, 91, 92, 96 + optimisation paliers
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- HACK 88 — AGENT_REPURCHASE
-- Cycle de vie produit côté acheteur — pas juste le stock
-- "Une serviette dure 90 jours → campagne au jour 80"
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS product_lifecycle (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  shopify_product_id  TEXT NOT NULL,
  product_name        TEXT NOT NULL,
  variant_id          TEXT,

  -- Cycle calculé depuis les commandes répétées
  avg_repurchase_days     INTEGER,   -- médiane des intervalles entre 2 achats du même produit
  p25_repurchase_days     INTEGER,
  p75_repurchase_days     INTEGER,
  sample_repeat_buyers    INTEGER NOT NULL DEFAULT 0,
  confidence              NUMERIC(4,3) NOT NULL DEFAULT 0,

  -- Trigger window
  campaign_trigger_days   INTEGER GENERATED ALWAYS AS
    (GREATEST(1, avg_repurchase_days - 10)) STORED,  -- J-10 avant épuisement estimé

  last_computed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, shopify_product_id)
);

CREATE TABLE IF NOT EXISTS repurchase_opportunities (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id             UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id         UUID NOT NULL,
  shopify_product_id  TEXT NOT NULL,
  last_purchase_date  DATE NOT NULL,
  predicted_repurchase_date DATE NOT NULL,
  campaign_trigger_date     DATE NOT NULL,  -- quand déclencher
  days_until_trigger  INTEGER GENERATED ALWAYS AS
    (DATE_PART('day', campaign_trigger_date - CURRENT_DATE)::INTEGER) STORED,

  -- Status
  campaign_triggered  BOOLEAN NOT NULL DEFAULT false,
  campaign_id         TEXT,
  triggered_at        TIMESTAMPTZ,
  converted           BOOLEAN,
  converted_at        TIMESTAMPTZ,

  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, customer_id, shopify_product_id, last_purchase_date)
);

CREATE INDEX idx_repurchase_trigger ON repurchase_opportunities(shop_id, campaign_trigger_date)
  WHERE campaign_triggered = false;

-- ══════════════════════════════════════════════════════════════
-- HACK 85 — GIFT RECIPIENT CONVERSION
-- "Quelqu'un reçoit ton produit en cadeau, l'aime → nouveau client"
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS gift_recipients (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  order_id        TEXT NOT NULL,
  buyer_email     TEXT NOT NULL,
  recipient_email TEXT,           -- NULL si non capturé encore
  gift_message    TEXT,
  product_ids     TEXT[] NOT NULL DEFAULT '{}',

  -- Conversion tracking
  welcome_sent_at     TIMESTAMPTZ,
  welcome_code        TEXT,       -- code promo unique
  converted           BOOLEAN NOT NULL DEFAULT false,
  converted_order_id  TEXT,
  converted_at        TIMESTAMPTZ,
  conversion_revenue  NUMERIC(10,2),

  identified_via      TEXT CHECK (identified_via IN (
    'checkout_gift_option',  -- case "c'est un cadeau" cochée
    'verbatim_survey',       -- réponse survey post-achat
    'klaviyo_click',         -- clique sur un lien depuis l'email acheteur
    'manual'
  )),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, order_id)
);

-- ══════════════════════════════════════════════════════════════
-- HACK 91 — PROGRAMME DE FIDÉLITÉ
-- Points, niveaux, récompenses — absent jusqu'ici
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS loyalty_programs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE UNIQUE,
  program_name    TEXT NOT NULL DEFAULT 'Programme Fidélité',

  -- Tiers de fidélité
  tiers           JSONB NOT NULL DEFAULT '[
    {"name":"Bronze","min_points":0,"discount_pct":0,"free_shipping":false,"badge":"🥉"},
    {"name":"Argent","min_points":500,"discount_pct":5,"free_shipping":false,"badge":"🥈"},
    {"name":"Or","min_points":1500,"discount_pct":10,"free_shipping":true,"badge":"🥇"},
    {"name":"Platine","min_points":5000,"discount_pct":15,"free_shipping":true,"badge":"💎"}
  ]',

  -- Règles d'accrual
  points_per_eur  NUMERIC(6,2) NOT NULL DEFAULT 10,  -- 10 pts par €
  points_per_review INTEGER NOT NULL DEFAULT 50,
  points_per_referral INTEGER NOT NULL DEFAULT 200,
  points_validity_days INTEGER NOT NULL DEFAULT 365,

  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS loyalty_accounts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL,
  total_points    INTEGER NOT NULL DEFAULT 0,
  available_points INTEGER NOT NULL DEFAULT 0,
  lifetime_points INTEGER NOT NULL DEFAULT 0,
  current_tier    TEXT NOT NULL DEFAULT 'Bronze',
  tier_entered_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_activity_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, customer_id)
);

CREATE TABLE IF NOT EXISTS loyalty_transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL,
  points          INTEGER NOT NULL,  -- positif = accrual, négatif = redemption
  transaction_type TEXT NOT NULL CHECK (transaction_type IN (
    'purchase','review','referral','birthday','redemption','expiry','bonus','signup'
  )),
  reference_id    TEXT,   -- order_id, review_id, etc.
  description     TEXT NOT NULL,
  expires_at      TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_loyalty_customer ON loyalty_accounts(shop_id, customer_id);
CREATE INDEX idx_loyalty_tx       ON loyalty_transactions(shop_id, customer_id, created_at DESC);

-- ══════════════════════════════════════════════════════════════
-- HACK 92 — CONTENT/PROMO ORCHESTRATION
-- Séquençage coordonné : éducation → preuve sociale → offre
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS content_promo_calendar (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  week_start      DATE NOT NULL,
  sequence_type   TEXT NOT NULL CHECK (sequence_type IN (
    'education',     -- Semaine 1: contenu éducatif, pas de promo
    'social_proof',  -- Semaine 2: avis, UGC, résultats
    'urgency',       -- Semaine 3: offre limitée
    'retention'      -- Semaine 4: contenu fidélisation
  )),
  sequence_position INTEGER NOT NULL,  -- 1,2,3,4 dans le cycle

  -- Actions planifiées
  meta_campaign_objective TEXT,  -- 'BRAND_AWARENESS','CONVERSIONS','RETARGETING'
  meta_budget_multiplier  NUMERIC(4,2) NOT NULL DEFAULT 1.0,
  -- 0.6 = réduit en semaine éducation, 1.5 = amplifié semaine urgence
  email_sequence_name     TEXT,
  organic_content_theme   TEXT,
  suggested_cta           TEXT,

  -- Exécution
  applied             BOOLEAN NOT NULL DEFAULT false,
  applied_at          TIMESTAMPTZ,
  UNIQUE(shop_id, week_start)
);

-- ══════════════════════════════════════════════════════════════
-- HACK 96 — ABONNEMENTS / PRODUITS RÉCURRENTS
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS subscription_plans (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  plan_name       TEXT NOT NULL,
  frequency_days  INTEGER NOT NULL,  -- 30, 60, 90
  discount_pct    NUMERIC(4,2) NOT NULL DEFAULT 10,
  product_ids     TEXT[] NOT NULL DEFAULT '{}',
  is_active       BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS customer_subscriptions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  customer_id     UUID NOT NULL,
  plan_id         UUID NOT NULL REFERENCES subscription_plans(id),
  status          TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','paused','cancelled','past_due')),
  next_billing_date DATE NOT NULL,
  billing_count   INTEGER NOT NULL DEFAULT 0,
  total_revenue   NUMERIC(10,2) NOT NULL DEFAULT 0,
  cancelled_at    TIMESTAMPTZ,
  cancel_reason   TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ══════════════════════════════════════════════════════════════
-- HACK 71 — CREATIVE FATIGUE (gap identifié)
-- Surveillance de la saturation des créatifs
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS creative_fatigue_signals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  creative_id     TEXT NOT NULL,
  creative_name   TEXT,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Signaux de fatigue
  frequency_7d    NUMERIC(5,2),   -- fréquence d'exposition moyenne
  ctr_drop_pct    NUMERIC(6,3),   -- % de chute du CTR vs semaine 1
  ctr_week1       NUMERIC(6,4),
  ctr_current     NUMERIC(6,4),
  cpm_increase_pct NUMERIC(6,3),  -- CPM augmente quand fatigue s'installe
  thumb_stop_rate NUMERIC(5,3),   -- % qui s'arrêtent sur le thumb

  fatigue_level   TEXT NOT NULL CHECK (fatigue_level IN ('none','mild','moderate','severe')),
  -- none: CTR normal, mild: -10%, moderate: -25%, severe: -40%+
  action_taken    TEXT,
  retired_at      TIMESTAMPTZ,
  UNIQUE(shop_id, creative_id, DATE(detected_at))
);

-- ══════════════════════════════════════════════════════════════
-- HACK 94 — ANALYSE DE COHORTES
-- Comprendre comment les clients évoluent dans le temps
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS cohort_analysis (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  cohort_month    DATE NOT NULL,   -- mois d'acquisition
  cohort_size     INTEGER NOT NULL,

  -- Rétention par mois (M0, M1, M2 ... M12)
  retention_by_month JSONB NOT NULL DEFAULT '{}',
  -- {"M0": 1.0, "M1": 0.32, "M2": 0.21, "M3": 0.18 ...}

  -- Revenue par cohorte
  revenue_by_month   JSONB NOT NULL DEFAULT '{}',
  ltv_m3             NUMERIC(10,2),
  ltv_m6             NUMERIC(10,2),
  ltv_m12            NUMERIC(10,2),

  -- Canal d'acquisition
  acquisition_channel TEXT,

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, cohort_month, acquisition_channel)
);

-- ══════════════════════════════════════════════════════════════
-- TIER CONFIG v7.0 — nouveaux agents dans le système de paliers
-- ══════════════════════════════════════════════════════════════

-- (Inséré dans migration 040_v70_tier_seeds.sql)

-- RLS
ALTER TABLE product_lifecycle           ENABLE ROW LEVEL SECURITY;
ALTER TABLE repurchase_opportunities    ENABLE ROW LEVEL SECURITY;
ALTER TABLE gift_recipients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_programs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_accounts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE loyalty_transactions        ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_promo_calendar      ENABLE ROW LEVEL SECURITY;
ALTER TABLE subscription_plans          ENABLE ROW LEVEL SECURITY;
ALTER TABLE customer_subscriptions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative_fatigue_signals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE cohort_analysis             ENABLE ROW LEVEL SECURITY;

CREATE POLICY pl_t  ON product_lifecycle        USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY ro_t  ON repurchase_opportunities USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY gr_t  ON gift_recipients          USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY lp_t  ON loyalty_programs         USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY la_t  ON loyalty_accounts         USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY lt_t  ON loyalty_transactions     USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY cpc_t ON content_promo_calendar   USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY sp_t  ON subscription_plans       USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY cs_t  ON customer_subscriptions   USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY cfs_t ON creative_fatigue_signals USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY ca_t  ON cohort_analysis          USING (shop_id = current_setting('app.shop_id',true)::UUID);
