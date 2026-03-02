import { describe, expect, it } from 'vitest';

import type { SecurityScanConfig, SeverityLevel, Vulnerability } from './securityScan.js';
import {
  countBySeverity,
  SEVERITY_LEVELS,
  validateSecurityScanConfig,
  vulnerabilitiesExceedThreshold,
} from './securityScan.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeVulnerability(overrides: Partial<Vulnerability> = {}): Vulnerability {
  return {
    id: 'GHSA-0001',
    package: 'some-package',
    severity: 'medium',
    description: 'Test vulnerability',
    affectedVersions: '>=1.0.0 <2.0.0',
    ...overrides,
  };
}

function makeSecurityScanConfig(overrides: Partial<SecurityScanConfig> = {}): SecurityScanConfig {
  return {
    auditLevel: 'high',
    secretsDetectionEnabled: true,
    secretsExcludePatterns: ['*.test.ts'],
    ...overrides,
  };
}

// ─── SEVERITY_LEVELS ─────────────────────────────────────────────────────────

describe('SEVERITY_LEVELS', () => {
  it('contains all four severity levels in order', () => {
    expect(SEVERITY_LEVELS).toEqual(['critical', 'high', 'medium', 'low']);
  });
});

// ─── validateSecurityScanConfig ──────────────────────────────────────────────

describe('validateSecurityScanConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateSecurityScanConfig(makeSecurityScanConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects an invalid audit level', () => {
    const result = validateSecurityScanConfig(
      makeSecurityScanConfig({ auditLevel: 'unknown' as SeverityLevel }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('Invalid audit level');
  });

  it('rejects empty strings in secretsExcludePatterns', () => {
    const result = validateSecurityScanConfig(
      makeSecurityScanConfig({ secretsExcludePatterns: ['valid', ''] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('must not contain empty strings');
  });

  it('accepts empty secretsExcludePatterns array', () => {
    const result = validateSecurityScanConfig(
      makeSecurityScanConfig({ secretsExcludePatterns: [] }),
    );
    expect(result.valid).toBe(true);
  });

  it('accepts all valid severity levels as auditLevel', () => {
    for (const level of SEVERITY_LEVELS) {
      const result = validateSecurityScanConfig(makeSecurityScanConfig({ auditLevel: level }));
      expect(result.valid).toBe(true);
    }
  });
});

// ─── vulnerabilitiesExceedThreshold ──────────────────────────────────────────

describe('vulnerabilitiesExceedThreshold', () => {
  it('returns false for an empty vulnerability list', () => {
    expect(vulnerabilitiesExceedThreshold([], 'high')).toBe(false);
  });

  it('returns true when a vulnerability matches the threshold exactly', () => {
    const vulns = [makeVulnerability({ severity: 'high' })];
    expect(vulnerabilitiesExceedThreshold(vulns, 'high')).toBe(true);
  });

  it('returns true when a vulnerability exceeds the threshold', () => {
    const vulns = [makeVulnerability({ severity: 'critical' })];
    expect(vulnerabilitiesExceedThreshold(vulns, 'high')).toBe(true);
  });

  it('returns false when all vulnerabilities are below the threshold', () => {
    const vulns = [
      makeVulnerability({ severity: 'low' }),
      makeVulnerability({ severity: 'medium' }),
    ];
    expect(vulnerabilitiesExceedThreshold(vulns, 'high')).toBe(false);
  });

  it('returns true for critical threshold with critical vulnerability', () => {
    const vulns = [makeVulnerability({ severity: 'critical' })];
    expect(vulnerabilitiesExceedThreshold(vulns, 'critical')).toBe(true);
  });

  it('returns true for low threshold with any vulnerability', () => {
    const vulns = [makeVulnerability({ severity: 'low' })];
    expect(vulnerabilitiesExceedThreshold(vulns, 'low')).toBe(true);
  });
});

// ─── countBySeverity ─────────────────────────────────────────────────────────

describe('countBySeverity', () => {
  it('returns all zeros for an empty list', () => {
    expect(countBySeverity([])).toEqual({
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    });
  });

  it('counts vulnerabilities by severity correctly', () => {
    const vulns = [
      makeVulnerability({ severity: 'critical' }),
      makeVulnerability({ severity: 'high' }),
      makeVulnerability({ severity: 'high' }),
      makeVulnerability({ severity: 'low' }),
    ];
    expect(countBySeverity(vulns)).toEqual({
      critical: 1,
      high: 2,
      medium: 0,
      low: 1,
    });
  });

  it('handles a single severity level', () => {
    const vulns = [
      makeVulnerability({ severity: 'medium' }),
      makeVulnerability({ severity: 'medium' }),
    ];
    expect(countBySeverity(vulns)).toEqual({
      critical: 0,
      high: 0,
      medium: 2,
      low: 0,
    });
  });
});
