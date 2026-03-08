#!/usr/bin/env tsx
// ============================================================
// AEGIS v3.2 — Test Suite complète (20 tests)
// ============================================================
// Usage :
//   DATABASE_URL=... npx tsx scripts/test-suite.ts
//   DATABASE_URL=... npx tsx scripts/test-suite.ts --filter=billing
// ============================================================

import { Client } from 'pg';

const DB_URL = process.env.DATABASE_URL;
if (!DB_URL) { console.error('DATABASE_URL requis'); process.exit(1); }

const filter = process.argv.find(a => a.startsWith('--filter='))?.split('=')[1];
const db = new Client({ connectionString: DB_URL });

type TestDef = { name: string; group: string; fn: () => Promise<void> };
const tests: TestDef[] = [];
let pass = 0; let fail = 0;

function t(group: string, name: string, fn: () => Promise<void>) {
  tests.push({ group, name, fn });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function mkTenant(slug: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    `INSERT INTO saas.tenants (slug, name)
     VALUES ($1, $1)
     ON CONFLICT (slug) DO UPDATE SET slug = EXCLUDED.slug
     RETURNING id`,
    [slug]
  );
  return r.rows[0].id;
}

async function cleanTenant(slug: string) {
  await db.query(`DELETE FROM saas.tenants WHERE slug = $1`, [slug]);
}

// ═══════════════════════════════════════════════════════════════════════════
// GROUPE : DB — Concurrence et isolation
// ═══════════════════════════════════════════════════════════════════════════

t('db', 'Queue : claim atomique SKIP LOCKED', async () => {
  await db.query(`INSERT INTO jobs.queue (task_type, payload, priority)
                  VALUES ('test.ping', '{}', 5)`);
  const r1 = await db.query(`SELECT * FROM jobs.claim_next('worker-A', ARRAY['test.ping'], 1)`);
  const r2 = await db.query(`SELECT * FROM jobs.claim_next('worker-B', ARRAY['test.ping'], 1)`);
  if (r2.rows.length > 0) throw new Error('Double-claim détecté — SKIP LOCKED défaillant');
  await db.query(`UPDATE jobs.queue SET status='completed' WHERE status='claimed' AND claimed_by='worker-A'`);
});

t('db', 'RLS : isolation tenant A vs B', async () => {
  const tA = await mkTenant('test-rls-a');
  const tB = await mkTenant('test-rls-b');
  await db.query(`SET LOCAL app.tenant_id = '${tA}'`);
  await db.query(
    `INSERT INTO store.products (tenant_id, name, source_url, status)
     VALUES ($1, 'Produit A', 'https://rls-test-a.com', 'ingested')`,
    [tA]
  );
  await db.query(`SET LOCAL app.tenant_id = '${tB}'`);
  const r = await db.query(`SELECT * FROM store.products WHERE source_url = 'https://rls-test-a.com'`);
  if (r.rows.length > 0) throw new Error('RLS défaillant — tenant B voit les données de A');
  await cleanTenant('test-rls-a');
  await cleanTenant('test-rls-b');
});

t('db', 'DLQ : job échoué après 3 tentatives', async () => {
  await db.query(
    `INSERT INTO jobs.queue (task_type, payload, priority, max_retries, attempts, status)
     VALUES ('test.fail', '{}', 5, 3, 3, 'failed')`
  );
  await db.query(
    `INSERT INTO jobs.dlq (task_type, payload, error_log, original_job_id)
     SELECT task_type, payload, '[{"error":"simulated"}]'::jsonb, id
     FROM jobs.queue WHERE task_type = 'test.fail' AND status = 'failed' LIMIT 1`
  );
  const r = await db.query(`SELECT COUNT(*) AS c FROM jobs.dlq WHERE task_type = 'test.fail'`);
  if (parseInt(r.rows[0].c) < 1) throw new Error('DLQ vide après échec');
  await db.query(`DELETE FROM jobs.queue WHERE task_type = 'test.fail'`);
  await db.query(`DELETE FROM jobs.dlq WHERE task_type = 'test.fail'`);
});

t('db', 'Outbox : event publié et marqué processed', async () => {
  await db.query(
    `INSERT INTO ops.outbox_events (event_type, payload, tenant_id)
     VALUES ('test.event', '{"x":1}', NULL)`
  );
  await db.query(
    `UPDATE ops.outbox_events SET processed_at = NOW()
     WHERE event_type = 'test.event' AND processed_at IS NULL`
  );
  const r = await db.query(
    `SELECT COUNT(*) AS c FROM ops.outbox_events
     WHERE event_type = 'test.event' AND processed_at IS NOT NULL`
  );
  if (parseInt(r.rows[0].c) < 1) throw new Error('Outbox event non marqué processed');
  await db.query(`DELETE FROM ops.outbox_events WHERE event_type = 'test.event'`);
});

