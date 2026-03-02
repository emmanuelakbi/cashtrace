/**
 * CI Pipeline configuration validation and stage checking.
 *
 * Provides programmatic representation of CI pipeline configuration
 * with validation functions for ensuring all required stages are present.
 *
 * @module deployment/ciPipeline
 */

import type { CIPipeline, CIStage } from './types.js';

// ─── Required CI Stages ──────────────────────────────────────────────────────

/** Stage names that must be present for a valid CI pipeline. */
export const REQUIRED_CI_STAGES = ['lint', 'typecheck', 'test'] as const;

export type RequiredCIStageName = (typeof REQUIRED_CI_STAGES)[number];

// ─── Validation Result ───────────────────────────────────────────────────────

/** Result of a CI pipeline validation check. */
export interface CIPipelineValidationResult {
  /** Whether the pipeline configuration is valid. */
  valid: boolean;
  /** List of validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation Functions ────────────────────────────────────────────────────

/**
 * Check whether all required CI stages are present in the pipeline.
 *
 * Returns the list of missing stage names. An empty array means all
 * required stages are present.
 */
export function getMissingStages(pipeline: CIPipeline): string[] {
  const stageNames = new Set(pipeline.stages.map((s) => s.name));
  return REQUIRED_CI_STAGES.filter((name) => !stageNames.has(name));
}

/**
 * Check whether a specific stage has at least one job with steps.
 */
export function stageHasJobs(stage: CIStage): boolean {
  return stage.jobs.length > 0 && stage.jobs.every((j) => j.steps.length > 0);
}

/**
 * Validate a CI pipeline configuration.
 *
 * Checks:
 * - Pipeline has a valid trigger
 * - All required stages are present
 * - Every stage has at least one job with steps
 * - Job timeouts are positive
 * - Job retries are non-negative
 */
export function validateCIPipeline(pipeline: CIPipeline): CIPipelineValidationResult {
  const errors: string[] = [];

  // Trigger validation
  const validTriggers = ['push', 'pull_request', 'schedule', 'manual'];
  if (!validTriggers.includes(pipeline.trigger)) {
    errors.push(`Invalid trigger: "${pipeline.trigger}"`);
  }

  // Required stages
  const missing = getMissingStages(pipeline);
  if (missing.length > 0) {
    errors.push(`Missing required stages: ${missing.join(', ')}`);
  }

  // Stage-level checks
  for (const stage of pipeline.stages) {
    if (!stage.name || stage.name.trim() === '') {
      errors.push('Stage has empty name');
    }

    if (!stageHasJobs(stage)) {
      errors.push(`Stage "${stage.name}" must have at least one job with steps`);
    }

    for (const job of stage.jobs) {
      if (job.timeout <= 0) {
        errors.push(`Job "${job.name}" in stage "${stage.name}" has non-positive timeout`);
      }
      if (job.retries < 0) {
        errors.push(`Job "${job.name}" in stage "${stage.name}" has negative retries`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Check whether all required stages are present in the pipeline.
 *
 * Convenience wrapper around `getMissingStages` that returns a boolean.
 */
export function hasAllRequiredStages(pipeline: CIPipeline): boolean {
  return getMissingStages(pipeline).length === 0;
}
