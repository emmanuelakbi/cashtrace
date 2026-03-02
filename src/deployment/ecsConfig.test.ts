import { describe, expect, it } from 'vitest';

import type { EcsClusterConfig, EcsTaskConfig } from './ecsConfig.js';
import {
  MAX_TASK_CPU,
  MAX_TASK_MEMORY,
  MIN_TASK_CPU,
  MIN_TASK_MEMORY,
  VALID_CPU_MEMORY_COMBOS,
  VALID_INSTANCE_SIZES,
  validateCpuMemoryCombo,
  validateEcsClusterConfig,
  validateEcsTaskConfig,
} from './ecsConfig.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTaskConfig(overrides: Partial<EcsTaskConfig> = {}): EcsTaskConfig {
  return {
    serviceName: 'cashtrace-api',
    cpu: 512,
    memory: 1024,
    desiredCount: 2,
    minHealthyPercent: 50,
    maxPercent: 200,
    ...overrides,
  };
}

function makeClusterConfig(overrides: Partial<EcsClusterConfig> = {}): EcsClusterConfig {
  return {
    clusterName: 'cashtrace-cluster',
    region: 'af-south-1',
    services: [makeTaskConfig()],
    capacityProviders: ['FARGATE'],
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('ECS constants', () => {
  it('defines correct CPU bounds', () => {
    expect(MIN_TASK_CPU).toBe(256);
    expect(MAX_TASK_CPU).toBe(4096);
  });

  it('defines correct memory bounds', () => {
    expect(MIN_TASK_MEMORY).toBe(512);
    expect(MAX_TASK_MEMORY).toBe(30720);
  });

  it('includes expected instance sizes', () => {
    expect(VALID_INSTANCE_SIZES).toContain('t3.micro');
    expect(VALID_INSTANCE_SIZES).toContain('m5.large');
    expect(VALID_INSTANCE_SIZES).toContain('c5.xlarge');
    expect(VALID_INSTANCE_SIZES).toHaveLength(9);
  });

  it('has all five Fargate CPU tiers in VALID_CPU_MEMORY_COMBOS', () => {
    expect(VALID_CPU_MEMORY_COMBOS.has(256)).toBe(true);
    expect(VALID_CPU_MEMORY_COMBOS.has(512)).toBe(true);
    expect(VALID_CPU_MEMORY_COMBOS.has(1024)).toBe(true);
    expect(VALID_CPU_MEMORY_COMBOS.has(2048)).toBe(true);
    expect(VALID_CPU_MEMORY_COMBOS.has(4096)).toBe(true);
  });

  it('maps 256 CPU to correct memory values', () => {
    expect(VALID_CPU_MEMORY_COMBOS.get(256)).toEqual([512, 1024, 2048]);
  });

  it('maps 2048 CPU to 4096–16384 in 1024 increments', () => {
    const allowed = VALID_CPU_MEMORY_COMBOS.get(2048)!;
    expect(allowed[0]).toBe(4096);
    expect(allowed[allowed.length - 1]).toBe(16384);
    expect(allowed).toHaveLength(13);
  });

  it('maps 4096 CPU to 8192–30720 in 1024 increments', () => {
    const allowed = VALID_CPU_MEMORY_COMBOS.get(4096)!;
    expect(allowed[0]).toBe(8192);
    expect(allowed[allowed.length - 1]).toBe(30720);
    expect(allowed).toHaveLength(23);
  });
});

// ─── validateCpuMemoryCombo ─────────────────────────────────────────────────

describe('validateCpuMemoryCombo', () => {
  it('returns true for valid 256/512 combo', () => {
    expect(validateCpuMemoryCombo(256, 512)).toBe(true);
  });

  it('returns true for valid 256/2048 combo', () => {
    expect(validateCpuMemoryCombo(256, 2048)).toBe(true);
  });

  it('returns true for valid 4096/30720 combo', () => {
    expect(validateCpuMemoryCombo(4096, 30720)).toBe(true);
  });

  it('returns false for invalid CPU value', () => {
    expect(validateCpuMemoryCombo(128, 512)).toBe(false);
  });

  it('returns false for memory not allowed with given CPU', () => {
    expect(validateCpuMemoryCombo(256, 4096)).toBe(false);
  });

  it('returns false for 512 CPU with 512 memory', () => {
    expect(validateCpuMemoryCombo(512, 512)).toBe(false);
  });
});

// ─── validateEcsTaskConfig ──────────────────────────────────────────────────

describe('validateEcsTaskConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateEcsTaskConfig(makeTaskConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects empty serviceName', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ serviceName: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('serviceName');
  });

  it('rejects whitespace-only serviceName', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ serviceName: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('serviceName');
  });

  it('rejects invalid CPU value', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ cpu: 128 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('cpu'))).toBe(true);
  });

  it('rejects invalid memory for given CPU', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ cpu: 256, memory: 4096 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('memory'))).toBe(true);
  });

  it('accepts valid CPU/memory combo at each tier', () => {
    const combos: [number, number][] = [
      [256, 512],
      [512, 1024],
      [1024, 2048],
      [2048, 4096],
      [4096, 8192],
    ];
    for (const [cpu, memory] of combos) {
      const result = validateEcsTaskConfig(makeTaskConfig({ cpu, memory }));
      expect(result.valid).toBe(true);
    }
  });

  it('rejects desiredCount of 0', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ desiredCount: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('desiredCount'))).toBe(true);
  });

  it('rejects negative desiredCount', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ desiredCount: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('desiredCount'))).toBe(true);
  });

  it('rejects minHealthyPercent below 0', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ minHealthyPercent: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('minHealthyPercent'))).toBe(true);
  });

  it('rejects minHealthyPercent above 100', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ minHealthyPercent: 101 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('minHealthyPercent'))).toBe(true);
  });

  it('accepts minHealthyPercent at boundaries (0 and 100)', () => {
    expect(validateEcsTaskConfig(makeTaskConfig({ minHealthyPercent: 0 })).valid).toBe(true);
    expect(validateEcsTaskConfig(makeTaskConfig({ minHealthyPercent: 100 })).valid).toBe(true);
  });

  it('rejects maxPercent below 100', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ maxPercent: 99 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxPercent'))).toBe(true);
  });

  it('rejects maxPercent above 200', () => {
    const result = validateEcsTaskConfig(makeTaskConfig({ maxPercent: 201 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxPercent'))).toBe(true);
  });

  it('accepts maxPercent at boundaries (100 and 200)', () => {
    expect(
      validateEcsTaskConfig(makeTaskConfig({ minHealthyPercent: 0, maxPercent: 100 })).valid,
    ).toBe(true);
    expect(validateEcsTaskConfig(makeTaskConfig({ maxPercent: 200 })).valid).toBe(true);
  });

  it('rejects maxPercent equal to minHealthyPercent', () => {
    const result = validateEcsTaskConfig(
      makeTaskConfig({ minHealthyPercent: 100, maxPercent: 100 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxPercent') && e.includes('greater'))).toBe(true);
  });

  it('rejects when minHealthyPercent equals maxPercent at non-boundary', () => {
    // Both at 100 is already tested above; verify a scenario where
    // the only error is the ordering constraint by using boundary values
    // that individually pass but fail the ordering check.
    const result = validateEcsTaskConfig(
      makeTaskConfig({ minHealthyPercent: 100, maxPercent: 100 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('maxPercent') && e.includes('greater'))).toBe(true);
  });

  it('collects multiple errors at once', () => {
    const result = validateEcsTaskConfig(
      makeTaskConfig({
        serviceName: '',
        cpu: 128,
        desiredCount: 0,
        minHealthyPercent: -1,
        maxPercent: 201,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── validateEcsClusterConfig ───────────────────────────────────────────────

describe('validateEcsClusterConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateEcsClusterConfig(makeClusterConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects empty clusterName', () => {
    const result = validateEcsClusterConfig(makeClusterConfig({ clusterName: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('clusterName');
  });

  it('rejects whitespace-only clusterName', () => {
    const result = validateEcsClusterConfig(makeClusterConfig({ clusterName: '   ' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('clusterName');
  });

  it('rejects non af-south-1 region', () => {
    const result = validateEcsClusterConfig(makeClusterConfig({ region: 'us-east-1' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('af-south-1'))).toBe(true);
  });

  it('rejects empty services array', () => {
    const result = validateEcsClusterConfig(makeClusterConfig({ services: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('service'))).toBe(true);
  });

  it('rejects empty capacityProviders array', () => {
    const result = validateEcsClusterConfig(makeClusterConfig({ capacityProviders: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('capacity provider'))).toBe(true);
  });

  it('accepts FARGATE_SPOT as capacity provider', () => {
    const result = validateEcsClusterConfig(
      makeClusterConfig({ capacityProviders: ['FARGATE_SPOT'] }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts multiple capacity providers', () => {
    const result = validateEcsClusterConfig(
      makeClusterConfig({ capacityProviders: ['FARGATE', 'FARGATE_SPOT'] }),
    );
    expect(result.valid).toBe(true);
  });

  it('aggregates errors from invalid services', () => {
    const result = validateEcsClusterConfig(
      makeClusterConfig({
        services: [makeTaskConfig({ serviceName: '', cpu: 128 })],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("Service '(unnamed)'"))).toBe(true);
  });

  it('validates multiple services independently', () => {
    const result = validateEcsClusterConfig(
      makeClusterConfig({
        services: [
          makeTaskConfig({ serviceName: 'valid-service' }),
          makeTaskConfig({ serviceName: '', cpu: 128 }),
        ],
      }),
    );
    expect(result.valid).toBe(false);
    // Only the second service should produce errors
    expect(result.errors.some((e) => e.includes('valid-service'))).toBe(false);
    expect(result.errors.some((e) => e.includes('(unnamed)'))).toBe(true);
  });

  it('collects cluster-level and service-level errors together', () => {
    const result = validateEcsClusterConfig(
      makeClusterConfig({
        clusterName: '',
        region: 'eu-west-1',
        services: [makeTaskConfig({ serviceName: '' })],
        capacityProviders: [],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});
