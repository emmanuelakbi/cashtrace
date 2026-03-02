import { describe, expect, it } from 'vitest';

import {
  checkRotationStatus,
  checkSecretIsolation,
  DEFAULT_ROTATION_DAYS,
  isSecretAccessAuthorized,
  MAX_SECRET_SIZE_BYTES,
  SECRET_ENVIRONMENTS,
  SECRET_NAME_PATTERN,
  validateSecretConfig,
  validateSecretName,
} from './secretManagement.js';
import type { SecretConfig } from './secretManagement.js';
import { makeSecretAccessLog, makeSecretMetadata } from './testHelpers.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeSecretConfig(overrides: Partial<SecretConfig> = {}): SecretConfig {
  return {
    name: 'database-url',
    environment: 'production',
    rotationDays: DEFAULT_ROTATION_DAYS,
    autoRotate: true,
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('should have expected default values', () => {
    expect(SECRET_NAME_PATTERN).toBeInstanceOf(RegExp);
    expect(MAX_SECRET_SIZE_BYTES).toBe(65536);
    expect(DEFAULT_ROTATION_DAYS).toBe(90);
    expect(SECRET_ENVIRONMENTS).toEqual(['development', 'staging', 'production']);
  });
});

// ─── validateSecretName ──────────────────────────────────────────────────────

describe('validateSecretName', () => {
  it('should accept a valid simple name', () => {
    expect(validateSecretName('database-url')).toBe(true);
  });

  it('should accept a name with slashes', () => {
    expect(validateSecretName('prod/database/url')).toBe(true);
  });

  it('should accept a name with underscores', () => {
    expect(validateSecretName('api_secret_key')).toBe(true);
  });

  it('should accept a name at minimum length (3 chars)', () => {
    expect(validateSecretName('abc')).toBe(true);
  });

  it('should accept a name at maximum length (128 chars)', () => {
    const name = 'a' + 'b'.repeat(127);
    expect(validateSecretName(name)).toBe(true);
  });

  it('should reject a name starting with a digit', () => {
    expect(validateSecretName('1secret')).toBe(false);
  });

  it('should reject a name starting with a hyphen', () => {
    expect(validateSecretName('-secret')).toBe(false);
  });

  it('should reject a name that is too short (2 chars)', () => {
    expect(validateSecretName('ab')).toBe(false);
  });

  it('should reject a name that is too long (129 chars)', () => {
    const name = 'a' + 'b'.repeat(128);
    expect(validateSecretName(name)).toBe(false);
  });

  it('should reject an empty string', () => {
    expect(validateSecretName('')).toBe(false);
  });

  it('should reject a name with spaces', () => {
    expect(validateSecretName('my secret')).toBe(false);
  });

  it('should reject a name with special characters', () => {
    expect(validateSecretName('secret@key!')).toBe(false);
  });
});

// ─── validateSecretConfig ────────────────────────────────────────────────────