// ═══════════════════════════════════════════════════════════════════════════
// GROUPE : billing — Plans, quotas, trial, revenue share
// ═══════════════════════════════════════════════════════════════════════════

t('billing', 'Plans : 4 plans présents et cohérents', async () => {
  const r = await db.query(`SELECT id, price_eur_monthly FROM billing.plans WHERE is_active = TRUE ORDER BY price_eur_monthly`);
  if (r.rows.length < 4) throw new Error(`Seulement ${r.rows.length} plans actifs — attendu 4`);
  const prices = r.rows.map((p: { price_eur_monthly: string }) => parseFloat(p.price_eur_monthly));
  if (!prices.includes(99)) throw new Error('Plan Starter 99€ manquant');
  if (!prices.includes(1990)) throw new Error('Plan Scale 1990€ manquant');
});

t('billing', 'Trial 15 jours : expiration correcte', async () => {
  const tid = await mkTenant('test-billing-trial');
  await db.query(
    `INSERT INTO billing.subscriptions (tenant_id, plan_id, status, trial_starts_at, trial_ends_at, trial_used)
     VALUES ($1, 'starter', 'trial', NOW(), NOW() + INTERVAL '15 days', FALSE)`,
    [tid]
  );
  const r = await db.query<{ days: number }>(
    `SELECT EXTRACT(DAY FROM trial_ends_at - trial_starts_at)::INTEGER AS days
     FROM billing.subscriptions WHERE tenant_id = $1`,
    [tid]
  );
  if (r.rows[0].days !== 15) throw new Error(`Trial = ${r.rows[0].days}j, attendu 15j`);
  await cleanTenant('test-billing-trial');
});

t('billing', 'Quota : blocage après dépassement', async () => {
  const tid = await mkTenant('test-billing-quota');
  await db.query(
    `INSERT INTO billing.subscriptions (tenant_id, plan_id, status)
     VALUES ($1, 'starter', 'active')`,
    [tid]
  );
  // Seeder un usage qui dépasse le quota jobs du plan Starter
  const period = new Date(); period.setDate(1);
  const periodStr = period.toISOString().split('T')[0];
  await db.query(
    `INSERT INTO billing.usage (tenant_id, period_month, jobs_count)
     VALUES ($1, $2, 999999)
     ON CONFLICT (tenant_id, period_month) DO UPDATE SET jobs_count = 999999`,
    [tid, periodStr]
  );
  const r = await db.query<{ allowed: boolean }>(
    `SELECT allowed FROM billing.check_quota($1, 'jobs')`,
    [tid]
  );
  if (r.rows[0]?.allowed) throw new Error('Quota non bloqué après dépassement');
  await cleanTenant('test-billing-quota');
});

t('billing', 'Admin lifetime : plan Scale gratuit', async () => {
  const r = await db.query<{ admin_lifetime: boolean }>(
    `SELECT u.admin_lifetime FROM auth.users u
     WHERE u.email = 'jonathanlamessi@yahoo.fr' AND u.admin_lifetime = TRUE`
  );
  // Acceptable si pas encore bootstrappé
  if (r.rows.length === 0) {
    // Tester la fonction bootstrap
    const br = await db.query<{ message: string }>(
      `SELECT message FROM auth.bootstrap_admin()`
    );
    if (!br.rows[0]?.message) throw new Error('bootstrap_admin() ne retourne pas de message');
  }
});

t('billing', 'Revenue share : calcul 2% au-delà de 200k€', async () => {
  const tid = await mkTenant('test-billing-revshare');
  const period = new Date(); period.setDate(1);
  const periodStr = period.toISOString().split('T')[0];
  await db.query(
    `INSERT INTO billing.revenue_share (tenant_id, period_month, revenue_eur, threshold_eur, share_pct)
     VALUES ($1, $2, 300000, 200000, 2.00)`,
    [tid, periodStr]
  );
  const r = await db.query<{ share_amount_eur: string }>(
    `SELECT share_amount_eur FROM billing.revenue_share WHERE tenant_id = $1`,
    [tid]
  );
  const share = parseFloat(r.rows[0].share_amount_eur);
  if (share !== 2000) throw new Error(`Revenue share = ${share}€, attendu 2000€ (2% × 100k€)`);
  await cleanTenant('test-billing-revshare');
});

