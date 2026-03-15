-- ============================================================
-- AEGIS PLATFORM - SCHEMA SQL PRODUCTION v1.0
-- CTO: Architecture multi-tenant avec 149 agents
-- Stack: PostgreSQL 15+ | TimescaleDB | pgvector
-- ============================================================

-- Extensions nécessaires
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pgvector";
CREATE EXTENSION IF NOT EXISTS "timescaledb";

-- ============================================================
-- 1. ENUMS & TYPES PERSONNALISÉS
-- ============================================================

CREATE TYPE user_role AS ENUM ('super_admin', 'client_admin', 'client_user', 'agent_operator');
CREATE TYPE subscription_plan AS ENUM ('free', 'starter', 'growth', 'enterprise', 'empire');
CREATE TYPE agent_status AS ENUM ('initializing', 'active', 'paused', 'mutating', 'reproducing', 'terminated');
CREATE TYPE chromosome_type AS ENUM ('cognitive', 'execution', 'memory', 'security', 'creativity', 'resilience');
CREATE TYPE gene_category AS ENUM ('core', 'adaptive', 'evolutionary', 'specialized');
CREATE TYPE mutation_type AS ENUM ('point', 'insertion', 'deletion', 'crossover', 'epigenetic');
CREATE TYPE reproduction_mode AS ENUM ('asexual', 'sexual', 'hybrid');
CREATE TYPE task_priority AS ENUM ('critical', 'high', 'medium', 'low');
CREATE TYPE execution_status AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled', 'retrying');

-- ============================================================
-- 2. TABLE DES UTILISATEURS (Super Admin & Clients)
-- ============================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    clerk_id VARCHAR(255) UNIQUE NOT NULL, -- Intégration Clerk Auth
    
    -- Profil
    email VARCHAR(255) UNIQUE NOT NULL,
    full_name VARCHAR(255) NOT NULL,
    avatar_url TEXT,
    role user_role NOT NULL DEFAULT 'client_user',
    
    -- Organisation (multi-tenant)
    organization_id UUID,
    organization_name VARCHAR(255),
    is_organization_admin BOOLEAN DEFAULT FALSE,
    
    -- Plan & Quotas (Empire Index)
    plan subscription_plan NOT NULL DEFAULT 'free',
    empire_index DECIMAL(5,2) NOT NULL DEFAULT 0.00, -- Score 0-100
    empire_tier INTEGER NOT NULL DEFAULT 1, -- Niveau 1-10
    
    -- Quotas configurables
    quota_agents_max INTEGER NOT NULL DEFAULT 5,
    quota_tasks_per_hour INTEGER NOT NULL DEFAULT 100,
    quota_storage_gb INTEGER NOT NULL DEFAULT 10,
    quota_api_calls_monthly INTEGER NOT NULL DEFAULT 10000,
    
    -- Utilisation actuelle (calculée)
    current_agents_count INTEGER DEFAULT 0,
    current_storage_used_gb DECIMAL(10,2) DEFAULT 0.00,
    
    -- Métriques
    last_active_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    
    -- Sécurité & conformité
    mfa_enabled BOOLEAN DEFAULT FALSE,
    api_key_hash VARCHAR(255),
    vault_token VARCHAR(255), -- HashiCorp Vault
    
    -- Contraintes
    CONSTRAINT valid_empire_index CHECK (empire_index >= 0 AND empire_index <= 100),
    CONSTRAINT valid_empire_tier CHECK (empire_tier >= 1 AND empire_tier <= 10)
);

-- Index pour Clerk (authentification rapide)
CREATE INDEX idx_users_clerk_id ON users(clerk_id);
CREATE INDEX idx_users_organization ON users(organization_id);
CREATE INDEX idx_users_empire_index ON users(empire_index DESC);
CREATE INDEX idx_users_plan ON users(plan);

-- ============================================================
-- 3. TABLE AGENT DNA (AGen-L) - Coeur du système
-- ============================================================

