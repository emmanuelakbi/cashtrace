import { describe, expect, it } from 'vitest';

import {
  buildPreviewConfig,
  checkPreviewCapacity,
  generatePreviewName,
  generatePreviewUrl,
  isPreviewExpired,
  MAX_PREVIEW_ENVIRONMENTS,
  PREVIEW_TTL_HOURS,
  PREVIEW_URL_PATTERN,
  validatePreviewRequest,
} from './previewEnvironment.js';
import type { PreviewEnvironmentConfig, PreviewEnvironmentRequest } from './previewEnvironment.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makePreviewRequest(
  overrides: Partial<PreviewEnvironmentRequest> = {},
): PreviewEnvironmentRequest {
  return {
    pullRequestNumber: 42,
    branch: 'feature/add-payments',
    commitSha: 'abc1234',
    requestedBy: 'dev-user',
    ...overrides,
  };
}

function makePreviewConfig(
  overrides: Partial<PreviewEnvironmentConfig> = {},
): PreviewEnvironmentConfig {
  const now = new Date();
  return {
    name: 'pr-42-preview',
    url: 'https://pr-42.preview.cashtrace.ng',
    pullRequestNumber: 42,
    branch: 'feature/add-payments',
    commitSha: 'abc1234',
    createdAt: now,
    expiresAt: new Date(now.getTime() + PREVIEW_TTL_HOURS * 60 * 60 * 1000),
    status: 'ready',
    ...overrides,
  };
}

// ─── generatePreviewName ─────────────────────────────────────────────────────

describe('generatePreviewName', () => {
  it('should return pr-{number}-preview format', () => {
    expect(generatePreviewName(42)).toBe('pr-42-preview');
  });

  it('should handle single-digit PR numbers', () => {
    expect(generatePreviewName(1)).toBe('pr-1-preview');
  });

  it('should handle large PR numbers', () => {
    expect(generatePreviewName(99999)).toBe('pr-99999-preview');
  });
});

// ─── generatePreviewUrl ──────────────────────────────────────────────────────

describe('generatePreviewUrl', () => {
  it('should return the correct preview URL format', () => {
    expect(generatePreviewUrl(42)).toBe('https://pr-42.preview.cashtrace.ng');
  });

  it('should produce URLs matching PREVIEW_URL_PATTERN', () => {
    expect(PREVIEW_URL_PATTERN.test(generatePreviewUrl(1))).toBe(true);
    expect(PREVIEW_URL_PATTERN.test(generatePreviewUrl(999))).toBe(true);
  });

  it('should not match invalid URLs', () => {
    expect(PREVIEW_URL_PATTERN.test('http://pr-1.preview.cashtrace.ng')).toBe(false);
    expect(PREVIEW_URL_PATTERN.test('https://pr-abc.preview.cashtrace.ng')).toBe(false);
  });
});

// ─── validatePreviewRequest ──────────────────────────────────────────────────

