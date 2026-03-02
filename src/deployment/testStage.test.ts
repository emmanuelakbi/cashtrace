import { describe, expect, it } from 'vitest';

import {
  COVERAGE_METRICS,
  getMissingCoverageMetrics,
  MIN_COVERAGE_THRESHOLD,
  MIN_PROPERTY_TEST_ITERATIONS,
  validateCoverageThreshold,
  validatePropertyTestConfig,
} from './testStage.js';
import type { CoverageReport, PropertyTestConfig } from './testStage.js';

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('should set minimum coverage threshold to 80', () => {
    expect(MIN_COVERAGE_THRESHOLD).toBe(80);
  });

  it('should set minimum property test iterations to 100', () => {
    expect(MIN_PROPERTY_TEST_ITERATIONS).toBe(100);
  });

  it('should include all four coverage metrics', () => {
    expect(COVERAGE_METRICS).toEqual(['lines', 'functions', 'branches', 'statements']);
  });
});

// ─── validateCoverageThreshold ───────────────────────────────────────────────

describe('validateCoverageThreshold', () => {
  const passingReports: CoverageReport[] = [
    { metric: 'lines', percentage: 90 },
    { metric: 'functions', percentage: 85 },
    { metric: 'branches', percentage: 82 },
    { metric: 'statements', percentage: 88 },
  ];

  it('should pass when all metrics meet the threshold', () => {
    const result = validateCoverageThreshold(passingReports);
    expect(result.passed).toBe(true);
    expect(result.threshold).toBe(MIN_COVERAGE_THRESHOLD);
    expect(result.details).toHaveLength(4);
    expect(result.details.every((d) => d.passed)).toBe(true);
  });

  it('should fail when any metric is below the threshold', () => {
    const reports: CoverageReport[] = [
      { metric: 'lines', percentage: 90 },
      { metric: 'functions', percentage: 70 },
      { metric: 'branches', percentage: 85 },
      { metric: 'statements', percentage: 88 },
    ];
    const result = validateCoverageThreshold(reports);
    expect(result.passed).toBe(false);
    const failing = result.details.find((d) => d.metric === 'functions');
    expect(failing?.passed).toBe(false);
    expect(failing?.actual).toBe(70);
    expect(failing?.required).toBe(80);
  });

  it('should pass when metric is exactly at threshold', () => {
    const reports: CoverageReport[] = [{ metric: 'lines', percentage: 80 }];
    const result = validateCoverageThreshold(reports);
    expect(result.passed).toBe(true);
  });

  it('should use custom threshold when provided', () => {
    const reports: CoverageReport[] = [{ metric: 'lines', percentage: 85 }];
    const result = validateCoverageThreshold(reports, 90);
    expect(result.passed).toBe(false);
    expect(result.threshold).toBe(90);
    expect(result.details[0].required).toBe(90);
  });

  it('should handle empty reports array', () => {
    const result = validateCoverageThreshold([]);
    expect(result.passed).toBe(true);
    expect(result.details).toHaveLength(0);
  });

  it('should fail all metrics when coverage is zero', () => {
    const reports: CoverageReport[] = COVERAGE_METRICS.map((metric) => ({
      metric,
      percentage: 0,
    }));
    const result = validateCoverageThreshold(reports);
    expect(result.passed).toBe(false);
    expect(result.details.every((d) => !d.passed)).toBe(true);
  });
});

// ─── validatePropertyTestConfig ──────────────────────────────────────────────

describe('validatePropertyTestConfig', () => {
  const validConfig: PropertyTestConfig = {
    numRuns: 100,
    testPattern: '\\.property\\.test\\.ts$',
  };

  it('should return valid for correct configuration', () => {
    const result = validatePropertyTestConfig(validConfig);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should reject numRuns below minimum', () => {
    const config: PropertyTestConfig = { ...validConfig, numRuns: 50 };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('numRuns'))).toBe(true);
  });

  it('should accept numRuns exactly at minimum', () => {
    const config: PropertyTestConfig = { ...validConfig, numRuns: 100 };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should reject empty testPattern', () => {
    const config: PropertyTestConfig = { ...validConfig, testPattern: '' };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('testPattern'))).toBe(true);
  });

  it('should reject whitespace-only testPattern', () => {
    const config: PropertyTestConfig = { ...validConfig, testPattern: '   ' };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(false);
  });

  it('should accept valid seed', () => {
    const config: PropertyTestConfig = { ...validConfig, seed: 42 };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(true);
  });

  it('should reject negative seed', () => {
    const config: PropertyTestConfig = { ...validConfig, seed: -1 };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('seed'))).toBe(true);
  });

  it('should reject non-integer seed', () => {
    const config: PropertyTestConfig = { ...validConfig, seed: 3.14 };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('seed'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const config: PropertyTestConfig = {
      numRuns: 10,
      testPattern: '',
      seed: -5,
    };
    const result = validatePropertyTestConfig(config);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBe(3);
  });
});

// ─── getMissingCoverageMetrics ───────────────────────────────────────────────

describe('getMissingCoverageMetrics', () => {
  it('should return empty array when all metrics are present', () => {
    const reports: CoverageReport[] = COVERAGE_METRICS.map((metric) => ({
      metric,
      percentage: 90,
    }));
    expect(getMissingCoverageMetrics(reports)).toEqual([]);
  });

  it('should return missing metrics', () => {
    const reports: CoverageReport[] = [
      { metric: 'lines', percentage: 90 },
      { metric: 'statements', percentage: 85 },
    ];
    const missing = getMissingCoverageMetrics(reports);
    expect(missing).toContain('functions');
    expect(missing).toContain('branches');
    expect(missing).not.toContain('lines');
    expect(missing).not.toContain('statements');
  });

  it('should return all metrics when reports are empty', () => {
    expect(getMissingCoverageMetrics([])).toEqual([...COVERAGE_METRICS]);
  });
});
