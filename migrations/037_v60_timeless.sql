-- ============================================================
-- Migration 037 — AEGIS v6.0 "Intemporel"
-- 4 piliers :
--   1. Couche d'apprentissage universelle (patterns comportementaux)
--   2. Modèle de données propriétaire cross-clients (benchmarks)
--   3. Connecteurs auto-adaptatifs (pivot plateforme sans reconstruction)
--   4. Seuils auto-calibrants (plus de valeurs hardcodées)
-- ============================================================

-- ══════════════════════════════════════════════════════════════
-- PILIER 1 — UNIVERSAL BEHAVIORAL PATTERNS
-- Ce que les clients font, pourquoi ils achètent, ce qui déclenche
-- la conversion — indépendamment de la plateforme qui diffuse.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS behavioral_patterns (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,

  -- Pattern identity (platform-agnostic)
  pattern_type    TEXT NOT NULL CHECK (pattern_type IN (
    'buying_trigger',       -- Ce qui déclenche l'achat
    'objection_resolver',   -- Ce qui lève une hésitation
    'retention_signal',     -- Ce qui prédit la rétention
    'churn_signal',         -- Ce qui prédit le churn
    'upsell_moment',        -- Quand proposer un up-sell
    'creative_resonance',   -- Quel type de contenu résonne
    'price_sensitivity',    -- Seuils de sensibilité prix
    'channel_preference'    -- Préférence canal (email vs push vs ads)
  )),

  -- Pattern description (langage naturel)
  pattern_name        TEXT NOT NULL,
  description         TEXT NOT NULL,

  -- Evidence (plateforme-agnostique)
  sample_size         INTEGER NOT NULL DEFAULT 0,
  confidence          NUMERIC(4,3) NOT NULL DEFAULT 0,
  effect_size         NUMERIC(6,3),   -- Cohen's d ou lift %
  p_value             NUMERIC(8,6),

  -- Conditions d'application
  applies_to_segments TEXT[] DEFAULT '{}',  -- RFM segments
  applies_to_products TEXT[] DEFAULT '{}',  -- product categories
  applies_to_channels TEXT[] DEFAULT '{}',  -- 'any' = universel

  -- Signal sources (ce qui a généré ce pattern)
  source_signals      JSONB NOT NULL DEFAULT '[]',
  -- [{"type": "verbatim", "count": 142}, {"type": "attribution", "count": 89}]

  -- Encoded knowledge (utilisable par les agents sans réapprendre)
  action_recommendation TEXT,   -- "Utilise l'angle transformation pour les nouveaux clients"
  implementation_hint   TEXT,   -- "Dans les 3 premiers jours post-visite"

  -- Lifecycle
  first_observed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_confirmed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at          TIMESTAMPTZ,  -- NULL = permanent
  is_active           BOOLEAN NOT NULL DEFAULT true,
  superseded_by       UUID REFERENCES behavioral_patterns(id),

  -- Cross-client validation (anonymisé)
  cross_client_validated BOOLEAN NOT NULL DEFAULT false,
  cross_client_lift      NUMERIC(5,3),   -- lift observé sur autres shops

  UNIQUE(shop_id, pattern_type, pattern_name)
);

CREATE INDEX idx_bp_shop    ON behavioral_patterns(shop_id, pattern_type, is_active);
CREATE INDEX idx_bp_confidence ON behavioral_patterns(confidence DESC, sample_size DESC);

-- ══════════════════════════════════════════════════════════════
-- PILIER 2 — CROSS-CLIENT KNOWLEDGE BASE (anonymisé)
-- Benchmarks sectoriels qui s'améliorent avec chaque nouveau client.
-- Plus AEGIS a de clients, plus chaque client bénéficie de l'expérience
-- de tous les autres.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS industry_benchmarks (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Segmentation sectorielle
  industry        TEXT NOT NULL,   -- 'beauty_care', 'apparel', 'home', 'food', 'digital'
  sub_category    TEXT,            -- 'exfoliating', 'skincare', 'haircare'
  market          TEXT NOT NULL,   -- 'FR', 'BE', 'UK', 'EU', 'US', 'GLOBAL'
  price_tier      TEXT CHECK (price_tier IN ('budget','mid','premium','luxury')),

  -- Métrique benchmarkée
  metric_key      TEXT NOT NULL,   -- 'roas_p50', 'cpa_p50', 'ltv_90d', 'cr_lp', etc.
  metric_label    TEXT NOT NULL,

  -- Distribution statistique (anonymisée)
  p10             NUMERIC(10,3),
  p25             NUMERIC(10,3),
  p50             NUMERIC(10,3),   -- médiane
  p75             NUMERIC(10,3),
  p90             NUMERIC(10,3),
  sample_shops    INTEGER NOT NULL DEFAULT 0,
  sample_period   TEXT NOT NULL,   -- 'Q1_2026', 'H1_2026'

  -- Tendance
  trend_direction TEXT CHECK (trend_direction IN ('up','down','stable')),
  trend_pct_3m    NUMERIC(6,3),    -- variation sur 3 mois

  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(industry, sub_category, market, price_tier, metric_key, sample_period)
);

