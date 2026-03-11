-- ============================================================
-- 046 — AGENT PSYCHE — Psychologie & Persuasion Engine
-- Le 12e agent strategique : cerveau psychologique d'AEGIS
-- ============================================================

-- ── Register PSYCHE in the agent registry ────────────────
INSERT INTO agents.registry (agent_id, name, category, required_level, description, is_active, schedule_cron)
VALUES
  ('AGENT_PSYCHE', 'PSYCHE — Psychologie & Persuasion Engine', 'intelligence', 'basic',
   'Analyse psychologique du client + strategie de persuasion ethique. 70+ modeles mentaux. Nourrit STORE, CREATIVE, ADS, TRAFFIC, SEO, SUPPORT.',
   true, NULL)
ON CONFLICT (agent_id) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  is_active = EXCLUDED.is_active;

-- ── Schedule for PSYCHE (triggered on product launch) ────
INSERT INTO agents.schedules (agent_id, schedule_name, cron_expression, enabled, description)
VALUES
  ('AGENT_PSYCHE', 'on_product_launch', NULL, true, 'Declenche par Hunter lors du lancement produit'),
  ('AGENT_PSYCHE', 'weekly_refresh', '0 4 * * 2', true, 'Re-analyse hebdomadaire mardi 4h pour ajuster les strategies')
ON CONFLICT DO NOTHING;

-- ── Runtime config for PSYCHE ────────────────────────────
INSERT INTO ops.runtime_config (key, value, description) VALUES
  ('psyche.models_count', '22', 'Nombre de modeles mentaux actifs'),
  ('psyche.categories', '["conversion","pricing","trust","urgency","retention","emotion"]', 'Categories de modeles mentaux'),
  ('psyche.max_models_per_product', '10', 'Maximum de modeles selectionnes par produit'),
  ('psyche.ethical_check_enabled', 'true', 'Verification ethique anti-dark-patterns'),
  ('psyche.cache_ttl_days', '7', 'Duree cache Redis pour les strategies'),
  ('psyche.auto_analyze_on_launch', 'true', 'Analyse auto quand Hunter lance un produit')
ON CONFLICT (key) DO NOTHING;
