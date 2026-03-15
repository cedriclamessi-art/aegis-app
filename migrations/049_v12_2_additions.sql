-- ============================================================
-- AEGIS v12.1 — SCHEMA SQL FINAL
-- 132 Agents + Intégration NEXUS
-- Super Admins : jonathanlamessi@yahoo.fr | Enna.lamessi@gmail.com
-- ============================================================

-- Extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================================
-- 1. USERS (Super Admins + Clients)
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    
    -- Super Admin (immutable)
    is_super_admin BOOLEAN DEFAULT FALSE,
    is_lifetime_free BOOLEAN DEFAULT FALSE,
    
    -- Client plans
    plan_type VARCHAR(50) CHECK (plan_type IN ('starter', 'pro', 'scale', 'empire')),
    agents_quota INTEGER DEFAULT 45,
    empire_index_max INTEGER DEFAULT 40,
    monthly_spend_max DECIMAL(10,2),
    
    -- Metrics
    empire_index_current DECIMAL(5,2) DEFAULT 0.00,
    agents_active_count INTEGER DEFAULT 0,
    brands_created_count INTEGER DEFAULT 0,
    
    -- Security
    two_factor_enabled BOOLEAN DEFAULT FALSE,
    clerk_id VARCHAR(255) UNIQUE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    last_login TIMESTAMP,
    
    -- Constraints
    CONSTRAINT admin_is_free CHECK (
        (is_super_admin = FALSE) OR 
        (is_super_admin = TRUE AND is_lifetime_free = TRUE)
    ),
    CONSTRAINT super_admin_emails CHECK (
        is_super_admin = FALSE OR 
        email IN ('jonathanlamessi@yahoo.fr', 'Enna.lamessi@gmail.com')
    )
);

-- Insert Super Admins
INSERT INTO users (email, is_super_admin, is_lifetime_free, two_factor_enabled, agents_quota) 
VALUES 
    ('jonathanlamessi@yahoo.fr', TRUE, TRUE, TRUE, 9999),
    ('Enna.lamessi@gmail.com', TRUE, TRUE, TRUE, 9999);

-- ============================================================
-- 2. AGENT DNA (AGen-L System)
-- ============================================================

CREATE TABLE agent_dna (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    agent_code VARCHAR(50) UNIQUE NOT NULL,  -- "HUNTER-1", "PULSE-C5"
    name VARCHAR(255) NOT NULL,
    module VARCHAR(50) NOT NULL,  -- 'INTEL', 'ADS', 'POST', etc.
    
    -- Genetic chromosomes (JSONB)
    chromosomes JSONB NOT NULL DEFAULT '{
        "mission": {"purpose": "", "success_metric": "", "termination": []},
        "perception": {"inputs": [], "sensitivity": 0.5, "filter": []},
        "cognition": {"reasoning": "hybrid", "memory": "long", "learning": 0.1},
        "action": {"outputs": [], "autonomy": 0.7, "safety": []},
        "reproduction": {"parents": [], "mutation_rate": 0.05, "fitness": 0.5},
        "communication": {"protocol": "json", "emotion": false, "empathy": 0.3},
        "temporality": {"present": "24h", "past": "90d", "future": "30d"},
        "identity": {"signature": "", "evolution_log": [], "death": null}
    }'::jsonb,
    
    owner_id UUID REFERENCES users(id),
    parent_ids UUID[],
    
    status VARCHAR(20) DEFAULT 'active' CHECK (status IN ('active', 'paused', 'evolving', 'archived')),
    generation INTEGER DEFAULT 1,
    fitness_score DECIMAL(5,2) DEFAULT 0.50,
    
    created_at TIMESTAMP DEFAULT NOW(),
    last_evolution TIMESTAMP,
    execution_count INTEGER DEFAULT 0,
    success_rate DECIMAL(5,2) DEFAULT 0.00
);

CREATE INDEX idx_agent_dna_module ON agent_dna(module);
CREATE INDEX idx_agent_dna_fitness ON agent_dna(fitness_score DESC);
CREATE INDEX idx_agent_dna_chromosomes ON agent_dna USING GIN(chromosomes);

-- ============================================================
-- 3. BRANDS (Marques créées)
-- ============================================================

