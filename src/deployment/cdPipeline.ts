/**
 * CD Pipeline configuration validation and deployment readiness checks.
 *
 * Provides functions to validate CD pipeline configuration and determine
 * whether a deployment can proceed based on prerequisites like CI pass
 * and staging success.
 *
 * @module deployment/cdPipeline
 */

import type { CDPipeline, DeploymentStatus, Environment, RollbackConfig } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Result of a CD pipeline validation check. */
export interface CDPipelineValidationResult {
  /** Whether the pipeline configuration is valid. */
  valid: boolean;
  /** List of validation errors (empty when valid). */
  errors: string[];
}

/** State of a deployment used for readiness checks. */
export interface DeploymentState {
  /** Whether the CI pipeline passed for this commit. */
  ciPassed: boolean;
  /** Status of the staging deployment (undefined if not yet deployed). */
  stagingStatus?: DeploymentStatus;
  /** Whether integration tests passed on staging. */
  integrationTestsPassed: boolean;
  /** Whether manual approval has been granted (for production). */
  manualApprovalGranted: boolean;
}

/** Result of a deployment readiness check. */
export interface DeploymentReadinessResult {
  /** Whether the deployment can proceed. */
  canProceed: boolean;
  /** Reasons why the deployment cannot proceed (empty when ready). */
  blockers: string[];
}

// ─── Validation Functions ────────────────────────────────────────────────────

/**
 * Validate a CD pipeline configuration.
 *
 * Checks:
 * - At least one environment is configured
 * - Each environment has a non-empty name and url
 * - Deployment strategy has a valid type and positive health check timeout
 * - At least one approval gate exists for environments requiring approval
 * - Rollback config has valid thresholds
 */
export function validateCDPipeline(pipeline: CDPipeline): CDPipelineValidationResult {
  const errors: string[] = [];

  // Environment validation
  if (!pipeline.environments || pipeline.environments.length === 0) {
    errors.push('At least one environment must be configured');
  } else {
    for (const env of pipeline.environments) {
      validateEnvironment(env, errors);
    }
  }

  // Deployment strategy validation
  const validStrategies = ['rolling', 'blue_green', 'canary'];
  if (!validStrategies.includes(pipeline.deploymentStrategy.type)) {
    errors.push(`Invalid deployment strategy type: "${pipeline.deploymentStrategy.type}"`);
  }

  if (
    !pipeline.deploymentStrategy.healthCheckPath ||
    pipeline.deploymentStrategy.healthCheckPath.trim() === ''
  ) {
    errors.push('Deployment strategy must have a non-empty healthCheckPath');
  }

  if (pipeline.deploymentStrategy.healthCheckTimeout <= 0) {
    errors.push('Deployment strategy healthCheckTimeout must be positive');
  }

  // Approval gate validation
  const approvalEnvs = pipeline.environments.filter((e) => e.requiresApproval).map((e) => e.name);

  for (const envName of approvalEnvs) {
    const gate = pipeline.approvals.find((a) => a.environment === envName);
    if (!gate) {
      errors.push(`Environment "${envName}" requires approval but has no approval gate`);
    } else if (!gate.approvers || gate.approvers.length === 0) {
      errors.push(`Approval gate for "${envName}" must have at least one approver`);
    }
  }

  // Rollback config validation
  validateRollbackConfig(pipeline.rollback, errors);

  return { valid: errors.length === 0, errors };
}

/**
 * Validate a single environment configuration.
 */
function validateEnvironment(env: Environment, errors: string[]): void {
  if (!env.name || env.name.trim() === '') {
    errors.push('Environment must have a non-empty name');
  }

  if (!env.url || env.url.trim() === '') {
    errors.push(`Environment "${env.name}" must have a non-empty url`);
  }
}

/**
 * Validate rollback configuration.
 */
function validateRollbackConfig(config: RollbackConfig, errors: string[]): void {
  if (config.healthCheckFailures <= 0) {
    errors.push('Rollback healthCheckFailures must be positive');
  }

  if (config.rollbackTimeout <= 0) {
    errors.push('Rollback rollbackTimeout must be positive');
  }
}

// ─── Deployment Readiness ────────────────────────────────────────────────────

/**
 * Determine if a staging deployment can proceed.
 *
 * Prerequisites:
 * - CI must have passed
 */
export function canDeployToStaging(state: DeploymentState): DeploymentReadinessResult {
  const blockers: string[] = [];

  if (!state.ciPassed) {
    blockers.push('CI pipeline must pass before deploying to staging');
  }

  return { canProceed: blockers.length === 0, blockers };
}

/**
 * Determine if a production deployment can proceed.
 *
 * Prerequisites:
 * - CI must have passed
 * - Staging deployment must have succeeded
 * - Integration tests must have passed
 * - Manual approval must be granted
 */
export function canDeployToProduction(state: DeploymentState): DeploymentReadinessResult {
  const blockers: string[] = [];

  if (!state.ciPassed) {
    blockers.push('CI pipeline must pass before deploying to production');
  }

  if (state.stagingStatus !== 'succeeded') {
    blockers.push('Staging deployment must succeed before deploying to production');
  }

  if (!state.integrationTestsPassed) {
    blockers.push('Integration tests must pass before deploying to production');
  }

  if (!state.manualApprovalGranted) {
    blockers.push('Manual approval is required for production deployments');
  }

  return { canProceed: blockers.length === 0, blockers };
}
