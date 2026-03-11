-- ============================================================
-- 045 — 11 Agents Stratégiques + Hunter Monday Flow
-- HUNTER, INTEL, STORE, ADS, CREATIVE FACTORY, TRAFFIC,
-- SEO, SUPPORT, POST PURCHASE, COMPLIANCE, GHOST
-- ============================================================

-- ── Nouveaux agents dans le registry ─────────────────────
INSERT INTO agents.registry (agent_id, name, category, required_level, description, is_active, schedule_cron)
VALUES
  ('AGENT_HUNTER', 'Hunter — Chasseur de Produits', 'intelligence', 'basic',
   'Scrape et score les produits gagnants. Livre 5 winners chaque lundi.', true, '0 6 * * 1'),
  ('AGENT_TRAFFIC', 'Traffic — Acquisition Organique', 'growth', 'basic',
   '5 comptes TikTok par produit. Calendrier de contenu auto. 15 posts/jour.', true, '0 7 * * *'),
  ('AGENT_SEO', 'SEO — Référencement Naturel', 'growth', 'basic',
   'Audit SEO, 3 articles/produit, Pinterest SEO, suivi positions.', true, '0 5 * * 1'),
  ('AGENT_SUPPORT', 'Support — SAV 24/7', 'retention', 'basic',
   'Triage auto, réponse <2min, FAQ dynamique, détection chargeback.', true, NULL)
ON CONFLICT (agent_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active,
  schedule_cron = EXCLUDED.schedule_cron;

-- ── Schedules pour les nouveaux agents ───────────────────
INSERT INTO agents.schedules (agent_id, schedule_name, cron_expression, enabled, description)
VALUES
  ('AGENT_HUNTER', 'weekly_hunt', '0 6 * * 1', true, 'Chasse hebdomadaire du lundi 6h'),
  ('AGENT_HUNTER', 'mid_week_scan', '0 6 * * 4', true, 'Scan intermédiaire jeudi 6h'),
  ('AGENT_TRAFFIC', 'daily_calendar', '0 7 * * *', true, 'Publication calendrier quotidien 7h'),
  ('AGENT_TRAFFIC', 'weekly_perf', '0 9 * * 1', true, 'Rapport performance hebdo lundi 9h'),
  ('AGENT_SEO', 'weekly_audit', '0 5 * * 1', true, 'Audit SEO hebdomadaire lundi 5h'),
  ('AGENT_SEO', 'position_track', '0 3 * * *', true, 'Suivi positions quotidien 3h'),
  ('AGENT_SUPPORT', 'daily_faq', '0 4 * * *', true, 'Mise à jour FAQ quotidienne 4h'),
  ('AGENT_SUPPORT', 'weekly_stats', '0 8 * * 1', true, 'Rapport SAV hebdomadaire lundi 8h')
ON CONFLICT DO NOTHING;

-- ── Table hunters discoveries (optionnel, pour UI rapide) ──
CREATE TABLE IF NOT EXISTS intel.hunter_discoveries (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id UUID NOT NULL,
  hunt_week TEXT NOT NULL,
  rank INT NOT NULL CHECK (rank BETWEEN 1 AND 10),
  product_name TEXT NOT NULL,
  source_url TEXT,
  source TEXT,
  total_score INT CHECK (total_score BETWEEN 0 AND 100),
  grade CHAR(1) CHECK (grade IN ('S','A','B','C','D')),
  margin_pct INT,
  estimated_price NUMERIC(10,2),
  estimated_cost NUMERIC(10,2),
  verdict TEXT,
  angles JSONB DEFAULT '[]',
  risks JSONB DEFAULT '[]',
  scores JSONB DEFAULT '{}',
  status TEXT DEFAULT 'proposed' CHECK (status IN ('proposed','launched','rejected','expired')),
  launched_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_hunter_disc_tenant_week
  ON intel.hunter_discoveries (tenant_id, hunt_week);

-- ── Runtime config pour les nouveaux agents ──────────────
INSERT INTO ops.runtime_config (key, value, description) VALUES
  ('hunter.sources', '["tiktok_shop","amazon","aliexpress","shopify","google_trends","reddit","pinterest","winninghunter","adheart","trendtrack"]', 'Sources scrapées par Hunter'),
  ('hunter.top_n', '5', 'Nombre de produits dans le Top weekly'),
  ('hunter.min_score', '50', 'Score minimum pour apparaître dans le Top'),
  ('traffic.accounts_per_product', '5', 'Nombre de comptes par produit'),
  ('traffic.posts_per_day', '15', 'Posts totaux par jour (tous comptes)'),
  ('traffic.platforms', '["tiktok","instagram","youtube_shorts","pinterest"]', 'Plateformes cibles'),
  ('seo.articles_per_product', '3', 'Articles blog par produit'),
  ('seo.min_word_count', '1500', 'Mots minimum par article'),
  ('support.auto_reply_enabled', 'true', 'Réponses automatiques activées'),
  ('support.escalation_types', '["chargeback","complaint"]', 'Types escaladés automatiquement'),
  ('support.target_response_ms', '120000', 'Objectif temps de réponse (2 min)'),
  ('hunter.spy_tools', '["winninghunter","adheart","trendtrack"]', 'Outils spy pour Hunter'),
  ('creative.asset_sources', '["freepik","canva","midjourney"]', 'Sources d assets créatifs'),
  ('creative.inspiration_tools', '["winninghunter","adheart","trendtrack"]', 'Outils d inspiration créative'),
  ('store.builder_tools', '["dropmagic","copyfy"]', 'Outils pour pages produit'),
  ('seo.research_tools', '["semrush","trendtrack"]', 'Outils recherche SEO')
ON CONFLICT (key) DO NOTHING;