-- Score de position d'un shop par rapport aux benchmarks
CREATE TABLE IF NOT EXISTS shop_benchmark_position (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  metric_key      TEXT NOT NULL,
  current_value   NUMERIC(10,3),
  benchmark_p50   NUMERIC(10,3),
  percentile      INTEGER,         -- 0-100, position dans la distribution
  vs_median_pct   NUMERIC(8,3),    -- +23% = 23% au-dessus de la médiane
  computed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, metric_key)
);

-- Contribution anonymisée de chaque shop aux benchmarks
CREATE TABLE IF NOT EXISTS benchmark_contributions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  metric_key      TEXT NOT NULL,
  value           NUMERIC(10,3) NOT NULL,
  period          TEXT NOT NULL,
  contributed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- anonymized_id est utilisé dans les calculs — jamais shop_id
  anonymized_id   TEXT NOT NULL DEFAULT md5(random()::text)
);

-- ══════════════════════════════════════════════════════════════
-- PILIER 3 — CONNECTOR ADAPTER REGISTRY
-- Découple la logique métier des APIs tierces.
-- Quand Meta change son API, on met à jour l'adapter — pas les agents.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS connector_adapters (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        TEXT NOT NULL,    -- 'meta', 'tiktok', 'shopify', 'klaviyo', 'ga4', etc.
  adapter_version TEXT NOT NULL,    -- 'v1.0', 'v2.0'
  api_version     TEXT NOT NULL,    -- 'v18.0', '2024-01'
  is_active       BOOLEAN NOT NULL DEFAULT true,
  is_deprecated   BOOLEAN NOT NULL DEFAULT false,
  deprecation_date DATE,
  migration_guide TEXT,

  -- Capabilities (ce que l'adapter peut faire)
  capabilities    JSONB NOT NULL DEFAULT '[]',
  -- ['read_campaigns','update_budget','create_adset','pixel_events',...]

  -- Health
  last_health_check TIMESTAMPTZ,
  health_status   TEXT CHECK (health_status IN ('healthy','degraded','down','unknown')),
  error_rate_24h  NUMERIC(4,3),
  avg_latency_ms  INTEGER,

  -- Breaking changes detection
  schema_hash     TEXT,   -- hash du schéma de réponse API — alerte si change
  last_schema_change TIMESTAMPTZ,
  schema_drift_count INTEGER NOT NULL DEFAULT 0,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(platform, api_version)
);

-- Log des dérives de schéma API détectées
CREATE TABLE IF NOT EXISTS api_schema_drifts (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform        TEXT NOT NULL,
  adapter_id      UUID REFERENCES connector_adapters(id),
  endpoint        TEXT NOT NULL,
  detected_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  drift_type      TEXT NOT NULL CHECK (drift_type IN (
    'field_removed',    -- champ supprimé → breaking
    'field_added',      -- champ ajouté → non-breaking
    'type_changed',     -- type changé → breaking
    'enum_changed',     -- valeurs enum modifiées → potentiellement breaking
    'endpoint_removed', -- endpoint supprimé → critical
    'rate_limit_changed'
  )),
  field_path      TEXT,
  old_value       TEXT,
  new_value       TEXT,
  is_breaking     BOOLEAN NOT NULL DEFAULT false,
  auto_resolved   BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ
);

