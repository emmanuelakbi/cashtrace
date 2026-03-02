/**
 * Deployment Infrastructure type definitions.
 *
 * All types are derived from the deployment-infra design document.
 * These define the core interfaces for CI/CD pipelines, environment management,
 * infrastructure configuration, secret management, and deployment orchestration.
 *
 * @module deployment/types
 */

// ─── Pipeline Triggers ───────────────────────────────────────────────────────

/** Events that can trigger a pipeline run. */
export type PipelineTrigger = 'push' | 'pull_request' | 'schedule' | 'manual';

// ─── CI Pipeline ─────────────────────────────────────────────────────────────

/** A single step within a CI job. */
export interface JobStep {
  /** Human-readable step name. */
  name: string;
  /** Shell command to execute. */
  run?: string;
  /** GitHub Action to use (e.g. "actions/checkout@v4"). */
  uses?: string;
  /** Inputs for the referenced action. */
  with?: Record<string, string>;
  /** Environment variables for this step. */
  env?: Record<string, string>;
}

/** A job within a CI stage. */
export interface CIJob {
  /** Job name. */
  name: string;
  /** Runner label (e.g. "ubuntu-latest"). */
  runner: string;
  /** Ordered list of steps. */
  steps: JobStep[];
  /** Job timeout in minutes. */
  timeout: number;
  /** Number of retry attempts on failure. */
  retries: number;
}

/** A stage grouping related CI jobs. */
export interface CIStage {
  /** Stage name. */
  name: string;
  /** Jobs in this stage. */
  jobs: CIJob[];
  /** Stages that must complete before this one. */
  dependsOn?: string[];
}

/** Artifact produced by a CI pipeline. */
export interface Artifact {
  /** Artifact name. */
  name: string;
  /** File path or pattern. */
  path: string;
  /** Retention period in days. */
  retentionDays: number;
}

/** Notification configuration for pipeline events. */
export interface PipelineNotification {
  /** Notification channel (e.g. "slack", "email"). */
  channel: string;
  /** Pipeline events that trigger this notification. */
  events: string[];
  /** Channel-specific target (e.g. Slack channel name). */
  target: string;
}

/** Complete CI pipeline configuration. */
export interface CIPipeline {
  /** Event that triggers the pipeline. */
  trigger: PipelineTrigger;
  /** Ordered pipeline stages. */
  stages: CIStage[];
  /** Artifacts produced by the pipeline. */
  artifacts: Artifact[];
  /** Notification rules. */
  notifications: PipelineNotification[];
}

// ─── CD Pipeline ─────────────────────────────────────────────────────────────

/** An environment variable bound to a deployment environment. */
export interface EnvironmentVariable {
  /** Variable name. */
  name: string;
  /** Variable value (plain text). */
  value: string;
}

/** Reference to a secret stored in a secret manager. */
export interface SecretReference {
  /** Secret name in the secret manager. */
  name: string;
  /** Environment variable name to inject as. */
  envVar: string;
}

/** Deployment environment configuration. */
export interface Environment {
  /** Environment name (e.g. "development", "staging", "production"). */
  name: string;
  /** Base URL for this environment. */
  url: string;
  /** Plain-text environment variables. */
  variables: EnvironmentVariable[];
  /** Secret references injected at runtime. */
  secrets: SecretReference[];
  /** Branch that triggers auto-deploy to this environment. */
  autoDeployBranch?: string;
  /** Whether manual approval is required before deploying. */
  requiresApproval: boolean;
}

/** Strategy for rolling out new deployments. */
export interface DeploymentStrategy {
  /** Deployment type. */
  type: 'rolling' | 'blue_green' | 'canary';
  /** Maximum unavailable instances during rolling deploy. */
  maxUnavailable?: number;
  /** Percentage of traffic routed to canary. */
  canaryPercentage?: number;
  /** Health check endpoint path. */
  healthCheckPath: string;
  /** Health check timeout in seconds. */
  healthCheckTimeout: number;
}

/** Configuration for automatic rollback. */
export interface RollbackConfig {
  /** Whether rollback triggers automatically on failure. */
  automatic: boolean;
  /** Number of consecutive health check failures before rollback. */
  healthCheckFailures: number;
  /** Maximum time in seconds for rollback to complete. */
  rollbackTimeout: number;
}

/** Approval gate for production deployments. */
export interface ApprovalGate {
  /** Environment this gate protects. */
  environment: string;
  /** Approvers (GitHub usernames or team slugs). */
  approvers: string[];
  /** Timeout in hours before the approval expires. */
  timeoutHours: number;
}

/** Complete CD pipeline configuration. */
export interface CDPipeline {
  /** Target environments. */
  environments: Environment[];
  /** Deployment strategy. */
  deploymentStrategy: DeploymentStrategy;
  /** Approval gates. */
  approvals: ApprovalGate[];
  /** Rollback configuration. */
  rollback: RollbackConfig;
}

// ─── Infrastructure ──────────────────────────────────────────────────────────

/** Supported cloud providers. */
export type CloudProvider = 'aws' | 'gcp' | 'azure';

/** Infrastructure resource types. */
export type ResourceType = 'compute' | 'database' | 'cache' | 'storage' | 'cdn';

/** Auto-scaling configuration for a resource. */
export interface AutoScalingConfig {
  /** Minimum number of replicas. */
  minReplicas: number;
  /** Maximum number of replicas. */
  maxReplicas: number;
  /** Target CPU utilisation percentage. */
  targetCPU: number;
  /** Target memory utilisation percentage. */
  targetMemory: number;
  /** Seconds to wait before scaling down. */
  scaleDownDelay: number;
}

