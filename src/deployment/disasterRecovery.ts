/**
 * Disaster recovery configuration validation.
 *
 * Provides pure functions to validate DR configurations, backup
 * verification schedules, and RPO/RTO compliance.
 * Supports Requirements 11.1–11.4 (disaster recovery and business continuity).
 *
 * @module deployment/disasterRecovery
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Recovery Point Objective in hours. */
export const TARGET_RPO_HOURS = 1;

/** Recovery Time Objective in hours. */
export const TARGET_RTO_HOURS = 4;

/** Secondary (failover) AWS region. */
export const SECONDARY_REGION = 'eu-west-1';

/** Required interval between backup verifications in days. */
export const BACKUP_VERIFICATION_INTERVAL_DAYS = 7;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Complete disaster recovery configuration. */
export interface DrConfig {
  /** Primary AWS region. */
  primaryRegion: string;
  /** Secondary (failover) AWS region. */
  secondaryRegion: string;
  /** Whether cross-region replication is enabled. */
  crossRegionReplication: boolean;
  /** Configured RPO in hours. */
  rpoHours: number;
  /** Configured RTO in hours. */
  rtoHours: number;
  /** Timestamp of the last backup verification. */
  lastBackupVerification?: Date;
  /** URL to the DR runbook. */
  runbookUrl?: string;
}

/** Result of validating a DR configuration. */
export interface DrValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** Result of checking backup verification status. */
export interface BackupVerificationResult {
  /** Whether the last backup was successfully verified. */
  verified: boolean;
  /** Number of days since the last verification. */
  daysSinceVerification: number;
  /** Whether a new verification is needed. */
  needsVerification: boolean;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a complete disaster recovery configuration.
 *
 * Checks:
 * - primaryRegion must be 'af-south-1'
 * - secondaryRegion must be non-empty and different from primary
 * - crossRegionReplication must be true
 * - rpoHours must be <= TARGET_RPO_HOURS
 * - rtoHours must be <= TARGET_RTO_HOURS
 * - runbookUrl is recommended (warn if missing, but still valid)
 */
export function validateDrConfig(config: DrConfig): DrValidationResult {
  const errors: string[] = [];

  if (config.primaryRegion !== 'af-south-1') {
    errors.push(`primaryRegion must be "af-south-1", got "${config.primaryRegion}"`);
  }

  if (!config.secondaryRegion || config.secondaryRegion.trim().length === 0) {
    errors.push('secondaryRegion must be non-empty');
  } else if (config.secondaryRegion === config.primaryRegion) {
    errors.push('secondaryRegion must be different from primaryRegion');
  }

  if (!config.crossRegionReplication) {
    errors.push('crossRegionReplication must be true');
  }

  if (config.rpoHours > TARGET_RPO_HOURS) {
    errors.push(`rpoHours must be <= ${TARGET_RPO_HOURS}, got ${config.rpoHours}`);
  }

  if (config.rtoHours > TARGET_RTO_HOURS) {
    errors.push(`rtoHours must be <= ${TARGET_RTO_HOURS}, got ${config.rtoHours}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check the status of backup verification.
 *
 * Calculates days since the last verification and determines
 * whether a new verification is needed based on the configured interval.
 */
export function checkBackupVerification(
  lastVerification: Date | undefined,
  now?: Date,
): BackupVerificationResult {
  const currentTime = now ?? new Date();

  if (!lastVerification) {
    return { verified: false, daysSinceVerification: Infinity, needsVerification: true };
  }

  const msPerDay = 24 * 60 * 60 * 1000;
  const daysSinceVerification = Math.floor(
    (currentTime.getTime() - lastVerification.getTime()) / msPerDay,
  );

  return {
    verified: true,
    daysSinceVerification,
    needsVerification: daysSinceVerification >= BACKUP_VERIFICATION_INTERVAL_DAYS,
  };
}

/**
 * Check whether the given RPO meets the target.
 *
 * Returns `true` if `rpoHours` is at or below `TARGET_RPO_HOURS`.
 */
export function meetsRpo(rpoHours: number): boolean {
  return rpoHours <= TARGET_RPO_HOURS;
}

/**
 * Check whether the given RTO meets the target.
 *
 * Returns `true` if `rtoHours` is at or below `TARGET_RTO_HOURS`.
 */
export function meetsRto(rtoHours: number): boolean {
  return rtoHours <= TARGET_RTO_HOURS;
}
