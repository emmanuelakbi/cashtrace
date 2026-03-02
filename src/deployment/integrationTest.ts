/**
 * Integration test configuration validation and result evaluation.
 *
 * Provides functions to validate integration test configuration for staging
 * environments and to check whether integration test results meet the
 * requirements for production promotion.
 *
 * @module deployment/integrationTest
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for running integration tests against a staging environment. */
export interface IntegrationTestConfig {
  /** URL of the staging environment to test against. */
  stagingUrl: string;
  /** Maximum time in seconds to wait for the test suite to complete. */
  timeout: number;
  /** Glob patterns for integration test files. */
  testPatterns: string[];
  /** Maximum number of retry attempts for flaky tests. */
  retries: number;
}

/** Result of a single integration test. */
export interface IntegrationTestResult {
  /** Name of the test. */
  name: string;
  /** Whether the test passed. */
  passed: boolean;
  /** Duration in milliseconds. */
  durationMs: number;
  /** Error message if the test failed. */
  error?: string;
}

/** Aggregated results of an integration test run. */
export interface IntegrationTestRunResult {
  /** Total number of tests executed. */
  totalTests: number;
  /** Number of tests that passed. */
  passedTests: number;
  /** Number of tests that failed. */
  failedTests: number;
  /** Total duration in milliseconds. */
  totalDurationMs: number;
  /** Individual test results. */
  results: IntegrationTestResult[];
}

/** Result of validating an integration test configuration. */
export interface IntegrationTestConfigValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** List of validation errors (empty when valid). */
  errors: string[];
}

/** Result of checking whether integration test results meet requirements. */
export interface IntegrationTestRequirementResult {
  /** Whether all requirements are met. */
  passed: boolean;
  /** Reasons why requirements are not met (empty when passed). */
  failures: string[];
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Minimum allowed timeout in seconds. */
export const MIN_TIMEOUT_SECONDS = 30;

/** Maximum allowed timeout in seconds. */
export const MAX_TIMEOUT_SECONDS = 1800;

/** Maximum allowed retries. */
export const MAX_RETRIES = 5;

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate an integration test configuration.
 *
 * Checks:
 * - stagingUrl is a non-empty valid URL (http or https)
 * - timeout is within allowed range
 * - testPatterns has at least one non-empty pattern
 * - retries is non-negative and within max
 */
export function validateIntegrationTestConfig(
  config: IntegrationTestConfig,
): IntegrationTestConfigValidationResult {
  const errors: string[] = [];

  // Staging URL validation
  if (!config.stagingUrl || config.stagingUrl.trim() === '') {
    errors.push('stagingUrl must be a non-empty string');
  } else {
    try {
      const url = new URL(config.stagingUrl);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        errors.push('stagingUrl must use http or https protocol');
      }
    } catch {
      errors.push('stagingUrl must be a valid URL');
    }
  }

  // Timeout validation
  if (config.timeout < MIN_TIMEOUT_SECONDS) {
    errors.push(`timeout must be at least ${MIN_TIMEOUT_SECONDS} seconds`);
  } else if (config.timeout > MAX_TIMEOUT_SECONDS) {
    errors.push(`timeout must not exceed ${MAX_TIMEOUT_SECONDS} seconds`);
  }

  // Test patterns validation
  if (!config.testPatterns || config.testPatterns.length === 0) {
    errors.push('testPatterns must contain at least one pattern');
  } else {
    const hasNonEmpty = config.testPatterns.some((p) => p.trim() !== '');
    if (!hasNonEmpty) {
      errors.push('testPatterns must contain at least one non-empty pattern');
    }
  }

  // Retries validation
  if (config.retries < 0) {
    errors.push('retries must be non-negative');
  } else if (config.retries > MAX_RETRIES) {
    errors.push(`retries must not exceed ${MAX_RETRIES}`);
  }

  return { valid: errors.length === 0, errors };
}

// ─── Result Evaluation ───────────────────────────────────────────────────────

/**
 * Check if integration test results meet the requirements for production promotion.
 *
 * Requirements:
 * - At least one test must have been executed
 * - All tests must pass (zero failures)
 */
export function checkIntegrationTestResults(
  runResult: IntegrationTestRunResult,
): IntegrationTestRequirementResult {
  const failures: string[] = [];

  if (runResult.totalTests === 0) {
    failures.push('No integration tests were executed');
  }

  if (runResult.failedTests > 0) {
    failures.push(
      `${runResult.failedTests} integration test(s) failed out of ${runResult.totalTests}`,
    );
  }

  if (
    runResult.totalTests > 0 &&
    runResult.passedTests + runResult.failedTests !== runResult.totalTests
  ) {
    failures.push('Test counts are inconsistent: passed + failed does not equal total');
  }

  return { passed: failures.length === 0, failures };
}
