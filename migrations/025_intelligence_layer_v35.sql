-- ============================================================
-- Migration 025 — AEGIS v3.5 Intelligence Layer
-- Shared memory · Deliberation · Feedback loop · Observability
-- Config versioning · Multi-shop · Anomaly detection
-- ============================================================

-- ── 1. AGENT MEMORY (Shared Context Store) ─────────────────
-- Each agent deposits observations here with TTL
-- Orchestrator consolidates into world_state before decisions

CREATE TABLE IF NOT EXISTS agent_memory (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_name  TEXT NOT NULL,
  memory_key  TEXT NOT NULL,           -- e.g. 'roas_trend_6h', 'cpa_signal', 'fatigue_index'
  memory_type TEXT NOT NULL CHECK (memory_type IN (
    'observation',   -- raw data point
    'signal',        -- processed signal (up/down/stable)
    'warning',       -- anomaly or risk
    'opportunity',   -- positive pattern
    'context'        -- background knowledge
  )),
  value       JSONB NOT NULL,          -- flexible payload
  confidence  NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1) DEFAULT 0.8,
  source_data JSONB,                   -- raw input that led to this memory
  expires_at  TIMESTAMPTZ NOT NULL,    -- TTL — most memories live 6-24h
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, agent_name, memory_key)  -- upsert by key
);

CREATE INDEX idx_agent_memory_shop_active ON agent_memory(shop_id, expires_at)
  WHERE expires_at > NOW();
CREATE INDEX idx_agent_memory_type ON agent_memory(shop_id, memory_type, expires_at);

-- ── 2. WORLD STATE (Consolidated view of agent memories) ────
-- Orchestrator writes this after consolidation every 15min
-- All agents READ from here before making decisions

CREATE TABLE IF NOT EXISTS world_state (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE UNIQUE,
  empire_index    NUMERIC(5,1) NOT NULL DEFAULT 0,
  empire_mode     TEXT NOT NULL DEFAULT 'conservative' CHECK (empire_mode IN (
    'conservative',  -- EI < 60
    'balanced',      -- EI 60-79
    'aggressive'     -- EI >= 80
  )),
  roas_24h        NUMERIC(6,2),
  cpa_24h         NUMERIC(8,2),
  spend_24h       NUMERIC(10,2),
  active_ads      INTEGER DEFAULT 0,
  risk_level      TEXT NOT NULL DEFAULT 'medium' CHECK (risk_level IN ('low','medium','high','critical')),
  active_signals  JSONB NOT NULL DEFAULT '[]',   -- array of current signals from agents
  active_warnings JSONB NOT NULL DEFAULT '[]',   -- array of current warnings
  recommended_mode TEXT,                          -- LLM-generated recommendation
  last_consolidated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  consolidated_by TEXT NOT NULL DEFAULT 'AGENT_ORCHESTRATOR',
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_world_state_shop ON world_state(shop_id);

-- ── 3. AGENT DECISIONS (Full observability log) ─────────────
-- Every significant agent action is logged with full context
-- Enables replay, debugging, and outcome tracking

CREATE TABLE IF NOT EXISTS agent_decisions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  decision_type   TEXT NOT NULL,       -- 'scale', 'kill', 'pause', 'create_dct', 'alert', etc.
  subject_type    TEXT,                -- 'ad', 'adset', 'campaign', 'creative', 'budget'
  subject_id      TEXT,                -- external ID (Meta ad_id, etc.)

  -- Input context at decision time
  world_state_snapshot  JSONB,         -- world_state at time of decision
  agent_memory_used     JSONB,         -- which memory keys were consulted
  rules_evaluated       JSONB,         -- conditions checked and results
  llm_reasoning         TEXT,          -- if LLM was used: full reasoning text
  llm_prompt            TEXT,          -- prompt sent to LLM (for replay)

  -- Decision output
  decision_made   JSONB NOT NULL,      -- what was decided
  confidence      NUMERIC(3,2) CHECK (confidence BETWEEN 0 AND 1),
  was_vetoed      BOOLEAN NOT NULL DEFAULT false,
  veto_reason     TEXT,
  veto_by_agent   TEXT,

  -- Deliberation (if applicable)
  deliberation_id UUID,                -- links to agent_deliberations
  consensus_reached BOOLEAN,

  -- Execution
  executed        BOOLEAN NOT NULL DEFAULT false,
  executed_at     TIMESTAMPTZ,
  execution_error TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_agent_decisions_shop ON agent_decisions(shop_id, created_at DESC);
CREATE INDEX idx_agent_decisions_agent ON agent_decisions(shop_id, agent_name, created_at DESC);
CREATE INDEX idx_agent_decisions_subject ON agent_decisions(shop_id, subject_id) WHERE subject_id IS NOT NULL;

-- ── 4. DELIBERATIONS (Consensus / Veto protocol) ────────────
-- High-risk actions require multi-agent deliberation before execution

CREATE TABLE IF NOT EXISTS agent_deliberations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  initiated_by    TEXT NOT NULL,       -- agent that wants to take action
  action_type     TEXT NOT NULL,       -- 'scale_heavy', 'kill', 'new_dct', 'budget_change'
  action_payload  JSONB NOT NULL,
  risk_level      TEXT NOT NULL CHECK (risk_level IN ('low','medium','high','critical')),

  -- Votes from agents
  votes           JSONB NOT NULL DEFAULT '[]',  -- [{agent, vote: approve|veto, reason, ts}]
  required_agents TEXT[] NOT NULL,              -- agents that must vote
  voted_agents    TEXT[] NOT NULL DEFAULT '{}',

  -- Outcome
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'approved', 'vetoed', 'timeout', 'auto_approved'
  )),
  final_decision  TEXT,
  decided_at      TIMESTAMPTZ,
  timeout_at      TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '5 minutes',

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_deliberations_shop_status ON agent_deliberations(shop_id, status) WHERE status = 'pending';