describe('validatePreviewRequest', () => {
  it('should return valid for a well-formed request', () => {
    const result = validatePreviewRequest(makePreviewRequest());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject zero pullRequestNumber', () => {
    const result = validatePreviewRequest(makePreviewRequest({ pullRequestNumber: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pullRequestNumber'))).toBe(true);
  });

  it('should reject negative pullRequestNumber', () => {
    const result = validatePreviewRequest(makePreviewRequest({ pullRequestNumber: -5 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pullRequestNumber'))).toBe(true);
  });

  it('should reject non-integer pullRequestNumber', () => {
    const result = validatePreviewRequest(makePreviewRequest({ pullRequestNumber: 1.5 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('pullRequestNumber'))).toBe(true);
  });

  it('should reject empty branch', () => {
    const result = validatePreviewRequest(makePreviewRequest({ branch: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('branch'))).toBe(true);
  });

  it('should reject whitespace-only branch', () => {
    const result = validatePreviewRequest(makePreviewRequest({ branch: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('branch'))).toBe(true);
  });

  it('should reject empty commitSha', () => {
    const result = validatePreviewRequest(makePreviewRequest({ commitSha: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('commitSha'))).toBe(true);
  });

  it('should reject commitSha with invalid characters', () => {
    const result = validatePreviewRequest(makePreviewRequest({ commitSha: 'xyz1234' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('commitSha'))).toBe(true);
  });

  it('should reject commitSha that is too short', () => {
    const result = validatePreviewRequest(makePreviewRequest({ commitSha: 'abc12' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('commitSha'))).toBe(true);
  });

  it('should accept full 40-char commitSha', () => {
    const result = validatePreviewRequest(makePreviewRequest({ commitSha: 'a'.repeat(40) }));
    expect(result.valid).toBe(true);
  });

  it('should reject commitSha longer than 40 characters', () => {
    const result = validatePreviewRequest(makePreviewRequest({ commitSha: 'a'.repeat(41) }));
    expect(result.valid).toBe(false);
  });

  it('should reject empty requestedBy', () => {
    const result = validatePreviewRequest(makePreviewRequest({ requestedBy: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('requestedBy'))).toBe(true);
  });

  it('should reject whitespace-only requestedBy', () => {
    const result = validatePreviewRequest(makePreviewRequest({ requestedBy: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('requestedBy'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const result = validatePreviewRequest(
      makePreviewRequest({
        pullRequestNumber: -1,
        branch: '',
        commitSha: '',
        requestedBy: '',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── checkPreviewCapacity ────────────────────────────────────────────────────

describe('checkPreviewCapacity', () => {
  it('should report available when no active environments exist', () => {
    const result = checkPreviewCapacity([]);
    expect(result.available).toBe(true);
    expect(result.currentCount).toBe(0);
    expect(result.maxCount).toBe(MAX_PREVIEW_ENVIRONMENTS);
    expect(result.reason).toBeUndefined();
  });

  it('should report available when under the limit', () => {
    const envs = Array.from({ length: 5 }, () => makePreviewConfig({ status: 'ready' }));
    const result = checkPreviewCapacity(envs);
    expect(result.available).toBe(true);
    expect(result.currentCount).toBe(5);
  });

  it('should report unavailable when at the limit', () => {
    const envs = Array.from({ length: MAX_PREVIEW_ENVIRONMENTS }, () =>
      makePreviewConfig({ status: 'ready' }),
    );
    const result = checkPreviewCapacity(envs);
    expect(result.available).toBe(false);
    expect(result.currentCount).toBe(MAX_PREVIEW_ENVIRONMENTS);
    expect(result.reason).toBeDefined();
  });

  it('should report unavailable when over the limit', () => {
    const envs = Array.from({ length: MAX_PREVIEW_ENVIRONMENTS + 2 }, () =>
      makePreviewConfig({ status: 'creating' }),
    );
    const result = checkPreviewCapacity(envs);
    expect(result.available).toBe(false);
  });

  it('should only count creating and ready environments', () => {
    const envs = [
      makePreviewConfig({ status: 'ready' }),
      makePreviewConfig({ status: 'creating' }),
      makePreviewConfig({ status: 'expired' }),
      makePreviewConfig({ status: 'destroying' }),
    ];
    const result = checkPreviewCapacity(envs);
    expect(result.available).toBe(true);
    expect(result.currentCount).toBe(2);
  });

  it('should count creating environments toward the limit', () => {
    const envs = Array.from({ length: MAX_PREVIEW_ENVIRONMENTS }, () =>
      makePreviewConfig({ status: 'creating' }),
    );
    const result = checkPreviewCapacity(envs);
    expect(result.available).toBe(false);
  });
});

// ─── isPreviewExpired ────────────────────────────────────────────────────────

describe('isPreviewExpired', () => {
  it('should return false when environment has not expired', () => {
    const config = makePreviewConfig({ status: 'ready' });
    const now = new Date(config.createdAt.getTime() + 1000);
    expect(isPreviewExpired(config, now)).toBe(false);
  });

  it('should return true when now equals expiresAt', () => {
    const config = makePreviewConfig({ status: 'ready' });
    expect(isPreviewExpired(config, config.expiresAt)).toBe(true);
  });

  it('should return true when now is past expiresAt', () => {
    const config = makePreviewConfig({ status: 'ready' });
    const future = new Date(config.expiresAt.getTime() + 60_000);
    expect(isPreviewExpired(config, future)).toBe(true);
  });

  it('should return true when status is expired regardless of time', () => {
    const config = makePreviewConfig({ status: 'expired' });
    const past = new Date(config.createdAt.getTime() - 60_000);
    expect(isPreviewExpired(config, past)).toBe(true);
  });

  it('should default now to current time', () => {
    const pastExpiry = new Date(Date.now() - 60_000);
    const config = makePreviewConfig({ expiresAt: pastExpiry, status: 'ready' });
    expect(isPreviewExpired(config)).toBe(true);
  });
});

// ─── buildPreviewConfig ──────────────────────────────────────────────────────

describe('buildPreviewConfig', () => {
  it('should generate name from PR number', () => {
    const config = buildPreviewConfig(makePreviewRequest({ pullRequestNumber: 99 }));
    expect(config.name).toBe('pr-99-preview');
  });

  it('should generate URL from PR number', () => {
    const config = buildPreviewConfig(makePreviewRequest({ pullRequestNumber: 99 }));
    expect(config.url).toBe('https://pr-99.preview.cashtrace.ng');
  });

  it('should copy request fields to config', () => {
    const request = makePreviewRequest();
    const config = buildPreviewConfig(request);
    expect(config.pullRequestNumber).toBe(request.pullRequestNumber);
    expect(config.branch).toBe(request.branch);
    expect(config.commitSha).toBe(request.commitSha);
  });

  it('should set status to creating', () => {
    const config = buildPreviewConfig(makePreviewRequest());
    expect(config.status).toBe('creating');
  });

  it('should set expiresAt to createdAt + PREVIEW_TTL_HOURS', () => {
    const config = buildPreviewConfig(makePreviewRequest());
    const expectedMs = PREVIEW_TTL_HOURS * 60 * 60 * 1000;
    const diff = config.expiresAt.getTime() - config.createdAt.getTime();
    expect(diff).toBe(expectedMs);
  });

  it('should set createdAt close to now', () => {
    const before = Date.now();
    const config = buildPreviewConfig(makePreviewRequest());
    const after = Date.now();
    expect(config.createdAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(config.createdAt.getTime()).toBeLessThanOrEqual(after);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('preview environment constants', () => {
  it('should have MAX_PREVIEW_ENVIRONMENTS set to 10', () => {
    expect(MAX_PREVIEW_ENVIRONMENTS).toBe(10);
  });

  it('should have PREVIEW_TTL_HOURS set to 72', () => {
    expect(PREVIEW_TTL_HOURS).toBe(72);
  });

  it('should have a valid PREVIEW_URL_PATTERN', () => {
    expect(PREVIEW_URL_PATTERN.test('https://pr-1.preview.cashtrace.ng')).toBe(true);
    expect(PREVIEW_URL_PATTERN.test('https://pr-123.preview.cashtrace.ng')).toBe(true);
    expect(PREVIEW_URL_PATTERN.test('https://pr-.preview.cashtrace.ng')).toBe(false);
    expect(PREVIEW_URL_PATTERN.test('https://pr-abc.preview.cashtrace.ng')).toBe(false);
  });
});
