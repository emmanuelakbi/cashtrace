/**
 * CDN configuration validation for African edge deployment.
 *
 * Provides pure functions to validate CDN distribution configurations,
 * cache behaviors, and compression settings.
 * Supports Requirements 9.1–9.3 (CDN configuration and edge caching).
 *
 * @module deployment/cdnConfig
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Valid compression algorithms for CDN distributions. */
export const VALID_COMPRESSION = ['gzip', 'br'] as const;

/** Default cache TTL in seconds (24 hours). */
export const DEFAULT_TTL_SECONDS = 86400;

/** Maximum allowed cache TTL in seconds (1 year). */
export const MAX_TTL_SECONDS = 31536000;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A single cache behavior rule for a CDN distribution. */
export interface CacheBehavior {
  /** URL path pattern to match (e.g. `/api/*`). */
  pathPattern: string;
  /** Cache time-to-live in seconds. */
  ttlSeconds: number;
  /** HTTP methods allowed for this path. */
  allowedMethods: string[];
}

/** Complete CDN distribution configuration. */
export interface CdnConfig {
  /** CloudFront distribution identifier. */
  distributionId: string;
  /** Origin server URLs. */
  origins: string[];
  /** Cache behavior rules. */
  cacheBehaviors: CacheBehavior[];
  /** Whether compression is enabled. */
  compressionEnabled: boolean;
  /** Compression algorithms in use. */
  compressionTypes: string[];
  /** Whether to enforce HTTPS-only connections. */
  httpsOnly: boolean;
  /** AWS region for the distribution. */
  region: string;
}

/** Result of validating a CDN configuration. */
export interface CdnValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a complete CDN configuration.
 *
 * Checks:
 * - distributionId must be non-empty
 * - At least one origin is required
 * - httpsOnly must be true
 * - compressionTypes must all be in VALID_COMPRESSION
 * - Each cacheBehavior must have a non-empty pathPattern,
 *   ttlSeconds in [0, MAX_TTL_SECONDS], and non-empty allowedMethods
 * - region must be 'af-south-1'
 */
export function validateCdnConfig(config: CdnConfig): CdnValidationResult {
  const errors: string[] = [];

  if (!config.distributionId || config.distributionId.trim().length === 0) {
    errors.push('distributionId must be non-empty');
  }

  if (config.origins.length === 0) {
    errors.push('Must have at least one origin');
  }

  if (!config.httpsOnly) {
    errors.push('httpsOnly must be true');
  }

  for (const ct of config.compressionTypes) {
    if (!(VALID_COMPRESSION as readonly string[]).includes(ct)) {
      errors.push(
        `Invalid compression type "${ct}". Must be one of: ${VALID_COMPRESSION.join(', ')}`,
      );
    }
  }

  for (const cb of config.cacheBehaviors) {
    if (!cb.pathPattern || cb.pathPattern.trim().length === 0) {
      errors.push('Cache behavior pathPattern must be non-empty');
    }

    if (cb.ttlSeconds < 0 || cb.ttlSeconds > MAX_TTL_SECONDS) {
      errors.push(
        `Cache behavior ttlSeconds must be between 0 and ${MAX_TTL_SECONDS}, got ${cb.ttlSeconds}`,
      );
    }

    if (cb.allowedMethods.length === 0) {
      errors.push('Cache behavior allowedMethods must be non-empty');
    }
  }

  if (config.region !== 'af-south-1') {
    errors.push(`Region must be "af-south-1", got "${config.region}"`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether a CDN configuration targets the African edge region.
 *
 * Returns `true` if the region is `af-south-1`.
 */
export function supportsAfricanEdge(config: CdnConfig): boolean {
  return config.region === 'af-south-1';
}
