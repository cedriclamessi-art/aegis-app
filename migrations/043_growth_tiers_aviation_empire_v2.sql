-- ============================================================
-- MIGRATION 043 — GROWTH TIERS + AVIATION PHASES + EMPIRE INDEX v2
-- ============================================================
-- Implémente la vision stratégique AEGIS :
--   1. 4 paliers de croissance (0→1M, 1→10M, 10→120M, 120M→∞)
--   2. 5 phases de vol (PREFLIGHT, TAKEOFF, CRUISE, TURBULENCE, AUTOPILOT)
--   3. Empire Index v2 (+ LTV, brand power, marketing efficiency)
--   4. Agent GHOST schedule
--
-- NE MODIFIE PAS l'existant. Étend uniquement.
-- ============================================================

-- ╔══════════════════════════════════════════════════════════╗
-- ║  1. GROWTH TIERS — Les 4 paliers stratégiques           ║
-- ║  Palier 1: 0→1M   (Validation)                         ║
-- ║  Palier 2: 1→10M  (Structuration)                      ║
-- ║  Palier 3: 10→120M (Expansion)                          ║
-- ║  Palier 4: 120M→∞  (Domination)                         ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS growth_tiers (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id         UUID        NOT NULL,

    -- Current growth tier (1-4)
    current_tier    SMALLINT    NOT NULL DEFAULT 1
        CHECK (current_tier BETWEEN 1 AND 4),
    tier_name       VARCHAR(30) NOT NULL DEFAULT 'VALIDATION',

    -- Revenue tracking (annualized)
    revenue_annual_eur  NUMERIC(14,2) NOT NULL DEFAULT 0,
    revenue_monthly_eur NUMERIC(14,2) NOT NULL DEFAULT 0,

    -- Tier thresholds (configurable per shop)
    threshold_tier_2    NUMERIC(14,2) NOT NULL DEFAULT 1000000,    -- 1M€
    threshold_tier_3    NUMERIC(14,2) NOT NULL DEFAULT 10000000,   -- 10M€
    threshold_tier_4    NUMERIC(14,2) NOT NULL DEFAULT 120000000,  -- 120M€

    -- Progress within current tier (0-100%)
    tier_progress_pct   NUMERIC(5,2) NOT NULL DEFAULT 0,

    -- Tier history
    tier_history        JSONB       NOT NULL DEFAULT '[]',
    -- [{"tier":1,"entered":"2026-01-01","exited":"2026-06-15","revenue_at_exit":980000}]

    -- Strategic focus for current tier
    strategic_focus     JSONB       NOT NULL DEFAULT '[]',
    -- Tier 1: ["product_validation","market_fit","first_sales"]
    -- Tier 2: ["acquisition_stability","conversion_optimization","retention"]
    -- Tier 3: ["multi_channel","brand_building","margin_optimization"]
    -- Tier 4: ["multi_brand","capital_allocation","innovation"]

    -- KPIs for current tier
    tier_kpis           JSONB       NOT NULL DEFAULT '{}',

    entered_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_growth_tier_shop UNIQUE (shop_id)
);

CREATE INDEX IF NOT EXISTS idx_growth_tier_shop ON growth_tiers (shop_id);
CREATE INDEX IF NOT EXISTS idx_growth_tier_current ON growth_tiers (current_tier);

