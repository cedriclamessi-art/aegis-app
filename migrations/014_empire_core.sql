-- ============================================================
-- MIGRATION 014 \u2014 EMPIRE CORE (int\u00e9gration native AEGIS)
-- ============================================================
-- Philosophie : PAS de sch\u00e9ma empire/ s\u00e9par\u00e9.
-- On \u00e9tend ce qui existe, on cr\u00e9e seulement ce qui manque vraiment.
--
-- Ce qui EXISTE d\u00e9j\u00e0 dans AEGIS (ne pas recr\u00e9er) :
--   risk.drawdown          \u2192 drawdown_pct, risk_level \u2713
--   risk.limits            \u2192 limites financi\u00e8res \u2713
--   risk.stop_loss_events  \u2192 historique stop-loss \u2713
--   ecosystem.channels     \u2192 dependency_risk_score \u2713
--   intel.patterns         \u2192 cross-tenant (tenant_id nullable) \u2713
--   learning.patterns      \u2192 patterns par tenant \u2713
--   creative.awareness_matrix \u2192 condor_score \u2713
--   ops.revenue_daily      \u2192 revenue, ad_spend par jour \u2713
--   ops.phase_config       \u2192 palier / phase \u2713
--
-- Ce qu'on AJOUTE dans cette migration :
--   1. ops.snapshot_daily     \u2192 snapshot strat\u00e9gique enrichi (empire_index, runway, palier)
--   2. ops.capital_live       \u2192 \u00e9tat financier temps r\u00e9el (cash_runway, burn_velocity)
--   3. ops.empire_state       \u2192 c\u0153ur d\u00e9cisionnel live (empire_index, mode_active)
--   4. ops.simulation_log     \u2192 log des d\u00e9cisions simul\u00e9es (VRAIMENT absent)
--   5. ALTER risk.drawdown    \u2192 +volatility_index, +exposure_ratio
--   6. ALTER ecosystem.channels \u2192 +diversification_required (flag bool\u00e9en manquant)
--   7. ALTER intel.patterns   \u2192 +niche, +fatigue_threshold (colonnes manquantes)
--   8. ALTER creative.awareness_matrix \u2192 +fatigue_score, +decay_detected
--   9. Vue ops.empire_dashboard \u2192 agr\u00e8ge tout en une seule vue CEO
--  10. Fonction ops.compute_empire_index() \u2192 formule officielle
--  11. Cron AGENT_RISK_ENGINE \u2192 empire index quotidien
-- ============================================================

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  1. ops.snapshot_daily                                  \u2551
-- \u2551  Remplace empire.snapshot_daily                         \u2551
-- \u2551  \u00c9tend ops.revenue_daily avec la couche strat\u00e9gique     \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE TABLE IF NOT EXISTS ops.snapshot_daily (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    snapshot_date       DATE        NOT NULL,

    -- \u2500\u2500 Financier (agr\u00e9g\u00e9 depuis ops.revenue_daily + ads.performance_*) \u2500\u2500
    revenue_eur         NUMERIC(12,2) NOT NULL DEFAULT 0,
    ad_spend_eur        NUMERIC(12,2) NOT NULL DEFAULT 0,
    contribution_margin NUMERIC(12,2),          -- revenue - ad_spend - cogs
    contribution_margin_pct NUMERIC(5,2),       -- CM / revenue \u00d7 100

    -- \u2500\u2500 Capital (depuis ops.capital_live) \u2500\u2500
    cash_reserve_eur    NUMERIC(12,2),
    cash_runway_days    INTEGER,                -- cash_reserve / burn_velocity_daily
    burn_velocity_eur   NUMERIC(12,2),          -- d\u00e9penses moyennes quotidiennes (7j glissants)

    -- \u2500\u2500 Risk (agr\u00e9g\u00e9 depuis risk.drawdown + risk.limits) \u2500\u2500
    risk_score          NUMERIC(5,2),           -- 0-100
    drawdown_pct        NUMERIC(5,2),
    volatility_index    NUMERIC(5,2),

    -- \u2500\u2500 Dependency (depuis ecosystem.channels) \u2500\u2500
    dependency_pct      NUMERIC(5,2),           -- % revenue sur canal dominant
    primary_channel     VARCHAR(30),

    -- \u2500\u2500 Patterns (depuis learning.patterns) \u2500\u2500
    pattern_confidence  NUMERIC(5,2),           -- confiance moyenne des patterns actifs

    -- \u2500\u2500 Condor (depuis creative.awareness_matrix) \u2500\u2500
    active_condors      INTEGER DEFAULT 0,       -- nb de cr\u00e9atives CONDOR actives
    avg_fatigue_score   NUMERIC(5,2),

    -- \u2500\u2500 Empire \u2500\u2500
    empire_index        NUMERIC(6,2),           -- score synth\u00e9tique 0-100
    palier              SMALLINT DEFAULT 1,      -- 1=0\u21921M | 2=1M\u219210M | 3=10M\u2192120M
    mode_active         VARCHAR(20)             -- NORMAL | SEMI_AUTO | FULL_AUTO
                            CHECK (mode_active IN ('NORMAL','SEMI_AUTO','FULL_AUTO')),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_snapshot_tenant_date UNIQUE (tenant_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_snapshot_tenant_date
    ON ops.snapshot_daily (tenant_id, snapshot_date DESC);
CREATE INDEX IF NOT EXISTS idx_snapshot_empire_index
    ON ops.snapshot_daily (empire_index DESC NULLS LAST);

ALTER TABLE ops.snapshot_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.snapshot_daily FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.snapshot_daily
    USING     (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  2. ops.capital_live                                    \u2551
-- \u2551  Remplace empire.capital_state                          \u2551
-- \u2551  \u00c9tat financier temps r\u00e9el (1 ligne par tenant)         \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE TABLE IF NOT EXISTS ops.capital_live (
    tenant_id               UUID    PRIMARY KEY REFERENCES saas.tenants(id) ON DELETE CASCADE,

    -- Tr\u00e9sorerie
    cash_balance_eur        NUMERIC(12,2) NOT NULL DEFAULT 0,
    cash_runway_days        INTEGER,            -- recalcul\u00e9 toutes les heures
    burn_velocity_daily     NUMERIC(12,2),      -- moyenne d\u00e9penses sur 7j glissants

    -- Ratios
    safe_scale_speed        NUMERIC(5,2),
    -- Vitesse max d'augmentation budget sans risque de tr\u00e9sorerie
    -- Formule : (cash_balance / burn_velocity_daily) \u00d7 scaling_factor
    liquidity_stress_ratio  NUMERIC(5,2),
    -- cash_balance / (burn_velocity_daily \u00d7 30) \u2014 < 1.0 = stress zone

    -- M\u00e9ta
    computed_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ops.capital_live ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.capital_live FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.capital_live
    USING     (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  3. ops.empire_state                                    \u2551
-- \u2551  Remplace empire.empire_core_state                      \u2551
-- \u2551  C\u0153ur d\u00e9cisionnel actif \u2014 1 ligne par tenant            \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE TABLE IF NOT EXISTS ops.empire_state (
    tenant_id                   UUID    PRIMARY KEY REFERENCES saas.tenants(id) ON DELETE CASCADE,

    -- Score synth\u00e9tique (calcul\u00e9 par ops.compute_empire_index)
    empire_index                NUMERIC(6,2) NOT NULL DEFAULT 0,
    -- 0-100 | <40 = danger | 40-65 = croissance | 65-85 = scale | >85 = institutionnel

    -- Mode d\u00e9cisionnel (li\u00e9 aux 3 modes d'automatisation)
    active_mode                 VARCHAR(20) NOT NULL DEFAULT 'NORMAL'
                                    CHECK (active_mode IN ('NORMAL','SEMI_AUTO','FULL_AUTO')),

    -- Mode empire (logique strat\u00e9gique distincte du mode d'automatisation)
    empire_mode                 VARCHAR(20) NOT NULL DEFAULT 'ADAPTATIF'
                                    CHECK (empire_mode IN ('AGGRESSIF','INSTITUTIONNEL','ADAPTATIF','SURVIE')),
    -- AGGRESSIF       : empire_index >80, cash_runway >90j, risk_score <30
    -- INSTITUTIONNEL  : empire_index >65, structures en place, multi-canal
    -- ADAPTATIF       : empire_index 40-65, croissance prudente
    -- SURVIE          : empire_index <40 OU cash_runway <14j OU risk_score >70

    -- Contraintes actives
    hard_constraint_triggered   BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE si un guardrail critique est d\u00e9clench\u00e9 (kill_switch, stop_loss, runway <7j)
    constraint_reason           TEXT,

    -- Palier actuel
    palier                      SMALLINT NOT NULL DEFAULT 1
                                    CHECK (palier IN (1, 2, 3)),
    palier_progress_pct         NUMERIC(5,2),   -- % vers le prochain palier

    -- Composantes du score (pour debug et transparence)
    score_capital               NUMERIC(5,2),   -- 0-25 pts
    score_risk                  NUMERIC(5,2),   -- 0-25 pts
    score_dependency            NUMERIC(5,2),   -- 0-25 pts
    score_condor                NUMERIC(5,2),   -- 0-25 pts

    -- Timestamps
    last_evaluated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    next_evaluation_at          TIMESTAMPTZ,
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ops.empire_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.empire_state FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.empire_state
    USING     (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  4. ops.simulation_log                                  \u2551
-- \u2551  VRAIMENT absent dans AEGIS \u2014 cr\u00e9\u00e9 de z\u00e9ro              \u2551
-- \u2551  Log des d\u00e9cisions simul\u00e9es avant ex\u00e9cution             \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE TABLE IF NOT EXISTS ops.simulation_log (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,

    -- L'action simul\u00e9e
    action_type         VARCHAR(60) NOT NULL,
    -- 'budget_scale_plus20' | 'new_product_launch' | 'channel_expansion'
    -- 'offer_restructure' | 'creative_batch_30' | 'phase_unlock'
    action_agent        VARCHAR(50),            -- quel agent a propos\u00e9 la simulation
    action_payload      JSONB       NOT NULL DEFAULT '{}',
    -- D\u00e9tails de l'action simul\u00e9e

    -- Sc\u00e9narios (formule : voir ops.compute_simulation)
    best_case_eur       NUMERIC(12,2),          -- P90 : tout se passe bien
    expected_case_eur   NUMERIC(12,2),          -- P50 : sc\u00e9nario m\u00e9dian
    stress_case_eur     NUMERIC(12,2),          -- P10 : pire cas r\u00e9aliste

    -- Risk du sc\u00e9nario
    drawdown_probability    NUMERIC(5,2),       -- probabilit\u00e9 de drawdown >20%
    empire_index_delta      NUMERIC(6,2),       -- impact estim\u00e9 sur l'empire_index
    cash_runway_delta_days  INTEGER,            -- impact sur le runway

    -- D\u00e9cision
    status              VARCHAR(20) NOT NULL DEFAULT 'proposed'
                            CHECK (status IN (
                                'proposed',     -- simul\u00e9, en attente
                                'approved',     -- humain a valid\u00e9
                                'executed',     -- action lanc\u00e9e
                                'rejected',     -- humain a refus\u00e9
                                'cancelled',    -- annul\u00e9 avant ex\u00e9cution
                                'expired'       -- d\u00e9lai d\u00e9pass\u00e9 sans d\u00e9cision
                            )),
    approved_by         VARCHAR(100),           -- 'auto' | 'user:xxx' | agent_id
    rejection_reason    TEXT,
    executed_at         TIMESTAMPTZ,

    -- R\u00e9sultat r\u00e9el (rempli apr\u00e8s ex\u00e9cution)
    actual_outcome_eur  NUMERIC(12,2),
    accuracy_score      NUMERIC(5,2),           -- |expected - actual| / expected

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at          TIMESTAMPTZ             -- au-del\u00e0, status \u2192 expired
        GENERATED ALWAYS AS (created_at + INTERVAL '48 hours') STORED
);

CREATE INDEX IF NOT EXISTS idx_simulation_tenant_status
    ON ops.simulation_log (tenant_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_simulation_pending
    ON ops.simulation_log (tenant_id, created_at DESC)
    WHERE status = 'proposed';

ALTER TABLE ops.simulation_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.simulation_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ops.simulation_log
    USING     (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  5. ALTER risk.drawdown                                 \u2551
-- \u2551  +volatility_index, +exposure_ratio (manquaient)        \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

ALTER TABLE risk.drawdown
    ADD COLUMN IF NOT EXISTS volatility_index   NUMERIC(5,2),
    -- \u00c9cart-type normalis\u00e9 des revenus quotidiens sur 14j (0-100)
    ADD COLUMN IF NOT EXISTS exposure_ratio     NUMERIC(5,2),
    -- (ad_spend / cash_balance) \u00d7 100 \u2014 >80% = overexposed
    ADD COLUMN IF NOT EXISTS empire_snapshot_id UUID REFERENCES ops.snapshot_daily(id);
    -- Lien vers le snapshot du jour pour tra\u00e7abilit\u00e9

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  6. ALTER ecosystem.channels                            \u2551
-- \u2551  +diversification_required (flag manquant)              \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

ALTER TABLE ecosystem.channels
    ADD COLUMN IF NOT EXISTS diversification_required   BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE si dependency_risk_score >60 ET ce canal est le canal dominant
    ADD COLUMN IF NOT EXISTS primary_channel_flag       BOOLEAN NOT NULL DEFAULT FALSE;
    -- TRUE si c'est le canal avec le plus de revenue_30d

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  7. ALTER intel.patterns                                \u2551
-- \u2551  +niche, +fatigue_threshold (colonnes manquantes)       \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

ALTER TABLE intel.patterns
    ADD COLUMN IF NOT EXISTS niche               VARCHAR(80),
    -- ex: 'beauty', 'wellness', 'home_goods', 'fitness'
    ADD COLUMN IF NOT EXISTS fatigue_threshold   NUMERIC(5,2),
    -- fr\u00e9quence Meta (1-10) au-del\u00e0 de laquelle ce pattern perd de l'efficacit\u00e9
    ADD COLUMN IF NOT EXISTS global_confidence   NUMERIC(5,2);
    -- confiance calcul\u00e9e sur tous les tenants (pour cross_tenant learning)

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  8. ALTER creative.awareness_matrix                     \u2551
-- \u2551  +fatigue_score, +decay_detected (manquants pour condor)\u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

ALTER TABLE creative.awareness_matrix
    ADD COLUMN IF NOT EXISTS fatigue_score       NUMERIC(5,2),
    -- Score de fatigue 0-100 : fr\u00e9quence normalis\u00e9e + CPM trend + CTR decline
    ADD COLUMN IF NOT EXISTS decay_detected      BOOLEAN NOT NULL DEFAULT FALSE,
    -- TRUE si fatigue_score >70 ET condor_score en baisse sur 7j
    ADD COLUMN IF NOT EXISTS decay_detected_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS empire_condor_flag  BOOLEAN NOT NULL DEFAULT FALSE;
    -- TRUE si cette cr\u00e9ative est un CONDOR actif surveill\u00e9 par Empire Core

CREATE INDEX IF NOT EXISTS idx_awareness_condor_empire
    ON creative.awareness_matrix (empire_condor_flag, decay_detected)
    WHERE empire_condor_flag = TRUE;

-- ╔══════════════════════════════════════════════════════════╗
-- ║  9. FORMULE — ops.compute_empire_index() v2             ║
-- ║  Pondération asymétrique — CM domine                    ║
-- ╚══════════════════════════════════════════════════════════╝
--
-- EmpireIndex = 0.35 × ContributionMarginScore
--             + 0.25 × PatternConfidence
--             + 0.20 × CapitalStrength
--             + 0.10 × DependencyHealth
--             + 0.10 × RiskControl
--
-- Normalisation 0-100 par variable :
--   ContributionMarginScore = MIN(cm_pct × 2, 100)
--     → CM 30% = 60pts | CM 50% = 100pts
--   CapitalStrength = MIN(cash_runway_days / 0.9, 100)
--     → 90j = 100pts  | 30j = 33pts
--   DependencyHealth = MAX(0, 100 − dependency_pct)
--     → 35% dep = 65pts | 80% dep = 20pts
--   RiskControl = MAX(0, 100 − risk_score)
--     → risk 20 = 80pts | risk 70 = 30pts
--   PatternConfidence = avg confidence des patterns tenant
--
-- Interprétation :
--   < 40  → SURVIE      (fragile — scaling interdit)
--   40-60 → ADAPTATIF   (instable — croissance prudente)
--   60-80 → SCALABLE    (sain — scale autorisé)
--   > 80  → AGGRESSIF   (empire ready — full_organism)
--
-- Hard constraints (override le score) :
--   cash_runway < 14j   → force SURVIE
--   risk_score  > 70    → force SURVIE
--   dependency  > 90%   → avertissement
--   cm_pct      < 10%   → force SURVIE

CREATE OR REPLACE FUNCTION ops.compute_empire_index(
    p_tenant_id          UUID,
    p_cm_pct             NUMERIC,          -- Contribution Margin % ex: 35.0
    p_cash_runway_days   INTEGER,          -- Jours de trésorerie
    p_dependency_pct     NUMERIC,          -- % revenu sur canal dominant
    p_risk_score         NUMERIC,          -- Score risque 0-100
    p_pattern_confidence NUMERIC DEFAULT 50 -- Confidence patterns 0-100
)
RETURNS TABLE (
    empire_index     NUMERIC,
    empire_mode      VARCHAR,
    score_cm         NUMERIC,   -- poids 35%
    score_pattern    NUMERIC,   -- poids 25%
    score_capital    NUMERIC,   -- poids 20%
    score_dependency NUMERIC,   -- poids 10%
    score_risk       NUMERIC,   -- poids 10%
    hard_constraint  BOOLEAN,
    constraint_reason TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_cm         NUMERIC;
    v_pattern    NUMERIC;
    v_capital    NUMERIC;
    v_dependency NUMERIC;
    v_risk       NUMERIC;
    v_total      NUMERIC;
    v_mode       VARCHAR := 'ADAPTATIF';
    v_hard       BOOLEAN := FALSE;
    v_reason     TEXT    := NULL;
BEGIN
    -- ContributionMarginScore (35%)
    v_cm := LEAST(100, GREATEST(0, p_cm_pct * 2));

    -- PatternConfidence (25%)
    v_pattern := LEAST(100, GREATEST(0, p_pattern_confidence));

    -- CapitalStrength (20%) — 90j = parfait
    v_capital := LEAST(100, GREATEST(0,
        ROUND((p_cash_runway_days::NUMERIC / 90.0) * 100, 1)
    ));

    -- DependencyHealth (10%)
    v_dependency := LEAST(100, GREATEST(0, 100 - p_dependency_pct));

    -- RiskControl (10%)
    v_risk := LEAST(100, GREATEST(0, 100 - p_risk_score));

    -- Calcul pondéré
    v_total := ROUND(
        (v_cm         * 0.35)
      + (v_pattern    * 0.25)
      + (v_capital    * 0.20)
      + (v_dependency * 0.10)
      + (v_risk       * 0.10)
    , 1);

    -- Mode
    v_mode := CASE
        WHEN v_total > 80 THEN 'AGGRESSIF'
        WHEN v_total > 60 THEN 'SCALABLE'
        WHEN v_total > 40 THEN 'ADAPTATIF'
        ELSE                   'SURVIE'
    END;

    -- Hard Constraints
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
        v_total, v_mode,
        v_cm, v_pattern, v_capital, v_dependency, v_risk,
        v_hard, v_reason;
END;
$$;

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  10. Vue ops.empire_dashboard                           \u2551
-- \u2551  Agr\u00e8ge tout en une seule vue pour le CEO dashboard     \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE OR REPLACE VIEW ops.empire_dashboard AS
SELECT
    -- Identit\u00e9
    t.id                            AS tenant_id,
    t.slug                          AS tenant_slug,

    -- Empire state
    es.empire_index,
    es.empire_mode,
    es.active_mode,
    es.palier,
    es.palier_progress_pct,
    es.hard_constraint_triggered,
    es.constraint_reason,
    es.score_capital,
    es.score_risk,
    es.score_dependency,
    es.score_condor,
    es.last_evaluated_at,

    -- Capital live
    cl.cash_balance_eur,
    cl.cash_runway_days,
    cl.burn_velocity_daily,
    cl.safe_scale_speed,
    cl.liquidity_stress_ratio,

    -- Snapshot du jour
    snap.revenue_eur                AS today_revenue,
    snap.ad_spend_eur               AS today_spend,
    snap.contribution_margin_pct    AS today_margin_pct,
    snap.risk_score,
    snap.dependency_pct,
    snap.primary_channel,

    -- Condors actifs
    snap.active_condors,
    snap.avg_fatigue_score,

    -- Risk
    rd.drawdown_pct                 AS latest_drawdown_pct,
    rd.risk_level                   AS current_risk_level,

    -- Simulations en attente
    (SELECT COUNT(*) FROM ops.simulation_log sl
     WHERE sl.tenant_id = t.id AND sl.status = 'proposed')
     AS pending_simulations,

    -- Phase active
    (SELECT phase_name FROM ops.phase_config
     WHERE is_unlocked = TRUE
     ORDER BY unlock_threshold_eur DESC LIMIT 1)
     AS active_phase

FROM saas.tenants t
LEFT JOIN ops.empire_state    es   ON es.tenant_id = t.id
LEFT JOIN ops.capital_live    cl   ON cl.tenant_id = t.id
LEFT JOIN ops.snapshot_daily  snap ON snap.tenant_id = t.id
                                  AND snap.snapshot_date = CURRENT_DATE
LEFT JOIN risk.drawdown       rd   ON rd.tenant_id = t.id
                                  AND rd.period_date = CURRENT_DATE
WHERE t.status = 'active';

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  11. Crons \u2014 AGENT_RISK_ENGINE                          \u2551
-- \u2551  Calcul Empire Index quotidien                          \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

-- Mettre \u00e0 jour AGENT_RISK_ENGINE dans le registre
-- (\u00e9tait un stub sans task_types)
INSERT INTO agents.registry
  (agent_id, name, category, required_level, description, capabilities, task_types, status)
VALUES (
  'AGENT_RISK_ENGINE',
  'Risk & Empire Engine',
  'data',
  'basic',
  'Calcule et maintient l''empire_index quotidien. G\u00e8re le capital_live, le risk_score, le dependency_pct. Alerte AGENT_ORCHESTRATOR si hard_constraint_triggered. G\u00e9n\u00e8re les simulations avant les d\u00e9cisions de scale importantes.',
  '["db.read_all","db.write_ops","agents.alert"]'::jsonb,
  '["empire.compute_index","empire.update_capital","empire.assess_risk","empire.simulate_action","empire.daily_snapshot","empire.condor_health_check"]'::jsonb,
  'active'
) ON CONFLICT (agent_id) DO UPDATE SET
    description  = EXCLUDED.description,
    capabilities = EXCLUDED.capabilities,
    task_types   = EXCLUDED.task_types,
    status       = 'active';

-- Crons Empire Core
INSERT INTO agents.schedule
  (agent_id, task_type, schedule_type, cron_expression, priority, enabled, description, created_at)
VALUES
(
  'AGENT_RISK_ENGINE', 'empire.daily_snapshot',
  'cron', '0 2 * * *',   -- 2h du matin, apr\u00e8s que les donn\u00e9es du jour sont stables
  9, TRUE,
  'Agr\u00e8ge toutes les m\u00e9triques du jour, calcule l''empire_index, met \u00e0 jour ops.snapshot_daily et ops.empire_state',
  NOW()
),
(
  'AGENT_RISK_ENGINE', 'empire.update_capital',
  'cron', '0 * * * *',   -- toutes les heures
  8, TRUE,
  'Met \u00e0 jour ops.capital_live : cash_balance, burn_velocity, cash_runway_days, liquidity_stress_ratio',
  NOW()
),
(
  'AGENT_RISK_ENGINE', 'empire.condor_health_check',
  'cron', '0 */6 * * *', -- toutes les 6h
  7, TRUE,
  'V\u00e9rifie fatigue_score et decay_detected sur toutes les cr\u00e9atives empire_condor_flag=TRUE',
  NOW()
),
(
  'AGENT_RISK_ENGINE', 'empire.assess_risk',
  'cron', '0 6,14,22 * * *', -- 3x/jour
  8, TRUE,
  'Calcule drawdown_pct, volatility_index, exposure_ratio. Met \u00e0 jour risk.drawdown. D\u00e9clenche alertes si seuils d\u00e9pass\u00e9s.',
  NOW()
)
ON CONFLICT (agent_id, task_type) DO UPDATE SET enabled = TRUE;

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  12. Runtime config \u2014 seuils Empire Core                \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

INSERT INTO ops.runtime_config
  (tenant_id, key, value, description, is_locked, locked_by)
VALUES
  -- Seuils empire_index
  (NULL, 'empire.index_aggressif_threshold',    '80',  'empire_index min pour mode AGGRESSIF', FALSE, 'SYSTEM'),
  (NULL, 'empire.index_institutionnel_threshold','65',  'empire_index min pour mode INSTITUTIONNEL', FALSE, 'SYSTEM'),
  (NULL, 'empire.index_adaptatif_threshold',     '40',  'empire_index min pour mode ADAPTATIF (en dessous = SURVIE)', FALSE, 'SYSTEM'),

  -- Seuils capital
  (NULL, 'empire.runway_survie_days',            '14',  'Cash runway en dessous duquel hard_constraint = TRUE', TRUE,  'SYSTEM'),
  (NULL, 'empire.runway_safe_days',              '30',  'Cash runway minimum recommand\u00e9 avant scaling', FALSE, 'SYSTEM'),
  (NULL, 'empire.runway_aggressif_days',         '90',  'Cash runway pour score capital max (25/25)', FALSE, 'SYSTEM'),

  -- Seuils risk
  (NULL, 'empire.risk_hard_constraint',          '70',  'risk_score au-dessus duquel hard_constraint = TRUE', TRUE,  'SYSTEM'),
  (NULL, 'empire.exposure_ratio_max',            '80',  '% max de ad_spend/cash_balance avant alerte', FALSE, 'SYSTEM'),

  -- Seuils dependency
  (NULL, 'empire.dependency_hard_constraint',    '90',  'dependency_pct au-dessus duquel hard_constraint = TRUE', TRUE,  'SYSTEM'),
  (NULL, 'empire.dependency_diversify_trigger',  '60',  'dependency_pct d\u00e9clenchant diversification_required = TRUE', FALSE, 'SYSTEM'),

  -- Paliers (CA annuel)
  (NULL, 'empire.palier_1_max_eur',    '1000000',    'Palier 1 : 0 \u2192 1M\u20ac/an', TRUE, 'SYSTEM'),
  (NULL, 'empire.palier_2_max_eur',    '10000000',   'Palier 2 : 1M \u2192 10M\u20ac/an', TRUE, 'SYSTEM'),
  (NULL, 'empire.palier_3_max_eur',    '120000000',  'Palier 3 : 10M \u2192 120M\u20ac/an', TRUE, 'SYSTEM'),

  -- Simulation
  (NULL, 'empire.simulation_auto_approve_threshold', '0.2', 'Si drawdown_probability < 20% et empire_index_delta > 0 \u2192 approbation auto', FALSE, 'SYSTEM'),
  (NULL, 'empire.simulation_expiry_hours',            '48',  'Dur\u00e9e avant expiration d''une simulation non approuv\u00e9e', FALSE, 'SYSTEM')

ON CONFLICT (COALESCE(tenant_id::text,'__global__'), key) DO NOTHING;

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  13. Hook \u2014 AGENT_SCALE_ENGINE doit consulter Empire    \u2551
-- \u2551  Avant toute d\u00e9cision de scale, v\u00e9rifier hard_constraint\u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

-- Vue pour que SCALE_ENGINE v\u00e9rifie rapidement les contraintes
CREATE OR REPLACE VIEW ops.scale_clearance AS
SELECT
    es.tenant_id,
    es.empire_index,
    es.empire_mode,
    es.hard_constraint_triggered,
    es.constraint_reason,
    cl.cash_runway_days,
    cl.safe_scale_speed,
    cl.liquidity_stress_ratio,
    -- Feu vert pour scaler ?
    CASE
        WHEN es.hard_constraint_triggered = TRUE THEN 'BLOCKED'
        WHEN cl.cash_runway_days < 14            THEN 'BLOCKED'
        WHEN cl.liquidity_stress_ratio < 1.0     THEN 'CAUTION'
        WHEN es.empire_index < 40                THEN 'CAUTION'
        WHEN es.empire_mode = 'AGGRESSIF'        THEN 'GO_AGGRESSIVE'
        WHEN es.empire_mode = 'INSTITUTIONNEL'   THEN 'GO_NORMAL'
        ELSE                                          'GO_CONSERVATIVE'
    END AS scale_signal,
    -- Budget max recommand\u00e9 pour ce scaling
    CASE
        WHEN es.hard_constraint_triggered = TRUE THEN 0
        WHEN es.empire_mode = 'AGGRESSIF'        THEN cl.cash_balance_eur * 0.40
        WHEN es.empire_mode = 'INSTITUTIONNEL'   THEN cl.cash_balance_eur * 0.25
        WHEN es.empire_mode = 'ADAPTATIF'        THEN cl.cash_balance_eur * 0.15
        ELSE                                          cl.cash_balance_eur * 0.05
    END AS recommended_max_budget_eur
FROM ops.empire_state es
JOIN ops.capital_live cl ON cl.tenant_id = es.tenant_id;

-- ============================================================
-- R\u00c9SUM\u00c9 DE CETTE MIGRATION
-- ============================================================
-- Tables cr\u00e9\u00e9es    : ops.snapshot_daily, ops.capital_live,
--                    ops.empire_state, ops.simulation_log
-- Tables \u00e9tendues  : risk.drawdown (+2 colonnes),
--                    ecosystem.channels (+2 colonnes),
--                    intel.patterns (+3 colonnes),
--                    creative.awareness_matrix (+4 colonnes)
-- Fonctions        : ops.compute_empire_index()
-- Vues             : ops.empire_dashboard, ops.scale_clearance
-- Crons ajout\u00e9s    : 4 (empire.daily_snapshot, update_capital,
--                    condor_health_check, assess_risk)
-- Config ajout\u00e9e   : 15 param\u00e8tres runtime
-- Agents mis \u00e0 jour: AGENT_RISK_ENGINE (stub \u2192 actif)
-- Doublons \u00e9vit\u00e9s  : 0 table dupliqu\u00e9e depuis AEGIS existant
-- ============================================================
