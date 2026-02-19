/**
 * Monitoring Module
 *
 * Provides health monitoring for services, databases, and Redis
 * connections in CashTrace.
 */

export {
  createHealthMonitor,
  type HealthMonitor,
  type HealthMonitorOptions,
  type HealthCheck,
  type HealthCheckFn,
  type HealthCheckResult,
  type HealthStatus,
  type ComponentType,
  type ComponentHealth,
  type HealthReport,
} from './healthMonitor.js';

export {
  createGeminiHealthCheck,
  createEmailProviderHealthCheck,
  type ServiceProbe,
  type GeminiHealthCheckConfig,
  type EmailProviderHealthCheckConfig,
} from './externalServices.js';

export {
  createHealthScoreCalculator,
  type HealthScoreCalculator,
  type HealthScoreConfig,
  type HealthScoreResult,
  type ComponentWeights,
  type ScoreThresholds,
} from './healthScore.js';

export {
  createCostTracker,
  type CostTracker,
  type CostTrackerConfig,
  type CostService,
  type UsageEvent,
  type CostBreakdown,
  type BudgetThreshold,
  type BudgetAlert,
  type CostForecast,
} from './costTracker.js';
