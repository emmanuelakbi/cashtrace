import { describe, expect, it } from 'vitest';

import {
  DEFAULT_HEALTH_CHECK_INTERVAL,
  DEFAULT_HEALTH_CHECK_PATH,
  DEFAULT_HEALTH_CHECK_TIMEOUT,
  DEFAULT_HEALTHY_THRESHOLD,
  DEFAULT_UNHEALTHY_THRESHOLD,
  evaluateHealthStatus,
  HEALTHY_STATUS_CODES,
  isHealthCheckPassing,
  isZeroDowntimeConfig,
  MAX_LATENCY_MS,
  validateHealthCheckConfig,
  validateRollingDeployConfig,
} from './healthCheck.js';
import type { HealthCheckConfig, HealthStatus, RollingDeployConfig } from './healthCheck.js';
import { makeHealthCheckResult } from './testHelpers.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeHealthCheckConfig(overrides: Partial<HealthCheckConfig> = {}): HealthCheckConfig {
  return {
    path: DEFAULT_HEALTH_CHECK_PATH,
    intervalSeconds: DEFAULT_HEALTH_CHECK_INTERVAL,
    timeoutSeconds: DEFAULT_HEALTH_CHECK_TIMEOUT,
    healthyThreshold: DEFAULT_HEALTHY_THRESHOLD,
    unhealthyThreshold: DEFAULT_UNHEALTHY_THRESHOLD,
    ...overrides,
  };
}

function makeRollingDeployConfig(
  overrides: Partial<RollingDeployConfig> = {},
): RollingDeployConfig {
  return {
    maxUnavailable: 25,
    maxSurge: 25,
    minReadySeconds: 10,
    progressDeadlineSeconds: 600,
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_HEALTH_CHECK_PATH).toBe('/api/health');
    expect(DEFAULT_HEALTH_CHECK_INTERVAL).toBe(30);
    expect(DEFAULT_HEALTH_CHECK_TIMEOUT).toBe(5);
    expect(DEFAULT_HEALTHY_THRESHOLD).toBe(3);
    expect(DEFAULT_UNHEALTHY_THRESHOLD).toBe(3);
    expect(MAX_LATENCY_MS).toBe(5000);
    expect(HEALTHY_STATUS_CODES).toEqual([200, 204]);
  });
});

// ─── validateHealthCheckConfig ───────────────────────────────────────────────

