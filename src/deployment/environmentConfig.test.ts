import { describe, expect, it } from 'vitest';

import {
  checkEnvironmentIsolation,
  ENVIRONMENT_TIERS,
  getRequiredVariables,
  REQUIRED_VARIABLES,
  TIER_URLS,
  validateEnvironmentConfig,
  validateEnvironmentTier,
  validateEnvironmentVariables,
} from './environmentConfig.js';
import { makeEnvironment, makeEnvironmentVariable } from './testHelpers.js';

// ─── validateEnvironmentTier ─────────────────────────────────────────────────

describe('validateEnvironmentTier', () => {
  it('should accept "development"', () => {
    expect(validateEnvironmentTier('development')).toBe(true);
  });

  it('should accept "staging"', () => {
    expect(validateEnvironmentTier('staging')).toBe(true);
  });

  it('should accept "production"', () => {
    expect(validateEnvironmentTier('production')).toBe(true);
  });

  it('should reject an unknown tier', () => {
    expect(validateEnvironmentTier('testing')).toBe(false);
  });

  it('should reject an empty string', () => {
    expect(validateEnvironmentTier('')).toBe(false);
  });

  it('should be case-sensitive', () => {
    expect(validateEnvironmentTier('Production')).toBe(false);
  });
});

// ─── getRequiredVariables ────────────────────────────────────────────────────

describe('getRequiredVariables', () => {
  it('should return base variables for development', () => {
    const vars = getRequiredVariables('development');
    expect(vars).toEqual(['NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'API_BASE_URL']);
  });

  it('should include JWT_SECRET and ENCRYPTION_KEY for staging', () => {
    const vars = getRequiredVariables('staging');
    expect(vars).toContain('JWT_SECRET');
    expect(vars).toContain('ENCRYPTION_KEY');
    expect(vars).toContain('NODE_ENV');
  });

  it('should include SENTRY_DSN and PAGERDUTY_KEY for production', () => {
    const vars = getRequiredVariables('production');
    expect(vars).toContain('SENTRY_DSN');
    expect(vars).toContain('PAGERDUTY_KEY');
    expect(vars).toContain('JWT_SECRET');
    expect(vars).toContain('ENCRYPTION_KEY');
  });

  it('should not include production-only vars in development', () => {
    const vars = getRequiredVariables('development');
    expect(vars).not.toContain('SENTRY_DSN');
    expect(vars).not.toContain('PAGERDUTY_KEY');
    expect(vars).not.toContain('JWT_SECRET');
  });
});

// ─── validateEnvironmentVariables ────────────────────────────────────────────

describe('validateEnvironmentVariables', () => {
  it('should pass when all required variables are present', () => {
    const env = makeEnvironment({
      name: 'development',
      url: 'http://localhost:3000',
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'development' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://localhost/dev' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://localhost:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'http://localhost:3000' }),
      ],
    });
    const result = validateEnvironmentVariables(env);
    expect(result.valid).toBe(true);
    expect(result.missing).toEqual([]);
    expect(result.errors).toEqual([]);
  });

  it('should report missing variables', () => {
    const env = makeEnvironment({
      name: 'development',
      url: 'http://localhost:3000',
      variables: [makeEnvironmentVariable({ name: 'NODE_ENV', value: 'development' })],
    });
    const result = validateEnvironmentVariables(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('DATABASE_URL');
    expect(result.missing).toContain('REDIS_URL');
    expect(result.missing).toContain('API_BASE_URL');
  });

  it('should report empty variable values', () => {
    const env = makeEnvironment({
      name: 'development',
      url: 'http://localhost:3000',
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'development' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: '' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://localhost:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'http://localhost:3000' }),
      ],
    });
    const result = validateEnvironmentVariables(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('DATABASE_URL'))).toBe(true);
    expect(result.errors.some((e) => e.includes('empty value'))).toBe(true);
  });

  it('should reject an invalid tier name', () => {
    const env = makeEnvironment({ name: 'testing' });
    const result = validateEnvironmentVariables(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid environment tier'))).toBe(true);
  });

  it('should require extra variables for staging', () => {
    const env = makeEnvironment({
      name: 'staging',
      url: 'https://staging.cashtrace.ng',
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'staging' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://staging/db' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://staging:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'https://staging.cashtrace.ng' }),
      ],
    });
    const result = validateEnvironmentVariables(env);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('JWT_SECRET');
    expect(result.missing).toContain('ENCRYPTION_KEY');
  });
});

// ─── validateEnvironmentConfig ───────────────────────────────────────────────