-- Growth tier transition log
CREATE TABLE IF NOT EXISTS growth_tier_transitions (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id         UUID        NOT NULL,
    from_tier       SMALLINT    NOT NULL,
    to_tier         SMALLINT    NOT NULL,
    revenue_at_transition NUMERIC(14,2),
    triggered_by    VARCHAR(60) NOT NULL DEFAULT 'auto',
    -- 'auto' | 'manual:user@email' | 'revenue_threshold' | 'manual_override'
    metrics_snapshot JSONB      NOT NULL DEFAULT '{}',
    announcement    TEXT,
    transitioned_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_growth_transition_shop
    ON growth_tier_transitions (shop_id, transitioned_at DESC);

-- Seed the strategic focus per tier
CREATE TABLE IF NOT EXISTS growth_tier_config (
    tier            SMALLINT    PRIMARY KEY CHECK (tier BETWEEN 1 AND 4),
    tier_name       VARCHAR(30) NOT NULL,
    tier_label      VARCHAR(60) NOT NULL,
    revenue_min_eur NUMERIC(14,2) NOT NULL,
    revenue_max_eur NUMERIC(14,2),  -- NULL for tier 4 (∞)

    -- What AEGIS does at this tier
    mission         TEXT        NOT NULL,
    strategic_focus JSONB       NOT NULL DEFAULT '[]',

    -- Agents emphasis (which agents are most important)
    primary_agents  JSONB       NOT NULL DEFAULT '[]',

    -- KPI targets
    kpi_targets     JSONB       NOT NULL DEFAULT '{}'
);

INSERT INTO growth_tier_config (tier, tier_name, tier_label, revenue_min_eur, revenue_max_eur, mission, strategic_focus, primary_agents, kpi_targets)
VALUES
(1, 'VALIDATION', '0 → 1 Million €', 0, 1000000,
 'Transformer une idée en business validé. Trouver le product-market fit.',
 '["winner_detection","market_analysis","store_creation","first_ads","angle_testing","roas_optimization","winner_identification"]'::jsonb,
 '["AGENT_SPY","AGENT_STORE_BUILDER","AGENT_CREATIVE_FACTORY","AGENT_META_TESTING","AGENT_PROFITABILITY"]'::jsonb,
 '{"target_roas": 2.0, "target_cpa_max": 25, "target_conversion_rate": 2.0, "min_products_tested": 5}'::jsonb
),
(2, 'STRUCTURATION', '1 → 10 Millions €', 1000000, 10000000,
 'Transformer un produit gagnant en machine de croissance stable.',
 '["acquisition_stability","conversion_optimization","aov_increase","retention","campaign_structure","creative_optimization"]'::jsonb,
 '["AGENT_SCALE","AGENT_DCT_ITERATION","AGENT_AOV","AGENT_KLAVIYO","AGENT_EMAIL_RECOVERY","AGENT_DAYPARTING"]'::jsonb,
 '{"target_roas": 2.5, "target_repeat_rate": 15, "target_aov_growth": 10, "target_ltv_90d": 60}'::jsonb
),
(3, 'EXPANSION', '10 → 120 Millions €', 10000000, 120000000,
 'Transformer une marque rentable en empire e-commerce.',
 '["multi_channel_acquisition","market_expansion","brand_equity","margin_optimization","performance_prediction","multi_funnel"]'::jsonb,
 '["AGENT_BUDGET_OPTIMIZER","AGENT_STRATEGIES","AGENT_COMPETITIVE_INTEL","AGENT_PRICING","AGENT_REPUTATION","AGENT_TIKTOK_ORGANIC"]'::jsonb,
 '{"target_roas": 3.0, "target_channels": 3, "target_brand_search_pct": 20, "target_margin_pct": 30}'::jsonb
),
(4, 'DOMINATION', '120 Millions € → ∞', 120000000, NULL,
 'Créer un système capable de croître sans plafond. Piloter un empire multi-marques.',
 '["multi_brand","capital_allocation","opportunity_detection","innovation","competitive_moat","data_intelligence"]'::jsonb,
 '["AGENT_STRATEGIES","AGENT_BUDGET_OPTIMIZER","AGENT_SPY","AGENT_GHOST","AGENT_RISK_ENGINE","AGENT_FORECASTER"]'::jsonb,
 '{"target_roas": 3.5, "target_brands": 2, "target_empire_index": 80, "target_dependency_max": 40}'::jsonb
)
ON CONFLICT (tier) DO UPDATE SET
    mission = EXCLUDED.mission,
    strategic_focus = EXCLUDED.strategic_focus,
    primary_agents = EXCLUDED.primary_agents,
    kpi_targets = EXCLUDED.kpi_targets;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  2. AVIATION FLIGHT PHASES                              ║
-- ║  Maps pipeline steps to 5 flight phases                 ║
-- ╚══════════════════════════════════════════════════════════╝

CREATE TABLE IF NOT EXISTS flight_phases (
    id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    shop_id         UUID        NOT NULL,
    pipeline_id     UUID        NOT NULL,

    -- Current flight phase
    current_phase   VARCHAR(30) NOT NULL DEFAULT 'PREFLIGHT'
        CHECK (current_phase IN ('PREFLIGHT','TAKEOFF','CRUISE','TURBULENCE','AUTOPILOT')),

    -- Phase mapping (which pipeline steps belong to which phase)
    -- PREFLIGHT:  INGEST + ANALYZE + VALIDATE (steps 1-3)
    -- TAKEOFF:    BUILD_OFFER + BUILD_PAGE + CREATE_ADS (steps 4-6)
    -- CRUISE:     LAUNCH_TEST + ANALYZE_RESULTS (steps 7-8)
    -- TURBULENCE: PROTECT (step 10, triggered on anomaly)
    -- AUTOPILOT:  SCALE + LEARN (steps 9, 11 + ralph loop)

    phase_progress  JSONB       NOT NULL DEFAULT '{
        "PREFLIGHT":  {"status": "pending",   "steps": ["INGEST","ANALYZE","VALIDATE"], "pct": 0},
        "TAKEOFF":    {"status": "pending",   "steps": ["BUILD_OFFER","BUILD_PAGE","CREATE_ADS"], "pct": 0},
        "CRUISE":     {"status": "pending",   "steps": ["LAUNCH_TEST","ANALYZE_RESULTS"], "pct": 0},
        "TURBULENCE": {"status": "standby",   "steps": ["PROTECT"], "pct": 0},
        "AUTOPILOT":  {"status": "pending",   "steps": ["SCALE","LEARN"], "pct": 0}
    }',

    -- Flight metrics
    total_flight_time_ms BIGINT DEFAULT 0,
    phase_started_at     TIMESTAMPTZ,

    -- Turbulence events
    turbulence_events    JSONB   NOT NULL DEFAULT '[]',
    -- [{"at":"...", "reason":"cpa_spike", "resolved": true, "duration_ms": 3600000}]

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_flight_phase_pipeline UNIQUE (pipeline_id)
);

