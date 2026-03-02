/**
 * Environment-specific feature flag validation.
 *
 * Provides pure functions to validate feature flag configurations,
 * check overrides, and determine which flags are enabled per environment.
 * Supports Requirement 3.6 (environment-specific feature flags).
 *
 * @module deployment/featureFlags
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Valid deployment environments for feature flags. */
export const VALID_ENVIRONMENTS = ['development', 'staging', 'production'] as const;

/**
 * Pattern for valid flag names: lowercase, starts with a letter,
 * 3–50 characters, alphanumeric + underscore only.
 */
export const FLAG_NAME_PATTERN = /^[a-z][a-z0-9_]{2,49}$/;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A valid feature flag environment. */
export type FeatureFlagEnvironment = (typeof VALID_ENVIRONMENTS)[number];

/** A feature flag with per-environment enabled/disabled state. */
export interface FeatureFlag {
  /** Unique flag name (must match FLAG_NAME_PATTERN). */
  name: string;
  /** Human-readable description of the flag. */
  description: string;
  /** Per-environment enabled state. */
  environments: Record<FeatureFlagEnvironment, boolean>;
  /** Who created the flag. */
  createdBy: string;
  /** When the flag was created. */
  createdAt: Date;
  /** When the flag was last updated. */
  updatedAt: Date;
}

/** Result of validating a feature flag. */
export interface FeatureFlagValidationResult {
  /** Whether the flag is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** An override for a specific flag in a specific environment. */
export interface FeatureFlagOverride {
  /** Name of the flag to override. */
  flagName: string;
  /** Target environment. */
  environment: FeatureFlagEnvironment;
  /** Whether the flag should be enabled. */
  enabled: boolean;
  /** Reason for the override. */
  reason: string;
  /** Who applied the override. */
  overriddenBy: string;
}

/** Result of validating a feature flag override. */
export interface FeatureFlagOverrideValidationResult {
  /** Whether the override is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Check whether a flag name matches the required pattern.
 *
 * Valid names are lowercase, start with a letter, 3–50 characters,
 * and contain only alphanumeric characters and underscores.
 */
export function validateFlagName(name: string): boolean {
  return FLAG_NAME_PATTERN.test(name);
}

/**
 * Validate a complete feature flag configuration.
 *
 * Checks:
 * - Name matches FLAG_NAME_PATTERN
 * - Description is non-empty
 * - All three environments are present in the environments record
 * - createdBy is non-empty
 */
export function validateFeatureFlag(flag: FeatureFlag): FeatureFlagValidationResult {
  const errors: string[] = [];

  if (!validateFlagName(flag.name)) {
    errors.push(
      `Invalid flag name "${flag.name}". Must match pattern: lowercase, start with letter, 3-50 chars, alphanumeric + underscore`,
    );
  }

  if (!flag.description || flag.description.trim() === '') {
    errors.push('Description must be a non-empty string');
  }

  for (const env of VALID_ENVIRONMENTS) {
    if (typeof flag.environments[env] !== 'boolean') {
      errors.push(`Missing or invalid value for environment "${env}"`);
    }
  }

  if (!flag.createdBy || flag.createdBy.trim() === '') {
    errors.push('createdBy must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a feature flag override against existing flags.
 *
 * Checks:
 * - flagName exists in the provided list of existing flags
 * - environment is a valid environment
 * - reason is non-empty
 * - overriddenBy is non-empty
 */
export function validateFeatureFlagOverride(
  override: FeatureFlagOverride,
  existingFlags: FeatureFlag[],
): FeatureFlagOverrideValidationResult {
  const errors: string[] = [];

  const flagExists = existingFlags.some((f) => f.name === override.flagName);
  if (!flagExists) {
    errors.push(`Flag "${override.flagName}" does not exist`);
  }

  if (
    !override.environment ||
    !VALID_ENVIRONMENTS.includes(override.environment as FeatureFlagEnvironment)
  ) {
    errors.push(
      `Invalid environment "${override.environment}". Must be one of: ${VALID_ENVIRONMENTS.join(', ')}`,
    );
  }

  if (!override.reason || override.reason.trim() === '') {
    errors.push('Reason must be a non-empty string');
  }

  if (!override.overriddenBy || override.overriddenBy.trim() === '') {
    errors.push('overriddenBy must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Queries ─────────────────────────────────────────────────────────────────

/**
 * Determine whether a feature flag is enabled for a given environment.
 *
 * If an override exists for the flag+environment combination, the override
 * takes precedence. Otherwise the flag's own environment setting is used.
 */
export function isFeatureEnabled(
  flag: FeatureFlag,
  environment: FeatureFlagEnvironment,
  overrides?: FeatureFlagOverride[],
): boolean {
  const override = overrides?.find(
    (o) => o.flagName === flag.name && o.environment === environment,
  );

  if (override) {
    return override.enabled;
  }

  return flag.environments[environment];
}

/**
 * Return the names of all flags enabled for a given environment.
 *
 * Considers overrides when provided.
 */
export function getEnabledFlags(
  flags: FeatureFlag[],
  environment: FeatureFlagEnvironment,
  overrides?: FeatureFlagOverride[],
): string[] {
  return flags
    .filter((flag) => isFeatureEnabled(flag, environment, overrides))
    .map((flag) => flag.name);
}