describe('validateSecretConfig', () => {
  it('should accept a valid config', () => {
    const result = validateSecretConfig(makeSecretConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject an invalid name', () => {
    const result = validateSecretConfig(makeSecretConfig({ name: '1bad' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('name'));
  });

  it('should reject an empty name', () => {
    const result = validateSecretConfig(makeSecretConfig({ name: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('name'));
  });

  it('should reject an invalid environment', () => {
    const result = validateSecretConfig(makeSecretConfig({ environment: 'test' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('environment'));
  });

  it('should accept all valid environments', () => {
    for (const env of SECRET_ENVIRONMENTS) {
      const result = validateSecretConfig(makeSecretConfig({ environment: env }));
      expect(result.valid).toBe(true);
    }
  });

  it('should reject rotationDays <= 0', () => {
    const result = validateSecretConfig(makeSecretConfig({ rotationDays: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('rotationDays'));
  });

  it('should reject negative rotationDays', () => {
    const result = validateSecretConfig(makeSecretConfig({ rotationDays: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('rotationDays'));
  });

  it('should reject rotationDays > 365', () => {
    const result = validateSecretConfig(makeSecretConfig({ rotationDays: 366 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('rotationDays'));
  });

  it('should accept rotationDays at boundaries 1 and 365', () => {
    expect(validateSecretConfig(makeSecretConfig({ rotationDays: 1 })).valid).toBe(true);
    expect(validateSecretConfig(makeSecretConfig({ rotationDays: 365 })).valid).toBe(true);
  });

  it('should collect multiple errors', () => {
    const result = validateSecretConfig(
      makeSecretConfig({ name: '', environment: 'invalid', rotationDays: 0 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── checkSecretIsolation ────────────────────────────────────────────────────

describe('checkSecretIsolation', () => {
  it('should return isolated when all secrets are unique per environment', () => {
    const result = checkSecretIsolation([
      { name: 'db-url', environment: 'production' },
      { name: 'api-key', environment: 'staging' },
    ]);
    expect(result.isolated).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should return isolated for an empty array', () => {
    const result = checkSecretIsolation([]);
    expect(result.isolated).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should detect a secret shared across environments', () => {
    const result = checkSecretIsolation([
      { name: 'db-url', environment: 'production' },
      { name: 'db-url', environment: 'staging' },
    ]);
    expect(result.isolated).toBe(false);
    expect(result.violations).toHaveLength(1);
    expect(result.violations[0]).toContain('db-url');
  });

  it('should detect multiple shared secrets', () => {
    const result = checkSecretIsolation([
      { name: 'db-url', environment: 'production' },
      { name: 'db-url', environment: 'staging' },
      { name: 'api-key', environment: 'production' },
      { name: 'api-key', environment: 'development' },
    ]);
    expect(result.isolated).toBe(false);
    expect(result.violations).toHaveLength(2);
  });

  it('should allow the same secret name in the same environment', () => {
    const result = checkSecretIsolation([
      { name: 'db-url', environment: 'production' },
      { name: 'db-url', environment: 'production' },
    ]);
    expect(result.isolated).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it('should list the environments in the violation message', () => {
    const result = checkSecretIsolation([
      { name: 'db-url', environment: 'production' },
      { name: 'db-url', environment: 'development' },
      { name: 'db-url', environment: 'staging' },
    ]);
    expect(result.isolated).toBe(false);
    expect(result.violations[0]).toContain('development');
    expect(result.violations[0]).toContain('production');
    expect(result.violations[0]).toContain('staging');
  });
});

// ─── checkRotationStatus ─────────────────────────────────────────────────────

describe('checkRotationStatus', () => {
  it('should not need rotation when recently rotated', () => {
    const metadata = makeSecretMetadata({ rotatedAt: new Date() });
    const result = checkRotationStatus(metadata, DEFAULT_ROTATION_DAYS);
    expect(result.needsRotation).toBe(false);
    expect(result.daysSinceRotation).toBe(0);
    expect(result.rotationDays).toBe(DEFAULT_ROTATION_DAYS);
  });

  it('should need rotation when rotationDays have elapsed', () => {
    const rotatedAt = new Date();
    rotatedAt.setDate(rotatedAt.getDate() - 91);
    const metadata = makeSecretMetadata({ rotatedAt });
    const result = checkRotationStatus(metadata, DEFAULT_ROTATION_DAYS);
    expect(result.needsRotation).toBe(true);
    expect(result.daysSinceRotation).toBeGreaterThanOrEqual(90);
  });

  it('should need rotation when exactly at the rotation boundary', () => {
    const rotatedAt = new Date();
    rotatedAt.setDate(rotatedAt.getDate() - DEFAULT_ROTATION_DAYS);
    const metadata = makeSecretMetadata({ rotatedAt });
    const result = checkRotationStatus(metadata, DEFAULT_ROTATION_DAYS);
    expect(result.needsRotation).toBe(true);
    expect(result.daysSinceRotation).toBeGreaterThanOrEqual(DEFAULT_ROTATION_DAYS);
  });

  it('should not need rotation one day before the boundary', () => {
    const rotatedAt = new Date();
    rotatedAt.setDate(rotatedAt.getDate() - (DEFAULT_ROTATION_DAYS - 1));
    const metadata = makeSecretMetadata({ rotatedAt });
    const result = checkRotationStatus(metadata, DEFAULT_ROTATION_DAYS);
    expect(result.needsRotation).toBe(false);
  });

  it('should respect a custom rotationDays value', () => {
    const rotatedAt = new Date();
    rotatedAt.setDate(rotatedAt.getDate() - 31);
    const metadata = makeSecretMetadata({ rotatedAt });
    const result = checkRotationStatus(metadata, 30);
    expect(result.needsRotation).toBe(true);
    expect(result.rotationDays).toBe(30);
  });

  it('should return the correct rotationDays in the result', () => {
    const metadata = makeSecretMetadata({ rotatedAt: new Date() });
    const result = checkRotationStatus(metadata, 180);
    expect(result.rotationDays).toBe(180);
  });
});

// ─── isSecretAccessAuthorized ────────────────────────────────────────────────

describe('isSecretAccessAuthorized', () => {
  const allowedPrincipals = [
    'arn:aws:iam::123456789012:role/cashtrace-api',
    'arn:aws:iam::123456789012:role/cashtrace-worker',
  ];

  it('should return true for an allowed principal with successful access', () => {
    const log = makeSecretAccessLog({
      principal: 'arn:aws:iam::123456789012:role/cashtrace-api',
      success: true,
    });
    expect(isSecretAccessAuthorized(log, allowedPrincipals)).toBe(true);
  });

  it('should return false for a disallowed principal', () => {
    const log = makeSecretAccessLog({
      principal: 'arn:aws:iam::999999999999:role/unknown',
      success: true,
    });
    expect(isSecretAccessAuthorized(log, allowedPrincipals)).toBe(false);
  });

  it('should return false when access was unsuccessful', () => {
    const log = makeSecretAccessLog({
      principal: 'arn:aws:iam::123456789012:role/cashtrace-api',
      success: false,
    });
    expect(isSecretAccessAuthorized(log, allowedPrincipals)).toBe(false);
  });

  it('should return false for a disallowed principal with unsuccessful access', () => {
    const log = makeSecretAccessLog({
      principal: 'arn:aws:iam::999999999999:role/unknown',
      success: false,
    });
    expect(isSecretAccessAuthorized(log, allowedPrincipals)).toBe(false);
  });

  it('should return false when allowedPrincipals is empty', () => {
    const log = makeSecretAccessLog({ success: true });
    expect(isSecretAccessAuthorized(log, [])).toBe(false);
  });

  it('should return true for the second allowed principal', () => {
    const log = makeSecretAccessLog({
      principal: 'arn:aws:iam::123456789012:role/cashtrace-worker',
      success: true,
    });
    expect(isSecretAccessAuthorized(log, allowedPrincipals)).toBe(true);
  });
});
