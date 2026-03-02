/**
 * Database and caching infrastructure validation for CashTrace deployment.
 *
 * Provides pure functions to validate RDS PostgreSQL and ElastiCache Redis
 * configurations, including backup retention, encryption, and high availability.
 * Supports Requirements 7.1–7.4 (RDS) and 8.1–8.3 (ElastiCache).
 *
 * @module deployment/databaseConfig
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Allowed database engines. */
export const VALID_DB_ENGINES = ['postgres'] as const;

/** Allowed PostgreSQL major versions. */
export const VALID_DB_VERSIONS = ['14', '15', '16'] as const;

/** Minimum backup retention in days. */
export const MIN_BACKUP_RETENTION_DAYS = 7;

/** Maximum backup retention in days. */
export const MAX_BACKUP_RETENTION_DAYS = 35;

/** Default backup retention in days. */
export const DEFAULT_BACKUP_RETENTION_DAYS = 30;

/** Allowed RDS instance classes. */
export const VALID_INSTANCE_CLASSES = [
  'db.t3.micro',
  'db.t3.small',
  'db.t3.medium',
  'db.t3.large',
  'db.r5.large',
  'db.r5.xlarge',
] as const;

/** Allowed ElastiCache node types. */
export const VALID_CACHE_NODE_TYPES = [
  'cache.t3.micro',
  'cache.t3.small',
  'cache.t3.medium',
  'cache.r5.large',
  'cache.r5.xlarge',
] as const;

// ─── Types ───────────────────────────────────────────────────────────────────

/** RDS PostgreSQL configuration. */
export interface RdsConfig {
  /** RDS instance class. */
  instanceClass: string;
  /** Database engine (must be postgres). */
  engine: string;
  /** PostgreSQL major version. */
  engineVersion: string;
  /** Allocated storage in gigabytes. */
  allocatedStorageGb: number;
  /** Whether Multi-AZ deployment is enabled. */
  multiAz: boolean;
  /** Number of days to retain automated backups. */
  backupRetentionDays: number;
  /** Whether point-in-time recovery is enabled. */
  enablePitr: boolean;
  /** Number of read replicas. */
  readReplicas: number;
  /** AWS region for the instance. */
  region: string;
  /** Whether storage encryption is enabled. */
  encrypted: boolean;
}

/** Result of validating an RDS configuration. */
export interface RdsValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** ElastiCache Redis configuration. */
export interface CacheConfig {
  /** Cache node type. */
  nodeType: string;
  /** Number of cache nodes. */
  numNodes: number;
  /** Whether cluster mode is enabled. */
  clusterMode: boolean;
  /** Whether automatic failover is enabled. */
  automaticFailover: boolean;
  /** Whether encryption at rest is enabled. */
  encryptionAtRest: boolean;
  /** Whether encryption in transit is enabled. */
  encryptionInTransit: boolean;
  /** AWS region for the cluster. */
  region: string;
}

/** Result of validating a cache configuration. */
export interface CacheValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate an RDS PostgreSQL configuration.
 *
 * Checks instance class, engine, version, storage, backup retention,
 * read replicas, region, and encryption settings.
 */
export function validateRdsConfig(config: RdsConfig): RdsValidationResult {
  const errors: string[] = [];

  if (!(VALID_INSTANCE_CLASSES as readonly string[]).includes(config.instanceClass)) {
    errors.push(
      `Invalid instance class "${config.instanceClass}". Must be one of: ${VALID_INSTANCE_CLASSES.join(', ')}`,
    );
  }

  if (!(VALID_DB_ENGINES as readonly string[]).includes(config.engine)) {
    errors.push(
      `Invalid engine "${config.engine}". Must be one of: ${VALID_DB_ENGINES.join(', ')}`,
    );
  }

  if (!(VALID_DB_VERSIONS as readonly string[]).includes(config.engineVersion)) {
    errors.push(
      `Invalid engine version "${config.engineVersion}". Must be one of: ${VALID_DB_VERSIONS.join(', ')}`,
    );
  }

  if (config.allocatedStorageGb < 20 || config.allocatedStorageGb > 65536) {
    errors.push(
      `Allocated storage must be between 20 and 65536 GB, got ${config.allocatedStorageGb}`,
    );
  }

  if (
    config.backupRetentionDays < MIN_BACKUP_RETENTION_DAYS ||
    config.backupRetentionDays > MAX_BACKUP_RETENTION_DAYS
  ) {
    errors.push(
      `Backup retention must be between ${MIN_BACKUP_RETENTION_DAYS} and ${MAX_BACKUP_RETENTION_DAYS} days, got ${config.backupRetentionDays}`,
    );
  }

  if (config.readReplicas < 0 || config.readReplicas > 5) {
    errors.push(`Read replicas must be between 0 and 5, got ${config.readReplicas}`);
  }

  if (config.region !== 'af-south-1') {
    errors.push(
      `Invalid region "${config.region}". Must be af-south-1 for data residency compliance`,
    );
  }

  if (!config.encrypted) {
    errors.push('Storage encryption must be enabled');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an ElastiCache Redis configuration.
 *
 * Checks node type, node count, cluster mode constraints,
 * failover requirements, encryption, and region.
 */
export function validateCacheConfig(config: CacheConfig): CacheValidationResult {
  const errors: string[] = [];

  if (!(VALID_CACHE_NODE_TYPES as readonly string[]).includes(config.nodeType)) {
    errors.push(
      `Invalid node type "${config.nodeType}". Must be one of: ${VALID_CACHE_NODE_TYPES.join(', ')}`,
    );
  }

  if (config.numNodes < 1 || config.numNodes > 6) {
    errors.push(`Number of nodes must be between 1 and 6, got ${config.numNodes}`);
  }

  if (config.clusterMode && config.numNodes < 2) {
    errors.push('Cluster mode requires at least 2 nodes');
  }

  if (config.automaticFailover && config.numNodes < 2) {
    errors.push('Automatic failover requires at least 2 nodes');
  }

  if (!config.encryptionAtRest) {
    errors.push('Encryption at rest must be enabled');
  }

  if (!config.encryptionInTransit) {
    errors.push('Encryption in transit must be enabled');
  }

  if (config.region !== 'af-south-1') {
    errors.push(
      `Invalid region "${config.region}". Must be af-south-1 for data residency compliance`,
    );
  }

  return { valid: errors.length === 0, errors };
}

// ─── High Availability ──────────────────────────────────────────────────────

/**
 * Check whether an RDS configuration is highly available.
 *
 * Returns `true` when Multi-AZ is enabled and at least one read replica exists.
 */
export function isHighAvailability(rdsConfig: RdsConfig): boolean {
  return rdsConfig.multiAz && rdsConfig.readReplicas >= 1;
}

/**
 * Check whether a cache configuration is highly available.
 *
 * Returns `true` when cluster mode and automatic failover are enabled
 * with at least two nodes.
 */
export function isCacheHighAvailability(cacheConfig: CacheConfig): boolean {
  return cacheConfig.clusterMode && cacheConfig.automaticFailover && cacheConfig.numNodes >= 2;
}