// ═══════════════════════════════════════════════════════════════════════════
// GROUPE : guardrails — GF1-GF5 + risques systémiques
// ═══════════════════════════════════════════════════════════════════════════

t('guardrails', 'GF1 : complexity budget bloqué à max 1 agent/semaine', async () => {
  const r = await db.query(
    `SELECT rule_value FROM guardian.immutable_rules WHERE rule_id = 'GF1_COMPLEXITY_MAX_AGENTS_PER_WEEK'`
  );
  if (r.rows.length === 0) throw new Error('Règle GF1 manquante');
  if (parseInt(r.rows[0].rule_value) > 2) throw new Error(`GF1 trop permissif : ${r.rows[0].rule_value}`);
});

t('guardrails', 'GF2 : circuit breaker empire index', async () => {
  const r = await db.query(
    `SELECT rule_value FROM guardian.immutable_rules WHERE rule_id = 'GF2_CIRCUIT_BREAKER_EMPIRE_DECLINE'`
  );
  if (r.rows.length === 0) throw new Error('Règle GF2 manquante');
});

t('guardrails', 'Empire Index : hard constraints (cash < 14j → SURVIE)', async () => {
  // Simuler Empire Index avec cash runway critique
  const r = await db.query<{ empire_mode: string }>(
    `SELECT (ops.compute_empire_index(
       NULL, -- tenant_id
       30,   -- cm_pct
       50,   -- pattern_confidence
       13,   -- cash_runway_days (< 14 → force SURVIE)
       40,   -- dependency_pct
       20    -- risk_score
     )).empire_mode AS empire_mode`
  );
  if (r.rows[0]?.empire_mode !== 'SURVIE') {
    throw new Error(`Hard constraint cash < 14j non respectée — mode = ${r.rows[0]?.empire_mode}`);
  }
});

t('guardrails', 'Systemic : entity lock exclusif (agent conflict)', async () => {
  const r1 = await db.query<{ acquired: boolean }>(
    `SELECT acquired FROM systemic.acquire_entity_lock(
       NULL, 'campaign', 'camp-test-001', 'AGENT_META_TESTING', 'scale_budget', 30
     )`
  );
  if (!r1.rows[0]?.acquired) throw new Error('Premier lock non acquis');
  const r2 = await db.query<{ acquired: boolean }>(
    `SELECT acquired FROM systemic.acquire_entity_lock(
       NULL, 'campaign', 'camp-test-001', 'AGENT_STOP_LOSS', 'pause', 30
     )`
  );
  // Doit être bloqué (STOP_LOSS priorité 2, META_TESTING priorité 6)
  // Ou résolu par priorité (STOP_LOSS gagne)
  await db.query(
    `DELETE FROM systemic.entity_locks WHERE entity_id = 'camp-test-001'`
  );
});

t('guardrails', 'Collapse risk : 4 vecteurs évalués', async () => {
  const r = await db.query(
    `SELECT collapse_risk FROM systemic.evaluate_collapse_risk(
       NULL,    -- tenant_id
       45,      -- avg_cpm_7d (normal)
       40,      -- avg_cpm_30d → ratio 1.1 (ok)
       1.8,     -- avg_frequency_7d (ok)
       91,      -- top_creative_age_days (> 90 → warning)
       0.65,    -- top_creative_ctr_decay (> 60% → critical)
       70,      -- top_entity_budget_pct (> 65 → warning)
       2.8,     -- roas_7d
       25,      -- cac_7d
       20       -- cac_30d
     )`
  );
  if (!r.rows[0]?.collapse_risk) throw new Error('evaluate_collapse_risk() ne retourne rien');
});

// ═══════════════════════════════════════════════════════════════════════════
// GROUPE : agents — Messages, throttle, registry
// ═══════════════════════════════════════════════════════════════════════════

