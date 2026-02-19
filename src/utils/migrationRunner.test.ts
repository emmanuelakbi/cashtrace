/**
 * Unit tests for the migration runner utility.
 *
 * Tests migration file discovery and ordering without
 * requiring a live database connection.
 */

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMigrationFiles } from './migrationRunner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

describe('migrationRunner', () => {
  describe('getMigrationFiles', () => {
    it('should find all SQL migration files', () => {
      const files = getMigrationFiles(MIGRATIONS_DIR);

      expect(files.length).toBe(6);
      expect(files).toContain('001_create_users.sql');
      expect(files).toContain('002_create_refresh_tokens.sql');
      expect(files).toContain('003_create_magic_link_tokens.sql');
      expect(files).toContain('004_create_password_reset_tokens.sql');
      expect(files).toContain('005_create_consent_records.sql');
      expect(files).toContain('006_create_audit_logs.sql');
    });

    it('should return files in sorted order', () => {
      const files = getMigrationFiles(MIGRATIONS_DIR);

      expect(files[0]).toBe('001_create_users.sql');
      expect(files[1]).toBe('002_create_refresh_tokens.sql');
      expect(files[2]).toBe('003_create_magic_link_tokens.sql');
      expect(files[3]).toBe('004_create_password_reset_tokens.sql');
      expect(files[4]).toBe('005_create_consent_records.sql');
      expect(files[5]).toBe('006_create_audit_logs.sql');
    });

    it('should return empty array for non-existent directory', () => {
      const files = getMigrationFiles('/non/existent/path');
      expect(files).toEqual([]);
    });
  });
});
