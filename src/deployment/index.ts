/**
 * Deployment Infrastructure Module — Public API.
 *
 * Re-exports all deployment types, error codes, and constants.
 *
 * @module deployment
 */

// ─── Types ───
export type {
  Artifact,
  ApprovalGate,
  AutoScalingConfig,
  CDPipeline,
  CIJob,
  CIPipeline,
  CIStage,
  CloudProvider,
  DeployErrorCode,
  Deployment,
  DeploymentStatus,
  DeploymentStrategy,
  Environment,
  EnvironmentVariable,
  HealthCheckResult,
  InfrastructureConfig,
  JobStep,
  NetworkConfig,
  PipelineNotification,
  PipelineTrigger,
  ResourceConfig,
  ResourceType,
  RollbackConfig,
  SecretAccessLog,
  SecretManager,
  SecretMetadata,
  SecretReference,
  SecurityConfig,
} from './types.js';

// ─── Constants ───
export { DEPLOY_ERROR_CODES, DEPLOY_ERROR_HTTP_STATUS } from './types.js';

// ─── CI Pipeline ───
export {
  getMissingStages,
  hasAllRequiredStages,
  REQUIRED_CI_STAGES,
  stageHasJobs,
  validateCIPipeline,
} from './ciPipeline.js';
export type { CIPipelineValidationResult, RequiredCIStageName } from './ciPipeline.js';

// ─── Test Stage ───
export {
  COVERAGE_METRICS,
  getMissingCoverageMetrics,
  MIN_COVERAGE_THRESHOLD,
  MIN_PROPERTY_TEST_ITERATIONS,
  validateCoverageThreshold,
  validatePropertyTestConfig,
} from './testStage.js';
export type {
  CoverageMetric,
  CoverageMetricResult,
  CoverageReport,
  CoverageValidationResult,
  PropertyTestConfig,
  PropertyTestValidationResult,
} from './testStage.js';

// ─── Build Stage ───
export { generateImageTags, validateDockerBuildConfig } from './buildStage.js';
export type {
  DockerBuildConfig,
  DockerBuildValidationResult,
  ImageReference,
} from './buildStage.js';

// ─── CD Pipeline ───
export { canDeployToProduction, canDeployToStaging, validateCDPipeline } from './cdPipeline.js';
export type {
  CDPipelineValidationResult,
  DeploymentReadinessResult,
  DeploymentState,
} from './cdPipeline.js';

// ─── Integration Test ───
export {
  checkIntegrationTestResults,
  MAX_RETRIES,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
  validateIntegrationTestConfig,
} from './integrationTest.js';
export type {
  IntegrationTestConfig,
  IntegrationTestConfigValidationResult,
  IntegrationTestRequirementResult,
  IntegrationTestResult,
  IntegrationTestRunResult,
} from './integrationTest.js';

// ─── Rollback ───
export {
  checkRollbackEligibility,
  checkRollbackTimeLimit,
  MAX_ROLLBACK_SECONDS,
  ROLLBACK_ENVIRONMENTS,
  validateRollbackRequest,
} from './rollback.js';
export type {
  RollbackEligibilityResult,
  RollbackEnvironment,
  RollbackRequest,
  RollbackTimeResult,
  RollbackValidationResult,
} from './rollback.js';

// ─── Security Scan ───
export {
  countBySeverity,
  SEVERITY_LEVELS,
  validateSecurityScanConfig,
  vulnerabilitiesExceedThreshold,
} from './securityScan.js';
export type {
  DependencyScanResult,
  SecretsScanResult,
  SecurityScanConfig,
  SecurityScanResult,
  SecurityScanValidationResult,
  SeverityLevel,
  Vulnerability,
} from './securityScan.js';

// ─── Notifications ───
export {
  buildNotificationPayload,
  EMAIL_PATTERN,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  SLACK_CHANNEL_PATTERN,
  validateNotification,
  validateNotificationConfig,
  validateNotificationTarget,
  WEBHOOK_PATTERN,
} from './notifications.js';
export type {
  DeploymentNotificationPayload,
  NotificationChannel,
  NotificationConfig,
  NotificationConfigValidationResult,
  NotificationEvent,
  NotificationValidationResult,
} from './notifications.js';

