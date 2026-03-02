/**
 * Auto-scaling configuration validation and scaling decision logic.
 *
 * Provides pure functions to validate auto-scaling configurations and
 * calculate scaling decisions based on resource utilisation metrics.
 * Supports Requirement 5.2 — scaling response time limits.
 *
 * @module deployment/autoScaling
 */

import type { AutoScalingConfig } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** Absolute minimum number of replicas. */
export const MIN_REPLICAS_FLOOR = 1;

/** Absolute maximum number of replicas. */
export const MAX_REPLICAS_CEILING = 100;

/** Minimum target CPU/memory percentage. */
export const MIN_TARGET_PERCENT = 10;

/** Maximum target CPU/memory percentage. */
export const MAX_TARGET_PERCENT = 90;

/** Minimum scale-down cooldown in seconds. */
export const MIN_SCALE_DOWN_DELAY = 60;

/** Maximum scale-down cooldown in seconds. */
export const MAX_SCALE_DOWN_DELAY = 3600;

/** Maximum allowed scaling response time in seconds (Requirement 5.2, Property 9). */
export const MAX_SCALING_RESPONSE_SECONDS = 180;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result of an auto-scaling configuration validation check. */
export interface AutoScalingValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** List of validation errors (empty when valid). */
  errors: string[];
}

/** A scaling decision produced by evaluating current utilisation. */
export interface ScalingDecision {
  /** Whether a scaling action should be taken. */
  shouldScale: boolean;
  /** Direction of the scaling action. */
  direction: 'up' | 'down' | 'none';
  /** Current number of replicas before scaling. */
  currentReplicas: number;
  /** Desired number of replicas after scaling. */
  targetReplicas: number;
  /** Human-readable reason for the decision. */
  reason: string;
}

/** Resource utilisation snapshot at a point in time. */
export interface ResourceUtilization {
  /** CPU utilisation percentage (0–100). */
  cpuPercent: number;
  /** Memory utilisation percentage (0–100). */
  memoryPercent: number;
  /** When the measurement was taken. */
  timestamp: Date;
}

// ─── Validation ──────────────────────────────────────────────────────────────

/**
 * Validate an auto-scaling configuration against allowed bounds.
 *
 * Checks:
 * - minReplicas >= MIN_REPLICAS_FLOOR
 * - maxReplicas <= MAX_REPLICAS_CEILING
 * - maxReplicas >= minReplicas
 * - targetCPU between MIN_TARGET_PERCENT and MAX_TARGET_PERCENT
 * - targetMemory between MIN_TARGET_PERCENT and MAX_TARGET_PERCENT
 * - scaleDownDelay between MIN_SCALE_DOWN_DELAY and MAX_SCALE_DOWN_DELAY
 */
export function validateAutoScalingConfig(config: AutoScalingConfig): AutoScalingValidationResult {
  const errors: string[] = [];

  if (config.minReplicas < MIN_REPLICAS_FLOOR) {
    errors.push(`minReplicas must be >= ${MIN_REPLICAS_FLOOR}, got ${config.minReplicas}`);
  }

  if (config.maxReplicas > MAX_REPLICAS_CEILING) {
    errors.push(`maxReplicas must be <= ${MAX_REPLICAS_CEILING}, got ${config.maxReplicas}`);
  }

  if (config.maxReplicas < config.minReplicas) {
    errors.push(
      `maxReplicas (${config.maxReplicas}) must be >= minReplicas (${config.minReplicas})`,
    );
  }

  if (config.targetCPU < MIN_TARGET_PERCENT || config.targetCPU > MAX_TARGET_PERCENT) {
    errors.push(
      `targetCPU must be between ${MIN_TARGET_PERCENT} and ${MAX_TARGET_PERCENT}, got ${config.targetCPU}`,
    );
  }

  if (config.targetMemory < MIN_TARGET_PERCENT || config.targetMemory > MAX_TARGET_PERCENT) {
    errors.push(
      `targetMemory must be between ${MIN_TARGET_PERCENT} and ${MAX_TARGET_PERCENT}, got ${config.targetMemory}`,
    );
  }

  if (
    config.scaleDownDelay < MIN_SCALE_DOWN_DELAY ||
    config.scaleDownDelay > MAX_SCALE_DOWN_DELAY
  ) {
    errors.push(
      `scaleDownDelay must be between ${MIN_SCALE_DOWN_DELAY} and ${MAX_SCALE_DOWN_DELAY}, got ${config.scaleDownDelay}`,
    );
  }

  return { valid: errors.length === 0, errors };
}

// ─── Scaling Decision ────────────────────────────────────────────────────────

/**
 * Calculate a scaling decision based on current utilisation and config.
 *
 * Rules:
 * - Scale up when cpuPercent > targetCPU OR memoryPercent > targetMemory.
 *   Target replicas = min(maxReplicas, currentReplicas + ceil(currentReplicas * 0.5)).
 * - Scale down when cpuPercent < targetCPU * 0.5 AND memoryPercent < targetMemory * 0.5.
 *   Target replicas = max(minReplicas, currentReplicas - 1).
 * - Otherwise no change.
 * - Result is always clamped to [minReplicas, maxReplicas].
 */
export function calculateScalingDecision(
  config: AutoScalingConfig,
  currentReplicas: number,
  utilization: ResourceUtilization,
): ScalingDecision {
  const { cpuPercent, memoryPercent } = utilization;
  const scaleUpNeeded = cpuPercent > config.targetCPU || memoryPercent > config.targetMemory;
  const scaleDownNeeded =
    cpuPercent < config.targetCPU * 0.5 && memoryPercent < config.targetMemory * 0.5;

  if (scaleUpNeeded) {
    const raw = currentReplicas + Math.ceil(currentReplicas * 0.5);
    const targetReplicas = Math.min(config.maxReplicas, Math.max(config.minReplicas, raw));
    return {
      shouldScale: targetReplicas !== currentReplicas,
      direction: 'up',
      currentReplicas,
      targetReplicas,
      reason:
        `Utilisation (CPU: ${cpuPercent}%, Memory: ${memoryPercent}%) exceeds targets ` +
        `(CPU: ${config.targetCPU}%, Memory: ${config.targetMemory}%)`,
    };
  }

  if (scaleDownNeeded) {
    const raw = currentReplicas - 1;
    const targetReplicas = Math.max(config.minReplicas, Math.min(config.maxReplicas, raw));
    return {
      shouldScale: targetReplicas !== currentReplicas,
      direction: 'down',
      currentReplicas,
      targetReplicas,
      reason:
        `Utilisation (CPU: ${cpuPercent}%, Memory: ${memoryPercent}%) below 50% of targets ` +
        `(CPU: ${config.targetCPU}%, Memory: ${config.targetMemory}%)`,
    };
  }

  return {
    shouldScale: false,
    direction: 'none',
    currentReplicas,
    targetReplicas: currentReplicas,
    reason: 'Utilisation within acceptable range',
  };
}

// ─── Scaling Response Time ───────────────────────────────────────────────────

/**
 * Check whether a scaling operation completed within the allowed time limit.
 *
 * Returns `true` if the elapsed time between start and completion is
 * at most {@link MAX_SCALING_RESPONSE_SECONDS} seconds.
 */
export function isScalingResponseWithinLimit(
  scalingStarted: Date,
  scalingCompleted: Date,
): boolean {
  const elapsedMs = scalingCompleted.getTime() - scalingStarted.getTime();
  return elapsedMs <= MAX_SCALING_RESPONSE_SECONDS * 1000;
}
