/**
 * Core type definitions for the business management module.
 * All types are derived from the design document data models.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

/** Predefined Nigerian SME business sectors */
export enum BusinessSector {
  RETAIL_TRADING = 'RETAIL_TRADING',
  PROFESSIONAL_SERVICES = 'PROFESSIONAL_SERVICES',
  MANUFACTURING = 'MANUFACTURING',
  AGRICULTURE_AGRIBUSINESS = 'AGRICULTURE_AGRIBUSINESS',
  TECHNOLOGY_DIGITAL = 'TECHNOLOGY_DIGITAL',
  HOSPITALITY_FOOD = 'HOSPITALITY_FOOD',
  TRANSPORTATION_LOGISTICS = 'TRANSPORTATION_LOGISTICS',
  HEALTHCARE_PHARMA = 'HEALTHCARE_PHARMA',
  EDUCATION_TRAINING = 'EDUCATION_TRAINING',
  CONSTRUCTION_REAL_ESTATE = 'CONSTRUCTION_REAL_ESTATE',
  OTHER = 'OTHER',
}

/** Human-readable display names for business sectors */
export const SECTOR_DISPLAY_NAMES: Record<BusinessSector, string> = {
  [BusinessSector.RETAIL_TRADING]: 'Retail & Trading',
  [BusinessSector.PROFESSIONAL_SERVICES]: 'Professional Services',
  [BusinessSector.MANUFACTURING]: 'Manufacturing',
  [BusinessSector.AGRICULTURE_AGRIBUSINESS]: 'Agriculture & Agribusiness',
  [BusinessSector.TECHNOLOGY_DIGITAL]: 'Technology & Digital Services',
  [BusinessSector.HOSPITALITY_FOOD]: 'Hospitality & Food Services',
  [BusinessSector.TRANSPORTATION_LOGISTICS]: 'Transportation & Logistics',
  [BusinessSector.HEALTHCARE_PHARMA]: 'Healthcare & Pharmaceuticals',
  [BusinessSector.EDUCATION_TRAINING]: 'Education & Training',
  [BusinessSector.CONSTRUCTION_REAL_ESTATE]: 'Construction & Real Estate',
  [BusinessSector.OTHER]: 'Other',
};

/** Supported currencies */
export enum Currency {
  NGN = 'NGN',
  USD = 'USD',
  GBP = 'GBP',
}

/** Business audit event types */
export enum BusinessEventType {
  BUSINESS_CREATED = 'BUSINESS_CREATED',
  BUSINESS_UPDATED = 'BUSINESS_UPDATED',
  BUSINESS_SOFT_DELETED = 'BUSINESS_SOFT_DELETED',
  BUSINESS_RESTORED = 'BUSINESS_RESTORED',
  BUSINESS_HARD_DELETED = 'BUSINESS_HARD_DELETED',
  BUSINESS_EXPORTED = 'BUSINESS_EXPORTED',
}

// ─── Data Models ─────────────────────────────────────────────────────────────

/** Business entity with soft delete support */
export interface Business {
  /** UUID v4 identifier */
  id: string;
  /** Foreign key to User (from core-auth) */
  userId: string;
  /** Business name, 2-100 characters */
  name: string;
  /** Predefined Nigerian SME sector */
  sector: BusinessSector;
  /** Currency, defaults to NGN */
  currency: Currency;
  /** Record creation timestamp */
  createdAt: Date;
  /** Last update timestamp */
  updatedAt: Date;
  /** Soft delete timestamp, null if not deleted */
  deletedAt: Date | null;
  /** Scheduled hard delete date (deletedAt + 30 days), null if not deleted */
  hardDeleteAt: Date | null;
}

/** Business audit log entry */
export interface BusinessAuditLog {
  /** UUID v4 identifier */
  id: string;
  /** Type of business event */
  eventType: BusinessEventType;
  /** User who performed the action */
  userId: string;
  /** Business affected by the action */
  businessId: string;
  /** IP address of the requester */
  ipAddress: string;
  /** User agent string of the requester */
  userAgent: string;
  /** Correlation ID for request tracing */
  requestId: string;
  /** Previous field values (for updates) */
  previousValues: Record<string, unknown> | null;
  /** New field values (for creates/updates) */
  newValues: Record<string, unknown> | null;
  /** Audit log creation timestamp */
  createdAt: Date;
}
// ─── API Request Types ───────────────────────────────────────────────────────

