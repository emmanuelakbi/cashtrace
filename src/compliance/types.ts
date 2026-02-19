/**
 * Type definitions for the Compliance module.
 */

export type ComplianceConsentType =
  | 'terms'
  | 'privacy'
  | 'marketing'
  | 'data_processing'
  | 'third_party';

// Re-export with a simpler alias for internal use
export type ConsentType = ComplianceConsentType;

export interface ConsentRecord {
  id: string;
  userId: string;
  consentType: ConsentType;
  version: string;
  grantedAt: Date;
  revokedAt?: Date;
  ipAddress: string;
  userAgent: string;
}

export type DSARType = 'access' | 'portability' | 'erasure' | 'rectification';
export type DSARStatus = 'pending' | 'processing' | 'completed' | 'rejected';

export interface DSARRequest {
  userId: string;
  requestType: DSARType;
  requestedBy: string;
  verificationMethod: string;
}

export type ClassificationLevel = 'public' | 'internal' | 'confidential' | 'restricted';

export type PIICategory = 'identifier' | 'financial' | 'contact' | 'biometric';

export interface DataClassification {
  fieldName: string;
  classification: ClassificationLevel;
  encryptionRequired: boolean;
  retentionPeriod: number; // days
  piiCategory?: PIICategory;
}

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';
export type IncidentType = 'breach' | 'unauthorized_access' | 'data_loss' | 'vulnerability';

export interface SecurityIncident {
  id: string;
  severity: IncidentSeverity;
  type: IncidentType;
  description: string;
  affectedUsers: string[];
  detectedAt: Date;
  containedAt?: Date;
  resolvedAt?: Date;
  notificationSentAt?: Date;
  rootCause?: string;
  remediation?: string;
}

/**
 * User clearance level for classification-based access control.
 * Maps to classification levels to determine what data a user can access.
 */
export type ClearanceLevel = 'public' | 'internal' | 'confidential' | 'restricted';

/**
 * Represents a user's security context for classification-based access decisions.
 */
export interface UserSecurityContext {
  userId: string;
  authenticated: boolean;
  roles: string[];
  permissions: string[];
  clearanceLevel: ClearanceLevel;
}

/**
 * Result of a classification-based access control check.
 */
export interface ClassificationAccessDecision {
  allowed: boolean;
  reason: string;
  requiredClearance: ClassificationLevel;
  userClearance: ClearanceLevel;
}

/**
 * Retention policy for a classification level.
 * Defines active retention, archive period, and total retention.
 *
 * Requirement 5.4: Apply retention requirements based on classification.
 */
export interface RetentionPolicy {
  classification: ClassificationLevel;
  activeRetentionDays: number;
  archiveRetentionDays: number;
  totalRetentionDays: number;
  allowEarlyDeletion: boolean;
  description: string;
}

/**
 * The action to take on data based on its age and classification retention policy.
 */
export type RetentionAction = 'retain' | 'archive' | 'delete';

/**
 * Result of evaluating a data item's retention status.
 */
export interface RetentionEvaluation {
  action: RetentionAction;
  classification: ClassificationLevel;
  dataAgeDays: number;
  policy: RetentionPolicy;
  reason: string;
}

/**
 * Classification tag applied to a data record.
 * Contains metadata about the classification decision.
 *
 * Requirement 5.5: Tag all data with classification metadata.
 */
export interface ClassificationTag {
  fieldName: string;
  classification: ClassificationLevel;
  encryptionRequired: boolean;
  retentionDays: number;
  taggedAt: Date;
  taggedBy: string;
}

/**
 * Result of validating classification tags on a data record.
 */
export interface ClassificationTagValidation {
  valid: boolean;
  missingFields: string[];
}

/**
 * Exported consent data for a user, used for DSAR portability requests.
 */
export interface ConsentExport {
  userId: string;
  exportedAt: Date;
  consents: ConsentRecord[];
}

/**
 * Internal representation of a stored DSAR request with tracking metadata.
 */
export interface StoredDSARRequest {
  id: string;
  userId: string;
  requestType: DSARType;
  requestedBy: string;
  verificationMethod: string;
  status: DSARStatus;
  submittedAt: Date;
  processedAt?: Date;
  completedAt?: Date;
}

