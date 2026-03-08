-- ============================================================
-- MIGRATION 020 — GUARDRAILS STRUCTURELS PAR NIVEAU
-- ============================================================
--
-- Philosophie :
--   Les garde-fous existants (policy_governor, stop_loss, ops_guard)
--   sont RÉACTIFS — ils interviennent après l'erreur.
--
--   Cette migration ajoute 5 garde-fous STRUCTURELS :
--
--   GARDE-FOU 1 — Complexity Budget
--     Maximum 1 agent activé par semaine par tier.
--     Empêche l'activation simultanée de trop de nouveaux agents.
--
--   GARDE-FOU 2 — Circuit Breaker Empire Index
--     Si empire_index baisse 3 jours consécutifs → rétrogradation
--     automatique d'un tier de feature flags. Réactif sur tendance,
--     pas sur valeur instantanée.
--
--   GARDE-FOU 3 — Silence Window post-déploiement
--     Après chaque promotion d'agent : 48h shadow_only obligatoire.
--     Aucune décision autonome exécutée pendant cette fenêtre.
--
--   GARDE-FOU 4 — Data Quality Gate (cross-tenant learning)
--     Un pattern n'entre dans le pool partagé que si :
--       - ≥ 3 tenants différents
--       - ≥ 1 000€ spend total
--       - confidence_score ≥ 0.70
--     Contrainte SQL — contournable uniquement par migration.
--
--   GARDE-FOU 5 — Complexity Score visible
--     Score 1-10 calculé en temps réel. Bloque les nouvelles
--     activations quand il dépasse le seuil du tier.
--
-- NIVEAUX D'ACTIVATION :
--   LEVEL_1 (basic)        — GF1 + GF2 + GF3 toujours actifs
--   LEVEL_2 (hedge_fund)   — + GF4 (cross-tenant activé)
--   LEVEL_3 (full_organism)— + GF5 + Simulator threshold
--
-- RÈGLE MÉTA (immuable) :
--   POLICY_GOVERNOR ne peut pas modifier ses propres règles.
--   guardian.immutable_rules est en READ ONLY pour tous les agents.
-- ============================================================

-- ════════════════════════════════════════════════════════════
-- SCHÉMA
-- ════════════════════════════════════════════════════════════

CREATE SCHEMA IF NOT EXISTS guardian;

