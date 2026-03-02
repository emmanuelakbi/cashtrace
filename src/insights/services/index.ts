// Insights Engine - Services
// Barrel file for insight service exports

export const INSIGHTS_MODULE = 'insights-engine' as const;

export { BatchProcessor, DEFAULT_BATCH_SIZE } from './batchProcessor.js';
export type { BatchConfig, BatchResult, BusinessProcessor } from './batchProcessor.js';
export { COOLDOWN_PERIOD_MS, DismissalCooldownTracker } from './dismissalCooldown.js';
export type { DismissalRecord } from './dismissalCooldown.js';
export { InsightLimitEnforcer, MAX_ACTIVE_INSIGHTS } from './insightLimiter.js';
export type { LimitEnforcementResult } from './insightLimiter.js';
export {
  INSIGHT_ALREADY_RESOLVED,
  INSIGHT_INVALID_TRANSITION,
  InsightLifecycleError,
  LifecycleManager,
} from './lifecycleManager.js';
export { InsightGenerator } from './insightGenerator.js';
export type { InsightAnalyzer } from './insightGenerator.js';
export { PriorityScorer } from './priorityScorer.js';
export { InsightScheduler, WAT_SCHEDULE_HOUR, WAT_OFFSET_HOURS } from './scheduler.js';
export type {
  ScheduleType,
  ScheduleRun,
  ScheduleRunResult,
  CompletedScheduleRun,
} from './scheduler.js';
export { TemplateEngine } from './templateEngine.js';
export type { ABTestResult, RenderedInsight, ValidationResult } from './templateEngine.js';
export { InsightAnalytics } from './insightAnalytics.js';
export type {
  AccuracyMetrics,
  AnalyticsSnapshot,
  EngagementRates,
  GenerationCounts,
  InsightFeedback,
  ResolutionTimeStats,
} from './insightAnalytics.js';
