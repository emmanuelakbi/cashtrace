/**
 * Database connection pool utility.
 *
 * Provides a PostgreSQL connection pool using the `pg` library,
 * configured via environment variables. This module is the single
 * entry point for all database access in the auth module.
 *
 * @module utils/db
 */

import pg from 'pg';

const { Pool } = pg;

export interface DbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max: number;
  idleTimeoutMillis: number;
  connectionTimeoutMillis: number;
  ssl?: boolean;
}

/**
 * Build database configuration from environment variables with sensible defaults.
 */
export function getDbConfig(): DbConfig {
  return {
    host: process.env['DB_HOST'] ?? 'localhost',
    port: parseInt(process.env['DB_PORT'] ?? '5432', 10),
    database: process.env['DB_NAME'] ?? 'cashtrace_auth',
    user: process.env['DB_USER'] ?? 'postgres',
    password: process.env['DB_PASSWORD'] ?? '',
    max: parseInt(process.env['DB_POOL_MAX'] ?? '20', 10),
    idleTimeoutMillis: parseInt(process.env['DB_IDLE_TIMEOUT'] ?? '30000', 10),
    connectionTimeoutMillis: parseInt(process.env['DB_CONNECT_TIMEOUT'] ?? '5000', 10),
    ssl: process.env['DB_SSL'] === 'true',
  };
}

/**
 * Create a new PostgreSQL connection pool with the given configuration.
 */
export function createPool(config?: Partial<DbConfig>): pg.Pool {
  const dbConfig = { ...getDbConfig(), ...config };
  return new Pool({
    host: dbConfig.host,
    port: dbConfig.port,
    database: dbConfig.database,
    user: dbConfig.user,
    password: dbConfig.password,
    max: dbConfig.max,
    idleTimeoutMillis: dbConfig.idleTimeoutMillis,
    connectionTimeoutMillis: dbConfig.connectionTimeoutMillis,
    ssl: dbConfig.ssl ? { rejectUnauthorized: false } : undefined,
  });
}

/** Singleton pool instance, lazily initialized. */
let pool: pg.Pool | null = null;

/**
 * Get the shared database connection pool.
 * Creates the pool on first call using environment-based configuration.
 */
export function getPool(): pg.Pool {
  if (!pool) {
    pool = createPool();
  }
  return pool;
}

/**
 * Execute a parameterized SQL query using the shared pool.
 */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  return getPool().query<T>(text, params);
}

/**
 * Gracefully shut down the connection pool.
 * Should be called during application shutdown.
 */
export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
