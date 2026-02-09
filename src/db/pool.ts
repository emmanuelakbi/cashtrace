import pg from "pg";

const { Pool } = pg;

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
  max?: number;
  idleTimeoutMillis?: number;
  connectionTimeoutMillis?: number;
}

const defaultConfig: DatabaseConfig = {
  host: process.env["DB_HOST"] ?? "localhost",
  port: parseInt(process.env["DB_PORT"] ?? "5432", 10),
  database: process.env["DB_NAME"] ?? "cashtrace_auth",
  user: process.env["DB_USER"] ?? "postgres",
  password: process.env["DB_PASSWORD"] ?? "postgres",
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
};

let pool: pg.Pool | null = null;

export function getPool(config?: Partial<DatabaseConfig>): pg.Pool {
  if (!pool) {
    pool = new Pool({ ...defaultConfig, ...config });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