CREATE TABLE agent_dna (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Identité
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    
    -- Relations
    owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id UUID REFERENCES agent_dna(id), -- Pour reproduction
    partner_id UUID REFERENCES agent_dna(id), -- Pour reproduction sexuée
    
    -- Status & Cycle de vie
    status agent_status NOT NULL DEFAULT 'initializing',
    generation INTEGER NOT NULL DEFAULT 1, -- Génération de l'agent
    
    -- Chromosomes (JSONB pour flexibilité génétique)
    chromosomes JSONB NOT NULL DEFAULT '{
        "cognitive": {"strength": 50, "genes": []},
        "execution": {"strength": 50, "genes": []},
        "memory": {"strength": 50, "genes": []},
        "security": {"strength": 50, "genes": []},
        "creativity": {"strength": 50, "genes": []},
        "resilience": {"strength": 50, "genes": []}
    }'::jsonb,
    
    -- Gènes spécifiques (table séparée pour requêtes complexes)
    total_genes_count INTEGER DEFAULT 0,
    active_genes_count INTEGER DEFAULT 0,
    mutation_count INTEGER DEFAULT 0,
    
    -- Capacités (vector pour recherche sémantique)
    capabilities_vector VECTOR(1536), -- Embeddings des capacités
    
    -- Méta-évolution
    fitness_score DECIMAL(5,2) DEFAULT 50.00, -- Score de fitness 0-100
    reproduction_eligible BOOLEAN DEFAULT FALSE,
    reproduction_mode reproduction_mode,
    
    -- Configuration runtime
    config JSONB DEFAULT '{}'::jsonb,
    secrets_encrypted TEXT, -- Chiffré via Vault
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    born_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_mutation_at TIMESTAMPTZ,
    last_reproduction_at TIMESTAMPTZ
);

-- Index pour recherche génétique
CREATE INDEX idx_agent_dna_owner ON agent_dna(owner_id);
CREATE INDEX idx_agent_dna_status ON agent_dna(status);
CREATE INDEX idx_agent_dna_generation ON agent_dna(generation);
CREATE INDEX idx_agent_dna_fitness ON agent_dna(fitness_score DESC);
CREATE INDEX idx_agent_dna_chromosomes ON agent_dna USING GIN(chromosomes);
CREATE INDEX idx_agent_dna_capabilities ON agent_dna USING ivfflat (capabilities_vector vector_cosine_ops);

-- ============================================================
-- 4. TABLE DES GÈNES (Détail génétique)
-- ============================================================

CREATE TABLE genes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agent_dna(id) ON DELETE CASCADE,
    
    -- Identification génétique
    gene_code VARCHAR(50) NOT NULL, -- Ex: "COG-001-EXEC"
    name VARCHAR(255) NOT NULL,
    category gene_category NOT NULL,
    chromosome chromosome_type NOT NULL,
    
    -- Valeurs génétiques (allèles)
    allele_a DECIMAL(5,2) NOT NULL DEFAULT 50.00, -- Valeur 0-100
    allele_b DECIMAL(5,2) NOT NULL DEFAULT 50.00,
    dominance VARCHAR(10) CHECK (dominance IN ('dominant', 'recessive', 'codominant')),
    
    -- Expression (phénotype)
    expression_level DECIMAL(5,2) NOT NULL DEFAULT 50.00, -- Calculé: moyenne pondérée
    is_active BOOLEAN DEFAULT TRUE,
    can_mutate BOOLEAN DEFAULT TRUE,
    
    -- Méta-données
    description TEXT,
    metadata JSONB DEFAULT '{}'::jsonb,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    mutated_at TIMESTAMPTZ,
    
    UNIQUE(agent_id, gene_code)
);

CREATE INDEX idx_genes_agent ON genes(agent_id);
CREATE INDEX idx_genes_category ON genes(category);
CREATE INDEX idx_genes_chromosome ON genes(chromosome);
CREATE INDEX idx_genes_active ON genes(is_active) WHERE is_active = TRUE;

-- ============================================================
-- 5. TABLE DES MUTATIONS (Historique évolutif)
-- ============================================================

CREATE TABLE mutations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agent_dna(id) ON DELETE CASCADE,
    gene_id UUID REFERENCES genes(id), -- Optionnel: gène spécifique
    
    mutation_type mutation_type NOT NULL,
    
    -- Détails de la mutation
    before_value JSONB NOT NULL,
    after_value JSONB NOT NULL,
    impact_score DECIMAL(5,2), -- Impact sur le fitness (-100 à +100)
    
    -- Contexte
    triggered_by VARCHAR(100), -- Ex: "environmental", "user_command", "auto_evolution"
    generation INTEGER NOT NULL,
    
    -- Validation
    is_beneficial BOOLEAN GENERATED ALWAYS AS (
        CASE WHEN impact_score > 0 THEN TRUE ELSE FALSE END
    ) STORED,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Partitionnement mensuel pour performance
CREATE TABLE mutations_y2024m01 PARTITION OF mutations
    FOR VALUES FROM ('2024-01-01') TO ('2024-02-01');
-- Créer dynamiquement les partitions suivantes...

