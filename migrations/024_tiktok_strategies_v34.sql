-- Migration 024: TikTok Organic Network + Strategies Library
-- AEGIS v3.4 — 2026-03-05

-- ── TIKTOK ACCOUNTS ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS tiktok_accounts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  handle       TEXT NOT NULL,
  persona      TEXT NOT NULL,
  persona_type TEXT NOT NULL CHECK (persona_type IN (
    'transformation','ritual','pedagogie','humour',
    'social_proof','comparatif','famille','eco','fitness','officiel'
  )),
  status       TEXT NOT NULL DEFAULT 'warmup' CHECK (status IN ('warmup','active','winner','trending')),
  phase        TEXT NOT NULL DEFAULT 'warmup' CHECK (phase IN ('warmup','active','full')),
  total_views  BIGINT NOT NULL DEFAULT 0,
  total_posts  INTEGER NOT NULL DEFAULT 0,
  avg_engagement NUMERIC(5,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TIKTOK VIDEOS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tiktok_videos (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  account_id      UUID NOT NULL REFERENCES tiktok_accounts(id) ON DELETE CASCADE,
  video_id        TEXT NOT NULL UNIQUE,
  title           TEXT,
  angle           TEXT,
  hook            TEXT,
  views           BIGINT NOT NULL DEFAULT 0,
  likes           INTEGER NOT NULL DEFAULT 0,
  comments        INTEGER NOT NULL DEFAULT 0,
  shares          INTEGER NOT NULL DEFAULT 0,
  engagement_rate NUMERIC(5,2),
  retention_rate  NUMERIC(5,2),
  is_winner       BOOLEAN NOT NULL DEFAULT false,
  winner_flagged_at TIMESTAMPTZ,
  spark_ad_id     TEXT,
  posted_at       TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── TIKTOK VARIATIONS ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS tiktok_variations (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id      UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  source_video_id UUID NOT NULL REFERENCES tiktok_videos(id),
  account_id   UUID NOT NULL REFERENCES tiktok_accounts(id),
  hook_variant TEXT,
  sound_id     TEXT,
  modifications JSONB NOT NULL DEFAULT '[]',
  status       TEXT NOT NULL DEFAULT 'ready' CHECK (status IN ('ready','posted','failed')),
  posted_at    TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ── STRATEGIES LIBRARY ────────────────────────────────────
CREATE TABLE IF NOT EXISTS strategies (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  shop_id         UUID NOT NULL REFERENCES shops(id) ON DELETE CASCADE,
  strategy_key    TEXT NOT NULL,
  name            TEXT NOT NULL,
  category        TEXT NOT NULL CHECK (category IN (
    'scaling','protection','creative','acquisition','seasonal'
  )),
  description     TEXT,
  icon            TEXT,
  impact          TEXT NOT NULL DEFAULT 'MED' CHECK (impact IN ('LOW','MED','HIGH')),
  conditions      JSONB NOT NULL DEFAULT '[]',
  actions         JSONB NOT NULL DEFAULT '[]',
  status          TEXT NOT NULL DEFAULT 'inactive' CHECK (status IN ('active','inactive','paused')),
  activated_at    TIMESTAMPTZ,
  last_triggered_at TIMESTAMPTZ,
  trigger_count   INTEGER NOT NULL DEFAULT 0,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(shop_id, strategy_key)
);

-- ── SEED DEFAULT STRATEGIES ───────────────────────────────
INSERT INTO strategies (shop_id, strategy_key, name, category, description, icon, impact, conditions, actions)
SELECT 
  s.id,
  strat.key,
  strat.name,
  strat.category::TEXT,
  strat.description,
  strat.icon,
  strat.impact::TEXT,
  strat.conditions::JSONB,
  strat.actions::JSONB
FROM shops s
CROSS JOIN (VALUES
  ('dtc_scaling_guardian','DTC Scaling Guardian','scaling','Scale les winners par paliers de +20%','📈','HIGH',
   '[{"metric":"roas","operator":">=","value":2.5,"window_hours":6}]',
   '[{"type":"scale_budget","params":{"multiplier":1.2,"max_daily":500}}]'),
  ('cpa_guardian','CPA Guardian','protection','Kill si CPA dépasse le seuil guardrail','🛡','HIGH',
   '[{"metric":"cpa","operator":">","value":45,"window_hours":6}]',
   '[{"type":"kill_ad","params":{"reason":"CPA exceeded threshold"}}]'),
  ('creative_fatigue_detector','Creative Fatigue Detector','creative','Détecte l''usure avant qu''elle coûte','🎨','HIGH',
   '[{"metric":"frequency","operator":">","value":3.5,"window_hours":24}]',
   '[{"type":"alert","params":{"priority":"HIGH","message":"Creative fatigue detected"}}]'),
  ('empire_index_optimizer','Empire Index Optimizer','scaling','Maximise chaque euro pour l''Empire','💎','HIGH',
   '[{"metric":"empire_index","operator":"<","value":70,"window_hours":24}]',
   '[{"type":"alert","params":{"priority":"HIGH","message":"Empire Index below 70"}},{"type":"create_dct","params":{"angles":["transformation"]}}]')
) AS strat(key, name, category, description, icon, impact, conditions, actions)
WHERE NOT EXISTS (
  SELECT 1 FROM strategies st WHERE st.shop_id = s.id AND st.strategy_key = strat.key
);

-- ── INDEXES ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_tiktok_accounts_shop ON tiktok_accounts(shop_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_shop ON tiktok_videos(shop_id);
CREATE INDEX IF NOT EXISTS idx_tiktok_videos_winner ON tiktok_videos(shop_id, is_winner) WHERE is_winner = true;
CREATE INDEX IF NOT EXISTS idx_strategies_shop_status ON strategies(shop_id, status);

-- ── RLS ───────────────────────────────────────────────────
ALTER TABLE tiktok_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_videos ENABLE ROW LEVEL SECURITY;
ALTER TABLE tiktok_variations ENABLE ROW LEVEL SECURITY;
ALTER TABLE strategies ENABLE ROW LEVEL SECURITY;

CREATE POLICY tiktok_accounts_tenant ON tiktok_accounts USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY tiktok_videos_tenant ON tiktok_videos USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY tiktok_variations_tenant ON tiktok_variations USING (shop_id = current_setting('app.shop_id')::UUID);
CREATE POLICY strategies_tenant ON strategies USING (shop_id = current_setting('app.shop_id')::UUID);

COMMENT ON TABLE tiktok_accounts IS 'AEGIS v3.4 — TikTok Organic Network, 10 persona accounts per shop';
COMMENT ON TABLE strategies IS 'AEGIS v3.4 — Strategies Library, 14 pre-built playbooks';
