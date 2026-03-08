-- ============================================================
-- Migration 036 — Tier Seeds
-- Defines the 5 tiers, agent modes, and unlock conditions
-- ============================================================

-- ── TIER AGENT CONFIGURATION ─────────────────────────────────
-- 5 paliers × 34 agents = comportement exact de chaque agent à chaque étape

-- Helper: insert all tiers for an agent
-- TIER 1 — DÉMARRAGE: AEGIS observe tout, n'exécute rien
-- TIER 2 — VALIDATION: Exécute les killswitch (stop-loss), suggère le reste
-- TIER 3 — CROISSANCE: Semi-auto sur les décisions <€50 impact
-- TIER 4 — SCALE: Auto sur tout sauf irréversible, illimité en budget
-- TIER 5 — EMPIRE: Plein auto, tous agents, mode empire

INSERT INTO tier_agent_config (tier, agent_name, mode, max_financial_impact, requires_human_confirm, notes)
VALUES
-- ────────── TIER 1 : DÉMARRAGE ──────────────────────────────
-- Tout en shadow. AEGIS s'installe, observe, ne touche à rien.
(1,'AGENT_SCALE',           'shadow',  NULL,  false, 'Enregistre les décisions de budget sans les exécuter'),
(1,'AGENT_STOP_LOSS',       'shadow',  NULL,  false, 'Enregistre les kills sans les exécuter'),
(1,'AGENT_DAYPARTING',      'shadow',  NULL,  false, 'Calcule les ajustements, ne les applique pas'),
(1,'AGENT_PRICING',         'observe', NULL,  false, 'Analyse les tests de prix, ne publie pas'),
(1,'AGENT_KLAVIYO',         'observe', NULL,  false, 'Calcule les segments, ne synchronise pas'),
(1,'AGENT_DCT_ITERATION',   'observe', NULL,  false, 'Analyse les créatifs, ne lance pas de test'),
(1,'AGENT_ANOMALY',         'auto',    NULL,  false, 'Détection toujours active'),
(1,'AGENT_PIXEL_HEALTH',    'auto',    NULL,  false, 'Monitoring toujours actif'),
(1,'AGENT_FORECASTER',      'auto',    NULL,  false, 'Prévisions toujours actives'),
(1,'AGENT_RFM',             'auto',    NULL,  false, 'Segmentation toujours active'),
(1,'AGENT_HEALTH_PROBES',   'auto',    NULL,  false, 'Probes toujours actifs'),
(1,'AGENT_SHADOW_MODE',     'auto',    NULL,  false, 'Shadow mode — raison d être du tier 1'),
(1,'AGENT_DECISION_NARRATOR','auto',   NULL,  false, 'Narration toujours active'),
(1,'AGENT_DELIVERY',        'auto',    NULL,  false, 'Morning Brief toujours livré'),
(1,'AGENT_REPLENISHMENT',   'auto',    NULL,  false, 'Alertes stock toujours actives'),
(1,'AGENT_SEASONAL_CALENDAR','observe',NULL,  false, 'Calcule les phases, ne modifie pas empire_mode'),
(1,'AGENT_GA4',             'auto',    NULL,  false, 'Sync GA4 toujours actif'),
(1,'AGENT_VERBATIM',        'auto',    NULL,  false, 'Collecte verbatims toujours active'),
(1,'AGENT_REPUTATION',      'auto',    NULL,  false, 'Monitoring réputation toujours actif'),
(1,'AGENT_BUDGET_OPTIMIZER','observe', NULL,  false, 'Recommande, n applique pas'),
(1,'AGENT_EMAIL_RECOVERY',  'observe', NULL,  false, 'Prépare les contenus, n envoie pas'),
(1,'AGENT_BRIEF_AB',        'auto',    NULL,  false, 'A/B tracking toujours actif'),
(1,'AGENT_GUARDRAIL_CALIBRATOR','observe',NULL,false, 'Propose les recalibrations, ne les applique pas'),
(1,'AGENT_PROFITABILITY',   'auto',    NULL,  false, 'Calcul marge toujours actif'),
(1,'AGENT_ROI_TRACKER',     'auto',    NULL,  false, 'ROI tracking toujours actif'),
(1,'AGENT_ATTRIBUTION',     'auto',    NULL,  false, 'Attribution toujours active'),
(1,'AGENT_EVALUATOR',       'auto',    NULL,  false, 'Évaluation toujours active'),
(1,'AGENT_AOV',             'auto',    NULL,  false, 'AOV analysis toujours actif'),
(1,'AGENT_CREATIVE_KNOWLEDGE','auto',  NULL,  false, 'Knowledge base toujours mise à jour'),
(1,'AGENT_COMPETITIVE_INTEL','auto',   NULL,  false, 'Veille concurrentielle toujours active'),
(1,'AGENT_AUDIENCE_INTEL',  'auto',    NULL,  false, 'Analyse audiences toujours active'),
(1,'AGENT_TIKTOK_ORGANIC',  'suggest', NULL,  true,  'Suggère du contenu, humain publie'),
(1,'AGENT_MONTHLY_REPORT',  'auto',    NULL,  false, 'Rapport mensuel toujours généré'),
(1,'AGENT_SYNC_GUARDIAN',   'auto',    NULL,  false, 'Sync guardian toujours actif'),

