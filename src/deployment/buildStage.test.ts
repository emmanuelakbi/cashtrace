import { describe, expect, it } from 'vitest';

import type { DockerBuildConfig } from './buildStage.js';
import { generateImageTags, validateDockerBuildConfig } from './buildStage.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDockerBuildConfig(overrides: Partial<DockerBuildConfig> = {}): DockerBuildConfig {
  return {
    imageName: 'cashtrace',
    registry: '123456789012.dkr.ecr.af-south-1.amazonaws.com',
    tags: ['abc1234', 'latest'],
    dockerfilePath: 'Dockerfile',
    context: '.',
    ...overrides,
  };
}

// ─── validateDockerBuildConfig ───────────────────────────────────────────────

describe('validateDockerBuildConfig', () => {
  it('returns valid for a correct configuration', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig());
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it('rejects empty imageName', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ imageName: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('imageName');
  });

  it('rejects imageName with uppercase characters', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ imageName: 'CashTrace' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('imageName');
  });

  it('accepts imageName with dots, hyphens, and slashes', () => {
    const result = validateDockerBuildConfig(
      makeDockerBuildConfig({ imageName: 'my-org/cash.trace' }),
    );
    expect(result.valid).toBe(true);
  });

  it('rejects empty registry', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ registry: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('registry');
  });

  it('rejects empty tags array', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ tags: [] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('tag');
  });

  it('rejects tags containing empty strings', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ tags: ['valid', ''] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('empty');
  });

  it('rejects tags exceeding max length', () => {
    const longTag = 'a'.repeat(129);
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ tags: [longTag] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('maximum length');
  });

  it('rejects tags with invalid characters', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ tags: ['invalid tag!'] }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('alphanumeric');
  });

  it('rejects empty dockerfilePath', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ dockerfilePath: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('dockerfilePath');
  });

  it('rejects empty context', () => {
    const result = validateDockerBuildConfig(makeDockerBuildConfig({ context: '' }));
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('context');
  });

  it('collects multiple errors at once', () => {
    const result = validateDockerBuildConfig(
      makeDockerBuildConfig({ imageName: '', registry: '', tags: [] }),
    );
    expect(result.valid).toBe(false);
    expect(result.errors.length).toBeGreaterThanOrEqual(3);
  });
});

// ─── generateImageTags ──────────────────────────────────────────────────────

describe('generateImageTags', () => {
  const registry = '123456789012.dkr.ecr.af-south-1.amazonaws.com';
  const imageName = 'cashtrace';
  const commitSha = 'abc1234def5678901234567890abcdef12345678';

  it('generates short SHA, full SHA, and latest tags', () => {
    const refs = generateImageTags(registry, imageName, commitSha);
    expect(refs).toHaveLength(3);
    expect(refs[0]!.tag).toBe('abc1234');
    expect(refs[0]!.uri).toBe(`${registry}/${imageName}:abc1234`);
    expect(refs[1]!.tag).toBe(commitSha);
    expect(refs[1]!.uri).toBe(`${registry}/${imageName}:${commitSha}`);
    expect(refs[2]!.tag).toBe('latest');
    expect(refs[2]!.uri).toBe(`${registry}/${imageName}:latest`);
  });

  it('includes version tag when semver is provided', () => {
    const refs = generateImageTags(registry, imageName, commitSha, '1.2.3');
    expect(refs).toHaveLength(4);
    const versionRef = refs.find((r) => r.tag === '1.2.3');
    expect(versionRef).toBeDefined();
    expect(versionRef!.uri).toBe(`${registry}/${imageName}:1.2.3`);
  });

  it('skips version tag for invalid semver', () => {
    const refs = generateImageTags(registry, imageName, commitSha, 'not-semver');
    expect(refs).toHaveLength(3);
    expect(refs.find((r) => r.tag === 'not-semver')).toBeUndefined();
  });

  it('handles short SHA (7 chars)', () => {
    const shortSha = 'abc1234';
    const refs = generateImageTags(registry, imageName, shortSha);
    expect(refs).toHaveLength(3);
    expect(refs[0]!.tag).toBe('abc1234');
    // Short SHA and full SHA are the same for 7-char input
    expect(refs[1]!.tag).toBe('abc1234');
  });

  it('always includes latest tag', () => {
    const refs = generateImageTags(registry, imageName, commitSha);
    const latestRef = refs.find((r) => r.tag === 'latest');
    expect(latestRef).toBeDefined();
    expect(latestRef!.uri).toBe(`${registry}/${imageName}:latest`);
  });

  it('skips SHA tags for invalid commit SHA', () => {
    const refs = generateImageTags(registry, imageName, 'INVALID');
    expect(refs).toHaveLength(1);
    expect(refs[0]!.tag).toBe('latest');
  });
});