-- ── 5. ACTION OUTCOMES (Feedback loop) ──────────────────────
-- 6h after each decision, outcomes are measured and stored
-- Agents use this to calibrate their confidence thresholds

CREATE TABLE IF NOT EXISTS action_outcomes (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  decision_id     UUID NOT NULL REFERENCES agent_decisions(id),
  agent_name      TEXT NOT NULL,
  decision_type   TEXT NOT NULL,

  -- Metrics before action
  metrics_before  JSONB NOT NULL,      -- {roas, cpa, ctr, spend, ...}
  measured_at_before TIMESTAMPTZ NOT NULL,

  -- Metrics 6h after action
  metrics_after   JSONB,               -- populated by AGENT_EVALUATOR at t+6h
  measured_at_after TIMESTAMPTZ,
  measurement_window_hours INTEGER NOT NULL DEFAULT 6,

  -- Evaluation
  outcome_score   NUMERIC(3,2),        -- -1.0 (terrible) to +1.0 (excellent)
  outcome_label   TEXT CHECK (outcome_label IN (
    'excellent',    -- > +0.5
    'good',         -- > +0.2
    'neutral',      -- -0.2 to +0.2
    'bad',          -- < -0.2
    'terrible'      -- < -0.5
  )),
  outcome_reason  TEXT,                -- LLM-generated explanation

  -- Self-calibration signal
  threshold_adjustment NUMERIC(5,2),  -- suggested delta for agent threshold
  calibration_applied  BOOLEAN NOT NULL DEFAULT false,

  evaluated       BOOLEAN NOT NULL DEFAULT false,
  evaluate_after  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '6 hours',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_action_outcomes_eval ON action_outcomes(shop_id, evaluate_after)
  WHERE evaluated = false;
CREATE INDEX idx_action_outcomes_agent ON action_outcomes(shop_id, agent_name, created_at DESC);

-- ── 6. AGENT CONFIDENCE SCORES (Self-calibration) ───────────
-- Each agent maintains a rolling confidence score per decision type
-- Poor track record → higher threshold required before acting

CREATE TABLE IF NOT EXISTS agent_confidence (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  decision_type   TEXT NOT NULL,
  current_score   NUMERIC(3,2) NOT NULL DEFAULT 0.75 CHECK (current_score BETWEEN 0 AND 1),
  baseline_score  NUMERIC(3,2) NOT NULL DEFAULT 0.75,
  total_decisions INTEGER NOT NULL DEFAULT 0,
  correct_decisions INTEGER NOT NULL DEFAULT 0,
  recent_outcomes JSONB NOT NULL DEFAULT '[]',   -- last 10 outcome scores rolling window
  last_calibrated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, agent_name, decision_type)
);

-- ── 7. CONFIG CHANGELOG (Decision versioning) ───────────────
-- Every guardrail/config change is versioned with before/after metrics