/** Configuration for a single infrastructure resource. */
export interface ResourceConfig {
  /** Resource type. */
  type: ResourceType;
  /** Resource name. */
  name: string;
  /** Instance size / class. */
  size: string;
  /** Number of replicas. */
  replicas?: number;
  /** Auto-scaling settings. */
  autoScaling?: AutoScalingConfig;
}

/** Network configuration. */
export interface NetworkConfig {
  /** VPC CIDR block. */
  vpcCidr: string;
  /** Public subnet CIDRs. */
  publicSubnets: string[];
  /** Private subnet CIDRs. */
  privateSubnets: string[];
  /** Availability zones. */
  availabilityZones: string[];
}

/** Security configuration. */
export interface SecurityConfig {
  /** Whether to enable WAF. */
  wafEnabled: boolean;
  /** Allowed CIDR blocks for SSH access. */
  sshAllowedCidrs: string[];
  /** Whether to enable VPC flow logs. */
  flowLogsEnabled: boolean;
}

/** Complete infrastructure configuration. */
export interface InfrastructureConfig {
  /** Cloud provider. */
  provider: CloudProvider;
  /** Primary AWS region. */
  region: string;
  /** Resources to provision. */
  resources: ResourceConfig[];
  /** Network configuration. */
  networking: NetworkConfig;
  /** Security configuration. */
  security: SecurityConfig;
}

// ─── Secret Management ───────────────────────────────────────────────────────

/** Metadata for a stored secret. */
export interface SecretMetadata {
  /** Secret name. */
  name: string;
  /** Current version identifier. */
  version: string;
  /** When the secret was created. */
  createdAt: Date;
  /** When the secret was last rotated. */
  rotatedAt: Date;
  /** Optional expiry date. */
  expiresAt?: Date;
}

/** Audit log entry for secret access. */
export interface SecretAccessLog {
  /** When the access occurred. */
  timestamp: Date;
  /** IAM principal or service that accessed the secret. */
  principal: string;
  /** Type of access. */
  action: 'read' | 'write' | 'rotate';
  /** Whether the access was successful. */
  success: boolean;
}

/** Interface for secret management operations. */
export interface SecretManager {
  getSecret(name: string): Promise<string>;
  setSecret(name: string, value: string): Promise<void>;
  rotateSecret(name: string): Promise<void>;
  listSecrets(): Promise<SecretMetadata[]>;
  auditAccess(name: string): Promise<SecretAccessLog[]>;
}

// ─── Deployment ──────────────────────────────────────────────────────────────

/** Deployment lifecycle status. */
export type DeploymentStatus = 'pending' | 'in_progress' | 'succeeded' | 'failed' | 'rolled_back';

/** Result of a single health check probe. */
export interface HealthCheckResult {
  /** When the check ran. */
  timestamp: Date;
  /** Endpoint that was checked. */
  endpoint: string;
  /** HTTP status code returned. */
  status: number;
  /** Response latency in milliseconds. */
  latency: number;
  /** Whether the check passed. */
  healthy: boolean;
}

/** A deployment record. */
export interface Deployment {
  /** Unique deployment ID. */
  id: string;
  /** Target environment. */
  environment: string;
  /** Application version being deployed. */
  version: string;
  /** Git commit SHA. */
  commitSha: string;
  /** Current deployment status. */
  status: DeploymentStatus;
  /** Strategy used for this deployment. */
  strategy: DeploymentStrategy;
  /** When the deployment started. */
  startedAt: Date;
  /** When the deployment completed (if finished). */
  completedAt?: Date;
  /** Who initiated the deployment. */
  initiatedBy: string;
  /** Who approved the deployment (production only). */
  approvedBy?: string;
  /** If this is a rollback, the deployment ID it rolled back. */
  rollbackOf?: string;
  /** Health check results collected during deployment. */
  healthChecks: HealthCheckResult[];
}

// ─── Error Codes ─────────────────────────────────────────────────────────────

/** Deployment-specific error codes. */
export const DEPLOY_ERROR_CODES = {
  CI_FAILED: 'DEPLOY_CI_FAILED',
  APPROVAL_REQUIRED: 'DEPLOY_APPROVAL_REQUIRED',
  HEALTH_CHECK_FAILED: 'DEPLOY_HEALTH_CHECK_FAILED',
  ROLLBACK_FAILED: 'DEPLOY_ROLLBACK_FAILED',
  SECRET_ACCESS_DENIED: 'DEPLOY_SECRET_ACCESS_DENIED',
  RESOURCE_LIMIT: 'DEPLOY_RESOURCE_LIMIT',
} as const;

export type DeployErrorCode = (typeof DEPLOY_ERROR_CODES)[keyof typeof DEPLOY_ERROR_CODES];

/** Map deployment error codes to HTTP status codes. */
export const DEPLOY_ERROR_HTTP_STATUS: Record<DeployErrorCode, number> = {
  [DEPLOY_ERROR_CODES.CI_FAILED]: 500,
  [DEPLOY_ERROR_CODES.APPROVAL_REQUIRED]: 403,
  [DEPLOY_ERROR_CODES.HEALTH_CHECK_FAILED]: 503,
  [DEPLOY_ERROR_CODES.ROLLBACK_FAILED]: 500,
  [DEPLOY_ERROR_CODES.SECRET_ACCESS_DENIED]: 403,
  [DEPLOY_ERROR_CODES.RESOURCE_LIMIT]: 429,
};
