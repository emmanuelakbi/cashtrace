/**
 * Rollback validation and eligibility logic.
 *
 * Provides pure functions to validate rollback requests, check time constraints,
 * and determine rollback eligibility. Requirement 2.4 mandates rollback to
 * previous version within 5 minutes.
 *
 * @module deployment/rollback
 */

import type { Deployment } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Maximum allowed rollback duration in seconds (5 minutes per Req 2.4). */
export const MAX_ROLLBACK_SECONDS = 300;

/** Environments that support rollback. */
export const ROLLBACK_ENVIRONMENTS = ['staging', 'production'] as const;

export type RollbackEnvironment = (typeof ROLLBACK_ENVIRONMENTS)[number];

// ─── Types ───────────────────────────────────────────────────────────────────

/** A request to initiate a rollback. */
export interface RollbackRequest {
  /** Target environment. */
  environment: string;
  /** Version to roll back to (omit to use previous version). */
  targetVersion?: string;
  /** Who initiated the rollback. */
  initiatedBy: string;
  /** Maximum time in seconds for the rollback to complete. */
  timeoutSeconds?: number;
}

/** Result of a rollback validation check. */
export interface RollbackValidationResult {
  /** Whether the rollback request is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** Result of a rollback time-limit check. */
export interface RollbackTimeResult {
  /** Whether the rollback completed within the time limit. */
  withinLimit: boolean;
  /** Elapsed time in seconds. */
  elapsedSeconds: number;
  /** The time limit that was applied in seconds. */
  limitSeconds: number;
}

/** Result of a rollback eligibility check. */
export interface RollbackEligibilityResult {
  /** Whether the deployment is eligible for rollback. */
  eligible: boolean;
  /** Reasons why rollback is not eligible (empty when eligible). */
  reasons: string[];
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate a rollback request.
 *
 * Checks:
 * - Environment is a supported rollback environment
 * - initiatedBy is non-empty
 * - targetVersion, if provided, is non-empty
 * - timeoutSeconds, if provided, is positive and ≤ MAX_ROLLBACK_SECONDS
 */
export function validateRollbackRequest(request: RollbackRequest): RollbackValidationResult {
  const errors: string[] = [];

  if (
    !request.environment ||
    !ROLLBACK_ENVIRONMENTS.includes(request.environment as RollbackEnvironment)
  ) {
    errors.push(
      `Invalid environment "${request.environment}". Must be one of: ${ROLLBACK_ENVIRONMENTS.join(', ')}`,
    );
  }

  if (!request.initiatedBy || request.initiatedBy.trim() === '') {
    errors.push('initiatedBy must be a non-empty string');
  }

  if (request.targetVersion !== undefined && request.targetVersion.trim() === '') {
    errors.push('targetVersion, when provided, must be non-empty');
  }

  if (request.timeoutSeconds !== undefined) {
    if (request.timeoutSeconds <= 0) {
      errors.push('timeoutSeconds must be positive');
    } else if (request.timeoutSeconds > MAX_ROLLBACK_SECONDS) {
      errors.push(
        `timeoutSeconds (${request.timeoutSeconds}) exceeds maximum of ${MAX_ROLLBACK_SECONDS}s`,
      );
    }
  }

  return { valid: errors.length === 0, errors };
}

// ─── Time-limit check ────────────────────────────────────────────────────────

/**
 * Check whether a rollback completed within the allowed time limit.
 *
 * @param startedAt  - When the rollback started
 * @param completedAt - When the rollback completed
 * @param limitSeconds - Time limit in seconds (defaults to MAX_ROLLBACK_SECONDS)
 */
export function checkRollbackTimeLimit(
  startedAt: Date,
  completedAt: Date,
  limitSeconds: number = MAX_ROLLBACK_SECONDS,
): RollbackTimeResult {
  const elapsedMs = completedAt.getTime() - startedAt.getTime();
  const elapsedSeconds = Math.max(0, Math.ceil(elapsedMs / 1000));

  return {
    withinLimit: elapsedSeconds <= limitSeconds,
    elapsedSeconds,
    limitSeconds,
  };
}

// ─── Eligibility ─────────────────────────────────────────────────────────────

/**
 * Determine whether a deployment is eligible for rollback.
 *
 * A deployment is eligible when:
 * - It has a previous version to roll back to (previousDeployment provided)
 * - The current deployment is not itself a rollback (no rollbackOf)
 * - The current deployment is not already in a rolling-back state (status !== 'rolled_back')
 * - The current deployment status is 'failed' or 'succeeded'
 */
export function checkRollbackEligibility(
  current: Deployment,
  previousDeployment?: Deployment,
): RollbackEligibilityResult {
  const reasons: string[] = [];

  if (!previousDeployment) {
    reasons.push('No previous deployment available to roll back to');
  }

  if (current.rollbackOf) {
    reasons.push('Current deployment is already a rollback');
  }

  if (current.status === 'rolled_back') {
    reasons.push('Deployment has already been rolled back');
  }

  if (current.status === 'in_progress' || current.status === 'pending') {
    reasons.push(`Cannot roll back a deployment with status "${current.status}"`);
  }

  return { eligible: reasons.length === 0, reasons };
}
