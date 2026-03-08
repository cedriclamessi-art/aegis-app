-- ============================================================
-- MIGRATION 010 \u2014 SYST\u00c8ME DE PHASES + UNLOCK AUTOMATIQUE
-- ============================================================
-- Phase 0 : 3 agents actifs (INGEST, MARKET_ANALYSE, COPY)
-- Unlock   : 1000\u20ac/jour \u2192 tous les agents se r\u00e9veillent
-- ============================================================

-- \u2500\u2500 1. Colonne status sur agents.registry \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

ALTER TABLE agents.registry
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'standby'
    CHECK (status IN ('active', 'standby', 'disabled')),
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS activation_reason TEXT;

-- Phase 0 : seuls 3 agents actifs
UPDATE agents.registry SET status = 'standby', activated_at = NULL;

UPDATE agents.registry
SET status = 'active', activated_at = NOW(), activation_reason = 'phase_0_bootstrap'
WHERE agent_id IN (
  'AGENT_INGEST',
  'AGENT_MARKET_ANALYSE',
  'AGENT_COPY'
);

CREATE INDEX IF NOT EXISTS idx_registry_status ON agents.registry (status);

-- \u2500\u2500 2. Table de configuration des phases \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

CREATE TABLE IF NOT EXISTS ops.phase_config (
    id                   SERIAL PRIMARY KEY,
    phase_name           VARCHAR(30) NOT NULL,
    -- phase_0 | phase_1 | phase_2 | ...
    unlock_threshold_eur DECIMAL(12,2) NOT NULL,
    -- Seuil en \u20ac CA/jour pour d\u00e9clencher cette phase
    unlock_window_days   INTEGER NOT NULL DEFAULT 1,
    -- Nombre de jours cons\u00e9cutifs au-dessus du seuil requis (anti-spike)
    is_unlocked          BOOLEAN NOT NULL DEFAULT FALSE,
    unlocked_at          TIMESTAMPTZ,
    unlocked_by          VARCHAR(100),
    -- 'auto_threshold' | 'manual:user_id'
    agents_to_unlock     JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- Liste des agent_ids \u00e0 activer quand ce seuil est atteint
    description          TEXT,
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Phase 1 : unlock \u00e0 1000\u20ac/jour \u2014 tous les agents restants se r\u00e9veillent
INSERT INTO ops.phase_config
  (phase_name, unlock_threshold_eur, unlock_window_days, agents_to_unlock, description)
VALUES (
  'phase_1',
  1000.00,
  1,  -- 1 jour au-dessus du seuil suffit
  '[
    "AGENT_OFFER",
    "AGENT_CREATIVE",
    "AGENT_STORE_BUILDER",
    "AGENT_MEDIA_BUYER",
    "AGENT_ANALYTICS",
    "AGENT_OPS_GUARD",
    "AGENT_STRATEGY_ORGANIC",
    "AGENT_RISK_ENGINE",
    "AGENT_BUDGET_ALLOCATOR",
    "AGENT_PORTFOLIO_OPT",
    "AGENT_FRAUD_GUARD",
    "AGENT_RECOVERY",
    "AGENT_ORCHESTRATOR",
    "AGENT_POLICY_GOVERNOR",
    "AGENT_MARKET_INTEL",
    "AGENT_LEARNING",
    "AGENT_EXPERIMENTS",
    "AGENT_HEALTH_SRE",
    "AGENT_LEGAL_SCRAPING",
    "AGENT_INNOVATION",
    "AGENT_PSYCHO_MARKETING"
  ]'::jsonb,
  'Seuil 1000\u20ac/jour \u2192 d\u00e9verrouillage de tous les agents. D\u00e9but de l''organisme complet.'
) ON CONFLICT DO NOTHING;

-- \u2500\u2500 3. Table de tracking du CA journalier \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

CREATE TABLE IF NOT EXISTS ops.revenue_daily (
    id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    tenant_id   UUID        NOT NULL REFERENCES saas.tenants(id) ON DELETE CASCADE,
    date        DATE        NOT NULL,
    revenue_eur DECIMAL(12,2) NOT NULL DEFAULT 0,
    order_count INTEGER     NOT NULL DEFAULT 0,
    source      VARCHAR(50) NOT NULL DEFAULT 'shopify',
    -- shopify | stripe | manual
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_revenue_tenant_date UNIQUE (tenant_id, date, source)
);

ALTER TABLE ops.revenue_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE ops.revenue_daily FORCE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON ops.revenue_daily
    USING     (tenant_id = current_setting('app.tenant_id', TRUE)::UUID)
    WITH CHECK (tenant_id = current_setting('app.tenant_id', TRUE)::UUID);

CREATE INDEX IF NOT EXISTS idx_rev_daily_tenant_date ON ops.revenue_daily (tenant_id, date DESC);

