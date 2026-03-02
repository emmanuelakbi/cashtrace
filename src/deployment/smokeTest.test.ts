import { describe, expect, it } from 'vitest';

import {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECONDS,
  evaluateSmokeTestResults,
  hasRequiredEndpoints,
  MAX_LATENCY_MS,
  REQUIRED_ENDPOINTS,
  validateSmokeTestConfig,
} from './smokeTest.js';
import type { SmokeTestConfig, SmokeTestEndpoint, SmokeTestResult } from './smokeTest.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeEndpoint(overrides: Partial<SmokeTestEndpoint> = {}): SmokeTestEndpoint {
  return {
    path: '/api/health',
    method: 'GET',
    expectedStatus: 200,
    maxLatencyMs: 1000,
    ...overrides,
  };
}

function makeConfig(overrides: Partial<SmokeTestConfig> = {}): SmokeTestConfig {
  return {
    baseUrl: 'https://staging.cashtrace.ng',
    endpoints: [makeEndpoint(), makeEndpoint({ path: '/api/auth/status' })],
    timeoutSeconds: DEFAULT_TIMEOUT_SECONDS,
    retries: DEFAULT_RETRIES,
    ...overrides,
  };
}

function makeResult(overrides: Partial<SmokeTestResult> = {}): SmokeTestResult {
  return {
    endpoint: '/api/health',
    status: 200,
    latencyMs: 50,
    passed: true,
    ...overrides,
  };
}

// ─── Constants ───────────────────────────────────────────────────────────────

describe('constants', () => {
  it('should have expected default values', () => {
    expect(DEFAULT_TIMEOUT_SECONDS).toBe(30);
    expect(DEFAULT_RETRIES).toBe(3);
    expect(MAX_LATENCY_MS).toBe(5000);
  });

  it('should require /api/health and /api/auth/status endpoints', () => {
    expect(REQUIRED_ENDPOINTS).toContain('/api/health');
    expect(REQUIRED_ENDPOINTS).toContain('/api/auth/status');
    expect(REQUIRED_ENDPOINTS).toHaveLength(2);
  });
});

// ─── validateSmokeTestConfig ─────────────────────────────────────────────────

