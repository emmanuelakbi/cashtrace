/**
 * Security scan configuration and validation for CI pipeline.
 *
 * Provides types and functions for dependency vulnerability scanning
 * and secrets detection within the CI pipeline.
 *
 * @module deployment/securityScan
 */

// ─── Severity Levels ─────────────────────────────────────────────────────────

/** Vulnerability severity levels ordered from most to least severe. */
export const SEVERITY_LEVELS = ['critical', 'high', 'medium', 'low'] as const;

export type SeverityLevel = (typeof SEVERITY_LEVELS)[number];

/** Numeric weight for each severity level (higher = more severe). */
const SEVERITY_WEIGHT: Record<SeverityLevel, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

// ─── Security Scan Types ─────────────────────────────────────────────────────

/** A single vulnerability found during dependency scanning. */
export interface Vulnerability {
  /** Unique advisory identifier (e.g. GHSA-xxxx). */
  id: string;
  /** Affected package name. */
  package: string;
  /** Severity of the vulnerability. */
  severity: SeverityLevel;
  /** Human-readable description. */
  description: string;
  /** Version range that is affected. */
  affectedVersions: string;
  /** Fixed version, if available. */
  fixedVersion?: string;
}

/** Result of a dependency vulnerability scan. */
export interface DependencyScanResult {
  /** Whether the scan completed successfully. */
  success: boolean;
  /** Vulnerabilities found, grouped by severity. */
  vulnerabilities: Vulnerability[];
  /** Total number of packages scanned. */
  totalPackages: number;
  /** Timestamp of the scan. */
  scannedAt: Date;
}

/** Result of a secrets detection scan. */
export interface SecretsScanResult {
  /** Whether the scan completed successfully. */
  success: boolean;
  /** Number of potential secrets detected. */
  secretsFound: number;
  /** File paths where secrets were detected. */
  affectedFiles: string[];
  /** Timestamp of the scan. */
  scannedAt: Date;
}

/** Combined security scan result. */
export interface SecurityScanResult {
  /** Dependency vulnerability scan result. */
  dependencyScan: DependencyScanResult;
  /** Secrets detection scan result. */
  secretsScan: SecretsScanResult;
  /** Whether the overall scan passed (no blocking issues). */
  passed: boolean;
}

/** Configuration for security scanning. */
export interface SecurityScanConfig {
  /** Minimum severity level that blocks the pipeline. */
  auditLevel: SeverityLevel;
  /** Whether secrets detection is enabled. */
  secretsDetectionEnabled: boolean;
  /** File patterns to exclude from secrets scanning. */
  secretsExcludePatterns: string[];
}

/** Result of security scan configuration validation. */
export interface SecurityScanValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation Functions ────────────────────────────────────────────────────

/**
 * Validate a security scan configuration.
 *
 * Checks:
 * - `auditLevel` is a recognised severity level
 * - `secretsExcludePatterns` contains only non-empty strings
 */
export function validateSecurityScanConfig(
  config: SecurityScanConfig,
): SecurityScanValidationResult {
  const errors: string[] = [];

  if (!SEVERITY_LEVELS.includes(config.auditLevel)) {
    errors.push(
      `Invalid audit level: "${config.auditLevel}". Must be one of: ${SEVERITY_LEVELS.join(', ')}`,
    );
  }

  for (const pattern of config.secretsExcludePatterns) {
    if (!pattern || pattern.trim() === '') {
      errors.push('secretsExcludePatterns must not contain empty strings');
      break;
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether any vulnerabilities exceed the configured severity threshold.
 *
 * Returns `true` when at least one vulnerability has a severity at or above
 * the given `threshold` level.
 */
export function vulnerabilitiesExceedThreshold(
  vulnerabilities: Vulnerability[],
  threshold: SeverityLevel,
): boolean {
  const thresholdWeight = SEVERITY_WEIGHT[threshold];
  return vulnerabilities.some((v) => SEVERITY_WEIGHT[v.severity] >= thresholdWeight);
}

/**
 * Count vulnerabilities grouped by severity level.
 */
export function countBySeverity(vulnerabilities: Vulnerability[]): Record<SeverityLevel, number> {
  const counts: Record<SeverityLevel, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };

  for (const v of vulnerabilities) {
    counts[v.severity]++;
  }

  return counts;
}