/**
 * Result of processing a DSAR request.
 */
export interface DSARResult {
  requestId: string;
  status: DSARStatus;
  completedAt: Date;
  data?: UserDataExport;
  deletionResult?: DeletionResult;
}

/**
 * Exported user data for access/portability DSAR requests.
 * Machine-readable format per Requirement 7.3.
 */
export interface UserDataExport {
  userId: string;
  exportedAt: Date;
  format: 'json';
  personalData: Record<string, unknown>;
  consents: ConsentRecord[];
  activityLog: Record<string, unknown>[];
}

/**
 * Result of a data deletion (erasure) request.
 */
export interface DeletionResult {
  userId: string;
  deletedAt: Date;
  fieldsDeleted: string[];
  fieldsRetained: string[];
  retainedReason?: string;
}

// ─── Processing Records Types (Requirement 7.5) ───

/**
 * Legal basis for processing personal data under NDPR.
 */
export type LegalBasis =
  | 'consent'
  | 'contract'
  | 'legal_obligation'
  | 'vital_interest'
  | 'public_interest'
  | 'legitimate_interest';

/**
 * Status of a processing activity record.
 */
export type ProcessingRecordStatus = 'active' | 'suspended' | 'terminated';

/**
 * A record of a data processing activity per NDPR Requirement 7.5.
 * Documents what data is processed, why, the legal basis, and who processes it.
 */
export interface ProcessingRecord {
  id: string;
  businessId: string;
  purpose: string;
  legalBasis: LegalBasis;
  dataCategories: string[];
  dataSubjects: string[];
  processors: string[];
  retentionPeriodDays: number;
  status: ProcessingRecordStatus;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Filter criteria for querying processing records.
 */
export interface ProcessingRecordFilter {
  businessId?: string;
  status?: ProcessingRecordStatus;
  legalBasis?: LegalBasis;
  purpose?: string;
}

// ─── Retention Manager Types (Requirement 8) ───

/**
 * Data types with defined retention periods.
 * Requirement 8.1: Define retention periods per data type.
 */
export type RetentionDataType =
  | 'transactions'
  | 'logs'
  | 'audit_records'
  | 'user_data'
  | 'consent_records'
  | 'financial_reports';

/**
 * Defines the retention period configuration for a specific data type.
 * Includes active retention (readily accessible) and archive retention
 * (cold storage) periods.
 *
 * Requirement 8.1: Define retention periods per data type.
 */
export interface RetentionPeriodConfig {
  dataType: RetentionDataType;
  activeRetentionDays: number;
  archiveRetentionDays: number;
  totalRetentionDays: number;
  description: string;
}

/**
 * Represents a data record tracked by the retention manager.
 */
export interface RetentionDataRecord {
  id: string;
  dataType: RetentionDataType;
  businessId: string;
  createdAt: Date;
  archivedAt?: Date;
  deletedAt?: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Status of a data record with respect to retention policy.
 */
export type RetentionStatus =
  | 'active'
  | 'archive_eligible'
  | 'archived'
  | 'delete_eligible'
  | 'deleted'
  | 'legal_hold';

/**
 * Result of evaluating a data record against its retention policy.
 */
export interface RetentionCheckResult {
  recordId: string;
  dataType: RetentionDataType;
  status: RetentionStatus;
  ageDays: number;
  policy: RetentionPeriodConfig;
  legalHold: boolean;
  reason: string;
}

/**
 * A legal hold placed on data to prevent deletion during investigations.
 * Requirement 8.4: Support legal hold to prevent deletion.
 */
export interface LegalHold {
  id: string;
  businessId: string;
  reason: string;
  createdBy: string;
  createdAt: Date;
  releasedAt?: Date;
  dataRecordIds: string[];
}

/**
 * Audit log entry for retention actions.
 * Requirement 8.5: Log all retention actions for audit.
 */
export interface RetentionAuditEntry {
  id: string;
  action:
    | 'archive'
    | 'delete'
    | 'legal_hold_placed'
    | 'legal_hold_released'
    | 'retention_check'
    | 'auto_archive'
    | 'auto_delete';
  recordId: string;
  dataType: RetentionDataType;
  businessId: string;
  performedBy: string;
  performedAt: Date;
  details: string;
}