CREATE INDEX IF NOT EXISTS idx_flight_phase_shop ON flight_phases (shop_id, current_phase);
CREATE INDEX IF NOT EXISTS idx_flight_phase_pipeline ON flight_phases (pipeline_id);


-- ╔══════════════════════════════════════════════════════════╗
-- ║  3. EMPIRE INDEX v2 — Enhanced Formula                  ║
-- ║  Adds: LTV, Brand Power, Marketing Efficiency           ║
-- ╚══════════════════════════════════════════════════════════╝

-- Empire Index v2 components table (extends empire_state)
ALTER TABLE ops.empire_state
    ADD COLUMN IF NOT EXISTS score_ltv             NUMERIC(5,2),    -- 0-15 pts
    ADD COLUMN IF NOT EXISTS score_brand_power     NUMERIC(5,2),    -- 0-10 pts
    ADD COLUMN IF NOT EXISTS score_marketing_eff   NUMERIC(5,2),    -- 0-10 pts
    ADD COLUMN IF NOT EXISTS growth_tier           SMALLINT DEFAULT 1
        CHECK (growth_tier BETWEEN 1 AND 4),
    ADD COLUMN IF NOT EXISTS flight_phase          VARCHAR(30);

-- Extend palier constraint from 3 to 4
-- (empire_state.palier was CHECK(palier IN (1,2,3)), we need to allow 4)
ALTER TABLE ops.empire_state DROP CONSTRAINT IF EXISTS empire_state_palier_check;
ALTER TABLE ops.empire_state ADD CONSTRAINT empire_state_palier_check
    CHECK (palier BETWEEN 1 AND 4);

