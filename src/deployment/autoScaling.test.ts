import { describe, expect, it } from 'vitest';

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
import { makeAutoScalingConfig } from './testHelpers.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeUtilization(overrides: Partial<ResourceUtilization> = {}): ResourceUtilization {
  return {
    cpuPercent: 50,
    memoryPercent: 50,
    timestamp: new Date(),
    ...overrides,
  };
}

// ─── validateAutoScalingConfig ───────────────────────────────────────────────

describe('validateAutoScalingConfig', () => {
  it('should accept a valid config', () => {
    const result = validateAutoScalingConfig(makeAutoScalingConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject minReplicas below floor', () => {
    const result = validateAutoScalingConfig(makeAutoScalingConfig({ minReplicas: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('minReplicas'));
  });

  it('should reject maxReplicas above ceiling', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ maxReplicas: MAX_REPLICAS_CEILING + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxReplicas'));
  });

  it('should reject maxReplicas less than minReplicas', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ minReplicas: 5, maxReplicas: 3 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxReplicas'));
  });

  it('should reject targetCPU below minimum', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ targetCPU: MIN_TARGET_PERCENT - 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('targetCPU'));
  });

  it('should reject targetCPU above maximum', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ targetCPU: MAX_TARGET_PERCENT + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('targetCPU'));
  });

  it('should reject targetMemory below minimum', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ targetMemory: MIN_TARGET_PERCENT - 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('targetMemory'));
  });

  it('should reject targetMemory above maximum', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ targetMemory: MAX_TARGET_PERCENT + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('targetMemory'));
  });

  it('should reject scaleDownDelay below minimum', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ scaleDownDelay: MIN_SCALE_DOWN_DELAY - 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('scaleDownDelay'));
  });

  it('should reject scaleDownDelay above maximum', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({ scaleDownDelay: MAX_SCALE_DOWN_DELAY + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('scaleDownDelay'));
  });

  it('should accept boundary values', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({
        minReplicas: MIN_REPLICAS_FLOOR,
        maxReplicas: MAX_REPLICAS_CEILING,
        targetCPU: MIN_TARGET_PERCENT,
        targetMemory: MAX_TARGET_PERCENT,
        scaleDownDelay: MIN_SCALE_DOWN_DELAY,
      }),
    );
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should collect multiple errors', () => {
    const result = validateAutoScalingConfig(
      makeAutoScalingConfig({
        minReplicas: 0,
        maxReplicas: 200,
        targetCPU: 5,
        targetMemory: 95,
        scaleDownDelay: 10,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── calculateScalingDecision ────────────────────────────────────────────────

describe('calculateScalingDecision', () => {
  const config = makeAutoScalingConfig({
    minReplicas: 2,
    maxReplicas: 10,
    targetCPU: 70,
    targetMemory: 80,
  });

  it('should scale up when CPU exceeds target', () => {
    const decision = calculateScalingDecision(config, 4, makeUtilization({ cpuPercent: 85 }));
    expect(decision.shouldScale).toBe(true);
    expect(decision.direction).toBe('up');
    expect(decision.targetReplicas).toBe(6); // 4 + ceil(4 * 0.5) = 6
  });

  it('should scale up when memory exceeds target', () => {
    const decision = calculateScalingDecision(config, 4, makeUtilization({ memoryPercent: 85 }));
    expect(decision.shouldScale).toBe(true);
    expect(decision.direction).toBe('up');
    expect(decision.targetReplicas).toBe(6);
  });

  it('should cap scale-up at maxReplicas', () => {
    const decision = calculateScalingDecision(config, 8, makeUtilization({ cpuPercent: 90 }));
    expect(decision.direction).toBe('up');
    expect(decision.targetReplicas).toBe(10); // min(10, 8 + ceil(4)) = 10
  });

  it('should scale down when both metrics below 50% of targets', () => {
    const decision = calculateScalingDecision(
      config,
      6,
      makeUtilization({ cpuPercent: 30, memoryPercent: 35 }),
    );
    expect(decision.shouldScale).toBe(true);
    expect(decision.direction).toBe('down');
    expect(decision.targetReplicas).toBe(5); // max(2, 6 - 1) = 5
  });

  it('should not scale below minReplicas', () => {
    const decision = calculateScalingDecision(
      config,
      2,
      makeUtilization({ cpuPercent: 10, memoryPercent: 10 }),
    );
    expect(decision.direction).toBe('down');
    expect(decision.targetReplicas).toBe(2); // max(2, 2 - 1) = 2
    expect(decision.shouldScale).toBe(false);
  });

  it('should return no change when utilisation is within range', () => {
    const decision = calculateScalingDecision(
      config,
      4,
      makeUtilization({ cpuPercent: 50, memoryPercent: 50 }),
    );
    expect(decision.shouldScale).toBe(false);
    expect(decision.direction).toBe('none');
    expect(decision.targetReplicas).toBe(4);
  });

  it('should not scale down when only one metric is low', () => {
    const decision = calculateScalingDecision(
      config,
      4,
      makeUtilization({ cpuPercent: 20, memoryPercent: 60 }),
    );
    expect(decision.shouldScale).toBe(false);
    expect(decision.direction).toBe('none');
  });

  it('should prefer scale-up when both thresholds are exceeded', () => {
    const decision = calculateScalingDecision(
      config,
      4,
      makeUtilization({ cpuPercent: 90, memoryPercent: 90 }),
    );
    expect(decision.direction).toBe('up');
  });
});

// ─── isScalingResponseWithinLimit ────────────────────────────────────────────

describe('isScalingResponseWithinLimit', () => {
  it('should return true when within limit', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date('2024-01-01T00:02:00Z'); // 120s
    expect(isScalingResponseWithinLimit(start, end)).toBe(true);
  });

  it('should return true at exactly the limit', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date(start.getTime() + MAX_SCALING_RESPONSE_SECONDS * 1000);
    expect(isScalingResponseWithinLimit(start, end)).toBe(true);
  });

  it('should return false when exceeding the limit', () => {
    const start = new Date('2024-01-01T00:00:00Z');
    const end = new Date(start.getTime() + MAX_SCALING_RESPONSE_SECONDS * 1000 + 1);
    expect(isScalingResponseWithinLimit(start, end)).toBe(false);
  });

  it('should return true for instant completion', () => {
    const now = new Date();
    expect(isScalingResponseWithinLimit(now, now)).toBe(true);
  });
});
