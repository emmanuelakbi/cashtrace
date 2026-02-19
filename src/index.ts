/**
 * CashTrace – Unified SDK Entry Point
 *
 * Re-exports the core authentication module alongside the
 * Security & Compliance modules: encryption, audit, compliance,
 * access control, and security services.
 *
 * @module cashtrace
 */

// ─── Core Auth ───
export { AuthEventType, ConsentType, UserStatus } from './types/index.js';
export type {
  AuthEvent,
  AuthResponse,
  AuditLog,
  ConsentRecord,
  ErrorResponse,
  GenericResponse,
  LoginRequest,
  MagicLinkRequest,
  MagicLinkToken,
  MagicLinkVerifyRequest,
  PasswordResetRequest,
  PasswordResetToken,
  RefreshRequest,
  RefreshToken,
  ResetPasswordRequest,
  SignupRequest,
  User,
  UserPublic,
} from './types/index.js';

// ─── Encryption Module ───
export * from './encryption/index.js';

// ─── Audit Module ───
export * from './audit/index.js';

// ─── Compliance Module ───
export * from './compliance/index.js';

// ─── Access Control Module ───
export * from './access/index.js';

// ─── Security Module ───
export {
  // Types (excluding IncidentSeverity, IncidentType, SecurityIncident which are already exported from compliance)
  type VulnerabilitySeverity,
  type VulnerabilityStatus,
  type Vulnerability,
  type Dependency,
  type KnownVulnerabilityEntry,
  type ScanResult,
  type ScanSchedule,
  type AlertStatus,
  type AlertChannel,
  type AlertRecipient,
  type VulnerabilityAlert,
  type RemediationStatus,
  type RemediationTask,
  type RemediationSummary,
  type IncidentStatus,
  type EscalationProcedure,
  type EscalationRecord,
  type TimelineEntryType,
  type TimelineEntry,
  type ActionItemStatus,
  type ActionItem,
  type PostIncidentReview,
  type ConfigRuleCategory,
  type ConfigRuleSeverity,
  type ConfigRule,
  type ConfigRuleResult,
  type ConfigValidationResult,
  type ServiceConfig,
  type DriftSeverity,
  type DriftItem,
  type DriftSummary,
  type VendorStatus,
  type Vendor,
  type AssessmentRecommendation,
  type SecurityAssessment,
  type RevocationRecord,
  // Services
  VulnerabilityScanner,
  VulnerabilityAlertService,
  RemediationTracker,
  IncidentManager,
  ConfigValidator,
  SecurityHeaders,
  type HeaderMap,
  type SecurityHeadersOptions,
  type HeaderValidationResult,
  DriftDetector,
  VendorManager,
  SecurityAssessor,
} from './security/index.js';
