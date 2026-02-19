/**
 * Compliance Module for CashTrace Security & Compliance
 *
 * Provides NDPR compliance features including consent management,
 * data subject access requests, data classification, retention
 * management, and breach notification.
 *
 * @module compliance
 */

export type {
  ConsentRecord as ComplianceConsentRecord,
  ConsentType as ComplianceConsentType,
  ConsentExport,
  DSARRequest,
  DSARType,
  DSARStatus,
  DSARResult,
  StoredDSARRequest,
  UserDataExport,
  DeletionResult,
  DataClassification,
  ClassificationLevel,
  ClassificationTag,
  ClassificationTagValidation,
  PIICategory,
  SecurityIncident,
  IncidentSeverity,
  IncidentType,
  LegalBasis,
  ProcessingRecord,
  ProcessingRecordFilter,
  ProcessingRecordStatus,
} from './types.js';

export { ClassificationService } from './classificationService.js';
export type { EncryptionRequirement } from './classificationService.js';

export { ConsentManager } from './consentManager.js';

export { DSARHandler, InMemoryDSARDataProvider } from './dsarHandler.js';
export type { DSARDataProvider, UserPersonalData } from './dsarHandler.js';

export { ProcessingRecordsService } from './processingRecords.js';

export { BreachNotificationService } from './breachNotifier.js';
export type { BreachNotification, BreachStatus, RecordIncidentInput } from './breachNotifier.js';

export { RetentionManager } from './retentionManager.js';
export type {
  RetentionDataType,
  RetentionPeriodConfig,
  RetentionDataRecord,
  RetentionCheckResult,
  LegalHold,
  RetentionAuditEntry,
  RetentionStatus as RetentionDataStatus,
} from './types.js';
