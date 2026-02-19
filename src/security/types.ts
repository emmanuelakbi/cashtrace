/**
 * Type definitions for the Security module.
 *
 * Covers vulnerability management (Requirement 9),
 * incident response (Requirement 10), and related features.
 */

// ─── Vulnerability Management Types (Requirement 9) ───

/**
 * Severity level for a vulnerability.
 */
export type VulnerabilitySeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Status of a vulnerability through its lifecycle.
 */
export type VulnerabilityStatus = 'open' | 'in_progress' | 'resolved' | 'accepted';

/**
 * A known vulnerability found in a dependency.
 */
export interface Vulnerability {
  id: string;
  name: string;
  severity: VulnerabilitySeverity;
  affectedPackage: string;
  version: string;
  fixVersion?: string;
  detectedAt: Date;
  status: VulnerabilityStatus;
  description?: string;
}

/**
 * A dependency to be scanned for vulnerabilities.
 */
export interface Dependency {
  name: string;
  version: string;
}

/**
 * A known vulnerability entry in the vulnerability database.
 */
export interface KnownVulnerabilityEntry {
  id: string;
  name: string;
  severity: VulnerabilitySeverity;
  affectedPackage: string;
  affectedVersions: string[];
  fixVersion?: string;
  description?: string;
}

/**
 * Result of a single vulnerability scan.
 */
export interface ScanResult {
  id: string;
  scannedAt: Date;
  dependenciesScanned: number;
  vulnerabilitiesFound: Vulnerability[];
  duration: number; // milliseconds
}

/**
 * Schedule tracking for weekly scans.
 * Requirement 9.1: Scan dependencies weekly.
 */
export interface ScanSchedule {
  lastScanAt: Date | null;
  nextScanAt: Date;
  intervalDays: number;
}

// ─── Vulnerability Alert Types (Requirement 9.2) ───

/**
 * Status of a vulnerability alert through its lifecycle.
 */
export type AlertStatus = 'pending' | 'sent' | 'acknowledged';

/**
 * A channel through which alerts can be delivered.
 */
export type AlertChannel = 'email' | 'sms' | 'webhook' | 'in_app';

/**
 * A recipient configured to receive vulnerability alerts.
 */
export interface AlertRecipient {
  id: string;
  name: string;
  channel: AlertChannel;
  destination: string; // email address, phone number, webhook URL, etc.
}

/**
 * An alert generated for a critical/high severity vulnerability.
 *
 * Requirement 9.2: Alert on critical vulnerabilities within 24 hours.
 */
export interface VulnerabilityAlert {
  id: string;
  vulnerabilityId: string;
  severity: VulnerabilitySeverity;
  status: AlertStatus;
  createdAt: Date;
  sentAt?: Date;
  acknowledgedAt?: Date;
  recipientIds: string[];
  message: string;
}

// ─── Remediation Tracking Types (Requirement 9.3) ───

/**
 * Status of a remediation task through its lifecycle.
 */
export type RemediationStatus = 'open' | 'in_progress' | 'resolved' | 'verified';

/**
 * A remediation task linked to a vulnerability.
 *
 * Requirement 9.3: Track vulnerability remediation status.
 */
export interface RemediationTask {
  id: string;
  vulnerabilityId: string;
  status: RemediationStatus;
  assignee: string;
  createdAt: Date;
  updatedAt: Date;
  slaDeadline: Date;
  resolvedAt?: Date;
  verifiedAt?: Date;
  notes?: string;
}

/**
 * Summary of remediation tasks grouped by status.
 */
export interface RemediationSummary {
  total: number;
  open: number;
  inProgress: number;
  resolved: number;
  verified: number;
  overdue: number;
}

// ─── Incident Response Types (Requirement 10) ───

/**
 * Severity level for a security incident.
 * Requirement 10.1: Define incident severity levels.
 */
export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * Type of security incident.
 */
export type IncidentType = 'breach' | 'unauthorized_access' | 'data_loss' | 'vulnerability';

/**
 * Status of a security incident through its lifecycle.
 */
export type IncidentStatus = 'open' | 'investigating' | 'contained' | 'resolved' | 'closed';

/**
 * A security incident tracked by the incident manager.
 *
 * Requirement 10.1, 10.2
 */
