-- ============================================================
-- Migration 038 — Seeds v6.0
-- Connecteurs initiaux · Seuils dynamiques · Benchmarks beauté FR
-- ============================================================

-- ── CONNECTOR ADAPTERS ───────────────────────────────────────
INSERT INTO connector_adapters (platform, adapter_version, api_version, capabilities) VALUES
('meta',     'v2.0', 'v20.0', '["read_campaigns","read_adsets","read_ads","update_budget","update_status","create_adset","pixel_events","audiences","custom_audiences","lookalike"]'),
('tiktok',   'v1.2', '2024-06','["read_campaigns","read_adsets","update_budget","update_status","pixel_events","audiences"]'),
('shopify',  'v2.1', '2024-10','["read_products","read_orders","read_customers","read_inventory","update_product","webhooks"]'),
('klaviyo',  'v1.5', '2024-02','["read_profiles","create_profile","update_profile","add_to_list","track_event","flows"]'),
('ga4',      'v1.0', 'v1beta', '["read_sessions","read_conversions","read_revenue","dimensions","segments"]'),
('google_ads','v1.0','v17',    '["read_campaigns","read_adgroups","update_budget","update_status","keywords"]'),
('pinterest','v1.0', 'v5',     '["read_campaigns","update_budget","pixel_events"]'),
('trustpilot','v1.0','v1',     '["read_reviews","read_score","read_business_unit"]')
ON CONFLICT (platform, api_version) DO NOTHING;

-- ── DYNAMIC THRESHOLDS (remplace toutes les valeurs hardcodées) ──
INSERT INTO dynamic_thresholds
  (shop_id, threshold_key, current_value, default_value, min_value, max_value,
   calibration_method, description, unit)
VALUES
-- Tier unlock conditions
(NULL,'tier1_to_2_shadow_rate',     0.75, 0.75, 0.60, 0.95, 'manual',
 'Taux d accord shadow mode pour passer T1→T2', 'ratio'),
(NULL,'tier1_to_2_days_live',       7,    7,    3,    30,   'manual',
 'Jours minimum en shadow avant T2', 'days'),
(NULL,'tier2_to_3_roas_min',        2.5,  2.5,  1.5,  5.0,  'benchmark',
 'ROAS minimum pour passer T2→T3', 'ratio'),
(NULL,'tier2_to_3_clean_days',      14,   14,   7,    30,   'manual',
 'Jours sans anomalie critique pour T2→T3', 'days'),
(NULL,'tier3_to_4_roas_min',        3.0,  3.0,  2.0,  6.0,  'benchmark',
 'ROAS minimum pour passer T3→T4', 'ratio'),
(NULL,'tier3_to_4_clean_days',      30,   30,   21,   60,   'manual',
 'Jours sans anomalie critique pour T3→T4', 'days'),
(NULL,'tier3_to_4_nps_min',         40,   40,   25,   70,   'adaptive',
 'NPS minimum pour passer T3→T4', 'score'),
(NULL,'tier4_to_5_clean_days',      60,   60,   45,   90,   'manual',
 'Jours sans anomalie critique pour T4→T5', 'days'),
(NULL,'tier4_to_5_roas_min',        3.5,  3.5,  2.5,  7.0,  'benchmark',
 'ROAS minimum pour passer T4→T5', 'ratio'),
(NULL,'tier4_to_5_revenue_min',     20000,20000,5000, 100000,'manual',
 'Revenus certifiés AEGIS minimum pour T5 (EUR)', 'eur'),
-- Stop-loss
(NULL,'stop_loss_cpa_multiplier',   2.0,  2.0,  1.5,  4.0,  'statistical',
 'CPA × ce multiplicateur = seuil de kill automatique', 'ratio'),
(NULL,'stop_loss_min_spend',        30,   30,   10,   100,  'statistical',
 'Dépense minimum avant stop-loss éligible (EUR)', 'eur'),
-- Scale
(NULL,'scale_roas_threshold',       2.5,  2.5,  1.8,  5.0,  'benchmark',
 'ROAS minimum pour déclencher un scaling', 'ratio'),
