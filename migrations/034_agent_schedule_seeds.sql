
-- v5.0 agents
INSERT INTO agent_schedule
  (agent_name, task_type, schedule_type, cron_expr, priority, tenant_scope, enabled, description)
VALUES
('AGENT_TIER_MANAGER',       'evaluate',      'cron', '0 6 * * *',    10, 'all', true,
 'Tier progression evaluation — 06:00 daily'),
('AGENT_VERBATIM',           'send_surveys',  'cron', '0 10 * * *',   6,  'all', true,
 'Post-purchase survey dispatch — 10:00 daily'),
('AGENT_VERBATIM',           'generate_insights','cron','0 3 * * 1',  5,  'all', true,
 'Weekly verbatim insights — Monday 03:00'),
('AGENT_REPUTATION',         'scan',          'cron', '0 8 * * *',    8,  'all', true,
 'Reputation scan — 08:00 daily'),
('AGENT_REPUTATION',         'check_article6','cron', '0 */4 * * *',  9,  'all', true,
 'Article 6 check — every 4h'),
('AGENT_PERFORMANCE_BILLING','compute_month', 'cron', '0 7 1 * *',    8,  'all', true,
 'Monthly billing computation — 1st of month 07:00'),
('AGENT_PERFORMANCE_BILLING','issue_invoice', 'cron', '0 9 1 * *',    7,  'all', true,
 'Invoice issuance — 1st of month 09:00');

-- v6.0 agents
INSERT INTO agent_schedule
  (agent_name, task_type, schedule_type, cron_expr, priority, tenant_scope, enabled, description)
VALUES
('AGENT_BEHAVIORAL_LEARNING','extract_patterns','cron','0 4 * * 1',  7,'all',true,
 'Pattern extraction hebdomadaire — lundi 04:00'),
('AGENT_BEHAVIORAL_LEARNING','cross_validate',  'cron','0 5 1 * *',  5,'all',true,
 'Cross-validation patterns — 1er du mois'),
('AGENT_BENCHMARK',         'contribute',       'cron','0 3 1 * *',  6,'all',true,
 'Contribution benchmarks anonymisée — 1er du mois'),
('AGENT_BENCHMARK',         'recompute',        'cron','0 4 2 * *',  5,'all',true,
 'Recompute benchmarks sectoriels — 2 du mois'),
('AGENT_BENCHMARK',         'get_position',     'cron','0 7 * * 1',  4,'all',true,
 'Position vs benchmarks — lundi 07:00'),
('AGENT_THRESHOLD_CALIBRATOR','calibrate_all',  'cron','0 3 1 * *',  8,'all',true,
 'Recalibration mensuelle de tous les seuils — 1er du mois')
ON CONFLICT DO NOTHING;
