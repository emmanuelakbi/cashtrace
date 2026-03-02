/**
 * Property-based tests for Test Stage — Coverage Threshold Validation
 *
 * **Property 2: Test Coverage Requirement**
 * For any CI run, code coverage SHALL be at least 80% or the pipeline SHALL fail.
 *
 * **Validates: Requirements 1.3**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  COVERAGE_METRICS,
  MIN_COVERAGE_THRESHOLD,
  validateCoverageThreshold,
} from './testStage.js';
import type { CoverageMetric, CoverageReport } from './testStage.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a coverage percentage in [0, 100]. */
const percentageArb = fc.integer({ min: 0, max: 100 });

/** Generate a coverage metric name from the known set. */
const metricArb: fc.Arbitrary<CoverageMetric> = fc.constantFrom(...COVERAGE_METRICS);

/** Generate a single CoverageReport with a random metric and percentage. */
const coverageReportArb = fc
  .tuple(metricArb, percentageArb)
  .map(([metric, percentage]): CoverageReport => ({ metric, percentage }));

/** Generate a non-empty array of CoverageReports. */
const coverageReportsArb = fc.array(coverageReportArb, { minLength: 1, maxLength: 10 });

/**
 * Generate a set of reports where ALL metrics are at or above a given threshold.
 * Uses the default MIN_COVERAGE_THRESHOLD (80).
 */
const allPassingReportsArb = fc.array(
  fc
    .tuple(metricArb, fc.integer({ min: MIN_COVERAGE_THRESHOLD, max: 100 }))
    .map(([metric, percentage]): CoverageReport => ({ metric, percentage })),
  { minLength: 1, maxLength: 10 },
);

/**
 * Generate a set of reports where at least one metric is strictly below the threshold.
 * Produces 0+ passing reports followed by exactly one failing report, then 0+ more passing.
 */
const someFailingReportsArb = fc
  .tuple(
    fc.array(
      fc
        .tuple(metricArb, fc.integer({ min: MIN_COVERAGE_THRESHOLD, max: 100 }))
        .map(([metric, percentage]): CoverageReport => ({ metric, percentage })),
      { minLength: 0, maxLength: 4 },
    ),
    fc
      .tuple(metricArb, fc.integer({ min: 0, max: MIN_COVERAGE_THRESHOLD - 1 }))
      .map(([metric, percentage]): CoverageReport => ({ metric, percentage })),
    fc.array(
      fc
        .tuple(metricArb, fc.integer({ min: MIN_COVERAGE_THRESHOLD, max: 100 }))
        .map(([metric, percentage]): CoverageReport => ({ metric, percentage })),
      { minLength: 0, maxLength: 4 },
    ),
  )
  .map(([before, failing, after]) => [...before, failing, ...after]);

/** Generate a custom threshold in [0, 100]. */
const thresholdArb = fc.integer({ min: 0, max: 100 });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Test Coverage Requirement (Property 2)', () => {
  /**
   * **Validates: Requirements 1.3**
   * For any set of coverage reports where ALL metrics are >= 80%,
   * validateCoverageThreshold should return passed=true.
   */
  it('passes when all metrics meet or exceed the threshold', () => {
    fc.assert(
      fc.property(allPassingReportsArb, (reports) => {
        const result = validateCoverageThreshold(reports);
        expect(result.passed).toBe(true);
        expect(result.threshold).toBe(MIN_COVERAGE_THRESHOLD);
        for (const detail of result.details) {
          expect(detail.passed).toBe(true);
          expect(detail.actual).toBeGreaterThanOrEqual(MIN_COVERAGE_THRESHOLD);
          expect(detail.required).toBe(MIN_COVERAGE_THRESHOLD);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * For any set of coverage reports where ANY metric is < 80%,
   * validateCoverageThreshold should return passed=false.
   */
  it('fails when any metric is below the threshold', () => {
    fc.assert(
      fc.property(someFailingReportsArb, (reports) => {
        const result = validateCoverageThreshold(reports);
        expect(result.passed).toBe(false);
        const failingDetails = result.details.filter((d) => !d.passed);
        expect(failingDetails.length).toBeGreaterThanOrEqual(1);
        for (const detail of failingDetails) {
          expect(detail.actual).toBeLessThan(MIN_COVERAGE_THRESHOLD);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * The number of details in the result should always equal the number of input reports.
   */
  it('produces one detail entry per input report', () => {
    fc.assert(
      fc.property(coverageReportsArb, (reports) => {
        const result = validateCoverageThreshold(reports);
        expect(result.details).toHaveLength(reports.length);
        for (let i = 0; i < reports.length; i++) {
          expect(result.details[i].metric).toBe(reports[i].metric);
          expect(result.details[i].actual).toBe(reports[i].percentage);
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.3**
   * For any custom threshold T and coverage percentage P,
   * passed should be true iff P >= T.
   */
  it('respects custom threshold: passed iff percentage >= threshold', () => {
    fc.assert(
      fc.property(metricArb, percentageArb, thresholdArb, (metric, percentage, threshold) => {
        const reports: CoverageReport[] = [{ metric, percentage }];
        const result = validateCoverageThreshold(reports, threshold);

        if (percentage >= threshold) {
          expect(result.passed).toBe(true);
          expect(result.details[0].passed).toBe(true);
        } else {
          expect(result.passed).toBe(false);
          expect(result.details[0].passed).toBe(false);
        }

        expect(result.threshold).toBe(threshold);
        expect(result.details[0].required).toBe(threshold);
        expect(result.details[0].actual).toBe(percentage);
      }),
      { numRuns: 200 },
    );
  });
});