-- \u2500\u2500 4. Fonction de v\u00e9rification du seuil + unlock \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

CREATE OR REPLACE FUNCTION ops.check_and_unlock_phases(p_tenant_id UUID)
RETURNS TABLE (
    phase_unlocked VARCHAR(30),
    agents_activated INTEGER,
    revenue_today DECIMAL
) LANGUAGE plpgsql AS $$
DECLARE
  v_revenue_today DECIMAL(12,2);
  v_phase         ops.phase_config%ROWTYPE;
  v_agent_id      TEXT;
  v_activated     INTEGER := 0;
BEGIN
  -- CA du jour pour ce tenant
  SELECT COALESCE(SUM(revenue_eur), 0) INTO v_revenue_today
  FROM ops.revenue_daily
  WHERE tenant_id = p_tenant_id AND date = CURRENT_DATE;

  -- V\u00e9rifier chaque phase non encore d\u00e9verrouill\u00e9e
  FOR v_phase IN
    SELECT * FROM ops.phase_config
    WHERE is_unlocked = FALSE
    ORDER BY unlock_threshold_eur ASC
  LOOP
    -- Seuil atteint ?
    IF v_revenue_today >= v_phase.unlock_threshold_eur THEN

      -- Activer chaque agent de cette phase
      FOR v_agent_id IN
        SELECT jsonb_array_elements_text(v_phase.agents_to_unlock)
      LOOP
        UPDATE agents.registry
        SET
          status           = 'active',
          activated_at     = NOW(),
          activation_reason = 'auto_unlock_' || v_phase.phase_name || '_threshold_' || v_phase.unlock_threshold_eur::TEXT || 'eur',
          updated_at       = NOW()
        WHERE agent_id = v_agent_id AND status = 'standby';

        IF FOUND THEN v_activated := v_activated + 1; END IF;
      END LOOP;

      -- Marquer la phase comme d\u00e9verrouill\u00e9e
      UPDATE ops.phase_config
      SET
        is_unlocked  = TRUE,
        unlocked_at  = NOW(),
        unlocked_by  = 'auto_threshold'
      WHERE id = v_phase.id;

      -- Log immuable dans audit_log
      INSERT INTO ops.audit_log (tenant_id, action, metadata, created_at)
      VALUES (
        p_tenant_id,
        'phase_unlocked',
        jsonb_build_object(
          'phase',            v_phase.phase_name,
          'threshold_eur',    v_phase.unlock_threshold_eur,
          'revenue_today',    v_revenue_today,
          'agents_activated', v_activated
        ),
        NOW()
      );

      -- Injecter un BROADCAST dans agents.messages pour r\u00e9veiller tous les agents
      INSERT INTO agents.messages
        (tenant_id, from_agent, to_agent, message_type, subject, payload, priority, created_at)
      VALUES (
        p_tenant_id,
        'SYSTEM',
        NULL,  -- NULL = broadcast tous agents
        'BROADCAST',
        'PHASE_UNLOCK: ' || v_phase.phase_name,
        jsonb_build_object(
          'event',            'phase_unlocked',
          'phase',            v_phase.phase_name,
          'threshold_eur',    v_phase.unlock_threshold_eur,
          'revenue_today',    v_revenue_today,
          'agents_activated', v_activated,
          'instruction',      'Initialise-toi. Lis le contexte produit. Contacte tes agents partenaires. Commence ta mission.',
          'pipeline_context', (
            SELECT row_to_json(p) FROM store.pipeline_runs p
            WHERE p.tenant_id = p_tenant_id
            ORDER BY p.created_at DESC LIMIT 1
          )
        ),
        10,  -- priorit\u00e9 max
        NOW()
      );

      RETURN QUERY SELECT v_phase.phase_name, v_activated, v_revenue_today;
    END IF;
  END LOOP;
END;
$$;

-- \u2500\u2500 5. Modifier claim_next() : respecter agent.status \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500
-- Remplace la version pr\u00e9c\u00e9dente

