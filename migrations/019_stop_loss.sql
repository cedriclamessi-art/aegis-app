-- ============================================================
-- MIGRATION 019 — AGENT_STOP_LOSS : Moteur Stop-Loss + Revive
-- ============================================================
-- Philosophie :
--   Le stop-loss Madgicx est un kill-switch binaire.
--   AEGIS fait mieux : règles multi-critères par entité
--   (ad / adset / campaign), avec Revive automatique conditionnel.
--
-- Différence clé vs ops.stop_loss existant :
--   ops.stop_loss = kill-switch GLOBAL (coupe tout le compte)
--   risk.stop_loss_rules = règles GRANULAIRES par entité
--   → pause un ad précis, pas toute la campagne
--
-- Ce qu'on AJOUTE :
--   1. risk.stop_loss_rules      → règles configurables par tenant/entité
--   2. risk.stop_loss_actions    → log de chaque pause/revive
--   3. Vue risk.ad_health_now    → état de santé temps réel par ad
--   4. Fonction risk.eval_entity() → évalue une entité contre ses règles
--   5. Cron AGENT_STOP_LOSS      → scan toutes les 15min
-- ============================================================

-- ╔════════════════════════════════════════════════════════════╗
-- ║  1. risk.stop_loss_rules                                   ║
-- ║  Règles configurables — une règle = un seuil + une action  ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS risk.stop_loss_rules (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,

    -- Nom de la règle
    name            VARCHAR(200) NOT NULL,
    is_active       BOOLEAN NOT NULL DEFAULT TRUE,

    -- Scope : à quelle entité s'applique cette règle
    scope_entity_type   VARCHAR(20) NOT NULL DEFAULT 'ad',
    -- ad | adset | campaign | all
    scope_campaign_type VARCHAR(30),
    -- prospecting | retargeting | remarketing | null = toutes
    scope_platform      VARCHAR(20) DEFAULT 'meta',
    -- meta | tiktok | google | all

    -- ── Critère de déclenchement (STOP) ──────────────────────
    -- Plusieurs critères possibles, tous doivent être remplis (AND)
    -- sauf si use_or_logic = TRUE (OR)
    use_or_logic        BOOLEAN NOT NULL DEFAULT FALSE,

    -- Seuils (null = critère désactivé)
    min_spend_eur       NUMERIC(10,2),   -- dépense min avant d'appliquer la règle
    max_cpa_eur         NUMERIC(10,2),   -- CPA > X → pause
    min_roas            NUMERIC(6,4),    -- ROAS < X → pause
    min_ctr             NUMERIC(8,6),    -- CTR < X → pause
    max_cpm_eur         NUMERIC(10,2),   -- CPM > X → pause (ad fatigue)
    max_frequency       NUMERIC(6,2),    -- Fréquence > X → pause
    no_conv_after_spend NUMERIC(10,2),   -- 0 conversion après X€ dépensés → pause
    no_conv_after_hours INTEGER,         -- 0 conversion après X heures actives → pause
    min_impressions     INTEGER,         -- min impressions pour activer la règle

    -- Fenêtre d'évaluation
    window_hours        INTEGER NOT NULL DEFAULT 24,
    -- Évalue sur les N dernières heures

    -- ── Action au déclenchement ───────────────────────────────
    action_on_trigger   VARCHAR(20) NOT NULL DEFAULT 'pause',
    -- pause | reduce_budget | alert_only
    budget_reduction_pct  INTEGER,  -- si action = reduce_budget (ex: 50)

    -- ── Critère de Revive (REPRISE) ──────────────────────────
    revive_enabled      BOOLEAN NOT NULL DEFAULT TRUE,
    revive_after_hours  INTEGER NOT NULL DEFAULT 24,
    -- Minimum X heures de pause avant de réévaluer

    -- Conditions pour le revive (null = revive automatique après délai)
    revive_min_roas     NUMERIC(6,4),   -- ROAS doit avoir remonté à X sur les dernières heures
    revive_max_cpa_eur  NUMERIC(10,2),  -- CPA doit être < X sur les dernières heures
    revive_window_hours INTEGER DEFAULT 6,
    -- Fenêtre pour évaluer les conditions de revive

    -- Limites
    max_revives_per_day INTEGER DEFAULT 2,
    -- Évite les cycles pause/revive infinis

    -- Priorité (plus haute = évaluée en premier)
    priority            INTEGER NOT NULL DEFAULT 50,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sl_rules_tenant   ON risk.stop_loss_rules(tenant_id);
CREATE INDEX idx_sl_rules_active   ON risk.stop_loss_rules(is_active, tenant_id);
CREATE INDEX idx_sl_rules_scope    ON risk.stop_loss_rules(scope_entity_type, scope_platform);

-- ╔════════════════════════════════════════════════════════════╗
-- ║  2. risk.stop_loss_actions                                 ║
-- ║  Journal de chaque pause / revive / reduce_budget         ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE TABLE IF NOT EXISTS risk.stop_loss_actions (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id       UUID NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    rule_id         UUID REFERENCES risk.stop_loss_rules(id),

    -- Entité affectée
    entity_id       UUID REFERENCES ads.entities(id),
    entity_type     VARCHAR(20) NOT NULL,   -- ad | adset | campaign
    external_id     VARCHAR(200),           -- Meta ad_id, TikTok ad_id...
    platform        VARCHAR(20),

    -- Action exécutée
    action          VARCHAR(20) NOT NULL,   -- pause | revive | reduce_budget | alert
    triggered_by    VARCHAR(50) NOT NULL,   -- AGENT_STOP_LOSS | MANUAL | SYSTEM

    -- Valeurs au moment du déclenchement
    spend_at_trigger    NUMERIC(10,2),
    roas_at_trigger     NUMERIC(8,4),
    cpa_at_trigger      NUMERIC(10,2),
    ctr_at_trigger      NUMERIC(8,6),
    cpm_at_trigger      NUMERIC(10,2),
    frequency_at_trigger NUMERIC(6,2),
    conversions_at_trigger INTEGER,

    -- Raison textuelle
    reason          TEXT NOT NULL,

    -- Résultat de l'appel API
    api_success     BOOLEAN,
    api_response    JSONB,
    api_error       TEXT,

    -- Durée de pause (rempli au Revive)
    paused_at       TIMESTAMPTZ,
    revived_at      TIMESTAMPTZ,
    pause_duration_hours NUMERIC(6,2)
            GENERATED ALWAYS AS (
                EXTRACT(EPOCH FROM (revived_at - paused_at)) / 3600
            ) STORED,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_sl_actions_tenant   ON risk.stop_loss_actions(tenant_id, created_at DESC);
CREATE INDEX idx_sl_actions_entity   ON risk.stop_loss_actions(entity_id);
CREATE INDEX idx_sl_actions_action   ON risk.stop_loss_actions(action, created_at DESC);
-- Index pour trouver rapidement les entités actuellement en pause
CREATE INDEX idx_sl_actions_paused   ON risk.stop_loss_actions(entity_id, paused_at)
    WHERE revived_at IS NULL AND action = 'pause';

-- ╔════════════════════════════════════════════════════════════╗
-- ║  3. Vue risk.ad_health_now                                 ║
-- ║  État de santé temps réel de chaque ad (24h glissantes)   ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE OR REPLACE VIEW risk.ad_health_now AS
SELECT
    e.id                AS entity_id,
    e.tenant_id,
    e.platform,
    e.entity_type,
    e.external_id,
    e.name              AS entity_name,
    e.status            AS current_status,
    e.daily_budget,

    -- KPIs 24h glissantes
    COALESCE(SUM(p.spend), 0)        AS spend_24h,
    COALESCE(SUM(p.impressions), 0)  AS impressions_24h,
    COALESCE(SUM(p.clicks), 0)       AS clicks_24h,
    COALESCE(SUM(p.conversions), 0)  AS conversions_24h,
    COALESCE(SUM(p.revenue), 0)      AS revenue_24h,

    -- Ratios calculés
    CASE WHEN COALESCE(SUM(p.spend), 0) > 0
         THEN ROUND(SUM(p.revenue) / SUM(p.spend), 4)
         ELSE NULL END                AS roas_24h,

    CASE WHEN COALESCE(SUM(p.conversions), 0) > 0
         THEN ROUND(SUM(p.spend) / SUM(p.conversions), 2)
         ELSE NULL END                AS cpa_24h,

    CASE WHEN COALESCE(SUM(p.impressions), 0) > 0
         THEN ROUND(SUM(p.clicks)::numeric / SUM(p.impressions), 6)
         ELSE NULL END                AS ctr_24h,

    CASE WHEN COALESCE(SUM(p.impressions), 0) > 0
         THEN ROUND(SUM(p.spend) / SUM(p.impressions) * 1000, 2)
         ELSE NULL END                AS cpm_24h,

    -- Pause en cours ?
    EXISTS(
        SELECT 1 FROM risk.stop_loss_actions sla
        WHERE sla.entity_id = e.id
          AND sla.action = 'pause'
          AND sla.revived_at IS NULL
    )                                 AS is_paused_by_stop_loss,

    -- Dernière action stop-loss
    (SELECT sla.reason
     FROM risk.stop_loss_actions sla
     WHERE sla.entity_id = e.id
     ORDER BY sla.created_at DESC LIMIT 1
    )                                 AS last_stop_loss_reason,

    (SELECT sla.created_at
     FROM risk.stop_loss_actions sla
     WHERE sla.entity_id = e.id AND sla.action = 'pause' AND sla.revived_at IS NULL
     ORDER BY sla.created_at DESC LIMIT 1
    )                                 AS paused_since

FROM ads.entities e
LEFT JOIN ads.performance_hourly p
    ON p.entity_id = e.id
    AND p.hour >= NOW() - INTERVAL '24 hours'
WHERE e.status NOT IN ('deleted', 'archived')
GROUP BY e.id, e.tenant_id, e.platform, e.entity_type,
         e.external_id, e.name, e.status, e.daily_budget;

-- ╔════════════════════════════════════════════════════════════╗
-- ║  4. Fonction risk.eval_entity()                            ║
-- ║  Évalue une entité contre toutes ses règles actives       ║
-- ╚════════════════════════════════════════════════════════════╝
CREATE OR REPLACE FUNCTION risk.eval_entity(
    p_entity_id UUID,
    p_tenant_id UUID
)
RETURNS TABLE (
    rule_id         UUID,
    rule_name       VARCHAR,
    action          VARCHAR,
    triggered       BOOLEAN,
    reason          TEXT,
    spend           NUMERIC,
    roas            NUMERIC,
    cpa             NUMERIC,
    ctr             NUMERIC,
    cpm             NUMERIC,
    conversions     BIGINT
) AS $$
DECLARE
    v_entity    RECORD;
    v_perf      RECORD;
    v_rule      RECORD;
    v_triggered BOOLEAN;
    v_reason    TEXT;
BEGIN
    -- Charger l'entité
    SELECT e.*, e.entity_type AS etype
    INTO v_entity
    FROM ads.entities e
    WHERE e.id = p_entity_id AND e.tenant_id = p_tenant_id;

    IF NOT FOUND THEN RETURN; END IF;

    -- Charger les règles applicables
    FOR v_rule IN
        SELECT r.*
        FROM risk.stop_loss_rules r
        WHERE r.tenant_id = p_tenant_id
          AND r.is_active = TRUE
          AND (r.scope_entity_type = v_entity.entity_type OR r.scope_entity_type = 'all')
          AND (r.scope_platform = v_entity.platform OR r.scope_platform = 'all' OR r.scope_platform IS NULL)
        ORDER BY r.priority DESC
    LOOP
        -- Calculer les KPIs sur la fenêtre de la règle
        SELECT
            COALESCE(SUM(p.spend), 0)        AS spend,
            COALESCE(SUM(p.conversions), 0)  AS convs,
            COALESCE(SUM(p.revenue), 0)      AS revenue,
            COALESCE(SUM(p.clicks), 0)       AS clicks,
            COALESCE(SUM(p.impressions), 0)  AS imps
        INTO v_perf
        FROM ads.performance_hourly p
        WHERE p.entity_id = p_entity_id
          AND p.hour >= NOW() - (v_rule.window_hours || ' hours')::INTERVAL;

        -- Calcul des ratios
        DECLARE
            v_roas NUMERIC := CASE WHEN v_perf.spend > 0 THEN ROUND(v_perf.revenue / v_perf.spend, 4) ELSE NULL END;
            v_cpa  NUMERIC := CASE WHEN v_perf.convs > 0 THEN ROUND(v_perf.spend / v_perf.convs, 2) ELSE NULL END;
            v_ctr  NUMERIC := CASE WHEN v_perf.imps > 0 THEN ROUND(v_perf.clicks::numeric / v_perf.imps, 6) ELSE NULL END;
            v_cpm  NUMERIC := CASE WHEN v_perf.imps > 0 THEN ROUND(v_perf.spend / v_perf.imps * 1000, 2) ELSE NULL END;
            v_criteria_met INTEGER := 0;
            v_criteria_total INTEGER := 0;
            v_reasons TEXT[] := '{}';
        BEGIN
            -- Vérifier chaque critère activé
            -- 1. Dépense min atteinte ?
            IF v_rule.min_spend_eur IS NOT NULL AND v_perf.spend < v_rule.min_spend_eur THEN
                -- Pas assez de données, ne pas évaluer
                CONTINUE;
            END IF;

            -- 2. ROAS trop bas
            IF v_rule.min_roas IS NOT NULL AND v_roas IS NOT NULL THEN
                v_criteria_total := v_criteria_total + 1;
                IF v_roas < v_rule.min_roas THEN
                    v_criteria_met := v_criteria_met + 1;
                    v_reasons := v_reasons || format('ROAS %.2f < seuil %.2f', v_roas, v_rule.min_roas);
                END IF;
            END IF;

            -- 3. CPA trop élevé
            IF v_rule.max_cpa_eur IS NOT NULL AND v_cpa IS NOT NULL THEN
                v_criteria_total := v_criteria_total + 1;
                IF v_cpa > v_rule.max_cpa_eur THEN
                    v_criteria_met := v_criteria_met + 1;
                    v_reasons := v_reasons || format('CPA %.2f€ > seuil %.2f€', v_cpa, v_rule.max_cpa_eur);
                END IF;
            END IF;

            -- 4. CTR trop bas
            IF v_rule.min_ctr IS NOT NULL AND v_ctr IS NOT NULL THEN
                v_criteria_total := v_criteria_total + 1;
                IF v_ctr < v_rule.min_ctr THEN
                    v_criteria_met := v_criteria_met + 1;
                    v_reasons := v_reasons || format('CTR %.4f%% < seuil %.4f%%', v_ctr*100, v_rule.min_ctr*100);
                END IF;
            END IF;

            -- 5. CPM trop élevé (ad fatigue)
            IF v_rule.max_cpm_eur IS NOT NULL AND v_cpm IS NOT NULL THEN
                v_criteria_total := v_criteria_total + 1;
                IF v_cpm > v_rule.max_cpm_eur THEN
                    v_criteria_met := v_criteria_met + 1;
                    v_reasons := v_reasons || format('CPM %.2f€ > seuil %.2f€', v_cpm, v_rule.max_cpm_eur);
                END IF;
            END IF;

            -- 6. 0 conversions après X€ dépensés
            IF v_rule.no_conv_after_spend IS NOT NULL THEN
                v_criteria_total := v_criteria_total + 1;
                IF v_perf.spend >= v_rule.no_conv_after_spend AND v_perf.convs = 0 THEN
                    v_criteria_met := v_criteria_met + 1;
                    v_reasons := v_reasons || format('0 conversion après %.0f€ dépensés', v_perf.spend);
                END IF;
            END IF;

            -- Évaluation finale (AND vs OR)
            IF v_criteria_total = 0 THEN
                v_triggered := FALSE;
                v_reason := 'Aucun critère actif';
            ELSIF v_rule.use_or_logic THEN
                v_triggered := v_criteria_met > 0;
            ELSE
                v_triggered := v_criteria_met = v_criteria_total;
            END IF;

            v_reason := CASE WHEN array_length(v_reasons, 1) > 0
                              THEN array_to_string(v_reasons, ' | ')
                              ELSE 'Seuils respectés' END;

            RETURN QUERY SELECT
                v_rule.id, v_rule.name, v_rule.action_on_trigger,
                v_triggered, v_reason,
                v_perf.spend, v_roas, v_cpa, v_ctr, v_cpm, v_perf.convs;
        END;
    END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ╔════════════════════════════════════════════════════════════╗
-- ║  5. Règles par défaut (seed data)                          ║
-- ║  Configurées pour la plupart des comptes DTC              ║
-- ╚════════════════════════════════════════════════════════════╝
-- Note : ces règles sont globales (sans tenant_id).
-- Lors de l'onboarding d'un tenant, on les clone avec son tenant_id.

-- Fonction pour cloner les règles par défaut à l'onboarding
CREATE OR REPLACE FUNCTION risk.init_default_rules(p_tenant_id UUID)
RETURNS INTEGER AS $$
DECLARE
    v_count INTEGER := 0;
BEGIN
    -- Règle 1 : Dead ad — dépense sans résultat
    INSERT INTO risk.stop_loss_rules (
        tenant_id, name, scope_entity_type, scope_platform,
        min_spend_eur, no_conv_after_spend,
        action_on_trigger, revive_enabled, revive_after_hours,
        window_hours, priority
    ) VALUES (
        p_tenant_id, '🔴 Dead Ad — Spend sans conversion',
        'ad', 'meta',
        10, 15,   -- actif après 10€ dépensés, pause si 0 conv après 15€
        'pause', TRUE, 48,
        24, 100
    );
    v_count := v_count + 1;

    -- Règle 2 : ROAS catastrophique
    INSERT INTO risk.stop_loss_rules (
        tenant_id, name, scope_entity_type, scope_platform,
        min_spend_eur, min_roas, min_impressions,
        action_on_trigger, revive_enabled, revive_after_hours, revive_min_roas,
        window_hours, priority
    ) VALUES (
        p_tenant_id, '🔴 ROAS Catastrophique < 0.5x',
        'ad', 'meta',
        20, 0.5, 500,
        'pause', TRUE, 24, 1.0,
        24, 90
    );
    v_count := v_count + 1;

    -- Règle 3 : CPA hors contrôle (dépend du produit — à personnaliser)
    INSERT INTO risk.stop_loss_rules (
        tenant_id, name, scope_entity_type, scope_platform,
        min_spend_eur, max_cpa_eur, min_impressions,
        action_on_trigger, revive_enabled, revive_after_hours, revive_max_cpa_eur,
        window_hours, priority
    ) VALUES (
        p_tenant_id, '🟠 CPA Élevé > 3× objectif',
        'ad', 'meta',
        15, 90, 300,   -- pause si CPA > 90€ (à ajuster selon produit)
        'pause', TRUE, 24, 45,
        24, 80
    );
    v_count := v_count + 1;

    -- Règle 4 : Ad fatigue (CPM explosif)
    INSERT INTO risk.stop_loss_rules (
        tenant_id, name, scope_entity_type, scope_platform,
        min_spend_eur, max_cpm_eur, max_frequency,
        use_or_logic,
        action_on_trigger, revive_enabled, revive_after_hours,
        window_hours, priority
    ) VALUES (
        p_tenant_id, '🟡 Ad Fatigue — CPM ou Fréquence trop élevés',
        'ad', 'meta',
        30, 25.0, 4.5,  -- CPM > 25€ OU fréquence > 4.5
        TRUE,           -- OR logic : l'un ou l'autre suffit
        'pause', TRUE, 48,
        48, 70
    );
    v_count := v_count + 1;

    -- Règle 5 : CTR effondré (creative épuisé)
    INSERT INTO risk.stop_loss_rules (
        tenant_id, name, scope_entity_type, scope_platform,
        min_spend_eur, min_ctr, min_impressions,
        action_on_trigger, revive_enabled, revive_after_hours,
        window_hours, priority
    ) VALUES (
        p_tenant_id, '🟡 CTR Effondré — Creative épuisé',
        'ad', 'meta',
        20, 0.005, 1000,  -- CTR < 0.5% après 1000 impressions
        'pause', FALSE, 72,   -- pas de revive auto (creative à renouveler)
        24, 60
    );
    v_count := v_count + 1;

    -- Règle 6 : Adset brûle budget sans traction
    INSERT INTO risk.stop_loss_rules (
        tenant_id, name, scope_entity_type, scope_platform,
        min_spend_eur, min_roas, no_conv_after_spend,
        action_on_trigger, budget_reduction_pct,
        revive_enabled, revive_after_hours, revive_min_roas,
        window_hours, priority
    ) VALUES (
        p_tenant_id, '🟠 Adset Sous-performant — Réduction budget 50%',
        'adset', 'meta',
        25, 0.8, 25,
        'reduce_budget', 50,  -- réduit le budget de 50% au lieu de pauser
        TRUE, 12, 1.5,
        12, 75
    );
    v_count := v_count + 1;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- ╔════════════════════════════════════════════════════════════╗
-- ║  6. RLS                                                    ║
-- ╚════════════════════════════════════════════════════════════╝
ALTER TABLE risk.stop_loss_rules   ENABLE ROW LEVEL SECURITY;
ALTER TABLE risk.stop_loss_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON risk.stop_loss_rules
    USING (tenant_id = current_setting('app.tenant_id')::uuid);
CREATE POLICY tenant_isolation ON risk.stop_loss_actions
    USING (tenant_id = current_setting('app.tenant_id')::uuid);

-- ╔════════════════════════════════════════════════════════════╗
-- ║  7. Enregistrement agent + cron                            ║
-- ╚════════════════════════════════════════════════════════════╝
INSERT INTO agents.registry (agent_id, display_name, tier, schedule_cron, is_active, description)
VALUES (
    'AGENT_STOP_LOSS',
    'Stop-Loss & Revive Engine',
    'hedge_fund',
    '*/15 * * * *',   -- toutes les 15 minutes
    TRUE,
    'Surveille chaque ad/adset en temps réel. Pause les entités sous-performantes selon des règles multi-critères configurables (ROAS, CPA, CTR, CPM, fréquence, spend sans conversion). Revive automatique conditionnel après délai si les métriques s''améliorent.'
) ON CONFLICT (agent_id) DO UPDATE
    SET description = EXCLUDED.description,
        schedule_cron = EXCLUDED.schedule_cron;

-- Trigger updated_at
CREATE TRIGGER set_updated_at BEFORE UPDATE ON risk.stop_loss_rules
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON TABLE risk.stop_loss_rules IS 'Règles multi-critères granulaires par ad/adset/campaign. Supérieur au stop-loss global ops.kill_switches.';
COMMENT ON TABLE risk.stop_loss_actions IS 'Journal immuable de chaque pause/revive avec métriques au déclenchement.';
COMMENT ON VIEW  risk.ad_health_now IS 'État de santé temps réel de chaque entité publicitaire (24h glissantes).';
