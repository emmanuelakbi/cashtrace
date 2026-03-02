import { describe, expect, it } from 'vitest';

import type { CacheBehavior, CdnConfig } from './cdnConfig.js';
import {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  VALID_COMPRESSION,
  supportsAfricanEdge,
  validateCdnConfig,
} from './cdnConfig.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeCacheBehavior(overrides: Partial<CacheBehavior> = {}): CacheBehavior {
  return {
    pathPattern: '/api/*',
    ttlSeconds: 3600,
    allowedMethods: ['GET', 'HEAD'],
    ...overrides,
  };
}

function makeCdnConfig(overrides: Partial<CdnConfig> = {}): CdnConfig {
  return {
    distributionId: 'E1234567890',
    origins: ['https://origin.example.com'],
    cacheBehaviors: [makeCacheBehavior()],
    compressionEnabled: true,
    compressionTypes: ['gzip', 'br'],
    httpsOnly: true,
    region: 'af-south-1',
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('VALID_COMPRESSION contains gzip and br', () => {
    expect(VALID_COMPRESSION).toEqual(['gzip', 'br']);
  });

  it('DEFAULT_TTL_SECONDS is 24 hours', () => {
    expect(DEFAULT_TTL_SECONDS).toBe(86400);
  });

  it('MAX_TTL_SECONDS is 1 year', () => {
    expect(MAX_TTL_SECONDS).toBe(31536000);
  });
});

// ─── validateCdnConfig ──────────────────────────────────────────────────────

describe('validateCdnConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateCdnConfig(makeCdnConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects empty distributionId', () => {
    const result = validateCdnConfig(makeCdnConfig({ distributionId: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('distributionId'));
  });

  it('rejects whitespace-only distributionId', () => {
    const result = validateCdnConfig(makeCdnConfig({ distributionId: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('distributionId'));
  });

  it('rejects empty origins', () => {
    const result = validateCdnConfig(makeCdnConfig({ origins: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('at least one origin'));
  });

  it('rejects httpsOnly = false', () => {
    const result = validateCdnConfig(makeCdnConfig({ httpsOnly: false }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('httpsOnly must be true'));
  });

  it('rejects invalid compression types', () => {
    const result = validateCdnConfig(makeCdnConfig({ compressionTypes: ['deflate'] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Invalid compression type'));
  });

  it('accepts valid compression types', () => {
    const result = validateCdnConfig(makeCdnConfig({ compressionTypes: ['gzip'] }));
    expect(result.valid).toBe(true);
  });

  it('rejects cache behavior with empty pathPattern', () => {
    const result = validateCdnConfig(
      makeCdnConfig({ cacheBehaviors: [makeCacheBehavior({ pathPattern: '' })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('pathPattern must be non-empty'));
  });

  it('rejects cache behavior with negative ttlSeconds', () => {
    const result = validateCdnConfig(
      makeCdnConfig({ cacheBehaviors: [makeCacheBehavior({ ttlSeconds: -1 })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('ttlSeconds must be between'));
  });

  it('rejects cache behavior with ttlSeconds exceeding MAX', () => {
    const result = validateCdnConfig(
      makeCdnConfig({
        cacheBehaviors: [makeCacheBehavior({ ttlSeconds: MAX_TTL_SECONDS + 1 })],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('ttlSeconds must be between'));
  });

  it('accepts cache behavior with ttlSeconds = 0', () => {
    const result = validateCdnConfig(
      makeCdnConfig({ cacheBehaviors: [makeCacheBehavior({ ttlSeconds: 0 })] }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts cache behavior with ttlSeconds = MAX_TTL_SECONDS', () => {
    const result = validateCdnConfig(
      makeCdnConfig({
        cacheBehaviors: [makeCacheBehavior({ ttlSeconds: MAX_TTL_SECONDS })],
      }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects cache behavior with empty allowedMethods', () => {
    const result = validateCdnConfig(
      makeCdnConfig({ cacheBehaviors: [makeCacheBehavior({ allowedMethods: [] })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('allowedMethods must be non-empty'),
    );
  });

  it('rejects non af-south-1 region', () => {
    const result = validateCdnConfig(makeCdnConfig({ region: 'us-east-1' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('Region must be "af-south-1"'));
  });

  it('collects multiple errors at once', () => {
    const result = validateCdnConfig(
      makeCdnConfig({
        distributionId: '',
        origins: [],
        httpsOnly: false,
        region: 'eu-west-1',
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── supportsAfricanEdge ────────────────────────────────────────────────────

describe('supportsAfricanEdge', () => {
  it('returns true for af-south-1', () => {
    expect(supportsAfricanEdge(makeCdnConfig({ region: 'af-south-1' }))).toBe(true);
  });

  it('returns false for us-east-1', () => {
    expect(supportsAfricanEdge(makeCdnConfig({ region: 'us-east-1' }))).toBe(false);
  });

  it('returns false for eu-west-1', () => {
    expect(supportsAfricanEdge(makeCdnConfig({ region: 'eu-west-1' }))).toBe(false);
  });
});