-- ────────── TIER 2 : VALIDATION ─────────────────────────────
-- AEGIS a ≥75% d'accord en shadow → on lui donne les stop-loss et les petits kill
-- "AEGIS peut couper les perdants, pas encore augmenter les gagnants"
(2,'AGENT_SCALE',           'suggest', 50,    true,  'Suggère les augmentations > €50, semi-auto ≤ €50'),
(2,'AGENT_STOP_LOSS',       'semi_auto',200,  false, 'Coupe auto les campagnes CPA > 2× cible'),
(2,'AGENT_DAYPARTING',      'semi_auto',30,   false, 'Ajuste auto les petites modulations daypart'),
(2,'AGENT_PRICING',         'suggest', NULL,  true,  'Soumet les propositions de prix pour approbation'),
(2,'AGENT_KLAVIYO',         'semi_auto',NULL, false, 'Sync segments auto, flows suggérés'),
(2,'AGENT_DCT_ITERATION',   'semi_auto',100,  false, 'Lance les DCT auto si budget < €100/test'),
(2,'AGENT_ANOMALY',         'auto',    NULL,  false, 'Détection + alerte toujours'),
(2,'AGENT_PIXEL_HEALTH',    'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_SEASONAL_CALENDAR','semi_auto',NULL,false, 'Applique les phases preparation/deceleration auto, peak suggéré'),
(2,'AGENT_BUDGET_OPTIMIZER','suggest', NULL,  true,  'Recommande les shifts inter-plateformes'),
(2,'AGENT_EMAIL_RECOVERY',  'semi_auto',NULL, false, 'Envoie les emails recovery auto'),
(2,'AGENT_GUARDRAIL_CALIBRATOR','semi_auto',NULL,true,'Applique les recalibrations < 15% delta auto'),
-- Hérite des auto du tier 1
(2,'AGENT_FORECASTER',      'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_RFM',             'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_HEALTH_PROBES',   'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_SHADOW_MODE',     'auto',    NULL,  false, 'Continue à enregistrer pour T3'),
(2,'AGENT_DECISION_NARRATOR','auto',   NULL,  false, 'Toujours actif'),
(2,'AGENT_DELIVERY',        'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_REPLENISHMENT',   'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_VERBATIM',        'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_REPUTATION',      'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_BRIEF_AB',        'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_PROFITABILITY',   'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_ROI_TRACKER',     'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_ATTRIBUTION',     'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_EVALUATOR',       'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_AOV',             'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_CREATIVE_KNOWLEDGE','auto',  NULL,  false, 'Toujours actif'),
(2,'AGENT_COMPETITIVE_INTEL','auto',   NULL,  false, 'Toujours actif'),
(2,'AGENT_AUDIENCE_INTEL',  'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_TIKTOK_ORGANIC',  'suggest', NULL,  true,  'Toujours suggéré'),
(2,'AGENT_MONTHLY_REPORT',  'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_GA4',             'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_SYNC_GUARDIAN',   'auto',    NULL,  false, 'Toujours actif'),
(2,'AGENT_STRATEGIES',      'suggest', NULL,  true,  'Recommande des pivots stratégiques'),
(2,'AGENT_BUDGET_OPTIMIZER','suggest', NULL,  true,  'Recommande les shifts'),