/** Request payload for creating a business */
export interface CreateBusinessRequest {
  /** Business name, required, 2-100 characters */
  name: string;
  /** Business sector, optional, defaults to OTHER */
  sector?: BusinessSector;
}

/** Request payload for updating a business */
export interface UpdateBusinessRequest {
  /** Business name, optional, 2-100 characters if provided */
  name?: string;
  /** Business sector, optional */
  sector?: BusinessSector;
}

// ─── API Response Types ──────────────────────────────────────────────────────

/** Public-facing business data (excludes internal fields) */
export interface BusinessPublic {
  /** UUID v4 identifier */
  id: string;
  /** Business name */
  name: string;
  /** Business sector enum value */
  sector: BusinessSector;
  /** Human-readable sector name */
  sectorDisplay: string;
  /** Currency code */
  currency: Currency;
  /** ISO 8601 creation timestamp */
  createdAt: string;
  /** ISO 8601 last update timestamp */
  updatedAt: string;
}

/** Success response containing a business profile */
export interface BusinessResponse {
  success: boolean;
  business: BusinessPublic;
  requestId: string;
}

/** Success response for data export */
export interface ExportResponse {
  success: boolean;
  data: BusinessExport;
  requestId: string;
}

/** Generic success response (e.g., for delete operations) */
export interface GenericResponse {
  success: boolean;
  message: string;
  requestId: string;
}

/** Error response with structured error details */
export interface ErrorResponse {
  success: false;
  error: {
    /** Machine-readable error code */
    code: string;
    /** Human-readable error message */
    message: string;
    /** Field-specific validation errors */
    fields?: Record<string, string[]>;
  };
  requestId: string;
}

// ─── Export Types ─────────────────────────────────────────────────────────────

/** Complete business data export for NDPR compliance */
export interface BusinessExport {
  /** Timestamp when the export was generated */
  exportedAt: Date;
  /** Complete business profile */
  business: Business;
  /** All audit trail entries for the business */
  auditTrail: BusinessAuditLog[];
  /** Export metadata */
  metadata: ExportMetadata;
}

/** Metadata included in data exports */
export interface ExportMetadata {
  /** Export format version */
  version: string;
  /** Export file format */
  format: 'json';
  /** Whether the export includes soft-deleted data */
  includesDeletedData: boolean;
}

// ─── Audit Event Types ───────────────────────────────────────────────────────

/** Input for creating a business audit log entry */
export interface BusinessAuditEvent {
  /** Type of business event */
  eventType: BusinessEventType;
  /** User who performed the action */
  userId: string;
  /** Business affected by the action */
  businessId: string;
  /** IP address of the requester */
  ipAddress: string;
  /** Previous field values (for updates) */
  previousValues?: Record<string, unknown>;
  /** New field values (for creates/updates) */
  newValues?: Record<string, unknown>;
}

// ─── Error Codes ─────────────────────────────────────────────────────────────

/** Business module error codes */
export const BUSINESS_ERROR_CODES = {
  ALREADY_EXISTS: 'BUSINESS_ALREADY_EXISTS',
  NOT_FOUND: 'BUSINESS_NOT_FOUND',
  DELETED: 'BUSINESS_DELETED',
  FORBIDDEN: 'BUSINESS_FORBIDDEN',
  INVALID_NAME: 'BUSINESS_INVALID_NAME',
  INVALID_SECTOR: 'BUSINESS_INVALID_SECTOR',
  RECOVERY_EXPIRED: 'BUSINESS_RECOVERY_EXPIRED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Union type of all business error codes */
export type BusinessErrorCode = (typeof BUSINESS_ERROR_CODES)[keyof typeof BUSINESS_ERROR_CODES];