-- ════════════════════════════════════════════════════════════
-- 1. RÈGLES IMMUABLES — READ ONLY pour tous les agents
--    Seule une migration peut les modifier (pas de UPDATE possible
--    via l'application — RLS + permission REVOKE)
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guardian.immutable_rules (
    rule_id             VARCHAR(60)  PRIMARY KEY,
    level               SMALLINT     NOT NULL  -- 1=basic | 2=hedge_fund | 3=organism
                          CHECK (level IN (1, 2, 3)),
    category            VARCHAR(30)  NOT NULL
                          CHECK (category IN (
                            'complexity_budget',
                            'circuit_breaker',
                            'silence_window',
                            'data_quality_gate',
                            'complexity_score',
                            'meta'
                          )),
    description         TEXT         NOT NULL,
    -- Valeur numérique de la règle (ex: seuil, durée, max)
    threshold_value     NUMERIC,
    threshold_unit      VARCHAR(20),            -- 'hours' | 'days' | 'count' | 'eur' | 'score'
    -- Réponse automatique quand la règle se déclenche
    auto_action         VARCHAR(30)  NOT NULL
                          CHECK (auto_action IN (
                            'block',           -- bloque l'action
                            'downgrade_tier',  -- rétrograde le tier
                            'shadow_mode',     -- force shadow_only
                            'alert',           -- alerte seulement
                            'reject_pattern'   -- rejette le pattern learning
                          )),
    is_overridable      BOOLEAN      NOT NULL DEFAULT FALSE,
    -- Si TRUE : un humain peut override avec justification
    -- Si FALSE : strictement immuable même par AGENT_CEO
    created_at          TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- Aucun agent ne peut écrire dans cette table
-- (permission accordée uniquement au rôle migration)
REVOKE INSERT, UPDATE, DELETE ON guardian.immutable_rules FROM PUBLIC;

-- ────────────────────────────────────────────────────────────
-- SEED : les 5 garde-fous + règle méta
-- ────────────────────────────────────────────────────────────

INSERT INTO guardian.immutable_rules
  (rule_id, level, category, description, threshold_value, threshold_unit, auto_action, is_overridable)
VALUES

-- ── NIVEAU 1 — Toujours actifs ───────────────────────────────

('GF1_COMPLEXITY_MAX_AGENTS_PER_WEEK', 1, 'complexity_budget',
 'Maximum 1 agent promu en production par semaine calendar. '
 'Empêche l''activation simultanée de plusieurs agents nouveaux '
 'dont les interactions sont imprévisibles.',
 1, 'count', 'block', FALSE),

('GF2_CIRCUIT_BREAKER_EMPIRE_DECLINE', 1, 'circuit_breaker',
 'Si empire_index baisse 3 jours consécutifs ET descend sous 40, '
 'rétrogradation automatique d''un tier de feature flags. '
 'On ne scale pas un système instable.',
 3, 'days', 'downgrade_tier', FALSE),

('GF3_SILENCE_WINDOW_POST_DEPLOY', 1, 'silence_window',
 'Après chaque promotion d''agent en production : 48h shadow_only '
 'obligatoires. Aucune décision autonome exécutée. '
 'Permet de détecter les interactions imprévues entre agents.',
 48, 'hours', 'shadow_mode', FALSE),

-- ── NIVEAU 2 — Activé avec hedge_fund ───────────────────────

('GF4_DATA_QUALITY_MIN_TENANTS', 2, 'data_quality_gate',
 'Un pattern cross-tenant requiert au minimum 3 tenants sources '
 'différents avant d''entrer dans le pool partagé. '
 'Empêche la propagation de bruit d''un seul compte.',
 3, 'count', 'reject_pattern', FALSE),

('GF4_DATA_QUALITY_MIN_SPEND', 2, 'data_quality_gate',
 'Un pattern cross-tenant requiert au minimum 1000€ de spend '
 'total consolidé sur les tenants sources.',
 1000, 'eur', 'reject_pattern', FALSE),

('GF4_DATA_QUALITY_MIN_CONFIDENCE', 2, 'data_quality_gate',
 'Un pattern cross-tenant requiert un confidence_score ≥ 0.70 '
 '(calculé sur variance des résultats entre tenants). '
 'Pondération par niche + normalisation par budget.',
 0.70, 'score', 'reject_pattern', FALSE),

-- ── NIVEAU 3 — Activé avec full_organism ────────────────────

('GF5_COMPLEXITY_SCORE_MAX', 3, 'complexity_score',
 'Quand le complexity_score dépasse 7/10, aucune nouvelle '
 'activation d''agent n''est autorisée jusqu''à redescendre sous 6. '
 'Ce qui n''est pas mesuré n''est pas géré.',
 7, 'score', 'block', TRUE),
 -- is_overridable=TRUE : un humain peut forcer avec justification

('GF5_SIMULATOR_THRESHOLD_EUR', 3, 'complexity_score',
 'Le Strategic Simulator ne tourne que sur les décisions dont '
 'l''impact estimé dépasse ce seuil. En dessous : exécution directe. '
 'Empêche le simulator de devenir un bureaucracy engine.',
 500, 'eur', 'block', FALSE),

-- ── MÉTA — Immuable absolu ───────────────────────────────────

('META_GOVERNOR_CANNOT_SELF_MODIFY', 1, 'meta',
 'POLICY_GOVERNOR et guardian.immutable_rules ne peuvent pas être '
 'modifiés par un agent, même AGENT_CEO. '
 'Toute modification requiert une migration SQL manuelle. '
 'Séparation physique entre le système et ses contraintes.',
 NULL, NULL, 'block', FALSE);


-- ════════════════════════════════════════════════════════════
-- 2. COMPLEXITY BUDGET — Tracking des activations
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guardian.agent_promotions (
    id                  BIGSERIAL    PRIMARY KEY,
    tenant_id           UUID         NOT NULL REFERENCES saas.tenants(id),
    agent_id            VARCHAR(60)  NOT NULL,
    from_status         VARCHAR(20)  NOT NULL,  -- standby | shadow_only
    to_status           VARCHAR(20)  NOT NULL,  -- shadow_only | active
    promoted_by         VARCHAR(100) NOT NULL,  -- 'auto_threshold' | 'manual:user_id'
    week_number         INTEGER      NOT NULL,  -- EXTRACT(WEEK FROM NOW())
    year_number         INTEGER      NOT NULL,  -- EXTRACT(YEAR FROM NOW())
    silence_window_ends TIMESTAMPTZ  NOT NULL,  -- promoted_at + 48h
    silence_window_active BOOLEAN    NOT NULL DEFAULT TRUE,
    notes               TEXT,
    promoted_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_promotions_tenant_week
    ON guardian.agent_promotions (tenant_id, year_number, week_number);

CREATE INDEX IF NOT EXISTS idx_promotions_silence_window
    ON guardian.agent_promotions (tenant_id, silence_window_active)
    WHERE silence_window_active = TRUE;

-- ════════════════════════════════════════════════════════════
-- 3. CIRCUIT BREAKER — Historique Empire Index
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guardian.empire_trend (
    id                  BIGSERIAL    PRIMARY KEY,
    tenant_id           UUID         NOT NULL REFERENCES saas.tenants(id),
    empire_index        NUMERIC(6,2) NOT NULL,
    empire_mode         VARCHAR(20)  NOT NULL,
    consecutive_decline INTEGER      NOT NULL DEFAULT 0,
    -- Nombre de jours consécutifs en baisse
    circuit_breaker_triggered BOOLEAN NOT NULL DEFAULT FALSE,
    tier_before_downgrade VARCHAR(30),
    tier_after_downgrade  VARCHAR(30),
    recorded_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_empire_trend_tenant
    ON guardian.empire_trend (tenant_id, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- 4. DATA QUALITY GATE — Validation cross-tenant patterns
-- ════════════════════════════════════════════════════════════

-- Extension de intel.patterns pour les critères de qualité
ALTER TABLE intel.patterns
    ADD COLUMN IF NOT EXISTS source_tenant_count  INTEGER     DEFAULT 1,
    ADD COLUMN IF NOT EXISTS total_spend_eur      NUMERIC(12,2) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS confidence_score     NUMERIC(4,3) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS quality_gate_passed  BOOLEAN     DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS quality_checked_at   TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS quality_reject_reason TEXT;

-- Vue : patterns qui ont passé le quality gate (niveau 2+)
CREATE OR REPLACE VIEW guardian.validated_patterns AS
SELECT
    p.*,
    CASE
        WHEN p.source_tenant_count < 3    THEN 'FAIL: source_tenant_count < 3'
        WHEN p.total_spend_eur    < 1000  THEN 'FAIL: total_spend_eur < 1000'
        WHEN p.confidence_score   < 0.70  THEN 'FAIL: confidence_score < 0.70'
        ELSE 'PASS'
    END AS gate_status
FROM intel.patterns p
WHERE p.quality_gate_passed = TRUE
   OR p.tenant_id IS NOT NULL;  -- patterns locaux toujours valides

-- ════════════════════════════════════════════════════════════
-- 5. COMPLEXITY SCORE — Calcul temps réel
-- ════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS guardian.complexity_snapshots (
    id                  BIGSERIAL    PRIMARY KEY,
    tenant_id           UUID         NOT NULL REFERENCES saas.tenants(id),

    -- Composantes du score
    active_agents       INTEGER      NOT NULL DEFAULT 0,  -- /23 → 0-3 pts
    active_features     INTEGER      NOT NULL DEFAULT 0,  -- feature flags ON → 0-2 pts
    pending_silence     INTEGER      NOT NULL DEFAULT 0,  -- agents en silence window → 0-2 pts
    open_alerts         INTEGER      NOT NULL DEFAULT 0,  -- alertes non résolues → 0-2 pts
    simulator_active    BOOLEAN      NOT NULL DEFAULT FALSE, -- +1 pt si simulator ON

    -- Score final 1-10
    complexity_score    NUMERIC(4,2) NOT NULL,
    score_breakdown     JSONB        NOT NULL DEFAULT '{}',

    -- Dépassement seuil
    threshold_exceeded  BOOLEAN      NOT NULL DEFAULT FALSE,
    threshold_value     INTEGER      NOT NULL DEFAULT 7,
    action_taken        VARCHAR(30),  -- 'block_activations' | NULL

    computed_at         TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_complexity_tenant
    ON guardian.complexity_snapshots (tenant_id, computed_at DESC);

-- ════════════════════════════════════════════════════════════
-- 6. FONCTION : guardian.check_complexity_budget()
--    Vérifie GF1 : max 1 promotion/semaine
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION guardian.check_complexity_budget(
    p_tenant_id   UUID,
    p_agent_id    VARCHAR
)
RETURNS TABLE (
    allowed         BOOLEAN,
    reason          TEXT,
    current_count   INTEGER,
    max_allowed     INTEGER
)
LANGUAGE plpgsql AS $$
DECLARE
    v_week          INTEGER := EXTRACT(WEEK  FROM NOW())::INTEGER;
    v_year          INTEGER := EXTRACT(YEAR  FROM NOW())::INTEGER;
    v_count         INTEGER;
    v_max           INTEGER := 1;  -- GF1 : max 1 par semaine
BEGIN
    -- Compte les promotions cette semaine pour ce tenant
    SELECT COUNT(*) INTO v_count
    FROM guardian.agent_promotions
    WHERE tenant_id  = p_tenant_id
      AND week_number = v_week
      AND year_number = v_year
      AND to_status   = 'active';  -- seulement promotions full active

    IF v_count >= v_max THEN
        RETURN QUERY SELECT
            FALSE,
            format(
                'GF1 COMPLEXITY BUDGET: %s agent(s) déjà activé(s) cette semaine. '
                'Maximum: %s. Attendre la semaine prochaine.',
                v_count, v_max
            ),
            v_count,
            v_max;
    ELSE
        RETURN QUERY SELECT
            TRUE,
            format('OK — %s/%s activations cette semaine', v_count, v_max),
            v_count,
            v_max;
    END IF;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 7. FONCTION : guardian.check_silence_window()
--    Vérifie GF3 : 48h shadow obligatoire
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION guardian.check_silence_window(
    p_tenant_id UUID
)
RETURNS TABLE (
    in_silence_window   BOOLEAN,
    agents_in_silence   TEXT[],
    earliest_end        TIMESTAMPTZ,
    hours_remaining     NUMERIC
)
LANGUAGE plpgsql AS $$
DECLARE
    v_agents        TEXT[];
    v_earliest_end  TIMESTAMPTZ;
    v_hours_left    NUMERIC;
BEGIN
    SELECT
        ARRAY_AGG(agent_id),
        MIN(silence_window_ends)
    INTO v_agents, v_earliest_end
    FROM guardian.agent_promotions
    WHERE tenant_id            = p_tenant_id
      AND silence_window_active = TRUE
      AND silence_window_ends   > NOW();

    IF v_agents IS NULL THEN
        RETURN QUERY SELECT FALSE, '{}'::TEXT[], NULL::TIMESTAMPTZ, 0::NUMERIC;
        RETURN;
    END IF;

    v_hours_left := EXTRACT(EPOCH FROM (v_earliest_end - NOW())) / 3600;

    -- Désactiver automatiquement les fenêtres expirées
    UPDATE guardian.agent_promotions
    SET silence_window_active = FALSE
    WHERE tenant_id            = p_tenant_id
      AND silence_window_active = TRUE
      AND silence_window_ends   <= NOW();

    RETURN QUERY SELECT
        TRUE,
        v_agents,
        v_earliest_end,
        ROUND(v_hours_left::NUMERIC, 1);
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 8. FONCTION : guardian.validate_pattern_quality()
--    Vérifie GF4 : data quality gate
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION guardian.validate_pattern_quality(
    p_pattern_id          BIGINT,
    p_source_tenant_count INTEGER,
    p_total_spend_eur     NUMERIC,
    p_confidence_score    NUMERIC
)
RETURNS TABLE (
    passed          BOOLEAN,
    fail_reasons    TEXT[],
    gate_level      SMALLINT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_reasons TEXT[] := '{}';
    v_passed  BOOLEAN := TRUE;
BEGIN
    IF p_source_tenant_count < 3 THEN
        v_reasons := ARRAY_APPEND(v_reasons,
            format('source_tenant_count=%s < 3', p_source_tenant_count));
        v_passed := FALSE;
    END IF;

    IF p_total_spend_eur < 1000 THEN
        v_reasons := ARRAY_APPEND(v_reasons,
            format('total_spend_eur=%.2f < 1000€', p_total_spend_eur));
        v_passed := FALSE;
    END IF;

    IF p_confidence_score < 0.70 THEN
        v_reasons := ARRAY_APPEND(v_reasons,
            format('confidence_score=%.3f < 0.70', p_confidence_score));
        v_passed := FALSE;
    END IF;

    -- Persiste le résultat
    UPDATE intel.patterns
    SET
        source_tenant_count  = p_source_tenant_count,
        total_spend_eur      = p_total_spend_eur,
        confidence_score     = p_confidence_score,
        quality_gate_passed  = v_passed,
        quality_checked_at   = NOW(),
        quality_reject_reason = CASE
            WHEN v_passed THEN NULL
            ELSE ARRAY_TO_STRING(v_reasons, ' | ')
        END
    WHERE id = p_pattern_id;

    RETURN QUERY SELECT v_passed, v_reasons, 2::SMALLINT;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 9. FONCTION : guardian.compute_complexity_score()
--    Calcule le complexity score 1-10 (GF5)
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION guardian.compute_complexity_score(
    p_tenant_id UUID
)
RETURNS TABLE (
    complexity_score    NUMERIC,
    score_breakdown     JSONB,
    threshold_exceeded  BOOLEAN,
    action              TEXT
)
LANGUAGE plpgsql AS $$
DECLARE
    v_active_agents     INTEGER;
    v_active_features   INTEGER;
    v_pending_silence   INTEGER;
    v_open_alerts       INTEGER;
    v_simulator_active  BOOLEAN;
    v_tier              VARCHAR;

    -- Scores par composante (sum → 10)
    s_agents    NUMERIC := 0;  -- 0-3 pts  (agents actifs / 23 * 3)
    s_features  NUMERIC := 0;  -- 0-2 pts  (feature flags actifs)
    s_silence   NUMERIC := 0;  -- 0-2 pts  (agents en silence)
    s_alerts    NUMERIC := 0;  -- 0-2 pts  (alertes ouvertes)
    s_sim       NUMERIC := 0;  -- 0-1 pt   (simulator ON)

    v_total     NUMERIC;
    v_threshold INTEGER;
    v_exceeded  BOOLEAN;
BEGIN
    -- Active agents
    SELECT COUNT(*) INTO v_active_agents
    FROM agents.registry
    WHERE tenant_id = p_tenant_id AND status = 'active';

    -- Active feature flags
    SELECT COUNT(*) INTO v_active_features
    FROM saas.feature_flags
    WHERE tenant_id = p_tenant_id AND enabled = TRUE;

    -- Pending silence windows
    SELECT COUNT(*) INTO v_pending_silence
    FROM guardian.agent_promotions
    WHERE tenant_id = p_tenant_id AND silence_window_active = TRUE;

    -- Open alerts
    SELECT COUNT(*) INTO v_open_alerts
    FROM ops.alerts
    WHERE tenant_id = p_tenant_id AND resolved_at IS NULL;

    -- Tier courant
    SELECT current_plan INTO v_tier
    FROM saas.tenants WHERE id = p_tenant_id;

    -- Simulator actif (niveau 3 seulement)
    v_simulator_active := (v_tier = 'full_organism');

    -- Seuil par tier
    v_threshold := CASE v_tier
        WHEN 'basic'        THEN 6  -- plus conservateur
        WHEN 'hedge_fund'   THEN 7
        WHEN 'full_organism' THEN 8 -- plus de tolérance pour l'organism
        ELSE 6
    END;

    -- Calcul des scores
    s_agents   := LEAST(3, ROUND((v_active_agents::NUMERIC / 23.0) * 3, 2));
    s_features := LEAST(2, ROUND((v_active_features::NUMERIC / 10.0) * 2, 2));
    s_silence  := LEAST(2, v_pending_silence * 0.5);
    s_alerts   := LEAST(2, ROUND((v_open_alerts::NUMERIC / 5.0) * 2, 2));
    s_sim      := CASE WHEN v_simulator_active THEN 1 ELSE 0 END;

    v_total   := GREATEST(1, LEAST(10, ROUND(s_agents + s_features + s_silence + s_alerts + s_sim, 1)));
    v_exceeded := v_total > v_threshold;

    -- Persiste le snapshot
    INSERT INTO guardian.complexity_snapshots (
        tenant_id, active_agents, active_features, pending_silence,
        open_alerts, simulator_active, complexity_score,
        score_breakdown, threshold_exceeded, threshold_value,
        action_taken
    ) VALUES (
        p_tenant_id, v_active_agents, v_active_features, v_pending_silence,
        v_open_alerts, v_simulator_active, v_total,
        jsonb_build_object(
            'agents',   s_agents,
            'features', s_features,
            'silence',  s_silence,
            'alerts',   s_alerts,
            'simulator', s_sim,
            'threshold', v_threshold,
            'tier',      v_tier
        ),
        v_exceeded, v_threshold,
        CASE WHEN v_exceeded THEN 'block_activations' ELSE NULL END
    );

    RETURN QUERY SELECT
        v_total,
        jsonb_build_object(
            'agents',    jsonb_build_object('score', s_agents,   'value', v_active_agents),
            'features',  jsonb_build_object('score', s_features, 'value', v_active_features),
            'silence',   jsonb_build_object('score', s_silence,  'value', v_pending_silence),
            'alerts',    jsonb_build_object('score', s_alerts,   'value', v_open_alerts),
            'simulator', jsonb_build_object('score', s_sim,      'active', v_simulator_active),
            'threshold', v_threshold,
            'tier', v_tier
        ),
        v_exceeded,
        CASE WHEN v_exceeded
            THEN format(
                'GF5 COMPLEXITY SCORE: %.1f/%s — nouvelles activations bloquées '
                'jusqu''à score ≤ 6. Résoudre les alertes ou attendre fin des silence windows.',
                v_total, v_threshold)
            ELSE 'OK'
        END;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 10. FONCTION : guardian.check_circuit_breaker()
--     Vérifie GF2 : déclin Empire Index
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION guardian.check_circuit_breaker(
    p_tenant_id     UUID,
    p_empire_index  NUMERIC,
    p_empire_mode   VARCHAR
)
RETURNS TABLE (
    triggered           BOOLEAN,
    consecutive_decline INTEGER,
    action              TEXT,
    tier_before         VARCHAR,
    tier_after          VARCHAR
)
LANGUAGE plpgsql AS $$
DECLARE
    v_prev_index    NUMERIC;
    v_prev_decline  INTEGER;
    v_new_decline   INTEGER;
    v_current_tier  VARCHAR;
    v_new_tier      VARCHAR;
    v_triggered     BOOLEAN := FALSE;
BEGIN
    -- Récupère le dernier snapshot
    SELECT empire_index, consecutive_decline
    INTO v_prev_index, v_prev_decline
    FROM guardian.empire_trend
    WHERE tenant_id = p_tenant_id
    ORDER BY recorded_at DESC
    LIMIT 1;

    v_prev_decline := COALESCE(v_prev_decline, 0);

    -- Calcule le déclin consécutif
    IF v_prev_index IS NOT NULL AND p_empire_index < v_prev_index THEN
        v_new_decline := v_prev_decline + 1;
    ELSE
        v_new_decline := 0;  -- reset si pas en déclin
    END IF;

    -- Récupère le tier actuel
    SELECT current_plan INTO v_current_tier
    FROM saas.tenants WHERE id = p_tenant_id;

    -- GF2 : 3 jours consécutifs de déclin ET empire_index < 40
    IF v_new_decline >= 3 AND p_empire_index < 40 THEN
        v_triggered := TRUE;

        -- Rétrogradation d'un tier
        v_new_tier := CASE v_current_tier
            WHEN 'full_organism' THEN 'hedge_fund'
            WHEN 'hedge_fund'    THEN 'basic'
            WHEN 'basic'         THEN 'basic'  -- plancher
            ELSE v_current_tier
        END;

        IF v_new_tier != v_current_tier THEN
            -- Rétrogradation effective
            UPDATE saas.tenants
            SET current_plan = v_new_tier
            WHERE id = p_tenant_id;

            -- Désactiver les agents du tier supérieur
            UPDATE agents.registry
            SET status = 'standby',
                activation_reason = format(
                    'GF2_CIRCUIT_BREAKER: empire_index=%.1f après %s jours de déclin. '
                    'Rétrogradation %s → %s',
                    p_empire_index, v_new_decline,
                    v_current_tier, v_new_tier
                )
            WHERE tenant_id = p_tenant_id
              AND required_tier = v_current_tier;  -- agents du tier supérieur uniquement

            -- Log l'alerte
            INSERT INTO ops.alerts (
                tenant_id, alert_type, severity, message, metadata
            ) VALUES (
                p_tenant_id,
                'CIRCUIT_BREAKER_TRIGGERED',
                'critical',
                format('Empire Index en déclin depuis %s jours (%.1f). Tier: %s → %s',
                    v_new_decline, p_empire_index, v_current_tier, v_new_tier),
                jsonb_build_object(
                    'empire_index',        p_empire_index,
                    'consecutive_decline', v_new_decline,
                    'tier_before',         v_current_tier,
                    'tier_after',          v_new_tier
                )
            );
        END IF;
    ELSE
        v_new_tier := v_current_tier;
    END IF;

    -- Enregistre le snapshot
    INSERT INTO guardian.empire_trend (
        tenant_id, empire_index, empire_mode,
        consecutive_decline, circuit_breaker_triggered,
        tier_before_downgrade, tier_after_downgrade
    ) VALUES (
        p_tenant_id, p_empire_index, p_empire_mode,
        v_new_decline, v_triggered,
        CASE WHEN v_triggered THEN v_current_tier ELSE NULL END,
        CASE WHEN v_triggered THEN v_new_tier ELSE NULL END
    );

    RETURN QUERY SELECT
        v_triggered,
        v_new_decline,
        CASE WHEN v_triggered
            THEN format('CIRCUIT BREAKER: tier %s → %s', v_current_tier, v_new_tier)
            ELSE format('OK — déclin consécutif: %s/3', v_new_decline)
        END,
        v_current_tier,
        v_new_tier;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 11. FONCTION MAÎTRE : guardian.run_all_checks()
--     Point d'entrée unique — AGENT_GUARDRAILS l'appelle
--     à chaque décision significative
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION guardian.run_all_checks(
    p_tenant_id         UUID,
    p_action_type       VARCHAR,    -- 'agent_promotion' | 'pattern_share' | 'decision' | 'simulator'
    p_action_value_eur  NUMERIC DEFAULT 0,
    p_agent_id          VARCHAR DEFAULT NULL
)
RETURNS TABLE (
    all_clear           BOOLEAN,
    blocked_by          TEXT[],
    warnings            TEXT[],
    complexity_score    NUMERIC,
    active_guardrails   TEXT[]
)
LANGUAGE plpgsql AS $$
DECLARE
    v_blocks    TEXT[] := '{}';
    v_warnings  TEXT[] := '{}';
    v_active    TEXT[] := '{}';

    -- Tier du tenant
    v_tier      VARCHAR;
    v_tier_level SMALLINT;

    -- Résultats individuels
    r_budget    RECORD;
    r_silence   RECORD;
    r_complexity RECORD;
BEGIN
    -- Récupère le tier
    SELECT current_plan INTO v_tier FROM saas.tenants WHERE id = p_tenant_id;
    v_tier_level := CASE v_tier
        WHEN 'basic'         THEN 1
        WHEN 'hedge_fund'    THEN 2
        WHEN 'full_organism' THEN 3
        ELSE 1
    END;

    -- ── GF1 : Complexity Budget (niveau 1+) ─────────────────
    v_active := ARRAY_APPEND(v_active, 'GF1_COMPLEXITY_BUDGET');
    IF p_action_type = 'agent_promotion' THEN
        SELECT * INTO r_budget
        FROM guardian.check_complexity_budget(p_tenant_id, p_agent_id);

        IF NOT r_budget.allowed THEN
            v_blocks := ARRAY_APPEND(v_blocks, r_budget.reason);
        END IF;
    END IF;

    -- ── GF3 : Silence Window (niveau 1+) ────────────────────
    v_active := ARRAY_APPEND(v_active, 'GF3_SILENCE_WINDOW');
    IF p_action_type IN ('decision', 'agent_promotion') THEN
        SELECT * INTO r_silence
        FROM guardian.check_silence_window(p_tenant_id);

        IF r_silence.in_silence_window AND p_action_type = 'decision' THEN
            v_warnings := ARRAY_APPEND(v_warnings,
                format('GF3 SILENCE WINDOW: agents %s en observation. '
                       'Décisions en shadow_mode pour %.1fh.',
                       ARRAY_TO_STRING(r_silence.agents_in_silence, ', '),
                       r_silence.hours_remaining));
        END IF;
    END IF;

    -- ── GF5 : Complexity Score (niveau 3) ───────────────────
    IF v_tier_level >= 2 THEN
        v_active := ARRAY_APPEND(v_active, 'GF5_COMPLEXITY_SCORE');
        SELECT * INTO r_complexity
        FROM guardian.compute_complexity_score(p_tenant_id);

        IF r_complexity.threshold_exceeded AND p_action_type = 'agent_promotion' THEN
            v_blocks := ARRAY_APPEND(v_blocks, r_complexity.action);
        ELSIF r_complexity.threshold_exceeded THEN
            v_warnings := ARRAY_APPEND(v_warnings,
                format('GF5 COMPLEXITY: score %.1f — approche du seuil de blocage',
                    r_complexity.complexity_score));
        END IF;
    END IF;

    -- ── GF5 : Simulator Threshold (niveau 3) ─────────────────
    IF v_tier_level = 3 AND p_action_type = 'simulator' THEN
        v_active := ARRAY_APPEND(v_active, 'GF5_SIMULATOR_THRESHOLD');
        IF p_action_value_eur < 500 THEN
            v_blocks := ARRAY_APPEND(v_blocks,
                format('GF5 SIMULATOR: impact estimé %.2f€ < seuil 500€. '
                       'Exécution directe sans simulation.', p_action_value_eur));
        END IF;
    END IF;

    RETURN QUERY SELECT
        ARRAY_LENGTH(v_blocks, 1) IS NULL OR ARRAY_LENGTH(v_blocks, 1) = 0,
        v_blocks,
        v_warnings,
        COALESCE(r_complexity.complexity_score, 0),
        v_active;
END;
$$;

-- ════════════════════════════════════════════════════════════
-- 12. COLONNES MANQUANTES sur tables existantes
-- ════════════════════════════════════════════════════════════

-- agents.registry : tier requis pour activer cet agent
ALTER TABLE agents.registry
    ADD COLUMN IF NOT EXISTS required_tier VARCHAR(30)
        DEFAULT 'basic'
        CHECK (required_tier IN ('basic', 'hedge_fund', 'full_organism'));

-- saas.tenants : plan courant (si pas déjà présent)
ALTER TABLE saas.tenants
    ADD COLUMN IF NOT EXISTS current_plan VARCHAR(30)
        DEFAULT 'basic'
        CHECK (current_plan IN ('basic', 'hedge_fund', 'full_organism'));

-- ops.alerts : champs manquants pour le circuit breaker
ALTER TABLE ops.alerts
    ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS alert_type  VARCHAR(60),
    ADD COLUMN IF NOT EXISTS severity    VARCHAR(20)
        DEFAULT 'info'
        CHECK (severity IN ('info', 'warning', 'critical'));

-- ════════════════════════════════════════════════════════════
-- 13. RLS sur les nouvelles tables guardian
-- ════════════════════════════════════════════════════════════

ALTER TABLE guardian.agent_promotions     ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian.empire_trend         ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardian.complexity_snapshots ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guardian.agent_promotions
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY tenant_isolation ON guardian.empire_trend
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

CREATE POLICY tenant_isolation ON guardian.complexity_snapshots
    USING (tenant_id = current_setting('app.tenant_id')::UUID);

-- immutable_rules : lecture seule pour tous les rôles applicatifs
ALTER TABLE guardian.immutable_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY readonly_for_all ON guardian.immutable_rules
    FOR SELECT USING (TRUE);
-- (INSERT/UPDATE/DELETE déjà REVOKE'd ligne 77)

-- ════════════════════════════════════════════════════════════
-- 14. INDEX performances
-- ════════════════════════════════════════════════════════════

CREATE INDEX IF NOT EXISTS idx_patterns_quality
    ON intel.patterns (quality_gate_passed, confidence_score DESC)
    WHERE quality_gate_passed = TRUE;

CREATE INDEX IF NOT EXISTS idx_complexity_latest
    ON guardian.complexity_snapshots (tenant_id, computed_at DESC);

CREATE INDEX IF NOT EXISTS idx_empire_trend_decline
    ON guardian.empire_trend (tenant_id, consecutive_decline DESC, recorded_at DESC);

-- ════════════════════════════════════════════════════════════
-- 15. SEED : required_tier sur les agents existants
-- ════════════════════════════════════════════════════════════

-- Ces UPDATE s'appliquent si agents.registry est déjà seedé
-- (sinon le seed.ts s'en charge)

UPDATE agents.registry SET required_tier = 'basic' WHERE agent_id IN (
    'AGENT_ORCHESTRATOR', 'AGENT_POLICY_GOVERNOR', 'AGENT_OPS_GUARD',
    'AGENT_SCRAPING', 'AGENT_WINNER_DETECTOR', 'AGENT_STRATEGY_ORGANIC',
    'AGENT_GUARDRAILS'
);

UPDATE agents.registry SET required_tier = 'hedge_fund' WHERE agent_id IN (
    'AGENT_META_TESTING', 'AGENT_STOP_LOSS', 'AGENT_CREATIVE_FACTORY',
    'AGENT_SPY', 'AGENT_MARKET_INTEL', 'AGENT_INNOVATION'
);

UPDATE agents.registry SET required_tier = 'full_organism' WHERE agent_id IN (
    'AGENT_CEO', 'AGENT_UGC_FACTORY', 'AGENT_CAPI',
    'AGENT_LEARNING', 'AGENT_MONEY_MODEL'
);

-- ════════════════════════════════════════════════════════════
-- 16. SCHEDULING — AGENT_GUARDRAILS dans le scheduler
-- ════════════════════════════════════════════════════════════

-- Cron 15min : GF2 (circuit breaker) + GF5 (complexity score)
-- Déclenché pour chaque tenant actif
INSERT INTO agents.schedule (
    agent_id,
    task_type,
    schedule_type,
    cron_expr,
    priority,
    tenant_scope,
    conditions,
    payload_template,
    enabled
) VALUES (
    'AGENT_GUARDRAILS',
    'guardrails.cron_monitor',
    'cron',
    '*/15 * * * *',
    8,  -- haute priorité (avant les agents métier)
    'per_tenant',
    '{"requires_active": true}'::jsonb,
    '{}'::jsonb,
    TRUE
) ON CONFLICT (agent_id, task_type) DO NOTHING;


-- ════════════════════════════════════════════════════════════
-- 17. HOOK — Intercepte les promotions d'agents
--     Guardian doit être consulté AVANT ops.check_and_unlock_phases
-- ════════════════════════════════════════════════════════════

-- Trigger PostgreSQL : avant toute mise à jour de status agent
CREATE OR REPLACE FUNCTION guardian.before_agent_status_change()
RETURNS TRIGGER AS $$
BEGIN
    -- Si on essaie de passer en 'active'
    -- l'application DOIT avoir appelé guardrails.check_promotion avant
    -- Ce trigger log l'event — le blocage est dans l'agent lui-même
    IF NEW.status = 'active' AND OLD.status != 'active' THEN
        INSERT INTO guardian.agent_promotions (
            tenant_id, agent_id,
            from_status, to_status,
            promoted_by,
            week_number, year_number,
            silence_window_ends,
            silence_window_active
        )
        SELECT
            NEW.tenant_id,
            NEW.agent_id,
            OLD.status,
            NEW.status,
            COALESCE(NEW.activation_reason, 'direct_sql'),
            EXTRACT(WEEK FROM NOW())::INTEGER,
            EXTRACT(YEAR FROM NOW())::INTEGER,
            NOW() + INTERVAL '48 hours',
            TRUE
        WHERE NOT EXISTS (
            -- évite les doublons si l'agent a déjà enregistré la promotion
            SELECT 1 FROM guardian.agent_promotions
            WHERE tenant_id  = NEW.tenant_id
              AND agent_id   = NEW.agent_id
              AND promoted_at > NOW() - INTERVAL '1 minute'
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_agent_promotion_guard
    BEFORE UPDATE OF status ON agents.registry
    FOR EACH ROW
    EXECUTE FUNCTION guardian.before_agent_status_change();


-- ════════════════════════════════════════════════════════════
-- 18. VUE DASHBOARD — guardian.status_dashboard
--     Résumé temps réel de tous les garde-fous pour le CEO
-- ════════════════════════════════════════════════════════════

CREATE OR REPLACE VIEW guardian.status_dashboard AS
SELECT
    t.id                        AS tenant_id,
    t.current_plan              AS tier,

    -- GF1 : Complexity Budget
    COALESCE((
        SELECT COUNT(*)
        FROM guardian.agent_promotions ap
        WHERE ap.tenant_id   = t.id
          AND ap.year_number  = EXTRACT(YEAR  FROM NOW())::INTEGER
          AND ap.week_number  = EXTRACT(WEEK  FROM NOW())::INTEGER
          AND ap.to_status    = 'active'
    ), 0)                       AS gf1_promotions_this_week,
    1                           AS gf1_max_per_week,

    -- GF2 : Circuit Breaker
    COALESCE((
        SELECT et.consecutive_decline
        FROM guardian.empire_trend et
        WHERE et.tenant_id = t.id
        ORDER BY et.recorded_at DESC LIMIT 1
    ), 0)                       AS gf2_consecutive_decline,
    (
        SELECT et.circuit_breaker_triggered
        FROM guardian.empire_trend et
        WHERE et.tenant_id = t.id
        ORDER BY et.recorded_at DESC LIMIT 1
    )                           AS gf2_triggered,

    -- GF3 : Silence Windows
    COALESCE((
        SELECT COUNT(*)
        FROM guardian.agent_promotions ap
        WHERE ap.tenant_id            = t.id
          AND ap.silence_window_active = TRUE
          AND ap.silence_window_ends   > NOW()
    ), 0)                       AS gf3_agents_in_silence,

    -- GF4 : Data Quality Gate (niveau 2+)
    COALESCE((
        SELECT COUNT(*)
        FROM intel.patterns p
        WHERE p.tenant_id IS NULL  -- cross-tenant
          AND p.quality_checked_at IS NOT NULL
          AND p.quality_gate_passed = FALSE
          AND p.quality_checked_at > NOW() - INTERVAL '7 days'
    ), 0)                       AS gf4_rejected_patterns_7d,

    -- GF5 : Complexity Score
    COALESCE((
        SELECT cs.complexity_score
        FROM guardian.complexity_snapshots cs
        WHERE cs.tenant_id = t.id
        ORDER BY cs.computed_at DESC LIMIT 1
    ), 0)                       AS gf5_complexity_score,
    (
        SELECT cs.threshold_exceeded
        FROM guardian.complexity_snapshots cs
        WHERE cs.tenant_id = t.id
        ORDER BY cs.computed_at DESC LIMIT 1
    )                           AS gf5_threshold_exceeded,

    -- Empire Index courant
    COALESCE((
        SELECT es.empire_index
        FROM ops.empire_state es
        WHERE es.tenant_id = t.id
        ORDER BY es.updated_at DESC LIMIT 1
    ), 0)                       AS empire_index_current,

    -- Alertes ouvertes
    COALESCE((
        SELECT COUNT(*)
        FROM ops.alerts a
        WHERE a.tenant_id   = t.id
          AND a.resolved_at IS NULL
    ), 0)                       AS open_alerts

FROM saas.tenants t
WHERE t.status = 'active';

-- ════════════════════════════════════════════════════════════
-- PATCH 020-B — Trust Score cross-tenant (remplace quality gate simple)
-- ════════════════════════════════════════════════════════════
--
-- TrustScore = 0.4 × RevenueStability
--            + 0.3 × DataVolume
--            + 0.2 × CMQuality
--            + 0.1 × AgeAccount
--
-- Pattern accepté seulement si :
--   TrustScore ≥ 70
--   AND budget_sample ≥ seuil_par_niche
--   AND pattern_confidence ≥ 65
--
-- Patterns isolés par niche + product_category + price_range + traffic_source

-- Extension de intel.patterns pour le Trust Score complet
ALTER TABLE intel.patterns
    ADD COLUMN IF NOT EXISTS trust_score           NUMERIC(5,1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trust_revenue_stability NUMERIC(5,1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trust_data_volume     NUMERIC(5,1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trust_cm_quality      NUMERIC(5,1) DEFAULT 0,
    ADD COLUMN IF NOT EXISTS trust_age_score       NUMERIC(5,1) DEFAULT 0,
    -- Isolation par niche
    ADD COLUMN IF NOT EXISTS product_category      VARCHAR(60),
    ADD COLUMN IF NOT EXISTS price_range           VARCHAR(20)   -- 'budget'|'mid'|'premium'|'luxury'
        CHECK (price_range IN ('budget','mid','premium','luxury') OR price_range IS NULL),
    ADD COLUMN IF NOT EXISTS traffic_source        VARCHAR(30)
        CHECK (traffic_source IN ('meta','tiktok','google','organic','email') OR traffic_source IS NULL);

-- Fonction Trust Score
CREATE OR REPLACE FUNCTION guardian.compute_trust_score(
    p_tenant_id         UUID,
    -- RevenueStability : CV du revenu sur 30j (coefficient de variation inverse)
    p_revenue_cv        NUMERIC,   -- coefficient de variation 0-1 (0=stable, 1=chaos)
    -- DataVolume : spend total du tenant sur 90j
    p_total_spend_90d   NUMERIC,
    -- CMQuality : marge de contribution moyenne
    p_avg_cm_pct        NUMERIC,
    -- AgeAccount : âge du compte en jours
    p_account_age_days  INTEGER
)
RETURNS TABLE (
    trust_score             NUMERIC,
    score_revenue_stability NUMERIC,
    score_data_volume       NUMERIC,
    score_cm_quality        NUMERIC,
    score_age               NUMERIC,
    meets_threshold         BOOLEAN
)
LANGUAGE plpgsql AS $$
DECLARE
    v_stability NUMERIC;
    v_volume    NUMERIC;
    v_cm        NUMERIC;
    v_age       NUMERIC;
    v_total     NUMERIC;
BEGIN
    -- RevenueStability (40%) : CV faible = bon
    -- CV 0 = score 100 | CV 0.5 = score 50 | CV 1+ = score 0
    v_stability := LEAST(100, GREATEST(0, (1 - p_revenue_cv) * 100));

    -- DataVolume (30%) : 10k€ spend = score 100
    v_volume := LEAST(100, GREATEST(0, (p_total_spend_90d / 10000.0) * 100));

    -- CMQuality (20%) : CM 50% = score 100
    v_cm := LEAST(100, GREATEST(0, p_avg_cm_pct * 2));

    -- AgeAccount (10%) : 180j = score 100
    v_age := LEAST(100, GREATEST(0, (p_account_age_days::NUMERIC / 180.0) * 100));

    -- Pondération
    v_total := ROUND(
        (v_stability * 0.40)
      + (v_volume    * 0.30)
      + (v_cm        * 0.20)
      + (v_age       * 0.10)
    , 1);

    RETURN QUERY SELECT
        v_total, v_stability, v_volume, v_cm, v_age,
        v_total >= 70;
END;
$$;

-- Remplace validate_pattern_quality — now includes trust_score
CREATE OR REPLACE FUNCTION guardian.validate_pattern_quality_v2(
    p_pattern_id            BIGINT,
    -- Trust Score inputs
    p_revenue_cv            NUMERIC,
    p_total_spend_90d       NUMERIC,
    p_avg_cm_pct            NUMERIC,
    p_account_age_days      INTEGER,
    -- Quality inputs (inchangés)
    p_source_tenant_count   INTEGER,
    p_budget_sample_eur     NUMERIC,
    p_pattern_confidence    NUMERIC,   -- seuil : 65 (vs 70 avant)
    -- Niche isolation
    p_niche                 VARCHAR    DEFAULT NULL,
    p_product_category      VARCHAR    DEFAULT NULL,
    p_price_range           VARCHAR    DEFAULT NULL,
    p_traffic_source        VARCHAR    DEFAULT NULL
)
RETURNS TABLE (
    passed          BOOLEAN,
    trust_score     NUMERIC,
    fail_reasons    TEXT[]
)
LANGUAGE plpgsql AS $$
DECLARE
    v_trust_score   NUMERIC;
    v_trust_meets   BOOLEAN;
    v_reasons       TEXT[] := '{}';
    v_passed        BOOLEAN := TRUE;
BEGIN
    -- Calcul Trust Score
    SELECT ts.trust_score, ts.meets_threshold
    INTO v_trust_score, v_trust_meets
    FROM guardian.compute_trust_score(
        p_pattern_id::UUID,  -- placeholder (tenant_id pas nécessaire ici)
        p_revenue_cv, p_total_spend_90d, p_avg_cm_pct, p_account_age_days
    ) ts;

    -- GF4 checks
    IF NOT v_trust_meets THEN
        v_reasons := ARRAY_APPEND(v_reasons,
            format('trust_score=%.1f < 70', v_trust_score));
        v_passed := FALSE;
    END IF;

    IF p_source_tenant_count < 3 THEN
        v_reasons := ARRAY_APPEND(v_reasons,
            format('source_tenants=%s < 3', p_source_tenant_count));
        v_passed := FALSE;
    END IF;

    IF p_budget_sample_eur < 1000 THEN
        v_reasons := ARRAY_APPEND(v_reasons,
            format('budget_sample=%.0f€ < 1000€', p_budget_sample_eur));
        v_passed := FALSE;
    END IF;

    IF p_pattern_confidence < 65 THEN
        v_reasons := ARRAY_APPEND(v_reasons,
            format('pattern_confidence=%.1f < 65', p_pattern_confidence));
        v_passed := FALSE;
    END IF;

    -- Persiste
    UPDATE intel.patterns SET
        trust_score              = v_trust_score,
        quality_gate_passed      = v_passed,
        quality_checked_at       = NOW(),
        quality_reject_reason    = CASE WHEN v_passed THEN NULL
                                        ELSE ARRAY_TO_STRING(v_reasons, ' | ') END,
        niche                    = COALESCE(p_niche, niche),
        product_category         = COALESCE(p_product_category, product_category),
        price_range              = COALESCE(p_price_range, price_range),
        traffic_source           = COALESCE(p_traffic_source, traffic_source)
    WHERE id = p_pattern_id;

    RETURN QUERY SELECT v_passed, v_trust_score, v_reasons;
END;
$$;


-- ════════════════════════════════════════════════════════════
-- PATCH 020-C — Phase thresholds (CM+stabilité, pas revenu seul)
-- ════════════════════════════════════════════════════════════
--
-- Phase 1 (Core)   : toujours actif
-- Phase 2 (Scale)  : CM ≥ 20% ET revenue ≥ 10k/mois ET 30j historique
-- Phase 3 (Empire) : CM ≥ 30% ET revenue ≥ 100k/mois ET cash ≥ 60j
--                    ET dependency < 75%
--
-- Raison : le revenu seul est trompeur. Une marque à 10k/mois
-- avec CM 8% ne devrait PAS activer le Scale Layer.
-- La marge de contribution et la stabilité sont les vrais signaux.

-- Nouvelle table pour les seuils de phase v2
CREATE TABLE IF NOT EXISTS ops.phase_thresholds (
    phase_level         SMALLINT     PRIMARY KEY,  -- 1|2|3
    phase_name          VARCHAR(30)  NOT NULL,
    -- Seuils d'activation (tous doivent être vrais)
    min_revenue_monthly NUMERIC,     -- €/mois
    min_cm_pct          NUMERIC,     -- %
    min_data_days       INTEGER,     -- jours d'historique requis
    min_cash_runway     INTEGER,     -- jours de trésorerie
    max_dependency_pct  NUMERIC,     -- % canal dominant max
    -- Agents activés à ce niveau
    agents_unlocked     TEXT[]       NOT NULL DEFAULT '{}',
    description         TEXT
);

INSERT INTO ops.phase_thresholds VALUES
(1, 'CORE', NULL, NULL, NULL, NULL, NULL,
 ARRAY['AGENT_ORCHESTRATOR','AGENT_POLICY_GOVERNOR','AGENT_OPS_GUARD',
       'AGENT_WINNER_DETECTOR','AGENT_META_TESTING','AGENT_SCRAPING',
       'AGENT_STRATEGY_ORGANIC','AGENT_GUARDRAILS'],
 'Validation produit. Toujours actif.'),

(2, 'SCALE', 10000, 20.0, 30, NULL, NULL,
 ARRAY['AGENT_CREATIVE_FACTORY','AGENT_LEARNING','AGENT_INNOVATION',
       'AGENT_STOP_LOSS','AGENT_SPY','AGENT_MARKET_INTEL'],
 'Scale Layer. Requis : revenue ≥ 10k/mois ET CM ≥ 20% ET 30j data.
  Le revenu seul ne suffit pas — CM sous 20% = marge insuffisante pour scaler.'),

(3, 'EMPIRE', 100000, 30.0, 90, 60, 75.0,
 ARRAY['AGENT_CEO','AGENT_UGC_FACTORY','AGENT_CAPI',
       'AGENT_MONEY_MODEL','AGENT_GUARDRAILS'],
 'Empire Layer. Requis : revenue ≥ 100k/mois ET CM ≥ 30%
  ET cash ≥ 60j ET dependency < 75%.
  Cross-tenant learning, Condor, Capital Engine complet.')
ON CONFLICT (phase_level) DO UPDATE SET
    min_revenue_monthly = EXCLUDED.min_revenue_monthly,
    min_cm_pct          = EXCLUDED.min_cm_pct,
    min_data_days       = EXCLUDED.min_data_days,
    min_cash_runway     = EXCLUDED.min_cash_runway,
    max_dependency_pct  = EXCLUDED.max_dependency_pct,
    agents_unlocked     = EXCLUDED.agents_unlocked,
    description         = EXCLUDED.description;

-- Fonction de check des seuils de phase v2
CREATE OR REPLACE FUNCTION ops.check_phase_eligibility(
    p_tenant_id         UUID,
    p_revenue_monthly   NUMERIC,
    p_cm_pct            NUMERIC,
    p_data_days         INTEGER,
    p_cash_runway_days  INTEGER DEFAULT NULL,
    p_dependency_pct    NUMERIC DEFAULT NULL
)
RETURNS TABLE (
    phase_level     SMALLINT,
    phase_name      VARCHAR,
    eligible        BOOLEAN,
    missing         TEXT[]
)
LANGUAGE plpgsql AS $$
BEGIN
    RETURN QUERY
    SELECT
        pt.phase_level,
        pt.phase_name,
        (
            (pt.min_revenue_monthly IS NULL OR p_revenue_monthly   >= pt.min_revenue_monthly)
        AND (pt.min_cm_pct          IS NULL OR p_cm_pct            >= pt.min_cm_pct)
        AND (pt.min_data_days       IS NULL OR p_data_days         >= pt.min_data_days)
        AND (pt.min_cash_runway     IS NULL OR p_cash_runway_days  >= pt.min_cash_runway)
        AND (pt.max_dependency_pct  IS NULL OR p_dependency_pct    <= pt.max_dependency_pct)
        ) AS eligible,
        ARRAY_REMOVE(ARRAY[
            CASE WHEN pt.min_revenue_monthly IS NOT NULL
                      AND p_revenue_monthly < pt.min_revenue_monthly
                 THEN format('revenue %.0f€ < %.0f€', p_revenue_monthly, pt.min_revenue_monthly)
                 ELSE NULL END,
            CASE WHEN pt.min_cm_pct IS NOT NULL
                      AND p_cm_pct < pt.min_cm_pct
                 THEN format('CM %.1f%% < %.0f%%', p_cm_pct, pt.min_cm_pct)
                 ELSE NULL END,
            CASE WHEN pt.min_data_days IS NOT NULL
                      AND p_data_days < pt.min_data_days
                 THEN format('data %sd < %sd', p_data_days, pt.min_data_days)
                 ELSE NULL END,
            CASE WHEN pt.min_cash_runway IS NOT NULL
                      AND p_cash_runway_days < pt.min_cash_runway
                 THEN format('cash runway %sd < %sd', p_cash_runway_days, pt.min_cash_runway)
                 ELSE NULL END,
            CASE WHEN pt.max_dependency_pct IS NOT NULL
                      AND p_dependency_pct > pt.max_dependency_pct
                 THEN format('dependency %.0f%% > %.0f%%', p_dependency_pct, pt.max_dependency_pct)
                 ELSE NULL END
        ], NULL) AS missing
    FROM ops.phase_thresholds pt
    ORDER BY pt.phase_level;
END;
$$;

-- ============================================================
-- MIGRATION 020 — GUARDRAILS STRUCTURELS (par niveau)
-- ============================================================
-- Philosophie :
--   Les garde-fous précédents sont RÉACTIFS (ils coupent après l'erreur).
--   Ces garde-fous sont STRUCTURELS (ils rendent l'erreur impossible).
--
-- 5 garde-fous, activés par niveau (basic → hedge_fund → full_organism) :
--
--   NIVEAU 1 (basic)       → Empire Index formula + Complexity Budget
--   NIVEAU 2 (hedge_fund)  → + Circuit Breaker (auto-downgrade tier)
--                          → + Deployment Silence Window (48h)
--   NIVEAU 3 (full_organism) → + Data Quality Gate (cross-tenant)
--                            → + Complexity Score Dashboard
--
-- Règle méta (tous niveaux) :
--   POLICY_GOVERNOR ne peut pas être modifié par un agent.
--   Les guardrails sont écrits en SQL, pas en config applicative.
-- ============================================================

-- ╔═══════════════════════════════════════════════════════════╗
-- ║  SCHÉMA                                                   ║
-- ╚═══════════════════════════════════════════════════════════╝
CREATE SCHEMA IF NOT EXISTS guardrails;

-- ============================================================
-- GARDE-FOU 1 — EMPIRE INDEX FORMULA (NIVEAU 1 — basic+)
-- ============================================================
-- Formule fixée, documentée, immuable sauf migration majeure.
-- Stockée en SQL pour être la source de vérité unique.
-- ============================================================

-- Table de configuration de la formule (lecture seule en prod)
CREATE TABLE IF NOT EXISTS guardrails.empire_index_config (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    version         INTEGER NOT NULL DEFAULT 1,
    -- Poids des composantes (somme = 1.0)
    w_roas          NUMERIC(4,2) NOT NULL DEFAULT 0.30  CHECK (w_roas BETWEEN 0 AND 1),
    w_capital_vel   NUMERIC(4,2) NOT NULL DEFAULT 0.25  CHECK (w_capital_vel BETWEEN 0 AND 1),
    w_winner_rate   NUMERIC(4,2) NOT NULL DEFAULT 0.20  CHECK (w_winner_rate BETWEEN 0 AND 1),
    w_autonomy      NUMERIC(4,2) NOT NULL DEFAULT 0.15  CHECK (w_autonomy BETWEEN 0 AND 1),
    w_risk_inv      NUMERIC(4,2) NOT NULL DEFAULT 0.10  CHECK (w_risk_inv BETWEEN 0 AND 1),
    -- Multiplicateurs par phase
    phase_multiplier_seed   NUMERIC(3,2) NOT NULL DEFAULT 0.70,
    phase_multiplier_growth NUMERIC(3,2) NOT NULL DEFAULT 0.90,
    phase_multiplier_cruise NUMERIC(3,2) NOT NULL DEFAULT 1.00,
    phase_multiplier_scale  NUMERIC(3,2) NOT NULL DEFAULT 1.15,
    -- Seuils d'alerte
    threshold_warning       NUMERIC(4,2) NOT NULL DEFAULT 0.40,
    threshold_critical      NUMERIC(4,2) NOT NULL DEFAULT 0.25,
    threshold_auto_downgrade NUMERIC(4,2) NOT NULL DEFAULT 0.20,
    -- Métadonnées
    locked_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    locked_by       TEXT NOT NULL DEFAULT 'MIGRATION_020',
    notes           TEXT,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,
    CONSTRAINT weights_sum CHECK (
        ROUND(w_roas + w_capital_vel + w_winner_rate + w_autonomy + w_risk_inv, 2) = 1.00
    )
);

-- Seed : formule v1 officielle
INSERT INTO guardrails.empire_index_config (
    version, w_roas, w_capital_vel, w_winner_rate, w_autonomy, w_risk_inv,
    phase_multiplier_seed, phase_multiplier_growth, phase_multiplier_cruise, phase_multiplier_scale,
    threshold_warning, threshold_critical, threshold_auto_downgrade,
    notes
) VALUES (
    1, 0.30, 0.25, 0.20, 0.15, 0.10,
    0.70, 0.90, 1.00, 1.15,
    0.40, 0.25, 0.20,
    'Formule Empire Index v1 — fixée en migration 020. Modification = nouvelle migration majeure.'
);

-- Vue calculée — Empire Index en temps réel par tenant
CREATE OR REPLACE VIEW guardrails.empire_index_live AS
WITH cfg AS (
    SELECT * FROM guardrails.empire_index_config WHERE is_active = TRUE LIMIT 1
),
tenant_metrics AS (
    SELECT
        t.id                            AS tenant_id,
        t.phase,
        -- ROAS 30j (normalisé sur cible 3.0x)
        LEAST(1.0, COALESCE(
            (SELECT AVG(roas_30d) FROM ops.capital_live WHERE tenant_id = t.id), 0
        ) / 3.0)                        AS roas_norm,
        -- Capital velocity (rotation capital — normalisé)
        LEAST(1.0, COALESCE(
            (SELECT capital_velocity FROM ops.capital_live WHERE tenant_id = t.id LIMIT 1), 0
        ) / 2.0)                        AS capital_vel_norm,
        -- Winner rate (% produits actifs / testés, cible 30%)
        LEAST(1.0, COALESCE(
            (SELECT COUNT(*) FILTER (WHERE status = 'ACTIVE')::FLOAT /
             NULLIF(COUNT(*), 0)
             FROM store.products WHERE tenant_id = t.id), 0
        ) / 0.30)                       AS winner_rate_norm,
        -- Autonomy rate (% decisions auto vs manuelles, cible 70%)
        LEAST(1.0, COALESCE(
            (SELECT COUNT(*) FILTER (WHERE auto_executed = TRUE)::FLOAT /
             NULLIF(COUNT(*), 0)
             FROM agents.decisions WHERE tenant_id = t.id
             AND created_at > now() - interval '30 days'), 0
        ) / 0.70)                       AS autonomy_norm,
        -- Risk score inverse (1 - exposition, cible 0 incidents critiques)
        GREATEST(0.0, 1.0 - COALESCE(
            (SELECT COUNT(*)::FLOAT / 10.0
             FROM risk.incidents WHERE tenant_id = t.id
             AND severity = 'critical'
             AND created_at > now() - interval '30 days'), 0
        ))                              AS risk_inv_norm
    FROM saas.tenants t
    WHERE t.deleted_at IS NULL
)
SELECT
    m.tenant_id,
    m.phase,
    -- Score brut
    ROUND((
        cfg.w_roas        * m.roas_norm +
        cfg.w_capital_vel * m.capital_vel_norm +
        cfg.w_winner_rate * m.winner_rate_norm +
        cfg.w_autonomy    * m.autonomy_norm +
        cfg.w_risk_inv    * m.risk_inv_norm
    ) * CASE m.phase
        WHEN 'SEED'   THEN cfg.phase_multiplier_seed
        WHEN 'GROWTH' THEN cfg.phase_multiplier_growth
        WHEN 'CRUISE' THEN cfg.phase_multiplier_cruise
        WHEN 'SCALE'  THEN cfg.phase_multiplier_scale
        ELSE 1.0
    END, 3)                             AS empire_index,
    -- Composantes détaillées
    ROUND(m.roas_norm, 3)              AS roas_score,
    ROUND(m.capital_vel_norm, 3)       AS capital_velocity_score,
    ROUND(m.winner_rate_norm, 3)       AS winner_rate_score,
    ROUND(m.autonomy_norm, 3)          AS autonomy_score,
    ROUND(m.risk_inv_norm, 3)          AS risk_score,
    -- Statut
    CASE
        WHEN (cfg.w_roas * m.roas_norm + cfg.w_capital_vel * m.capital_vel_norm +
              cfg.w_winner_rate * m.winner_rate_norm + cfg.w_autonomy * m.autonomy_norm +
              cfg.w_risk_inv * m.risk_inv_norm) >= cfg.threshold_warning THEN 'HEALTHY'
        WHEN (cfg.w_roas * m.roas_norm + cfg.w_capital_vel * m.capital_vel_norm +
              cfg.w_winner_rate * m.winner_rate_norm + cfg.w_autonomy * m.autonomy_norm +
              cfg.w_risk_inv * m.risk_inv_norm) >= cfg.threshold_critical THEN 'WARNING'
        WHEN (cfg.w_roas * m.roas_norm + cfg.w_capital_vel * m.capital_vel_norm +
              cfg.w_winner_rate * m.winner_rate_norm + cfg.w_autonomy * m.autonomy_norm +
              cfg.w_risk_inv * m.risk_inv_norm) >= cfg.threshold_auto_downgrade THEN 'CRITICAL'
        ELSE 'AUTO_DOWNGRADE'
    END                                 AS status,
    now()                               AS computed_at
FROM tenant_metrics m
CROSS JOIN cfg;

-- ============================================================
-- GARDE-FOU 2 — COMPLEXITY BUDGET (NIVEAU 1 — basic+)
-- ============================================================
-- Max 1 agent promu en production par semaine, par tenant.
-- Contrainte SQL — pas contournable par le code applicatif.
-- ============================================================

CREATE TABLE IF NOT EXISTS guardrails.deployment_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    agent_id        TEXT NOT NULL,
    from_mode       TEXT NOT NULL,  -- 'shadow' | 'manual' | 'auto'
    to_mode         TEXT NOT NULL,
    deployed_by     UUID REFERENCES saas.users(id),
    deployed_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Silence window (48h post-déploiement)
    silence_until   TIMESTAMPTZ NOT NULL DEFAULT now() + interval '48 hours',
    silence_active  BOOLEAN NOT NULL DEFAULT TRUE,
    -- Audit
    reason          TEXT,
    rollback_of     UUID REFERENCES guardrails.deployment_log(id)
);

-- Index pour check rapide "déploiements cette semaine"
CREATE INDEX idx_deployment_log_tenant_week
    ON guardrails.deployment_log (tenant_id, deployed_at);

-- Fonction : vérifie si un déploiement est autorisé
CREATE OR REPLACE FUNCTION guardrails.can_deploy(
    p_tenant_id UUID,
    p_agent_id  TEXT
) RETURNS TABLE (
    allowed     BOOLEAN,
    reason      TEXT,
    next_slot   TIMESTAMPTZ
) LANGUAGE plpgsql AS $$
DECLARE
    v_deploys_this_week INTEGER;
    v_last_deploy       TIMESTAMPTZ;
    v_silence_active    BOOLEAN;
BEGIN
    -- Compter les déploiements sur les 7 derniers jours
    SELECT COUNT(*)
    INTO v_deploys_this_week
    FROM guardrails.deployment_log
    WHERE tenant_id = p_tenant_id
      AND deployed_at > now() - interval '7 days'
      AND rollback_of IS NULL;  -- ne pas compter les rollbacks

    -- Vérifier silence window active
    SELECT deployed_at, silence_active
    INTO v_last_deploy, v_silence_active
    FROM guardrails.deployment_log
    WHERE tenant_id = p_tenant_id
    ORDER BY deployed_at DESC
    LIMIT 1;

    IF v_deploys_this_week >= 1 AND p_agent_id != 'ROLLBACK' THEN
        RETURN QUERY SELECT
            FALSE,
            format('Budget déploiement épuisé : %s déploiement(s) cette semaine (max 1). Prochain slot disponible le %s.',
                v_deploys_this_week,
                to_char(v_last_deploy + interval '7 days', 'DD/MM/YYYY HH24:MI')),
            v_last_deploy + interval '7 days';
    ELSIF v_silence_active AND v_last_deploy IS NOT NULL THEN
        RETURN QUERY SELECT
            FALSE,
            format('Silence window active jusqu''au %s (48h post-déploiement obligatoires).',
                to_char(v_last_deploy + interval '48 hours', 'DD/MM/YYYY HH24:MI')),
            v_last_deploy + interval '48 hours';
    ELSE
        RETURN QUERY SELECT TRUE, 'Déploiement autorisé'::TEXT, NULL::TIMESTAMPTZ;
    END IF;
END;
$$;

-- Job automatique : désactiver silence_active après 48h
CREATE OR REPLACE FUNCTION guardrails.expire_silence_windows()
RETURNS void LANGUAGE sql AS $$
    UPDATE guardrails.deployment_log
    SET silence_active = FALSE
    WHERE silence_active = TRUE
      AND silence_until <= now();
$$;

-- ============================================================
-- GARDE-FOU 3 — CIRCUIT BREAKER (NIVEAU 2 — hedge_fund+)
-- ============================================================
-- Si Empire Index < threshold_auto_downgrade sur 3 jours consécutifs :
-- → rétrogradation automatique d'un tier
-- → aucune action autonome pendant la période de stabilisation
-- ============================================================

CREATE TABLE IF NOT EXISTS guardrails.circuit_breaker_log (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    triggered_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    trigger_reason  TEXT NOT NULL,
    empire_index_at_trigger NUMERIC(4,3),
    -- Avant / après
    from_agent_mode TEXT NOT NULL,
    to_agent_mode   TEXT NOT NULL,
    -- Stabilisation
    stabilize_until TIMESTAMPTZ NOT NULL DEFAULT now() + interval '72 hours',
    resolved_at     TIMESTAMPTZ,
    resolved_empire_index NUMERIC(4,3),
    -- Qui a résolu
    resolved_by     TEXT DEFAULT 'AUTO',
    notes           TEXT
);

CREATE INDEX idx_circuit_breaker_tenant
    ON guardrails.circuit_breaker_log (tenant_id, triggered_at DESC);

-- Snapshot quotidien Empire Index pour détecter 3 jours consécutifs
CREATE TABLE IF NOT EXISTS guardrails.empire_index_daily (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    snapshot_date   DATE NOT NULL DEFAULT CURRENT_DATE,
    empire_index    NUMERIC(4,3) NOT NULL,
    status          TEXT NOT NULL,  -- HEALTHY | WARNING | CRITICAL | AUTO_DOWNGRADE
    agent_mode      TEXT NOT NULL,
    UNIQUE (tenant_id, snapshot_date)
);

-- Fonction : évaluer si circuit breaker doit se déclencher
CREATE OR REPLACE FUNCTION guardrails.eval_circuit_breaker(
    p_tenant_id UUID
) RETURNS TABLE (
    should_trigger  BOOLEAN,
    consecutive_days INTEGER,
    current_index   NUMERIC,
    recommended_mode TEXT
) LANGUAGE plpgsql AS $$
DECLARE
    v_consecutive   INTEGER;
    v_current_idx   NUMERIC;
    v_current_mode  TEXT;
    v_target_mode   TEXT;
    v_threshold     NUMERIC;
BEGIN
    -- Récupérer le seuil de l'Empire Index config
    SELECT threshold_auto_downgrade INTO v_threshold
    FROM guardrails.empire_index_config WHERE is_active = TRUE LIMIT 1;

    -- Compter jours consécutifs sous le seuil
    SELECT COUNT(*), MIN(empire_index)
    INTO v_consecutive, v_current_idx
    FROM (
        SELECT empire_index, snapshot_date,
               snapshot_date - ROW_NUMBER() OVER (ORDER BY snapshot_date)::INTEGER AS grp
        FROM guardrails.empire_index_daily
        WHERE tenant_id = p_tenant_id
          AND snapshot_date >= CURRENT_DATE - 5
          AND status IN ('CRITICAL', 'AUTO_DOWNGRADE')
        ORDER BY snapshot_date DESC
        LIMIT 3
    ) sub;

    -- Mode actuel
    SELECT agent_mode INTO v_current_mode
    FROM saas.tenants WHERE id = p_tenant_id;

    -- Calculer le mode rétrograder
    v_target_mode := CASE v_current_mode
        WHEN 'full_organism' THEN 'hedge_fund'
        WHEN 'hedge_fund'    THEN 'basic'
        ELSE 'basic'
    END;

    RETURN QUERY SELECT
        COALESCE(v_consecutive, 0) >= 3,
        COALESCE(v_consecutive, 0),
        COALESCE(v_current_idx, 1.0),
        v_target_mode;
END;
$$;

-- ============================================================
-- GARDE-FOU 4 — DATA QUALITY GATE (NIVEAU 3 — full_organism)
-- ============================================================
-- Avant qu'un pattern entre dans le pool cross-tenant :
--   • minimum 3 tenants différents
--   • minimum 1000€ de spend total
--   • confidence_score > 0.70
-- Contrainte SQL — pas de bypass possible.
-- ============================================================

CREATE TABLE IF NOT EXISTS guardrails.cross_tenant_patterns (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    pattern_type    TEXT NOT NULL,  -- 'creative_angle' | 'offer_structure' | 'timing' | 'audience'
    pattern_key     TEXT NOT NULL,  -- identifiant normalisé du pattern
    -- Métriques de validation
    tenant_count    INTEGER NOT NULL DEFAULT 0,
    total_spend_eur NUMERIC(12,2) NOT NULL DEFAULT 0,
    confidence      NUMERIC(4,3) NOT NULL DEFAULT 0,
    -- Statut
    status          TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (status IN ('PENDING', 'QUALIFIED', 'REJECTED', 'EXPIRED')),
    -- Données du pattern (pas de données brutes — uniquement structurelles)
    niche           TEXT,
    budget_tier     TEXT CHECK (budget_tier IN ('micro', 'growth', 'scale')),  -- normalisation budget
    pattern_data    JSONB NOT NULL DEFAULT '{}',
    -- Audit
    first_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    qualified_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ DEFAULT now() + interval '90 days',
    UNIQUE (pattern_type, pattern_key, niche, budget_tier)
);

-- Index pour lookup rapide par type
CREATE INDEX idx_cross_tenant_patterns_lookup
    ON guardrails.cross_tenant_patterns (pattern_type, status, niche, budget_tier);

-- Contrainte : qualification automatique quand seuils atteints
CREATE OR REPLACE FUNCTION guardrails.qualify_pattern()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.tenant_count >= 3
       AND NEW.total_spend_eur >= 1000
       AND NEW.confidence >= 0.70
       AND NEW.status = 'PENDING'
    THEN
        NEW.status     := 'QUALIFIED';
        NEW.qualified_at := now();
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_qualify_pattern
    BEFORE INSERT OR UPDATE ON guardrails.cross_tenant_patterns
    FOR EACH ROW EXECUTE FUNCTION guardrails.qualify_pattern();

-- Vue : patterns qualifiés disponibles (filtrés + expiration)
CREATE OR REPLACE VIEW guardrails.qualified_patterns AS
SELECT
    id, pattern_type, pattern_key, niche, budget_tier,
    tenant_count, total_spend_eur, confidence,
    pattern_data, qualified_at
FROM guardrails.cross_tenant_patterns
WHERE status = 'QUALIFIED'
  AND (expires_at IS NULL OR expires_at > now());

-- ============================================================
-- GARDE-FOU 5 — COMPLEXITY SCORE (TOUS NIVEAUX)
-- ============================================================
-- Score 1-10 visible dans le dashboard.
-- Quand > 7 : alerte + blocage nouvelles activations.
-- ============================================================

CREATE TABLE IF NOT EXISTS guardrails.complexity_snapshot (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    snapshot_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
    -- Composantes
    agents_active   INTEGER NOT NULL DEFAULT 0,    -- max 17 = +5 points
    autopilot_level INTEGER NOT NULL DEFAULT 0,    -- 1/2/3 = +0/+1/+2 points
    open_experiments INTEGER NOT NULL DEFAULT 0,   -- chaque exp = +0.3 points
    active_rules    INTEGER NOT NULL DEFAULT 0,    -- stop-loss + policy rules
    pending_approvals INTEGER NOT NULL DEFAULT 0,  -- approbations en attente
    -- Score calculé (1-10)
    complexity_score NUMERIC(4,2) NOT NULL,
    status          TEXT NOT NULL
        CHECK (status IN ('GREEN', 'YELLOW', 'RED', 'BLOCKED')),
    -- Blocage
    blocks_new_activation BOOLEAN NOT NULL DEFAULT FALSE,
    notes           TEXT
);

CREATE INDEX idx_complexity_snapshot_tenant
    ON guardrails.complexity_snapshot (tenant_id, snapshot_at DESC);

-- Fonction : calculer le complexity score
CREATE OR REPLACE FUNCTION guardrails.compute_complexity(
    p_tenant_id UUID
) RETURNS TABLE (
    score           NUMERIC,
    status          TEXT,
    blocks          BOOLEAN,
    breakdown       JSONB
) LANGUAGE plpgsql AS $$
DECLARE
    v_agents_active     INTEGER;
    v_autopilot         INTEGER;
    v_experiments       INTEGER;
    v_rules             INTEGER;
    v_approvals         INTEGER;
    v_score             NUMERIC;
    v_autopilot_mode    TEXT;
BEGIN
    -- Agents actifs (non-shadow)
    SELECT COUNT(DISTINCT agent_id)
    INTO v_agents_active
    FROM agents.metrics
    WHERE tenant_id = p_tenant_id
      AND last_run_at > now() - interval '24 hours'
      AND mode != 'shadow';

    -- Autopilot level
    SELECT autopilot_mode INTO v_autopilot_mode
    FROM saas.tenants WHERE id = p_tenant_id;
    v_autopilot := CASE v_autopilot_mode
        WHEN 'human_validate' THEN 0
        WHEN 'semi_auto'      THEN 1
        WHEN 'full_auto'      THEN 2
        ELSE 0
    END;

    -- Expériences actives
    SELECT COUNT(*)
    INTO v_experiments
    FROM intel.experiments
    WHERE tenant_id = p_tenant_id AND status = 'RUNNING';

    -- Règles stop-loss actives
    SELECT COUNT(*)
    INTO v_rules
    FROM risk.stop_loss_rules
    WHERE tenant_id = p_tenant_id AND is_active = TRUE;

    -- Approbations en attente
    SELECT COUNT(*)
    INTO v_approvals
    FROM store.pipeline_approvals
    WHERE tenant_id = p_tenant_id AND status = 'PENDING';

    -- Calcul du score (1-10)
    v_score := LEAST(10, GREATEST(1,
        (v_agents_active::NUMERIC / 17 * 5)   -- agents : 0-5 pts
        + v_autopilot                           -- autopilot : 0-2 pts
        + LEAST(2, v_experiments * 0.3)         -- expériences : 0-2 pts
        + LEAST(0.5, v_rules * 0.05)            -- règles : 0-0.5 pts
        + LEAST(0.5, v_approvals * 0.1)         -- approvals : 0-0.5 pts
        + 1                                      -- baseline
    ));

    RETURN QUERY SELECT
        ROUND(v_score, 2),
        CASE
            WHEN v_score <= 4 THEN 'GREEN'
            WHEN v_score <= 7 THEN 'YELLOW'
            WHEN v_score <= 8.5 THEN 'RED'
            ELSE 'BLOCKED'
        END,
        v_score > 7,
        jsonb_build_object(
            'agents_active', v_agents_active,
            'autopilot_level', v_autopilot,
            'open_experiments', v_experiments,
            'active_rules', v_rules,
            'pending_approvals', v_approvals,
            'max_score', 10
        );
END;
$$;

-- ============================================================
-- RÈGLE MÉTA — IMMUTABILITÉ DU POLICY_GOVERNOR
-- ============================================================
-- Aucun agent ne peut modifier guardrails.empire_index_config.
-- Trigger de protection (défense en profondeur).
-- ============================================================

CREATE OR REPLACE FUNCTION guardrails.block_guardrail_mutation()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    -- Seule une migration (rôle superuser ou aegis_migration) peut modifier
    IF current_user NOT IN ('aegis_migration', 'postgres') THEN
        RAISE EXCEPTION
            'VIOLATION CONSTITUTIONNELLE : la formule Empire Index est immuable. '
            'Modifier via une nouvelle migration (020+). User: %', current_user;
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER trg_protect_empire_formula
    BEFORE UPDATE OR DELETE ON guardrails.empire_index_config
    FOR EACH ROW EXECUTE FUNCTION guardrails.block_guardrail_mutation();

-- ============================================================
-- ACTIVATION PAR NIVEAU — vue de synthèse
-- ============================================================

CREATE OR REPLACE VIEW guardrails.active_guardrails_by_tenant AS
SELECT
    t.id                    AS tenant_id,
    t.agent_mode,
    -- Niveau 1 — basic+
    TRUE                    AS gf1_empire_index,         -- toujours actif
    TRUE                    AS gf2_complexity_budget,    -- toujours actif
    -- Niveau 2 — hedge_fund+
    (t.agent_mode IN ('hedge_fund', 'full_organism'))
                            AS gf3_circuit_breaker,
    (t.agent_mode IN ('hedge_fund', 'full_organism'))
                            AS gf4_silence_window,
    -- Niveau 3 — full_organism uniquement
    (t.agent_mode = 'full_organism')
                            AS gf5_data_quality_gate,
    (t.agent_mode = 'full_organism')
                            AS gf5_complexity_score,
    -- Statut empire index
    ei.empire_index,
    ei.status               AS empire_status,
    -- Circuit breaker actif ?
    EXISTS (
        SELECT 1 FROM guardrails.circuit_breaker_log cb
        WHERE cb.tenant_id = t.id
          AND cb.resolved_at IS NULL
          AND cb.stabilize_until > now()
    )                       AS circuit_breaker_active,
    -- Silence window active ?
    EXISTS (
        SELECT 1 FROM guardrails.deployment_log dl
        WHERE dl.tenant_id = t.id
          AND dl.silence_active = TRUE
          AND dl.silence_until > now()
    )                       AS silence_window_active
FROM saas.tenants t
LEFT JOIN guardrails.empire_index_live ei ON ei.tenant_id = t.id
WHERE t.deleted_at IS NULL;

-- ============================================================
-- RLS
-- ============================================================
ALTER TABLE guardrails.deployment_log          ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrails.circuit_breaker_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrails.empire_index_daily      ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrails.cross_tenant_patterns   ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrails.complexity_snapshot     ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON guardrails.deployment_log
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation ON guardrails.circuit_breaker_log
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation ON guardrails.empire_index_daily
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
CREATE POLICY tenant_isolation ON guardrails.complexity_snapshot
    USING (tenant_id = current_setting('app.tenant_id')::UUID);
-- cross_tenant_patterns : accès global (données anonymisées par design)
CREATE POLICY public_read ON guardrails.cross_tenant_patterns
    FOR SELECT USING (status = 'QUALIFIED');

-- ============================================================
-- SEED — Cron jobs (pg_cron si disponible)
-- ============================================================
-- Ces crons tournent en dehors de l'application pour garantir
-- que les garde-fous ne peuvent pas être désactivés par le code.
-- ============================================================
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
        -- Snapshot Empire Index quotidien (minuit UTC)
        PERFORM cron.schedule(
            'aegis-empire-snapshot',
            '0 0 * * *',
            $$INSERT INTO guardrails.empire_index_daily (tenant_id, snapshot_date, empire_index, status, agent_mode)
              SELECT ei.tenant_id, CURRENT_DATE, ei.empire_index, ei.status, t.agent_mode
              FROM guardrails.empire_index_live ei
              JOIN saas.tenants t ON t.id = ei.tenant_id
              ON CONFLICT (tenant_id, snapshot_date) DO UPDATE
              SET empire_index = EXCLUDED.empire_index,
                  status = EXCLUDED.status$$
        );

        -- Expire silence windows (toutes les heures)
        PERFORM cron.schedule(
            'aegis-expire-silence',
            '0 * * * *',
            'SELECT guardrails.expire_silence_windows()'
        );

        -- Expire cross-tenant patterns (quotidien)
        PERFORM cron.schedule(
            'aegis-expire-patterns',
            '30 0 * * *',
            $$UPDATE guardrails.cross_tenant_patterns
              SET status = 'EXPIRED'
              WHERE status = 'QUALIFIED' AND expires_at <= now()$$
        );
    END IF;
END $$;