export interface SecurityIncident {
  id: string;
  severity: IncidentSeverity;
  type: IncidentType;
  status: IncidentStatus;
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
 * Escalation procedure for a given severity level.
 *
 * Requirement 10.2: Define escalation procedures per severity level.
 */
export interface EscalationProcedure {
  severity: IncidentSeverity;
  responseTimeMs: number;
  notifyRoles: string[];
  description: string;
}

/**
 * Record of an escalation action taken for an incident.
 */
export interface EscalationRecord {
  incidentId: string;
  severity: IncidentSeverity;
  escalatedAt: Date;
  notifiedRoles: string[];
  procedure: EscalationProcedure;
}

// ─── Incident Documentation Types (Requirement 10.3, 10.4) ───

/**
 * Type of timeline entry for incident documentation.
 * Requirement 10.3: Support incident documentation and timeline tracking.
 */
export type TimelineEntryType =
  | 'detection'
  | 'investigation'
  | 'containment'
  | 'resolution'
  | 'notification'
  | 'other';

/**
 * A timestamped entry in an incident's timeline.
 * Requirement 10.3: Support incident documentation and timeline tracking.
 */
export interface TimelineEntry {
  id: string;
  incidentId: string;
  timestamp: Date;
  description: string;
  author: string;
  entryType: TimelineEntryType;
}

/**
 * Status of a post-incident review action item.
 * Requirement 10.4: Support post-incident review and lessons learned.
 */
export type ActionItemStatus = 'open' | 'in_progress' | 'completed';

/**
 * An action item from a post-incident review.
 * Requirement 10.4: Support post-incident review and lessons learned.
 */
export interface ActionItem {
  description: string;
  assignee: string;
  status: ActionItemStatus;
}

/**
 * A post-incident review capturing lessons learned.
 * Requirement 10.4: Support post-incident review and lessons learned.
 */
export interface PostIncidentReview {
  id: string;
  incidentId: string;
  summary: string;
  rootCause: string;
  lessonsLearned: string[];
  actionItems: ActionItem[];
  reviewDate: Date;
  reviewers: string[];
}

// ─── Secure Configuration Types (Requirement 11) ───

/**
 * Category of a security configuration rule.
 * Requirement 11.1, 11.5
 */
export type ConfigRuleCategory =
  | 'authentication'
  | 'encryption'
  | 'network'
  | 'logging'
  | 'access_control';

/**
 * Severity of a configuration rule violation.
 */
export type ConfigRuleSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A CIS-inspired security configuration rule.
 *
 * Requirement 11.5: Validate configurations against security benchmarks (CIS).
 */
export interface ConfigRule {
  id: string;
  name: string;
  description: string;
  severity: ConfigRuleSeverity;
  category: ConfigRuleCategory;
  check: (config: ServiceConfig) => boolean;
}

/**
 * Result of a single rule check against a configuration.
 */
export interface ConfigRuleResult {
  ruleId: string;
  ruleName: string;
  severity: ConfigRuleSeverity;
  category: ConfigRuleCategory;
  passed: boolean;
  description: string;
}

/**
 * Aggregated result of validating a configuration against all rules.
 */
export interface ConfigValidationResult {
  valid: boolean;
  totalRules: number;
  passed: number;
  failed: number;
  results: ConfigRuleResult[];
}

/**
 * Service configuration object validated by ConfigValidator.
 *
 * Requirement 11.1: Enforce secure defaults for all services.
 */
export interface ServiceConfig {
  authentication: {
    passwordMinLength: number;
    requireUppercase: boolean;
    requireLowercase: boolean;
    requireNumbers: boolean;
    requireSpecialChars: boolean;
    maxLoginAttempts: number;
    lockoutDurationMs: number;
    sessionTimeoutMs: number;
    mfaEnabled: boolean;
  };
  encryption: {
    algorithm: string;
    keyLengthBits: number;
    tlsMinVersion: string;
    enforceHttps: boolean;
    certificateValidation: boolean;
  };
  network: {
    allowedPorts: number[];
    corsEnabled: boolean;
    corsAllowAll: boolean;
    rateLimitEnabled: boolean;
    rateLimitMaxRequests: number;
    rateLimitWindowMs: number;
  };
  logging: {
    enabled: boolean;
    logLevel: string;
    auditEnabled: boolean;
    logSensitiveData: boolean;
    retentionDays: number;
  };
  accessControl: {
    rbacEnabled: boolean;
    defaultDeny: boolean;
    enforceBusinessIsolation: boolean;
    maxSessionsPerUser: number;
  };
}

// ─── Drift Detection Types (Requirement 11.6) ───

/**
 * Severity of a configuration drift.
 */
export type DriftSeverity = 'critical' | 'high' | 'medium' | 'low';

/**
 * A single field that has drifted from the baseline.
 *
 * Requirement 11.6: Alert on configuration drift from secure baseline.
 */
export interface DriftItem {
  fieldPath: string;
  baselineValue: unknown;
  currentValue: unknown;
  severity: DriftSeverity;
}

/**
 * Summary of drift counts grouped by severity.
 */
export interface DriftSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
}

// ─── Third-Party Vendor Types (Requirement 12) ───

/**
 * Status of a third-party vendor.
 * Requirement 12.1: Maintain inventory of third-party services.
 */
export type VendorStatus = 'active' | 'suspended' | 'revoked' | 'pending_review';

/**
 * A third-party vendor in the vendor inventory.
 *
 * Requirement 12.1: Maintain inventory of third-party services and data shared.
 */
export interface Vendor {
  id: string;
  name: string;
  description: string;
  dataShared: string[];
  integrationDate: Date;
  status: VendorStatus;
}

// ─── Security Assessment Types (Requirement 12.2) ───

/**
 * Recommendation from a security assessment.
 * Requirement 12.2: Assess third-party security posture before integration.
 */
export type AssessmentRecommendation = 'approve' | 'reject' | 'conditional';

/**
 * A security assessment for a third-party vendor.
 *
 * Requirement 12.2: Assess third-party security posture before integration.
 */
export interface SecurityAssessment {
  id: string;
  vendorId: string;
  assessor: string;
  date: Date;
  score: number; // 0–100
  findings: string[];
  recommendation: AssessmentRecommendation;
  conditions: string[];
}

/**
 * A record of a vendor access revocation.
 *
 * Requirement 12.5: Support third-party access revocation.
 */
export interface RevocationRecord {
  vendorId: string;
  reason: string;
  revokedBy: string;
  revokedAt: Date;
}
