/**
 * Property-based tests for auto-scaling configuration validation and scaling decisions.
 *
 * Property 9: Auto-Scaling Response — Validates Requirement 5.2.
 *
 * @module deployment/autoScaling.property.test
 */

import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import {
  calculateScalingDecision,
  isScalingResponseWithinLimit,
  MAX_REPLICAS_CEILING,
  MAX_SCALE_DOWN_DELAY,
  MAX_SCALING_RESPONSE_SECONDS,
  MAX_TARGET_PERCENT,
  MIN_REPLICAS_FLOOR,
  MIN_SCALE_DOWN_DELAY,
  MIN_TARGET_PERCENT,
  validateAutoScalingConfig,
} from './autoScaling.js';
import type { ResourceUtilization } from './autoScaling.js';
import type { AutoScalingConfig } from './types.js';
import { makeAutoScalingConfig } from './testHelpers.js';

// ─── Arbitraries ─────────────────────────────────────────────────────────────

/** Generate a valid AutoScalingConfig with all values within bounds. */
const validConfigArb: fc.Arbitrary<AutoScalingConfig> = fc
  .record({
    minReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    maxReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    targetCPU: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    targetMemory: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    scaleDownDelay: fc.integer({ min: MIN_SCALE_DOWN_DELAY, max: MAX_SCALE_DOWN_DELAY }),
  })
  .filter((c) => c.maxReplicas >= c.minReplicas);

/**
 * Generate an invalid AutoScalingConfig with at least one value out of bounds.
 * We pick one of six possible violations at random.
 */
const invalidConfigArb: fc.Arbitrary<AutoScalingConfig> = fc.oneof(
  // minReplicas below floor
  fc.record({
    minReplicas: fc.integer({ min: -100, max: MIN_REPLICAS_FLOOR - 1 }),
    maxReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    targetCPU: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    targetMemory: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    scaleDownDelay: fc.integer({ min: MIN_SCALE_DOWN_DELAY, max: MAX_SCALE_DOWN_DELAY }),
  }),
  // maxReplicas above ceiling
  fc.record({
    minReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    maxReplicas: fc.integer({ min: MAX_REPLICAS_CEILING + 1, max: 500 }),
    targetCPU: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    targetMemory: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    scaleDownDelay: fc.integer({ min: MIN_SCALE_DOWN_DELAY, max: MAX_SCALE_DOWN_DELAY }),
  }),
  // maxReplicas < minReplicas
  fc
    .record({
      minReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR + 1, max: MAX_REPLICAS_CEILING }),
      maxReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING - 1 }),
      targetCPU: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
      targetMemory: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
      scaleDownDelay: fc.integer({ min: MIN_SCALE_DOWN_DELAY, max: MAX_SCALE_DOWN_DELAY }),
    })
    .filter((c) => c.maxReplicas < c.minReplicas),
  // targetCPU out of range
  fc.record({
    minReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    maxReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    targetCPU: fc.oneof(
      fc.integer({ min: -100, max: MIN_TARGET_PERCENT - 1 }),
      fc.integer({ min: MAX_TARGET_PERCENT + 1, max: 200 }),
    ),
    targetMemory: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    scaleDownDelay: fc.integer({ min: MIN_SCALE_DOWN_DELAY, max: MAX_SCALE_DOWN_DELAY }),
  }),
  // targetMemory out of range
  fc.record({
    minReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    maxReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    targetCPU: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    targetMemory: fc.oneof(
      fc.integer({ min: -100, max: MIN_TARGET_PERCENT - 1 }),
      fc.integer({ min: MAX_TARGET_PERCENT + 1, max: 200 }),
    ),
    scaleDownDelay: fc.integer({ min: MIN_SCALE_DOWN_DELAY, max: MAX_SCALE_DOWN_DELAY }),
  }),
  // scaleDownDelay out of range
  fc.record({
    minReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    maxReplicas: fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
    targetCPU: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    targetMemory: fc.integer({ min: MIN_TARGET_PERCENT, max: MAX_TARGET_PERCENT }),
    scaleDownDelay: fc.oneof(
      fc.integer({ min: 0, max: MIN_SCALE_DOWN_DELAY - 1 }),
      fc.integer({ min: MAX_SCALE_DOWN_DELAY + 1, max: 10000 }),
    ),
  }),
);