describe('validateSmokeTestConfig', () => {
  it('should accept a valid config', () => {
    const result = validateSmokeTestConfig(makeConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject baseUrl not starting with https://', () => {
    const result = validateSmokeTestConfig(makeConfig({ baseUrl: 'http://example.com' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('baseUrl'));
  });

  it('should reject baseUrl that is a plain string', () => {
    const result = validateSmokeTestConfig(makeConfig({ baseUrl: 'example.com' }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('https://'));
  });

  it('should accept baseUrl starting with https://', () => {
    const result = validateSmokeTestConfig(
      makeConfig({ baseUrl: 'https://production.cashtrace.ng' }),
    );
    expect(result.valid).toBe(true);
  });

  it('should reject empty endpoints array', () => {
    const result = validateSmokeTestConfig(makeConfig({ endpoints: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('endpoints'));
  });

  it('should reject timeoutSeconds of 0', () => {
    const result = validateSmokeTestConfig(makeConfig({ timeoutSeconds: 0 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('timeoutSeconds'));
  });

  it('should reject negative timeoutSeconds', () => {
    const result = validateSmokeTestConfig(makeConfig({ timeoutSeconds: -5 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('timeoutSeconds'));
  });

  it('should accept timeoutSeconds of 1', () => {
    const result = validateSmokeTestConfig(makeConfig({ timeoutSeconds: 1 }));
    expect(result.valid).toBe(true);
  });

  it('should reject negative retries', () => {
    const result = validateSmokeTestConfig(makeConfig({ retries: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('retries'));
  });

  it('should accept retries of 0', () => {
    const result = validateSmokeTestConfig(makeConfig({ retries: 0 }));
    expect(result.valid).toBe(true);
  });

  it('should reject invalid HTTP method', () => {
    const result = validateSmokeTestConfig(
      makeConfig({ endpoints: [makeEndpoint({ method: 'INVALID' })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('method'));
  });

  it('should accept all valid HTTP methods', () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
    for (const method of methods) {
      const result = validateSmokeTestConfig(makeConfig({ endpoints: [makeEndpoint({ method })] }));
      expect(result.valid).toBe(true);
    }
  });

  it('should accept lowercase HTTP methods', () => {
    const result = validateSmokeTestConfig(
      makeConfig({ endpoints: [makeEndpoint({ method: 'get' })] }),
    );
    expect(result.valid).toBe(true);
  });

  it('should reject expectedStatus below 100', () => {
    const result = validateSmokeTestConfig(
      makeConfig({ endpoints: [makeEndpoint({ expectedStatus: 99 })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('expectedStatus'));
  });

  it('should reject expectedStatus above 599', () => {
    const result = validateSmokeTestConfig(
      makeConfig({ endpoints: [makeEndpoint({ expectedStatus: 600 })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('expectedStatus'));
  });

  it('should accept expectedStatus at boundaries 100 and 599', () => {
    expect(
      validateSmokeTestConfig(makeConfig({ endpoints: [makeEndpoint({ expectedStatus: 100 })] }))
        .valid,
    ).toBe(true);
    expect(
      validateSmokeTestConfig(makeConfig({ endpoints: [makeEndpoint({ expectedStatus: 599 })] }))
        .valid,
    ).toBe(true);
  });

  it('should reject maxLatencyMs of 0', () => {
    const result = validateSmokeTestConfig(
      makeConfig({ endpoints: [makeEndpoint({ maxLatencyMs: 0 })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxLatencyMs'));
  });

  it('should reject negative maxLatencyMs', () => {
    const result = validateSmokeTestConfig(
      makeConfig({ endpoints: [makeEndpoint({ maxLatencyMs: -100 })] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('maxLatencyMs'));
  });

  it('should collect multiple errors', () => {
    const result = validateSmokeTestConfig(
      makeConfig({
        baseUrl: 'http://bad',
        endpoints: [],
        timeoutSeconds: 0,
        retries: -1,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });

  it('should validate each endpoint independently', () => {
    const result = validateSmokeTestConfig(
      makeConfig({
        endpoints: [
          makeEndpoint({ method: 'GET', expectedStatus: 200 }),
          makeEndpoint({ path: '/bad', method: 'INVALID', expectedStatus: 0 }),
        ],
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(expect.stringContaining('method'));
    expect(result.errors).toContainEqual(expect.stringContaining('expectedStatus'));
  });
});

// ─── evaluateSmokeTestResults ────────────────────────────────────────────────

describe('evaluateSmokeTestResults', () => {
  it('should return allPassed true when all results pass', () => {
    const results = [
      makeResult({ passed: true }),
      makeResult({ endpoint: '/api/auth/status', passed: true }),
    ];
    const suite = evaluateSmokeTestResults(results);
    expect(suite.allPassed).toBe(true);
    expect(suite.failedCount).toBe(0);
    expect(suite.results).toHaveLength(2);
  });

  it('should return allPassed false when any result fails', () => {
    const results = [
      makeResult({ passed: true }),
      makeResult({ endpoint: '/api/auth/status', passed: false }),
    ];
    const suite = evaluateSmokeTestResults(results);
    expect(suite.allPassed).toBe(false);
    expect(suite.failedCount).toBe(1);
  });

  it('should return allPassed false when all results fail', () => {
    const results = [
      makeResult({ passed: false }),
      makeResult({ endpoint: '/api/auth/status', passed: false }),
    ];
    const suite = evaluateSmokeTestResults(results);
    expect(suite.allPassed).toBe(false);
    expect(suite.failedCount).toBe(2);
  });

  it('should handle empty results as allPassed', () => {
    const suite = evaluateSmokeTestResults([]);
    expect(suite.allPassed).toBe(true);
    expect(suite.failedCount).toBe(0);
    expect(suite.results).toHaveLength(0);
  });

  it('should preserve the original results array', () => {
    const results = [
      makeResult({ endpoint: '/api/health', status: 200, latencyMs: 42, passed: true }),
      makeResult({ endpoint: '/api/auth/status', status: 503, latencyMs: 3000, passed: false }),
    ];
    const suite = evaluateSmokeTestResults(results);
    expect(suite.results).toBe(results);
  });

  it('should count multiple failures correctly', () => {
    const results = [
      makeResult({ passed: false }),
      makeResult({ passed: true }),
      makeResult({ passed: false }),
      makeResult({ passed: false }),
      makeResult({ passed: true }),
    ];
    const suite = evaluateSmokeTestResults(results);
    expect(suite.failedCount).toBe(3);
    expect(suite.allPassed).toBe(false);
  });

  it('should handle single passing result', () => {
    const suite = evaluateSmokeTestResults([makeResult({ passed: true })]);
    expect(suite.allPassed).toBe(true);
    expect(suite.failedCount).toBe(0);
  });

  it('should handle single failing result', () => {
    const suite = evaluateSmokeTestResults([makeResult({ passed: false })]);
    expect(suite.allPassed).toBe(false);
    expect(suite.failedCount).toBe(1);
  });
});

// ─── hasRequiredEndpoints ────────────────────────────────────────────────────

describe('hasRequiredEndpoints', () => {
  it('should return true when all required endpoints are present', () => {
    const endpoints = [
      makeEndpoint({ path: '/api/health' }),
      makeEndpoint({ path: '/api/auth/status' }),
    ];
    expect(hasRequiredEndpoints(endpoints)).toBe(true);
  });

  it('should return true when required endpoints are present among others', () => {
    const endpoints = [
      makeEndpoint({ path: '/api/health' }),
      makeEndpoint({ path: '/api/auth/status' }),
      makeEndpoint({ path: '/api/transactions' }),
      makeEndpoint({ path: '/api/dashboard' }),
    ];
    expect(hasRequiredEndpoints(endpoints)).toBe(true);
  });

  it('should return false when /api/health is missing', () => {
    const endpoints = [makeEndpoint({ path: '/api/auth/status' })];
    expect(hasRequiredEndpoints(endpoints)).toBe(false);
  });

  it('should return false when /api/auth/status is missing', () => {
    const endpoints = [makeEndpoint({ path: '/api/health' })];
    expect(hasRequiredEndpoints(endpoints)).toBe(false);
  });

  it('should return false for empty endpoints', () => {
    expect(hasRequiredEndpoints([])).toBe(false);
  });

  it('should return false when no required endpoints are present', () => {
    const endpoints = [
      makeEndpoint({ path: '/api/transactions' }),
      makeEndpoint({ path: '/api/dashboard' }),
    ];
    expect(hasRequiredEndpoints(endpoints)).toBe(false);
  });

  it('should not match partial paths', () => {
    const endpoints = [
      makeEndpoint({ path: '/api/health/detailed' }),
      makeEndpoint({ path: '/api/auth/status/extended' }),
    ];
    expect(hasRequiredEndpoints(endpoints)).toBe(false);
  });

  it('should handle duplicate required endpoints', () => {
    const endpoints = [
      makeEndpoint({ path: '/api/health' }),
      makeEndpoint({ path: '/api/health' }),
      makeEndpoint({ path: '/api/auth/status' }),
    ];
    expect(hasRequiredEndpoints(endpoints)).toBe(true);
  });
});
