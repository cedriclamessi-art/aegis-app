-- ============================================================
-- AEGIS v12.1 — SCHEMA SQL : Agents Logistiques Fournisseurs
-- ============================================================

-- ============================================================
-- 1. LOGISTICS_AGENTS (Tes fournisseurs logistiques)
-- ============================================================

CREATE TABLE logistics_agents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Identité
    agent_name VARCHAR(255) NOT NULL,  -- 'Agent Logistique Alpha', 'LogiPro Sud'
    agent_code VARCHAR(50) UNIQUE NOT NULL,  -- 'AGT-001', 'LPS-MARSEILLE'
    
    -- Spécialisation
    primary_category VARCHAR(100),  -- 'electronics', 'fashion', 'home', 'beauty'
    secondary_categories TEXT[],    -- ['accessories', 'gadgets']
    
    -- Localisation (pour shipping time estimation)
    warehouse_location JSONB,  -- {"city": "Marseille", "country": "FR", "zip": "13001"}
    shipping_from_country VARCHAR(2) DEFAULT 'FR',
    
    -- Capacités
    max_daily_orders INTEGER,  -- Capacité de traitement
    average_preparation_hours INTEGER DEFAULT 24,  -- Délai pick/pack moyen
    
    -- Integration method
    integration_type VARCHAR(50) DEFAULT 'api',  -- 'api', 'ftp', 'email', 'manual'
    api_endpoint_url VARCHAR(255),
    api_auth_type VARCHAR(50),  -- 'bearer', 'basic', 'api_key'
    api_key_encrypted TEXT,
    ftp_host VARCHAR(255),
    ftp_username_encrypted TEXT,
    ftp_password_encrypted TEXT,
    
    -- Communication
    contact_email VARCHAR(255),
    contact_phone VARCHAR(50),
    emergency_contact VARCHAR(255),  -- Pour problèmes urgents
    
    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    reliability_score DECIMAL(3,2) DEFAULT 0.95,  -- 0-1 basé sur historique
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 2. BRAND_LOGISTICS_SETUP (Config par marche/fournisseur)
-- ============================================================

CREATE TABLE brand_logistics_setup (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    logistics_agent_id UUID NOT NULL REFERENCES logistics_agents(id),
    
    -- Mapping produits
    product_mapping JSONB DEFAULT '{}',  -- {"AEGIS-SKU-123": "AGENT-SKU-ABC", ...}
    
    -- Tarifs négociés (spécifiques à la marche)
    negotiated_cost_percent DECIMAL(5,2),  -- % du prix de vente (ex: 35%)
    fixed_shipping_cost DECIMAL(6,2),      -- ou frais fixe par colis
    free_shipping_threshold DECIMAL(8,2),  -- Livraison gratuite si > €X
    
    -- Options fulfillment
    packaging_type VARCHAR(50) DEFAULT 'standard',  -- 'standard', 'branded', 'premium'
    branded_insert_included BOOLEAN DEFAULT FALSE,  -- Insert marketing AEGIS
    custom_packaging_agreed BOOLEAN DEFAULT FALSE,  -- Packaging personnalisé négocié
    
    -- Activation
    is_primary_agent BOOLEAN DEFAULT FALSE,  -- Fournisseur principal de la marche
    is_active BOOLEAN DEFAULT TRUE,
    activated_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(brand_id, logistics_agent_id)
);

-- ============================================================
-- 3. LOGISTICS_ORDERS (Commandes envoyées aux agents)
-- ============================================================

