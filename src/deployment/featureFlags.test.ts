import { describe, expect, it } from 'vitest';

import type { FeatureFlag, FeatureFlagOverride } from './featureFlags.js';
import {
  FLAG_NAME_PATTERN,
  VALID_ENVIRONMENTS,
  getEnabledFlags,
  isFeatureEnabled,
  validateFeatureFlag,
  validateFeatureFlagOverride,
  validateFlagName,
} from './featureFlags.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFeatureFlag(overrides: Partial<FeatureFlag> = {}): FeatureFlag {
  const now = new Date();
  return {
    name: 'enable_dark_mode',
    description: 'Toggle dark mode UI',
    environments: { development: true, staging: true, production: false },
    createdBy: 'admin',
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeOverride(overrides: Partial<FeatureFlagOverride> = {}): FeatureFlagOverride {
  return {
    flagName: 'enable_dark_mode',
    environment: 'production',
    enabled: true,
    reason: 'Hotfix rollout',
    overriddenBy: 'ops-engineer',
    ...overrides,
  };
}

// ─── validateFlagName ────────────────────────────────────────────────────────

describe('validateFlagName', () => {
  it('should accept a valid lowercase name', () => {
    expect(validateFlagName('enable_dark_mode')).toBe(true);
  });

  it('should accept a 3-character name', () => {
    expect(validateFlagName('abc')).toBe(true);
  });

  it('should accept a 50-character name', () => {
    const name = 'a' + 'b'.repeat(49);
    expect(validateFlagName(name)).toBe(true);
  });

  it('should accept names with digits', () => {
    expect(validateFlagName('feature_v2')).toBe(true);
  });

  it('should reject names starting with a digit', () => {
    expect(validateFlagName('1_feature')).toBe(false);
  });

  it('should reject names starting with underscore', () => {
    expect(validateFlagName('_feature')).toBe(false);
  });

  it('should reject uppercase letters', () => {
    expect(validateFlagName('Enable_Feature')).toBe(false);
  });

  it('should reject names shorter than 3 characters', () => {
    expect(validateFlagName('ab')).toBe(false);
  });

  it('should reject names longer than 50 characters', () => {
    const name = 'a' + 'b'.repeat(50);
    expect(validateFlagName(name)).toBe(false);
  });

  it('should reject names with hyphens', () => {
    expect(validateFlagName('enable-feature')).toBe(false);
  });

  it('should reject empty string', () => {
    expect(validateFlagName('')).toBe(false);
  });
});

// ─── validateFeatureFlag ─────────────────────────────────────────────────────

describe('validateFeatureFlag', () => {
  it('should return valid for a well-formed flag', () => {
    const result = validateFeatureFlag(makeFeatureFlag());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject invalid flag name', () => {
    const result = validateFeatureFlag(makeFeatureFlag({ name: 'BAD-NAME' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid flag name'))).toBe(true);
  });

  it('should reject empty description', () => {
    const result = validateFeatureFlag(makeFeatureFlag({ description: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Description'))).toBe(true);
  });

  it('should reject whitespace-only description', () => {
    const result = validateFeatureFlag(makeFeatureFlag({ description: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Description'))).toBe(true);
  });

  it('should reject missing environment keys', () => {
    const partial = { development: true, staging: true } as Record<
      'development' | 'staging' | 'production',
      boolean
    >;
    const result = validateFeatureFlag(makeFeatureFlag({ environments: partial }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('production'))).toBe(true);
  });

  it('should reject empty createdBy', () => {
    const result = validateFeatureFlag(makeFeatureFlag({ createdBy: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('createdBy'))).toBe(true);
  });

  it('should reject whitespace-only createdBy', () => {
    const result = validateFeatureFlag(makeFeatureFlag({ createdBy: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('createdBy'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const result = validateFeatureFlag(
      makeFeatureFlag({ name: 'X', description: '', createdBy: '' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── validateFeatureFlagOverride ─────────────────────────────────────────────

describe('validateFeatureFlagOverride', () => {
  const existingFlags = [makeFeatureFlag()];

  it('should return valid for a well-formed override', () => {
    const result = validateFeatureFlagOverride(makeOverride(), existingFlags);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject override for non-existent flag', () => {
    const result = validateFeatureFlagOverride(
      makeOverride({ flagName: 'nonexistent_flag' }),
      existingFlags,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('does not exist'))).toBe(true);
  });

  it('should reject invalid environment', () => {
    const result = validateFeatureFlagOverride(
      makeOverride({ environment: 'invalid' as 'production' }),
      existingFlags,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid environment'))).toBe(true);
  });

  it('should reject empty reason', () => {
    const result = validateFeatureFlagOverride(makeOverride({ reason: '' }), existingFlags);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Reason'))).toBe(true);
  });

  it('should reject whitespace-only reason', () => {
    const result = validateFeatureFlagOverride(makeOverride({ reason: '   ' }), existingFlags);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Reason'))).toBe(true);
  });

  it('should reject empty overriddenBy', () => {
    const result = validateFeatureFlagOverride(makeOverride({ overriddenBy: '' }), existingFlags);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('overriddenBy'))).toBe(true);
  });

  it('should reject whitespace-only overriddenBy', () => {
    const result = validateFeatureFlagOverride(
      makeOverride({ overriddenBy: '   ' }),
      existingFlags,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('overriddenBy'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const result = validateFeatureFlagOverride(
      makeOverride({ flagName: 'nope', reason: '', overriddenBy: '' }),
      existingFlags,
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── isFeatureEnabled ────────────────────────────────────────────────────────

describe('isFeatureEnabled', () => {
  const flag = makeFeatureFlag({
    environments: { development: true, staging: true, production: false },
  });

  it('should return the flag value when no overrides exist', () => {
    expect(isFeatureEnabled(flag, 'development')).toBe(true);
    expect(isFeatureEnabled(flag, 'production')).toBe(false);
  });

  it('should return the flag value when overrides array is empty', () => {
    expect(isFeatureEnabled(flag, 'production', [])).toBe(false);
  });

  it('should use override when one matches flag + environment', () => {
    const overrides = [
      makeOverride({ flagName: flag.name, environment: 'production', enabled: true }),
    ];
    expect(isFeatureEnabled(flag, 'production', overrides)).toBe(true);
  });

  it('should ignore overrides for different flags', () => {
    const overrides = [
      makeOverride({ flagName: 'other_flag', environment: 'production', enabled: true }),
    ];
    expect(isFeatureEnabled(flag, 'production', overrides)).toBe(false);
  });

  it('should ignore overrides for different environments', () => {
    const overrides = [
      makeOverride({ flagName: flag.name, environment: 'staging', enabled: false }),
    ];
    expect(isFeatureEnabled(flag, 'production', overrides)).toBe(false);
    expect(isFeatureEnabled(flag, 'staging', overrides)).toBe(false);
  });

  it('should allow override to disable an enabled flag', () => {
    const overrides = [
      makeOverride({ flagName: flag.name, environment: 'development', enabled: false }),
    ];
    expect(isFeatureEnabled(flag, 'development', overrides)).toBe(false);
  });
});

// ─── getEnabledFlags ─────────────────────────────────────────────────────────

describe('getEnabledFlags', () => {
  const flags = [
    makeFeatureFlag({
      name: 'flag_alpha',
      environments: { development: true, staging: true, production: false },
    }),
    makeFeatureFlag({
      name: 'flag_beta',
      environments: { development: false, staging: true, production: true },
    }),
    makeFeatureFlag({
      name: 'flag_gamma',
      environments: { development: true, staging: false, production: false },
    }),
  ];

  it('should return only flags enabled for the given environment', () => {
    expect(getEnabledFlags(flags, 'development')).toEqual(['flag_alpha', 'flag_gamma']);
    expect(getEnabledFlags(flags, 'staging')).toEqual(['flag_alpha', 'flag_beta']);
    expect(getEnabledFlags(flags, 'production')).toEqual(['flag_beta']);
  });

  it('should return empty array when no flags are enabled', () => {
    const allOff = [
      makeFeatureFlag({
        name: 'flag_off',
        environments: { development: false, staging: false, production: false },
      }),
    ];
    expect(getEnabledFlags(allOff, 'production')).toEqual([]);
  });

  it('should consider overrides when provided', () => {
    const overrides = [
      makeOverride({ flagName: 'flag_alpha', environment: 'production', enabled: true }),
      makeOverride({ flagName: 'flag_beta', environment: 'production', enabled: false }),
    ];
    expect(getEnabledFlags(flags, 'production', overrides)).toEqual(['flag_alpha']);
  });

  it('should handle empty flags array', () => {
    expect(getEnabledFlags([], 'development')).toEqual([]);
  });

  it('should handle empty overrides array', () => {
    expect(getEnabledFlags(flags, 'production', [])).toEqual(['flag_beta']);
  });
});

// ─── Constants ───────────────────────────────────────────────────────────────

describe('featureFlags constants', () => {
  it('should have three valid environments', () => {
    expect(VALID_ENVIRONMENTS).toEqual(['development', 'staging', 'production']);
    expect(VALID_ENVIRONMENTS).toHaveLength(3);
  });

  it('should have FLAG_NAME_PATTERN as a regex', () => {
    expect(FLAG_NAME_PATTERN).toBeInstanceOf(RegExp);
  });
});