CREATE INDEX idx_mutations_agent ON mutations(agent_id);
CREATE INDEX idx_mutations_type ON mutations(mutation_type);
CREATE INDEX idx_mutations_beneficial ON mutations(is_beneficial) WHERE is_beneficial = TRUE;

-- ============================================================
-- 6. TABLE DES REPRODUCTIONS (Lignée)
-- ============================================================

CREATE TABLE reproductions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Parents
    parent_a_id UUID NOT NULL REFERENCES agent_dna(id),
    parent_b_id UUID REFERENCES agent_dna(id), -- NULL si asexuée
    
    -- Enfant
    offspring_id UUID NOT NULL REFERENCES agent_dna(id),
    
    mode reproduction_mode NOT NULL,
    
    -- Génétique
    crossover_points JSONB, -- Points de croisement pour sexual
    mutation_rate DECIMAL(5,4) DEFAULT 0.01, -- Taux de mutation appliqué
    
    -- Succès
    success BOOLEAN NOT NULL DEFAULT TRUE,
    failure_reason TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_reproductions_parent_a ON reproductions(parent_a_id);
CREATE INDEX idx_reproductions_offspring ON reproductions(offspring_id);

-- ============================================================
-- 7. TABLE DES TÂCHES (Exécution des agents)
-- ============================================================