describe('validateEnvironmentConfig', () => {
  it('should accept a valid development config', () => {
    const env = makeEnvironment({
      name: 'development',
      url: 'http://localhost:3000',
      requiresApproval: false,
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'development' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://localhost/dev' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://localhost:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'http://localhost:3000' }),
      ],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept a valid staging config', () => {
    const env = makeEnvironment({
      name: 'staging',
      url: 'https://staging.cashtrace.ng',
      requiresApproval: false,
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'staging' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://staging/db' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://staging:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'https://staging.cashtrace.ng' }),
        makeEnvironmentVariable({ name: 'JWT_SECRET', value: 'staging-secret' }),
        makeEnvironmentVariable({ name: 'ENCRYPTION_KEY', value: 'staging-key' }),
      ],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept a valid production config', () => {
    const env = makeEnvironment({
      name: 'production',
      url: 'https://cashtrace.ng',
      requiresApproval: true,
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'production' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://prod/db' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://prod:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'https://cashtrace.ng' }),
        makeEnvironmentVariable({ name: 'JWT_SECRET', value: 'prod-secret' }),
        makeEnvironmentVariable({ name: 'ENCRYPTION_KEY', value: 'prod-key' }),
        makeEnvironmentVariable({ name: 'SENTRY_DSN', value: 'https://sentry.io/123' }),
        makeEnvironmentVariable({ name: 'PAGERDUTY_KEY', value: 'pd-key-123' }),
      ],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept production URL with www prefix', () => {
    const env = makeEnvironment({
      name: 'production',
      url: 'https://www.cashtrace.ng',
      requiresApproval: true,
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'production' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://prod/db' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://prod:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'https://cashtrace.ng' }),
        makeEnvironmentVariable({ name: 'JWT_SECRET', value: 'prod-secret' }),
        makeEnvironmentVariable({ name: 'ENCRYPTION_KEY', value: 'prod-key' }),
        makeEnvironmentVariable({ name: 'SENTRY_DSN', value: 'https://sentry.io/123' }),
        makeEnvironmentVariable({ name: 'PAGERDUTY_KEY', value: 'pd-key-123' }),
      ],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(true);
  });

  it('should reject an invalid tier', () => {
    const env = makeEnvironment({ name: 'qa' });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid environment tier'))).toBe(true);
  });

  it('should reject a URL that does not match the tier pattern', () => {
    const env = makeEnvironment({
      name: 'development',
      url: 'https://staging.cashtrace.ng',
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'development' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://localhost/dev' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://localhost:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'http://localhost:3000' }),
      ],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not match'))).toBe(true);
  });

  it('should reject production without requiresApproval', () => {
    const env = makeEnvironment({
      name: 'production',
      url: 'https://cashtrace.ng',
      requiresApproval: false,
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'production' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://prod/db' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://prod:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'https://cashtrace.ng' }),
        makeEnvironmentVariable({ name: 'JWT_SECRET', value: 'prod-secret' }),
        makeEnvironmentVariable({ name: 'ENCRYPTION_KEY', value: 'prod-key' }),
        makeEnvironmentVariable({ name: 'SENTRY_DSN', value: 'https://sentry.io/123' }),
        makeEnvironmentVariable({ name: 'PAGERDUTY_KEY', value: 'pd-key-123' }),
      ],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('require approval'))).toBe(true);
  });

  it('should accept development with 127.0.0.1 URL', () => {
    const env = makeEnvironment({
      name: 'development',
      url: 'http://127.0.0.1:3000',
      requiresApproval: false,
      variables: [
        makeEnvironmentVariable({ name: 'NODE_ENV', value: 'development' }),
        makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://localhost/dev' }),
        makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://localhost:6379' }),
        makeEnvironmentVariable({ name: 'API_BASE_URL', value: 'http://127.0.0.1:3000' }),
      ],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(true);
  });

  it('should aggregate multiple errors', () => {
    const env = makeEnvironment({
      name: 'production',
      url: 'http://localhost:3000',
      requiresApproval: false,
      variables: [],
    });
    const result = validateEnvironmentConfig(env);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── checkEnvironmentIsolation ───────────────────────────────────────────────

describe('checkEnvironmentIsolation', () => {
  it('should pass when environments are fully isolated', () => {
    const envs = [
      makeEnvironment({
        name: 'development',
        url: 'http://localhost:3000',
        variables: [
          makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://localhost/dev' }),
          makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://localhost:6379/0' }),
        ],
      }),
      makeEnvironment({
        name: 'staging',
        url: 'https://staging.cashtrace.ng',
        variables: [
          makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://staging/db' }),
          makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://staging:6379/0' }),
        ],
      }),
      makeEnvironment({
        name: 'production',
        url: 'https://cashtrace.ng',
        variables: [
          makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://prod/db' }),
          makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://prod:6379/0' }),
        ],
      }),
    ];
    const result = checkEnvironmentIsolation(envs);
    expect(result.isolated).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('should detect shared DATABASE_URL', () => {
    const sharedDb = 'postgres://shared/db';
    const envs = [
      makeEnvironment({
        name: 'development',
        url: 'http://localhost:3000',
        variables: [makeEnvironmentVariable({ name: 'DATABASE_URL', value: sharedDb })],
      }),
      makeEnvironment({
        name: 'staging',
        url: 'https://staging.cashtrace.ng',
        variables: [makeEnvironmentVariable({ name: 'DATABASE_URL', value: sharedDb })],
      }),
    ];
    const result = checkEnvironmentIsolation(envs);
    expect(result.isolated).toBe(false);
    expect(result.violations.some((v) => v.includes('DATABASE_URL'))).toBe(true);
  });

  it('should detect shared REDIS_URL', () => {
    const sharedRedis = 'redis://shared:6379';
    const envs = [
      makeEnvironment({
        name: 'staging',
        url: 'https://staging.cashtrace.ng',
        variables: [
          makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://staging/db' }),
          makeEnvironmentVariable({ name: 'REDIS_URL', value: sharedRedis }),
        ],
      }),
      makeEnvironment({
        name: 'production',
        url: 'https://cashtrace.ng',
        variables: [
          makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://prod/db' }),
          makeEnvironmentVariable({ name: 'REDIS_URL', value: sharedRedis }),
        ],
      }),
    ];
    const result = checkEnvironmentIsolation(envs);
    expect(result.isolated).toBe(false);
    expect(result.violations.some((v) => v.includes('REDIS_URL'))).toBe(true);
  });

  it('should detect shared URL', () => {
    const envs = [
      makeEnvironment({
        name: 'staging',
        url: 'https://staging.cashtrace.ng',
        variables: [makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://a/db' })],
      }),
      makeEnvironment({
        name: 'production',
        url: 'https://staging.cashtrace.ng',
        variables: [makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://b/db' })],
      }),
    ];
    const result = checkEnvironmentIsolation(envs);
    expect(result.isolated).toBe(false);
    expect(result.violations.some((v) => v.includes('same URL'))).toBe(true);
  });

  it('should report multiple violations', () => {
    const envs = [
      makeEnvironment({
        name: 'development',
        url: 'http://localhost:3000',
        variables: [
          makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://shared/db' }),
          makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://shared:6379' }),
        ],
      }),
      makeEnvironment({
        name: 'staging',
        url: 'http://localhost:3000',
        variables: [
          makeEnvironmentVariable({ name: 'DATABASE_URL', value: 'postgres://shared/db' }),
          makeEnvironmentVariable({ name: 'REDIS_URL', value: 'redis://shared:6379' }),
        ],
      }),
    ];
    const result = checkEnvironmentIsolation(envs);
    expect(result.isolated).toBe(false);
    expect(result.violations.length).toBe(3);
  });

  it('should pass with a single environment', () => {
    const result = checkEnvironmentIsolation([makeEnvironment()]);
    expect(result.isolated).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it('should pass with an empty list', () => {
    const result = checkEnvironmentIsolation([]);
    expect(result.isolated).toBe(true);
    expect(result.violations).toEqual([]);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('environment config constants', () => {
  it('should have three tiers', () => {
    expect(ENVIRONMENT_TIERS).toEqual(['development', 'staging', 'production']);
  });

  it('should have required variables for all tiers', () => {
    for (const tier of ENVIRONMENT_TIERS) {
      expect(REQUIRED_VARIABLES[tier].length).toBeGreaterThan(0);
    }
  });

  it('should have URL patterns for all tiers', () => {
    for (const tier of ENVIRONMENT_TIERS) {
      expect(TIER_URLS[tier]).toBeInstanceOf(RegExp);
    }
  });

  it('should match localhost URLs for development', () => {
    expect(TIER_URLS.development.test('http://localhost:3000')).toBe(true);
    expect(TIER_URLS.development.test('https://localhost:8080')).toBe(true);
    expect(TIER_URLS.development.test('http://127.0.0.1:3000')).toBe(true);
  });

  it('should match staging URLs', () => {
    expect(TIER_URLS.staging.test('https://staging.cashtrace.ng')).toBe(true);
    expect(TIER_URLS.staging.test('http://staging.cashtrace.ng')).toBe(false);
  });

  it('should match production URLs', () => {
    expect(TIER_URLS.production.test('https://cashtrace.ng')).toBe(true);
    expect(TIER_URLS.production.test('https://www.cashtrace.ng')).toBe(true);
    expect(TIER_URLS.production.test('http://cashtrace.ng')).toBe(false);
  });
});