CREATE OR REPLACE FUNCTION jobs.claim_next(
    p_worker_id  VARCHAR(100),
    p_task_types VARCHAR[] DEFAULT NULL
) RETURNS TABLE (
    id UUID, tenant_id UUID, task_type VARCHAR, payload JSONB,
    priority INT, pipeline_run_id UUID, correlation_id VARCHAR
) LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY
  WITH claimed AS (
    SELECT q.id FROM jobs.queue q
    JOIN saas.tenants t ON t.id = q.tenant_id
    JOIN agents.registry ar ON ar.agent_id = q.task_type
    WHERE q.status = 'pending'
      AND q.scheduled_at <= NOW()
      AND (q.next_retry_at IS NULL OR q.next_retry_at <= NOW())

      -- \u2605 NOUVEAU : agent doit \u00eatre actif (pas en standby)
      AND ar.status = 'active'

      -- Feature flag niveau
      AND (
        CASE ar.required_level
          WHEN 'basic'         THEN TRUE
          WHEN 'hedge_fund'    THEN t.agent_mode IN ('hedge_fund','full_organism')
          WHEN 'full_organism' THEN t.agent_mode = 'full_organism'
          ELSE FALSE
        END
      )
      -- Kill-switch global
      AND NOT EXISTS (
        SELECT 1 FROM ops.kill_switches ks
        WHERE ks.scope = 'global' AND ks.is_active = TRUE
          AND (ks.expires_at IS NULL OR ks.expires_at > NOW())
      )
      -- Kill-switch tenant
      AND NOT EXISTS (
        SELECT 1 FROM ops.kill_switches ks
        WHERE ks.scope = 'tenant' AND ks.tenant_id = q.tenant_id
          AND ks.is_active = TRUE
          AND (ks.expires_at IS NULL OR ks.expires_at > NOW())
      )
      -- Kill-switch agent
      AND NOT EXISTS (
        SELECT 1 FROM ops.kill_switches ks
        WHERE ks.scope = 'agent' AND ks.tenant_id = q.tenant_id
          AND ks.agent_id = q.task_type AND ks.is_active = TRUE
          AND (ks.expires_at IS NULL OR ks.expires_at > NOW())
      )
      -- Kill-switch capability (backpressure)
      AND NOT EXISTS (
        SELECT 1 FROM ops.kill_switches ks
        WHERE ks.scope = 'capability' AND ks.is_active = TRUE
          AND (ks.tenant_id IS NULL OR ks.tenant_id = q.tenant_id)
          AND (ks.expires_at IS NULL OR ks.expires_at > NOW())
          AND ks.capability = ANY(COALESCE(
            (SELECT ARRAY(SELECT jsonb_array_elements_text(ar2.capabilities))
             FROM agents.registry ar2 WHERE ar2.agent_id = q.task_type),
            ARRAY[]::TEXT[]
          ))
      )
      AND (p_task_types IS NULL OR q.task_type = ANY(p_task_types))
      AND (t.worker_throttle_pct = 0 OR random() > (t.worker_throttle_pct / 100.0))
    ORDER BY q.priority DESC, q.created_at ASC
    LIMIT 1
    FOR UPDATE OF q SKIP LOCKED
  )
  UPDATE jobs.queue q
  SET status = 'running', started_at = NOW(), worker_id = p_worker_id
  FROM claimed
  WHERE q.id = claimed.id
  RETURNING q.id, q.tenant_id, q.task_type, q.payload,
            q.priority, q.pipeline_run_id, q.correlation_id;
END;
$$;

-- \u2500\u2500 6. Cron : AGENT_OPS_GUARD v\u00e9rifie le seuil toutes les heures \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

INSERT INTO agents.schedule (
    agent_id, task_type, schedule_type,
    cron_expression, priority, enabled, description, created_at
) VALUES (
    'AGENT_OPS_GUARD',
    'ops.check_unlock_threshold',
    'cron',
    '0 * * * *',  -- toutes les heures pile
    9,
    TRUE,
    'V\u00e9rifie si le CA/jour d\u00e9passe 1000\u20ac \u2192 d\u00e9verrouille tous les agents en veille et envoie BROADCAST',
    NOW()
) ON CONFLICT (agent_id, task_type) DO UPDATE SET
    enabled = TRUE,
    priority = EXCLUDED.priority;

-- \u2500\u2500 7. Vue pratique : \u00e9tat du syst\u00e8me \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500

CREATE OR REPLACE VIEW ops.system_status AS
SELECT
    (SELECT COUNT(*) FROM agents.registry WHERE status = 'active')  AS agents_active,
    (SELECT COUNT(*) FROM agents.registry WHERE status = 'standby') AS agents_standby,
    (SELECT is_unlocked FROM ops.phase_config WHERE phase_name = 'phase_1') AS phase_1_unlocked,
    (SELECT unlocked_at FROM ops.phase_config WHERE phase_name = 'phase_1') AS phase_1_unlocked_at,
    (SELECT unlock_threshold_eur FROM ops.phase_config WHERE phase_name = 'phase_1') AS unlock_threshold_eur,
    (SELECT STRING_AGG(agent_id, ', ' ORDER BY agent_id)
     FROM agents.registry WHERE status = 'active') AS active_agents_list;

COMMENT ON VIEW ops.system_status IS
'Vue rapide de l''\u00e9tat du syst\u00e8me : agents actifs/en veille, seuil de d\u00e9verrouillage, phase actuelle.
SELECT * FROM ops.system_status;';
