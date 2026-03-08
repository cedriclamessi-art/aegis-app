-- Migration 040 — Tier config pour les 5 nouveaux agents v7.0

INSERT INTO tier_agent_config (tier, agent_name, mode, max_financial_impact, requires_human_confirm, notes)
VALUES
-- AGENT_REPURCHASE
(1,'AGENT_REPURCHASE',       'observe',  NULL,  false, 'Calcule les cycles, ne déclenche pas'),
(2,'AGENT_REPURCHASE',       'suggest',  NULL,  true,  'Propose les campagnes rachat, humain valide'),
(3,'AGENT_REPURCHASE',       'semi_auto',10,    false, 'Déclenche auto emails rachat < €10 impact'),
(4,'AGENT_REPURCHASE',       'auto',     NULL,  false, 'Rachat plein auto'),
(5,'AGENT_REPURCHASE',       'auto',     NULL,  false, NULL),
-- AGENT_LOYALTY
(1,'AGENT_LOYALTY',          'observe',  NULL,  false, 'Configure le programme, n attribue pas de points'),
(2,'AGENT_LOYALTY',          'semi_auto',NULL,  false, 'Attribue points achat auto, tiers suggérés'),
(3,'AGENT_LOYALTY',          'auto',     NULL,  false, 'Points + tiers + campagnes auto'),
(4,'AGENT_LOYALTY',          'auto',     NULL,  false, NULL),
(5,'AGENT_LOYALTY',          'auto',     NULL,  false, NULL),
-- AGENT_CONTENT_ORCHESTRATOR
(1,'AGENT_CONTENT_ORCHESTRATOR','observe',NULL, false, 'Planifie le cycle, ne l applique pas'),
(2,'AGENT_CONTENT_ORCHESTRATOR','suggest',NULL, true,  'Soumet le plan de la semaine pour approbation'),
(3,'AGENT_CONTENT_ORCHESTRATOR','semi_auto',NULL,false,'Applique le budget ×, suggère le contenu'),
(4,'AGENT_CONTENT_ORCHESTRATOR','auto',   NULL, false, 'Orchestration complète auto'),
(5,'AGENT_CONTENT_ORCHESTRATOR','auto',   NULL, false, NULL),
-- AGENT_GIFT_CONVERSION
(1,'AGENT_GIFT_CONVERSION',  'observe',  NULL,  false, 'Détecte les cadeaux, ne contacte pas'),
(2,'AGENT_GIFT_CONVERSION',  'semi_auto',NULL,  false, 'Envoie emails welcome auto'),
(3,'AGENT_GIFT_CONVERSION',  'auto',     NULL,  false, 'Détection + welcome + suivi plein auto'),
(4,'AGENT_GIFT_CONVERSION',  'auto',     NULL,  false, NULL),
(5,'AGENT_GIFT_CONVERSION',  'auto',     NULL,  false, NULL),
-- AGENT_CREATIVE_FATIGUE
(1,'AGENT_CREATIVE_FATIGUE', 'auto',     NULL,  false, 'Détection toujours active — signale, ne retire pas'),
(2,'AGENT_CREATIVE_FATIGUE', 'semi_auto',NULL,  false, 'Retire auto fatigue sévère, suggère modéré'),
(3,'AGENT_CREATIVE_FATIGUE', 'auto',     NULL,  false, 'Retire + remplace auto'),
(4,'AGENT_CREATIVE_FATIGUE', 'auto',     NULL,  false, NULL),
(5,'AGENT_CREATIVE_FATIGUE', 'auto',     NULL,  false, NULL),
-- AGENT_COHORT
(1,'AGENT_COHORT',           'auto',     NULL,  false, 'Calcul cohortes toujours actif'),
(2,'AGENT_COHORT',           'auto',     NULL,  false, NULL),
(3,'AGENT_COHORT',           'auto',     NULL,  false, NULL),
(4,'AGENT_COHORT',           'auto',     NULL,  false, NULL),
(5,'AGENT_COHORT',           'auto',     NULL,  false, NULL)
ON CONFLICT (tier, agent_name) DO NOTHING;

