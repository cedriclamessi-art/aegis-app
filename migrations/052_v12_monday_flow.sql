-- ============================================================
-- AEGIS v12.2 — SCHEMA SQL : CRO-Optimized + Multi-Connecteurs
-- ============================================================

-- ============================================================
-- 1. PRODUCT_IMPORTERS (Import universel)
-- ============================================================

CREATE TABLE product_importers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Source universelle
    source_type VARCHAR(50) NOT NULL,  -- 'amazon', 'aliexpress', 'shopify', 'woocommerce', 'generic'
    source_url TEXT NOT NULL,          -- URL complète du produit
    source_domain VARCHAR(255),        -- amazon.com, aliexpress.com, etc.
    
    -- Données brutes scrappées
    raw_data JSONB,                    -- Données complètes scrappées
    extracted_title VARCHAR(500),
    extracted_description TEXT,
    extracted_images TEXT[],           -- URLs images
    extracted_price DECIMAL(10,2),     -- Prix source
    extracted_reviews JSONB,           -- Avis, notes, nombre
    
    -- Analyse AEGIS
    hunter_score INTEGER,              -- 0-100 potentiel gagnant
    cro_potential_score INTEGER,       -- 0-100 potentiel conversion
    psychology_profile JSONB,          -- {"dominant_bias": "loss_aversion", "appeal_type": "status"}
    
    -- Status
    import_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'processed', 'failed'
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_importers_source ON product_importers(source_type, source_domain);
CREATE INDEX idx_importers_score ON product_importers(hunter_score DESC, cro_potential_score DESC);

-- ============================================================
-- 2. AD_PLATFORM_CONNECTORS (Meta, TikTok, Google, Pinterest)
-- ============================================================

CREATE TABLE ad_platform_connectors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Platform
    platform VARCHAR(50) NOT NULL,  -- 'meta', 'tiktok', 'google', 'pinterest'
    
    -- OAuth credentials (encrypted)
    access_token_encrypted TEXT,
    refresh_token_encrypted TEXT,
    token_expires_at TIMESTAMP,
    
    -- Account details
    ad_account_id VARCHAR(255),
    pixel_id VARCHAR(255),           -- Meta/TikTok pixel
    conversion_id VARCHAR(255),      -- Google Conversion ID
    tag_id VARCHAR(255),             -- Pinterest Tag
    
    -- Settings
    default_budget_daily DECIMAL(10,2),
    default_roas_target DECIMAL(4,2),  -- 3.00 = ROAS 3:1
    auto_optimization_enabled BOOLEAN DEFAULT TRUE,
    
    -- CRO-specific
    psychology_targeting JSONB,      -- {"bias_focus": "loss_aversion", "appeal": "social_proof"}
    creative_strategy VARCHAR(50) DEFAULT 'a_b_testing',  -- 'a_b', 'dynamic_creative', 'personalized'
    
    is_active BOOLEAN DEFAULT TRUE,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(brand_id, platform)
);

-- ============================================================
-- 3. AD_CAMPAIGNS_CRO (Campagnes optimisées psychologie)
-- ============================================================

CREATE TABLE ad_campaigns_cro (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    platform_connector_id UUID REFERENCES ad_platform_connectors(id),
    
    -- Campaign basics
    campaign_name VARCHAR(255) NOT NULL,
    campaign_objective VARCHAR(50),  -- 'conversions', 'awareness', 'engagement'
    
    -- Psychology strategy
    primary_psychology_trigger VARCHAR(50),  -- 'loss_aversion', 'social_proof', 'scarcity', 'authority'
    secondary_psychology_trigger VARCHAR(50),
    customer_awareness_stage VARCHAR(50),    -- 'unaware', 'problem_aware', 'solution_aware', 'product_aware'
    
    -- Creative variants (générés par GEN-COPY-CRO, GEN-VISUAL-CRO)
    creative_variants JSONB,  -- [
                              --   {"id": "A", "psychology": "loss_aversion", "copy": "...", "visual": "..."},
                              --   {"id": "B", "psychology": "social_proof", "copy": "...", "visual": "..."}
                              -- ]
    
    -- Targeting
    target_audience_psychographics JSONB,  -- {"fears": ["missing_out"], "desires": ["status"], "values": ["quality"]}
    lookalike_source VARCHAR(50),  -- 'customers', 'engaged', 'website_visitors'
    
    -- Budget & Bidding
    budget_daily DECIMAL(10,2),
    bid_strategy VARCHAR(50),  -- 'lowest_cost', 'cost_cap', 'minimum_roas'
    
    -- CRO tracking
    a_b_test_status VARCHAR(20) DEFAULT 'running',  -- 'running', 'winner_selected', 'completed'
    winning_variant_id VARCHAR(10),
    statistical_significance DECIMAL(5,4),  -- 0.95 = 95% confiance
    
    -- Metrics
    spend_total DECIMAL(12,2) DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue_attributed DECIMAL(12,2) DEFAULT 0,
    roas DECIMAL(5,2),
    cpa DECIMAL(8,2),  -- Cost Per Acquisition
    
    -- Psychology-specific metrics
    psychology_performance JSONB,  -- {"loss_aversion_ctr": 0.045, "social_proof_ctr": 0.038}
    
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    launched_at TIMESTAMP
);