describe('validateHealthCheckConfig', () => {
  it('should accept a valid config', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject empty path', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ path: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('path'));
  });

  it('should reject path not starting with /', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ path: 'health' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('path'));
  });

  it('should accept path starting with /', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ path: '/health' }));
    expect(result.valid).toBe(true);
  });

  it('should reject intervalSeconds <= 0', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ intervalSeconds: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('intervalSeconds'));
  });

  it('should reject intervalSeconds > 300', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ intervalSeconds: 301 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('intervalSeconds'));
  });

  it('should accept intervalSeconds at boundary 300', () => {
    const result = validateHealthCheckConfig(
      makeHealthCheckConfig({ intervalSeconds: 300, timeoutSeconds: 299 }),
    );
    expect(result.valid).toBe(true);
  });

  it('should reject timeoutSeconds <= 0', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ timeoutSeconds: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('timeoutSeconds'));
  });

  it('should reject timeoutSeconds >= intervalSeconds', () => {
    const result = validateHealthCheckConfig(
      makeHealthCheckConfig({ intervalSeconds: 30, timeoutSeconds: 30 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('timeoutSeconds'));
  });

  it('should reject timeoutSeconds greater than intervalSeconds', () => {
    const result = validateHealthCheckConfig(
      makeHealthCheckConfig({ intervalSeconds: 10, timeoutSeconds: 15 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('timeoutSeconds'));
  });

  it('should reject healthyThreshold < 1', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ healthyThreshold: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('healthyThreshold'));
  });

  it('should reject healthyThreshold > 10', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ healthyThreshold: 11 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('healthyThreshold'));
  });

  it('should accept healthyThreshold at boundaries 1 and 10', () => {
    expect(validateHealthCheckConfig(makeHealthCheckConfig({ healthyThreshold: 1 })).valid).toBe(
      true,
    );
    expect(validateHealthCheckConfig(makeHealthCheckConfig({ healthyThreshold: 10 })).valid).toBe(
      true,
    );
  });

  it('should reject unhealthyThreshold < 1', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ unhealthyThreshold: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('unhealthyThreshold'));
  });

  it('should reject unhealthyThreshold > 10', () => {
    const result = validateHealthCheckConfig(makeHealthCheckConfig({ unhealthyThreshold: 11 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('unhealthyThreshold'));
  });

  it('should collect multiple errors', () => {
    const result = validateHealthCheckConfig(
      makeHealthCheckConfig({
        path: '',
        intervalSeconds: 0,
        timeoutSeconds: 0,
        healthyThreshold: 0,
        unhealthyThreshold: 0,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── isHealthCheckPassing ────────────────────────────────────────────────────

describe('isHealthCheckPassing', () => {
  it('should return true for a healthy result with status 200', () => {
    const result = makeHealthCheckResult({ status: 200, latency: 100, healthy: true });
    expect(isHealthCheckPassing(result)).toBe(true);
  });

  it('should return true for a healthy result with status 204', () => {
    const result = makeHealthCheckResult({ status: 204, latency: 100, healthy: true });
    expect(isHealthCheckPassing(result)).toBe(true);
  });

  it('should return false for an unhealthy status code', () => {
    const result = makeHealthCheckResult({ status: 500, latency: 100, healthy: true });
    expect(isHealthCheckPassing(result)).toBe(false);
  });

  it('should return false for status 201 (not in HEALTHY_STATUS_CODES)', () => {
    const result = makeHealthCheckResult({ status: 201, latency: 100, healthy: true });
    expect(isHealthCheckPassing(result)).toBe(false);
  });

  it('should return false when latency exceeds MAX_LATENCY_MS', () => {
    const result = makeHealthCheckResult({
      status: 200,
      latency: MAX_LATENCY_MS + 1,
      healthy: true,
    });
    expect(isHealthCheckPassing(result)).toBe(false);
  });

  it('should return true when latency equals MAX_LATENCY_MS', () => {
    const result = makeHealthCheckResult({ status: 200, latency: MAX_LATENCY_MS, healthy: true });
    expect(isHealthCheckPassing(result)).toBe(true);
  });

  it('should return false when healthy flag is false', () => {
    const result = makeHealthCheckResult({ status: 200, latency: 100, healthy: false });
    expect(isHealthCheckPassing(result)).toBe(false);
  });

  it('should return false when all conditions fail', () => {
    const result = makeHealthCheckResult({ status: 503, latency: 10000, healthy: false });
    expect(isHealthCheckPassing(result)).toBe(false);
  });
});

// ─── evaluateHealthStatus ────────────────────────────────────────────────────

describe('evaluateHealthStatus', () => {
  const config = makeHealthCheckConfig({ healthyThreshold: 3, unhealthyThreshold: 3 });

  it('should return unhealthy with zero results', () => {
    const status = evaluateHealthStatus([], config);
    expect(status.healthy).toBe(false);
    expect(status.consecutiveSuccesses).toBe(0);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.lastCheck).toBeUndefined();
  });

  it('should return healthy after enough consecutive successes', () => {
    const results = [
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: 60, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: 40, healthy: true }),
    ];
    const status = evaluateHealthStatus(results, config);
    expect(status.healthy).toBe(true);
    expect(status.consecutiveSuccesses).toBe(3);
    expect(status.consecutiveFailures).toBe(0);
  });

  it('should return unhealthy when not enough consecutive successes', () => {
    const results = [
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: 60, healthy: true }),
    ];
    const status = evaluateHealthStatus(results, config);
    expect(status.healthy).toBe(false);
    expect(status.consecutiveSuccesses).toBe(2);
  });

  it('should count consecutive failures from the end', () => {
    const results = [
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
      makeHealthCheckResult({ status: 503, latency: 50, healthy: false }),
      makeHealthCheckResult({ status: 503, latency: 50, healthy: false }),
    ];
    const status = evaluateHealthStatus(results, config);
    expect(status.healthy).toBe(false);
    expect(status.consecutiveSuccesses).toBe(0);
    expect(status.consecutiveFailures).toBe(2);
  });

  it('should reset consecutive count on status change', () => {
    const results = [
      makeHealthCheckResult({ status: 503, latency: 50, healthy: false }),
      makeHealthCheckResult({ status: 503, latency: 50, healthy: false }),
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
    ];
    const status = evaluateHealthStatus(results, config);
    expect(status.consecutiveSuccesses).toBe(1);
    expect(status.consecutiveFailures).toBe(0);
    expect(status.healthy).toBe(false);
  });

  it('should set lastCheck to the most recent result', () => {
    const last = makeHealthCheckResult({ status: 200, latency: 42, healthy: true });
    const results = [makeHealthCheckResult({ status: 503, latency: 50, healthy: false }), last];
    const status = evaluateHealthStatus(results, config);
    expect(status.lastCheck).toBe(last);
  });

  it('should handle high-latency results as failures', () => {
    const results = [
      makeHealthCheckResult({ status: 200, latency: MAX_LATENCY_MS + 1, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: MAX_LATENCY_MS + 1, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: MAX_LATENCY_MS + 1, healthy: true }),
    ];
    const status = evaluateHealthStatus(results, config);
    expect(status.healthy).toBe(false);
    expect(status.consecutiveFailures).toBe(3);
  });

  it('should work with healthyThreshold of 1', () => {
    const singleConfig = makeHealthCheckConfig({ healthyThreshold: 1 });
    const results = [makeHealthCheckResult({ status: 200, latency: 50, healthy: true })];
    const status = evaluateHealthStatus(results, singleConfig);
    expect(status.healthy).toBe(true);
    expect(status.consecutiveSuccesses).toBe(1);
  });

  it('should count all consecutive successes beyond threshold', () => {
    const results = [
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
      makeHealthCheckResult({ status: 200, latency: 50, healthy: true }),
    ];
    const status = evaluateHealthStatus(results, config);
    expect(status.healthy).toBe(true);
    expect(status.consecutiveSuccesses).toBe(5);
  });
});

// ─── validateRollingDeployConfig ─────────────────────────────────────────────

describe('validateRollingDeployConfig', () => {
  it('should accept a valid config', () => {
    const result = validateRollingDeployConfig(makeRollingDeployConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject maxUnavailable < 0', () => {
    const result = validateRollingDeployConfig(makeRollingDeployConfig({ maxUnavailable: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxUnavailable'));
  });

  it('should reject maxUnavailable > 100', () => {
    const result = validateRollingDeployConfig(makeRollingDeployConfig({ maxUnavailable: 101 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxUnavailable'));
  });

  it('should accept maxUnavailable at boundaries 0 and 100', () => {
    expect(validateRollingDeployConfig(makeRollingDeployConfig({ maxUnavailable: 0 })).valid).toBe(
      true,
    );
    expect(
      validateRollingDeployConfig(makeRollingDeployConfig({ maxUnavailable: 100 })).valid,
    ).toBe(true);
  });

  it('should reject maxSurge < 0', () => {
    const result = validateRollingDeployConfig(makeRollingDeployConfig({ maxSurge: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxSurge'));
  });

  it('should reject maxSurge > 100', () => {
    const result = validateRollingDeployConfig(makeRollingDeployConfig({ maxSurge: 101 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxSurge'));
  });

  it('should reject both maxUnavailable and maxSurge being 0', () => {
    const result = validateRollingDeployConfig(
      makeRollingDeployConfig({ maxUnavailable: 0, maxSurge: 0 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxUnavailable + maxSurge'));
  });

  it('should reject minReadySeconds < 0', () => {
    const result = validateRollingDeployConfig(makeRollingDeployConfig({ minReadySeconds: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('minReadySeconds'));
  });

  it('should reject minReadySeconds > 600', () => {
    const result = validateRollingDeployConfig(makeRollingDeployConfig({ minReadySeconds: 601 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('minReadySeconds'));
  });

  it('should accept minReadySeconds at boundaries 0 and 600', () => {
    expect(validateRollingDeployConfig(makeRollingDeployConfig({ minReadySeconds: 0 })).valid).toBe(
      true,
    );
    expect(
      validateRollingDeployConfig(makeRollingDeployConfig({ minReadySeconds: 600 })).valid,
    ).toBe(true);
  });

  it('should reject progressDeadlineSeconds <= 0', () => {
    const result = validateRollingDeployConfig(
      makeRollingDeployConfig({ progressDeadlineSeconds: 0 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('progressDeadlineSeconds'));
  });

  it('should reject progressDeadlineSeconds > 3600', () => {
    const result = validateRollingDeployConfig(
      makeRollingDeployConfig({ progressDeadlineSeconds: 3601 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('progressDeadlineSeconds'));
  });

  it('should accept progressDeadlineSeconds at boundary 3600', () => {
    expect(
      validateRollingDeployConfig(makeRollingDeployConfig({ progressDeadlineSeconds: 3600 })).valid,
    ).toBe(true);
  });

  it('should collect multiple errors', () => {
    const result = validateRollingDeployConfig(
      makeRollingDeployConfig({
        maxUnavailable: -1,
        maxSurge: 200,
        minReadySeconds: -1,
        progressDeadlineSeconds: 0,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── isZeroDowntimeConfig ────────────────────────────────────────────────────

describe('isZeroDowntimeConfig', () => {
  it('should return true when maxUnavailable is 0', () => {
    expect(isZeroDowntimeConfig(makeRollingDeployConfig({ maxUnavailable: 0, maxSurge: 25 }))).toBe(
      true,
    );
  });

  it('should return false when maxUnavailable is greater than 0', () => {
    expect(isZeroDowntimeConfig(makeRollingDeployConfig({ maxUnavailable: 1 }))).toBe(false);
  });

  it('should return false when maxUnavailable is 25', () => {
    expect(isZeroDowntimeConfig(makeRollingDeployConfig({ maxUnavailable: 25 }))).toBe(false);
  });

  it('should return false when maxUnavailable is 100', () => {
    expect(isZeroDowntimeConfig(makeRollingDeployConfig({ maxUnavailable: 100 }))).toBe(false);
  });
});
