/**
 * Container health check and rolling deployment validation.
 *
 * Provides configuration validation for health checks and rolling deployments,
 * health status evaluation from check results, and zero-downtime detection.
 *
 * Supports requirements 5.3 (health checks, automatic restart) and
 * 5.4 (rolling deployments, zero downtime).
 *
 * @module deployment/healthCheck
 */

import type { HealthCheckResult } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default health check endpoint path. */
export const DEFAULT_HEALTH_CHECK_PATH = '/api/health';

/** Default seconds between health checks. */
export const DEFAULT_HEALTH_CHECK_INTERVAL = 30;

/** Default seconds before a health check times out. */
export const DEFAULT_HEALTH_CHECK_TIMEOUT = 5;

/** Default consecutive successes required to be considered healthy. */
export const DEFAULT_HEALTHY_THRESHOLD = 3;

/** Default consecutive failures required to be considered unhealthy. */
export const DEFAULT_UNHEALTHY_THRESHOLD = 3;

/** Maximum acceptable response latency in milliseconds. */
export const MAX_LATENCY_MS = 5000;

/** HTTP status codes considered healthy. */
export const HEALTHY_STATUS_CODES = [200, 204] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for container health checks. */
export interface HealthCheckConfig {
  /** Health check endpoint path. */
  path: string;
  /** Seconds between checks. */
  intervalSeconds: number;
  /** Seconds before a check times out. */
  timeoutSeconds: number;
  /** Consecutive successes to be healthy. */
  healthyThreshold: number;
  /** Consecutive failures to be unhealthy. */
  unhealthyThreshold: number;
}

/** Result of validating a HealthCheckConfig. */
export interface HealthCheckConfigValidationResult {
  /** Whether the config is valid. */
  valid: boolean;
  /** Validation error messages. */
  errors: string[];
}

/** Configuration for rolling deployments. */
export interface RollingDeployConfig {
  /** Maximum percentage of instances unavailable during deploy. */
  maxUnavailable: number;
  /** Maximum percentage of extra instances during deploy. */
  maxSurge: number;
  /** Minimum seconds an instance must be ready before proceeding. */
  minReadySeconds: number;
  /** Maximum seconds for the deployment to make progress. */
  progressDeadlineSeconds: number;
}

/** Result of validating a RollingDeployConfig. */
export interface RollingDeployValidationResult {
  /** Whether the config is valid. */
  valid: boolean;
  /** Validation error messages. */
  errors: string[];
}

/** Aggregated health status derived from check results. */
export interface HealthStatus {
  /** Whether the target is considered healthy. */
  healthy: boolean;
  /** Number of consecutive successful checks from the most recent. */
  consecutiveSuccesses: number;
  /** Number of consecutive failed checks from the most recent. */
  consecutiveFailures: number;
  /** The most recent health check result, if any. */
  lastCheck?: HealthCheckResult;
}

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Validate a health check configuration.
 *
 * Rules:
 * - path must be non-empty and start with `/`
 * - intervalSeconds must be > 0 and <= 300
 * - timeoutSeconds must be > 0 and < intervalSeconds
 * - healthyThreshold must be >= 1 and <= 10
 * - unhealthyThreshold must be >= 1 and <= 10
 */
export function validateHealthCheckConfig(
  config: HealthCheckConfig,
): HealthCheckConfigValidationResult {
  const errors: string[] = [];

  if (!config.path || !config.path.startsWith('/')) {
    errors.push('path must be non-empty and start with /');
  }

  if (config.intervalSeconds <= 0 || config.intervalSeconds > 300) {
    errors.push('intervalSeconds must be > 0 and <= 300');
  }

  if (config.timeoutSeconds <= 0 || config.timeoutSeconds >= config.intervalSeconds) {
    errors.push('timeoutSeconds must be > 0 and < intervalSeconds');
  }

  if (config.healthyThreshold < 1 || config.healthyThreshold > 10) {
    errors.push('healthyThreshold must be >= 1 and <= 10');
  }

  if (config.unhealthyThreshold < 1 || config.unhealthyThreshold > 10) {
    errors.push('unhealthyThreshold must be >= 1 and <= 10');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Determine whether a single health check result is passing.
 *
 * A check passes when:
 * - status is in HEALTHY_STATUS_CODES
 * - latency is <= MAX_LATENCY_MS
 * - healthy flag is true
 */
export function isHealthCheckPassing(result: HealthCheckResult): boolean {
  const validStatus = (HEALTHY_STATUS_CODES as readonly number[]).includes(result.status);
  return validStatus && result.latency <= MAX_LATENCY_MS && result.healthy;
}

/**
 * Evaluate aggregated health status from an ordered list of check results.
 *
 * Examines the most recent results (up to unhealthyThreshold count),
 * counts consecutive successes/failures from the end, and determines
 * overall health based on the healthyThreshold.
 */
export function evaluateHealthStatus(
  results: HealthCheckResult[],
  config: HealthCheckConfig,
): HealthStatus {
  if (results.length === 0) {
    return { healthy: false, consecutiveSuccesses: 0, consecutiveFailures: 0 };
  }

  const lastCheck = results[results.length - 1];
  let consecutiveSuccesses = 0;
  let consecutiveFailures = 0;

  // Walk backwards from the most recent result
  for (let i = results.length - 1; i >= 0; i--) {
    const passing = isHealthCheckPassing(results[i]);
    if (passing) {
      if (consecutiveFailures > 0) break;
      consecutiveSuccesses++;
    } else {
      if (consecutiveSuccesses > 0) break;
      consecutiveFailures++;
    }
  }

  return {
    healthy: consecutiveSuccesses >= config.healthyThreshold,
    consecutiveSuccesses,
    consecutiveFailures,
    lastCheck,
  };
}

/**
 * Validate a rolling deployment configuration.
 *
 * Rules:
 * - maxUnavailable must be >= 0 and <= 100 (percentage)
 * - maxSurge must be >= 0 and <= 100
 * - maxUnavailable + maxSurge must be > 0
 * - minReadySeconds must be >= 0 and <= 600
 * - progressDeadlineSeconds must be > 0 and <= 3600
 */
export function validateRollingDeployConfig(
  config: RollingDeployConfig,
): RollingDeployValidationResult {
  const errors: string[] = [];

  if (config.maxUnavailable < 0 || config.maxUnavailable > 100) {
    errors.push('maxUnavailable must be >= 0 and <= 100');
  }

  if (config.maxSurge < 0 || config.maxSurge > 100) {
    errors.push('maxSurge must be >= 0 and <= 100');
  }

  if (config.maxUnavailable + config.maxSurge <= 0) {
    errors.push('maxUnavailable + maxSurge must be > 0');
  }

  if (config.minReadySeconds < 0 || config.minReadySeconds > 600) {
    errors.push('minReadySeconds must be >= 0 and <= 600');
  }

  if (config.progressDeadlineSeconds <= 0 || config.progressDeadlineSeconds > 3600) {
    errors.push('progressDeadlineSeconds must be > 0 and <= 3600');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether a rolling deploy config guarantees zero downtime.
 *
 * Returns true when maxUnavailable is 0, meaning no instances go down
 * during the deployment.
 */
export function isZeroDowntimeConfig(rollingConfig: RollingDeployConfig): boolean {
  return rollingConfig.maxUnavailable === 0;
}