/** Generate a ResourceUtilization snapshot. */
const utilizationArb = (
  cpuRange: { min: number; max: number },
  memRange: { min: number; max: number },
): fc.Arbitrary<ResourceUtilization> =>
  fc.record({
    cpuPercent: fc.integer(cpuRange),
    memoryPercent: fc.integer(memRange),
    timestamp: fc.date(),
  });

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('autoScaling property tests', () => {
  /**
   * Property 1: Valid configs always pass validation.
   * Validates Requirement 5.2 — auto-scaling configuration correctness.
   */
  it('valid configs always pass validation', () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const result = validateAutoScalingConfig(config);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 2: Invalid configs always fail validation.
   * Validates Requirement 5.2 — auto-scaling configuration correctness.
   */
  it('invalid configs always fail validation', () => {
    fc.assert(
      fc.property(invalidConfigArb, (config) => {
        const result = validateAutoScalingConfig(config);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3: Scale-up when utilization exceeds targets.
   * Validates Requirement 5.2 — scaling responds to high resource usage.
   */
  it('scales up when utilization exceeds targets', () => {
    fc.assert(
      fc.property(
        validConfigArb,
        fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
        fc.record({
          cpuPercent: fc.integer({ min: 0, max: 100 }),
          memoryPercent: fc.integer({ min: 0, max: 100 }),
          timestamp: fc.date(),
        }),
        (config, rawReplicas, utilization) => {
          const currentReplicas = Math.max(
            config.minReplicas,
            Math.min(config.maxReplicas, rawReplicas),
          );
          // Ensure at least one metric exceeds its target
          fc.pre(
            utilization.cpuPercent > config.targetCPU ||
              utilization.memoryPercent > config.targetMemory,
          );

          const decision = calculateScalingDecision(config, currentReplicas, utilization);
          expect(decision.direction).toBe('up');
          expect(decision.targetReplicas).toBeGreaterThanOrEqual(currentReplicas);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 4: Scale-down when utilization is below 50% of targets.
   * Validates Requirement 5.2 — scaling responds to low resource usage.
   */
  it('scales down when utilization is below 50% of targets', () => {
    fc.assert(
      fc.property(
        validConfigArb,
        fc.integer({ min: MIN_REPLICAS_FLOOR, max: MAX_REPLICAS_CEILING }),
        fc.record({
          cpuPercent: fc.integer({ min: 0, max: 100 }),
          memoryPercent: fc.integer({ min: 0, max: 100 }),
          timestamp: fc.date(),
        }),
        (config, rawReplicas, utilization) => {
          const currentReplicas = Math.max(
            config.minReplicas,
            Math.min(config.maxReplicas, rawReplicas),
          );
          // Ensure both metrics are below 50% of their targets
          fc.pre(
            utilization.cpuPercent < config.targetCPU * 0.5 &&
              utilization.memoryPercent < config.targetMemory * 0.5,
          );

          const decision = calculateScalingDecision(config, currentReplicas, utilization);
          expect(decision.direction).toBe('down');
          expect(decision.targetReplicas).toBeLessThanOrEqual(currentReplicas);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 5: Target replicas always within bounds.
   * Validates Requirement 5.2 — scaling decisions respect configured limits.
   * currentReplicas is constrained to [minReplicas, maxReplicas] since the
   * orchestrator would never supply an out-of-range value.
   */
  it('target replicas always within config bounds', () => {
    fc.assert(
      fc.property(
        validConfigArb.chain((config) =>
          fc.tuple(
            fc.constant(config),
            fc.integer({ min: config.minReplicas, max: config.maxReplicas }),
            fc.record({
              cpuPercent: fc.integer({ min: 0, max: 100 }),
              memoryPercent: fc.integer({ min: 0, max: 100 }),
              timestamp: fc.date(),
            }),
          ),
        ),
        ([config, currentReplicas, utilization]) => {
          const decision = calculateScalingDecision(config, currentReplicas, utilization);
          expect(decision.targetReplicas).toBeGreaterThanOrEqual(config.minReplicas);
          expect(decision.targetReplicas).toBeLessThanOrEqual(config.maxReplicas);
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * Property 6: Scaling response within limit returns true.
   * Validates Requirement 5.2 — scaling response time constraint (≤ 180s).
   */
  it('scaling response within limit returns true', () => {
    fc.assert(
      fc.property(
        fc.date({ min: new Date('2020-01-01'), max: new Date('2030-01-01') }),
        fc.integer({ min: 0, max: MAX_SCALING_RESPONSE_SECONDS }),
        (start, elapsedSeconds) => {
          const end = new Date(start.getTime() + elapsedSeconds * 1000);
          expect(isScalingResponseWithinLimit(start, end)).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