-- ────────── TIER 3 : CROISSANCE ─────────────────────────────
-- ROAS stable ≥2.5× sur 14j → auto sur tout < €200 impact/jour
(3,'AGENT_SCALE',           'semi_auto',200,  false, 'Auto ≤ €200/j, suggest au-delà'),
(3,'AGENT_STOP_LOSS',       'auto',    NULL,  false, 'Kill total auto'),
(3,'AGENT_DAYPARTING',      'auto',    NULL,  false, 'Dayparting plein auto'),
(3,'AGENT_PRICING',         'semi_auto',NULL, true,  'Applique les tests prix auto < 20% delta'),
(3,'AGENT_KLAVIYO',         'auto',    NULL,  false, 'Segments + flows auto'),
(3,'AGENT_DCT_ITERATION',   'auto',    NULL,  false, 'DCT plein auto'),
(3,'AGENT_SEASONAL_CALENDAR','auto',   NULL,  false, 'Toutes phases auto'),
(3,'AGENT_BUDGET_OPTIMIZER','semi_auto',100,  false, 'Shifts auto < €100'),
(3,'AGENT_EMAIL_RECOVERY',  'auto',    NULL,  false, 'Recovery plein auto'),
(3,'AGENT_GUARDRAIL_CALIBRATOR','auto',NULL,  false, 'Calibrations auto'),
(3,'AGENT_STRATEGIES',      'semi_auto',NULL, true,  'Applique pivots minor auto'),
(3,'AGENT_TIKTOK_ORGANIC',  'auto',    NULL,  false, 'Publication auto TikTok'),
-- Auto hérités
(3,'AGENT_ANOMALY',         'auto',    NULL,  false, NULL),
(3,'AGENT_PIXEL_HEALTH',    'auto',    NULL,  false, NULL),
(3,'AGENT_FORECASTER',      'auto',    NULL,  false, NULL),
(3,'AGENT_RFM',             'auto',    NULL,  false, NULL),
(3,'AGENT_HEALTH_PROBES',   'auto',    NULL,  false, NULL),
(3,'AGENT_SHADOW_MODE',     'auto',    NULL,  false, NULL),
(3,'AGENT_DECISION_NARRATOR','auto',   NULL,  false, NULL),
(3,'AGENT_DELIVERY',        'auto',    NULL,  false, NULL),
(3,'AGENT_REPLENISHMENT',   'auto',    NULL,  false, NULL),
(3,'AGENT_VERBATIM',        'auto',    NULL,  false, NULL),
(3,'AGENT_REPUTATION',      'auto',    NULL,  false, NULL),
(3,'AGENT_BRIEF_AB',        'auto',    NULL,  false, NULL),
(3,'AGENT_PROFITABILITY',   'auto',    NULL,  false, NULL),
(3,'AGENT_ROI_TRACKER',     'auto',    NULL,  false, NULL),
(3,'AGENT_ATTRIBUTION',     'auto',    NULL,  false, NULL),
(3,'AGENT_EVALUATOR',       'auto',    NULL,  false, NULL),
(3,'AGENT_AOV',             'auto',    NULL,  false, NULL),
(3,'AGENT_CREATIVE_KNOWLEDGE','auto',  NULL,  false, NULL),
(3,'AGENT_COMPETITIVE_INTEL','auto',   NULL,  false, NULL),
(3,'AGENT_AUDIENCE_INTEL',  'auto',    NULL,  false, NULL),
(3,'AGENT_MONTHLY_REPORT',  'auto',    NULL,  false, NULL),
(3,'AGENT_GA4',             'auto',    NULL,  false, NULL),
(3,'AGENT_SYNC_GUARDIAN',   'auto',    NULL,  false, NULL),

