-- ============================================================
-- Migration 030 — AEGIS v4.0 — Conseil Constitutionnel
-- ============================================================

-- ── CONSTITUTION REVIEW LOG ──────────────────────────────────
-- Every action reviewed by the Council is recorded here.
-- Immutable: no UPDATE or DELETE policy.
CREATE TABLE IF NOT EXISTS constitution_reviews (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID REFERENCES shops(id) ON DELETE SET NULL,
  reviewed_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- The action being reviewed
  agent_name      TEXT NOT NULL,
  action_type     TEXT NOT NULL,
  action_payload  JSONB NOT NULL,
  financial_impact NUMERIC(12,2),  -- estimated € at stake

  -- Council verdict
  verdict         TEXT NOT NULL CHECK (verdict IN ('approved','vetoed','deferred')),
  articles_invoked TEXT[] NOT NULL DEFAULT '{}',
  -- e.g. ['article_2_spend_cap','article_1_human_primacy']
  veto_reason     TEXT,
  duration_ms     INTEGER,

  -- Cannot be modified after insert
  CONSTRAINT constitution_reviews_immutable CHECK (true)
);

-- Write-only: no UPDATE/DELETE allowed via RLS
ALTER TABLE constitution_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY cr_insert ON constitution_reviews FOR INSERT WITH CHECK (true);
CREATE POLICY cr_select ON constitution_reviews FOR SELECT
  USING (shop_id = current_setting('app.shop_id', true)::UUID OR shop_id IS NULL);
-- No UPDATE or DELETE policy = effectively immutable

-- ── AGENT SUSPENSION LOG ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS agent_suspensions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_name      TEXT NOT NULL,
  suspended_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suspended_until TIMESTAMPTZ NOT NULL,
  reason          TEXT NOT NULL,
  violation_count INTEGER NOT NULL DEFAULT 3,
  article_invoked TEXT NOT NULL DEFAULT 'article_4_suspension',
  lifted_at       TIMESTAMPTZ,
  lifted_by       TEXT,
  auto_lifted     BOOLEAN NOT NULL DEFAULT false
);

CREATE INDEX idx_suspensions_active ON agent_suspensions(shop_id, agent_name)
  WHERE lifted_at IS NULL;

-- ── CONSTITUTION VIOLATIONS ───────────────────────────────────
CREATE TABLE IF NOT EXISTS constitution_violations (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID REFERENCES shops(id) ON DELETE SET NULL,
  agent_name      TEXT NOT NULL,
  article_invoked TEXT NOT NULL,
  violation_type  TEXT NOT NULL,
  details         JSONB NOT NULL DEFAULT '{}',
  review_id       UUID REFERENCES constitution_reviews(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_violations_agent ON constitution_violations(shop_id, agent_name, created_at DESC);

-- ── WHITELIST: approved data export destinations ──────────────
CREATE TABLE IF NOT EXISTS constitution_whitelist (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  destination_type TEXT NOT NULL CHECK (destination_type IN ('klaviyo','webhook','email','slack','whatsapp','api')),
  destination_id  TEXT NOT NULL,  -- list_id, webhook_id, email address, etc.
  approved_by     TEXT NOT NULL,
  approved_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  purpose         TEXT NOT NULL,
  revoked_at      TIMESTAMPTZ,
  UNIQUE(shop_id, destination_type, destination_id)
);

ALTER TABLE constitution_whitelist ENABLE ROW LEVEL SECURITY;
CREATE POLICY cw_tenant ON constitution_whitelist
  USING (shop_id = current_setting('app.shop_id', true)::UUID);

COMMENT ON TABLE constitution_reviews IS
  'AEGIS v4.0 — Conseil Constitutionnel. Immutable audit of every reviewed action.';
COMMENT ON TABLE agent_suspensions IS
  'AEGIS v4.0 — Article 4: agents suspended after 3 consecutive guardrail violations.';
COMMENT ON TABLE constitution_whitelist IS
  'AEGIS v4.0 — Article 3: human-approved data export destinations only.';
