/**
 * Logging Module
 *
 * Provides structured logging with PII scrubbing, context enrichment,
 * and log aggregation for CashTrace observability.
 */

export {
  type CloudWatchConfig,
  type ElasticsearchConfig,
  type LogBackend,
  type LogAggregationConfig,
  type LogAggregationClient,
  type LogBatchEntry,
  loadCloudWatchConfig,
  loadElasticsearchConfig,
  loadLogAggregationConfig,
  createLogAggregationClient,
} from './cloudwatchConfig.js';

export {
  type LogLevel,
  type LogMetadata,
  type LogContext,
  type ErrorInfo,
  type LogEntry,
  type Logger,
  type LogOutput,
  type LoggerOptions,
  createLogger,
} from './logger.js';

export { type PIIPattern, type PIIScrubber, createPIIScrubber } from './piiScrubber.js';

export {
  type ErrorSeverity,
  type ErrorContext,
  type RequestContext,
  type TrackedError,
  type ErrorTrackerOptions,
  type ErrorTracker,
  generateFingerprint,
  extractFirstStackFrame,
  extractRequestContext,
  createErrorTracker,
} from './errorTracker.js';

export {
  type SentrySeverity,
  type SentryConfig,
  type SentryEvent,
  type SentryTransport,
  type SentryAdapter,
  mapSeverity,
  formatSentryEvent,
  isValidDsn,
  createSentryAdapter,
  createInMemoryTransport,
} from './sentryIntegration.js';

export {
  type ShipmentBatch,
  type TransportResult,
  type ShipperTransport,
  type ShipperConfig,
  type DeadLetterEntry,
  type LogShipper,
  type InMemoryTransport,
  createInMemoryShipperTransport,
  createLogShipper,
  createCloudWatchShipper,
  createElasticsearchShipper,
} from './shipper.js';

export {
  type RetentionTier,
  type RetentionConfig,
  type StorageTier,
  type RetentionClassification,
  type RetentionManager,
  createRetentionManager,
} from './retention.js';

export { type LogQuery, type LogIndex, createLogIndex } from './logIndex.js';

export {
  type ExportFormat,
  type ExportFilter,
  type ExportMetadata,
  type ExportResult,
  type LogExporter,
  createLogExporter,
} from './logExport.js';

export {
  type AuditEventType,
  type AuditAction,
  type AuditLogEntry,
  type AccessParams,
  type ModificationParams,
  type AuthParams,
  type AuditFilter,
  type AuditLogger,
  type AuditRetentionConfig,
  type AuditRetentionPolicy,
  type IntegrityResult,
  type BulkIntegrityResult,
  type ChainVerificationResult,
  computeChecksum,
  createAuditLogger,
} from './auditLogger.js';