-- ────────── TIER 4 : SCALE ──────────────────────────────────
-- 30j clean + ROAS ≥3× → tout auto, budget illimité (dans le Conseil)
(4,'AGENT_SCALE',           'auto',    NULL,  false, 'Scaling illimité dans les guardrails'),
(4,'AGENT_STOP_LOSS',       'auto',    NULL,  false, NULL),
(4,'AGENT_DAYPARTING',      'auto',    NULL,  false, NULL),
(4,'AGENT_PRICING',         'auto',    NULL,  false, 'Tests prix plein auto'),
(4,'AGENT_KLAVIYO',         'auto',    NULL,  false, NULL),
(4,'AGENT_DCT_ITERATION',   'auto',    NULL,  false, NULL),
(4,'AGENT_SEASONAL_CALENDAR','auto',   NULL,  false, NULL),
(4,'AGENT_BUDGET_OPTIMIZER','auto',    NULL,  false, 'Shifts inter-plateformes plein auto'),
(4,'AGENT_EMAIL_RECOVERY',  'auto',    NULL,  false, NULL),
(4,'AGENT_GUARDRAIL_CALIBRATOR','auto',NULL,  false, NULL),
(4,'AGENT_STRATEGIES',      'auto',    NULL,  false, 'Pivots stratégiques auto'),
(4,'AGENT_TIKTOK_ORGANIC',  'auto',    NULL,  false, NULL),
-- Tous auto
(4,'AGENT_ANOMALY',         'auto',    NULL,  false, NULL),
(4,'AGENT_PIXEL_HEALTH',    'auto',    NULL,  false, NULL),
(4,'AGENT_FORECASTER',      'auto',    NULL,  false, NULL),
(4,'AGENT_RFM',             'auto',    NULL,  false, NULL),
(4,'AGENT_HEALTH_PROBES',   'auto',    NULL,  false, NULL),
(4,'AGENT_SHADOW_MODE',     'auto',    NULL,  false, NULL),
(4,'AGENT_DECISION_NARRATOR','auto',   NULL,  false, NULL),
(4,'AGENT_DELIVERY',        'auto',    NULL,  false, NULL),
(4,'AGENT_REPLENISHMENT',   'auto',    NULL,  false, NULL),
(4,'AGENT_VERBATIM',        'auto',    NULL,  false, NULL),
(4,'AGENT_REPUTATION',      'auto',    NULL,  false, NULL),
(4,'AGENT_BRIEF_AB',        'auto',    NULL,  false, NULL),
(4,'AGENT_PROFITABILITY',   'auto',    NULL,  false, NULL),
(4,'AGENT_ROI_TRACKER',     'auto',    NULL,  false, NULL),
(4,'AGENT_ATTRIBUTION',     'auto',    NULL,  false, NULL),
(4,'AGENT_EVALUATOR',       'auto',    NULL,  false, NULL),
(4,'AGENT_AOV',             'auto',    NULL,  false, NULL),
(4,'AGENT_CREATIVE_KNOWLEDGE','auto',  NULL,  false, NULL),
(4,'AGENT_COMPETITIVE_INTEL','auto',   NULL,  false, NULL),
(4,'AGENT_AUDIENCE_INTEL',  'auto',    NULL,  false, NULL),
(4,'AGENT_MONTHLY_REPORT',  'auto',    NULL,  false, NULL),
(4,'AGENT_GA4',             'auto',    NULL,  false, NULL),
(4,'AGENT_SYNC_GUARDIAN',   'auto',    NULL,  false, NULL),