-- Seuils dynamiques v7.0
INSERT INTO dynamic_thresholds
  (shop_id, threshold_key, current_value, default_value, min_value, max_value,
   calibration_method, description, unit)
VALUES
(NULL,'creative_fatigue_frequency',   3.0, 3.0, 1.5, 6.0, 'statistical',
 'Fréquence 7j déclenchant l alerte fatigue créatif', 'ratio'),
(NULL,'creative_fatigue_ctr_drop',    0.25,0.25,0.10,0.50,'statistical',
 '% de chute CTR vs semaine 1 pour fatigue modérée', 'ratio'),
(NULL,'loyalty_points_per_eur',       10,  10,  5,   50,  'manual',
 'Points attribués par euro dépensé', 'count'),
(NULL,'gift_welcome_discount_pct',    15,  15,  10,  25,  'manual',
 '% de réduction offert aux destinataires de cadeaux', 'pct'),
(NULL,'repurchase_trigger_days_before',10, 10,  5,   21,  'statistical',
 'Jours avant épuisement estimé pour déclencher campagne rachat', 'days'),
(NULL,'cohort_min_size',              3,   3,   2,   10,  'manual',
 'Taille minimum d une cohorte pour l analyser', 'count'),
(NULL,'content_cycle_urgency_mult',   1.40,1.40,1.10,2.00,'manual',
 'Multiplicateur budget semaine urgence', 'ratio'),
(NULL,'content_cycle_education_mult', 0.70,0.70,0.40,0.90,'manual',
 'Multiplicateur budget semaine éducation', 'ratio')
ON CONFLICT (shop_id, threshold_key) DO NOTHING;

-- Scheduler v7.0
INSERT INTO agent_schedule
  (agent_name, task_type, schedule_type, cron_expr, priority, tenant_scope, enabled, description)
VALUES
('AGENT_REPURCHASE',          'compute_lifecycles',     'cron','0 2 * * 1',  7,'all',true,
 'Calcul cycles vie produit — lundi 02:00'),
('AGENT_REPURCHASE',          'identify_opportunities', 'cron','0 6 * * *',  8,'all',true,
 'Identification opportunités rachat — 06:00 daily'),
('AGENT_REPURCHASE',          'trigger_campaigns',      'cron','0 9 * * *',  9,'all',true,
 'Déclenchement campagnes rachat — 09:00 daily'),
('AGENT_LOYALTY',             'expire_points',          'cron','0 1 * * *',  5,'all',true,
 'Expiration points fidélité — 01:00 daily'),
('AGENT_LOYALTY',             'generate_campaigns',     'cron','0 10 * * 1', 6,'all',true,
 'Campagnes fidélité — lundi 10:00'),
('AGENT_CONTENT_ORCHESTRATOR','plan_week',              'cron','0 7 * * 1',  8,'all',true,
 'Planification semaine contenu/promo — lundi 07:00'),
('AGENT_CONTENT_ORCHESTRATOR','apply_week',             'cron','0 8 * * 1',  9,'all',true,
 'Application plan contenu/promo — lundi 08:00'),
('AGENT_GIFT_CONVERSION',     'detect_gifts',           'cron','0 */6 * * *',7,'all',true,
 'Détection commandes cadeaux — toutes les 6h'),
('AGENT_GIFT_CONVERSION',     'send_welcome',           'cron','0 11 * * *', 6,'all',true,
 'Envoi emails bienvenue cadeaux — 11:00 daily'),
('AGENT_CREATIVE_FATIGUE',    'detect',                 'cron','0 */4 * * *',8,'all',true,
 'Détection fatigue créatifs — toutes les 4h'),
('AGENT_COHORT',              'compute',                'cron','0 3 2 * *',  5,'all',true,
 'Calcul cohortes — 2 du mois 03:00')
ON CONFLICT DO NOTHING;
