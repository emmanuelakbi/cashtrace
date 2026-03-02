/**
 * Property-based tests for health checks and zero-downtime deployments.
 *
 * Property 10: Zero-Downtime Deployment
 * Validates Requirement 5.4 — rolling deployments with zero downtime.
 *
 * @module deployment/healthCheck.property.test
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  evaluateHealthStatus,
  HEALTHY_STATUS_CODES,
  isHealthCheckPassing,
  isZeroDowntimeConfig,
  MAX_LATENCY_MS,
  validateHealthCheckConfig,
} from './healthCheck.js';
import type { HealthCheckConfig, RollingDeployConfig } from './healthCheck.js';
import { makeHealthCheckResult } from './testHelpers.js';

const NUM_RUNS = 200;

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid HealthCheckConfig. */
const validHealthCheckConfigArb = fc
  .record({
    intervalSeconds: fc.integer({ min: 2, max: 300 }),
    healthyThreshold: fc.integer({ min: 1, max: 10 }),
    unhealthyThreshold: fc.integer({ min: 1, max: 10 }),
  })
  .chain(({ intervalSeconds, healthyThreshold, unhealthyThreshold }) =>
    fc.record({
      path: fc.stringMatching(/^\/[a-z0-9/]{0,20}$/).filter((s) => s.length > 0),
      intervalSeconds: fc.constant(intervalSeconds),
      timeoutSeconds: fc.integer({ min: 1, max: intervalSeconds - 1 }),
      healthyThreshold: fc.constant(healthyThreshold),
      unhealthyThreshold: fc.constant(unhealthyThreshold),
    }),
  );

/** Generate a healthy HealthCheckResult. */
const healthyResultArb = fc.record({
  status: fc.constantFrom(...HEALTHY_STATUS_CODES),
  latency: fc.integer({ min: 0, max: MAX_LATENCY_MS }),
});

/** Generate an unhealthy HealthCheckResult (at least one failing condition). */
const unhealthyResultArb = fc.oneof(
  // Bad status code
  fc.record({
    status: fc
      .integer({ min: 100, max: 599 })
      .filter((s) => !(HEALTHY_STATUS_CODES as readonly number[]).includes(s)),
    latency: fc.integer({ min: 0, max: MAX_LATENCY_MS }),
    healthy: fc.boolean(),
  }),
  // Latency too high
  fc.record({
    status: fc.constantFrom(...HEALTHY_STATUS_CODES),
    latency: fc.integer({ min: MAX_LATENCY_MS + 1, max: MAX_LATENCY_MS * 2 }),
    healthy: fc.boolean(),
  }),
  // healthy flag false (with otherwise valid status/latency)
  fc.record({
    status: fc.constantFrom(...HEALTHY_STATUS_CODES),
    latency: fc.integer({ min: 0, max: MAX_LATENCY_MS }),
    healthy: fc.constant(false),
  }),
);

/** Generate a zero-downtime RollingDeployConfig. */
const zeroDowntimeConfigArb: fc.Arbitrary<RollingDeployConfig> = fc.record({
  maxUnavailable: fc.constant(0),
  maxSurge: fc.integer({ min: 1, max: 100 }),
  minReadySeconds: fc.integer({ min: 0, max: 600 }),
  progressDeadlineSeconds: fc.integer({ min: 1, max: 3600 }),
});

/** Generate a non-zero-downtime RollingDeployConfig. */
const nonZeroDowntimeConfigArb: fc.Arbitrary<RollingDeployConfig> = fc.record({
  maxUnavailable: fc.integer({ min: 1, max: 100 }),
  maxSurge: fc.integer({ min: 0, max: 100 }),
  minReadySeconds: fc.integer({ min: 0, max: 600 }),
  progressDeadlineSeconds: fc.integer({ min: 1, max: 3600 }),
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('healthCheck property tests', () => {
  /**
   * Property 1: Valid health check configs always pass validation.
   * Validates Requirement 5.3 — health check configuration correctness.
   */
  it('valid health check configs always pass validation', () => {
    fc.assert(
      fc.property(validHealthCheckConfigArb, (config: HealthCheckConfig) => {
        const result = validateHealthCheckConfig(config);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 2: Healthy results always pass isHealthCheckPassing.
   * Validates Requirement 5.3 — healthy status detection.
   */
  it('healthy results always pass isHealthCheckPassing', () => {
    fc.assert(
      fc.property(healthyResultArb, ({ status, latency }) => {
        const result = makeHealthCheckResult({ status, latency, healthy: true });
        expect(isHealthCheckPassing(result)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 3: Unhealthy results always fail isHealthCheckPassing.
   * Validates Requirement 5.3 — unhealthy status detection.
   */
  it('unhealthy results always fail isHealthCheckPassing', () => {
    fc.assert(
      fc.property(unhealthyResultArb, ({ status, latency, healthy }) => {
        const result = makeHealthCheckResult({
          status,
          latency,
          healthy: healthy ?? false,
        });
        expect(isHealthCheckPassing(result)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 4: Enough consecutive successes means healthy.
   * Validates Requirement 5.3 — threshold-based health evaluation.
   */
  it('enough consecutive successes means healthy', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 10 }),
        fc.integer({ min: 0, max: 20 }),
        (threshold, extra) => {
          const count = threshold + extra;
          const results = Array.from({ length: count }, () =>
            makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
          );
          const config: HealthCheckConfig = {
            path: '/api/health',
            intervalSeconds: 30,
            timeoutSeconds: 5,
            healthyThreshold: threshold,
            unhealthyThreshold: 3,
          };
          const status = evaluateHealthStatus(results, config);
          expect(status.healthy).toBe(true);
          expect(status.consecutiveSuccesses).toBeGreaterThanOrEqual(threshold);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 5: Zero-downtime config has maxUnavailable=0.
   * Validates Requirement 5.4 — zero-downtime deployment detection.
   */
  it('zero-downtime config has maxUnavailable=0', () => {
    fc.assert(
      fc.property(zeroDowntimeConfigArb, (config) => {
        expect(isZeroDowntimeConfig(config)).toBe(true);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  /**
   * Property 6: Non-zero maxUnavailable is not zero-downtime.
   * Validates Requirement 5.4 — non-zero-downtime detection.
   */
  it('non-zero maxUnavailable is not zero-downtime', () => {
    fc.assert(
      fc.property(nonZeroDowntimeConfigArb, (config) => {
        expect(isZeroDowntimeConfig(config)).toBe(false);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});
