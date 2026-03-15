-- ============================================================
-- AEGIS v12.3 — MODULES MANQUANTS INTÉGRÉS
-- Ajout de 22 agents depuis AEGIS actuel
-- ============================================================

-- ============================================================
-- 1. CEO_AGENT — Orchestration Stratégique Globale
-- ============================================================

CREATE TABLE ceo_agent_decisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    decision_type VARCHAR(100) NOT NULL,  -- 'strategy', 'resource_allocation', 'crisis_management'
    decision_context JSONB NOT NULL,  -- Contexte complet de la décision
    
    -- Inputs des autres agents
    input_agents UUID[],  -- Quels agents ont contribué
    input_data JSONB,  -- Synthèse des données reçues
    
    -- Décision CEO
    decision_rationale TEXT,  -- Explication de la décision
    decision_confidence DECIMAL(3,2),  -- 0.00-1.00
    expected_outcome JSONB,
    
    -- Exécution
    assigned_agents UUID[],  -- Quels agents exécutent
    execution_plan JSONB,  -- Plan d'action détaillé
    
    -- Résultat
    actual_outcome JSONB,
    outcome_vs_expected JSONB,  -- Analyse écart
    learning_logged BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    executed_at TIMESTAMP,
    evaluated_at TIMESTAMP
);

-- ============================================================
-- 2. BASE_INFRA — Infrastructure & Orchestration
-- ============================================================

