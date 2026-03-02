/**
 * Nigerian data residency validation.
 *
 * Provides pure functions to validate data residency configurations,
 * data flow compliance, and guardrails preventing accidental data
 * transfer to non-compliant regions.
 * Supports Requirements 13.1–13.4 (Nigerian data residency).
 *
 * @module deployment/dataResidency
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** African regions compliant for primary data storage. */
export const COMPLIANT_REGIONS = ['af-south-1'] as const;

/** Regions compliant for backup storage (Africa + EU). */
export const COMPLIANT_BACKUP_REGIONS = ['af-south-1', 'eu-west-1'] as const;

/** Examples of non-compliant regions. */
export const NON_COMPLIANT_REGIONS = ['us-east-1', 'us-west-2', 'ap-southeast-1'] as const;

/** Valid data classification levels. */
export const DATA_CLASSIFICATION_LEVELS = [
  'public',
  'internal',
  'confidential',
  'restricted',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Data classification level. */
export type DataClassificationLevel = (typeof DATA_CLASSIFICATION_LEVELS)[number];

/** Configuration for data residency compliance. */
export interface DataResidencyConfig {
  /** Primary AWS region for data storage. */
  primaryRegion: string;
  /** Regions used for backup storage. */
  backupRegions: string[];
  /** Classification level of the data. */
  dataClassification: string;
  /** Whether encryption is required. */
  encryptionRequired: boolean;
}

/** Result of validating a data residency configuration. */
export interface DataResidencyValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** Record of a data flow between regions. */
export interface DataFlowRecord {
  /** Source AWS region. */
  sourceRegion: string;
  /** Destination AWS region. */
  destinationRegion: string;
  /** Classification level of the data being transferred. */
  dataClassification: string;
  /** Purpose of the data transfer. */
  purpose: string;
  /** Whether the data is encrypted in transit. */
  encrypted: boolean;
}

/** Result of validating a data flow. */
export interface DataFlowValidationResult {
  /** Whether the data flow is valid. */
  valid: boolean;
  /** Compliance violations (empty when valid). */
  violations: string[];
}

/** Result of a residency guardrail check. */
export interface ResidencyGuardrailResult {
  /** Whether the transfer is allowed. */
  allowed: boolean;
  /** Reason for the decision. */
  reason: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Check whether a region is in the compliant primary regions list.
 *
 * @param region - AWS region identifier
 * @returns `true` if the region is compliant for primary data storage
 */
export function isCompliantRegion(region: string): boolean {
  return (COMPLIANT_REGIONS as readonly string[]).includes(region);
}

/**
 * Check whether a region is in the compliant backup regions list.
 *
 * @param region - AWS region identifier
 * @returns `true` if the region is compliant for backup storage
 */
export function isCompliantBackupRegion(region: string): boolean {
  return (COMPLIANT_BACKUP_REGIONS as readonly string[]).includes(region);
}

/**
 * Check whether a string is a valid data classification level.
 *
 * @param level - classification level to check
 * @returns `true` if the level is one of the known classification levels
 */
function isValidClassification(level: string): level is DataClassificationLevel {
  return (DATA_CLASSIFICATION_LEVELS as readonly string[]).includes(level);
}

/**
 * Check whether a classification level requires encryption.
 *
 * Confidential and restricted data must always be encrypted.
 *
 * @param level - classification level
 * @returns `true` if encryption is mandatory for this level
 */
function requiresEncryption(level: string): boolean {
  return level === 'confidential' || level === 'restricted';
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a data residency configuration.
 *
 * Checks:
 * - primaryRegion must be in COMPLIANT_REGIONS
 * - All backupRegions must be in COMPLIANT_BACKUP_REGIONS
 * - dataClassification must be a valid level
 * - encryptionRequired must be true for confidential/restricted data
 *
 * @param config - data residency configuration to validate
 * @returns validation result with any errors
 */
export function validateDataResidencyConfig(
  config: DataResidencyConfig,
): DataResidencyValidationResult {
  const errors: string[] = [];

  if (!isCompliantRegion(config.primaryRegion)) {
    errors.push(
      `primaryRegion must be in compliant regions [${COMPLIANT_REGIONS.join(', ')}], got "${config.primaryRegion}"`,
    );
  }

  for (const region of config.backupRegions) {
    if (!isCompliantBackupRegion(region)) {
      errors.push(
        `backup region "${region}" is not in compliant backup regions [${COMPLIANT_BACKUP_REGIONS.join(', ')}]`,
      );
    }
  }

  if (!isValidClassification(config.dataClassification)) {
    errors.push(
      `dataClassification must be one of [${DATA_CLASSIFICATION_LEVELS.join(', ')}], got "${config.dataClassification}"`,
    );
  }

  if (requiresEncryption(config.dataClassification) && !config.encryptionRequired) {
    errors.push(`encryptionRequired must be true for "${config.dataClassification}" data`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a data flow record for residency compliance.
 *
 * Checks:
 * - sourceRegion must be in COMPLIANT_REGIONS
 * - destinationRegion must be in COMPLIANT_BACKUP_REGIONS
 * - Confidential/restricted data must be encrypted
 *
 * @param flow - data flow record to validate
 * @returns validation result with any violations
 */
export function validateDataFlow(flow: DataFlowRecord): DataFlowValidationResult {
  const violations: string[] = [];

  if (!isCompliantRegion(flow.sourceRegion)) {
    violations.push(
      `source region "${flow.sourceRegion}" is not in compliant regions [${COMPLIANT_REGIONS.join(', ')}]`,
    );
  }

  if (!isCompliantBackupRegion(flow.destinationRegion)) {
    violations.push(
      `destination region "${flow.destinationRegion}" is not in compliant regions [${COMPLIANT_BACKUP_REGIONS.join(', ')}]`,
    );
  }

  if (requiresEncryption(flow.dataClassification) && !flow.encrypted) {
    violations.push(`"${flow.dataClassification}" data must be encrypted in transit`);
  }

  return { valid: violations.length === 0, violations };
}

/**
 * Check a residency guardrail for a proposed data transfer.
 *
 * For non-public data, the target region must be in COMPLIANT_REGIONS.
 * For public data, the target region must be in COMPLIANT_BACKUP_REGIONS.
 *
 * @param targetRegion - proposed destination region
 * @param dataClassification - classification level of the data
 * @returns guardrail result indicating whether the transfer is allowed
 */
export function checkResidencyGuardrail(
  targetRegion: string,
  dataClassification: string,
): ResidencyGuardrailResult {
  if (dataClassification !== 'public') {
    if (!isCompliantRegion(targetRegion)) {
      return {
        allowed: false,
        reason: `Non-public ("${dataClassification}") data cannot be transferred to "${targetRegion}"; must be in [${COMPLIANT_REGIONS.join(', ')}]`,
      };
    }
    return {
      allowed: true,
      reason: `Region "${targetRegion}" is compliant for "${dataClassification}" data`,
    };
  }

  if (!isCompliantBackupRegion(targetRegion)) {
    return {
      allowed: false,
      reason: `Public data cannot be transferred to "${targetRegion}"; must be in [${COMPLIANT_BACKUP_REGIONS.join(', ')}]`,
    };
  }

  return {
    allowed: true,
    reason: `Region "${targetRegion}" is compliant for public data`,
  };
}
