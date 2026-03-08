-- ============================================================
-- MIGRATION 021 — RISQUES SYSTÉMIQUES NIVEAU 2-3
-- ============================================================
--
-- Les 3 tueurs des systèmes autonomes, neutralisés avant
-- qu'ils apparaissent :
--
-- RISQUE A — Agent Conflicts
--   Deux agents prennent des décisions contradictoires sur
--   la même entité (ex: META_TESTING scale une campagne
--   pendant que STOP_LOSS la pause). Sans arbitrage, le
--   système s'auto-sabote.
--
-- RISQUE B — Data Drift
--   Les patterns appris en Phase 1 (audience froide, petit
--   budget) ne sont plus valides en Phase 3 (audience chaude,
--   lookalike, millions de reach). Le système continue
--   d'appliquer des règles obsolètes = décisions incorrectes.
--
-- RISQUE C — Over-Optimization Collapse
--   Le système optimise si bien sur un signal qu'il crée
--   lui-même la condition qui le détruit. Exemples réels :
--   - ROAS parfait sur audience saturée → CPM explose
--   - CPA optimal sur même créatif 90j → fatigue totale
--   - Budget maximisé sur un seul canal → dépendance 100%
--   Ce risque est invisible jusqu'au collapse.
--
-- ============================================================

CREATE SCHEMA IF NOT EXISTS systemic;

-- ════════════════════════════════════════════════════════════
-- RISQUE A — AGENT CONFLICTS
-- ════════════════════════════════════════════════════════════

