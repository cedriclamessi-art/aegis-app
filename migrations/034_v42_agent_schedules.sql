-- ============================================================
-- Migration 034 — AEGIS v4.2 — Agent Schedule Seed
-- All 34 agents registered with their execution intervals.
-- The worker reads this table to trigger tasks.
-- ============================================================

-- Clear and re-seed (idempotent)
DELETE FROM agent_schedule WHERE agent_id LIKE 'AGENT_%';

INSERT INTO agent_schedule
  (agent_id, task_type, schedule_type, interval_ms, cron_expr, tenant_scope, priority, payload_template) VALUES

-- ── CORE PIPELINE (runs every 30 min) ─────────────────────────
('AGENT_ORCHESTRATOR',     'evaluate',        'interval', 1800000,  NULL, 'all',  1,  '{}'),
('AGENT_SCALE',            'evaluate',        'interval', 1800000,  NULL, 'all',  2,  '{}'),
('AGENT_STOP_LOSS',        'scan',            'interval', 1800000,  NULL, 'all',  2,  '{}'),
('AGENT_ANOMALY',          'scan',            'interval', 900000,   NULL, 'all',  1,  '{}'),  -- 15 min
('AGENT_EVALUATOR',        'evaluate',        'interval', 3600000,  NULL, 'all',  3,  '{}'),  -- 1h

-- ── PERFORMANCE AGENTS (hourly) ───────────────────────────────
('AGENT_DAYPARTING',       'evaluate',        'interval', 3600000,  NULL, 'all',  3,  '{}'),
('AGENT_AOV',              'compute',         'interval', 3600000,  NULL, 'all',  4,  '{}'),
('AGENT_PIXEL_HEALTH',     'check',           'interval', 3600000,  NULL, 'all',  2,  '{}'),
('AGENT_ATTRIBUTION',      'reconcile',       'interval', 3600000,  NULL, 'all',  3,  '{}'),
('AGENT_ROI_TRACKER',      'compute',         'interval', 3600000,  NULL, 'all',  4,  '{}'),

-- ── INTELLIGENCE (every 4–6h) ─────────────────────────────────
('AGENT_SHADOW_MODE',      'record_human',    'interval', 21600000, NULL, 'all',  4,  '{}'),  -- 6h
('AGENT_SEASONAL_CALENDAR','check_phases',    'interval', 21600000, NULL, 'all',  3,  '{}'),  -- 6h
('AGENT_HEALTH_PROBES',    'run_all',         'interval', 21600000, NULL, 'all',  2,  '{}'),  -- 6h
('AGENT_DECISION_NARRATOR','narrate_batch',   'interval', 3600000,  NULL, 'all',  5,  '{}'),  -- 1h
('AGENT_COMPETITIVE_INTEL','analyze',         'interval', 14400000, NULL, 'all',  4,  '{}'),  -- 4h
('AGENT_AUDIENCE_INTEL',   'analyze',         'interval', 14400000, NULL, 'all',  4,  '{}'),  -- 4h

-- ── DAILY TASKS (cron: 06:00 UTC) ────────────────────────────
('AGENT_PROFITABILITY',    'compute_daily',   'cron',     NULL, '0 6 * * *', 'all', 3, '{}'),
('AGENT_RFM',              'compute',         'cron',     NULL, '0 6 * * *', 'all', 3, '{}'),
('AGENT_GA4',              'sync',            'cron',     NULL, '0 6 * * *', 'all', 4, '{}'),
('AGENT_REPLENISHMENT',    'sync_inventory',  'cron',     NULL, '0 7 * * *', 'all', 3, '{}'),
('AGENT_BUDGET_OPTIMIZER', 'analyze',         'cron',     NULL, '0 7 * * *', 'all', 4, '{}'),
('AGENT_BRIEF_AB',         'record_action',   'cron',     NULL, '0 */2 * * *', 'all', 5, '{}'),  -- every 2h
('AGENT_CREATIVE_KNOWLEDGE','update',         'cron',     NULL, '0 8 * * *', 'all', 4, '{}'),
('AGENT_GUARDRAIL_CALIBRATOR','calibrate',    'cron',     NULL, '0 5 1 * *', 'all', 3, '{}'),   -- monthly

-- ── SYNC & DELIVERY (cron: various) ──────────────────────────
('AGENT_KLAVIYO',          'sync_rfm',        'cron',     NULL, '0 9 * * *', 'all', 3, '{}'),
('AGENT_SYNC_GUARDIAN',    'check',           'interval', 3600000,  NULL, 'all', 2, '{}'),
('AGENT_DELIVERY',         'send_brief',      'cron',     NULL, '0 8 * * *', 'all', 2, '{}'),  -- 08:00 daily brief
('AGENT_MONTHLY_REPORT',   'generate',        'cron',     NULL, '0 9 1 * *', 'all', 3, '{}'),  -- 1st of month

-- ── GROWTH & PRODUCT ──────────────────────────────────────────
('AGENT_DCT_ITERATION',    'evaluate',        'interval', 86400000, NULL, 'all', 4, '{}'),   -- daily
('AGENT_PRICING',          'evaluate',        'interval', 86400000, NULL, 'all', 4, '{}'),   -- daily
('AGENT_TIKTOK_ORGANIC',   'generate',        'cron',     NULL, '0 10 * * 1', 'all', 5, '{}'), -- weekly Monday
('AGENT_STRATEGIES',       'evaluate',        'cron',     NULL, '0 10 * * 1', 'all', 5, '{}'), -- weekly Monday
('AGENT_FORECASTER',       'forecast',        'cron',     NULL, '0 7 * * *', 'all', 4, '{}'),  -- daily 07:00
('AGENT_CREATIVE_VISION',  'analyze_batch',   'interval', 86400000, NULL, 'all', 5, '{}');   -- daily

-- Set next_run_at for all cron schedules
UPDATE agent_schedule SET next_run_at = NOW() WHERE next_run_at IS NULL;

SELECT agent_id, task_type, 
  CASE WHEN schedule_type='interval' THEN (interval_ms/60000)::text || 'min'
       ELSE cron_expr END AS schedule,
  priority
FROM agent_schedule
ORDER BY priority, agent_id;

-- ── v5.0 new agents ──────────────────────────────────────────
INSERT INTO agent_schedule
  (agent_name, task_type, schedule_type, cron_expr, priority, tenant_scope, enabled, description)
VALUES
('AGENT_TIER_MANAGER',        'evaluate',        'cron','0 4 * * *',  10,'all',true,'Évaluation progression de palier — 04:00'),
('AGENT_VERBATIM',            'send_surveys',    'cron','0 10 * * *', 7, 'all',true,'Envoi surveys post-achat — 10:00'),
('AGENT_VERBATIM',            'generate_insights','cron','0 5 * * 1', 6, 'all',true,'Synthèse verbatims — Lundi 05:00'),
('AGENT_REPUTATION',          'scan',            'cron','0 */8 * * *',8, 'all',true,'Scan réputation — toutes les 8h'),
('AGENT_ONBOARDING',          'get_status',      'cron','*/30 * * * *',3,'all',false,'Status check onboarding'),
('AGENT_PERFORMANCE_BILLING', 'compute_month',   'cron','0 6 1 * *',  9, 'all',true,'Calcul facture mensuelle — 1er du mois 06:00'),
('AGENT_PERFORMANCE_BILLING', 'issue_invoice',   'cron','0 8 1 * *',  8, 'all',true,'Émission facture — 1er du mois 08:00')
ON CONFLICT DO NOTHING;
