-- ============================================================
-- MIGRATION 011 \u2014 SYST\u00c8ME CONDOR (7 PHASES)
-- ============================================================
-- Phase 1 : Winner Detector      \u2192 intel.product_equations
-- Phase 2 : Creative Factory     \u2192 creative.briefs + creative.matrix
-- Phase 3 : Funnel Engine        \u2192 funnel.architecture
-- Phase 4 : Offer Optimizer      \u2192 offer.stacks + offer.tests
-- Phase 5 : Meta Scientific Test \u2192 ads.cbo_campaigns + ads.creative_classification
-- Phase 6 : Scale Engine         \u2192 ads.scale_decisions
-- Phase 7 : Ecosystem Loop       \u2192 ecosystem.channels + ecosystem.health
-- ============================================================

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  PHASE 1 \u2014 WINNER DETECTOR                              \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE SCHEMA IF NOT EXISTS intel;

CREATE TABLE IF NOT EXISTS intel.product_equations (
    id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id           UUID        NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id          UUID        NOT NULL REFERENCES store.products(id) ON DELETE CASCADE,

    -- Inputs \u00e9conomiques
    selling_price       DECIMAL(10,2) NOT NULL,
    cogs                DECIMAL(10,2) NOT NULL,
    shipping_cost       DECIMAL(10,2) NOT NULL DEFAULT 0,
    payment_fees        DECIMAL(10,2) NOT NULL DEFAULT 0,
    estimated_cpa       DECIMAL(10,2) NOT NULL,
    estimated_tam_eur   BIGINT,
    estimated_repeat_rate DECIMAL(5,2) DEFAULT 0,  -- % clients qui rach\u00e8tent

    -- Calculs automatiques (GENERATED)
    variable_cost       DECIMAL(10,2) GENERATED ALWAYS AS
                          (cogs + shipping_cost + payment_fees) STORED,
    contribution_margin DECIMAL(10,2) GENERATED ALWAYS AS
                          (selling_price - cogs - shipping_cost - payment_fees - estimated_cpa) STORED,
    contribution_margin_pct DECIMAL(5,2) GENERATED ALWAYS AS
                          (CASE WHEN selling_price > 0
                           THEN ROUND((selling_price - cogs - shipping_cost - payment_fees - estimated_cpa)
                                / selling_price * 100, 2)
                           ELSE 0 END) STORED,
    break_even_roas     DECIMAL(8,2) GENERATED ALWAYS AS
                          (CASE WHEN (selling_price - cogs - shipping_cost - payment_fees) > 0
                           THEN ROUND(selling_price / (selling_price - cogs - shipping_cost - payment_fees), 2)
                           ELSE NULL END) STORED,

    -- LTV projections (calcul\u00e9es par l'agent)
    ltv_30d             DECIMAL(10,2),
    ltv_60d             DECIMAL(10,2),
    ltv_90d             DECIMAL(10,2),
    profit_potential    DECIMAL(15,2),  -- contribution_margin \u00d7 TAM

    -- Validation marketing
    marketing_angles    JSONB DEFAULT '[]'::jsonb,     -- min 3 requis
    awareness_levels    JSONB DEFAULT '[]'::jsonb,     -- min 2 requis
    angles_count        INTEGER DEFAULT 0,
    awareness_count     INTEGER DEFAULT 0,

    -- Verdict
    verdict             VARCHAR(20) DEFAULT 'pending'
                          CHECK (verdict IN ('pending','winner_potential','optimise_offer','rejected','takeoff')),
    verdict_reasons     JSONB DEFAULT '[]'::jsonb,
    validated_at        TIMESTAMPTZ,

    -- Score composite 0\u2013100
    winner_score        DECIMAL(5,2),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_equation_product UNIQUE (tenant_id, product_id)
);

ALTER TABLE intel.product_equations ENABLE ROW LEVEL SECURITY;
ALTER TABLE intel.product_equations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON intel.product_equations
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

-- Vue : tableau de bord produits avec score winner
CREATE OR REPLACE VIEW intel.winner_dashboard AS
SELECT
    p.name                           AS product_name,
    pe.selling_price,
    pe.contribution_margin,
    pe.contribution_margin_pct       AS margin_pct,
    pe.break_even_roas,
    pe.estimated_cpa,
    pe.ltv_30d,
    pe.ltv_90d,
    pe.winner_score,
    pe.verdict,
    pe.angles_count                  AS nb_angles,
    pe.validated_at
FROM intel.product_equations pe
JOIN store.products p ON p.id = pe.product_id
ORDER BY pe.winner_score DESC NULLS LAST;

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  PHASE 2 \u2014 CREATIVE FACTORY                             \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE SCHEMA IF NOT EXISTS creative;

-- Niveaux d'awareness (Eugene Schwartz)
CREATE TABLE IF NOT EXISTS creative.awareness_matrix (
    id            UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id     UUID    NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id    UUID    NOT NULL REFERENCES store.products(id) ON DELETE CASCADE,

    -- 5 niveaux \u00d7 3 angles \u00d7 2 concepts = 30 briefs potentiels par produit
    awareness_level    VARCHAR(20) NOT NULL
                         CHECK (awareness_level IN ('unaware','problem_aware','solution_aware','product_aware','most_aware')),
    marketing_angle    TEXT NOT NULL,
    concept_type       VARCHAR(30) NOT NULL
                         CHECK (concept_type IN ('UGC','founder','demo','visual_metaphor','POV','testimonial','transformation')),
    persona_id         TEXT,   -- r\u00e9f\u00e9rence vers fast_analysis.personas

    -- Structure cr\u00e9ative obligatoire (7 \u00e9tapes)
    hook               TEXT,          -- 2 sec max
    relevance_signal   TEXT,          -- POR
    pain_amplification TEXT,
    desire_projection  TEXT,
    emotional_gap      TEXT,
    visual_proof       TEXT,
    cta                TEXT,          -- CTA choix (Pack A / Pack B)

    -- Hooks biologiques
    hook_movement      TEXT,          -- mouvement visuel
    hook_emotional     TEXT,          -- tension \u00e9motionnelle

    -- Entity ID compliance (Meta 2026)
    entity_id_variant  JSONB DEFAULT '{}'::jsonb,
    -- { format, persona, decor, narrative_vehicle }
    -- Chaque it\u00e9ration doit modifier au moins 1 de ces 4 \u00e9l\u00e9ments

    -- Performance tracking
    is_launched        BOOLEAN DEFAULT FALSE,
    ad_id              TEXT,          -- Meta ad ID une fois lanc\u00e9
    spend              DECIMAL(10,2) DEFAULT 0,
    impressions        BIGINT DEFAULT 0,
    clicks             INTEGER DEFAULT 0,
    conversions        INTEGER DEFAULT 0,
    frequency          DECIMAL(5,2),
    cpr                DECIMAL(10,2),  -- Cost Per Result
    classification     VARCHAR(20),   -- TOF_CREATOR | BOF_MONETIZER | CONDOR | DEAD
    condor_score       DECIMAL(5,2),  -- potentiel 500K+ spend

    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE creative.awareness_matrix ENABLE ROW LEVEL SECURITY;
ALTER TABLE creative.awareness_matrix FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON creative.awareness_matrix
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

CREATE INDEX IF NOT EXISTS idx_creative_product     ON creative.awareness_matrix (tenant_id, product_id);
CREATE INDEX IF NOT EXISTS idx_creative_awareness   ON creative.awareness_matrix (awareness_level, classification);
CREATE INDEX IF NOT EXISTS idx_creative_condor      ON creative.awareness_matrix (condor_score DESC NULLS LAST) WHERE condor_score IS NOT NULL;

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  PHASE 3 \u2014 FUNNEL ENGINE                                \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE SCHEMA IF NOT EXISTS funnel;

CREATE TABLE IF NOT EXISTS funnel.architecture (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID    NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id      UUID    NOT NULL REFERENCES store.products(id) ON DELETE CASCADE,

    -- Statut global du funnel
    status          VARCHAR(20) NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','building','live','optimising','paused')),

    -- \u00c9tapes du funnel (PRIMAL \u2192 ACTION)
    has_advertorial       BOOLEAN DEFAULT FALSE,
    advertorial_url       TEXT,
    landing_page_url      TEXT,
    checkout_url          TEXT,
    upsell_url            TEXT,

    -- Landing page above-the-fold validation
    atf_has_promise       BOOLEAN DEFAULT FALSE,
    atf_has_differentiator BOOLEAN DEFAULT FALSE,
    atf_has_social_proof  BOOLEAN DEFAULT FALSE,
    atf_has_cta           BOOLEAN DEFAULT FALSE,
    atf_has_offer_stack   BOOLEAN DEFAULT FALSE,
    atf_complete          BOOLEAN GENERATED ALWAYS AS
                            (atf_has_promise AND atf_has_differentiator
                             AND atf_has_social_proof AND atf_has_cta
                             AND atf_has_offer_stack) STORED,

    -- Congruence score (0\u2013100) : coh\u00e9rence creative \u2192 landing
    congruence_index      DECIMAL(5,2) DEFAULT 0,
    -- Formule CONDOR : (Angle \u00d7 (Avatar \u00d7 Awareness)) \u00d7 Concept \u00d7 Congruence

    -- Email/SMS LTV loop
    email_sequence_active  BOOLEAN DEFAULT FALSE,
    sms_reactivation_active BOOLEAN DEFAULT FALSE,

    -- M\u00e9triques funnel
    landing_cvr            DECIMAL(5,2),  -- % visiteurs \u2192 achat
    checkout_cvr           DECIMAL(5,2),
    upsell_take_rate       DECIMAL(5,2),
    email_open_rate        DECIMAL(5,2),

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_funnel_product UNIQUE (tenant_id, product_id)
);

ALTER TABLE funnel.architecture ENABLE ROW LEVEL SECURITY;
ALTER TABLE funnel.architecture FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON funnel.architecture
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  PHASE 4 \u2014 OFFER OPTIMIZER (Hormozi)                    \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE TABLE IF NOT EXISTS store.offer_stacks (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID    NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id      UUID    NOT NULL REFERENCES store.products(id) ON DELETE CASCADE,

    -- Formule Hormozi : Value = (Dream \u00d7 Likelihood) / (Time \u00d7 Effort)
    dream_outcome      TEXT NOT NULL,
    perceived_likelihood DECIMAL(5,2),  -- % confiance client
    time_to_result     TEXT,            -- "en 7 jours" / "d\u00e8s la 1\u00e8re utilisation"
    effort_required    TEXT,            -- "sans r\u00e9gime" / "2 min/jour"
    hormozi_value_score DECIMAL(8,2),

    -- Structure des packs (decoy pricing)
    pack_a_name        TEXT,   -- Pack de base
    pack_a_price       DECIMAL(10,2),
    pack_a_contents    JSONB DEFAULT '[]'::jsonb,

    pack_b_name        TEXT,   -- Pack recommand\u00e9 (decoy effect cible celui-ci)
    pack_b_price       DECIMAL(10,2),
    pack_b_contents    JSONB DEFAULT '[]'::jsonb,
    pack_b_is_best_value BOOLEAN DEFAULT TRUE,

    pack_c_name        TEXT,   -- Pack premium (anchor price)
    pack_c_price       DECIMAL(10,2),
    pack_c_contents    JSONB DEFAULT '[]'::jsonb,

    -- Bonus & garantie
    free_bonus         JSONB DEFAULT '[]'::jsonb,   -- [{ name, value_eur }]
    guarantee_days     INTEGER DEFAULT 30,
    guarantee_text     TEXT,

    -- Price anchoring
    anchor_price       DECIMAL(10,2),
    anchor_reason      TEXT,

    -- Time compression
    urgency_type       VARCHAR(20) DEFAULT 'none'
                         CHECK (urgency_type IN ('none','stock','time','promo')),
    urgency_text       TEXT,

    -- Impact calcul\u00e9 automatiquement
    aov_impact_pct         DECIMAL(5,2),  -- % augmentation AOV vs baseline
    break_even_roas_new    DECIMAL(8,2),
    contribution_margin_new DECIMAL(10,2),

    -- Testing
    is_active          BOOLEAN DEFAULT FALSE,
    is_winner          BOOLEAN DEFAULT FALSE,
    test_start_at      TIMESTAMPTZ,
    test_conversions   INTEGER DEFAULT 0,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE store.offer_stacks ENABLE ROW LEVEL SECURITY;
ALTER TABLE store.offer_stacks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON store.offer_stacks
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  PHASE 5 \u2014 META SCIENTIFIC TESTING                      \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE TABLE IF NOT EXISTS ads.cbo_campaigns (
    id                UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id         UUID    NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id        UUID    NOT NULL REFERENCES store.products(id) ON DELETE CASCADE,

    -- Identifiants Meta
    meta_campaign_id  TEXT    UNIQUE,
    meta_account_id   TEXT    NOT NULL,

    -- Configuration CBO
    daily_budget_eur  DECIMAL(10,2) NOT NULL,  -- 300\u2013500$ recommand\u00e9
    campaign_type     VARCHAR(20) DEFAULT 'CBO'
                        CHECK (campaign_type IN ('CBO','ABO','ASC')),
    objective         VARCHAR(30) DEFAULT 'OUTCOME_SALES',
    max_ads_per_adset INTEGER DEFAULT 15,

    -- Phase de test
    phase             VARCHAR(20) DEFAULT 'testing'
                        CHECK (phase IN ('testing','validating','scaling','cruise','paused','dead')),

    -- M\u00e9triques agr\u00e9g\u00e9es (mis \u00e0 jour par AGENT_ADS toutes les heures)
    total_spend       DECIMAL(10,2) DEFAULT 0,
    total_revenue     DECIMAL(10,2) DEFAULT 0,
    roas              DECIMAL(8,2),
    cpa               DECIMAL(10,2),
    frequency         DECIMAL(5,2),
    impressions       BIGINT DEFAULT 0,
    clicks            INTEGER DEFAULT 0,
    conversions       INTEGER DEFAULT 0,

    -- Contribution margin r\u00e9elle (avec donn\u00e9es ops.revenue_daily)
    actual_contribution_margin DECIMAL(10,2),

    -- Jours cons\u00e9cutifs en profit/perte (pour scale/cut)
    consecutive_profit_days INTEGER DEFAULT 0,
    consecutive_loss_days   INTEGER DEFAULT 0,

    -- R\u00e8gles de scale appliqu\u00e9es
    last_scale_action  TEXT,
    last_scale_at      TIMESTAMPTZ,

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ads.cbo_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.cbo_campaigns FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ads.cbo_campaigns
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

-- Classification des cr\u00e9atives apr\u00e8s 48h
CREATE TABLE IF NOT EXISTS ads.creative_classification (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID    NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    campaign_id     UUID    NOT NULL REFERENCES ads.cbo_campaigns(id) ON DELETE CASCADE,
    creative_id     UUID    REFERENCES creative.awareness_matrix(id),

    -- Donn\u00e9es Meta apr\u00e8s 48h
    meta_ad_id      TEXT,
    spend_48h       DECIMAL(10,2) DEFAULT 0,
    frequency_48h   DECIMAL(5,2),
    cpr_48h         DECIMAL(10,2),

    -- Classification automatique (r\u00e8gles Phase 5)
    -- IF spend\u2191 + freq ~1.1 \u2192 TOF_CREATOR (cherche nouveaux prospects)
    -- IF freq\u2191 + CPR\u2193       \u2192 BOF_MONETIZER (convertit les chauds)
    -- IF spend 500K+ potentiel \u2192 CONDOR
    classification  VARCHAR(20)
                      CHECK (classification IN ('TOF_CREATOR','BOF_MONETIZER','CONDOR','AVERAGE','DEAD')),
    classification_reason TEXT,
    classified_at   TIMESTAMPTZ,

    -- It\u00e9ration
    iteration_from  UUID REFERENCES ads.creative_classification(id),
    -- Ce qui a chang\u00e9 par rapport \u00e0 l'it\u00e9ration pr\u00e9c\u00e9dente
    entity_change   JSONB DEFAULT '{}'::jsonb,
    -- { format?, persona?, decor?, narrative_vehicle? }

    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE ads.creative_classification ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.creative_classification FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ads.creative_classification
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

CREATE INDEX IF NOT EXISTS idx_class_campaign ON ads.creative_classification (campaign_id, classification);
CREATE INDEX IF NOT EXISTS idx_class_condor   ON ads.creative_classification (classification) WHERE classification = 'CONDOR';

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  PHASE 6 \u2014 SCALE ENGINE                                 \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE TABLE IF NOT EXISTS ads.scale_decisions (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID    NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    campaign_id     UUID    NOT NULL REFERENCES ads.cbo_campaigns(id) ON DELETE CASCADE,

    -- Contexte de la d\u00e9cision
    decision_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    trigger_type        VARCHAR(30) NOT NULL,
    -- profit_stable_3d | margin_gt_15 | margin_weak | loss_3d | manual

    -- Donn\u00e9es au moment de la d\u00e9cision
    contribution_margin_at_decision DECIMAL(10,2),
    consecutive_days    INTEGER,
    current_budget      DECIMAL(10,2),
    roas_at_decision    DECIMAL(8,2),
    cpa_at_decision     DECIMAL(10,2),

    -- D\u00e9cision prise
    action              VARCHAR(20) NOT NULL,
    -- budget_plus_20 | budget_plus_10 | hold | budget_minus_20 | pause | kill
    budget_before       DECIMAL(10,2),
    budget_after        DECIMAL(10,2),
    change_pct          DECIMAL(5,2),

    -- Passage CRUISE
    entered_cruise      BOOLEAN DEFAULT FALSE,
    -- CRUISE = profit stable 3j + margin positive + CPA stable

    applied             BOOLEAN DEFAULT FALSE,
    applied_at          TIMESTAMPTZ,
    meta_response       JSONB,  -- r\u00e9ponse de l'API Meta
    notes               TEXT
);

ALTER TABLE ads.scale_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ads.scale_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ads.scale_decisions
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  PHASE 7 \u2014 ECOSYSTEM LOOP                               \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

CREATE SCHEMA IF NOT EXISTS ecosystem;

CREATE TABLE IF NOT EXISTS ecosystem.channels (
    id              UUID    PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID    NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    product_id      UUID    NOT NULL REFERENCES store.products(id) ON DELETE CASCADE,

    channel         VARCHAR(30) NOT NULL
                      CHECK (channel IN ('meta','google','email','sms','amazon','youtube','tiktok_shop','organic')),
    is_active       BOOLEAN DEFAULT FALSE,
    activated_at    TIMESTAMPTZ,

    -- M\u00e9triques par canal (mis \u00e0 jour quotidiennement)
    revenue_7d      DECIMAL(10,2) DEFAULT 0,
    revenue_30d     DECIMAL(10,2) DEFAULT 0,
    revenue_pct     DECIMAL(5,2) DEFAULT 0,  -- % du CA total
    roas            DECIMAL(8,2),
    cpa             DECIMAL(10,2),

    -- Risques
    dependency_risk_score DECIMAL(5,2),
    -- >60 = trop d\u00e9pendant de ce canal (fragile)
    channel_stability_index DECIMAL(5,2),
    -- 0\u2013100 : stabilit\u00e9 des performances sur 30j

    -- S\u00e9quences actives
    email_sequences JSONB DEFAULT '[]'::jsonb,
    sms_flows       JSONB DEFAULT '[]'::jsonb,

    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_channel_product UNIQUE (tenant_id, product_id, channel)
);

ALTER TABLE ecosystem.channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE ecosystem.channels FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON ecosystem.channels
    USING (tenant_id = current_setting('app.tenant_id',TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id',TRUE)::UUID);

-- Vue sant\u00e9 de l'\u00e9cosyst\u00e8me
CREATE OR REPLACE VIEW ecosystem.health_monitor AS
SELECT
    c.channel,
    c.is_active,
    c.revenue_30d,
    c.revenue_pct,
    c.roas,
    c.dependency_risk_score,
    c.channel_stability_index,
    CASE
        WHEN c.dependency_risk_score > 60 THEN 'HIGH_RISK'
        WHEN c.dependency_risk_score > 40 THEN 'MEDIUM_RISK'
        ELSE 'STABLE'
    END AS risk_level
FROM ecosystem.channels c
ORDER BY c.revenue_30d DESC NULLS LAST;

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  GUARDRAILS CONDOR \u2014 ops.runtime_config extensions      \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

INSERT INTO ops.runtime_config (tenant_id, key, value, description, is_locked, locked_by) VALUES
-- Winner detector
(NULL, 'winner.min_contribution_margin_pct', '30',   'Marge contribution minimum pour valider un winner (%)', TRUE, 'SYSTEM'),
(NULL, 'winner.min_aov_eur',                 '60',   'AOV minimum pour un produit winner (\u20ac)', TRUE, 'SYSTEM'),
(NULL, 'winner.min_angles',                  '3',    'Nombre minimum d''angles marketing', TRUE, 'SYSTEM'),
(NULL, 'winner.min_awareness_levels',        '2',    'Nombre minimum de niveaux d''awareness', TRUE, 'SYSTEM'),

-- Creative factory
(NULL, 'creative.max_ads_per_adset',         '15',   'Maximum ads par ad set (limite Meta)', TRUE, 'SYSTEM'),
(NULL, 'creative.entity_id_variants_min',    '1',    'Minimum de variables chang\u00e9es entre it\u00e9rations (Entity ID)', TRUE, 'SYSTEM'),
(NULL, 'creative.hook_duration_max_sec',     '2',    'Dur\u00e9e maximum du hook en secondes', TRUE, 'SYSTEM'),

-- Meta testing
(NULL, 'meta.cbo_budget_min_eur',            '300',  'Budget CBO minimum (\u20ac/jour)', TRUE, 'SYSTEM'),
(NULL, 'meta.cbo_budget_max_eur',            '500',  'Budget CBO initial maximum (\u20ac/jour)', TRUE, 'SYSTEM'),
(NULL, 'meta.classification_window_hours',   '48',   'Fen\u00eatre de classification cr\u00e9atives (heures)', TRUE, 'SYSTEM'),
(NULL, 'meta.no_medical_claims',             'true', 'Interdiction claims m\u00e9dicaux non conformes', TRUE, 'SYSTEM'),

-- Scale engine
(NULL, 'scale.budget_increase_high_margin',  '20',   'Augmentation budget si marge >15% (+%)', TRUE, 'SYSTEM'),
(NULL, 'scale.budget_increase_low_margin',   '10',   'Augmentation budget si marge faible (+%)', TRUE, 'SYSTEM'),
(NULL, 'scale.budget_decrease_losses',       '20',   'R\u00e9duction budget si 3 jours n\u00e9gatifs (-%)', TRUE, 'SYSTEM'),
(NULL, 'scale.cruise_profit_days',           '3',    'Jours de profit stables pour entrer en CRUISE', TRUE, 'SYSTEM'),

-- Guardrails financiers
(NULL, 'guardrails.kill_switch_roas_days',   '3',    'Kill switch si ROAS sous seuil X jours cons\u00e9cutifs', TRUE, 'SYSTEM'),
(NULL, 'guardrails.meta_policy_check',       'true', 'V\u00e9rification politique Meta avant lancement', TRUE, 'SYSTEM'),
(NULL, 'guardrails.condor_spend_target',     '500000','Seuil de spend objectif pour une cr\u00e9ative CONDOR', TRUE, 'SYSTEM')

ON CONFLICT (COALESCE(tenant_id::text,'__global__'), key) DO NOTHING;

-- \u2554\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2557
-- \u2551  SEED AGENTS CONDOR dans agents.registry                \u2551
-- \u255a\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u255d

INSERT INTO agents.registry (agent_id, name, category, required_level, task_types, capabilities, status)
VALUES
(
    'AGENT_WINNER_DETECTOR',
    'Winner Detector',
    'data',
    'basic',
    '["winner.evaluate","winner.score","winner.validate","winner.reject"]',
    '["llm.generate"]'::jsonb,
    'standby'  -- s''active avec les 3 agents de phase 0
),
(
    'AGENT_CREATIVE_FACTORY',
    'Creative Factory (CONDOR)',
    'creative',
    'basic',
    '["creative.matrix_build","creative.brief_generate","creative.iterate","creative.classify","creative.condor_detect"]',
    '["llm.generate"]'::jsonb,
    'standby'
),
(
    'AGENT_FUNNEL_ENGINE',
    'Funnel Engine',
    'product',
    'basic',
    '["funnel.build","funnel.validate_atf","funnel.congruence_check","funnel.optimize"]',
    '["store.publish","llm.generate"]'::jsonb,
    'standby'
),
(
    'AGENT_OFFER_OPTIMIZER',
    'Offer Optimizer (Hormozi)',
    'product',
    'basic',
    '["offer.stack_build","offer.hormozi_score","offer.decoy_price","offer.test","offer.impact_calculate"]',
    '["llm.generate","store.publish"]'::jsonb,
    'standby'
),
(
    'AGENT_META_TESTING',
    'Meta Scientific Testing',
    'ads',
    'basic',
    '["meta.cbo_launch","meta.creative_classify_48h","meta.pattern_extract","meta.iterate"]',
    '["ads.write","ads.scale"]'::jsonb,
    'standby'
),
(
    'AGENT_SCALE_ENGINE',
    'Scale Engine (CONDOR)',
    'ads',
    'basic',
    '["scale.evaluate","scale.budget_adjust","scale.cruise_check","scale.condor_identify","scale.ecosystem_activate"]',
    '["ads.write","ads.scale"]'::jsonb,
    'standby'
),
(
    'AGENT_ECOSYSTEM_LOOP',
    'Ecosystem Loop',
    'data',
    'hedge_fund',
    '["ecosystem.google_activate","ecosystem.email_ltv","ecosystem.sms_reactivation","ecosystem.amazon_capture","ecosystem.youtube_trust","ecosystem.health_monitor"]',
    '["llm.generate"]'::jsonb,
    'standby'
)
ON CONFLICT (agent_id) DO UPDATE SET
    name = EXCLUDED.name,
    task_types = EXCLUDED.task_types,
    capabilities = EXCLUDED.capabilities;

-- \u2500\u2500 Ajouter les agents CONDOR dans la Phase 1 unlock \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
UPDATE ops.phase_config
SET agents_to_unlock = agents_to_unlock || '["AGENT_WINNER_DETECTOR","AGENT_CREATIVE_FACTORY","AGENT_FUNNEL_ENGINE","AGENT_OFFER_OPTIMIZER","AGENT_META_TESTING","AGENT_SCALE_ENGINE"]'::jsonb
WHERE phase_name = 'phase_1';

-- AGENT_ECOSYSTEM_LOOP uniquement en hedge_fund (phase 2, \u00e0 d\u00e9finir)
INSERT INTO ops.phase_config
  (phase_name, unlock_threshold_eur, unlock_window_days, agents_to_unlock, description)
VALUES (
  'phase_2',
  5000.00,
  3,
  '["AGENT_ECOSYSTEM_LOOP"]'::jsonb,
  '5000\u20ac/jour \u00d7 3 jours cons\u00e9cutifs \u2192 Ecosystem Loop multi-canal (Google + Email + SMS + Amazon + YouTube)'
) ON CONFLICT DO NOTHING;

-- \u2500\u2500 Cron AGENT_META_TESTING : classification 48h \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
INSERT INTO agents.schedule (agent_id, task_type, schedule_type, cron_expression, priority, enabled, description, created_at)
VALUES
(
    'AGENT_META_TESTING',
    'meta.creative_classify_48h',
    'cron', '0 */6 * * *',  -- toutes les 6 heures
    8, TRUE,
    'Lire m\u00e9triques Meta, classifier les cr\u00e9atives TOF/BOF/CONDOR, it\u00e9rer sur patterns gagnants',
    NOW()
),
(
    'AGENT_SCALE_ENGINE',
    'scale.evaluate',
    'cron', '0 8 * * *',    -- tous les jours \u00e0 8h
    9, TRUE,
    '\u00c9valuer la contribution margin, d\u00e9cider +/-20%/+10% budget, d\u00e9tecter entr\u00e9e en CRUISE',
    NOW()
),
(
    'AGENT_WINNER_DETECTOR',
    'winner.evaluate',
    'trigger', NULL,
    8, TRUE,
    'D\u00e9clench\u00e9 sur product.ingested : calcule l''\u00e9quation \u00e9conomique et valide ou rejette le produit',
    NOW()
),
(
    'AGENT_ECOSYSTEM_LOOP',
    'ecosystem.health_monitor',
    'cron', '0 9 * * *',    -- tous les jours \u00e0 9h
    6, TRUE,
    'Monitorer revenue par canal, dependency risk score, channel stability index',
    NOW()
)
ON CONFLICT (agent_id, task_type) DO UPDATE SET enabled = TRUE;