-- Table de locks par entité ads
-- Empêche deux agents d'agir sur la même entité simultanément
CREATE TABLE IF NOT EXISTS systemic.entity_locks (
    id                  BIGSERIAL       PRIMARY KEY,
    tenant_id           UUID            NOT NULL REFERENCES saas.tenants(id),
    entity_type         VARCHAR(20)     NOT NULL  -- 'ad' | 'adset' | 'campaign' | 'budget'
                          CHECK (entity_type IN ('ad','adset','campaign','budget','account')),
    entity_id           VARCHAR(100)    NOT NULL,
    locked_by_agent     VARCHAR(60)     NOT NULL,
    lock_intent         VARCHAR(30)     NOT NULL  -- 'pause'|'scale'|'budget_change'|'stop_loss'
                          CHECK (lock_intent IN (
                            'pause','resume','scale','budget_change',
                            'stop_loss','creative_test','audit'
                          )),
    lock_expires_at     TIMESTAMPTZ     NOT NULL,  -- TTL obligatoire — jamais de lock permanent
    acquired_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    released_at         TIMESTAMPTZ,
    conflict_detected   BOOLEAN         NOT NULL DEFAULT FALSE,
    conflict_detail     TEXT
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_entity_locks_unique
    ON systemic.entity_locks (tenant_id, entity_type, entity_id)
    WHERE released_at IS NULL AND lock_expires_at > NOW();

CREATE INDEX IF NOT EXISTS idx_entity_locks_tenant
    ON systemic.entity_locks (tenant_id, lock_expires_at);

ALTER TABLE systemic.entity_locks ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON systemic.entity_locks
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Table des conflits détectés (audit immuable)
CREATE TABLE IF NOT EXISTS systemic.conflict_log (
    id                  BIGSERIAL       PRIMARY KEY,
    tenant_id           UUID            NOT NULL REFERENCES saas.tenants(id),
    entity_type         VARCHAR(20)     NOT NULL,
    entity_id           VARCHAR(100)    NOT NULL,
    agent_winner        VARCHAR(60)     NOT NULL,  -- agent qui a obtenu le lock
    agent_loser         VARCHAR(60)     NOT NULL,  -- agent bloqué
    winner_intent       VARCHAR(30)     NOT NULL,
    loser_intent        VARCHAR(30)     NOT NULL,
    resolution          VARCHAR(20)     NOT NULL   -- 'priority_wins'|'deferred'|'escalated'
                          CHECK (resolution IN ('priority_wins','deferred','escalated')),
    escalated_to        VARCHAR(60),               -- AGENT_CEO si escalation
    detected_at         TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

ALTER TABLE systemic.conflict_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON systemic.conflict_log
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Priorités d'agents (qui gagne en cas de conflit)
-- Plus le chiffre est bas, plus la priorité est haute
CREATE TABLE IF NOT EXISTS systemic.agent_priorities (
    agent_id    VARCHAR(60)  PRIMARY KEY,
    priority    SMALLINT     NOT NULL,  -- 1=plus haute
    description TEXT
);

INSERT INTO systemic.agent_priorities VALUES
('AGENT_POLICY_GOVERNOR', 1, 'Veto absolu — bloque tout'),
('AGENT_STOP_LOSS',        2, 'Protection financière — prime sur scale'),
('AGENT_OPS_GUARD',        3, 'Gardien budget — prime sur optimisation'),
('AGENT_CEO',              4, 'Décision stratégique'),
('AGENT_ORCHESTRATOR',     5, 'Dispatch'),
('AGENT_META_TESTING',     6, 'Tests ads'),
('AGENT_CREATIVE_FACTORY', 7, 'Créatifs'),
('AGENT_LEARNING',         8, 'Apprentissage'),
('AGENT_GUARDRAILS',       9, 'Garde-fous systémiques')
ON CONFLICT (agent_id) DO NOTHING;

-- Fonction : tenter d'acquérir un lock
CREATE OR REPLACE FUNCTION systemic.acquire_entity_lock(
    p_tenant_id     UUID,
    p_entity_type   VARCHAR,
    p_entity_id     VARCHAR,
    p_agent_id      VARCHAR,
    p_intent        VARCHAR,
    p_ttl_seconds   INTEGER DEFAULT 300  -- 5 min par défaut
)
RETURNS TABLE (
    acquired        BOOLEAN,
    blocked_by      VARCHAR,
    blocked_intent  VARCHAR,
    resolution      VARCHAR
)
LANGUAGE plpgsql AS $$
DECLARE
    v_existing_agent    VARCHAR;
    v_existing_intent   VARCHAR;
    v_my_priority       SMALLINT;
    v_their_priority    SMALLINT;
    v_resolution        VARCHAR;
BEGIN
    -- Expire les locks anciens
    UPDATE systemic.entity_locks
    SET released_at = NOW()
    WHERE tenant_id       = p_tenant_id
      AND entity_type     = p_entity_type
      AND entity_id       = p_entity_id
      AND released_at     IS NULL
      AND lock_expires_at <= NOW();

    -- Cherche un lock actif
    SELECT locked_by_agent, lock_intent
    INTO v_existing_agent, v_existing_intent
    FROM systemic.entity_locks
    WHERE tenant_id       = p_tenant_id
      AND entity_type     = p_entity_type
      AND entity_id       = p_entity_id
      AND released_at     IS NULL
      AND lock_expires_at > NOW()
    LIMIT 1;

    IF v_existing_agent IS NULL THEN
        -- Pas de lock — on prend
        INSERT INTO systemic.entity_locks (
            tenant_id, entity_type, entity_id,
            locked_by_agent, lock_intent, lock_expires_at
        ) VALUES (
            p_tenant_id, p_entity_type, p_entity_id,
            p_agent_id, p_intent,
            NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
        );

        RETURN QUERY SELECT TRUE, NULL::VARCHAR, NULL::VARCHAR, 'acquired'::VARCHAR;
        RETURN;
    END IF;

    -- Conflit — arbitrage par priorité
    SELECT priority INTO v_my_priority
    FROM systemic.agent_priorities WHERE agent_id = p_agent_id;

    SELECT priority INTO v_their_priority
    FROM systemic.agent_priorities WHERE agent_id = v_existing_agent;

    v_my_priority    := COALESCE(v_my_priority, 99);
    v_their_priority := COALESCE(v_their_priority, 99);

    IF v_my_priority < v_their_priority THEN
        -- Je suis prioritaire — je prends le lock
        UPDATE systemic.entity_locks
        SET released_at = NOW(), conflict_detected = TRUE,
            conflict_detail = format('preempted by %s (priority %s > %s)',
                p_agent_id, v_their_priority, v_my_priority)
        WHERE tenant_id       = p_tenant_id
          AND entity_type     = p_entity_type
          AND entity_id       = p_entity_id
          AND locked_by_agent = v_existing_agent
          AND released_at IS NULL;

        INSERT INTO systemic.entity_locks (
            tenant_id, entity_type, entity_id,
            locked_by_agent, lock_intent, lock_expires_at
        ) VALUES (
            p_tenant_id, p_entity_type, p_entity_id,
            p_agent_id, p_intent,
            NOW() + (p_ttl_seconds || ' seconds')::INTERVAL
        );

        v_resolution := 'priority_wins';

        INSERT INTO systemic.conflict_log (
            tenant_id, entity_type, entity_id,
            agent_winner, agent_loser, winner_intent, loser_intent, resolution
        ) VALUES (
            p_tenant_id, p_entity_type, p_entity_id,
            p_agent_id, v_existing_agent, p_intent, v_existing_intent, v_resolution
        );

        RETURN QUERY SELECT TRUE, v_existing_agent, v_existing_intent, v_resolution;
    ELSE
        -- Priorité inférieure — je suis bloqué
        v_resolution := 'deferred';

        INSERT INTO systemic.conflict_log (
            tenant_id, entity_type, entity_id,
            agent_winner, agent_loser, winner_intent, loser_intent, resolution
        ) VALUES (
            p_tenant_id, p_entity_type, p_entity_id,
            v_existing_agent, p_agent_id, v_existing_intent, p_intent, v_resolution
        );

        RETURN QUERY SELECT FALSE, v_existing_agent, v_existing_intent, v_resolution;
    END IF;
END;
$$;

-- Fonction : libérer un lock
CREATE OR REPLACE FUNCTION systemic.release_entity_lock(
    p_tenant_id UUID,
    p_entity_id VARCHAR,
    p_agent_id  VARCHAR
)
RETURNS BOOLEAN LANGUAGE plpgsql AS $$
BEGIN
    UPDATE systemic.entity_locks
    SET released_at = NOW()
    WHERE tenant_id       = p_tenant_id
      AND entity_id       = p_entity_id
      AND locked_by_agent = p_agent_id
      AND released_at     IS NULL;

    RETURN FOUND;
END;
$$;


-- ════════════════════════════════════════════════════════════
-- RISQUE B — DATA DRIFT
-- ════════════════════════════════════════════════════════════
--
-- Détecteur de dérive des patterns.
-- Chaque pattern a une "fenêtre de validité" définie par
-- le contexte dans lequel il a été appris (budget, phase,
-- audience taille). Il est invalidé automatiquement quand
-- le contexte change significativement.

CREATE TABLE IF NOT EXISTS systemic.pattern_validity (
    id                      BIGSERIAL       PRIMARY KEY,
    tenant_id               UUID            REFERENCES saas.tenants(id),
    pattern_id              BIGINT          NOT NULL,  -- ref intel.patterns
    -- Contexte d'apprentissage (snapshot au moment de la création)
    learned_at_budget_eur   NUMERIC,        -- budget mensuel moyen quand appris
    learned_at_phase        SMALLINT,       -- phase 1|2|3
    learned_at_empire_index NUMERIC,        -- empire_index quand appris
    learned_at_audience_size BIGINT,        -- reach estimé audience quand appris
    -- État courant
    is_valid                BOOLEAN         NOT NULL DEFAULT TRUE,
    invalidated_at          TIMESTAMPTZ,
    invalidation_reason     VARCHAR(60)
                              CHECK (invalidation_reason IN (
                                'budget_drift',       -- budget 3x+ vs contexte apprentissage
                                'phase_change',       -- changement de phase
                                'empire_collapse',    -- empire_index chute >30pts
                                'audience_exhaustion',-- reach <20% de la taille initiale
                                'time_decay',         -- > 90 jours sans révalidation
                                'manual'
                              )),
    revalidated_at          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_pattern_validity_tenant
    ON systemic.pattern_validity (tenant_id, is_valid, pattern_id);

ALTER TABLE systemic.pattern_validity ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON systemic.pattern_validity
    USING (tenant_id = current_setting('app.tenant_id')::UUID OR tenant_id IS NULL);

-- Fonction : détecter la dérive d'un pattern
CREATE OR REPLACE FUNCTION systemic.check_pattern_drift(
    p_pattern_id            BIGINT,
    p_tenant_id             UUID,
    p_current_budget_eur    NUMERIC,
    p_current_phase         SMALLINT,
    p_current_empire_index  NUMERIC,
    p_current_audience_size BIGINT DEFAULT NULL
)
RETURNS TABLE (
    drifted             BOOLEAN,
    drift_type          VARCHAR,
    severity            VARCHAR,   -- 'minor'|'major'|'critical'
    recommendation      TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_pv            systemic.pattern_validity%ROWTYPE;
    v_drifted       BOOLEAN := FALSE;
    v_drift_type    VARCHAR;
    v_severity      VARCHAR := 'minor';
    v_rec           TEXT;
BEGIN
    SELECT * INTO v_pv
    FROM systemic.pattern_validity
    WHERE pattern_id = p_pattern_id
      AND (tenant_id = p_tenant_id OR tenant_id IS NULL)
      AND is_valid = TRUE
    ORDER BY created_at DESC
    LIMIT 1;

    IF NOT FOUND THEN
        RETURN QUERY SELECT FALSE, NULL::VARCHAR, 'minor'::VARCHAR,
            'Pattern non enregistré — créer une entrée validity'::TEXT;
        RETURN;
    END IF;

    -- Check 1 : Budget Drift (3x = major, 10x = critical)
    IF v_pv.learned_at_budget_eur IS NOT NULL
       AND p_current_budget_eur > v_pv.learned_at_budget_eur * 3 THEN
        v_drifted    := TRUE;
        v_drift_type := 'budget_drift';
        v_severity   := CASE
            WHEN p_current_budget_eur > v_pv.learned_at_budget_eur * 10 THEN 'critical'
            ELSE 'major'
        END;
        v_rec := format(
            'Budget actuel %.0f€ vs %.0f€ au moment de l''apprentissage (%.1fx). '
            'Re-valider le pattern sur le nouveau budget avant application.',
            p_current_budget_eur, v_pv.learned_at_budget_eur,
            p_current_budget_eur / v_pv.learned_at_budget_eur
        );
    END IF;

    -- Check 2 : Phase Change
    IF NOT v_drifted AND v_pv.learned_at_phase IS NOT NULL
       AND p_current_phase != v_pv.learned_at_phase THEN
        v_drifted    := TRUE;
        v_drift_type := 'phase_change';
        v_severity   := 'major';
        v_rec := format(
            'Pattern appris en Phase %s, appliqué en Phase %s. '
            'Les comportements d''audience changent avec la phase. Re-tester.',
            v_pv.learned_at_phase, p_current_phase
        );
    END IF;

    -- Check 3 : Empire Collapse (chute >30pts)
    IF NOT v_drifted AND v_pv.learned_at_empire_index IS NOT NULL
       AND p_current_empire_index < v_pv.learned_at_empire_index - 30 THEN
        v_drifted    := TRUE;
        v_drift_type := 'empire_collapse';
        v_severity   := 'critical';
        v_rec := format(
            'Empire Index : %.0f → %.0f (−%.0f pts). Contexte business radicalement différent. '
            'Pattern probablement invalide.',
            v_pv.learned_at_empire_index, p_current_empire_index,
            v_pv.learned_at_empire_index - p_current_empire_index
        );
    END IF;

    -- Check 4 : Audience Exhaustion
    IF NOT v_drifted AND v_pv.learned_at_audience_size IS NOT NULL
       AND p_current_audience_size IS NOT NULL
       AND p_current_audience_size < v_pv.learned_at_audience_size * 0.20 THEN
        v_drifted    := TRUE;
        v_drift_type := 'audience_exhaustion';
        v_severity   := 'critical';
        v_rec := format(
            'Audience réduite à %s (%.0f%% de l''audience initiale de %s). '
            'Saturation — le pattern ne s''applique plus.',
            p_current_audience_size,
            (p_current_audience_size::NUMERIC / v_pv.learned_at_audience_size) * 100,
            v_pv.learned_at_audience_size
        );
    END IF;

    -- Check 5 : Time Decay (>90j sans révalidation)
    IF NOT v_drifted
       AND v_pv.created_at < NOW() - INTERVAL '90 days'
       AND (v_pv.revalidated_at IS NULL
            OR v_pv.revalidated_at < NOW() - INTERVAL '90 days') THEN
        v_drifted    := TRUE;
        v_drift_type := 'time_decay';
        v_severity   := 'minor';
        v_rec := 'Pattern >90j sans révalidation. Confirmer qu''il est toujours pertinent.';
    END IF;

    -- Invalide si drift détecté (sauf minor — juste alerte)
    IF v_drifted AND v_severity IN ('major', 'critical') THEN
        UPDATE systemic.pattern_validity
        SET is_valid          = FALSE,
            invalidated_at    = NOW(),
            invalidation_reason = v_drift_type
        WHERE id = v_pv.id;
    END IF;

    RETURN QUERY SELECT v_drifted, v_drift_type, v_severity, v_rec;
END;
$$;

-- Vue : patterns valides par tenant (avec check drift automatique exclu ici —
-- le check se fait à l'appel de AGENT_LEARNING)
CREATE OR REPLACE VIEW systemic.valid_patterns AS
SELECT
    p.*,
    pv.is_valid,
    pv.learned_at_phase,
    pv.learned_at_budget_eur,
    pv.invalidation_reason
FROM intel.patterns p
LEFT JOIN systemic.pattern_validity pv
    ON pv.pattern_id = p.id
    AND (pv.tenant_id = p.tenant_id OR pv.tenant_id IS NULL)
WHERE p.quality_gate_passed = TRUE
  AND (pv.is_valid = TRUE OR pv.id IS NULL);


-- ════════════════════════════════════════════════════════════
-- RISQUE C — OVER-OPTIMIZATION COLLAPSE
-- ════════════════════════════════════════════════════════════
--
-- Détecteur d'optimisation excessive.
-- Surveille les 4 vecteurs de collapse :
--   1. Saturation audience  : CPM / freq explosion
--   2. Fatigue créative     : CTR en chute libre sur un même créatif
--   3. Concentration budget : dépendance sur une seule entité
--   4. ROAS-trap            : ROAS parfait mais CAC en hausse
--
-- Si 2+ vecteurs en état critique → COLLAPSE_RISK = HIGH
-- Le CEO et l'ORCHESTRATOR sont notifiés pour diversification forcée.

CREATE TABLE IF NOT EXISTS systemic.optimization_health (
    id                      BIGSERIAL       PRIMARY KEY,
    tenant_id               UUID            NOT NULL REFERENCES saas.tenants(id),

    -- Vecteur 1 : Saturation audience
    avg_cpm_7d              NUMERIC,
    avg_cpm_30d             NUMERIC,
    avg_frequency_7d        NUMERIC,
    audience_saturation     VARCHAR(10)     -- 'healthy'|'warning'|'critical'
                              CHECK (audience_saturation IN ('healthy','warning','critical')),

    -- Vecteur 2 : Fatigue créative
    top_creative_age_days   INTEGER,        -- âge du créatif #1 en jours
    top_creative_ctr_decay  NUMERIC,        -- % baisse CTR vs semaine 1
    creative_fatigue        VARCHAR(10)
                              CHECK (creative_fatigue IN ('healthy','warning','critical')),

    -- Vecteur 3 : Concentration budget
    top_entity_budget_pct   NUMERIC,        -- % budget sur entité #1
    budget_concentration    VARCHAR(10)
                              CHECK (budget_concentration IN ('healthy','warning','critical')),

    -- Vecteur 4 : ROAS Trap
    roas_7d                 NUMERIC,
    cac_7d                  NUMERIC,
    cac_30d                 NUMERIC,
    cac_trend               VARCHAR(10)     -- 'stable'|'rising'|'spike'
                              CHECK (cac_trend IN ('stable','rising','spike')),
    roas_trap               VARCHAR(10)
                              CHECK (roas_trap IN ('healthy','warning','critical')),

    -- Verdict global
    collapse_risk           VARCHAR(10)     NOT NULL DEFAULT 'low'
                              CHECK (collapse_risk IN ('low','medium','high','critical')),
    critical_vectors        TEXT[],         -- vecteurs en état critical
    recommended_action      TEXT,

    computed_at             TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_optim_health_tenant
    ON systemic.optimization_health (tenant_id, computed_at DESC);

ALTER TABLE systemic.optimization_health ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON systemic.optimization_health
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- Fonction principale : évaluer le risque de collapse
CREATE OR REPLACE FUNCTION systemic.evaluate_collapse_risk(
    p_tenant_id             UUID,
    -- Vecteur 1 : Audience
    p_avg_cpm_7d            NUMERIC,
    p_avg_cpm_30d           NUMERIC,
    p_avg_frequency_7d      NUMERIC,
    -- Vecteur 2 : Créatif
    p_top_creative_age_days INTEGER,
    p_top_creative_ctr_decay NUMERIC,   -- ex: 0.45 = -45% CTR
    -- Vecteur 3 : Budget
    p_top_entity_budget_pct NUMERIC,    -- ex: 0.85 = 85% sur une entité
    -- Vecteur 4 : ROAS Trap
    p_roas_7d               NUMERIC,
    p_cac_7d                NUMERIC,
    p_cac_30d               NUMERIC
)
RETURNS TABLE (
    collapse_risk       VARCHAR,
    critical_vectors    TEXT[],
    recommended_action  TEXT,
    auto_action_needed  BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
    v_sat   VARCHAR := 'healthy';
    v_fat   VARCHAR := 'healthy';
    v_conc  VARCHAR := 'healthy';
    v_trap  VARCHAR := 'healthy';

    v_critical  TEXT[] := '{}';
    v_risk      VARCHAR := 'low';
    v_action    TEXT;
    v_auto      BOOLEAN := FALSE;
    v_cpm_ratio NUMERIC;
    v_cac_ratio NUMERIC;
BEGIN
    -- ── Vecteur 1 : Saturation ──────────────────────────────
    v_cpm_ratio := CASE
        WHEN p_avg_cpm_30d > 0 THEN p_avg_cpm_7d / p_avg_cpm_30d
        ELSE 1
    END;

    v_sat := CASE
        WHEN v_cpm_ratio > 1.8 OR p_avg_frequency_7d > 5  THEN 'critical'
        WHEN v_cpm_ratio > 1.4 OR p_avg_frequency_7d > 3.5 THEN 'warning'
        ELSE 'healthy'
    END;

    IF v_sat = 'critical' THEN
        v_critical := ARRAY_APPEND(v_critical, format(
            'AUDIENCE_SATURATION: CPM x%.1f vs 30j, freq=%.1f',
            v_cpm_ratio, p_avg_frequency_7d
        ));
    END IF;

    -- ── Vecteur 2 : Créatif ─────────────────────────────────
    v_fat := CASE
        WHEN p_top_creative_age_days > 90 AND p_top_creative_ctr_decay > 0.60 THEN 'critical'
        WHEN p_top_creative_age_days > 60 AND p_top_creative_ctr_decay > 0.40 THEN 'warning'
        WHEN p_top_creative_age_days > 45 OR  p_top_creative_ctr_decay > 0.35 THEN 'warning'
        ELSE 'healthy'
    END;

    IF v_fat = 'critical' THEN
        v_critical := ARRAY_APPEND(v_critical, format(
            'CREATIVE_FATIGUE: créatif %sj, CTR -%.0f%%',
            p_top_creative_age_days, p_top_creative_ctr_decay * 100
        ));
    END IF;

    -- ── Vecteur 3 : Concentration ───────────────────────────
    v_conc := CASE
        WHEN p_top_entity_budget_pct > 0.80 THEN 'critical'
        WHEN p_top_entity_budget_pct > 0.65 THEN 'warning'
        ELSE 'healthy'
    END;

    IF v_conc = 'critical' THEN
        v_critical := ARRAY_APPEND(v_critical, format(
            'BUDGET_CONCENTRATION: %.0f%% budget sur une entité',
            p_top_entity_budget_pct * 100
        ));
    END IF;

    -- ── Vecteur 4 : ROAS Trap ──────────────────────────────
    -- ROAS bon MAIS CAC qui monte = piège
    v_cac_ratio := CASE
        WHEN p_cac_30d > 0 THEN p_cac_7d / p_cac_30d
        ELSE 1
    END;

    v_trap := CASE
        WHEN p_roas_7d > 2.5 AND v_cac_ratio > 1.5 THEN 'critical'  -- ROAS bon + CAC explose
        WHEN p_roas_7d > 2.0 AND v_cac_ratio > 1.25 THEN 'warning'
        ELSE 'healthy'
    END;

    IF v_trap = 'critical' THEN
        v_critical := ARRAY_APPEND(v_critical, format(
            'ROAS_TRAP: ROAS=%.1fx mais CAC +%.0f%% vs 30j',
            p_roas_7d, (v_cac_ratio - 1) * 100
        ));
    END IF;

    -- ── Verdict global ──────────────────────────────────────
    v_risk := CASE
        WHEN ARRAY_LENGTH(v_critical, 1) >= 3   THEN 'critical'
        WHEN ARRAY_LENGTH(v_critical, 1) = 2    THEN 'high'
        WHEN v_sat = 'warning' OR v_fat = 'warning'
          OR v_conc = 'warning' OR v_trap = 'warning' THEN 'medium'
        ELSE 'low'
    END;

    -- Action recommandée
    v_action := CASE v_risk
        WHEN 'critical' THEN
            'DIVERSIFICATION FORCÉE : renouveler 100% des créatifs + élargir audience '
            '+ redistribuer budget sur 3+ adsets. Décision CEO requise sous 24h.'
        WHEN 'high' THEN
            'RENOUVELLEMENT URGENT : lancer 3+ nouveaux créatifs + tester nouvelle audience '
            'lookalike élargie. Réduire le budget de l''entité dominante.'
        WHEN 'medium' THEN
            'SURVEILLANCE ACCRUE : créatif refresh programmé + monitoring CPM quotidien. '
            'Préparer tests audience si CPM continue de monter.'
        ELSE 'OK — système sain'
    END;

    -- Action automatique si critical (notifier CEO + bloquer scale)
    v_auto := (v_risk = 'critical');

    -- Persiste
    INSERT INTO systemic.optimization_health (
        tenant_id,
        avg_cpm_7d, avg_cpm_30d, avg_frequency_7d, audience_saturation,
        top_creative_age_days, top_creative_ctr_decay, creative_fatigue,
        top_entity_budget_pct, budget_concentration,
        roas_7d, cac_7d, cac_30d, roas_trap,
        collapse_risk, critical_vectors, recommended_action
    ) VALUES (
        p_tenant_id,
        p_avg_cpm_7d, p_avg_cpm_30d, p_avg_frequency_7d, v_sat,
        p_top_creative_age_days, p_top_creative_ctr_decay, v_fat,
        p_top_entity_budget_pct, v_conc,
        p_roas_7d, p_cac_7d, p_cac_30d, v_trap,
        v_risk, v_critical, v_action
    );

    -- Alerte si high/critical
    IF v_risk IN ('high','critical') THEN
        INSERT INTO ops.alerts (
            tenant_id, alert_type, severity, message, metadata
        ) VALUES (
            p_tenant_id,
            'OVER_OPTIMIZATION_COLLAPSE_RISK',
            CASE WHEN v_risk = 'critical' THEN 'critical' ELSE 'warning' END,
            format('Over-optimization détecté [%s]: %s',
                UPPER(v_risk), ARRAY_TO_STRING(v_critical, ' | ')),
            jsonb_build_object(
                'collapse_risk',     v_risk,
                'critical_vectors',  v_critical,
                'recommended_action', v_action
            )
        );
    END IF;

    RETURN QUERY SELECT v_risk, v_critical, v_action, v_auto;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- VUE DASHBOARD SYSTÉMIQUE — vue CEO pour les 3 risques
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW systemic.health_dashboard AS
SELECT
    t.id                        AS tenant_id,
    t.slug                      AS tenant_slug,

    -- Conflicts
    (SELECT COUNT(*) FROM systemic.conflict_log cl
     WHERE cl.tenant_id = t.id
       AND cl.detected_at > NOW() - INTERVAL '24h')
        AS conflicts_24h,

    -- Data Drift
    (SELECT COUNT(*) FROM systemic.pattern_validity pv
     WHERE pv.tenant_id = t.id AND pv.is_valid = FALSE
       AND pv.invalidated_at > NOW() - INTERVAL '7d')
        AS patterns_drifted_7d,

    (SELECT COUNT(*) FROM systemic.pattern_validity pv
     WHERE (pv.tenant_id = t.id OR pv.tenant_id IS NULL) AND pv.is_valid = TRUE)
        AS active_valid_patterns,

    -- Over-Optimization
    oh.collapse_risk,
    oh.critical_vectors,
    oh.recommended_action,
    oh.computed_at              AS collapse_risk_updated_at,

    -- Score global santé systémique 0-100
    GREATEST(0, 100
        - (SELECT COUNT(*) * 5 FROM systemic.conflict_log cl
           WHERE cl.tenant_id = t.id AND cl.detected_at > NOW() - INTERVAL '24h')
        - (SELECT COUNT(*) * 10 FROM systemic.pattern_validity pv
           WHERE pv.tenant_id = t.id AND NOT pv.is_valid
           AND pv.invalidated_at > NOW() - INTERVAL '7d')
        - CASE oh.collapse_risk
            WHEN 'critical' THEN 40
            WHEN 'high'     THEN 25
            WHEN 'medium'   THEN 10
            ELSE 0
          END
    )                           AS systemic_health_score

FROM saas.tenants t
LEFT JOIN LATERAL (
    SELECT collapse_risk, critical_vectors, recommended_action, computed_at
    FROM systemic.optimization_health
    WHERE tenant_id = t.id
    ORDER BY computed_at DESC
    LIMIT 1
) oh ON TRUE;

-- ════════════════════════════════════════════════════════════
-- INDEX PERFORMANCES
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_entity_locks_active
    ON systemic.entity_locks (tenant_id, entity_type, entity_id)
    WHERE released_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_conflict_log_recent
    ON systemic.conflict_log (tenant_id, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_pattern_validity_valid
    ON systemic.pattern_validity (tenant_id, is_valid, pattern_id)
    WHERE is_valid = TRUE;

CREATE INDEX IF NOT EXISTS idx_optim_health_recent
    ON systemic.optimization_health (tenant_id, collapse_risk, computed_at DESC);