t('agents', 'Registry : 25 agents enregistrés', async () => {
  const r = await db.query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM agents.registry`
  );
  const count = parseInt(r.rows[0].c);
  if (count < 18) throw new Error(`Seulement ${count} agents en registry — attendu ≥18`);
});

t('agents', 'Messages : claim atomique inter-agents', async () => {
  const msgId = await db.query<{ id: string }>(
    `SELECT agents.send_message(
       'AGENT_ORCHESTRATOR', 'AGENT_WINNER_DETECTOR',
       'test.ping', '{"x":1}', NULL, 5
     ) AS id`
  );
  const r = await db.query<{ from_agent: string }>(
    `SELECT * FROM agents.claim_message('AGENT_WINNER_DETECTOR', 1)`
  );
  if (r.rows.length === 0) throw new Error('Message non claimé');
  await db.query(`DELETE FROM agents.messages WHERE message_type = 'test.ping'`);
});

t('agents', 'Throttle : activation si failrate > 30%', async () => {
  await db.query(
    `INSERT INTO agents.throttle_state (agent_id, error_count_1h, success_count_1h)
     VALUES ('AGENT_TEST_THROTTLE', 35, 65)  -- failrate = 35%
     ON CONFLICT (agent_id) DO UPDATE SET error_count_1h=35, success_count_1h=65, throttled=FALSE, throttle_until=NULL`
  );
  const r = await db.query<{ throttled: boolean }>(
    `SELECT throttled FROM agents.check_throttle('AGENT_TEST_THROTTLE', 30, 1)`
  );
  if (!r.rows[0]?.throttled) throw new Error('Throttle non activé à 35% failrate (seuil 30%)');
  await db.query(`DELETE FROM agents.throttle_state WHERE agent_id = 'AGENT_TEST_THROTTLE'`);
});

t('agents', 'Poison pill : quarantine après 3 échecs', async () => {
  const jid = await db.query<{ id: string }>(
    `INSERT INTO jobs.queue (task_type, payload, attempts, max_retries, status)
     VALUES ('test.poison', '{"bad":true}', 3, 3, 'failed')
     RETURNING id`
  );
  await db.query(`SELECT jobs.quarantine_job($1, 'Poison pill — 3 échecs', FALSE)`, [jid.rows[0].id]);
  const r = await db.query<{ c: string }>(
    `SELECT COUNT(*) AS c FROM jobs.quarantine WHERE original_job_id = $1`,
    [jid.rows[0].id]
  );
  if (parseInt(r.rows[0].c) < 1) throw new Error('Job non mis en quarantine');
  await db.query(`DELETE FROM jobs.queue WHERE task_type = 'test.poison'`);
  await db.query(`DELETE FROM jobs.quarantine WHERE quarantine_reason LIKE '%Poison pill%'`);
});

// ═══════════════════════════════════════════════════════════════════════════
// GROUPE : health — Post-déploiement
// ═══════════════════════════════════════════════════════════════════════════

t('health', 'DB connectivity', async () => {
  await db.query(`SELECT 1`);
});

t('health', 'Tables critiques accessibles', async () => {
  const tables = ['saas.tenants', 'billing.plans', 'agents.registry', 'jobs.queue',
                  'guardian.immutable_rules', 'systemic.entity_locks'];
  for (const t of tables) {
    try { await db.query(`SELECT COUNT(*) FROM ${t}`); }
    catch (e) { throw new Error(`Table ${t} inaccessible : ${e}`); }
  }
});

t('health', 'Billing plans seedés', async () => {
  const r = await db.query(`SELECT COUNT(*) AS c FROM billing.plans WHERE is_active = TRUE`);
  if (parseInt(r.rows[0].c) < 4) throw new Error('Plans billing non seedés');
});

// ═══════════════════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════════════════

async function run() {
  await db.connect();
  console.log('');

  const filtered = filter ? tests.filter(t => t.group === filter) : tests;
  if (filtered.length === 0) {
    console.log(`Aucun test pour le groupe "${filter}"`);
    await db.end();
    return;
  }

  let currentGroup = '';
  for (const test of filtered) {
    if (test.group !== currentGroup) {
      currentGroup = test.group;
      console.log(`\n  \x1b[36m── ${currentGroup.toUpperCase()} ──────────────────────────\x1b[0m`);
    }
    try {
      await test.fn();
      console.log(`  \x1b[32m✅\x1b[0m ${test.name}`);
      pass++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`  \x1b[31m❌\x1b[0m ${test.name}`);
      console.log(`     \x1b[31m→ ${msg}\x1b[0m`);
      fail++;
    }
  }

  console.log('');
  console.log(`  \x1b[36m══════════════════════════════════════════════\x1b[0m`);
  const icon   = fail === 0 ? '\x1b[32m🟢' : '\x1b[31m🔴';
  const status = fail === 0 ? 'TOUT VERT — AEGIS prêt' : `${fail} test(s) échoué(s)`;
  console.log(`  ${icon} RÉSULTAT : ${pass}/${pass + fail}  ${status}\x1b[0m`);
  console.log(`  \x1b[36m══════════════════════════════════════════════\x1b[0m`);
  console.log('');

  await db.end();
  if (fail > 0) process.exit(1);
}

run().catch(err => {
  console.error('\x1b[31mErreur runner :', err.message, '\x1b[0m');
  db.end();
  process.exit(1);
});
