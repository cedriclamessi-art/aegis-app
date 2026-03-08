-- shadow_mode_log table (si pas déjà créée)
CREATE TABLE IF NOT EXISTS shadow_mode_log (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id     UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  agent_name  TEXT NOT NULL,
  task_type   TEXT NOT NULL,
  would_have_done JSONB NOT NULL DEFAULT '{}',
  result      JSONB NOT NULL DEFAULT '{}',
  tier        INTEGER NOT NULL DEFAULT 1,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_shadow_log_shop ON shadow_mode_log(shop_id, created_at DESC);
ALTER TABLE shadow_mode_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY sml_t ON shadow_mode_log USING (shop_id = current_setting('app.shop_id',true)::UUID);
