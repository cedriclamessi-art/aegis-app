-- ============================================================
-- AEGIS v12.0 — SCHEMA SQL CRITIQUE
-- Super Admin : jonathanlamessi@yahoo.fr | Enna.lamessi@gmail.com
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    
    -- SUPER ADMIN FLAGS (Immuable)
    is_super_admin BOOLEAN DEFAULT FALSE,
    is_lifetime_free BOOLEAN DEFAULT FALSE,
    
    -- CLIENT FLAGS (Si non super_admin)
    plan_type VARCHAR(50) CHECK (plan_type IN ('starter', 'pro', 'scale', 'empire')),
    agents_quota INTEGER DEFAULT 45,           -- Max agents utilisables
    empire_index_max INTEGER DEFAULT 40,       -- Score max atteignable
    monthly_spend_max DECIMAL(10,2),           -- Limite dépenses pub €
    
    -- MÉTRIQUES
    empire_index_current DECIMAL(5,2) DEFAULT 0.00,
    agents_active_count INTEGER DEFAULT 0,
    brands_created_count INTEGER DEFAULT 0,
    
    -- SÉCURITÉ
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    last_login TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    -- CONTRAINTES CRITIQUES
    CONSTRAINT admin_is_free CHECK (
        (is_super_admin = FALSE) OR 
        (is_super_admin = TRUE AND is_lifetime_free = TRUE)
    ),
    CONSTRAINT super_admin_emails CHECK (
        is_super_admin = FALSE OR 
        email IN ('jonathanlamessi@yahoo.fr', 'Enna.lamessi@gmail.com')
    )
);

-- Insertion Super Admins (Bootstrap)
INSERT INTO users (email, is_super_admin, is_lifetime_free, two_factor_enabled, agents_quota) 
VALUES 
    ('jonathanlamessi@yahoo.fr', TRUE, TRUE, TRUE, 9999),
    ('Enna.lamessi@gmail.com', TRUE, TRUE, TRUE, 9999);

CREATE TABLE agent_dna (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- IDENTITÉ
    agent_code VARCHAR(50) UNIQUE NOT NULL,     -- Ex: "HUNTER-1", "FLUX-SOURCE-Ali"
    name VARCHAR(255) NOT NULL,
    module VARCHAR(50) NOT NULL,                -- 'INTEL', 'FLUX', 'ADS'...
    
    -- GÉNÉTIQUE (JSONB pour flexibilité)
    chromosomes JSONB NOT NULL DEFAULT '{
        "mission": {"purpose": "", "success_metric": "", "termination_conditions": []},
        "perception": {"inputs": [], "sensitivity": 0.5, "filter_rules": []},
        "cognition": {"reasoning_type": "hybrid", "memory_depth": "long", "learning_rate": 0.1},
        "action": {"outputs": [], "autonomy_level": 0.7, "safety_limits": []},
        "reproduction": {"parent_ids": [], "mutation_rate": 0.05, "fitness_score": 0.5},
        "communication": {"protocol": "json", "emotion_expressive": false, "empathy_level": 0.3},
        "temporality": {"present_horizon": "24h", "past_depth": "90d", "future_projection": "30d"},
        "identity": {"signature_hash": "", "evolution_log": [], "death_date": null}
    }'::jsonb,
    
    -- RELATIONS
    owner_id UUID REFERENCES users(id),          -- NULL si agent système
    parent_ids UUID[],                           -- Références agent_dna (héritage)
    
    -- ÉTAT
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'evolving', 'archived')),
    generation INTEGER DEFAULT 1,
    fitness_score DECIMAL(5,2) DEFAULT 0.50,
    
    -- MÉTADONNÉES
    created_at TIMESTAMP DEFAULT NOW(),
    last_evolution TIMESTAMP,
    execution_count INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0.00,
    
    -- INDEXES
    CONSTRAINT valid_fitness CHECK (fitness_score >= 0 AND fitness_score <= 1)
);

CREATE INDEX idx_agent_dna_module ON agent_dna(module);
CREATE INDEX idx_agent_dna_status ON agent_dna(status);
CREATE INDEX idx_agent_dna_fitness ON agent_dna(fitness_score DESC);
CREATE INDEX idx_agent_dna_chromosomes ON agent_dna USING GIN(chromosomes);

CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    
    -- IDENTITÉ MARQUE
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    niche VARCHAR(100),                          -- Ex: "portable_blender"
    tagline VARCHAR(500),
    
    -- ASSETS GÉNÉRÉS
    logo_url TEXT,
    color_primary VARCHAR(7),
    color_secondary VARCHAR(7),
    font_primary VARCHAR(100),
    font_secondary VARCHAR(100),
    
    -- CONFIGURATION
    shopify_store_url TEXT,
    shopify_access_token_encrypted TEXT,
    
    -- MÉTRIQUES (Empire Index)
    revenue_total DECIMAL(12,2) DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    customers_count INTEGER DEFAULT 0,
    roas_average DECIMAL(5,2) DEFAULT 0,
    
    -- STATUS
    status VARCHAR(20) DEFAULT 'building' CHECK (status IN (
        'discovering', 'validating', 'building', 'launching', 
        'scaling', 'optimizing', 'mature', 'dormant'
    )),
    
    created_at TIMESTAMP DEFAULT NOW(),
    launched_at TIMESTAMP,
    last_activity TIMESTAMP
);

