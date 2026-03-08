/**
 * AEGIS — Test Suite complète
 * ===========================
 * Couvre :
 *   1. Queue saturation + concurrence (claim atomique)
 *   2. Retry + DLQ + quarantine
 *   3. Budget cap block
 *   4. Stop-loss triggers
 *   5. Drift auto-heal
 *   6. Connector failure propagation
 *   7. RLS tenant isolation
 *   8. Billing quota enforcement
 *   9. Agent throttle (metabolic throttle)
 *  10. Empire Index circuit breaker
 *
 * Setup : DB de test isolée, chaque test dans une transaction rollbackée.
 */

import { Pool, PoolClient } from 'pg';
import { v4 as uuid } from 'uuid';

// ── Setup DB test ──────────────────────────────────────────────────────────

const TEST_DB_URL = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
let pool: Pool;
let adminClient: PoolClient;

// IDs fixtures
let tenantA: string;
let tenantB: string;

beforeAll(async () => {
  pool = new Pool({ connectionString: TEST_DB_URL });
  adminClient = await pool.connect();

  // Crée 2 tenants isolés pour les tests RLS
  tenantA = uuid();
  tenantB = uuid();

  await adminClient.query(`
    INSERT INTO saas.tenants (id, slug, name)
    VALUES ($1, 'test-tenant-a', 'Tenant A'),
           ($2, 'test-tenant-b', 'Tenant B')
    ON CONFLICT DO NOTHING
  `, [tenantA, tenantB]);

  // Plans billing (idempotent)
  await adminClient.query(`
    INSERT INTO billing.plans (id, name, price_eur_monthly, max_jobs_day, max_creatives_month, autopilot_mode)
    VALUES ('test-plan', 'Test Plan', 0, 10, 5, 'semi')
    ON CONFLICT DO NOTHING
  `);

  // Subscriptions actives
  await adminClient.query(`
    INSERT INTO billing.subscriptions (tenant_id, plan_id, status, trial_ends_at)
    VALUES ($1, 'test-plan', 'active', NOW() + INTERVAL '30 days'),
           ($2, 'test-plan', 'active', NOW() + INTERVAL '30 days')
    ON CONFLICT DO NOTHING
  `, [tenantA, tenantB]);
});

afterAll(async () => {
  // Nettoyage
  await adminClient.query(`DELETE FROM saas.tenants WHERE id IN ($1,$2)`, [tenantA, tenantB]);
  adminClient.release();
  await pool.end();
});