CREATE TABLE base_infra_status (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    -- Système
    system_component VARCHAR(100) NOT NULL,  -- 'orchestrator', 'memory', 'security', 'queue', 'cache'
    status VARCHAR(20) DEFAULT 'healthy',  -- 'healthy', 'degraded', 'down'
    
    -- Métriques
    cpu_usage_percent DECIMAL(5,2),
    memory_usage_mb INTEGER,
    disk_usage_gb DECIMAL(8,2),
    network_latency_ms INTEGER,
    
    -- Agents actifs
    active_agents_count INTEGER,
    queued_tasks_count INTEGER,
    failed_tasks_count INTEGER,
    
    -- Alertes
    alerts JSONB DEFAULT '[]',
    
    checked_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE base_memory_store (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    memory_type VARCHAR(50) NOT NULL,  -- 'short_term', 'long_term', 'episodic', 'semantic'
    agent_id UUID REFERENCES agent_dna(id),
    
    -- Contenu mémoire
    memory_key VARCHAR(255),
    memory_value JSONB,
    memory_importance DECIMAL(3,2),  -- 0.00-1.00 (pour oubli sélectif)
    
    -- Contexte
    context_tags TEXT[],
    related_memories UUID[],
    
    created_at TIMESTAMP DEFAULT NOW(),
    last_accessed TIMESTAMP,
    expires_at TIMESTAMP  -- NULL = mémoire éternelle
);

CREATE TABLE base_security_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    event_type VARCHAR(100) NOT NULL,  -- 'auth_attempt', 'permission_change', 'data_access', 'anomaly'
    severity VARCHAR(20),  -- 'low', 'medium', 'high', 'critical'
    
    actor_id UUID REFERENCES users(id),
    target_resource VARCHAR(255),  -- Quelle ressource concernée
    
    action_taken TEXT,
    result VARCHAR(20),  -- 'success', 'failure', 'blocked'
    
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 3. DATA_ETL — Pipelines de Données
-- ============================================================

CREATE TABLE data_etl_pipelines (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    pipeline_name VARCHAR(255) NOT NULL,
    pipeline_type VARCHAR(50),  -- 'ingestion', 'transformation', 'enrichment', 'export'
    
    -- Source
    source_type VARCHAR(50),  -- 'api', 'database', 'file', 'webhook'
    source_config JSONB,  -- URL, credentials, etc.
    
    -- Transformation
    transformation_logic JSONB,  -- Steps de transformation
    
    -- Destination
    destination_type VARCHAR(50),
    destination_config JSONB,
    
    -- Scheduling
    schedule_cron VARCHAR(100),
    last_run_at TIMESTAMP,
    last_run_status VARCHAR(20),  -- 'success', 'failed', 'running'
    last_run_records_processed INTEGER,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE data_enrichment_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    entity_type VARCHAR(50) NOT NULL,  -- 'product', 'customer', 'order', 'campaign'
    entity_id UUID NOT NULL,
    
    -- Données brutes
    raw_data JSONB,
    
    -- Enrichissement
    enrichment_sources TEXT[],  -- 'clearbit', 'zerobounce', 'google_trends', etc.
    enriched_data JSONB,
    
    -- Qualité
    confidence_score DECIMAL(3,2),
    data_quality_flags TEXT[],
    
    processed_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 4. FINANCE — P&L, Budgets, Trésorerie
-- ============================================================

CREATE TABLE finance_pnl (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    period_start DATE NOT NULL,
    period_end DATE NOT NULL,
    period_type VARCHAR(20),  -- 'daily', 'weekly', 'monthly', 'quarterly'
    
    -- Revenus
    revenue_gross DECIMAL(12,2),
    revenue_net DECIMAL(12,2),
    refunds DECIMAL(12,2),
    
    -- Coûts
    cogs DECIMAL(12,2),  -- Cost of Goods Sold
    logistics_cost DECIMAL(12,2),
    ad_spend_total DECIMAL(12,2),
    platform_fees DECIMAL(12,2),
    payment_fees DECIMAL(12,2),
    
    -- Résultat
    gross_profit DECIMAL(12,2),
    gross_margin_percent DECIMAL(5,2),
    net_profit DECIMAL(12,2),
    net_margin_percent DECIMAL(5,2),
    
    -- Par canal
    channel_breakdown JSONB,  -- {"meta": 5000, "tiktok": 3000, "google": 2000}
    
    created_at TIMESTAMP DEFAULT NOW(),
    UNIQUE(brand_id, period_start, period_type)
);

CREATE TABLE finance_budgets (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    budget_type VARCHAR(50),  -- 'ad_spend', 'operations', 'logistics', 'total'
    budget_period VARCHAR(20),  -- 'daily', 'weekly', 'monthly'
    
    budget_allocated DECIMAL(12,2),
    budget_spent DECIMAL(12,2),
    budget_remaining DECIMAL(12,2),
    
    -- Auto-adjustment par AI
    ai_recommendation JSONB,  -- {"suggested_increase": 500, "reason": "ROAS > 4"}
    auto_adjust_enabled BOOLEAN DEFAULT FALSE,
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE finance_cashflow (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    transaction_date DATE NOT NULL,
    transaction_type VARCHAR(50),  -- 'income', 'expense', 'transfer'
    
    category VARCHAR(100),  -- 'sales', 'ad_spend', 'logistics', 'refund'
    amount DECIMAL(12,2),
    currency VARCHAR(3) DEFAULT 'EUR',
    
    description TEXT,
    related_order_id UUID REFERENCES orders(id),
    
    -- Prévisions
    is_forecast BOOLEAN DEFAULT FALSE,
    forecast_confidence DECIMAL(3,2),
    
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE finance_forecasts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    forecast_type VARCHAR(50),  -- 'revenue', 'profit', 'cashflow'
    forecast_period VARCHAR(20),  -- '7_days', '30_days', '90_days'
    
    forecast_data JSONB,  -- [{"date": "2026-03-20", "predicted": 1500, "confidence": 0.85}, ...]
    
    -- Modèle utilisé
    model_version VARCHAR(50),
    training_data_range JSONB,  -- {"from": "2026-01-01", "to": "2026-03-14"}
    
    accuracy_score DECIMAL(3,2),  -- Rétrospectif : quelle précision ?
    
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 5. GROWTH — Growth Hacking & Viralité
-- ============================================================

CREATE TABLE growth_virality_campaigns (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    campaign_type VARCHAR(50),  -- 'referral', 'viral_loop', 'contest', 'challenge'
    campaign_name VARCHAR(255),
    
    -- Mécanique
    trigger_event VARCHAR(100),  -- 'purchase', 'signup', 'share'
    reward_type VARCHAR(50),  -- 'discount', 'credit', 'free_product', 'feature'
    reward_value DECIMAL(10,2),
    
    -- Viral coefficients
    k_factor_target DECIMAL(4,2),  -- Objectif viralité (ex: 1.5 = chaque user en apporte 1.5)
    k_factor_actual DECIMAL(4,2),
    
    -- Performance
    participants_count INTEGER DEFAULT 0,
    invites_sent INTEGER DEFAULT 0,
    invites_converted INTEGER DEFAULT 0,
    viral_revenue_attributed DECIMAL(12,2),
    
    status VARCHAR(20) DEFAULT 'draft',
    started_at TIMESTAMP,
    ended_at TIMESTAMP,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE growth_partnerships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    partner_type VARCHAR(50),  -- 'influencer', 'affiliate', 'brand', 'complementary'
    partner_name VARCHAR(255),
    partner_contact JSONB,
    
    deal_structure JSONB,  -- {"type": "rev_share", "percentage": 15, "fixed_fee": 0}
    
    -- Performance
    leads_generated INTEGER DEFAULT 0,
    conversions INTEGER DEFAULT 0,
    revenue_generated DECIMAL(12,2),
    cost DECIMAL(12,2),
    roas DECIMAL(5,2),
    
    status VARCHAR(20) DEFAULT 'active',
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 6. ANALYTICS — Dashboards & KPIs
-- ============================================================

CREATE TABLE analytics_dashboards (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    dashboard_name VARCHAR(255),
    dashboard_type VARCHAR(50),  -- 'executive', 'marketing', 'product', 'finance'
    
    -- Configuration
    widgets JSONB,  -- [{"type": "kpi", "metric": "revenue", "time_range": "7d"}, ...]
    layout JSONB,  -- Positionnement widgets
    
    -- Partage
    shared_with UUID[],
    public_access BOOLEAN DEFAULT FALSE,
    public_url_token VARCHAR(255),
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE analytics_reports (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    report_name VARCHAR(255),
    report_type VARCHAR(50),  -- 'scheduled', 'ad_hoc', 'alert'
    
    -- Contenu
    metrics_included TEXT[],
    dimensions TEXT[],  -- ['channel', 'product', 'audience']
    filters JSONB,
    
    -- Scheduling
    frequency VARCHAR(20),  -- 'daily', 'weekly', 'monthly'
    last_generated_at TIMESTAMP,
    next_generation_at TIMESTAMP,
    
    -- Distribution
    recipients TEXT[],
    delivery_method VARCHAR(50),  -- 'email', 'slack', 'webhook'
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE analytics_alerts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    brand_id UUID NOT NULL REFERENCES brands(id),
    
    alert_name VARCHAR(255),
    alert_type VARCHAR(50),  -- 'threshold', 'anomaly', 'trend'
    
    -- Condition
    metric VARCHAR(100),  -- 'conversion_rate', 'roas', 'cpa'
    condition_operator VARCHAR(20),  -- '>', '<', '==', 'changed_by'
    threshold_value DECIMAL(10,2),
    
    -- Action
    notification_channels TEXT[],  -- ['email', 'slack', 'sms']
    auto_action JSONB,  -- {"type": "pause_campaign", "campaign_id": "..."}
    
    triggered_count INTEGER DEFAULT 0,
    last_triggered_at TIMESTAMP,
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- 7. KNOWLEDGE — Base de Connaissances
-- ============================================================

CREATE TABLE knowledge_base (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    
    knowledge_type VARCHAR(50),  -- 'best_practice', 'case_study', 'research', 'template'
    category VARCHAR(100),  -- 'facebook_ads', 'tiktok_strategy', 'pricing_psychology'
    
    title VARCHAR(500),
    content TEXT,
    content_summary TEXT,
    
    -- Métadonnées
    source VARCHAR(255),  -- URL, livre, étude
    credibility_score DECIMAL(3,2),
    last_verified_at TIMESTAMP,
    
    -- Utilisation
    usage_count INTEGER DEFAULT 0,
    last_used_by UUID REFERENCES agent_dna(id),
    
    tags TEXT[],
    related_knowledge UUID[],
    
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE knowledge_learning_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id UUID REFERENCES agent_dna(id),
    
    learning_type VARCHAR(50),  -- 'experiment_result', 'feedback', 'research'
    
    -- Ce qui a été appris
    hypothesis TEXT,
    experiment_data JSONB,
    result_data JSONB,
    conclusion TEXT,
    
    -- Application
    applied_to_campaigns UUID[],
    performance_impact JSONB,  -- {"metric": "ctr", "before": 0.02, "after": 0.035}
    
    -- Partage
    shared_with_agents UUID[],
    
    learned_at TIMESTAMP DEFAULT NOW()
);