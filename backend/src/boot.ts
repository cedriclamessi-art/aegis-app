/**
 * AEGIS Boot — Entry point for dev & production
 * Connects to PostgreSQL + Redis, then starts the API server.
 * Gracefully handles missing services for local dev.
 */
import { Pool } from 'pg';
import { Redis } from 'ioredis';
import { createApp } from './api/server';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function boot() {
  console.log('⚡ AEGIS v7.2 — Démarrage...');

  // ── PostgreSQL ──────────────────────────────────────
  const dbUrl = process.env.DATABASE_URL || 'postgresql://aegis:aegis@localhost:5432/aegis';
  const pool = new Pool({ connectionString: dbUrl, connectionTimeoutMillis: 5000 });

  pool.on('error', (err) => {
    console.error('PostgreSQL pool error:', err.message);
  });

  let dbReady = false;
  try {
    await pool.query('SELECT 1');
    dbReady = true;
    console.log('✅ PostgreSQL connecté');

    // ── Founder admin_lifetime bootstrap ─────────────────
    try {
      await pool.query(`ALTER TABLE saas.users ADD COLUMN IF NOT EXISTS admin_lifetime BOOLEAN DEFAULT FALSE`);
      await pool.query(`UPDATE saas.users SET admin_lifetime = TRUE WHERE email = 'jonathanlamessi@yahoo.fr' AND admin_lifetime IS NOT TRUE`);
    } catch (_) { /* column may already exist */ }
  } catch (err: any) {
    console.warn('⚠️  PostgreSQL indisponible:', err.message || 'connection refused');
    console.warn('   Le serveur démarre en mode dégradé');
  }

  // ── Redis (stub if unavailable) ─────────────────────
  let redis: Redis;
  let redisReady = false;

  try {
    redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', {
      maxRetriesPerRequest: null,  // prevent MaxRetriesPerRequestError crash
      retryStrategy: () => null,   // don't retry — fail silently
      connectTimeout: 2000,
      lazyConnect: true,
      enableOfflineQueue: true,
    });

    // Suppress all error events to prevent crash
    redis.on('error', () => {});

    await redis.connect();
    await redis.ping();
    redisReady = true;
    console.log('✅ Redis connecté');
  } catch (err: any) {
    console.warn('⚠️  Redis indisponible:', err.message || 'connection refused');
    // Create a dummy Redis that won't crash the app
    redis = new Redis({
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
      lazyConnect: true,
      enableOfflineQueue: true,
    });
    redis.on('error', () => {});
  }

  // ── Express App ─────────────────────────────────────
  const { app, server } = createApp(pool, redis);

  server.listen(PORT, () => {
    console.log(`\n🚀 AEGIS API en écoute sur http://localhost:${PORT}`);
    console.log(`   DB: ${dbReady ? '✅' : '❌'}  Redis: ${redisReady ? '✅' : '❌'}`);
    console.log(`   Health: http://localhost:${PORT}/health\n`);
  });

  // ── Graceful shutdown ───────────────────────────────
  const shutdown = async () => {
    console.log('\n🛑 Arrêt en cours...');
    server.close();
    try { await pool.end(); } catch {}
    try { redis.disconnect(); } catch {}
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

boot().catch((err) => {
  console.error('❌ Erreur fatale au démarrage:', err);
  process.exit(1);
});
