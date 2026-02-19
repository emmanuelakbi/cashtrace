/**
 * Security Module for CashTrace Security & Compliance
 *
 * Provides vulnerability management, incident response, secure
 * configuration, drift detection, and third-party vendor management.
 *
 * @module security
 */

// ─── Types ───
export type {
  VulnerabilitySeverity,
  VulnerabilityStatus,
  Vulnerability,
  Dependency,
  KnownVulnerabilityEntry,
  ScanResult,
  ScanSchedule,
  AlertStatus,
  AlertChannel,
  AlertRecipient,
  VulnerabilityAlert,
  RemediationStatus,
  RemediationTask,
  RemediationSummary,
  IncidentSeverity,
  IncidentType,
  IncidentStatus,
  SecurityIncident,
  EscalationProcedure,
  EscalationRecord,
  TimelineEntryType,
  TimelineEntry,
  ActionItemStatus,
  ActionItem,
  PostIncidentReview,
  ConfigRuleCategory,
  ConfigRuleSeverity,
  ConfigRule,
  ConfigRuleResult,
  ConfigValidationResult,
  ServiceConfig,
  DriftSeverity,
  DriftItem,
  DriftSummary,
  VendorStatus,
  Vendor,
  AssessmentRecommendation,
  SecurityAssessment,
  RevocationRecord,
} from './types.js';

// ─── Services ───
export { VulnerabilityScanner } from './vulnerabilityScanner.js';
export { VulnerabilityAlertService } from './vulnerabilityAlertService.js';
export { RemediationTracker } from './remediationTracker.js';
export { IncidentManager } from './incidentManager.js';
export { ConfigValidator } from './configValidator.js';
export { SecurityHeaders } from './securityHeaders.js';
export type {
  HeaderMap,
  SecurityHeadersOptions,
  HeaderValidationResult,
} from './securityHeaders.js';
export { DriftDetector } from './driftDetector.js';
export { VendorManager } from './vendorManager.js';
export { SecurityAssessor } from './securityAssessor.js';