// ─── Environment Config ───
export {
  checkEnvironmentIsolation,
  ENVIRONMENT_TIERS,
  getRequiredVariables,
  REQUIRED_VARIABLES,
  TIER_URLS,
  validateEnvironmentConfig,
  validateEnvironmentTier,
  validateEnvironmentVariables,
} from './environmentConfig.js';
export type {
  EnvironmentConfigValidationResult,
  EnvironmentIsolationResult,
  EnvironmentTier,
  EnvironmentVariableValidationResult,
} from './environmentConfig.js';

// ─── Preview Environment ───
export {
  buildPreviewConfig,
  checkPreviewCapacity,
  generatePreviewName,
  generatePreviewUrl,
  isPreviewExpired,
  MAX_PREVIEW_ENVIRONMENTS,
  PREVIEW_TTL_HOURS,
  PREVIEW_URL_PATTERN,
  validatePreviewRequest,
} from './previewEnvironment.js';
export type {
  PreviewCapacityResult,
  PreviewEnvironmentConfig,
  PreviewEnvironmentRequest,
  PreviewValidationResult,
} from './previewEnvironment.js';

// ─── Feature Flags ───
export {
  FLAG_NAME_PATTERN,
  getEnabledFlags,
  isFeatureEnabled,
  VALID_ENVIRONMENTS,
  validateFeatureFlag,
  validateFeatureFlagOverride,
  validateFlagName,
} from './featureFlags.js';
export type {
  FeatureFlag,
  FeatureFlagEnvironment,
  FeatureFlagOverride,
  FeatureFlagOverrideValidationResult,
  FeatureFlagValidationResult,
} from './featureFlags.js';

// ─── VPC Config ───
export {
  AF_SOUTH_1_AZS,
  ALLOWED_REGIONS,
  CIDR_PATTERN,
  MIN_AVAILABILITY_ZONES,
  validateCidr,
  validateRegion,
  validateVpcConfig,
} from './vpcConfig.js';
export type { VpcConfig, VpcValidationResult } from './vpcConfig.js';

// ─── ECS Config ───
export {
  MAX_TASK_CPU,
  MAX_TASK_MEMORY,
  MIN_TASK_CPU,
  MIN_TASK_MEMORY,
  VALID_CPU_MEMORY_COMBOS,
  VALID_INSTANCE_SIZES,
  validateCpuMemoryCombo,
  validateEcsClusterConfig,
  validateEcsTaskConfig,
} from './ecsConfig.js';
export type {
  EcsClusterConfig,
  EcsClusterValidationResult,
  EcsServiceValidationResult,
  EcsTaskConfig,
} from './ecsConfig.js';

// ─── Auto-Scaling ───
export {
  calculateScalingDecision,
  isScalingResponseWithinLimit,
  MAX_REPLICAS_CEILING,
  MAX_SCALE_DOWN_DELAY,
  MAX_SCALING_RESPONSE_SECONDS,
  MAX_TARGET_PERCENT,
  MIN_REPLICAS_FLOOR,
  MIN_SCALE_DOWN_DELAY,
  MIN_TARGET_PERCENT,
  validateAutoScalingConfig,
} from './autoScaling.js';
export type {
  AutoScalingValidationResult,
  ResourceUtilization,
  ScalingDecision,
} from './autoScaling.js';

// ─── Health Check ───
export {
  DEFAULT_HEALTH_CHECK_INTERVAL,
  DEFAULT_HEALTH_CHECK_PATH,
  DEFAULT_HEALTH_CHECK_TIMEOUT,
  DEFAULT_HEALTHY_THRESHOLD,
  DEFAULT_UNHEALTHY_THRESHOLD,
  evaluateHealthStatus,
  HEALTHY_STATUS_CODES,
  isHealthCheckPassing,
  isZeroDowntimeConfig,
  MAX_LATENCY_MS,
  validateHealthCheckConfig,
  validateRollingDeployConfig,
} from './healthCheck.js';
export type {
  HealthCheckConfig,
  HealthCheckConfigValidationResult,
  HealthStatus,
  RollingDeployConfig,
  RollingDeployValidationResult,
} from './healthCheck.js';

// ─── Secret Management ───
export {
  checkRotationStatus,
  checkSecretIsolation,
  DEFAULT_ROTATION_DAYS,
  isSecretAccessAuthorized,
  MAX_SECRET_SIZE_BYTES,
  SECRET_ENVIRONMENTS,
  SECRET_NAME_PATTERN,
  validateSecretConfig,
  validateSecretName,
} from './secretManagement.js';
export type {
  SecretConfig,
  SecretConfigValidationResult,
  SecretIsolationCheck,
  SecretRotationStatus,
} from './secretManagement.js';

