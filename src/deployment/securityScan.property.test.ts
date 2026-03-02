/**
 * Property-based tests for Security Scan — Security Scan Enforcement
 *
 * **Property 3: Security Scan Enforcement**
 * For any build, security vulnerabilities above configured severity SHALL block deployment.
 *
 * **Validates: Requirements 1.5**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import type { SecurityScanConfig, SeverityLevel, Vulnerability } from './securityScan.js';
import {
  countBySeverity,
  SEVERITY_LEVELS,
  validateSecurityScanConfig,
  vulnerabilitiesExceedThreshold,
} from './securityScan.js';

// ─── Severity Weight Map (mirrors implementation for test assertions) ────────

const SEVERITY_WEIGHT: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid severity level from the known set. */
const severityArb: fc.Arbitrary<SeverityLevel> = fc.constantFrom(...SEVERITY_LEVELS);

/** Generate a minimal Vulnerability with a given severity. */
const vulnerabilityArb = (severity: fc.Arbitrary<SeverityLevel>): fc.Arbitrary<Vulnerability> =>
  fc
    .tuple(
      fc.stringMatching(/^GHSA-[a-z0-9]{4}$/),
      fc.stringMatching(/^[a-z-]{3,20}$/),
      severity,
      fc.stringMatching(/^[A-Za-z ]{5,30}$/),
      fc.stringMatching(/^>=\d+\.\d+\.\d+$/),
    )
    .map(
      ([id, pkg, sev, desc, affected]): Vulnerability => ({
        id,
        package: pkg,
        severity: sev,
        description: desc,
        affectedVersions: affected,
      }),
    );

/** Generate a non-empty list of vulnerabilities with any severity. */
const vulnerabilitiesArb = fc.array(vulnerabilityArb(severityArb), {
  minLength: 1,
  maxLength: 20,
});

/** Generate a non-empty glob pattern string for exclude patterns. */
const nonEmptyPatternArb = fc.stringMatching(/^[a-zA-Z*?./_-]{1,30}$/);

/** Generate a valid SecurityScanConfig. */
const validConfigArb: fc.Arbitrary<SecurityScanConfig> = fc
  .tuple(severityArb, fc.boolean(), fc.array(nonEmptyPatternArb, { minLength: 0, maxLength: 5 }))
  .map(
    ([auditLevel, secretsDetectionEnabled, secretsExcludePatterns]): SecurityScanConfig => ({
      auditLevel,
      secretsDetectionEnabled,
      secretsExcludePatterns,
    }),
  );
// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Security Scan Enforcement (Property 3)', () => {
  /**
   * **Validates: Requirements 1.5**
   * For any list of vulnerabilities where ALL have severity strictly below the
   * threshold, vulnerabilitiesExceedThreshold returns false.
   */
  it('returns false when all vulnerabilities are below the threshold', () => {
    fc.assert(
      fc.property(severityArb, (threshold) => {
        const thresholdWeight = SEVERITY_WEIGHT[threshold];

        // Collect severity levels strictly below the threshold
        const belowLevels = SEVERITY_LEVELS.filter((s) => SEVERITY_WEIGHT[s] < thresholdWeight);

        // If no levels are below (threshold is 'low'), an empty list should not exceed
        if (belowLevels.length === 0) {
          expect(vulnerabilitiesExceedThreshold([], threshold)).toBe(false);
          return;
        }

        const belowSeverityArb: fc.Arbitrary<SeverityLevel> = fc.constantFrom(...belowLevels);
        const belowVulnsArb = fc.array(vulnerabilityArb(belowSeverityArb), {
          minLength: 1,
          maxLength: 10,
        });

        fc.assert(
          fc.property(belowVulnsArb, (vulns) => {
            expect(vulnerabilitiesExceedThreshold(vulns, threshold)).toBe(false);
          }),
          { numRuns: 50 },
        );
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5**
   * For any list containing at least one vulnerability at or above the threshold,
   * vulnerabilitiesExceedThreshold returns true.
   */
  it('returns true when at least one vulnerability meets or exceeds the threshold', () => {
    fc.assert(
      fc.property(severityArb, (threshold) => {
        const thresholdWeight = SEVERITY_WEIGHT[threshold];

        // Collect severity levels at or above the threshold
        const atOrAboveLevels = SEVERITY_LEVELS.filter(
          (s) => SEVERITY_WEIGHT[s] >= thresholdWeight,
        );
        const atOrAboveSeverityArb: fc.Arbitrary<SeverityLevel> = fc.constantFrom(
          ...atOrAboveLevels,
        );

        // One vulnerability at/above threshold, mixed with any others
        const mixedVulnsArb = fc
          .tuple(
            vulnerabilityArb(atOrAboveSeverityArb),
            fc.array(vulnerabilityArb(severityArb), { minLength: 0, maxLength: 9 }),
          )
          .map(([blocking, rest]) => [blocking, ...rest]);

        fc.assert(
          fc.property(mixedVulnsArb, (vulns) => {
            expect(vulnerabilitiesExceedThreshold(vulns, threshold)).toBe(true);
          }),
          { numRuns: 50 },
        );
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5**
   * For any list of vulnerabilities, countBySeverity always returns counts
   * that sum to the total number of vulnerabilities.
   */
  it('countBySeverity counts sum to total vulnerabilities', () => {
    fc.assert(
      fc.property(
        fc.array(vulnerabilityArb(severityArb), { minLength: 0, maxLength: 30 }),
        (vulns) => {
          const counts = countBySeverity(vulns);
          const total = SEVERITY_LEVELS.reduce((sum, level) => sum + counts[level], 0);
          expect(total).toBe(vulns.length);

          // Each count must be non-negative
          for (const level of SEVERITY_LEVELS) {
            expect(counts[level]).toBeGreaterThanOrEqual(0);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5**
   * For any valid SecurityScanConfig, validateSecurityScanConfig returns valid=true.
   */
  it('validates any well-formed SecurityScanConfig as valid', () => {
    fc.assert(
      fc.property(validConfigArb, (config) => {
        const result = validateSecurityScanConfig(config);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 1.5**
   * For any config with an invalid auditLevel, validateSecurityScanConfig
   * returns valid=false with an appropriate error.
   */
  it('rejects configs with invalid auditLevel', () => {
    const invalidLevelArb = fc
      .stringMatching(/^[a-z]{3,15}$/)
      .filter((s) => !(SEVERITY_LEVELS as readonly string[]).includes(s));

    fc.assert(
      fc.property(
        invalidLevelArb,
        fc.boolean(),
        fc.array(nonEmptyPatternArb, { minLength: 0, maxLength: 5 }),
        (badLevel, secretsEnabled, patterns) => {
          const config: SecurityScanConfig = {
            auditLevel: badLevel as SeverityLevel,
            secretsDetectionEnabled: secretsEnabled,
            secretsExcludePatterns: patterns,
          };
          const result = validateSecurityScanConfig(config);
          expect(result.valid).toBe(false);
          expect(result.errors.length).toBeGreaterThanOrEqual(1);
          expect(result.errors.some((e) => e.includes('Invalid audit level'))).toBe(true);
        },
      ),
      { numRuns: 200 },
    );
  });
});
