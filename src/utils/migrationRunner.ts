/**
 * Simple migration runner for numbered SQL migration files.
 *
 * Reads SQL files from the migrations directory in order and
 * executes them against the database. Uses a `schema_migrations`
 * table to track which migrations have already been applied.
 *
 * @module utils/migrationRunner
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { getPool } from './db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Default migrations directory relative to this file. */
const DEFAULT_MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

/**
 * Ensure the schema_migrations tracking table exists.
 */
async function ensureMigrationsTable(client: pg.PoolClient): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      filename VARCHAR(255) UNIQUE NOT NULL,
      applied_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    );
  `);
}

/**
 * Get the list of already-applied migration filenames.
 */
async function getAppliedMigrations(client: pg.PoolClient): Promise<Set<string>> {
  const result = await client.query<{ filename: string }>(
    'SELECT filename FROM schema_migrations ORDER BY filename',
  );
  return new Set(result.rows.map((row) => row.filename));
}

/**
 * Read and sort migration files from the given directory.
 * Only `.sql` files are considered, sorted lexicographically by name.
 */
export function getMigrationFiles(migrationsDir: string = DEFAULT_MIGRATIONS_DIR): string[] {
  if (!fs.existsSync(migrationsDir)) {
    return [];
  }
  return fs
    .readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();
}

/**
 * Run all pending migrations in order.
 *
 * Each migration is executed inside a transaction. If a migration
 * fails, its transaction is rolled back and the runner stops.
 *
 * @returns Array of filenames that were applied in this run.
 */
export async function runMigrations(
  migrationsDir: string = DEFAULT_MIGRATIONS_DIR,
  poolOverride?: pg.Pool,
): Promise<string[]> {
  const pool = poolOverride ?? getPool();
  const client = await pool.connect();
  const applied: string[] = [];

  try {
    await ensureMigrationsTable(client);
    const alreadyApplied = await getAppliedMigrations(client);
    const files = getMigrationFiles(migrationsDir);

    for (const file of files) {
      if (alreadyApplied.has(file)) {
        continue;
      }

      const filePath = path.join(migrationsDir, file);
      const sql = fs.readFileSync(filePath, 'utf-8');

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (filename) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(
          `Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } finally {
    client.release();
  }

  return applied;
}
