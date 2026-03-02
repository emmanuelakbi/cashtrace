/**
 * Secret management validation and configuration.
 *
 * Provides validation for secret names, configurations, environment isolation,
 * rotation status checks, and access authorization.
 *
 * Supports requirements 6.1–6.4: secrets stored in AWS Secrets Manager,
 * injected as env vars, rotation without restart, audit all access,
 * encrypt at rest/transit, prevent secrets in logs.
 *
 * @module deployment/secretManagement
 */

import type { SecretAccessLog, SecretMetadata } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Valid secret name pattern: starts with a letter, 3–128 chars, alphanumeric plus _ / - */
export const SECRET_NAME_PATTERN = /^[a-zA-Z][a-zA-Z0-9_/-]{2,127}$/;

/** Maximum secret value size in bytes (64 KB). */
export const MAX_SECRET_SIZE_BYTES = 65536;

/** Default rotation interval in days. */
export const DEFAULT_ROTATION_DAYS = 90;

/** Allowed deployment environments for secrets. */
export const SECRET_ENVIRONMENTS = ['development', 'staging', 'production'] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for a managed secret. */
export interface SecretConfig {
  /** Secret name (must match SECRET_NAME_PATTERN). */
  name: string;
  /** Target environment. */
  environment: string;
  /** Rotation interval in days. */
  rotationDays: number;
  /** Whether automatic rotation is enabled. */
  autoRotate: boolean;
}

/** Result of validating a SecretConfig. */
export interface SecretConfigValidationResult {
  /** Whether the config is valid. */
  valid: boolean;
  /** Validation error messages. */
  errors: string[];
}

/** Result of checking secret environment isolation. */
export interface SecretIsolationCheck {
  /** Whether all secrets are properly isolated per environment. */
  isolated: boolean;
  /** Descriptions of isolation violations. */
  violations: string[];
}

/** Result of checking whether a secret needs rotation. */
export interface SecretRotationStatus {
  /** Whether the secret needs rotation. */
  needsRotation: boolean;
  /** Days elapsed since last rotation. */
  daysSinceRotation: number;
  /** Configured rotation interval in days. */
  rotationDays: number;
}

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Validate a secret name against SECRET_NAME_PATTERN.
 *
 * @param name - The secret name to validate.
 * @returns `true` if the name matches the pattern.
 */
export function validateSecretName(name: string): boolean {
  return SECRET_NAME_PATTERN.test(name);
}

/**
 * Validate a secret configuration.
 *
 * Rules:
 * - name must match SECRET_NAME_PATTERN
 * - environment must be one of SECRET_ENVIRONMENTS
 * - rotationDays must be > 0 and <= 365
 *
 * @param config - The secret configuration to validate.
 * @returns Validation result with any errors.
 */
export function validateSecretConfig(config: SecretConfig): SecretConfigValidationResult {
  const errors: string[] = [];

  if (!SECRET_NAME_PATTERN.test(config.name)) {
    errors.push('name must match SECRET_NAME_PATTERN');
  }

  if (!(SECRET_ENVIRONMENTS as readonly string[]).includes(config.environment)) {
    errors.push('environment must be one of: ' + SECRET_ENVIRONMENTS.join(', '));
  }

  if (config.rotationDays <= 0 || config.rotationDays > 365) {
    errors.push('rotationDays must be > 0 and <= 365');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check that secrets are properly isolated across environments.
 *
 * The same secret name should not appear in multiple environments —
 * each environment must have its own copy.
 *
 * @param secrets - Array of secret name/environment pairs.
 * @returns Isolation check result with any violations.
 */
export function checkSecretIsolation(
  secrets: Array<{ name: string; environment: string }>,
): SecretIsolationCheck {
  const violations: string[] = [];
  const envsByName = new Map<string, Set<string>>();

  for (const secret of secrets) {
    const envs = envsByName.get(secret.name) ?? new Set<string>();
    envs.add(secret.environment);
    envsByName.set(secret.name, envs);
  }

  for (const [name, envs] of envsByName) {
    if (envs.size > 1) {
      const envList = [...envs].sort().join(', ');
      violations.push(`secret "${name}" is shared across environments: ${envList}`);
    }
  }

  return { isolated: violations.length === 0, violations };
}

/**
 * Check whether a secret needs rotation based on its metadata.
 *
 * Calculates the number of days since the last rotation and compares
 * against the configured rotation interval.
 *
 * @param metadata - The secret's metadata (includes rotatedAt).
 * @param rotationDays - The rotation interval in days.
 * @returns Rotation status with days since last rotation.
 */
export function checkRotationStatus(
  metadata: SecretMetadata,
  rotationDays: number,
): SecretRotationStatus {
  const now = new Date();
  const msPerDay = 86_400_000;
  const daysSinceRotation = Math.floor((now.getTime() - metadata.rotatedAt.getTime()) / msPerDay);

  return {
    needsRotation: daysSinceRotation >= rotationDays,
    daysSinceRotation,
    rotationDays,
  };
}

/**
 * Check whether a secret access is authorized.
 *
 * Returns `true` when the principal is in the allowed list and the
 * access was successful.
 *
 * @param log - The secret access log entry.
 * @param allowedPrincipals - List of authorized principals.
 * @returns `true` if the access is authorized.
 */
export function isSecretAccessAuthorized(
  log: SecretAccessLog,
  allowedPrincipals: string[],
): boolean {
  return allowedPrincipals.includes(log.principal) && log.success;
}