CREATE INDEX idx_brands_owner ON brands(owner_id);
CREATE INDEX idx_brands_status ON brands(status);
CREATE INDEX idx_brands_empire ON brands(revenue_total DESC);

CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    -- CONFIGURATION
    platform VARCHAR(50) NOT NULL,               -- 'meta', 'google', 'tiktok'
    objective VARCHAR(50),                       -- 'conversion', 'awareness', 'retention'
    budget_daily DECIMAL(10,2),
    budget_lifetime DECIMAL(12,2),
    
    -- CRÉATIFS (Références)
    creative_ids UUID[],                         -- Liens vers table creatives
    copy_variants JSONB,                         -- Textes publicitaires testés
    
    -- MÉTRIQUES TEMPS RÉEL
    spend_total DECIMAL(12,2) DEFAULT 0,
    impressions INTEGER DEFAULT 0,
    clicks INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue_attributed DECIMAL(12,2) DEFAULT 0,
    
    -- CALCULÉS
    ctr DECIMAL(5,4) GENERATED ALWAYS AS (
        CASE WHEN impressions > 0 THEN clicks::DECIMAL / impressions ELSE 0 END
    ) STORED,
    cpc DECIMAL(10,2) GENERATED ALWAYS AS (
        CASE WHEN clicks > 0 THEN spend_total / clicks ELSE 0 END
    ) STORED,
    roas DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN spend_total > 0 THEN revenue_attributed / spend_total ELSE 0 END
    ) STORED,
    
    -- AUTOMATISATION
    is_auto_optimized BOOLEAN DEFAULT TRUE,
    pulse_agent_id UUID REFERENCES agent_dna(id), -- Agent PULSE responsable
    
    status VARCHAR(20) DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT NOW(),
    started_at TIMESTAMP,
    ended_at TIMESTAMP
);

CREATE INDEX idx_campaigns_brand ON campaigns(brand_id);
CREATE INDEX idx_campaigns_platform ON campaigns(platform);
CREATE INDEX idx_campaigns_roas ON campaigns(roas DESC);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    -- SOURCING
    supplier_id VARCHAR(100),                    -- Référence fournisseur FLUX
    supplier_product_url TEXT,
    source_agent_id UUID REFERENCES agent_dna(id), -- Agent SOURCE qui a trouvé
    
    -- INFORMATIONS PRODUIT
    name VARCHAR(500) NOT NULL,
    description TEXT,
    description_ai_generated TEXT,               -- Version optimisée par GEN-Copy
    
    -- PRICING
    cost_price DECIMAL(10,2),                  -- Prix fournisseur
    selling_price DECIMAL(10,2),               -- Prix vente recommandé
    margin_percent DECIMAL(5,2) GENERATED ALWAYS AS (
        CASE WHEN cost_price > 0 THEN ((selling_price - cost_price) / selling_price) * 100 ELSE 0 END
    ) STORED,
    
    -- MÉDIAS
    images JSONB,                              -- URLs images fournisseur + générées
    video_ugc_ids UUID[],                        -- Liens vers vidéos UGC générées
    
    -- LOGISTIQUE
    weight_kg DECIMAL(6,3),
    dimensions_cm JSONB,                       -- {"l": 10, "w": 5, "h": 3}
    shipping_class VARCHAR(50),
    warehouse_location VARCHAR(50),            -- 'WH-EU', 'WH-US', etc.
    
    -- PERFORMANCE
    units_sold INTEGER DEFAULT 0,
    revenue_generated DECIMAL(12,2) DEFAULT 0,
    
    -- SCORING IA
    hunter_score INTEGER,                      -- 0-100 (potentiel gagnant)
    validation_status VARCHAR(20) DEFAULT 'pending', -- 'approved', 'rejected', 'testing'
    
    created_at TIMESTAMP DEFAULT NOW(),
    first_sale_at TIMESTAMP
);

CREATE INDEX idx_products_brand ON products(brand_id);
CREATE INDEX idx_products_hunter_score ON products(hunter_score DESC);
CREATE INDEX idx_products_validation ON products(validation_status);

CREATE TABLE system_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    event_type VARCHAR(100) NOT NULL,          -- 'agent_action', 'user_login', 'brand_created'
    severity VARCHAR(20) CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    
    -- RELATIONS
    user_id UUID REFERENCES users(id),
    agent_id UUID REFERENCES agent_dna(id),
    brand_id UUID REFERENCES brands(id),
    
    -- CONTENU
    message TEXT NOT NULL,
    payload JSONB,
    ip_address INET,
    
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Partitionnement mensuel pour performance
CREATE TABLE system_events_y2024m03 PARTITION OF system_events
    FOR VALUES FROM ('2024-03-01') TO ('2024-04-01');

CREATE INDEX idx_events_type ON system_events(event_type);
CREATE INDEX idx_events_severity ON system_events(severity);
CREATE INDEX idx_events_created ON system_events(created_at DESC);