-- ── Empire Index v2 Formula ─────────────────────────────────────
--
-- v2 = 0.25 × ContributionMargin      (profitabilité)
--    + 0.15 × PatternConfidence        (intelligence du système)
--    + 0.15 × CapitalStrength          (trésorerie)
--    + 0.15 × LTV_Score                (valeur client long terme)     ← NEW
--    + 0.10 × BrandPower               (puissance de marque)          ← NEW
--    + 0.10 × MarketingEfficiency      (efficacité marketing)         ← NEW
--    + 0.05 × DependencyHealth         (diversification canaux)
--    + 0.05 × RiskControl              (maîtrise des risques)

CREATE OR REPLACE FUNCTION compute_empire_index_v2(
    p_tenant_id          UUID,
    p_cm_pct             NUMERIC,          -- Contribution Margin %
    p_cash_runway_days   INTEGER,          -- Cash runway in days
    p_dependency_pct     NUMERIC,          -- % revenue on dominant channel
    p_risk_score         NUMERIC,          -- Risk score 0-100
    p_pattern_confidence NUMERIC DEFAULT 50,
    p_ltv_90d            NUMERIC DEFAULT 0,    -- Customer LTV at 90 days
    p_avg_order_value    NUMERIC DEFAULT 0,    -- Average order value
    p_repeat_rate        NUMERIC DEFAULT 0,    -- % customers who buy again
    p_brand_search_pct   NUMERIC DEFAULT 0,    -- % traffic from brand search
    p_organic_pct        NUMERIC DEFAULT 0,    -- % traffic from organic sources
    p_nps_score          NUMERIC DEFAULT 0,    -- Net Promoter Score (0-100 scale)
    p_roas               NUMERIC DEFAULT 0,    -- Current ROAS
    p_cac_payback_days   INTEGER DEFAULT 90    -- Days to recover CAC
)
RETURNS TABLE (
    empire_index          NUMERIC,
    empire_mode           VARCHAR,
    growth_tier           SMALLINT,
    score_cm              NUMERIC,
    score_pattern         NUMERIC,
    score_capital         NUMERIC,
    score_ltv             NUMERIC,
    score_brand_power     NUMERIC,
    score_marketing_eff   NUMERIC,
    score_dependency      NUMERIC,
    score_risk            NUMERIC,
    hard_constraint       BOOLEAN,
    constraint_reason     TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_cm              NUMERIC;
    v_pattern         NUMERIC;
    v_capital         NUMERIC;
    v_ltv             NUMERIC;
    v_brand           NUMERIC;
    v_marketing       NUMERIC;
    v_dependency      NUMERIC;
    v_risk            NUMERIC;
    v_total           NUMERIC;
    v_mode            VARCHAR := 'ADAPTATIF';
    v_hard            BOOLEAN := FALSE;
    v_reason          TEXT    := NULL;
    v_growth_tier     SMALLINT := 1;
    v_annual_revenue  NUMERIC;
BEGIN
    -- ── ContributionMarginScore (25%) ──
    v_cm := LEAST(100, GREATEST(0, p_cm_pct * 2));

    -- ── PatternConfidence (15%) ──
    v_pattern := LEAST(100, GREATEST(0, p_pattern_confidence));

    -- ── CapitalStrength (15%) — 90 days = 100pts ──
    v_capital := LEAST(100, GREATEST(0,
        ROUND((p_cash_runway_days::NUMERIC / 90.0) * 100, 1)
    ));

    -- ── LTV Score (15%) — NEW ──
    -- Based on: LTV/CAC ratio, repeat rate, order value
    v_ltv := LEAST(100, GREATEST(0,
        -- LTV component: €100 LTV = 50pts, €200+ = 100pts
        (LEAST(100, p_ltv_90d / 2.0) * 0.4)
        -- Repeat rate component: 25% repeat = 50pts, 50%+ = 100pts
        + (LEAST(100, p_repeat_rate * 2) * 0.3)
        -- CAC payback: <30d = 100pts, >180d = 0pts
        + (LEAST(100, GREATEST(0, (180 - p_cac_payback_days)::NUMERIC / 1.5)) * 0.3)
    ));

    -- ── Brand Power Score (10%) — NEW ──
    -- Based on: brand search %, organic %, NPS
    v_brand := LEAST(100, GREATEST(0,
        -- Brand search: 30% = 100pts
        (LEAST(100, (p_brand_search_pct / 0.30) * 100) * 0.4)
        -- Organic traffic: 20% = 100pts
        + (LEAST(100, (p_organic_pct / 0.20) * 100) * 0.3)
        -- NPS: direct 0-100
        + (p_nps_score * 0.3)
    ));

    -- ── Marketing Efficiency Score (10%) — NEW ──
    -- Based on: ROAS and CAC payback
    v_marketing := LEAST(100, GREATEST(0,
        -- ROAS: 4.0× = 100pts
        (LEAST(100, (p_roas / 4.0) * 100) * 0.6)
        -- CAC payback efficiency: <30d = 100pts
        + (LEAST(100, GREATEST(0, (90 - p_cac_payback_days)::NUMERIC / 0.9)) * 0.4)
    ));

    -- ── DependencyHealth (5%) ──
    v_dependency := LEAST(100, GREATEST(0, 100 - p_dependency_pct));

    -- ── RiskControl (5%) ──
    v_risk := LEAST(100, GREATEST(0, 100 - p_risk_score));

    -- ── Weighted Total ──
    v_total := ROUND(
        (v_cm         * 0.25)
      + (v_pattern    * 0.15)
      + (v_capital    * 0.15)
      + (v_ltv        * 0.15)
      + (v_brand      * 0.10)
      + (v_marketing  * 0.10)
      + (v_dependency * 0.05)
      + (v_risk       * 0.05)
    , 1);

    -- ── Empire Mode ──
    v_mode := CASE
        WHEN v_total > 80 THEN 'AGGRESSIF'
        WHEN v_total > 60 THEN 'SCALABLE'
        WHEN v_total > 40 THEN 'ADAPTATIF'
        ELSE                    'SURVIE'
    END;

    -- ── Growth Tier (from revenue) ──
    SELECT COALESCE(revenue_annual_eur, 0) INTO v_annual_revenue
    FROM growth_tiers WHERE shop_id = p_tenant_id;

    v_growth_tier := CASE
        WHEN COALESCE(v_annual_revenue, 0) >= 120000000 THEN 4
        WHEN COALESCE(v_annual_revenue, 0) >= 10000000  THEN 3
        WHEN COALESCE(v_annual_revenue, 0) >= 1000000   THEN 2
        ELSE 1
    END;

    -- ── Hard Constraints ──
    IF p_cash_runway_days < 14 THEN
        v_hard := TRUE;
        v_reason := format('cash_runway=%sj < 14 — scaling interdit', p_cash_runway_days);
        v_mode := 'SURVIE';
    ELSIF p_risk_score > 70 THEN
        v_hard := TRUE;
        v_reason := format('risk_score=%.0f > 70 — stop-loss actif', p_risk_score);
        v_mode := 'SURVIE';
    ELSIF p_cm_pct < 10 THEN
        v_hard := TRUE;
        v_reason := format('cm_pct=%.1f%% < 10%% — marge insuffisante', p_cm_pct);
        v_mode := 'SURVIE';
    ELSIF p_dependency_pct > 90 THEN
        v_hard := TRUE;
        v_reason := format('dependency=%.0f%% > 90%% — canal unique fragile', p_dependency_pct);
    END IF;

    RETURN QUERY SELECT
        v_total, v_mode, v_growth_tier,
        v_cm, v_pattern, v_capital, v_ltv, v_brand, v_marketing,
        v_dependency, v_risk,
        v_hard, v_reason;
END;
$$;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  4. AGENT_GHOST — Schedule                              ║
-- ╚══════════════════════════════════════════════════════════╝

-- Register GHOST agent
INSERT INTO agents.registry
  (agent_id, name, category, required_level, description, capabilities, task_types, status)
VALUES (
  'AGENT_GHOST',
  'Ghost — Analyse Invisible',
  'intelligence',
  'basic',
  'Agent d''observation silencieuse. Détecte les micro-tendances, surveille la concurrence en furtif, analyse les comportements invisibles, et identifie les opportunités non exploitées. Ne déclenche jamais d''action directe — dépose des signaux pour les autres agents.',
  '["db.read_all","memory.write","events.emit"]'::jsonb,
  '["full_scan","performance","competitor","behavior","opportunity","get_signals","escalate"]'::jsonb,
  'active'
) ON CONFLICT (agent_id) DO UPDATE SET
    description  = EXCLUDED.description,
    capabilities = EXCLUDED.capabilities,
    task_types   = EXCLUDED.task_types,
    status       = 'active';

-- Ghost runs daily at 4am (full scan) + escalates stale signals at noon
INSERT INTO agents.schedule
  (agent_id, task_type, schedule_type, cron_expression, priority, enabled, description, created_at)
VALUES
(
  'AGENT_GHOST', 'full_scan',
  'cron', '0 4 * * *',
  6, TRUE,
  'Scan complet GHOST : performance, concurrence, comportement, opportunités',
  NOW()
),
(
  'AGENT_GHOST', 'escalate',
  'cron', '0 12 * * *',
  5, TRUE,
  'Escalade des signaux GHOST non traités vers Morning Brief',
  NOW()
)
ON CONFLICT (agent_id, task_type) DO UPDATE SET enabled = TRUE;


-- ╔══════════════════════════════════════════════════════════╗
-- ║  5. Runtime config — Growth tier thresholds             ║
-- ╚══════════════════════════════════════════════════════════╝

INSERT INTO ops.runtime_config
  (tenant_id, key, value, description, is_locked, locked_by)
VALUES
  -- Growth tier thresholds (annual revenue EUR)
  (NULL, 'growth.tier_1_name',      'VALIDATION',      'Palier 1: Phase de validation', TRUE, 'SYSTEM'),
  (NULL, 'growth.tier_1_max_eur',   '1000000',         'Palier 1: 0 → 1M€/an', TRUE, 'SYSTEM'),
  (NULL, 'growth.tier_2_name',      'STRUCTURATION',   'Palier 2: Phase de structuration', TRUE, 'SYSTEM'),
  (NULL, 'growth.tier_2_max_eur',   '10000000',        'Palier 2: 1M → 10M€/an', TRUE, 'SYSTEM'),
  (NULL, 'growth.tier_3_name',      'EXPANSION',       'Palier 3: Phase d''expansion', TRUE, 'SYSTEM'),
  (NULL, 'growth.tier_3_max_eur',   '120000000',       'Palier 3: 10M → 120M€/an', TRUE, 'SYSTEM'),
  (NULL, 'growth.tier_4_name',      'DOMINATION',      'Palier 4: Phase de domination', TRUE, 'SYSTEM'),

  -- Aviation phase labels
  (NULL, 'flight.phase_preflight',  'PREFLIGHT',       'Analyse du marché et du produit', FALSE, 'SYSTEM'),
  (NULL, 'flight.phase_takeoff',    'TAKEOFF',         'Construction de l''infrastructure', FALSE, 'SYSTEM'),
  (NULL, 'flight.phase_cruise',     'CRUISE',          'Croissance et optimisation', FALSE, 'SYSTEM'),
  (NULL, 'flight.phase_turbulence', 'TURBULENCE',      'Détection et correction des problèmes', FALSE, 'SYSTEM'),
  (NULL, 'flight.phase_autopilot',  'AUTOPILOT',       'Pilotage automatique', FALSE, 'SYSTEM')
ON CONFLICT (COALESCE(tenant_id::text,'__global__'), key) DO NOTHING;


-- ============================================================
-- RÉSUMÉ DE CETTE MIGRATION
-- ============================================================
-- Tables créées    : growth_tiers, growth_tier_transitions,
--                    growth_tier_config, flight_phases
-- Tables étendues  : ops.empire_state (+score_ltv, +score_brand_power,
--                    +score_marketing_eff, +growth_tier, +flight_phase)
-- Fonctions        : compute_empire_index_v2()
-- Agents ajoutés   : AGENT_GHOST (registry + 2 schedules)
-- Config ajoutée   : 12 paramètres runtime (growth + flight)
-- ============================================================