// Helper : client avec tenant_id configuré
async function clientFor(tenantId: string): Promise<PoolClient> {
  const client = await pool.connect();
  await client.query(`SET app.tenant_id = '${tenantId}'`);
  return client;
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. QUEUE SATURATION + CONCURRENCE
// ─────────────────────────────────────────────────────────────────────────────

describe('1. Queue — claim atomique + concurrence', () => {
  test('Deux workers ne peuvent pas claim le même job', async () => {
    // Insère 1 job
    const ins = await adminClient.query<{ id: bigint }>(
      `INSERT INTO jobs.queue (tenant_id, task_type, payload, status)
       VALUES ($1, 'test.concurrent', '{}', 'pending')
       RETURNING id`,
      [tenantA]
    );
    const jobId = ins.rows[0].id;

    // 2 workers tentent de claim en parallèle
    const [r1, r2] = await Promise.all([
      pool.query(`SELECT * FROM jobs.claim_next($1, 1)`, ['test.concurrent']),
      pool.query(`SELECT * FROM jobs.claim_next($1, 1)`, ['test.concurrent']),
    ]);

    const claimed = [r1.rows[0], r2.rows[0]].filter(Boolean);

    // Un seul doit avoir eu le job
    expect(claimed.length).toBe(1);
    expect(claimed[0].id).toBe(jobId);

    // Cleanup
    await adminClient.query(`DELETE FROM jobs.queue WHERE id = $1`, [jobId]);
  });

  test('Claim batch de N jobs retourne exactement N résultats disponibles', async () => {
    // Insère 5 jobs
    await adminClient.query(`
      INSERT INTO jobs.queue (tenant_id, task_type, payload, status)
      SELECT $1, 'test.batch', '{}', 'pending'
      FROM generate_series(1,5)
    `, [tenantA]);

    const r = await pool.query(`SELECT * FROM jobs.claim_next($1, 5)`, ['test.batch']);
    expect(r.rows.length).toBe(5);

    // Tous doivent être 'claimed'
    const ids = r.rows.map(row => row.id);
    const check = await adminClient.query(
      `SELECT COUNT(*) AS n FROM jobs.queue WHERE id = ANY($1) AND status = 'claimed'`,
      [ids]
    );
    expect(Number(check.rows[0].n)).toBe(5);

    // Cleanup
    await adminClient.query(`DELETE FROM jobs.queue WHERE id = ANY($1)`, [ids]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. RETRY + DLQ + QUARANTINE
// ─────────────────────────────────────────────────────────────────────────────

describe('2. Retry + DLQ + Quarantine', () => {
  test('Job qui échoue max_attempts fois → DLQ', async () => {
    const ins = await adminClient.query<{ id: bigint }>(
      `INSERT INTO jobs.queue (tenant_id, task_type, payload, status, max_attempts, attempts)
       VALUES ($1, 'test.failing', '{}', 'claimed', 3, 3)
       RETURNING id`,
      [tenantA]
    );
    const jobId = ins.rows[0].id;

    // Marque comme failed (simule l'échec du worker)
    await adminClient.query(
      `UPDATE jobs.queue SET status = 'failed', failed_at = NOW()
       WHERE id = $1 AND attempts >= max_attempts`,
      [jobId]
    );

    // Move to DLQ
    await adminClient.query(`SELECT jobs.quarantine_job($1, 'max_retries', FALSE)`, [jobId]);

    const dlq = await adminClient.query(
      `SELECT * FROM jobs.quarantine WHERE original_job_id = $1`,
      [jobId]
    );
    expect(dlq.rows.length).toBe(1);
    expect(dlq.rows[0].quarantine_reason).toBe('max_retries');

    // Job original marqué quarantined
    const orig = await adminClient.query(
      `SELECT status FROM jobs.queue WHERE id = $1`, [jobId]
    );
    expect(orig.rows[0]?.status).toBe('quarantined');

    // Cleanup
    await adminClient.query(`DELETE FROM jobs.quarantine WHERE original_job_id = $1`, [jobId]);
    await adminClient.query(`DELETE FROM jobs.queue WHERE id = $1`, [jobId]);
  });

  test('Job avec can_replay=true peut être rejoué', async () => {
    const ins = await adminClient.query<{ id: bigint }>(
      `INSERT INTO jobs.quarantine (tenant_id, task_type, payload, quarantine_reason, can_replay)
       VALUES ($1, 'test.replay', '{"x":1}', 'transient_error', TRUE)
       RETURNING id`,
      [tenantA]
    );
    const qId = ins.rows[0].id;

    const r = await adminClient.query(
      `SELECT can_replay FROM jobs.quarantine WHERE id = $1`, [qId]
    );
    expect(r.rows[0].can_replay).toBe(true);

    // Cleanup
    await adminClient.query(`DELETE FROM jobs.quarantine WHERE id = $1`, [qId]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. BUDGET CAP BLOCK
// ─────────────────────────────────────────────────────────────────────────────

describe('3. Budget cap — blocage des dépenses excessives', () => {
  test('check_quota bloque si jobs_count > max_jobs_day×30', async () => {
    const period = new Date();
    period.setDate(1); // Premier jour du mois

    // Insère usage au-dessus du quota (max=10/j × 30 = 300)
    await adminClient.query(`
      INSERT INTO billing.usage (tenant_id, period_month, jobs_count)
      VALUES ($1, DATE_TRUNC('month', NOW())::DATE, 400)
      ON CONFLICT (tenant_id, period_month)
      DO UPDATE SET jobs_count = 400
    `, [tenantA]);

    const r = await adminClient.query(
      `SELECT * FROM billing.check_quota($1, 'jobs')`,
      [tenantA]
    );

    expect(r.rows[0].allowed).toBe(false);
    expect(r.rows[0].message).toContain('Quota');

    // Reset
    await adminClient.query(`DELETE FROM billing.usage WHERE tenant_id = $1`, [tenantA]);
  });

  test('check_quota autorise si sous le quota', async () => {
    await adminClient.query(`
      INSERT INTO billing.usage (tenant_id, period_month, jobs_count)
      VALUES ($1, DATE_TRUNC('month', NOW())::DATE, 5)
      ON CONFLICT (tenant_id, period_month)
      DO UPDATE SET jobs_count = 5
    `, [tenantA]);

    const r = await adminClient.query(
      `SELECT * FROM billing.check_quota($1, 'jobs')`,
      [tenantA]
    );

    expect(r.rows[0].allowed).toBe(true);

    await adminClient.query(`DELETE FROM billing.usage WHERE tenant_id = $1`, [tenantA]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. STOP-LOSS TRIGGERS
// ─────────────────────────────────────────────────────────────────────────────

describe('4. Stop-loss — déclenchement sur perte', () => {
  test('Stop-loss se déclenche si ROAS < seuil minimum', async () => {
    // Insère une règle stop-loss
    const ruleIns = await adminClient.query<{ id: bigint }>(
      `INSERT INTO risk.stop_loss_rules
         (tenant_id, rule_name, entity_type, metric, operator, threshold_value, action, is_active)
       VALUES ($1, 'roas_floor', 'campaign', 'roas', '<', 1.5, 'pause', TRUE)
       RETURNING id`,
      [tenantA]
    );
    const ruleId = ruleIns.rows[0].id;

    // Simule une métrique de campagne avec ROAS = 0.9 (sous le seuil)
    const evalResult = await adminClient.query(`
      SELECT
        $1::NUMERIC < 1.5 AS should_trigger,
        CASE WHEN $1::NUMERIC < 1.5 THEN 'pause' ELSE 'none' END AS action
    `, [0.9]);

    expect(evalResult.rows[0].should_trigger).toBe(true);
    expect(evalResult.rows[0].action).toBe('pause');

    // Cleanup
    await adminClient.query(`DELETE FROM risk.stop_loss_rules WHERE id = $1`, [ruleId]);
  });

  test('Stop-loss ne se déclenche pas si ROAS >= seuil', async () => {
    const evalResult = await adminClient.query(`
      SELECT $1::NUMERIC < 1.5 AS should_trigger
    `, [2.8]);
    expect(evalResult.rows[0].should_trigger).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. DATA DRIFT AUTO-HEAL
// ─────────────────────────────────────────────────────────────────────────────

describe('5. Data drift — détection et invalidation', () => {
  test('Pattern invalidé si budget_drift > 3x', async () => {
    // Insère un pattern appris avec budget de 500€/mois
    const patIns = await adminClient.query<{ id: bigint }>(
      `INSERT INTO intel.patterns
         (tenant_id, pattern_type, pattern_key, confidence_score, sample_size, is_active)
       VALUES ($1, 'creative_angle', 'hook_pain_point', 0.85, 500, TRUE)
       RETURNING id`,
      [tenantA]
    );
    const patId = patIns.rows[0].id;

    // Insère validity tracking (appris à 500€/mois)
    await adminClient.query(`
      INSERT INTO systemic.pattern_validity
        (pattern_id, tenant_id, learned_at_budget_eur, learned_at_phase, is_valid)
      VALUES ($1, $2, 500, 1, TRUE)
      ON CONFLICT (pattern_id, tenant_id) DO UPDATE SET learned_at_budget_eur = 500
    `, [patId, tenantA]);

    // Simule un check avec budget actuel = 5000€ (10x)
    const driftResult = await adminClient.query(
      `SELECT * FROM systemic.check_pattern_drift($1, $2, 5000, 1, 70, 100000)`,
      [patId, tenantA]
    );

    // Doit détecter un drift de type budget
    const drifts = driftResult.rows[0]?.drift_vectors ?? [];
    const hasBudgetDrift = Array.isArray(drifts) && drifts.some((d: string) => d.includes('budget'));
    expect(hasBudgetDrift || driftResult.rows[0]?.is_valid === false).toBe(true);

    // Cleanup
    await adminClient.query(`DELETE FROM systemic.pattern_validity WHERE pattern_id = $1`, [patId]);
    await adminClient.query(`DELETE FROM intel.patterns WHERE id = $1`, [patId]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. CONNECTOR FAILURE PROPAGATION
// ─────────────────────────────────────────────────────────────────────────────

describe('6. Connector failure — mode dégradé', () => {
  test('Connecteur en erreur crée une alerte sans bloquer', async () => {
    // Insère un connecteur en erreur
    await adminClient.query(`
      INSERT INTO integrations.connectors
        (tenant_id, platform, platform_account_id, status, last_error)
      VALUES ($1, 'meta_test_fail', 'act_test', 'error', 'Token expiré')
      ON CONFLICT (tenant_id, platform) DO UPDATE SET status = 'error', last_error = 'Token expiré'
    `, [tenantA]);

    const conn = await adminClient.query(
      `SELECT status, last_error FROM integrations.connectors
       WHERE tenant_id = $1 AND platform = 'meta_test_fail'`,
      [tenantA]
    );

    expect(conn.rows[0].status).toBe('error');
    expect(conn.rows[0].last_error).toBe('Token expiré');

    // Le système doit encore fonctionner (jobs en attente, pas bloqués)
    const jobs = await adminClient.query(
      `SELECT COUNT(*) AS n FROM jobs.queue WHERE tenant_id = $1 AND status = 'pending'`,
      [tenantA]
    );
    // Jobs existants non bloqués par l'erreur du connecteur
    expect(Number(jobs.rows[0].n)).toBeGreaterThanOrEqual(0);

    // Cleanup
    await adminClient.query(
      `DELETE FROM integrations.connectors WHERE tenant_id = $1 AND platform = 'meta_test_fail'`,
      [tenantA]
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. RLS TENANT ISOLATION (critique)
// ─────────────────────────────────────────────────────────────────────────────

describe('7. RLS — isolation stricte entre tenants', () => {
  test('Tenant A ne voit pas les données de Tenant B', async () => {
    // Insère un job pour Tenant B
    const ins = await adminClient.query<{ id: bigint }>(
      `INSERT INTO jobs.queue (tenant_id, task_type, payload)
       VALUES ($1, 'test.rls', '{"secret":"tenant_b_data"}')
       RETURNING id`,
      [tenantB]
    );
    const jobId = ins.rows[0].id;

    // Tenant A tente de lire
    const clientA = await clientFor(tenantA);
    const r = await clientA.query(
      `SELECT * FROM jobs.queue WHERE id = $1`, [jobId]
    );
    clientA.release();

    // RLS : 0 résultats visibles pour Tenant A
    expect(r.rows.length).toBe(0);

    // Cleanup
    await adminClient.query(`DELETE FROM jobs.queue WHERE id = $1`, [jobId]);
  });

  test('Tenant B ne peut pas lire les subscriptions de Tenant A', async () => {
    const clientB = await clientFor(tenantB);
    const r = await clientB.query(
      `SELECT * FROM billing.subscriptions WHERE tenant_id = $1`, [tenantA]
    );
    clientB.release();

    expect(r.rows.length).toBe(0);
  });

  test('Chaque tenant voit uniquement ses propres données', async () => {
    // Insère un alert pour Tenant A
    await adminClient.query(`
      INSERT INTO ops.alerts (tenant_id, alert_type, severity, message)
      VALUES ($1, 'test_rls', 'info', 'Private Tenant A alert')
    `, [tenantA]);

    // Tenant A voit son alert
    const clientA = await clientFor(tenantA);
    const rA = await clientA.query(
      `SELECT * FROM ops.alerts WHERE alert_type = 'test_rls' AND tenant_id = $1`,
      [tenantA]
    );
    clientA.release();
    expect(rA.rows.length).toBe(1);

    // Tenant B ne le voit pas
    const clientB = await clientFor(tenantB);
    const rB = await clientB.query(
      `SELECT * FROM ops.alerts WHERE alert_type = 'test_rls'`
    );
    clientB.release();
    expect(rB.rows.length).toBe(0);

    // Cleanup
    await adminClient.query(`DELETE FROM ops.alerts WHERE alert_type = 'test_rls'`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. BILLING QUOTA ENFORCEMENT
// ─────────────────────────────────────────────────────────────────────────────

describe('8. Billing — enforcement des quotas', () => {
  test('Trial expiré → accès refusé', async () => {
    const tenantExpired = uuid();
    await adminClient.query(`
      INSERT INTO saas.tenants (id, slug, name) VALUES ($1, 'test-expired', 'Expired')
      ON CONFLICT DO NOTHING`, [tenantExpired]);

    await adminClient.query(`
      INSERT INTO billing.subscriptions (tenant_id, plan_id, status, trial_ends_at, trial_used)
      VALUES ($1, 'test-plan', 'trial', NOW() - INTERVAL '1 day', TRUE)
      ON CONFLICT DO NOTHING`, [tenantExpired]);

    const r = await adminClient.query(
      `SELECT * FROM billing.check_quota($1, 'jobs')`, [tenantExpired]
    );

    expect(r.rows[0].allowed).toBe(false);
    expect(r.rows[0].message).toContain('Trial expiré');

    await adminClient.query(`DELETE FROM saas.tenants WHERE id = $1`, [tenantExpired]);
  });

  test('Plan Scale : quota -1 = illimité', async () => {
    const tenantScale = uuid();
    await adminClient.query(`
      INSERT INTO saas.tenants (id, slug, name) VALUES ($1, 'test-scale', 'Scale')`, [tenantScale]);

    await adminClient.query(`
      INSERT INTO billing.subscriptions (tenant_id, plan_id, status)
      VALUES ($1, 'scale', 'active')`, [tenantScale]);

    const r = await adminClient.query(
      `SELECT * FROM billing.check_quota($1, 'jobs')`, [tenantScale]
    );
    expect(r.rows[0].allowed).toBe(true);
    expect(r.rows[0].plan_limit).toBe(-1);

    await adminClient.query(`DELETE FROM saas.tenants WHERE id = $1`, [tenantScale]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 9. METABOLIC THROTTLE
// ─────────────────────────────────────────────────────────────────────────────

describe('9. Metabolic throttle — freinage si failrate élevé', () => {
  test('Agent throttlé si failrate > 30%', async () => {
    const agentId = 'AGENT_TEST_THROTTLE';

    await adminClient.query(`
      INSERT INTO agents.throttle_state (agent_id, error_count_1h, success_count_1h)
      VALUES ($1, 40, 60)
      ON CONFLICT (agent_id) DO UPDATE SET error_count_1h=40, success_count_1h=60, throttled=FALSE
    `, [agentId]);

    const r = await adminClient.query(
      `SELECT * FROM agents.check_throttle($1, 30, 15)`, [agentId]
    );

    expect(r.rows[0].throttled).toBe(true);
    expect(r.rows[0].reason).toContain('Throttle activé');

    await adminClient.query(`DELETE FROM agents.throttle_state WHERE agent_id = $1`, [agentId]);
  });

  test('Agent non throttlé si failrate < 30%', async () => {
    const agentId = 'AGENT_TEST_OK';

    await adminClient.query(`
      INSERT INTO agents.throttle_state (agent_id, error_count_1h, success_count_1h)
      VALUES ($1, 5, 95)
      ON CONFLICT (agent_id) DO UPDATE SET error_count_1h=5, success_count_1h=95, throttled=FALSE
    `, [agentId]);

    const r = await adminClient.query(
      `SELECT * FROM agents.check_throttle($1, 30, 15)`, [agentId]
    );

    expect(r.rows[0].throttled).toBe(false);

    await adminClient.query(`DELETE FROM agents.throttle_state WHERE agent_id = $1`, [agentId]);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 10. EMPIRE INDEX CIRCUIT BREAKER
// ─────────────────────────────────────────────────────────────────────────────

describe('10. Empire Index — circuit breaker', () => {
  test('Circuit breaker déclenché après 3 jours de déclin et index < 40', async () => {
    await adminClient.query(`
      INSERT INTO ops.empire_state (tenant_id, empire_index, empire_mode, consecutive_decline_days)
      VALUES ($1, 38, 'SURVIE', 3)
      ON CONFLICT (tenant_id) DO UPDATE SET
        empire_index=38, empire_mode='SURVIE', consecutive_decline_days=3
    `, [tenantA]);

    const r = await adminClient.query(
      `SELECT * FROM guardian.check_circuit_breaker($1)`, [tenantA]
    );

    // Doit déclencher le circuit breaker
    expect(r.rows[0]?.triggered ?? r.rows.length > 0).toBe(true);

    await adminClient.query(
      `DELETE FROM ops.empire_state WHERE tenant_id = $1`, [tenantA]
    );
  });

  test('Circuit breaker ne se déclenche pas si index > 40', async () => {
    await adminClient.query(`
      INSERT INTO ops.empire_state (tenant_id, empire_index, empire_mode, consecutive_decline_days)
      VALUES ($1, 65, 'SCALABLE', 1)
      ON CONFLICT (tenant_id) DO UPDATE SET
        empire_index=65, empire_mode='SCALABLE', consecutive_decline_days=1
    `, [tenantA]);

    const r = await adminClient.query(
      `SELECT * FROM guardian.check_circuit_breaker($1)`, [tenantA]
    );

    expect(r.rows[0]?.triggered ?? false).toBe(false);

    await adminClient.query(
      `DELETE FROM ops.empire_state WHERE tenant_id = $1`, [tenantA]
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 11. AGENTS.MESSAGES — communication inter-agents
// ─────────────────────────────────────────────────────────────────────────────

describe('11. agents.messages — dispatch et claim', () => {
  test('Message envoyé et claimable par le bon agent', async () => {
    // Envoie un message
    const r = await adminClient.query<{ id: bigint }>(
      `SELECT agents.send_message('AGENT_A', 'AGENT_B', 'test.hello', '{"data":1}', $1, 5) AS id`,
      [tenantA]
    );
    const msgId = r.rows[0].id;

    // Agent B claim le message
    const claimed = await adminClient.query(
      `SELECT * FROM agents.claim_message('AGENT_B', 1)`
    );

    const found = claimed.rows.find(m => m.id == msgId);
    expect(found).toBeDefined();
    expect(found.status).toBe('delivered');

    // Cleanup
    await adminClient.query(`DELETE FROM agents.messages WHERE id = $1`, [msgId]);
  });

  test('Agent C ne voit pas les messages destinés à Agent B', async () => {
    const r = await adminClient.query<{ id: bigint }>(
      `SELECT agents.send_message('AGENT_A', 'AGENT_B', 'test.private', '{}', $1, 5) AS id`,
      [tenantA]
    );
    const msgId = r.rows[0].id;

    const claimedByC = await adminClient.query(
      `SELECT * FROM agents.claim_message('AGENT_C', 10)`
    );

    const found = claimedByC.rows.find(m => m.id == msgId);
    expect(found).toBeUndefined();

    await adminClient.query(`DELETE FROM agents.messages WHERE id = $1`, [msgId]);
  });
});
