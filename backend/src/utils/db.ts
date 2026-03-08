import { Pool } from 'pg';
import logger from './logger';

if (!process.env.DATABASE_URL) {
  throw new Error('FATAL: DATABASE_URL env var is required');
}

export const db = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 20,
  min: 3,                           // Pre-warm 3 connections for cold start
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  statement_timeout: 30000,         // Kill queries running > 30s
});

db.on('error', (err) => {
  logger.error({ err }, 'Unexpected DB pool error');
});

db.on('connect', () => {
  logger.debug('DB pool: new connection established');
});

export async function withTransaction<T>(
  fn: (client: import('pg').PoolClient) => Promise<T>
): Promise<T> {
  const client = await db.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}

/** Verify DB connectivity at startup */
export async function checkDbConnection(): Promise<boolean> {
  try {
    await db.query('SELECT 1');
    logger.info('DB connection verified');
    return true;
  } catch (err) {
    logger.error({ err }, 'DB connection check failed');
    return false;
  }
}