(NULL,'scale_confidence_min',       0.80, 0.80, 0.65, 0.95, 'statistical',
 'Confiance minimum pour exécuter une décision de scaling', 'ratio'),
(NULL,'scale_max_delta_pct',        0.50, 0.50, 0.20, 1.0,  'manual',
 'Delta maximum d un scaling en une fois (50% = +50% budget)', 'ratio'),
-- DCT
(NULL,'dct_winner_pvalue',          0.05, 0.05, 0.01, 0.10, 'statistical',
 'P-value maximum pour déclarer un gagnant DCT', 'ratio'),
(NULL,'dct_min_conversions',        50,   50,   20,   200,  'statistical',
 'Conversions minimum pour évaluer un DCT', 'count'),
-- Article 6
(NULL,'article6_nps_threshold',     30,   30,   15,   50,   'adaptive',
 'NPS composite minimum — en dessous: acquisition bloquée 48h', 'score'),
(NULL,'article6_block_hours',       48,   48,   24,   96,   'manual',
 'Durée du blocage Article 6 (heures)', 'hours'),
-- Anomalies
(NULL,'anomaly_roas_drop_pct',      0.30, 0.30, 0.15, 0.50, 'statistical',
 'Chute ROAS % pour déclencher une anomalie', 'ratio'),
(NULL,'anomaly_spend_spike_pct',    0.50, 0.50, 0.30, 1.00, 'statistical',
 'Spike dépense % pour déclencher une anomalie', 'ratio'),
-- Pixel health
(NULL,'pixel_health_min_score',     70,   70,   50,   95,   'manual',
 'Score santé pixel minimum avant alerte', 'score'),
-- Performance billing
(NULL,'billing_base_fee',           99,   99,   49,   299,  'manual',
 'Abonnement de base mensuel (EUR)', 'eur'),
(NULL,'billing_performance_pct',    0.03, 0.03, 0.01, 0.10, 'manual',
 'Pourcentage de commission sur ROI certifié', 'ratio'),
-- Semi-auto thresholds by tier
(NULL,'tier2_semi_auto_max_impact', 50,   50,   20,   200,  'manual',
 'Impact financier max pour semi-auto au T2 (EUR/j)', 'eur'),
(NULL,'tier3_semi_auto_max_impact', 200,  200,  50,   500,  'manual',
 'Impact financier max pour semi-auto au T3 (EUR/j)', 'eur')
ON CONFLICT (shop_id, threshold_key) DO NOTHING;

-- ── INDUSTRY BENCHMARKS — Beauté/Soin FR (base) ───────────
INSERT INTO industry_benchmarks
  (industry, sub_category, market, price_tier, metric_key, metric_label,
   p25, p50, p75, p90, sample_shops, sample_period)
VALUES
('beauty_care','exfoliating','FR','mid','roas_meta',
 'ROAS Meta Ads',   1.8, 2.4, 3.2, 4.1, 0, 'Q1_2026'),
('beauty_care','exfoliating','FR','mid','cpa_meta',
 'CPA Meta Ads (EUR)', 22, 31, 42, 58, 0, 'Q1_2026'),
('beauty_care','exfoliating','FR','mid','cr_landing_page',
 'Taux de conversion LP', 0.018, 0.028, 0.041, 0.062, 0, 'Q1_2026'),
('beauty_care','exfoliating','FR','mid','ltv_90d',
 'LTV 90 jours (EUR)',  38, 52, 71, 98, 0, 'Q1_2026'),
('beauty_care','exfoliating','FR','mid','cart_abandonment_rate',
 'Taux abandon panier', 0.62, 0.71, 0.78, 0.85, 0, 'Q1_2026'),
('beauty_care','exfoliating','FR','mid','email_recovery_rate',
 'Taux récupération email', 0.04, 0.08, 0.14, 0.22, 0, 'Q1_2026'),
('beauty_care','skincare',   'FR','mid','roas_meta',
 'ROAS Meta Ads',  1.6, 2.2, 3.0, 4.2, 0, 'Q1_2026'),
('beauty_care','skincare',   'EU','mid','roas_meta',
 'ROAS Meta Ads',  1.5, 2.0, 2.8, 3.8, 0, 'Q1_2026')
ON CONFLICT DO NOTHING;
