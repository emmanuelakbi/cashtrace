/**
 * Property-based tests for CI Pipeline validation.
 *
 * **Property 1: CI Gate Enforcement**
 * For any pull request, merge SHALL be blocked until all CI stages pass.
 *
 * **Validates: Requirements 1.7**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';

import {
  getMissingStages,
  REQUIRED_CI_STAGES,
  stageHasJobs,
  validateCIPipeline,
} from './ciPipeline.js';
import { makeCIJob, makeCIPipeline, makeCIStage, makeJobStep } from './testHelpers.js';
import type { CIStage, PipelineTrigger } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid PipelineTrigger. */
const triggerArb = fc.constantFrom<PipelineTrigger>('push', 'pull_request', 'schedule', 'manual');

/** Generate a valid JobStep with at least a name and one action. */
const jobStepArb = fc
  .record({
    name: fc.string({ minLength: 1, maxLength: 30 }),
    run: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
    uses: fc.option(fc.string({ minLength: 1, maxLength: 50 }), { nil: undefined }),
  })
  .map((s) => makeJobStep({ name: s.name, run: s.run, uses: s.uses }));

/** Generate a valid CIJob with positive timeout, non-negative retries, and at least one step. */
const validJobArb = fc
  .record({
    name: fc.string({ minLength: 1, maxLength: 20 }),
    timeout: fc.integer({ min: 1, max: 120 }),
    retries: fc.nat({ max: 5 }),
    steps: fc.array(jobStepArb, { minLength: 1, maxLength: 3 }),
  })
  .map((j) => makeCIJob({ name: j.name, timeout: j.timeout, retries: j.retries, steps: j.steps }));

/** Generate a valid CIStage with a given name and at least one valid job. */
const validStageArb = (name: string): fc.Arbitrary<CIStage> =>
  fc.array(validJobArb, { minLength: 1, maxLength: 3 }).map((jobs) => makeCIStage({ name, jobs }));

/**
 * Generate a complete valid CI pipeline with all required stages
 * (lint, typecheck, test), each having valid jobs.
 */
const validPipelineArb = fc
  .tuple(
    triggerArb,
    validStageArb('lint'),
    validStageArb('typecheck'),
    validStageArb('test'),
    fc.array(
      fc.string({ minLength: 1, maxLength: 15 }).chain((name) => validStageArb(name)),
      { minLength: 0, maxLength: 2 },
    ),
  )
  .map(([trigger, lint, typecheck, test, extras]) =>
    makeCIPipeline({ trigger, stages: [lint, typecheck, test, ...extras] }),
  );

/**
 * Generate a CI pipeline that is missing at least one required stage.
 * We pick a non-empty strict subset of required stages to include.
 */
const pipelineMissingStagesArb = fc
  .tuple(
    triggerArb,
    fc.subarray([...REQUIRED_CI_STAGES], {
      minLength: 0,
      maxLength: REQUIRED_CI_STAGES.length - 1,
    }),
  )
  .chain(([trigger, includedNames]) =>
    includedNames.length === 0
      ? fc.constant(makeCIPipeline({ trigger, stages: [] }))
      : fc
          .tuple(...includedNames.map((n) => validStageArb(n)))
          .map((stages) => makeCIPipeline({ trigger, stages })),
  );

/** Generate a CIStage with no jobs. */
const stageNoJobsArb = fc
  .string({ minLength: 1, maxLength: 20 })
  .map((name) => makeCIStage({ name, jobs: [] }));

/** Generate a CIStage where every job has zero steps. */
const stageEmptyStepsArb = fc
  .tuple(
    fc.string({ minLength: 1, maxLength: 20 }),
    fc.array(
      fc.string({ minLength: 1, maxLength: 20 }).map((name) => makeCIJob({ name, steps: [] })),
      { minLength: 1, maxLength: 3 },
    ),
  )
  .map(([name, jobs]) => makeCIStage({ name, jobs }));

// ─── Properties ──────────────────────────────────────────────────────────────

describe('CI Gate Enforcement — Property 1', () => {
  /**
   * Property 1: For any CI pipeline with all required stages (lint, typecheck, test)
   * where each stage has valid jobs, validateCIPipeline returns valid=true.
   */
  it('valid pipeline with all required stages validates successfully', () => {
    fc.assert(
      fc.property(validPipelineArb, (pipeline) => {
        const result = validateCIPipeline(pipeline);
        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 2: For any CI pipeline missing at least one required stage,
   * validateCIPipeline returns valid=false.
   */
  it('pipeline missing required stages fails validation', () => {
    fc.assert(
      fc.property(pipelineMissingStagesArb, (pipeline) => {
        const result = validateCIPipeline(pipeline);
        expect(result.valid).toBe(false);
        expect(result.errors.length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 3: For any CI pipeline, the number of missing stages + present
   * required stages = total required stages.
   */
  it('missing + present required stages equals total required stages', () => {
    const anyPipelineArb = fc.oneof(validPipelineArb, pipelineMissingStagesArb);

    fc.assert(
      fc.property(anyPipelineArb, (pipeline) => {
        const missing = getMissingStages(pipeline);
        const stageNames = new Set(pipeline.stages.map((s) => s.name));
        const presentRequired = REQUIRED_CI_STAGES.filter((name) => stageNames.has(name));

        expect(missing.length + presentRequired.length).toBe(REQUIRED_CI_STAGES.length);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 4: For any stage with at least one job that has at least one step,
   * stageHasJobs returns true.
   */
  it('stage with valid jobs returns stageHasJobs=true', () => {
    const stageWithJobsArb = fc
      .string({ minLength: 1, maxLength: 20 })
      .chain((name) => validStageArb(name));

    fc.assert(
      fc.property(stageWithJobsArb, (stage) => {
        expect(stageHasJobs(stage)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  /**
   * Property 5: For any stage with no jobs or jobs with no steps,
   * stageHasJobs returns false.
   */
  it('stage with no jobs or empty steps returns stageHasJobs=false', () => {
    const invalidStageArb = fc.oneof(stageNoJobsArb, stageEmptyStepsArb);

    fc.assert(
      fc.property(invalidStageArb, (stage) => {
        expect(stageHasJobs(stage)).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
