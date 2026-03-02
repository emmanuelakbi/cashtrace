/**
 * Environment configuration validation and management.
 *
 * Provides pure functions to validate environment configurations for
 * development, staging, and production tiers, including environment
 * variable management and data isolation validation.
 *
 * @module deployment/environmentConfig
 */

import type { Environment } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Supported environment tiers. */
export const ENVIRONMENT_TIERS = ['development', 'staging', 'production'] as const;

/** A valid environment tier name. */
export type EnvironmentTier = (typeof ENVIRONMENT_TIERS)[number];

/** Required environment variables per tier. */
export const REQUIRED_VARIABLES: Record<EnvironmentTier, string[]> = {
  development: ['NODE_ENV', 'DATABASE_URL', 'REDIS_URL', 'API_BASE_URL'],
  staging: [
    'NODE_ENV',
    'DATABASE_URL',
    'REDIS_URL',
    'API_BASE_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
  ],
  production: [
    'NODE_ENV',
    'DATABASE_URL',
    'REDIS_URL',
    'API_BASE_URL',
    'JWT_SECRET',
    'ENCRYPTION_KEY',
    'SENTRY_DSN',
    'PAGERDUTY_KEY',
  ],
};

/** URL patterns for each environment tier. */
export const TIER_URLS: Record<EnvironmentTier, RegExp> = {
  development: /^https?:\/\/(localhost|127\.0\.0\.1)/,
  staging: /^https:\/\/staging\./,
  production: /^https:\/\/(www\.)?cashtrace\.ng/,
};

// ─── Result Types ────────────────────────────────────────────────────────────

/** Result of validating an environment configuration. */
export interface EnvironmentConfigValidationResult {
  valid: boolean;
  errors: string[];
}

/** Result of checking environment isolation. */
export interface EnvironmentIsolationResult {
  isolated: boolean;
  violations: string[];
}

/** Result of validating environment variables. */
export interface EnvironmentVariableValidationResult {
  valid: boolean;
  missing: string[];
  errors: string[];
}

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Check whether a name is a valid environment tier.
 *
 * @param name - The name to validate.
 * @returns `true` if the name is a recognised tier.
 */
export function validateEnvironmentTier(name: string): boolean {
  return (ENVIRONMENT_TIERS as readonly string[]).includes(name);
}

/**
 * Get the list of required environment variable names for a tier.
 *
 * @param tier - The environment tier.
 * @returns Array of required variable names.
 */
export function getRequiredVariables(tier: EnvironmentTier): string[] {
  return REQUIRED_VARIABLES[tier];
}

/**
 * Validate that an environment has all required variables with non-empty values.
 *
 * @param environment - The environment to validate.
 * @returns Validation result with missing variables and errors.
 */
export function validateEnvironmentVariables(
  environment: Environment,
): EnvironmentVariableValidationResult {
  const errors: string[] = [];
  const missing: string[] = [];

  if (!validateEnvironmentTier(environment.name)) {
    errors.push(`Invalid environment tier: "${environment.name}"`);
    return { valid: false, missing, errors };
  }

  const tier = environment.name as EnvironmentTier;
  const required = getRequiredVariables(tier);
  const variableNames = new Set(environment.variables.map((v) => v.name));

  for (const name of required) {
    if (!variableNames.has(name)) {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    errors.push(`Missing required variables for ${tier}: ${missing.join(', ')}`);
  }

  for (const variable of environment.variables) {
    if (variable.value === '') {
      errors.push(`Variable "${variable.name}" has an empty value`);
    }
  }

  return { valid: errors.length === 0, missing, errors };
}

/**
 * Validate a complete environment configuration.
 *
 * Checks tier validity, URL pattern, approval gates, and variables.
 *
 * @param environment - The environment to validate.
 * @returns Validation result with aggregated errors.
 */
export function validateEnvironmentConfig(
  environment: Environment,
): EnvironmentConfigValidationResult {
  const errors: string[] = [];

  if (!validateEnvironmentTier(environment.name)) {
    errors.push(`Invalid environment tier: "${environment.name}"`);
    return { valid: false, errors };
  }

  const tier = environment.name as EnvironmentTier;
  const urlPattern = TIER_URLS[tier];

  if (!urlPattern.test(environment.url)) {
    errors.push(`URL "${environment.url}" does not match expected pattern for ${tier}`);
  }

  if (tier === 'production' && !environment.requiresApproval) {
    errors.push('Production environment must require approval');
  }

  const varResult = validateEnvironmentVariables(environment);
  if (!varResult.valid) {
    errors.push(...varResult.errors);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check that environments are properly isolated from each other.
 *
 * Ensures no two environments share DATABASE_URL, REDIS_URL, or base URL.
 *
 * @param environments - The list of environments to check.
 * @returns Isolation result with any violations found.
 */
export function checkEnvironmentIsolation(environments: Environment[]): EnvironmentIsolationResult {
  const violations: string[] = [];

  const getVarValue = (env: Environment, varName: string): string | undefined =>
    env.variables.find((v) => v.name === varName)?.value;

  // Check shared DATABASE_URL
  for (let i = 0; i < environments.length; i++) {
    for (let j = i + 1; j < environments.length; j++) {
      const dbA = getVarValue(environments[i], 'DATABASE_URL');
      const dbB = getVarValue(environments[j], 'DATABASE_URL');
      if (dbA && dbB && dbA === dbB) {
        violations.push(
          `Environments "${environments[i].name}" and "${environments[j].name}" share the same DATABASE_URL`,
        );
      }

      const redisA = getVarValue(environments[i], 'REDIS_URL');
      const redisB = getVarValue(environments[j], 'REDIS_URL');
      if (redisA && redisB && redisA === redisB) {
        violations.push(
          `Environments "${environments[i].name}" and "${environments[j].name}" share the same REDIS_URL`,
        );
      }

      if (environments[i].url === environments[j].url) {
        violations.push(
          `Environments "${environments[i].name}" and "${environments[j].name}" share the same URL`,
        );
      }
    }
  }

  return { isolated: violations.length === 0, violations };
}