-- ────────── TIER 5 : EMPIRE ─────────────────────────────────
-- Même chose que T4 mais empire_mode unlocked + Constitutional Council
-- peut approuver des actions normalement irréversibles sans confirmation
-- (si elles ont été exécutées >5× avec succès dans les 90j)
(5,'AGENT_SCALE',           'auto',    NULL,  false, 'Empire mode: scaling agressif autorisé'),
(5,'AGENT_STOP_LOSS',       'auto',    NULL,  false, NULL),
(5,'AGENT_DAYPARTING',      'auto',    NULL,  false, NULL),
(5,'AGENT_PRICING',         'auto',    NULL,  false, NULL),
(5,'AGENT_KLAVIYO',         'auto',    NULL,  false, NULL),
(5,'AGENT_DCT_ITERATION',   'auto',    NULL,  false, NULL),
(5,'AGENT_SEASONAL_CALENDAR','auto',   NULL,  false, NULL),
(5,'AGENT_BUDGET_OPTIMIZER','auto',    NULL,  false, NULL),
(5,'AGENT_EMAIL_RECOVERY',  'auto',    NULL,  false, NULL),
(5,'AGENT_GUARDRAIL_CALIBRATOR','auto',NULL,  false, NULL),
(5,'AGENT_STRATEGIES',      'auto',    NULL,  false, NULL),
(5,'AGENT_TIKTOK_ORGANIC',  'auto',    NULL,  false, NULL),
(5,'AGENT_ANOMALY',         'auto',    NULL,  false, NULL),
(5,'AGENT_PIXEL_HEALTH',    'auto',    NULL,  false, NULL),
(5,'AGENT_FORECASTER',      'auto',    NULL,  false, NULL),
(5,'AGENT_RFM',             'auto',    NULL,  false, NULL),
(5,'AGENT_HEALTH_PROBES',   'auto',    NULL,  false, NULL),
(5,'AGENT_SHADOW_MODE',     'auto',    NULL,  false, NULL),
(5,'AGENT_DECISION_NARRATOR','auto',   NULL,  false, NULL),
(5,'AGENT_DELIVERY',        'auto',    NULL,  false, NULL),
(5,'AGENT_REPLENISHMENT',   'auto',    NULL,  false, NULL),
(5,'AGENT_VERBATIM',        'auto',    NULL,  false, NULL),
(5,'AGENT_REPUTATION',      'auto',    NULL,  false, NULL),
(5,'AGENT_BRIEF_AB',        'auto',    NULL,  false, NULL),
(5,'AGENT_PROFITABILITY',   'auto',    NULL,  false, NULL),
(5,'AGENT_ROI_TRACKER',     'auto',    NULL,  false, NULL),
(5,'AGENT_ATTRIBUTION',     'auto',    NULL,  false, NULL),
(5,'AGENT_EVALUATOR',       'auto',    NULL,  false, NULL),
(5,'AGENT_AOV',             'auto',    NULL,  false, NULL),
(5,'AGENT_CREATIVE_KNOWLEDGE','auto',  NULL,  false, NULL),
(5,'AGENT_COMPETITIVE_INTEL','auto',   NULL,  false, NULL),
(5,'AGENT_AUDIENCE_INTEL',  'auto',    NULL,  false, NULL),
(5,'AGENT_MONTHLY_REPORT',  'auto',    NULL,  false, NULL),
(5,'AGENT_GA4',             'auto',    NULL,  false, NULL),
(5,'AGENT_SYNC_GUARDIAN',   'auto',    NULL,  false, NULL);

-- ── UNLOCK CONDITIONS ─────────────────────────────────────────
INSERT INTO tier_unlock_conditions
  (from_tier, to_tier, condition_key, operator, threshold, mandatory, description)
VALUES
-- T1 → T2 : shadow mode prouve qu'AEGIS est fiable
(1,2,'shadow_agreement_rate',       '>=',0.75,  true,  'Shadow mode: ≥75% accord avec décisions humaines'),
(1,2,'days_live',                   '>=',7,     true,  'Au moins 7 jours de données shadow'),
(1,2,'health_probes_passing',       '>=',0.875, true,  '≥7/8 health probes passent'),
(1,2,'onboarding_complete',         '=', 1,     true,  'Onboarding 5 étapes complété'),

-- T2 → T3 : performance réelle sur 14j
(2,3,'avg_roas_30d',                '>=',2.5,   true,  'ROAS moyen ≥2.5× sur 30 jours'),
(2,3,'days_no_critical_anomaly',    '>=',14,    true,  '14 jours sans anomalie critique'),
(2,3,'shadow_agreement_rate',       '>=',0.80,  true,  'Shadow rate ≥80%'),
(2,3,'decisions_executed_30d',      '>=',20,    false, '≥20 décisions T2 exécutées avec succès'),

-- T3 → T4 : système mature et rentable
(3,4,'avg_roas_30d',                '>=',3.0,   true,  'ROAS moyen ≥3× sur 30 jours'),
(3,4,'days_no_critical_anomaly',    '>=',30,    true,  '30 jours sans anomalie critique'),
(3,4,'nps_score',                   '>=',40,    true,  'NPS interne ≥40 (clients satisfaits)'),
(3,4,'total_revenue_aegis',         '>=',5000,  false, '≥€5 000 de revenus attribués à AEGIS'),
(3,4,'constitution_veto_rate',      '<=',0.05,  false, 'Taux de veto Conseil ≤5%'),

-- T4 → T5 : confiance totale
(4,5,'days_no_critical_anomaly',    '>=',60,    true,  '60 jours sans anomalie critique'),
(4,5,'avg_roas_30d',                '>=',3.5,   true,  'ROAS moyen ≥3.5×'),
(4,5,'total_revenue_aegis',         '>=',20000, true,  '≥€20 000 de revenus attribués à AEGIS'),
(4,5,'shadow_agreement_rate',       '>=',0.88,  true,  'Shadow rate ≥88% (accord quasi-total)'),
(4,5,'nps_score',                   '>=',50,    false, 'NPS ≥50');

