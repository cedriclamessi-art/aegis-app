-- ============================================================
-- AEGIS v12.1 — SCHEMA SQL : Intégration Entrepôt Propriétaire
-- Remplacement : NEXUS → WAREHOUSE
-- ============================================================

-- ============================================================
-- 1. WAREHOUSE_CONFIG (Configuration par marque)
-- ============================================================

CREATE TABLE warehouse_config (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    
    -- Identifiants API WMS (chiffrés Vault)
    wms_api_key_encrypted TEXT NOT NULL,
    wms_endpoint_url VARCHAR(255) NOT NULL,
    webhook_secret_encrypted TEXT,
    
    -- Localisation entrepôt
    warehouse_id VARCHAR(100) NOT NULL,  -- 'WH-PARIS', 'WH-MARSEILLE', 'WH-LILLE'
    warehouse_location JSONB,  -- {"city": "Paris", "country": "FR", "timezone": "Europe/Paris"}
    
    -- Paramètres fulfillment
    default_carrier VARCHAR(50) DEFAULT 'colissimo',  -- 'colissimo', 'dhl', 'ups', 'chronopost'
    available_carriers TEXT[] DEFAULT ARRAY['colissimo', 'chronopost'],
    default_shipping_method VARCHAR(50) DEFAULT 'standard',  -- 'standard', 'express', 'eco'
    
    -- Packaging AEGIS (généré par IA)
    packaging_type VARCHAR(50) DEFAULT 'branded',  -- 'standard', 'branded', 'premium', 'eco'
    packaging_design_id UUID,  -- Référence vers designs générés par GEN-PACK
    
    -- Options
    include_branded_insert BOOLEAN DEFAULT TRUE,  -- Insert marketing dans colis
    include_sample_products BOOLEAN DEFAULT FALSE,  -- Échantillons gratuits
    gift_wrapping_available BOOLEAN DEFAULT FALSE,
    
    is_active BOOLEAN DEFAULT TRUE,
    last_sync_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(brand_id, warehouse_id)
);

-- ============================================================
-- 2. WAREHOUSE_INVENTORY (Stock entrepôt)
-- ============================================================

CREATE TABLE warehouse_inventory (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    brand_id UUID NOT NULL REFERENCES brands(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id),
    warehouse_config_id UUID REFERENCES warehouse_config(id),
    
    -- SKU interne entrepôt
    warehouse_sku VARCHAR(255) NOT NULL,
    barcode VARCHAR(255),  -- EAN/UPC
    
    -- Localisation physique (dans l'entrepôt)
    location_code VARCHAR(50),  -- 'A-12-3' (allée-étagère-niveau)
    zone VARCHAR(50),  -- 'FAST-MOVERS', 'BULK', 'FRAGILE'
    
    -- Stock
    quantity_available INTEGER DEFAULT 0,  -- Disponible à la vente
    quantity_reserved INTEGER DEFAULT 0,   -- Réservé pour commandes en cours
    quantity_incoming INTEGER DEFAULT 0,   -- En réapprovisionnement
    reorder_point INTEGER DEFAULT 10,      -- Seuil alerte réappro
    
    -- Métriques mouvement
    last_movement_at TIMESTAMP,
    turnover_rate DECIMAL(5,2),  -- Rotation stock (calculé)
    
    updated_at TIMESTAMP DEFAULT NOW(),
    
    UNIQUE(warehouse_config_id, warehouse_sku)
);

-- ============================================================
-- 3. WAREHOUSE_ORDERS (Commandes envoyées à l'entrepôt)
-- ============================================================

CREATE TABLE warehouse_orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    brand_id UUID NOT NULL REFERENCES brands(id),
    order_id UUID NOT NULL REFERENCES orders(id),
    warehouse_config_id UUID REFERENCES warehouse_config(id),
    
    -- Références WMS
    wms_order_id VARCHAR(255),
    wms_batch_id VARCHAR(255),  -- Lot de picking
    
    -- Statut fulfillment (détaillé)
    status VARCHAR(50) DEFAULT 'pending',  -- 'pending', 'confirmed', 'picking', 
                                            -- 'picked', 'packed', 'shipped', 
                                            -- 'delivered', 'exception', 'returned'
    
    -- Pick & Pack
    picked_by VARCHAR(100),  -- Nom opérateur
    picked_at TIMESTAMP,
    packed_by VARCHAR(100),
    packed_at TIMESTAMP,
    
    -- Contrôle qualité
    qc_checked BOOLEAN DEFAULT FALSE,
    qc_passed BOOLEAN DEFAULT FALSE,
    qc_notes TEXT,
    
    -- Shipping
    carrier_name VARCHAR(100),
    tracking_number VARCHAR(255),
    tracking_url TEXT,
    shipping_label_url TEXT,  -- URL étiquette générée
    
    shipped_at TIMESTAMP,
    delivered_at TIMESTAMP,
    delivery_proof_url TEXT,  -- Photo signature si disponible
    
    -- Exception handling
    exception_type VARCHAR(50),  -- 'stockout', 'damaged', 'address_error', 'refused'
    exception_details JSONB,
    resolution_status VARCHAR(50),  -- 'pending', 'resolved', 'escalated'
    
    -- Webhook log
    webhook_events JSONB DEFAULT '[]',
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 4. WAREHOUSE_SHIPMENTS (Expéditions détaillées)
-- ============================================================

CREATE TABLE warehouse_shipments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_order_id UUID NOT NULL REFERENCES warehouse_orders(id),
    
    -- Colis
    parcel_count INTEGER DEFAULT 1,
    total_weight_kg DECIMAL(6,3),
    dimensions_cm JSONB,  -- {"l": 30, "w": 20, "h": 15}
    
    -- Coûts (pour analytics)
    shipping_cost DECIMAL(8,2),
    packaging_cost DECIMAL(6,2),
    total_fulfillment_cost DECIMAL(8,2),
    
    -- Carbon footprint (si calculé)
    carbon_kg DECIMAL(6,3),
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 5. WAREHOUSE_WEBHOOK_LOG (Audit)
-- ============================================================

CREATE TABLE warehouse_webhook_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID REFERENCES brands(id),
    warehouse_config_id UUID REFERENCES warehouse_config(id),
    
    event_type VARCHAR(50) NOT NULL,  -- 'order.confirmed', 'order.picked', 
                                        -- 'order.shipped', 'stock.updated'
    
    payload JSONB NOT NULL,
    signature_verified BOOLEAN,
    
    processed_at TIMESTAMP,
    processing_result VARCHAR(20),  -- 'success', 'error', 'ignored'
    error_message TEXT,
    
    received_at TIMESTAMP DEFAULT NOW()
) PARTITION BY RANGE (received_at);

-- ============================================================
-- 6. PICKING_LISTS (Listes de prélèvement)
-- ============================================================

CREATE TABLE picking_lists (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    warehouse_config_id UUID NOT NULL REFERENCES warehouse_config(id),
    
    batch_id VARCHAR(255) NOT NULL,  -- Lot de commandes à préparer
    status VARCHAR(20) DEFAULT 'open',  -- 'open', 'picking', 'completed'
    
    -- Commandes incluses
    order_ids UUID[],
    
    -- Optimisation picking (pathfinding dans entrepôt)
    optimized_route JSONB,  -- [{"location": "A-12-3", "sku": "...", "qty": 2}, ...]
    estimated_picking_time_min INTEGER,
    
    assigned_to VARCHAR(100),  -- Opérateur
    started_at TIMESTAMP,
    completed_at TIMESTAMP,
    
    created_at TIMESTAMP DEFAULT NOW()
);