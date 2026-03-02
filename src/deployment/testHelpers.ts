/**
 * Test helper factory functions for the Deployment Infrastructure module.
 *
 * Provides `make*` factories for all deployment types, following the
 * project convention of `Partial<T>` overrides with sensible defaults.
 *
 * @module deployment/testHelpers
 */

import { v4 as uuidv4 } from 'uuid';

import type { DockerBuildConfig } from './buildStage.js';
import type { RollbackRequest } from './rollback.js';
import type {
  ApprovalGate,
  Artifact,
  AutoScalingConfig,
  CDPipeline,
  CIJob,
  CIPipeline,
  CIStage,
  Deployment,
  DeploymentStrategy,
  Environment,
  EnvironmentVariable,
  HealthCheckResult,
  InfrastructureConfig,
  JobStep,
  NetworkConfig,
  PipelineNotification,
  ResourceConfig,
  RollbackConfig,
  SecretAccessLog,
  SecretMetadata,
  SecretReference,
  SecurityConfig,
} from './types.js';

// ─── CI Pipeline Factories ───────────────────────────────────────────────────

/** Create a JobStep with sensible defaults. */
export function makeJobStep(overrides: Partial<JobStep> = {}): JobStep {
  return {
    name: 'Checkout code',
    uses: 'actions/checkout@v4',
    ...overrides,
  };
}

/** Create a CIJob with sensible defaults. */
export function makeCIJob(overrides: Partial<CIJob> = {}): CIJob {
  return {
    name: 'lint',
    runner: 'ubuntu-latest',
    steps: [makeJobStep()],
    timeout: 10,
    retries: 1,
    ...overrides,
  };
}

/** Create a CIStage with sensible defaults. */
export function makeCIStage(overrides: Partial<CIStage> = {}): CIStage {
  return {
    name: 'lint',
    jobs: [makeCIJob()],
    ...overrides,
  };
}

/** Create an Artifact with sensible defaults. */
export function makeArtifact(overrides: Partial<Artifact> = {}): Artifact {
  return {
    name: 'build-output',
    path: 'dist/',
    retentionDays: 7,
    ...overrides,
  };
}

/** Create a PipelineNotification with sensible defaults. */
export function makePipelineNotification(
  overrides: Partial<PipelineNotification> = {},
): PipelineNotification {
  return {
    channel: 'slack',
    events: ['failure'],
    target: '#deployments',
    ...overrides,
  };
}

/** Create a CIPipeline with sensible defaults. */
export function makeCIPipeline(overrides: Partial<CIPipeline> = {}): CIPipeline {
  return {
    trigger: 'pull_request',
    stages: [makeCIStage()],
    artifacts: [makeArtifact()],
    notifications: [makePipelineNotification()],
    ...overrides,
  };
}

// ─── CD Pipeline Factories ───────────────────────────────────────────────────

/** Create an EnvironmentVariable with sensible defaults. */
export function makeEnvironmentVariable(
  overrides: Partial<EnvironmentVariable> = {},
): EnvironmentVariable {
  return {
    name: 'NODE_ENV',
    value: 'staging',
    ...overrides,
  };
}

/** Create a SecretReference with sensible defaults. */
export function makeSecretReference(overrides: Partial<SecretReference> = {}): SecretReference {
  return {
    name: 'database-url',
    envVar: 'DATABASE_URL',
    ...overrides,
  };
}

/** Create an Environment with sensible defaults. */
export function makeEnvironment(overrides: Partial<Environment> = {}): Environment {
  return {
    name: 'staging',
    url: 'https://staging.cashtrace.ng',
    variables: [makeEnvironmentVariable()],
    secrets: [makeSecretReference()],
    autoDeployBranch: 'main',
    requiresApproval: false,
    ...overrides,
  };
}

/** Create a DeploymentStrategy with sensible defaults. */
export function makeDeploymentStrategy(
  overrides: Partial<DeploymentStrategy> = {},
): DeploymentStrategy {
  return {
    type: 'blue_green',
    healthCheckPath: '/api/health',
    healthCheckTimeout: 30,
    ...overrides,
  };
}

/** Create a RollbackConfig with sensible defaults. */
export function makeRollbackConfig(overrides: Partial<RollbackConfig> = {}): RollbackConfig {
  return {
    automatic: true,
    healthCheckFailures: 3,
    rollbackTimeout: 300,
    ...overrides,
  };
}

/** Create an ApprovalGate with sensible defaults. */
export function makeApprovalGate(overrides: Partial<ApprovalGate> = {}): ApprovalGate {
  return {
    environment: 'production',
    approvers: ['tech-lead', 'devops-team'],
    timeoutHours: 24,
    ...overrides,
  };
}