// ─── Database Config ───
export {
  DEFAULT_BACKUP_RETENTION_DAYS,
  isCacheHighAvailability,
  isHighAvailability,
  MAX_BACKUP_RETENTION_DAYS,
  MIN_BACKUP_RETENTION_DAYS,
  VALID_CACHE_NODE_TYPES,
  VALID_DB_ENGINES,
  VALID_DB_VERSIONS,
  VALID_INSTANCE_CLASSES,
  validateCacheConfig,
  validateRdsConfig,
} from './databaseConfig.js';
export type {
  CacheConfig,
  CacheValidationResult,
  RdsConfig,
  RdsValidationResult,
} from './databaseConfig.js';

// ─── CDN Config ───
export {
  DEFAULT_TTL_SECONDS,
  MAX_TTL_SECONDS,
  supportsAfricanEdge,
  VALID_COMPRESSION,
  validateCdnConfig,
} from './cdnConfig.js';
export type { CacheBehavior, CdnConfig, CdnValidationResult } from './cdnConfig.js';

// ─── Monitoring Config ───
export {
  DEFAULT_RETENTION_DAYS as MONITORING_DEFAULT_RETENTION_DAYS,
  hasRequiredAlerts,
  MAX_RETENTION_DAYS as MONITORING_MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS as MONITORING_MIN_RETENTION_DAYS,
  VALID_ALERT_SEVERITIES,
  validateMonitoringConfig,
} from './monitoringConfig.js';
export type {
  AlertRule,
  MonitoringConfig,
  MonitoringValidationResult,
} from './monitoringConfig.js';

// ─── Disaster Recovery ───
export {
  BACKUP_VERIFICATION_INTERVAL_DAYS,
  checkBackupVerification,
  meetsRpo,
  meetsRto,
  SECONDARY_REGION,
  TARGET_RPO_HOURS,
  TARGET_RTO_HOURS,
  validateDrConfig,
} from './disasterRecovery.js';
export type { BackupVerificationResult, DrConfig, DrValidationResult } from './disasterRecovery.js';

// ─── Cost Optimization ───
export {
  DEFAULT_BUDGET_ALERT_THRESHOLDS,
  getRecommendedStrategy,
  hasRequiredTags,
  MAX_SPOT_PERCENTAGE,
  REQUIRED_TAGS,
  VALID_INSTANCE_STRATEGIES,
  validateBudgetAlert,
  validateCostOptimizationConfig,
  validateInstanceStrategy,
  validateResourceTags,
} from './costOptimization.js';
export type {
  BudgetAlert,
  BudgetAlertValidationResult,
  CostOptimizationConfig,
  CostOptimizationValidationResult,
  InstanceStrategy,
  InstanceStrategyValidationResult,
  ResourceTag,
  ResourceTagValidationResult,
} from './costOptimization.js';

// ─── Data Residency ───
export {
  checkResidencyGuardrail,
  COMPLIANT_BACKUP_REGIONS,
  COMPLIANT_REGIONS,
  DATA_CLASSIFICATION_LEVELS,
  isCompliantBackupRegion,
  isCompliantRegion,
  NON_COMPLIANT_REGIONS,
  validateDataFlow,
  validateDataResidencyConfig,
} from './dataResidency.js';
export type {
  DataClassificationLevel,
  DataFlowRecord,
  DataFlowValidationResult,
  DataResidencyConfig,
  DataResidencyValidationResult,
  ResidencyGuardrailResult,
} from './dataResidency.js';

// ─── Smoke Test ───
export {
  DEFAULT_RETRIES,
  DEFAULT_TIMEOUT_SECONDS,
  evaluateSmokeTestResults,
  hasRequiredEndpoints,
  MAX_LATENCY_MS as SMOKE_TEST_MAX_LATENCY_MS,
  REQUIRED_ENDPOINTS,
  validateSmokeTestConfig,
} from './smokeTest.js';
export type {
  SmokeTestConfig,
  SmokeTestConfigValidationResult,
  SmokeTestEndpoint,
  SmokeTestResult,
  SmokeTestSuiteResult,
} from './smokeTest.js';
