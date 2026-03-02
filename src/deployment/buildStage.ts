/**
 * Docker build stage configuration and validation for CI pipeline.
 *
 * Provides types and functions for Docker image build configuration,
 * tag generation, and validation within the CI pipeline.
 *
 * @module deployment/buildStage
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Valid characters for Docker image names (lowercase alphanumeric, hyphens, underscores, dots, slashes). */
const IMAGE_NAME_PATTERN = /^[a-z0-9][a-z0-9._\-/]*$/;

/** Valid characters for Docker image tags (alphanumeric, hyphens, underscores, dots). */
const IMAGE_TAG_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;

/** Maximum length for a Docker image tag. */
const MAX_TAG_LENGTH = 128;

/** Git commit SHA pattern (7–40 hex characters). */
const COMMIT_SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/** Semver pattern (e.g. 1.2.3, 0.1.0). */
const SEMVER_PATTERN = /^\d+\.\d+\.\d+$/;

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for building a Docker image. */
export interface DockerBuildConfig {
  /** Docker image name (e.g. "cashtrace"). */
  imageName: string;
  /** Container registry URL (e.g. "123456789012.dkr.ecr.af-south-1.amazonaws.com"). */
  registry: string;
  /** Tags to apply to the built image. */
  tags: string[];
  /** Path to the Dockerfile (relative to repo root). */
  dockerfilePath: string;
  /** Build context directory. */
  context: string;
}

/** Result of Docker build configuration validation. */
export interface DockerBuildValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** A fully-qualified image reference (registry/name:tag). */
export interface ImageReference {
  /** Full image URI including registry, name, and tag. */
  uri: string;
  /** The tag portion only. */
  tag: string;
}

// ─── Validation Functions ────────────────────────────────────────────────────

/**
 * Validate a Docker build configuration.
 *
 * Checks:
 * - `imageName` matches Docker naming rules
 * - `registry` is non-empty
 * - At least one tag is provided
 * - All tags match Docker tag rules and length limits
 * - `dockerfilePath` is non-empty
 * - `context` is non-empty
 */
export function validateDockerBuildConfig(config: DockerBuildConfig): DockerBuildValidationResult {
  const errors: string[] = [];

  // Image name validation
  if (!config.imageName || config.imageName.trim() === '') {
    errors.push('imageName must be a non-empty string');
  } else if (!IMAGE_NAME_PATTERN.test(config.imageName)) {
    errors.push(
      'imageName must start with a lowercase letter or digit and contain only lowercase alphanumeric characters, hyphens, underscores, dots, or slashes',
    );
  }

  // Registry validation
  if (!config.registry || config.registry.trim() === '') {
    errors.push('registry must be a non-empty string');
  }

  // Tags validation
  if (!config.tags || config.tags.length === 0) {
    errors.push('At least one tag must be provided');
  } else {
    for (const tag of config.tags) {
      if (!tag || tag.trim() === '') {
        errors.push('Tags must not contain empty strings');
        break;
      }
      if (tag.length > MAX_TAG_LENGTH) {
        errors.push(`Tag "${tag}" exceeds maximum length of ${MAX_TAG_LENGTH} characters`);
      }
      if (!IMAGE_TAG_PATTERN.test(tag)) {
        errors.push(
          `Tag "${tag}" must start with an alphanumeric character and contain only alphanumeric characters, hyphens, underscores, or dots`,
        );
      }
    }
  }

  // Dockerfile path validation
  if (!config.dockerfilePath || config.dockerfilePath.trim() === '') {
    errors.push('dockerfilePath must be a non-empty string');
  }

  // Context validation
  if (!config.context || config.context.trim() === '') {
    errors.push('context must be a non-empty string');
  }

  return { valid: errors.length === 0, errors };
}

// ─── Tag Generation ──────────────────────────────────────────────────────────

/**
 * Generate Docker image tags from a commit SHA and optional version.
 *
 * Always produces a tag from the short SHA (first 7 characters) and a `latest` tag.
 * When a semver `version` is provided, an additional version tag is included.
 *
 * @returns Array of {@link ImageReference} with full URIs and tags.
 */
export function generateImageTags(
  registry: string,
  imageName: string,
  commitSha: string,
  version?: string,
): ImageReference[] {
  const refs: ImageReference[] = [];

  // SHA tag (short — first 7 chars)
  if (COMMIT_SHA_PATTERN.test(commitSha)) {
    const shortSha = commitSha.slice(0, 7);
    refs.push({
      uri: `${registry}/${imageName}:${shortSha}`,
      tag: shortSha,
    });
  }

  // Full SHA tag
  if (COMMIT_SHA_PATTERN.test(commitSha)) {
    refs.push({
      uri: `${registry}/${imageName}:${commitSha}`,
      tag: commitSha,
    });
  }

  // Version tag
  if (version && SEMVER_PATTERN.test(version)) {
    refs.push({
      uri: `${registry}/${imageName}:${version}`,
      tag: version,
    });
  }

  // Latest tag
  refs.push({
    uri: `${registry}/${imageName}:latest`,
    tag: 'latest',
  });

  return refs;
}
