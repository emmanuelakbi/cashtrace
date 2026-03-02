/**
 * Property-based tests for Staging Validation.
 *
 * **Property 4: Staging Validation**
 * For any production deployment, it SHALL be preceded by successful staging
 * deployment and integration tests.
 *
 * **Validates: Requirements 2.3**
 *
 * @module deployment/cdPipeline.property.test
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';

import { canDeployToProduction, type DeploymentState } from './cdPipeline.js';
import type { DeploymentStatus } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** All valid DeploymentStatus values. */
const deploymentStatusArb: fc.Arbitrary<DeploymentStatus> = fc.constantFrom(
  'pending',
  'in_progress',
  'succeeded',
  'failed',
  'rolled_back',
);

/** Non-succeeded staging statuses (including undefined). */
const nonSucceededStagingArb: fc.Arbitrary<DeploymentStatus | undefined> = fc.constantFrom(
  undefined,
  'pending',
  'in_progress',
  'failed',
  'rolled_back',
);

/** Arbitrary DeploymentState with full control over all fields. */
const deploymentStateArb: fc.Arbitrary<DeploymentState> = fc.record({
  ciPassed: fc.boolean(),
  stagingStatus: fc.option(deploymentStatusArb, { nil: undefined }),
  integrationTestsPassed: fc.boolean(),
  manualApprovalGranted: fc.boolean(),
});

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Staging Validation (Property 4)', () => {
  /**
   * **Validates: Requirements 2.3**
   * For any DeploymentState where ciPassed=false, canDeployToProduction
   * returns canProceed=false.
   */
  it('blocks production when CI has not passed', () => {
    fc.assert(
      fc.property(
        deploymentStateArb.map((s) => ({ ...s, ciPassed: false })),
        (state) => {
          const result = canDeployToProduction(state);
          expect(result.canProceed).toBe(false);
          expect(result.blockers).toContain('CI pipeline must pass before deploying to production');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   * For any DeploymentState where stagingStatus !== 'succeeded',
   * canDeployToProduction returns canProceed=false.
   */
  it('blocks production when staging has not succeeded', () => {
    fc.assert(
      fc.property(
        deploymentStateArb.chain((s) =>
          nonSucceededStagingArb.map((status) => ({ ...s, stagingStatus: status })),
        ),
        (state) => {
          const result = canDeployToProduction(state);
          expect(result.canProceed).toBe(false);
          expect(result.blockers).toContain(
            'Staging deployment must succeed before deploying to production',
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   * For any DeploymentState where integrationTestsPassed=false,
   * canDeployToProduction returns canProceed=false.
   */
  it('blocks production when integration tests have not passed', () => {
    fc.assert(
      fc.property(
        deploymentStateArb.map((s) => ({ ...s, integrationTestsPassed: false })),
        (state) => {
          const result = canDeployToProduction(state);
          expect(result.canProceed).toBe(false);
          expect(result.blockers).toContain(
            'Integration tests must pass before deploying to production',
          );
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   * For any DeploymentState where ALL prerequisites are met, canDeployToProduction
   * returns canProceed=true with no blockers.
   */
  it('allows production when all prerequisites are met', () => {
    const allMetState: DeploymentState = {
      ciPassed: true,
      stagingStatus: 'succeeded',
      integrationTestsPassed: true,
      manualApprovalGranted: true,
    };

    fc.assert(
      fc.property(fc.constant(allMetState), (state) => {
        const result = canDeployToProduction(state);
        expect(result.canProceed).toBe(true);
        expect(result.blockers).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 2.3**
   * For any DeploymentState, the number of blockers equals the number of
   * unmet prerequisites.
   */
  it('blocker count equals the number of unmet prerequisites', () => {
    fc.assert(
      fc.property(deploymentStateArb, (state) => {
        const result = canDeployToProduction(state);

        let expectedBlockers = 0;
        if (!state.ciPassed) expectedBlockers++;
        if (state.stagingStatus !== 'succeeded') expectedBlockers++;
        if (!state.integrationTestsPassed) expectedBlockers++;
        if (!state.manualApprovalGranted) expectedBlockers++;

        expect(result.blockers).toHaveLength(expectedBlockers);
        expect(result.canProceed).toBe(expectedBlockers === 0);
      }),
      { numRuns: 200 },
    );
  });
});
