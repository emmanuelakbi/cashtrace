/**
 * Test setup and teardown utilities for integration tests.
 *
 * Provides helpers to create isolated test database connections and
 * Redis clients. Each test suite can spin up its own connections
 * and clean up after itself.
 *
 * @module test/setup
 */

import pg from 'pg';
import { Redis } from 'ioredis';
import type { RedisOptions } from 'ioredis';

const { Pool } = pg;

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Build a test database configuration from environment variables.
 * Defaults point to a local test database to avoid touching production data.
 */
export function getTestDbConfig(): pg.PoolConfig {
  return {
    host: process.env['TEST_DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['TEST_DB_PORT'] ?? '5432', 10),
    database: process.env['TEST_DB_NAME'] ?? 'cashtrace_auth_test',
    user: process.env['TEST_DB_USER'] ?? 'postgres',
    password: process.env['TEST_DB_PASSWORD'] ?? '',
    max: 5,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 5000,
  };
}

/**
 * Build a test Redis configuration from environment variables.
 */
export function getTestRedisConfig(): RedisOptions {
  return {
    host: process.env['TEST_REDIS_HOST'] ?? 'localhost',
    port: parseInt(process.env['TEST_REDIS_PORT'] ?? '6379', 10),
    db: parseInt(process.env['TEST_REDIS_DB'] ?? '1', 10), // Use DB 1 for tests
    maxRetriesPerRequest: 1,
    lazyConnect: true,
  };
}

// ─── Test Database Helpers ───────────────────────────────────────────────────

/**
 * Create a PostgreSQL connection pool for integration tests.
 * The pool connects to the test database (not production).
 */
export function createTestPool(): pg.Pool {
  const config = getTestDbConfig();
  return new Pool(config);
}

/**
 * Truncate all application tables to reset state between tests.
 * Preserves the schema_migrations table.
 */
export async function truncateAllTables(pool: pg.Pool): Promise<void> {
  const tables = [
    'audit_logs',
    'consent_records',
    'password_reset_tokens',
    'magic_link_tokens',
    'refresh_tokens',
    'users',
  ];

  const client = await pool.connect();
  try {
    await client.query(`TRUNCATE ${tables.join(', ')} CASCADE`);
  } finally {
    client.release();
  }
}

/**
 * Close a test database pool gracefully.
 */
export async function closeTestPool(pool: pg.Pool): Promise<void> {
  await pool.end();
}

// ─── Test Redis Helpers ──────────────────────────────────────────────────────

/**
 * Create a Redis client for integration tests.
 * Uses a separate Redis database (DB 1 by default) to avoid conflicts.
 */
export function createTestRedis(): Redis {
  return new Redis(getTestRedisConfig());
}

/**
 * Flush the test Redis database to reset state between tests.
 */
export async function flushTestRedis(redis: Redis): Promise<void> {
  await redis.flushdb();
}

/**
 * Close a test Redis client gracefully.
 */
export async function closeTestRedis(redis: Redis): Promise<void> {
  await redis.quit();
}
