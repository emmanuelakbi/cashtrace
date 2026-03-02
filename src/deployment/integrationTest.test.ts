import { describe, expect, it } from 'vitest';

import {
  checkIntegrationTestResults,
  MAX_RETRIES,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  validateIntegrationTestConfig,
} from './integrationTest.js';
import type { IntegrationTestConfig, IntegrationTestRunResult } from './integrationTest.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeIntegrationTestConfig(
  overrides: Partial<IntegrationTestConfig> = {},
): IntegrationTestConfig {
  return {
    stagingUrl: 'https://staging.cashtrace.ng',
    timeout: 300,
    testPatterns: ['src/**/*.integration.test.ts'],
    retries: 1,
    ...overrides,
  };
}

function makeIntegrationTestRunResult(
  overrides: Partial<IntegrationTestRunResult> = {},
): IntegrationTestRunResult {
  return {
    totalTests: 10,
    passedTests: 10,
    failedTests: 0,
    totalDurationMs: 5000,
    results: [],
    ...overrides,
  };
}

// ─── validateIntegrationTestConfig ───────────────────────────────────────────

describe('validateIntegrationTestConfig', () => {
  it('should return valid for a well-formed config', () => {
    const result = validateIntegrationTestConfig(makeIntegrationTestConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should report error for empty stagingUrl', () => {
    const result = validateIntegrationTestConfig(makeIntegrationTestConfig({ stagingUrl: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('stagingUrl must be a non-empty string'))).toBe(
      true,
    );
  });

  it('should report error for invalid stagingUrl', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ stagingUrl: 'not-a-url' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('stagingUrl must be a valid URL'))).toBe(true);
  });

  it('should report error for non-http/https stagingUrl', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ stagingUrl: 'ftp://staging.cashtrace.ng' }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('http or https protocol'))).toBe(true);
  });

  it('should accept http stagingUrl', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ stagingUrl: 'http://localhost:3000' }),
    );
    expect(result.valid).toBe(true);
  });

  it('should report error when timeout is below minimum', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ timeout: MIN_TIMEOUT_SECONDS - 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(`at least ${MIN_TIMEOUT_SECONDS}`))).toBe(true);
  });

  it('should report error when timeout exceeds maximum', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ timeout: MAX_TIMEOUT_SECONDS + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(`must not exceed ${MAX_TIMEOUT_SECONDS}`))).toBe(
      true,
    );
  });

  it('should accept timeout at boundaries', () => {
    const minResult = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ timeout: MIN_TIMEOUT_SECONDS }),
    );
    expect(minResult.valid).toBe(true);

    const maxResult = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ timeout: MAX_TIMEOUT_SECONDS }),
    );
    expect(maxResult.valid).toBe(true);
  });

  it('should report error for empty testPatterns array', () => {
    const result = validateIntegrationTestConfig(makeIntegrationTestConfig({ testPatterns: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least one pattern'))).toBe(true);
  });

  it('should report error when all testPatterns are empty strings', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ testPatterns: ['', '  '] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least one non-empty pattern'))).toBe(true);
  });

  it('should report error for negative retries', () => {
    const result = validateIntegrationTestConfig(makeIntegrationTestConfig({ retries: -1 }));
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('retries must be non-negative'))).toBe(true);
  });

  it('should report error when retries exceed maximum', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({ retries: MAX_RETRIES + 1 }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes(`retries must not exceed ${MAX_RETRIES}`))).toBe(
      true,
    );
  });

  it('should accept zero retries', () => {
    const result = validateIntegrationTestConfig(makeIntegrationTestConfig({ retries: 0 }));
    expect(result.valid).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const result = validateIntegrationTestConfig(
      makeIntegrationTestConfig({
        stagingUrl: '',
        timeout: 0,
        testPatterns: [],
        retries: -1,
      }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(4);
  });
});

// ─── checkIntegrationTestResults ─────────────────────────────────────────────

describe('checkIntegrationTestResults', () => {
  it('should pass when all tests pass', () => {
    const result = checkIntegrationTestResults(makeIntegrationTestRunResult());
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });

  it('should fail when no tests were executed', () => {
    const result = checkIntegrationTestResults(
      makeIntegrationTestRunResult({ totalTests: 0, passedTests: 0, failedTests: 0 }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes('No integration tests were executed'))).toBe(
      true,
    );
  });

  it('should fail when some tests failed', () => {
    const result = checkIntegrationTestResults(
      makeIntegrationTestRunResult({ totalTests: 10, passedTests: 8, failedTests: 2 }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes('2 integration test(s) failed'))).toBe(true);
  });

  it('should fail when test counts are inconsistent', () => {
    const result = checkIntegrationTestResults(
      makeIntegrationTestRunResult({ totalTests: 10, passedTests: 5, failedTests: 3 }),
    );
    expect(result.passed).toBe(false);
    expect(result.failures.some((f) => f.includes('counts are inconsistent'))).toBe(true);
  });

  it('should pass with a single passing test', () => {
    const result = checkIntegrationTestResults(
      makeIntegrationTestRunResult({ totalTests: 1, passedTests: 1, failedTests: 0 }),
    );
    expect(result.passed).toBe(true);
    expect(result.failures).toEqual([]);
  });
});
