-- ============================================================
-- Migration 029 — AEGIS v3.9
-- LLM Audit · Guardrail Calibrator · Chaos Testing infra
-- Decision Inspector · Webhooks · Shadow Mode reporting
-- ============================================================

-- ── 1. LLM AUDIT LOG ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS llm_call_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID REFERENCES shops(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  call_purpose    TEXT NOT NULL,  -- 'dct_brief'|'creative_tag'|'insight'|'brief'|'recommendation'|'forecast_narrative'
  model           TEXT NOT NULL DEFAULT 'claude-sonnet-4-5',
  input_tokens    INTEGER NOT NULL DEFAULT 0,
  output_tokens   INTEGER NOT NULL DEFAULT 0,
  estimated_cost_usd NUMERIC(8,6) GENERATED ALWAYS AS (
    (input_tokens * 0.000003) + (output_tokens * 0.000015)
  ) STORED,
  latency_ms      INTEGER,
  output_used     BOOLEAN,         -- was the output actually applied?
  decision_changed BOOLEAN,        -- did it change the outcome vs rule-based?
  quality_score   NUMERIC(3,2),    -- 0-1, rated by AGENT_EVALUATOR
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_llm_log_agent ON llm_call_log(shop_id, agent_name, created_at DESC);
CREATE INDEX idx_llm_log_purpose ON llm_call_log(shop_id, call_purpose, created_at DESC);

-- LLM cost summary per agent per day
CREATE MATERIALIZED VIEW IF NOT EXISTS llm_cost_summary AS
SELECT
  shop_id,
  DATE(created_at) AS day,
  agent_name,
  call_purpose,
  COUNT(*)              AS call_count,
  SUM(input_tokens)     AS total_input_tokens,
  SUM(output_tokens)    AS total_output_tokens,
  SUM(estimated_cost_usd) AS total_cost_usd,
  AVG(latency_ms)       AS avg_latency_ms,
  AVG(CASE WHEN output_used THEN 1.0 ELSE 0.0 END) AS usage_rate,
  AVG(quality_score)    AS avg_quality
FROM llm_call_log
GROUP BY shop_id, DATE(created_at), agent_name, call_purpose;

-- ── 2. GUARDRAIL CALIBRATION ──────────────────────────────────
CREATE TABLE IF NOT EXISTS guardrail_calibration_proposals (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  proposed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  guardrail_key   TEXT NOT NULL,
  current_value   NUMERIC(12,2) NOT NULL,
  proposed_value  NUMERIC(12,2) NOT NULL,
  delta_pct       NUMERIC(6,2) GENERATED ALWAYS AS (
    CASE WHEN current_value > 0
    THEN ((proposed_value - current_value) / current_value) * 100
    ELSE 0 END
  ) STORED,
  rationale       TEXT NOT NULL,
  evidence        JSONB NOT NULL DEFAULT '{}',
  status          TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected','auto_applied')),
  reviewed_by     TEXT,
  reviewed_at     TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_guardrail_prop_shop ON guardrail_calibration_proposals(shop_id, status, proposed_at DESC);

-- ── 3. CHAOS TEST RESULTS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS chaos_test_runs (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID REFERENCES shops(id) ON DELETE CASCADE,
  run_by          TEXT,
  scenario        TEXT NOT NULL,  -- 'db_slow'|'redis_down'|'api_timeout'|'bad_data'|'agent_loop'
  started_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at    TIMESTAMPTZ,
  duration_ms     INTEGER,
  passed          BOOLEAN,
  failures        JSONB NOT NULL DEFAULT '[]',
  -- [{component, expected_behavior, actual_behavior, passed}]
  recovery_time_ms INTEGER,  -- how long to recover after fault injected
  notes           TEXT
);

-- ── 4. DECISION INSPECTOR STATE ───────────────────────────────
-- agent_decisions already exists from v3.5 — add human-readable view
CREATE OR REPLACE VIEW decision_inspector AS
SELECT
  ad.id,
  ad.shop_id,
  ad.agent_name,
  ad.decision_type,
  ad.subject_type,
  ad.subject_id,
  ad.decision_made,
  ad.confidence,
  ad.executed,
  ad.executed_at,
  ad.created_at,
  -- World state snapshot
  ad.world_state_snapshot,
  -- Memory keys consulted
  ad.memory_keys_consulted,
  -- Rules evaluated
  ad.rules_evaluated,
  -- LLM reasoning
  ad.llm_reasoning,
  -- Deliberation result (if any)
  adel.outcome      AS deliberation_outcome,
  adel.veto_reason  AS deliberation_veto,
  -- Outcome (6h later)
  ao.outcome_score,
  ao.metrics_before,
  ao.metrics_after,
  ao.evaluated_at   AS outcome_evaluated_at,
  -- Human readable summary
  CASE
    WHEN ao.outcome_score >= 0.7  THEN 'good_decision'
    WHEN ao.outcome_score >= 0.3  THEN 'neutral'
    WHEN ao.outcome_score IS NULL THEN 'pending'
    ELSE 'bad_decision'
  END AS verdict
FROM agent_decisions ad
LEFT JOIN agent_deliberations adel ON adel.decision_id = ad.id
LEFT JOIN action_outcomes ao ON ao.decision_id = ad.id;

-- ── 5. OUTGOING WEBHOOKS ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS webhook_endpoints (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  url             TEXT NOT NULL,
  secret          TEXT,              -- HMAC signing secret
  events          TEXT[] NOT NULL DEFAULT '{}',
  -- Events: anomaly_critical, dct_winner_found, brief_delivered,
  --         profitability_alert, human_override, forecast_ready,
  --         champion_found, stock_critical, agent_decision
  is_active       BOOLEAN NOT NULL DEFAULT true,
  last_triggered_at TIMESTAMPTZ,
  fail_count      INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS webhook_delivery_log (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  webhook_id      UUID NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
  event_type      TEXT NOT NULL,
  payload         JSONB NOT NULL,
  response_status INTEGER,
  response_body   TEXT,
  duration_ms     INTEGER,
  success         BOOLEAN NOT NULL DEFAULT false,
  attempt_number  INTEGER NOT NULL DEFAULT 1,
  delivered_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_webhook_shop ON webhook_endpoints(shop_id, is_active);
CREATE INDEX idx_webhook_log ON webhook_delivery_log(webhook_id, delivered_at DESC);

-- ── 6. SHADOW MODE REPORTING ──────────────────────────────────
CREATE TABLE IF NOT EXISTS shadow_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  decision_type   TEXT NOT NULL,
  subject_id      TEXT NOT NULL,
  shadow_decision JSONB NOT NULL,   -- what AEGIS would have done
  human_decision  JSONB,            -- what human actually did (if known)
  shadow_outcome  JSONB,            -- simulated outcome estimate
  human_outcome   JSONB,            -- actual outcome after human action
  estimated_delta NUMERIC(10,2),    -- estimated revenue diff shadow vs human
  delta_computed  BOOLEAN NOT NULL DEFAULT false,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shadow_reports (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  period_start    DATE NOT NULL,
  period_end      DATE NOT NULL,
  total_shadow_decisions INTEGER NOT NULL DEFAULT 0,
  aegis_would_have_scaled  INTEGER NOT NULL DEFAULT 0,
  aegis_would_have_killed  INTEGER NOT NULL DEFAULT 0,
  estimated_revenue_delta  NUMERIC(12,2) NOT NULL DEFAULT 0,
  -- positive = AEGIS would have made more money
  agreement_rate  NUMERIC(4,3) NOT NULL DEFAULT 0,
  -- % of decisions that match what human did
  top_divergences JSONB NOT NULL DEFAULT '[]',
  recommendation  TEXT,
  generated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, period_start, period_end)
);

CREATE INDEX idx_shadow_shop ON shadow_decisions(shop_id, created_at DESC);

-- RLS
ALTER TABLE llm_call_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE guardrail_calibration_proposals ENABLE ROW LEVEL SECURITY;
ALTER TABLE chaos_test_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_delivery_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE shadow_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY llm_t   ON llm_call_log USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY gcp_t   ON guardrail_calibration_proposals USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY ctr_t   ON chaos_test_runs USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY whe_t   ON webhook_endpoints USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY sd_t    ON shadow_decisions USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY sr_t    ON shadow_reports USING (shop_id = current_setting('app.shop_id')::UUID);

COMMENT ON TABLE llm_call_log IS 'AEGIS v3.9 — Every LLM call logged with cost and value impact';
COMMENT ON TABLE guardrail_calibration_proposals IS 'AEGIS v3.9 — Monthly recalibration proposals with evidence';
COMMENT ON VIEW decision_inspector IS 'AEGIS v3.9 — Human-readable decision audit trail';
COMMENT ON TABLE webhook_endpoints IS 'AEGIS v3.9 — Outgoing webhooks to Notion, Zapier, Make, etc.';
COMMENT ON TABLE shadow_reports IS 'AEGIS v3.9 — Shadow mode: what AEGIS would have done vs human decisions';
