#!/usr/bin/env tsx
// ============================================================
// AEGIS — Seed (bootstrap complet)
// ⚠️  Jamais de password en dur — reset link 24h uniquement
// Usage : make seed
// ============================================================
import { randomBytes, createHash } from 'crypto';
import { Client } from 'pg';

const db = new Client({ connectionString: process.env.DATABASE_URL });
const ADMIN_EMAIL = process.env.ADMIN_EMAIL ?? 'jonathanlamessi@yahoo.fr';
const APP_URL     = process.env.APP_URL ?? 'http://localhost:3000';

async function seed() {
  await db.connect();
  console.log('\n🚀 AEGIS Bootstrap\n');
  try {
    await db.query('BEGIN');

    // 1. Whitelist check
    const wl = await db.query('SELECT email FROM saas.admin_whitelist WHERE email=$1', [ADMIN_EMAIL]);
    if (!wl.rows.length) throw new Error(`Email non whitelisté: ${ADMIN_EMAIL}`);

    // 2. Tenant admin (scale, gratuit à vie)
    const t = await db.query(
      `INSERT INTO saas.tenants (name,slug,agent_mode,autopilot_mode,plan_id,plan_status,admin_lifetime,stage)
       VALUES ('AEGIS Admin','aegis-admin','full_organism','full_auto','scale','active',TRUE,'scale_10m')
       ON CONFLICT (slug) DO UPDATE SET agent_mode='full_organism',autopilot_mode='full_auto',
         plan_id='scale',plan_status='active',admin_lifetime=TRUE,updated_at=NOW()
       RETURNING id`, []
    );
    const tenantId = t.rows[0].id;

    // 3. User admin (sans password — obligatoirement via reset link)
    const u = await db.query(
      `INSERT INTO saas.users (tenant_id,email,role,admin_lifetime,is_active)
       VALUES ($1,$2,'super_admin',TRUE,TRUE)
       ON CONFLICT (email) DO UPDATE SET role='super_admin',admin_lifetime=TRUE,updated_at=NOW()
       RETURNING id`, [tenantId, ADMIN_EMAIL]
    );
    const userId = u.rows[0].id;

    // 4. Entitlement admin_lifetime permanent
    await db.query(
      `INSERT INTO saas.entitlements (tenant_id,user_id,entitlement,granted_by,expires_at)
       VALUES ($1,$2,'admin_lifetime','bootstrap',NULL) ON CONFLICT DO NOTHING`,
      [tenantId, userId]
    );

    // 5. Subscription scale active
    await db.query(
      `INSERT INTO saas.subscriptions (tenant_id,plan_id,status) VALUES ($1,'scale','active') ON CONFLICT DO NOTHING`,
      [tenantId]
    );

    // 6. Invalider anciens reset tokens + créer nouveau (24h)
    await db.query(`UPDATE saas.auth_tokens SET used_at=NOW() WHERE user_id=$1 AND type='reset' AND used_at IS NULL`, [userId]);
    const raw   = randomBytes(32).toString('hex');
    const hash  = createHash('sha256').update(raw).digest('hex');
    const exp   = new Date(Date.now() + 86_400_000);
    await db.query(`INSERT INTO saas.auth_tokens (user_id,type,token_hash,expires_at) VALUES ($1,'reset',$2,$3)`, [userId, hash, exp]);

    // 7. Audit log
    await db.query(
      `INSERT INTO ops.audit_log (tenant_id,user_id,action,resource_type,resource_id,new_value)
       VALUES ($1,$2,'bootstrap.seed','tenant',$1,$3::jsonb)`,
      [tenantId, userId, JSON.stringify({ plan:'scale', admin_lifetime:true, bootstrapped_at: new Date() })]
    );

    await db.query('COMMIT');

    const url = `${APP_URL}/reset-password?token=${raw}`;
    console.log('═'.repeat(60));
    console.log('🔐  LIEN ADMIN (valide 24h — ne pas partager)');
    console.log('═'.repeat(60));
    console.log(`\n  ${url}\n`);
    console.log('  → Définissez votre mot de passe via ce lien');
    console.log('  → MFA disponible dans les paramètres après connexion');
    console.log('\n═'.repeat(60));
    console.log('\n✅ Bootstrap terminé. AEGIS opérationnel.\n');

  } catch (e) {
    await db.query('ROLLBACK');
    console.error('❌', e);
    process.exit(1);
  } finally {
    await db.end();
  }
}
seed();
