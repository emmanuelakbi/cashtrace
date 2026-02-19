/**
 * Unit tests for the database connection pool utility.
 *
 * These tests verify configuration parsing and pool creation
 * without requiring a live database connection.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getDbConfig, createPool, closePool } from './db.js';

describe('db utility', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('getDbConfig', () => {
    it('should return default configuration when no env vars are set', () => {
      delete process.env['DB_HOST'];
      delete process.env['DB_PORT'];
      delete process.env['DB_NAME'];
      delete process.env['DB_USER'];
      delete process.env['DB_PASSWORD'];
      delete process.env['DB_POOL_MAX'];
      delete process.env['DB_IDLE_TIMEOUT'];
      delete process.env['DB_CONNECT_TIMEOUT'];
      delete process.env['DB_SSL'];

      const config = getDbConfig();

      expect(config.host).toBe('localhost');
      expect(config.port).toBe(5432);
      expect(config.database).toBe('cashtrace_auth');
      expect(config.user).toBe('postgres');
      expect(config.password).toBe('');
      expect(config.max).toBe(20);
      expect(config.idleTimeoutMillis).toBe(30000);
      expect(config.connectionTimeoutMillis).toBe(5000);
      expect(config.ssl).toBe(false);
    });

    it('should read configuration from environment variables', () => {
      process.env['DB_HOST'] = 'db.example.com';
      process.env['DB_PORT'] = '5433';
      process.env['DB_NAME'] = 'test_db';
      process.env['DB_USER'] = 'test_user';
      process.env['DB_PASSWORD'] = 'secret123';
      process.env['DB_POOL_MAX'] = '10';
      process.env['DB_IDLE_TIMEOUT'] = '60000';
      process.env['DB_CONNECT_TIMEOUT'] = '10000';
      process.env['DB_SSL'] = 'true';

      const config = getDbConfig();

      expect(config.host).toBe('db.example.com');
      expect(config.port).toBe(5433);
      expect(config.database).toBe('test_db');
      expect(config.user).toBe('test_user');
      expect(config.password).toBe('secret123');
      expect(config.max).toBe(10);
      expect(config.idleTimeoutMillis).toBe(60000);
      expect(config.connectionTimeoutMillis).toBe(10000);
      expect(config.ssl).toBe(true);
    });

    it('should handle partial environment variable configuration', () => {
      process.env['DB_HOST'] = 'custom-host';
      delete process.env['DB_PORT'];
      process.env['DB_NAME'] = 'custom_db';

      const config = getDbConfig();

      expect(config.host).toBe('custom-host');
      expect(config.port).toBe(5432);
      expect(config.database).toBe('custom_db');
    });
  });

  describe('createPool', () => {
    it('should create a pool with default config', () => {
      const pool = createPool();
      expect(pool).toBeDefined();
      // Clean up
      void pool.end();
    });

    it('should create a pool with custom config overrides', () => {
      const pool = createPool({
        host: 'custom-host',
        port: 5433,
        database: 'custom_db',
        max: 5,
      });
      expect(pool).toBeDefined();
      // Clean up
      void pool.end();
    });
  });
});