CREATE TABLE IF NOT EXISTS config_changelog (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  changed_by      TEXT NOT NULL,       -- user_id or agent_name
  change_type     TEXT NOT NULL,       -- 'guardrail', 'budget', 'threshold', 'strategy', 'mode'
  entity_type     TEXT NOT NULL,
  entity_id       TEXT,
  config_key      TEXT NOT NULL,

  value_before    JSONB NOT NULL,
  value_after     JSONB NOT NULL,
  change_reason   TEXT,

  -- Metrics snapshot at time of change (for before/after comparison)
  metrics_at_change JSONB,             -- {roas, cpa, ctr, empire_index, ...}
  metrics_7d_after  JSONB,             -- populated 7 days later
  performance_delta NUMERIC(6,2),      -- % change in Empire Index

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_config_changelog_shop ON config_changelog(shop_id, created_at DESC);

-- ── 8. ANOMALIES (AGENT_ANOMALY output) ─────────────────────

CREATE TABLE IF NOT EXISTS anomalies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  anomaly_type    TEXT NOT NULL CHECK (anomaly_type IN (
    'spend_spike',       -- spend ×N in short window
    'capi_silence',      -- no CAPI events received
    'token_expiry',      -- API token about to expire or expired
    'webhook_failure',   -- webhook stopped responding
    'roas_collapse',     -- ROAS dropped >50% suddenly
    'cpa_explosion',     -- CPA ×3 with no explanation
    'data_gap',          -- missing data for N minutes
    'budget_deviation',  -- actual spend vs planned deviation
    'api_latency'        -- API response time degraded
  )),
  severity        TEXT NOT NULL CHECK (severity IN ('info','warning','critical','emergency')),
  title           TEXT NOT NULL,
  description     TEXT NOT NULL,
  affected_entity TEXT,
  affected_id     TEXT,
  data_snapshot   JSONB,               -- raw data that triggered anomaly
  auto_resolved   BOOLEAN NOT NULL DEFAULT false,
  resolved_at     TIMESTAMPTZ,
  resolution_note TEXT,
  acknowledged    BOOLEAN NOT NULL DEFAULT false,
  acknowledged_by TEXT,
  acknowledged_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_anomalies_shop_active ON anomalies(shop_id, severity, created_at DESC)
  WHERE auto_resolved = false;

-- ── 9. MULTI-SHOP SCHEDULER STATE ───────────────────────────
-- Each shop has independent scheduler state
-- Prevents cross-shop interference

CREATE TABLE IF NOT EXISTS shop_scheduler_state (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id           UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE UNIQUE,
  is_active         BOOLEAN NOT NULL DEFAULT true,
  autopilot_mode    TEXT NOT NULL DEFAULT 'semi' CHECK (autopilot_mode IN ('human','semi','full')),
  next_brief_at     TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 day',
  next_evaluation_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
  next_anomaly_scan_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '15 minutes',
  current_run_id    UUID,              -- prevents concurrent runs per shop
  last_run_at       TIMESTAMPTZ,
  run_count_today   INTEGER NOT NULL DEFAULT 0,
  errors_today      INTEGER NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── RLS POLICIES ────────────────────────────────────────────
ALTER TABLE agent_memory ENABLE ROW LEVEL SECURITY;
ALTER TABLE world_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_deliberations ENABLE ROW LEVEL SECURITY;
ALTER TABLE action_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_confidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE config_changelog ENABLE ROW LEVEL SECURITY;
ALTER TABLE anomalies ENABLE ROW LEVEL SECURITY;
ALTER TABLE shop_scheduler_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY agent_memory_tenant ON agent_memory USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY world_state_tenant ON world_state USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY agent_decisions_tenant ON agent_decisions USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY agent_deliberations_tenant ON agent_deliberations USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY action_outcomes_tenant ON action_outcomes USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY agent_confidence_tenant ON agent_confidence USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY config_changelog_tenant ON config_changelog USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY anomalies_tenant ON anomalies USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY shop_scheduler_tenant ON shop_scheduler_state USING (shop_id = current_setting('app.shop_id')::UUID);

COMMENT ON TABLE agent_memory IS 'AEGIS v3.5 — Shared context store. Each agent deposits observations, Orchestrator consolidates into world_state.';
COMMENT ON TABLE world_state IS 'AEGIS v3.5 — Single consolidated world view per shop. All agents consult before decisions.';
COMMENT ON TABLE agent_decisions IS 'AEGIS v3.5 — Full observability log. Every agent action logged with context, reasoning, confidence.';
COMMENT ON TABLE agent_deliberations IS 'AEGIS v3.5 — Multi-agent consensus protocol for high-risk actions.';
COMMENT ON TABLE action_outcomes IS 'AEGIS v3.5 — Feedback loop. Outcomes measured 6h after each decision for self-calibration.';
COMMENT ON TABLE agent_confidence IS 'AEGIS v3.5 — Rolling confidence scores per agent per decision type. Self-adjusting thresholds.';
COMMENT ON TABLE config_changelog IS 'AEGIS v3.5 — Config versioning with before/after metrics comparison.';
COMMENT ON TABLE anomalies IS 'AEGIS v3.5 — AGENT_ANOMALY output. Structural monitoring, not metric monitoring.';
COMMENT ON TABLE shop_scheduler_state IS 'AEGIS v3.5 — Per-shop scheduler state for true multi-shop independence.';