CREATE TABLE logistics_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    brand_id UUID NOT NULL REFERENCES brands(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    brand_logistics_setup_id UUID REFERENCES brand_logistics_setup(id),
    logistics_agent_id UUID REFERENCES logistics_agents(id),
    
    -- Références agent
    agent_order_reference VARCHAR(255),  -- Numéro commande chez l'agent
    agent_batch_id VARCHAR(255),         -- Lot de traitement
    
    -- Statut (simplifié car moins de visibilité qu'entrepôt propre)
    status VARCHAR(50) DEFAULT 'sent',  -- 'sent', 'acknowledged', 'processing', 
                                       -- 'shipped', 'delivered', 'exception', 'cancelled'
    
    -- Détails commande (ce qui est envoyé à l'agent)
    items_sent JSONB,  -- [{"agent_sku": "...", "qty": 2, "aegis_sku": "..."}]
    shipping_address_sent JSONB,
    customer_email VARCHAR(255),
    
    -- Fulfillment (retour par agent)
    shipped_at TIMESTAMP,
    tracking_number VARCHAR(255),
    tracking_url TEXT,
    carrier_name VARCHAR(100),
    estimated_delivery_date DATE,
    
    delivered_at TIMESTAMP,
    delivery_confirmed BOOLEAN DEFAULT FALSE,
    
    -- Exception
    exception_type VARCHAR(50),  -- 'out_of_stock', 'address_error', 'damaged', 'delay'
    exception_details TEXT,
    resolution_status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'resolved', 'refunded'
    
    -- Coûts (pour calcul marge)
    cost_charged_by_agent DECIMAL(8,2),  -- Ce que l'agent facture
    shipping_charged DECIMAL(6,2),
    total_logistics_cost DECIMAL(8,2),
    
    -- Communication
    last_communication_at TIMESTAMP,
    communication_log JSONB DEFAULT '[]',  -- Historique emails/exports
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 4. LOGISTICS_INVENTORY_SYNC (Stock chez les agents)
-- ============================================================

CREATE TABLE logistics_inventory_sync (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    logistics_agent_id UUID NOT NULL REFERENCES logistics_agents(id),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    -- Produit
    aegis_product_id UUID REFERENCES products(id),
    agent_sku VARCHAR(255) NOT NULL,
    
    -- Stock (dernière synchro)
    quantity_available INTEGER DEFAULT 0,
    quantity_reserved INTEGER DEFAULT 0,  -- Pour commandes en cours
    last_agent_stock_update TIMESTAMP,     -- Quand l'agent a mis à jour
    
    -- Prix fournisseur (négocié)
    agent_cost_price DECIMAL(8,2),
    price_updated_at TIMESTAMP,
    
    -- Sync metadata
    sync_method VARCHAR(50),  -- 'api', 'ftp_csv', 'email_csv', 'manual'
    sync_file_url TEXT,       -- Si FTP/email, lien vers dernier fichier
    last_sync_at TIMESTAMP,
    sync_status VARCHAR(20) DEFAULT 'pending',  -- 'pending', 'synced', 'error'
    sync_error_message TEXT,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(logistics_agent_id, agent_sku)
);

-- ============================================================
-- 5. LOGISTICS_COMMUNICATION_LOG (Audit emails/exports)
-- ============================================================

CREATE TABLE logistics_communication_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    logistics_agent_id UUID REFERENCES logistics_agents(id),
    brand_id UUID REFERENCES brands(id),
    logistics_order_id UUID REFERENCES logistics_orders(id),
    
    communication_type VARCHAR(50) NOT NULL,  -- 'order_sent', 'stock_request', 
                                               -- 'tracking_received', 'exception_alert'
    
    direction VARCHAR(10) CHECK (direction IN ('to_agent', 'from_agent')),
    
    -- Contenu
    subject TEXT,
    body TEXT,
    attachment_urls TEXT[],
    file_format VARCHAR(20),  -- 'csv', 'xml', 'json', 'pdf'
    
    -- Métadonnées
    sent_at TIMESTAMP,
    received_at TIMESTAMP,
    processed_at TIMESTAMP,
    processing_result VARCHAR(20),  -- 'success', 'error', 'pending'
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX idx_logistics_orders_brand ON logistics_orders(brand_id);
CREATE INDEX idx_logistics_orders_status ON logistics_orders(status);
CREATE INDEX idx_logistics_orders_agent ON logistics_orders(logistics_agent_id);
CREATE INDEX idx_logistics_inventory_sync ON logistics_inventory_sync(logistics_agent_id, sync_status);
CREATE INDEX idx_logistics_communication ON logistics_communication_log(brand_id, communication_type);