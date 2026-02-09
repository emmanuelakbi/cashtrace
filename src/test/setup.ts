/**
 * Test setup utilities for integration tests.
 *
 * Integration tests require:
 * - PostgreSQL: TEST_DB_HOST, TEST_DB_PORT, TEST_DB_NAME, TEST_DB_USER, TEST_DB_PASSWORD
 * - Redis: TEST_REDIS_HOST, TEST_REDIS_PORT
 *
 * Unit and property-based tests run without external dependencies.
 */

export interface TestDbConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function getTestDbConfig(): TestDbConfig {
  return {
    host: process.env["TEST_DB_HOST"] ?? "localhost",
    port: parseInt(process.env["TEST_DB_PORT"] ?? "5432", 10),
    database: process.env["TEST_DB_NAME"] ?? "cashtrace_auth_test",
    user: process.env["TEST_DB_USER"] ?? "postgres",
    password: process.env["TEST_DB_PASSWORD"] ?? "postgres",
  };
}

export interface TestRedisConfig {
  host: string;
  port: number;
}

export function getTestRedisConfig(): TestRedisConfig {
  return {
    host: process.env["TEST_REDIS_HOST"] ?? "localhost",
    port: parseInt(process.env["TEST_REDIS_PORT"] ?? "6379", 10),
  };
}
