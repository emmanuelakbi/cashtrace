/**
 * ECS container orchestration configuration validation.
 *
 * Provides types and pure functions for validating AWS ECS Fargate
 * task definitions and cluster configurations.
 *
 * @module deployment/ecsConfig
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Valid EC2 instance sizes for ECS capacity providers. */
export const VALID_INSTANCE_SIZES = [
  't3.micro',
  't3.small',
  't3.medium',
  't3.large',
  't3.xlarge',
  'm5.large',
  'm5.xlarge',
  'c5.large',
  'c5.xlarge',
] as const;

/** Minimum CPU units for a Fargate task (0.25 vCPU). */
export const MIN_TASK_CPU = 256;

/** Maximum CPU units for a Fargate task (4 vCPU). */
export const MAX_TASK_CPU = 4096;

/** Minimum memory in MB for a Fargate task. */
export const MIN_TASK_MEMORY = 512;

/** Maximum memory in MB for a Fargate task. */
export const MAX_TASK_MEMORY = 30720;
/**
 * Valid CPU → memory combinations per AWS Fargate specifications.
 *
 * Each key is a CPU value in units, and the value is an array of
 * allowed memory values in MB for that CPU setting.
 */
export const VALID_CPU_MEMORY_COMBOS: ReadonlyMap<number, readonly number[]> = new Map<
  number,
  readonly number[]
>([
  [256, [512, 1024, 2048]],
  [512, [1024, 2048, 3072, 4096]],
  [1024, [2048, 3072, 4096, 5120, 6144, 7168, 8192]],
  [2048, Array.from({ length: 13 }, (_, i) => 4096 + i * 1024)],
  [4096, Array.from({ length: 23 }, (_, i) => 8192 + i * 1024)],
]);

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for a single ECS Fargate task definition. */
export interface EcsTaskConfig {
  /** Name of the ECS service. */
  serviceName: string;
  /** CPU units allocated to the task (256, 512, 1024, 2048, or 4096). */
  cpu: number;
  /** Memory in MB allocated to the task. */
  memory: number;
  /** Desired number of running tasks. */
  desiredCount: number;
  /** Minimum healthy percent during deployments (0–100). */
  minHealthyPercent: number;
  /** Maximum percent of tasks during deployments (100–200). */
  maxPercent: number;
}

/** Result of validating an ECS task configuration. */
export interface EcsServiceValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

/** Configuration for an ECS cluster. */
export interface EcsClusterConfig {
  /** Name of the ECS cluster. */
  clusterName: string;
  /** AWS region for the cluster. */
  region: string;
  /** Services running in the cluster. */
  services: EcsTaskConfig[];
  /** Capacity providers for the cluster. */
  capacityProviders: ('FARGATE' | 'FARGATE_SPOT')[];
}

/** Result of validating an ECS cluster configuration. */
export interface EcsClusterValidationResult {
  /** Whether the configuration is valid. */
  valid: boolean;
  /** Validation errors (empty when valid). */
  errors: string[];
}

// ─── Validation Functions ────────────────────────────────────────────────────

/**
 * Check whether a CPU/memory combination is valid per Fargate specs.
 *
 * @returns `true` when the combination is allowed.
 */
export function validateCpuMemoryCombo(cpu: number, memory: number): boolean {
  const allowed = VALID_CPU_MEMORY_COMBOS.get(cpu);
  if (!allowed) {
    return false;
  }
  return allowed.includes(memory);
}

/**
 * Validate an ECS task configuration.
 *
 * Checks:
 * - `serviceName` is non-empty
 * - `cpu` is a valid Fargate CPU value
 * - `memory` is valid for the given CPU
 * - `desiredCount` is at least 1
 * - `minHealthyPercent` is between 0 and 100
 * - `maxPercent` is between 100 and 200
 * - `maxPercent` is greater than `minHealthyPercent`
 */
export function validateEcsTaskConfig(config: EcsTaskConfig): EcsServiceValidationResult {
  const errors: string[] = [];

  // Service name validation
  if (!config.serviceName || config.serviceName.trim() === '') {
    errors.push('serviceName must be a non-empty string');
  }

  // CPU validation
  const validCpuValues = [...VALID_CPU_MEMORY_COMBOS.keys()];
  if (!validCpuValues.includes(config.cpu)) {
    errors.push(`cpu must be one of ${validCpuValues.join(', ')} (got ${config.cpu})`);
  }

  // Memory validation (only if CPU is valid)
  if (validCpuValues.includes(config.cpu)) {
    if (!validateCpuMemoryCombo(config.cpu, config.memory)) {
      const allowed = VALID_CPU_MEMORY_COMBOS.get(config.cpu)!;
      errors.push(
        `memory ${config.memory} is not valid for cpu ${config.cpu}; allowed values: ${allowed[0]}–${allowed[allowed.length - 1]!}`,
      );
    }
  }

  // Desired count validation
  if (config.desiredCount < 1) {
    errors.push('desiredCount must be at least 1');
  }

  // Min healthy percent validation
  if (config.minHealthyPercent < 0 || config.minHealthyPercent > 100) {
    errors.push('minHealthyPercent must be between 0 and 100');
  }

  // Max percent validation
  if (config.maxPercent < 100 || config.maxPercent > 200) {
    errors.push('maxPercent must be between 100 and 200');
  }

  // Max percent must be greater than min healthy percent
  if (config.maxPercent <= config.minHealthyPercent) {
    errors.push('maxPercent must be greater than minHealthyPercent');
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Validate an ECS cluster configuration.
 *
 * Checks:
 * - `clusterName` is non-empty
 * - `region` is 'af-south-1' (Nigerian data residency)
 * - At least one service is defined
 * - At least one capacity provider is defined
 * - All services pass individual validation
 */
export function validateEcsClusterConfig(config: EcsClusterConfig): EcsClusterValidationResult {
  const errors: string[] = [];

  // Cluster name validation
  if (!config.clusterName || config.clusterName.trim() === '') {
    errors.push('clusterName must be a non-empty string');
  }

  // Region validation (Nigerian data residency)
  if (config.region !== 'af-south-1') {
    errors.push(
      `region must be 'af-south-1' for data residency compliance (got '${config.region}')`,
    );
  }

  // Services validation
  if (!config.services || config.services.length === 0) {
    errors.push('At least one service must be defined');
  } else {
    for (const service of config.services) {
      const result = validateEcsTaskConfig(service);
      if (!result.valid) {
        for (const err of result.errors) {
          errors.push(`Service '${service.serviceName || '(unnamed)'}': ${err}`);
        }
      }
    }
  }

  // Capacity providers validation
  if (!config.capacityProviders || config.capacityProviders.length === 0) {
    errors.push('At least one capacity provider must be defined');
  }

  return { valid: errors.length === 0, errors };
}
