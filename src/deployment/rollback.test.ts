import { describe, expect, it } from 'vitest';

import {
  checkRollbackEligibility,
  checkRollbackTimeLimit,
  MAX_ROLLBACK_SECONDS,
  ROLLBACK_ENVIRONMENTS,
  validateRollbackRequest,
} from './rollback.js';
import { makeDeployment, makeRollbackRequest } from './testHelpers.js';

// ─── validateRollbackRequest ─────────────────────────────────────────────────

describe('validateRollbackRequest', () => {
  it('should return valid for a well-formed request', () => {
    const result = validateRollbackRequest(makeRollbackRequest());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should accept staging environment', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ environment: 'staging' }));
    expect(result.valid).toBe(true);
  });

  it('should reject invalid environment', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ environment: 'development' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid environment'))).toBe(true);
  });

  it('should reject empty environment', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ environment: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid environment'))).toBe(true);
  });

  it('should reject empty initiatedBy', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ initiatedBy: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('initiatedBy'))).toBe(true);
  });

  it('should reject whitespace-only initiatedBy', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ initiatedBy: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('initiatedBy'))).toBe(true);
  });

  it('should reject empty targetVersion when provided', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ targetVersion: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('targetVersion'))).toBe(true);
  });

  it('should accept valid targetVersion', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ targetVersion: '42' }));
    expect(result.valid).toBe(true);
  });

  it('should accept request without targetVersion', () => {
    const req = makeRollbackRequest();
    delete req.targetVersion;
    const result = validateRollbackRequest(req);
    expect(result.valid).toBe(true);
  });

  it('should reject non-positive timeoutSeconds', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ timeoutSeconds: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('timeoutSeconds must be positive'))).toBe(true);
  });

  it('should reject negative timeoutSeconds', () => {
    const result = validateRollbackRequest(makeRollbackRequest({ timeoutSeconds: -10 }));
    expect(result.valid).toBe(false);
  });

  it('should reject timeoutSeconds exceeding maximum', () => {
    const result = validateRollbackRequest(
      makeRollbackRequest({ timeoutSeconds: MAX_ROLLBACK_SECONDS + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('exceeds maximum'))).toBe(true);
  });

  it('should accept timeoutSeconds at exactly the maximum', () => {
    const result = validateRollbackRequest(
      makeRollbackRequest({ timeoutSeconds: MAX_ROLLBACK_SECONDS }),
    );
    expect(result.valid).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const result = validateRollbackRequest(
      makeRollbackRequest({ environment: 'bad', initiatedBy: '', timeoutSeconds: -1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── checkRollbackTimeLimit ──────────────────────────────────────────────────

describe('checkRollbackTimeLimit', () => {
  it('should report within limit when completed in under 5 minutes', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-01T00:04:00Z'); // 4 minutes
    const result = checkRollbackTimeLimit(start, end);
    expect(result.withinLimit).toBe(true);
    expect(result.elapsedSeconds).toBe(240);
    expect(result.limitSeconds).toBe(MAX_ROLLBACK_SECONDS);
  });

  it('should report within limit at exactly 5 minutes', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-01T00:05:00Z'); // exactly 300s
    const result = checkRollbackTimeLimit(start, end);
    expect(result.withinLimit).toBe(true);
    expect(result.elapsedSeconds).toBe(300);
  });

  it('should report over limit when exceeding 5 minutes', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-01T00:05:01Z'); // 301s
    const result = checkRollbackTimeLimit(start, end);
    expect(result.withinLimit).toBe(false);
    expect(result.elapsedSeconds).toBe(301);
  });

  it('should use custom limit when provided', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-01T00:02:00Z'); // 120s
    const result = checkRollbackTimeLimit(start, end, 60);
    expect(result.withinLimit).toBe(false);
    expect(result.limitSeconds).toBe(60);
  });

  it('should handle zero elapsed time', () => {
    const now = new Date();
    const result = checkRollbackTimeLimit(now, now);
    expect(result.withinLimit).toBe(true);
    expect(result.elapsedSeconds).toBe(0);
  });

  it('should clamp negative elapsed to zero', () => {
    const start = new Date('2024-01-01T00:01:00Z');
    const end = new Date('2024-01-01T00:00:00Z'); // end before start
    const result = checkRollbackTimeLimit(start, end);
    expect(result.elapsedSeconds).toBe(0);
    expect(result.withinLimit).toBe(true);
  });
});

// ─── checkRollbackEligibility ────────────────────────────────────────────────

describe('checkRollbackEligibility', () => {
  it('should be eligible for a failed deployment with a previous version', () => {
    const current = makeDeployment({ status: 'failed' });
    const previous = makeDeployment({ version: '1.2.2' });
    const result = checkRollbackEligibility(current, previous);
    expect(result.eligible).toBe(true);
    expect(result.reasons).toEqual([]);
  });

  it('should be eligible for a succeeded deployment with a previous version', () => {
    const current = makeDeployment({ status: 'succeeded' });
    const previous = makeDeployment({ version: '1.2.2' });
    const result = checkRollbackEligibility(current, previous);
    expect(result.eligible).toBe(true);
  });

  it('should not be eligible when no previous deployment exists', () => {
    const current = makeDeployment({ status: 'failed' });
    const result = checkRollbackEligibility(current, undefined);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('No previous deployment'))).toBe(true);
  });

  it('should not be eligible when current deployment is already a rollback', () => {
    const current = makeDeployment({ status: 'failed', rollbackOf: 'deploy-123' });
    const previous = makeDeployment();
    const result = checkRollbackEligibility(current, previous);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('already a rollback'))).toBe(true);
  });

  it('should not be eligible when deployment has already been rolled back', () => {
    const current = makeDeployment({ status: 'rolled_back' });
    const previous = makeDeployment();
    const result = checkRollbackEligibility(current, previous);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('already been rolled back'))).toBe(true);
  });

  it('should not be eligible when deployment is in progress', () => {
    const current = makeDeployment({ status: 'in_progress' });
    const previous = makeDeployment();
    const result = checkRollbackEligibility(current, previous);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('in_progress'))).toBe(true);
  });

  it('should not be eligible when deployment is pending', () => {
    const current = makeDeployment({ status: 'pending' });
    const previous = makeDeployment();
    const result = checkRollbackEligibility(current, previous);
    expect(result.eligible).toBe(false);
    expect(result.reasons.some((r) => r.includes('pending'))).toBe(true);
  });

  it('should accumulate multiple ineligibility reasons', () => {
    const current = makeDeployment({ status: 'rolled_back', rollbackOf: 'deploy-123' });
    const result = checkRollbackEligibility(current, undefined);
    expect(result.eligible).toBe(false);
    expect(result.reasons.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('rollback constants', () => {
  it('should have MAX_ROLLBACK_SECONDS set to 300 (5 minutes)', () => {
    expect(MAX_ROLLBACK_SECONDS).toBe(300);
  });

  it('should support staging and production environments', () => {
    expect(ROLLBACK_ENVIRONMENTS).toContain('staging');
    expect(ROLLBACK_ENVIRONMENTS).toContain('production');
    expect(ROLLBACK_ENVIRONMENTS).toHaveLength(2);
  });
});