CREATE TABLE brands (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id UUID NOT NULL REFERENCES users(id),
    
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    niche VARCHAR(100),
    tagline VARCHAR(500),
    
    -- Assets
    logo_url TEXT,
    color_primary VARCHAR(7),
    color_secondary VARCHAR(7),
    shopify_store_url TEXT,
    
    -- Empire Index metrics
    revenue_total DECIMAL(12,2) DEFAULT 0,
    orders_count INTEGER DEFAULT 0,
    customers_count INTEGER DEFAULT 0,
    roas_average DECIMAL(5,2) DEFAULT 0,
    
    status VARCHAR(20) DEFAULT 'building' CHECK (status IN (
        'discovering', 'validating', 'building', 'launching', 
        'scaling', 'optimizing', 'mature', 'dormant'
    )),
    
    created_at TIMESTAMP DEFAULT NOW(),
    launched_at TIMESTAMP
);

-- ============================================================
-- 4. NEXUS INTEGRATION (Votre Fournisseur)
-- ============================================================

CREATE TABLE nexus_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- API credentials (encrypted via Vault)
    api_key_encrypted TEXT NOT NULL,
    webhook_secret_encrypted TEXT,
    endpoint_base_url VARCHAR(255) NOT NULL,
    
    -- Fulfillment settings
    default_warehouse_id VARCHAR(100),
    default_shipping_method VARCHAR(50) DEFAULT 'standard',
    auto_fulfillment_enabled BOOLEAN DEFAULT TRUE,
    
    is_active BOOLEAN DEFAULT TRUE,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(brand_id)
);

CREATE TABLE nexus_products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    
    nexus_sku VARCHAR(255) NOT NULL,
    nexus_product_name VARCHAR(500),
    nexus_category_id VARCHAR(100),
    supplier_info JSONB,
    
    nexus_cost_price DECIMAL(10,2),
    nexus_shipping_cost DECIMAL(10,2),
    
    stock_quantity INTEGER DEFAULT 0,
    stock_status VARCHAR(20) DEFAULT 'in_stock',
    last_stock_update TIMESTAMP,
    
    sync_status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(brand_id, nexus_sku)
);

CREATE TABLE nexus_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    nexus_config_id UUID REFERENCES nexus_config(id),
    
    nexus_order_id VARCHAR(255),
    nexus_reference VARCHAR(255),
    
    status VARCHAR(50) DEFAULT 'pending',  -- pending, confirmed, picked, packed, shipped, delivered, exception
    
    tracking_number VARCHAR(255),
    tracking_url TEXT,
    carrier_name VARCHAR(100),
    
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    exception_type VARCHAR(50),
    exception_details JSONB,
    
    webhook_events JSONB DEFAULT '[]',
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE nexus_webhook_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id),
    event_type VARCHAR(50) NOT NULL,
    payload JSONB NOT NULL,
    signature_verified BOOLEAN,
    processing_result VARCHAR(20),
    received_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (received_at);

-- ============================================================
-- 5. CAMPAIGNS, PRODUCTS, ORDERS (Standard)
-- ============================================================

CREATE TABLE campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    platform VARCHAR(50) NOT NULL,  -- 'meta', 'google', 'tiktok'
    objective VARCHAR(50),
    budget_daily DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'draft',
    roas DECIMAL(5,2),
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    name VARCHAR(500) NOT NULL,
    description TEXT,
    selling_price DECIMAL(10,2),
    cost_price DECIMAL(10,2),
    stock_quantity INTEGER DEFAULT 0,
    hunter_score INTEGER,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    customer_email VARCHAR(255),
    total_amount DECIMAL(10,2),
    status VARCHAR(20) DEFAULT 'pending',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 6. SYSTEM EVENTS (Audit)
-- ============================================================

CREATE TABLE system_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_type VARCHAR(100) NOT NULL,
    severity VARCHAR(20) CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    user_id UUID REFERENCES users(id),
    agent_id UUID REFERENCES agent_dna(id),
    message TEXT NOT NULL,
    payload JSONB,
    created_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- ============================================================
-- 7. TRIGGERS & FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_nexus_products_updated BEFORE UPDATE ON nexus_products
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trigger_nexus_orders_updated BEFORE UPDATE ON nexus_orders
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Trigger: Update user agent count
CREATE OR REPLACE FUNCTION update_user_agent_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users SET agents_active_count = agents_active_count + 1 WHERE id = NEW.owner_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE users SET agents_active_count = agents_active_count - 1 WHERE id = OLD.owner_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_agent_count AFTER INSERT OR DELETE ON agent_dna
    FOR EACH ROW EXECUTE FUNCTION update_user_agent_count();