-- ══════════════════════════════════════════════════════════════
-- PILIER 4 — AUTO-CALIBRATING THRESHOLDS
-- Plus de valeurs hardcodées dans le code.
-- Tous les seuils sont dans la DB, auto-recalibrés par AGENT_CALIBRATOR.
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS dynamic_thresholds (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID REFERENCES shops(id) ON DELETE CASCADE,
  -- NULL = seuil global (utilisé si shop-specific absent)

  threshold_key   TEXT NOT NULL,
  -- 'tier1_to_2_shadow_rate', 'article6_nps', 'stop_loss_cpa_multiplier',
  -- 'roas_minimum', 'scale_confidence_min', 'dct_winner_pvalue'

  current_value   NUMERIC(12,4) NOT NULL,
  default_value   NUMERIC(12,4) NOT NULL,   -- fallback si recalibration échoue
  min_value       NUMERIC(12,4),            -- guardrail: jamais en dessous
  max_value       NUMERIC(12,4),            -- guardrail: jamais au dessus

  -- Source du seuil actuel
  calibration_method TEXT NOT NULL DEFAULT 'manual'
    CHECK (calibration_method IN ('manual','statistical','benchmark','llm','adaptive')),
  last_calibrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  calibration_rationale TEXT,

  -- Historique des valeurs
  value_history   JSONB NOT NULL DEFAULT '[]',
  -- [{"value": 0.75, "set_at": "2026-01-01", "method": "manual"}]

  -- Confiance dans la valeur actuelle
  confidence      NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  sample_size     INTEGER,

  is_locked       BOOLEAN NOT NULL DEFAULT false,  -- empêche la recalibration auto
  description     TEXT NOT NULL,
  unit            TEXT,   -- 'ratio', 'eur', 'days', 'score'

  UNIQUE(shop_id, threshold_key)
);

-- ══════════════════════════════════════════════════════════════
-- PILIER BONUS — KNOWLEDGE GRAPH
-- Relie les patterns, benchmarks et seuils en un graphe de connaissance.
-- "Si pattern X est actif et benchmark Y est au P75, utiliser seuil Z."
-- ══════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS knowledge_graph_nodes (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID REFERENCES shops(id) ON DELETE CASCADE,
  node_type   TEXT NOT NULL CHECK (node_type IN (
    'pattern', 'benchmark', 'threshold', 'agent', 'insight', 'action'
  )),
  node_key    TEXT NOT NULL,
  node_label  TEXT NOT NULL,
  metadata    JSONB NOT NULL DEFAULT '{}',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS knowledge_graph_edges (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID REFERENCES shops(id) ON DELETE CASCADE,
  from_node_id    UUID NOT NULL REFERENCES knowledge_graph_nodes(id),
  to_node_id      UUID NOT NULL REFERENCES knowledge_graph_nodes(id),
  relation_type   TEXT NOT NULL CHECK (relation_type IN (
    'informs',       -- A informe B
    'validates',     -- A valide B
    'contradicts',   -- A contredit B
    'requires',      -- A nécessite B
    'produces',      -- A produit B
    'supersedes'     -- A remplace B
  )),
  weight          NUMERIC(4,3) NOT NULL DEFAULT 1.0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE behavioral_patterns         ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_benchmark_position     ENABLE ROW LEVEL SECURITY;
ALTER TABLE benchmark_contributions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_adapters          ENABLE ROW LEVEL SECURITY;
ALTER TABLE api_schema_drifts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE dynamic_thresholds          ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_graph_nodes       ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_graph_edges       ENABLE ROW LEVEL SECURITY;

CREATE POLICY bp_t  ON behavioral_patterns      USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY sbp_t ON shop_benchmark_position  USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY bc_t  ON benchmark_contributions  USING (shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY ca_open ON connector_adapters     USING (true);  -- global
CREATE POLICY asd_open ON api_schema_drifts     USING (true);  -- global
CREATE POLICY dt_t  ON dynamic_thresholds       USING (shop_id IS NULL OR shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY kg_t  ON knowledge_graph_nodes    USING (shop_id IS NULL OR shop_id = current_setting('app.shop_id',true)::UUID);
CREATE POLICY kge_t ON knowledge_graph_edges    USING (shop_id IS NULL OR shop_id = current_setting('app.shop_id',true)::UUID);

COMMENT ON TABLE behavioral_patterns  IS 'AEGIS v6.0 — Patterns comportementaux platform-agnostic';
COMMENT ON TABLE industry_benchmarks  IS 'AEGIS v6.0 — Benchmarks cross-clients anonymisés';
COMMENT ON TABLE connector_adapters   IS 'AEGIS v6.0 — Registry des adapters API';
COMMENT ON TABLE dynamic_thresholds   IS 'AEGIS v6.0 — Seuils auto-calibrants, zéro valeur hardcodée';
