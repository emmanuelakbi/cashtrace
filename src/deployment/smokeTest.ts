/**
 * Smoke test validation module.
 *
 * Pure functions for validating smoke test configurations and evaluating
 * post-deployment smoke test results.
 *
 * @module deployment/smokeTest
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for a smoke test suite. */
export interface SmokeTestConfig {
  /** Base URL of the deployment to test (must start with https://). */
  baseUrl: string;
  /** Endpoints to test. */
  endpoints: SmokeTestEndpoint[];
  /** Overall timeout in seconds. */
  timeoutSeconds: number;
  /** Number of retries per endpoint on failure. */
  retries: number;
}

/** A single endpoint to smoke test. */
export interface SmokeTestEndpoint {
  /** URL path (e.g. /api/health). */
  path: string;
  /** HTTP method (GET, POST, etc.). */
  method: string;
  /** Expected HTTP status code. */
  expectedStatus: number;
  /** Maximum acceptable latency in milliseconds. */
  maxLatencyMs: number;
}

/** Result of a single smoke test endpoint check. */
export interface SmokeTestResult {
  /** Endpoint path that was tested. */
  endpoint: string;
  /** HTTP status code returned. */
  status: number;
  /** Response latency in milliseconds. */
  latencyMs: number;
  /** Whether this individual test passed. */
  passed: boolean;
}

/** Validation result for a smoke test configuration. */
export interface SmokeTestConfigValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation error messages (empty when valid). */
  errors: string[];
}

/** Aggregated result of a smoke test suite run. */
export interface SmokeTestSuiteResult {
  /** Whether all tests passed. */
  allPassed: boolean;
  /** Individual test results. */
  results: SmokeTestResult[];
  /** Number of failed tests. */
  failedCount: number;
}
// ─── Constants ───────────────────────────────────────────────────────────────

/** Default timeout for the entire smoke test suite in seconds. */
export const DEFAULT_TIMEOUT_SECONDS = 30;

/** Default number of retries per endpoint. */
export const DEFAULT_RETRIES = 3;

/** Maximum acceptable latency for any endpoint in milliseconds. */
export const MAX_LATENCY_MS = 5000;

/** Endpoints that must be present in every smoke test configuration. */
export const REQUIRED_ENDPOINTS: readonly string[] = ['/api/health', '/api/auth/status'];

/** Valid HTTP methods for smoke test endpoints. */
const VALID_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Validates a smoke test configuration.
 *
 * Checks that:
 * - baseUrl starts with `https://`
 * - endpoints array is non-empty
 * - timeoutSeconds is greater than 0
 * - retries is >= 0
 * - each endpoint has a valid HTTP method and a positive expectedStatus
 *
 * @param config - The smoke test configuration to validate.
 * @returns Validation result with any errors found.
 */
export function validateSmokeTestConfig(config: SmokeTestConfig): SmokeTestConfigValidationResult {
  const errors: string[] = [];

  if (!config.baseUrl.startsWith('https://')) {
    errors.push('baseUrl must start with https://');
  }

  if (config.endpoints.length === 0) {
    errors.push('endpoints must not be empty');
  }

  if (config.timeoutSeconds <= 0) {
    errors.push('timeoutSeconds must be greater than 0');
  }

  if (config.retries < 0) {
    errors.push('retries must be >= 0');
  }

  for (const endpoint of config.endpoints) {
    const upperMethod = endpoint.method.toUpperCase();
    if (!VALID_METHODS.includes(upperMethod as (typeof VALID_METHODS)[number])) {
      errors.push(`endpoint ${endpoint.path}: invalid method '${endpoint.method}'`);
    }

    if (endpoint.expectedStatus < 100 || endpoint.expectedStatus > 599) {
      errors.push(
        `endpoint ${endpoint.path}: expectedStatus must be between 100 and 599, got ${endpoint.expectedStatus}`,
      );
    }

    if (endpoint.maxLatencyMs <= 0) {
      errors.push(`endpoint ${endpoint.path}: maxLatencyMs must be greater than 0`);
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Evaluates an array of smoke test results into an aggregated suite result.
 *
 * Counts failures and determines whether the entire suite passed.
 *
 * @param results - Individual smoke test results to aggregate.
 * @returns Aggregated suite result.
 */
export function evaluateSmokeTestResults(results: SmokeTestResult[]): SmokeTestSuiteResult {
  const failedCount = results.filter((r) => !r.passed).length;

  return {
    allPassed: failedCount === 0,
    results,
    failedCount,
  };
}

/**
 * Checks whether the given endpoints cover all required smoke test paths.
 *
 * @param endpoints - The endpoints to check.
 * @returns `true` if every path in {@link REQUIRED_ENDPOINTS} is present.
 */
export function hasRequiredEndpoints(endpoints: SmokeTestEndpoint[]): boolean {
  const paths = new Set(endpoints.map((e) => e.path));
  return REQUIRED_ENDPOINTS.every((required) => paths.has(required));
}
