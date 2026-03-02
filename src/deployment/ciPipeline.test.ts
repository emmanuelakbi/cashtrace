import { describe, expect, it } from 'vitest';

import {
  getMissingStages,
  hasAllRequiredStages,
  REQUIRED_CI_STAGES,
  stageHasJobs,
  validateCIPipeline,
} from './ciPipeline.js';
import { makeCIJob, makeCIPipeline, makeCIStage } from './testHelpers.js';

// ─── REQUIRED_CI_STAGES ──────────────────────────────────────────────────────

describe('REQUIRED_CI_STAGES', () => {
  it('should include lint, typecheck, and test', () => {
    expect(REQUIRED_CI_STAGES).toContain('lint');
    expect(REQUIRED_CI_STAGES).toContain('typecheck');
    expect(REQUIRED_CI_STAGES).toContain('test');
  });
});

// ─── getMissingStages ────────────────────────────────────────────────────────

describe('getMissingStages', () => {
  it('should return empty array when all required stages are present', () => {
    const pipeline = makeCIPipeline({
      stages: [
        makeCIStage({ name: 'lint' }),
        makeCIStage({ name: 'typecheck' }),
        makeCIStage({ name: 'test' }),
      ],
    });
    expect(getMissingStages(pipeline)).toEqual([]);
  });

  it('should return missing stage names', () => {
    const pipeline = makeCIPipeline({
      stages: [makeCIStage({ name: 'lint' })],
    });
    const missing = getMissingStages(pipeline);
    expect(missing).toContain('typecheck');
    expect(missing).toContain('test');
    expect(missing).not.toContain('lint');
  });

  it('should return all required stages when pipeline has no stages', () => {
    const pipeline = makeCIPipeline({ stages: [] });
    expect(getMissingStages(pipeline)).toEqual([...REQUIRED_CI_STAGES]);
  });

  it('should ignore extra stages beyond required ones', () => {
    const pipeline = makeCIPipeline({
      stages: [
        makeCIStage({ name: 'lint' }),
        makeCIStage({ name: 'typecheck' }),
        makeCIStage({ name: 'test' }),
        makeCIStage({ name: 'security-scan' }),
      ],
    });
    expect(getMissingStages(pipeline)).toEqual([]);
  });
});

// ─── stageHasJobs ────────────────────────────────────────────────────────────

describe('stageHasJobs', () => {
  it('should return true when stage has jobs with steps', () => {
    const stage = makeCIStage();
    expect(stageHasJobs(stage)).toBe(true);
  });

  it('should return false when stage has no jobs', () => {
    const stage = makeCIStage({ jobs: [] });
    expect(stageHasJobs(stage)).toBe(false);
  });

  it('should return false when a job has no steps', () => {
    const stage = makeCIStage({
      jobs: [makeCIJob({ steps: [] })],
    });
    expect(stageHasJobs(stage)).toBe(false);
  });
});

// ─── hasAllRequiredStages ────────────────────────────────────────────────────

describe('hasAllRequiredStages', () => {
  it('should return true when all required stages are present', () => {
    const pipeline = makeCIPipeline({
      stages: [
        makeCIStage({ name: 'lint' }),
        makeCIStage({ name: 'typecheck' }),
        makeCIStage({ name: 'test' }),
      ],
    });
    expect(hasAllRequiredStages(pipeline)).toBe(true);
  });

  it('should return false when a required stage is missing', () => {
    const pipeline = makeCIPipeline({
      stages: [makeCIStage({ name: 'lint' })],
    });
    expect(hasAllRequiredStages(pipeline)).toBe(false);
  });
});

// ─── validateCIPipeline ──────────────────────────────────────────────────────

describe('validateCIPipeline', () => {
  const validPipeline = makeCIPipeline({
    trigger: 'pull_request',
    stages: [
      makeCIStage({ name: 'lint' }),
      makeCIStage({ name: 'typecheck' }),
      makeCIStage({ name: 'test' }),
    ],
  });

  it('should return valid for a complete pipeline', () => {
    const result = validateCIPipeline(validPipeline);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('should report missing required stages', () => {
    const pipeline = makeCIPipeline({
      trigger: 'pull_request',
      stages: [makeCIStage({ name: 'lint' })],
    });
    const result = validateCIPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Missing required stages'))).toBe(true);
  });

  it('should report invalid trigger', () => {
    const pipeline = makeCIPipeline({
      trigger: 'invalid' as 'push',
      stages: [
        makeCIStage({ name: 'lint' }),
        makeCIStage({ name: 'typecheck' }),
        makeCIStage({ name: 'test' }),
      ],
    });
    const result = validateCIPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('Invalid trigger'))).toBe(true);
  });

  it('should report stage with no jobs', () => {
    const pipeline = makeCIPipeline({
      trigger: 'push',
      stages: [
        makeCIStage({ name: 'lint', jobs: [] }),
        makeCIStage({ name: 'typecheck' }),
        makeCIStage({ name: 'test' }),
      ],
    });
    const result = validateCIPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('must have at least one job'))).toBe(true);
  });

  it('should report non-positive job timeout', () => {
    const pipeline = makeCIPipeline({
      trigger: 'push',
      stages: [
        makeCIStage({
          name: 'lint',
          jobs: [makeCIJob({ timeout: 0 })],
        }),
        makeCIStage({ name: 'typecheck' }),
        makeCIStage({ name: 'test' }),
      ],
    });
    const result = validateCIPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('non-positive timeout'))).toBe(true);
  });

  it('should report negative job retries', () => {
    const pipeline = makeCIPipeline({
      trigger: 'push',
      stages: [
        makeCIStage({
          name: 'lint',
          jobs: [makeCIJob({ retries: -1 })],
        }),
        makeCIStage({ name: 'typecheck' }),
        makeCIStage({ name: 'test' }),
      ],
    });
    const result = validateCIPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('negative retries'))).toBe(true);
  });

  it('should accumulate multiple errors', () => {
    const pipeline = makeCIPipeline({
      trigger: 'invalid' as 'push',
      stages: [],
    });
    const result = validateCIPipeline(pipeline);
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(2);
  });
});
