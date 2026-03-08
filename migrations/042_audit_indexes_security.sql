-- ============================================================
-- AEGIS Migration 042 — Performance indexes + security hardening
-- Addresses audit findings: missing composite indexes on tenant queries
-- ============================================================

-- 1. Composite indexes for frequent tenant-scoped list queries
CREATE INDEX IF NOT EXISTS idx_products_tenant_status
  ON store.products (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_campaigns_tenant_created
  ON ads.cbo_campaigns (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_connectors_tenant_status
  ON connectors.registry (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_created
  ON store.pipeline_runs (tenant_id, created_at DESC);

-- 2. Revenue daily index for summary/chart queries
CREATE INDEX IF NOT EXISTS idx_revenue_daily_tenant_date
  ON ops.revenue_daily (tenant_id, date DESC);

-- 3. Guardrail rules tenant lookup
CREATE INDEX IF NOT EXISTS idx_guardrail_rules_tenant
  ON risk.guardrail_rules (tenant_id, category, key);

-- 4. Users tenant lookup
CREATE INDEX IF NOT EXISTS idx_users_tenant_active
  ON saas.users (tenant_id, is_active) WHERE is_active = TRUE;

-- 5. Users email lookup (login performance)
CREATE INDEX IF NOT EXISTS idx_users_email_active
  ON saas.users (email) WHERE is_active = TRUE;

-- 6. Auth tokens — non-revoked lookup
CREATE INDEX IF NOT EXISTS idx_auth_tokens_user_type
  ON saas.auth_tokens (user_id, type, is_revoked) WHERE is_revoked = FALSE;

-- 7. Foreign key indexes on agents references (prevent orphans)
-- These tables reference agent_id but lacked indexes
CREATE INDEX IF NOT EXISTS idx_agents_schedule_agent
  ON agents.schedule (agent_id);

CREATE INDEX IF NOT EXISTS idx_agents_metrics_agent
  ON agents.metrics (agent_id);

-- 8. Store offers/pages product lookup
CREATE INDEX IF NOT EXISTS idx_store_offers_product
  ON store.offers (product_id);

CREATE INDEX IF NOT EXISTS idx_store_pages_product
  ON store.pages (product_id);

-- 9. Activity feed: recent pipeline runs
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_tenant_recent
  ON store.pipeline_runs (tenant_id, created_at DESC)
  WHERE status IN ('running', 'completed', 'error');

-- 10. Audit log partitioned index
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_action
  ON ops.audit_log (tenant_id, action, created_at DESC);