CREATE INDEX idx_campaigns_cro_brand ON ad_campaigns_cro(brand_id);
CREATE INDEX idx_campaigns_cro_psychology ON ad_campaigns_cro(primary_psychology_trigger);
CREATE INDEX idx_campaigns_cro_roas ON ad_campaigns_cro(roas DESC);

-- ============================================================
-- 4. LANDING_PAGE_CRO (Pages optimisées conversion)
-- ============================================================

CREATE TABLE landing_page_cro (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    -- Page structure (AIDA + Psychologie)
    page_name VARCHAR(255),
    page_type VARCHAR(50),  -- 'homepage', 'product', 'checkout', 'thank_you'
    
    -- Psychology framework
    psychology_framework VARCHAR(50),  -- 'aida', 'pas', 'fab', 'quest'
    primary_bias_targeted VARCHAR(50),  -- 'loss_aversion', 'anchoring', 'scarcity'
    
    -- Sections (ordre optimisé par ARCHITECT-CRO)
    sections_order JSONB,  -- [
                           --   {"type": "hero", "psychology": "attention_gain", "variant": "A"},
                           --   {"type": "social_proof", "psychology": "authority_bias", "variant": "B"},
                           --   {"type": "offer", "psychology": "loss_aversion", "variant": "A"}
                           -- ]
    
    -- Elements CRO
    headline_variants JSONB,       -- Test A/B headlines
    cta_variants JSONB,            -- Test A/B boutons
    price_display_variants JSONB,  -- Test A/B affichage prix (ancrage, cadrage)
    urgency_elements JSONB,        -- Compteurs, stock faible
    
    -- Test results
    active_test_id UUID,
    conversion_rate DECIMAL(5,4),  -- 0.035 = 3.5%
    bounce_rate DECIMAL(5,4),
    avg_time_on_page INTEGER,      -- secondes
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 5. CRO_EXPERIMENTS (Tests A/B systématiques)
-- ============================================================

CREATE TABLE cro_experiments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    -- Test definition
    experiment_name VARCHAR(255),
    hypothesis TEXT,  -- "Si on ajoute preuve sociale au-dessus de la ligne de flottaison, alors conversion +15%"
    
    -- Psychology basis
    psychology_principle_applied VARCHAR(50),  -- 'social_proof', 'scarcity', 'authority'
    expected_behavior_change TEXT,
    
    -- Variants
    control_variant JSONB,   -- Version actuelle
    treatment_variant JSONB, -- Version testée
    
    -- Traffic allocation
    traffic_split DECIMAL(3,2) DEFAULT 0.50,  -- 50/50
    min_sample_size INTEGER,   -- Calculé pour significance statistique
    min_confidence_level DECIMAL(3,2) DEFAULT 0.95,  -- 95%
    
    -- Results
    status VARCHAR(20) DEFAULT 'running',  -- 'running', 'winner_found', 'inconclusive', 'stopped'
    winner_variant VARCHAR(10),  -- 'control' ou 'treatment'
    uplift_percentage DECIMAL(5,2),  -- +15.5%
    p_value DECIMAL(6,5),
    
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 6. CUSTOMER_PSYCHOLOGY_PROFILES (Profils psychologiques clients)
-- ============================================================

CREATE TABLE customer_psychology_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_email VARCHAR(255) NOT NULL,
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    -- Profil psychologique déduit du comportement
    dominant_bias VARCHAR(50),  -- 'loss_aversion', 'social_proof', 'scarcity', 'authority'
    decision_style VARCHAR(50),  -- 'analytical', 'emotional', 'impulsive', 'hesitant'
    price_sensitivity VARCHAR(20),  -- 'low', 'medium', 'high'
    social_influence_susceptibility VARCHAR(20),  -- 'low', 'medium', 'high'
    
    -- Behavior tracking
    pages_viewed JSONB,        -- Historique navigation
    cta_clicks JSONB,          -- Quels boutons cliqués
    time_to_purchase_hours INTEGER,  -- Décision rapide ou lente ?
    abandoned_carts_count INTEGER,
    
    -- Personalized strategy
    recommended_approach JSONB,  -- {"psychology_trigger": "scarcity", "messaging_tone": "urgent"}
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(customer_email, brand_id)
);