CREATE TABLE tasks (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Relations
    agent_id UUID NOT NULL REFERENCES agent_dna(id),
    user_id UUID NOT NULL REFERENCES users(id),
    
    -- Description
    title VARCHAR(500) NOT NULL,
    description TEXT,
    task_type VARCHAR(100) NOT NULL, -- Ex: "code_generation", "data_analysis"
    
    -- Priorisation
    priority task_priority NOT NULL DEFAULT 'medium',
    estimated_complexity INTEGER CHECK (estimated_complexity BETWEEN 1 AND 10),
    
    -- Status & Execution
    status execution_status NOT NULL DEFAULT 'pending',
    input_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    output_payload JSONB,
    error_log TEXT,
    
    -- Temporal.io integration
    temporal_workflow_id VARCHAR(255),
    temporal_run_id VARCHAR(255),
    
    -- Métriques
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ,
    duration_ms INTEGER, -- Calculé
    retry_count INTEGER DEFAULT 0,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

-- Hypertable pour TimescaleDB (si utilisé)
-- SELECT create_hypertable('tasks', 'created_at');

CREATE INDEX idx_tasks_agent ON tasks(agent_id);
CREATE INDEX idx_tasks_user ON tasks(user_id);
CREATE INDEX idx_tasks_status ON tasks(status);
CREATE INDEX idx_tasks_priority ON tasks(priority);
CREATE INDEX idx_tasks_temporal ON tasks(temporal_workflow_id);

-- ============================================================
-- 8. TABLE DES MÉTRIQUES & TÉLÉMÉTRIE
-- ============================================================

CREATE TABLE agent_metrics (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agent_dna(id) ON DELETE CASCADE,
    
    -- Métriques de performance
    cpu_usage_percent DECIMAL(5,2),
    memory_usage_mb INTEGER,
    tasks_completed INTEGER DEFAULT 0,
    tasks_failed INTEGER DEFAULT 0,
    average_response_time_ms INTEGER,
    
    -- Métriques évolutives
    mutations_applied INTEGER DEFAULT 0,
    reproductions_attempted INTEGER DEFAULT 0,
    reproductions_successful INTEGER DEFAULT 0,
    
    -- Time-series
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Convertir en hypertable pour time-series
SELECT create_hypertable('agent_metrics', 'recorded_at', chunk_time_interval => INTERVAL '1 hour');

CREATE INDEX idx_metrics_agent_time ON agent_metrics(agent_id, recorded_at DESC);

-- ============================================================
-- 9. TABLE DES COMPÉTENCES/SKILLS (Intégration GitHub Skills)
-- ============================================================

CREATE TABLE skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    -- Identification
    name VARCHAR(255) NOT NULL UNIQUE,
    slug VARCHAR(100) UNIQUE NOT NULL,
    description TEXT,
    
    -- Source
    source_url TEXT, -- URL GitHub du SKILL.md
    source_type VARCHAR(50) DEFAULT 'github', -- github, builtin, custom
    
    -- Versioning
    version VARCHAR(50) NOT NULL DEFAULT '1.0.0',
    checksum VARCHAR(64), -- SHA256 du contenu
    
    -- Contenu
    skill_definition JSONB NOT NULL, -- Structure parsée du SKILL.md
    code_template TEXT, -- Template Python généré
    
    -- Métadonnées
    author VARCHAR(255),
    tags TEXT[],
    capabilities_vector VECTOR(1536), -- Pour matching sémantique
    
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_skills_slug ON skills(slug);
CREATE INDEX idx_skills_active ON skills(is_active) WHERE is_active = TRUE;
CREATE INDEX idx_skills_capabilities ON skills USING ivfflat (capabilities_vector vector_cosine_ops);

-- Table de liaison Agent <-> Skills
CREATE TABLE agent_skills (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    agent_id UUID NOT NULL REFERENCES agent_dna(id) ON DELETE CASCADE,
    skill_id UUID NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
    
    -- Configuration spécifique à l'agent
    config_override JSONB DEFAULT '{}'::jsonb,
    proficiency_level DECIMAL(5,2) DEFAULT 50.00, -- 0-100
    
    acquired_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_used_at TIMESTAMPTZ,
    
    UNIQUE(agent_id, skill_id)
);

CREATE INDEX idx_agent_skills_agent ON agent_skills(agent_id);
CREATE INDEX idx_agent_skills_skill ON agent_skills(skill_id);

-- ============================================================
-- 10. TABLE DES ÉVÉNEMENTS SYSTÈME (Audit & Logs)
-- ============================================================

CREATE TABLE system_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    
    event_type VARCHAR(100) NOT NULL, -- agent_created, mutation_occurred, etc.
    severity VARCHAR(20) CHECK (severity IN ('debug', 'info', 'warning', 'error', 'critical')),
    
    -- Relations optionnelles
    user_id UUID REFERENCES users(id),
    agent_id UUID REFERENCES agent_dna(id),
    task_id UUID REFERENCES tasks(id),
    
    -- Contenu
    message TEXT NOT NULL,
    payload JSONB,
    ip_address INET,
    user_agent TEXT,
    
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
) PARTITION BY RANGE (created_at);

CREATE INDEX idx_events_type ON system_events(event_type);
CREATE INDEX idx_events_severity ON system_events(severity);
CREATE INDEX idx_events_created ON system_events(created_at DESC);
CREATE INDEX idx_events_agent ON system_events(agent_id) WHERE agent_id IS NOT NULL;

-- ============================================================
-- 11. FONCTIONS & TRIGGERS
-- ============================================================

-- Trigger pour updated_at automatique
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Appliquer à toutes les tables avec updated_at
CREATE TRIGGER update_users_updated_at BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_agent_dna_updated_at BEFORE UPDATE ON agent_dna
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_genes_updated_at BEFORE UPDATE ON genes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
    
CREATE TRIGGER update_tasks_updated_at BEFORE UPDATE ON tasks
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger pour calculer l'expression génique
CREATE OR REPLACE FUNCTION calculate_gene_expression()
RETURNS TRIGGER AS $$
BEGIN
    -- Calcul simple: moyenne des allèles avec dominance
    NEW.expression_level := CASE 
        WHEN NEW.dominance = 'dominant' THEN GREATEST(NEW.allele_a, NEW.allele_b)
        WHEN NEW.dominance = 'recessive' THEN LEAST(NEW.allele_a, NEW.allele_b)
        ELSE (NEW.allele_a + NEW.allele_b) / 2
    END;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calculate_expression
    BEFORE INSERT OR UPDATE ON genes
    FOR EACH ROW
    EXECUTE FUNCTION calculate_gene_expression();

-- Trigger pour mise à jour des compteurs d'agents
CREATE OR REPLACE FUNCTION update_user_agent_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users SET current_agents_count = current_agents_count + 1 WHERE id = NEW.owner_id;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE users SET current_agents_count = current_agents_count - 1 WHERE id = OLD.owner_id;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_agent_count
    AFTER INSERT OR DELETE ON agent_dna
    FOR EACH ROW
    EXECUTE FUNCTION update_user_agent_count();

-- ============================================================
-- 12. ROW LEVEL SECURITY (Multi-tenant avec Clerk)
-- ============================================================

ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_dna ENABLE ROW LEVEL SECURITY;
ALTER TABLE genes ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

-- Policy: Users peuvent voir leur propre profil
CREATE POLICY user_self_access ON users
    FOR ALL
    USING (clerk_id = current_setting('app.current_user_id', true));

-- Policy: Agents accessibles au owner ou admin org
CREATE POLICY agent_owner_access ON agent_dna
    FOR ALL
    USING (
        owner_id IN (
            SELECT id FROM users WHERE clerk_id = current_setting('app.current_user_id', true)
        ) OR
        owner_id IN (
            SELECT id FROM users WHERE organization_id = (
                SELECT organization_id FROM users 
                WHERE clerk_id = current_setting('app.current_user_id', true)
            ) AND is_organization_admin = true
        )
    );

-- Policy: Tâches accessibles au user ou ses agents
CREATE POLICY task_user_access ON tasks
    FOR ALL
    USING (
        user_id IN (
            SELECT id FROM users WHERE clerk_id = current_setting('app.current_user_id', true)
        ) OR
        agent_id IN (
            SELECT id FROM agent_dna WHERE owner_id IN (
                SELECT id FROM users WHERE clerk_id = current_setting('app.current_user_id', true)
            )
        )
    );

-- ============================================================
-- 13. VUES MATÉRIALISÉES (Analytics)
-- ============================================================

-- Vue: Empire Leaderboard
CREATE MATERIALIZED VIEW mv_empire_leaderboard AS
SELECT 
    u.id,
    u.full_name,
    u.organization_name,
    u.empire_index,
    u.empire_tier,
    u.plan,
    COUNT(DISTINCT a.id) as agent_count,
    AVG(a.fitness_score) as avg_fitness,
    COUNT(DISTINCT t.id) FILTER (WHERE t.status = 'completed') as tasks_completed
FROM users u
LEFT JOIN agent_dna a ON a.owner_id = u.id
LEFT JOIN tasks t ON t.agent_id = a.id AND t.created_at > NOW() - INTERVAL '30 days'
WHERE u.role != 'super_admin'
GROUP BY u.id, u.full_name, u.organization_name, u.empire_index, u.empire_tier, u.plan
ORDER BY u.empire_index DESC;

CREATE INDEX idx_mv_empire_leaderboard ON mv_empire_leaderboard(empire_index DESC);

-- Vue: Genetic Diversity par Organisation
CREATE MATERIALIZED VIEW mv_genetic_diversity AS
SELECT 
    u.organization_id,
    u.organization_name,
    COUNT(DISTINCT a.id) as total_agents,
    COUNT(DISTINCT g.gene_code) as unique_genes,
    AVG(a.mutation_count) as avg_mutations,
    AVG(a.fitness_score) as avg_fitness
FROM users u
JOIN agent_dna a ON a.owner_id = u.id
LEFT JOIN genes g ON g.agent_id = a.id
WHERE u.organization_id IS NOT NULL
GROUP BY u.organization_id, u.organization_name;

-- ============================================================
-- 14. DONNÉES INITIALES (Seeds)
-- ============================================================

-- Super Admin
INSERT INTO users (clerk_id, email, full_name, role, plan, empire_index, empire_tier, quota_agents_max)
VALUES 
('admin_clerk_id', 'admin@aegis-platform.com', 'AEGIS Super Admin', 'super_admin', 'empire', 100.00, 10, 9999);

-- Skills de base (exemples)
INSERT INTO skills (name, slug, description, skill_definition, tags) VALUES
('Code Generation', 'code-generation', 'Génère du code dans multiples langages', 
 '{"type": "code", "languages": ["python", "typescript", "rust"]}'::jsonb, 
 ARRAY['coding', 'development']),

('Data Analysis', 'data-analysis', 'Analyse et visualise des données',
 '{"type": "analytics", "formats": ["csv", "json", "sql"]}'::jsonb,
 ARRAY['data', 'analytics']),

('Security Audit', 'security-audit', 'Audit de sécurité automatique',
 '{"type": "security", "scope": ["dependencies", "code", "infrastructure"]}'::jsonb,
 ARRAY['security', 'audit']);

-- ============================================================
-- NOTES CTO
-- ============================================================
/*
1. PARTITIONNING: Les tables mutations, tasks et system_events sont partitionnées par mois
   pour gérer le volume à l'échelle. Automatiser la création des partitions futures.

2. BACKUP: Utiliser pg_dump quotidien + WAL archiving pour PITR (Point-in-Time Recovery).

3. SCALING: 
   - Read replicas pour les analytics (mv_*)
   - Connection pooling via PgBouncer
   - TimescaleDB pour les métriques time-series

4. SÉCURITÉ:
   - Tous les secrets sont chiffrés via HashiCorp Vault
   - RLS activé avec contexte Clerk (current_setting)
   - Colonnes sensibles (api_key_hash, vault_token) chiffrées au repos

5. ÉVOLUTION:
   - Les chromosomes JSONB permettent d'ajouter de nouveaux types sans migration
   - Les gènes sont normalisés pour les requêtes analytiques complexes
   - Les vectors pgvector permettent le matching sémantique agent/skills

6. INDEXING STRATÉGIE:
   - B-tree pour les relations et recherches exactes
   - GIN pour les JSONB et arrays
   - IVFFlat pour les vectors (similarité sémantique)
*/