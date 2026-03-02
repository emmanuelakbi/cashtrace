/**
 * Preview environment validation and configuration.
 *
 * Provides pure functions to validate preview environment requests,
 * check capacity, and build configurations for ephemeral PR environments.
 * Requirement 3.4 mandates preview environments for pull requests.
 *
 * @module deployment/previewEnvironment
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum number of concurrent preview environments. */
export const MAX_PREVIEW_ENVIRONMENTS = 10;

/** Auto-cleanup TTL for preview environments in hours. */
export const PREVIEW_TTL_HOURS = 72;

/** Valid preview URL format. */
export const PREVIEW_URL_PATTERN = /^https:\/\/pr-\d+\.preview\.cashtrace\.ng$/;

// ─── Types ───────────────────────────────────────────────────────────────────

/** A request to create a preview environment. */
export interface PreviewEnvironmentRequest {
  /** Pull request number. */
  pullRequestNumber: number;
  /** Source branch name. */
  branch: string;
  /** Git commit SHA. */
  commitSha: string;
  /** User who requested the preview. */
  requestedBy: string;
}

/** Configuration for a preview environment. */
export interface PreviewEnvironmentConfig {
  /** Environment name (e.g. "pr-42-preview"). */
  name: string;
  /** Preview URL. */
  url: string;
  /** Associated pull request number. */
  pullRequestNumber: number;
  /** Source branch name. */
  branch: string;
  /** Git commit SHA. */
  commitSha: string;
  /** When the environment was created. */
  createdAt: Date;
  /** When the environment expires. */
  expiresAt: Date;
  /** Current lifecycle status. */
  status: 'creating' | 'ready' | 'expired' | 'destroying';
}

/** Result of validating a preview environment request. */
export interface PreviewValidationResult {
  /** Whether the request is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** Result of checking preview environment capacity. */
export interface PreviewCapacityResult {
  /** Whether capacity is available. */
  available: boolean;
  /** Number of currently active environments. */
  currentCount: number;
  /** Maximum allowed environments. */
  maxCount: number;
  /** Reason when capacity is unavailable. */
  reason?: string;
}

// ─── Name & URL Generation ───────────────────────────────────────────────────

/**
 * Generate a preview environment name from a pull request number.
 *
 * @param pullRequestNumber - The PR number
 * @returns Environment name in the format `pr-{number}-preview`
 */
export function generatePreviewName(pullRequestNumber: number): string {
  return `pr-${pullRequestNumber}-preview`;
}

/**
 * Generate a preview environment URL from a pull request number.
 *
 * @param pullRequestNumber - The PR number
 * @returns URL in the format `https://pr-{number}.preview.cashtrace.ng`
 */
export function generatePreviewUrl(pullRequestNumber: number): string {
  return `https://pr-${pullRequestNumber}.preview.cashtrace.ng`;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/** Pattern for valid git commit SHAs (7–40 hex characters). */
const COMMIT_SHA_PATTERN = /^[a-f0-9]{7,40}$/;

/**
 * Validate a preview environment request.
 *
 * Checks:
 * - pullRequestNumber is a positive integer
 * - branch is non-empty
 * - commitSha is non-empty and matches the hex SHA pattern
 * - requestedBy is non-empty
 */
export function validatePreviewRequest(
  request: PreviewEnvironmentRequest,
): PreviewValidationResult {
  const errors: string[] = [];

  if (!Number.isInteger(request.pullRequestNumber) || request.pullRequestNumber <= 0) {
    errors.push('pullRequestNumber must be a positive integer');
  }

  if (!request.branch || request.branch.trim() === '') {
    errors.push('branch must be a non-empty string');
  }

  if (!request.commitSha || request.commitSha.trim() === '') {
    errors.push('commitSha must be a non-empty string');
  } else if (!COMMIT_SHA_PATTERN.test(request.commitSha)) {
    errors.push('commitSha must be a 7–40 character hex string');
  }

  if (!request.requestedBy || request.requestedBy.trim() === '') {
    errors.push('requestedBy must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Capacity ────────────────────────────────────────────────────────────────

/**
 * Check whether there is capacity for a new preview environment.
 *
 * Only environments with status `creating` or `ready` count as active.
 */
export function checkPreviewCapacity(
  activeEnvironments: PreviewEnvironmentConfig[],
): PreviewCapacityResult {
  const currentCount = activeEnvironments.filter(
    (env) => env.status === 'creating' || env.status === 'ready',
  ).length;

  const available = currentCount < MAX_PREVIEW_ENVIRONMENTS;

  return {
    available,
    currentCount,
    maxCount: MAX_PREVIEW_ENVIRONMENTS,
    ...(available
      ? {}
      : { reason: `Maximum of ${MAX_PREVIEW_ENVIRONMENTS} preview environments reached` }),
  };
}

// ─── Expiration ──────────────────────────────────────────────────────────────

/**
 * Determine whether a preview environment has expired.
 *
 * @param config - The preview environment configuration
 * @param now - Current time (defaults to `new Date()`)
 * @returns `true` if the environment is past its expiry or has status `expired`
 */
export function isPreviewExpired(
  config: PreviewEnvironmentConfig,
  now: Date = new Date(),
): boolean {
  return config.status === 'expired' || now >= config.expiresAt;
}

// ─── Config Builder ──────────────────────────────────────────────────────────

/**
 * Build a preview environment configuration from a request.
 *
 * Sets `createdAt` to now and `expiresAt` to now + {@link PREVIEW_TTL_HOURS}.
 * Initial status is `creating`.
 */
export function buildPreviewConfig(request: PreviewEnvironmentRequest): PreviewEnvironmentConfig {
  const now = new Date();
  const expiresAt = new Date(now.getTime() + PREVIEW_TTL_HOURS * 60 * 60 * 1000);

  return {
    name: generatePreviewName(request.pullRequestNumber),
    url: generatePreviewUrl(request.pullRequestNumber),
    pullRequestNumber: request.pullRequestNumber,
    branch: request.branch,
    commitSha: request.commitSha,
    createdAt: now,
    expiresAt,
    status: 'creating',
  };
}