/** Create a CDPipeline with sensible defaults. */
export function makeCDPipeline(overrides: Partial<CDPipeline> = {}): CDPipeline {
  return {
    environments: [makeEnvironment()],
    deploymentStrategy: makeDeploymentStrategy(
      overrides.deploymentStrategy as Partial<DeploymentStrategy>,
    ),
    approvals: [makeApprovalGate()],
    rollback: makeRollbackConfig(overrides.rollback as Partial<RollbackConfig>),
    ...overrides,
  };
}

// ─── Infrastructure Factories ────────────────────────────────────────────────

/** Create an AutoScalingConfig with sensible defaults. */
export function makeAutoScalingConfig(
  overrides: Partial<AutoScalingConfig> = {},
): AutoScalingConfig {
  return {
    minReplicas: 2,
    maxReplicas: 10,
    targetCPU: 70,
    targetMemory: 80,
    scaleDownDelay: 300,
    ...overrides,
  };
}

/** Create a ResourceConfig with sensible defaults. */
export function makeResourceConfig(overrides: Partial<ResourceConfig> = {}): ResourceConfig {
  return {
    type: 'compute',
    name: 'cashtrace-api',
    size: 't3.medium',
    replicas: 2,
    ...overrides,
  };
}

/** Create a NetworkConfig with sensible defaults. */
export function makeNetworkConfig(overrides: Partial<NetworkConfig> = {}): NetworkConfig {
  return {
    vpcCidr: '10.0.0.0/16',
    publicSubnets: ['10.0.1.0/24', '10.0.2.0/24'],
    privateSubnets: ['10.0.10.0/24', '10.0.11.0/24'],
    availabilityZones: ['af-south-1a', 'af-south-1b'],
    ...overrides,
  };
}

/** Create a SecurityConfig with sensible defaults. */
export function makeSecurityConfig(overrides: Partial<SecurityConfig> = {}): SecurityConfig {
  return {
    wafEnabled: true,
    sshAllowedCidrs: ['10.0.0.0/8'],
    flowLogsEnabled: true,
    ...overrides,
  };
}

/** Create an InfrastructureConfig with sensible defaults. */
export function makeInfrastructureConfig(
  overrides: Partial<InfrastructureConfig> = {},
): InfrastructureConfig {
  return {
    provider: 'aws',
    region: 'af-south-1',
    resources: [makeResourceConfig()],
    networking: makeNetworkConfig(overrides.networking as Partial<NetworkConfig>),
    security: makeSecurityConfig(overrides.security as Partial<SecurityConfig>),
    ...overrides,
  };
}

// ─── Secret Management Factories ─────────────────────────────────────────────

/** Create a SecretMetadata with sensible defaults. */
export function makeSecretMetadata(overrides: Partial<SecretMetadata> = {}): SecretMetadata {
  const now = new Date();
  return {
    name: 'database-url',
    version: 'v1',
    createdAt: now,
    rotatedAt: now,
    ...overrides,
  };
}

/** Create a SecretAccessLog with sensible defaults. */
export function makeSecretAccessLog(overrides: Partial<SecretAccessLog> = {}): SecretAccessLog {
  return {
    timestamp: new Date(),
    principal: 'arn:aws:iam::123456789012:role/cashtrace-api',
    action: 'read',
    success: true,
    ...overrides,
  };
}

// ─── Deployment Factories ────────────────────────────────────────────────────

/** Create a HealthCheckResult with sensible defaults. */
export function makeHealthCheckResult(
  overrides: Partial<HealthCheckResult> = {},
): HealthCheckResult {
  return {
    timestamp: new Date(),
    endpoint: '/api/health',
    status: 200,
    latency: 45,
    healthy: true,
    ...overrides,
  };
}

/** Create a Deployment with sensible defaults. */
export function makeDeployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: uuidv4(),
    environment: 'staging',
    version: '1.2.3',
    commitSha: 'abc1234def5678',
    status: 'succeeded',
    strategy: makeDeploymentStrategy(overrides.strategy as Partial<DeploymentStrategy>),
    startedAt: new Date(),
    initiatedBy: 'ci-bot',
    healthChecks: [makeHealthCheckResult()],
    ...overrides,
  };
}

// ─── Build Stage Factories ───────────────────────────────────────────────────

/** Create a DockerBuildConfig with sensible defaults. */
export function makeDockerBuildConfig(
  overrides: Partial<DockerBuildConfig> = {},
): DockerBuildConfig {
  return {
    imageName: 'cashtrace',
    registry: '123456789012.dkr.ecr.af-south-1.amazonaws.com',
    tags: ['abc1234', 'latest'],
    dockerfilePath: 'Dockerfile',
    context: '.',
    ...overrides,
  };
}

// ─── Rollback Factories ──────────────────────────────────────────────────────

/** Create a RollbackRequest with sensible defaults. */
export function makeRollbackRequest(overrides: Partial<RollbackRequest> = {}): RollbackRequest {
  return {
    environment: 'production',
    initiatedBy: 'ops-engineer',
    timeoutSeconds: 300,
    ...overrides,
  };
}
