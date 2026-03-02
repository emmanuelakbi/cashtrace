/**
 * Test stage validation for CI pipeline.
 *
 * Provides functions to validate test coverage thresholds and
 * property-based test configuration within the CI pipeline.
 *
 * @module deployment/testStage
 */

// ─── Coverage Threshold Constants ────────────────────────────────────────────

/** Minimum required code coverage percentage. */
export const MIN_COVERAGE_THRESHOLD = 80;

/** Coverage metric names that are enforced. */
export const COVERAGE_METRICS = ['lines', 'functions', 'branches', 'statements'] as const;

export type CoverageMetric = (typeof COVERAGE_METRICS)[number];

/** Minimum number of iterations for property-based tests. */
export const MIN_PROPERTY_TEST_ITERATIONS = 100;

// ─── Coverage Types ──────────────────────────────────────────────────────────

/** Coverage report for a single metric. */
export interface CoverageReport {
  /** Coverage metric name. */
  metric: CoverageMetric;
  /** Actual coverage percentage (0–100). */
  percentage: number;
}

/** Result of a coverage threshold validation. */
export interface CoverageValidationResult {
  /** Whether all coverage metrics meet the threshold. */
  passed: boolean;
  /** Threshold that was applied. */
  threshold: number;
  /** Per-metric results. */
  details: CoverageMetricResult[];
}

/** Validation result for a single coverage metric. */
export interface CoverageMetricResult {
  /** Coverage metric name. */
  metric: CoverageMetric;
  /** Actual coverage percentage. */
  actual: number;
  /** Required minimum percentage. */
  required: number;
  /** Whether this metric passed. */
  passed: boolean;
}

// ─── Property Test Types ─────────────────────────────────────────────────────

/** Configuration for property-based test execution. */
export interface PropertyTestConfig {
  /** Number of iterations to run. */
  numRuns: number;
  /** Optional seed for reproducibility. */
  seed?: number;
  /** Test file pattern (glob). */
  testPattern: string;
}

/** Result of property test configuration validation. */
export interface PropertyTestValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation Functions ────────────────────────────────────────────────────

/**
 * Validate that coverage metrics meet the minimum threshold.
 *
 * Each metric in the report is checked against the given threshold
 * (defaults to {@link MIN_COVERAGE_THRESHOLD}).
 */
export function validateCoverageThreshold(
  reports: CoverageReport[],
  threshold: number = MIN_COVERAGE_THRESHOLD,
): CoverageValidationResult {
  const details: CoverageMetricResult[] = reports.map((r) => ({
    metric: r.metric,
    actual: r.percentage,
    required: threshold,
    passed: r.percentage >= threshold,
  }));

  return {
    passed: details.every((d) => d.passed),
    threshold,
    details,
  };
}

/**
 * Validate property-based test configuration.
 *
 * Checks:
 * - `numRuns` is at least {@link MIN_PROPERTY_TEST_ITERATIONS}
 * - `testPattern` is non-empty
 * - `seed`, when provided, is a non-negative integer
 */
export function validatePropertyTestConfig(
  config: PropertyTestConfig,
): PropertyTestValidationResult {
  const errors: string[] = [];

  if (config.numRuns < MIN_PROPERTY_TEST_ITERATIONS) {
    errors.push(`numRuns must be at least ${MIN_PROPERTY_TEST_ITERATIONS}, got ${config.numRuns}`);
  }

  if (!config.testPattern || config.testPattern.trim() === '') {
    errors.push('testPattern must be a non-empty string');
  }

  if (config.seed !== undefined) {
    if (!Number.isInteger(config.seed) || config.seed < 0) {
      errors.push('seed must be a non-negative integer');
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether all required coverage metrics are present in the report.
 *
 * Returns the list of missing metric names.
 */
export function getMissingCoverageMetrics(reports: CoverageReport[]): CoverageMetric[] {
  const reported = new Set(reports.map((r) => r.metric));
  return COVERAGE_METRICS.filter((m) => !reported.has(m));
}
