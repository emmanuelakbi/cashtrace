import { describe, expect, it } from 'vitest';

import { canDeployToProduction, canDeployToStaging, validateCDPipeline } from './cdPipeline.js';
import type { DeploymentState } from './cdPipeline.js';
import {
  makeApprovalGate,
  makeCDPipeline,
  makeDeploymentStrategy,
  makeEnvironment,
  makeRollbackConfig,
} from './testHelpers.js';

// ─── validateCDPipeline ──────────────────────────────────────────────────────

describe('validateCDPipeline', () => {
  it('should return valid for a well-formed pipeline', () => {
    const pipeline = makeCDPipeline({
      environments: [
        makeEnvironment({ name: 'staging', requiresApproval: false }),
        makeEnvironment({ name: 'production', requiresApproval: true }),
      ],
      approvals: [makeApprovalGate({ environment: 'production' })],
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should report error when no environments are configured', () => {
    const pipeline = makeCDPipeline({ environments: [] });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('At least one environment'))).toBe(true);
  });

  it('should report error for environment with empty name', () => {
    const pipeline = makeCDPipeline({
      environments: [makeEnvironment({ name: '' })],
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-empty name'))).toBe(true);
  });

  it('should report error for environment with empty url', () => {
    const pipeline = makeCDPipeline({
      environments: [makeEnvironment({ url: '' })],
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-empty url'))).toBe(true);
  });

  it('should report error for invalid deployment strategy type', () => {
    const pipeline = makeCDPipeline({
      deploymentStrategy: makeDeploymentStrategy({
        type: 'invalid' as 'rolling',
      }),
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid deployment strategy type'))).toBe(true);
  });

  it('should report error for empty healthCheckPath', () => {
    const pipeline = makeCDPipeline({
      deploymentStrategy: makeDeploymentStrategy({ healthCheckPath: '' }),
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-empty healthCheckPath'))).toBe(true);
  });

  it('should report error for non-positive healthCheckTimeout', () => {
    const pipeline = makeCDPipeline({
      deploymentStrategy: makeDeploymentStrategy({ healthCheckTimeout: 0 }),
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('healthCheckTimeout must be positive'))).toBe(true);
  });

  it('should report error when approval gate is missing for required environment', () => {
    const pipeline = makeCDPipeline({
      environments: [makeEnvironment({ name: 'production', requiresApproval: true })],
      approvals: [],
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(
      result.errors.some((e) => e.includes('requires approval but has no approval gate')),
    ).toBe(true);
  });

  it('should report error when approval gate has no approvers', () => {
    const pipeline = makeCDPipeline({
      environments: [makeEnvironment({ name: 'production', requiresApproval: true })],
      approvals: [makeApprovalGate({ environment: 'production', approvers: [] })],
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('at least one approver'))).toBe(true);
  });

  it('should report error for non-positive rollback healthCheckFailures', () => {
    const pipeline = makeCDPipeline({
      rollback: makeRollbackConfig({ healthCheckFailures: 0 }),
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('healthCheckFailures must be positive'))).toBe(
      true,
    );
  });

  it('should report error for non-positive rollback timeout', () => {
    const pipeline = makeCDPipeline({
      rollback: makeRollbackConfig({ rollbackTimeout: 0 }),
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('rollbackTimeout must be positive'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const pipeline = makeCDPipeline({
      environments: [],
      deploymentStrategy: makeDeploymentStrategy({ healthCheckTimeout: -1 }),
      rollback: makeRollbackConfig({ healthCheckFailures: 0, rollbackTimeout: 0 }),
    });
    const result = validateCDPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── canDeployToStaging ──────────────────────────────────────────────────────

describe('canDeployToStaging', () => {
  it('should allow staging deployment when CI passed', () => {
    const state: DeploymentState = {
      ciPassed: true,
      integrationTestsPassed: false,
      manualApprovalGranted: false,
    };
    const result = canDeployToStaging(state);
    expect(result.canProceed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('should block staging deployment when CI failed', () => {
    const state: DeploymentState = {
      ciPassed: false,
      integrationTestsPassed: false,
      manualApprovalGranted: false,
    };
    const result = canDeployToStaging(state);
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes('CI pipeline must pass'))).toBe(true);
  });
});

// ─── canDeployToProduction ───────────────────────────────────────────────────

describe('canDeployToProduction', () => {
  const readyState: DeploymentState = {
    ciPassed: true,
    stagingStatus: 'succeeded',
    integrationTestsPassed: true,
    manualApprovalGranted: true,
  };

  it('should allow production deployment when all prerequisites are met', () => {
    const result = canDeployToProduction(readyState);
    expect(result.canProceed).toBe(true);
    expect(result.blockers).toEqual([]);
  });

  it('should block when CI has not passed', () => {
    const result = canDeployToProduction({ ...readyState, ciPassed: false });
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes('CI pipeline must pass'))).toBe(true);
  });

  it('should block when staging deployment has not succeeded', () => {
    const result = canDeployToProduction({ ...readyState, stagingStatus: 'failed' });
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes('Staging deployment must succeed'))).toBe(true);
  });

  it('should block when staging status is undefined', () => {
    const result = canDeployToProduction({ ...readyState, stagingStatus: undefined });
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes('Staging deployment must succeed'))).toBe(true);
  });

  it('should block when integration tests have not passed', () => {
    const result = canDeployToProduction({ ...readyState, integrationTestsPassed: false });
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes('Integration tests must pass'))).toBe(true);
  });

  it('should block when manual approval is not granted', () => {
    const result = canDeployToProduction({ ...readyState, manualApprovalGranted: false });
    expect(result.canProceed).toBe(false);
    expect(result.blockers.some((b) => b.includes('Manual approval is required'))).toBe(true);
  });

  it('should report all blockers when nothing is ready', () => {
    const state: DeploymentState = {
      ciPassed: false,
      stagingStatus: undefined,
      integrationTestsPassed: false,
      manualApprovalGranted: false,
    };
    const result = canDeployToProduction(state);
    expect(result.canProceed).toBe(false);
    expect(result.blockers).toHaveLength(4);
  });
});
