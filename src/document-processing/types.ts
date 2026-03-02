/**
 * Type definitions for the document-processing module.
 * All types are derived from the design document data models.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export type DocumentType = 'RECEIPT_IMAGE' | 'BANK_STATEMENT' | 'POS_EXPORT';

export type DocumentStatus = 'UPLOADED' | 'PROCESSING' | 'PARSED' | 'PARTIAL' | 'ERROR';

export type JobStatus = 'PENDING' | 'ACTIVE' | 'COMPLETED' | 'FAILED' | 'RETRYING';

// ─── Data Models ─────────────────────────────────────────────────────────────

export interface Document {
  id: string;
  businessId: string;
  userId: string;
  filename: string;
  originalFilename: string;
  documentType: DocumentType;
  mimeType: string;
  fileSize: number;
  s3Key: string;
  s3Bucket: string;
  status: DocumentStatus;
  processingStartedAt: Date | null;
  processingCompletedAt: Date | null;
  processingDurationMs: number | null;
  transactionsExtracted: number | null;
  processingWarnings: string[];
  processingErrors: string[];
  idempotencyKey: string | null;
  uploadedAt: Date;
  updatedAt: Date;
}

export interface ProcessingJob {
  id: string;
  documentId: string;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRetryAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

// ─── Upload Types ────────────────────────────────────────────────────────────

export interface UploadedFile {
  buffer: Buffer;
  originalname: string;
  mimetype: string;
  size: number;
}

export interface FileTypeValidation {
  valid: boolean;
  detectedType: DocumentType | null;
  detectedMime: string | null;
  error?: string;
}

export interface SizeValidation {
  valid: boolean;
  size: number;
  limit: number;
  error?: string;
}

// ─── Service Types ───────────────────────────────────────────────────────────

export interface UploadResult {
  key: string;
  bucket: string;
  etag: string;
  size: number;
}

export interface DetectedFileType {
  mime: string;
  ext: string;
  documentType: DocumentType | null;
}

export interface ValidationResult {
  valid: boolean;
  detected: DetectedFileType;
  expected: DocumentType;
  error?: string;
}

export interface ListOptions {
  page: number;
  pageSize: number;
  sortBy: 'uploadedAt' | 'filename' | 'status';
  sortOrder: 'asc' | 'desc';
  status?: DocumentStatus;
  type?: DocumentType;
}

export interface PaginatedDocuments {
  documents: Document[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ProcessingResult {
  success: boolean;
  status: DocumentStatus;
  transactionsExtracted: number;
  warnings: string[];
  errors: string[];
  processingTimeMs: number;
}

export interface ExtractionResult {
  transactions: ExtractedTransaction[];
  warnings: string[];
  errors: string[];
  confidence: number;
}

export interface ExtractedTransaction {
  date: Date;
  description: string;
  amount: number;
  type: 'credit' | 'debit';
  category?: string;
  reference?: string;
  metadata: Record<string, unknown>;
}

export interface ProcessingMetadata {
  processingStartedAt?: Date;
  processingCompletedAt?: Date;
  processingDurationMs?: number;
  transactionsExtracted?: number;
  processingWarnings?: string[];
  processingErrors?: string[];
}

// ─── API Request Types ───────────────────────────────────────────────────────

export interface UploadRequest {
  files: UploadedFile[];
}

export interface ListDocumentsRequest {
  page?: number;
  pageSize?: number;
  status?: DocumentStatus;
  type?: DocumentType;
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface UploadResponse {
  success: boolean;
  documents: DocumentPublic[];
  requestId: string;
}

export interface DocumentListResponse {
  success: boolean;
  documents: DocumentPublic[];
  pagination: PaginationInfo;
  requestId: string;
}

export interface DocumentResponse {
  success: boolean;
  document: DocumentPublic;
  requestId: string;
}

export interface DownloadUrlResponse {
  success: boolean;
  url: string;
  expiresAt: string;
  requestId: string;
}

export interface DocumentPublic {
  id: string;
  filename: string;
  originalFilename: string;
  documentType: DocumentType;
  documentTypeDisplay: string;
  fileSize: number;
  fileSizeDisplay: string;
  status: DocumentStatus;
  statusDisplay: string;
  transactionsExtracted: number | null;
  processingWarnings: string[];
  processingErrors: string[];
  uploadedAt: string;
  updatedAt: string;
}

export interface PaginationInfo {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

export interface GenericResponse {
  success: boolean;
  message: string;
  requestId: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
  requestId: string;
}

// ─── Repository Types ────────────────────────────────────────────────────────

export interface CreateDocumentData {
  businessId: string;
  userId: string;
  filename: string;
  originalFilename: string;
  documentType: DocumentType;
  mimeType: string;
  fileSize: number;
  s3Key: string;
  s3Bucket: string;
}

// ─── Storage Configuration ────────────────────────────────────────────────────

export interface StorageServiceConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
  encryption?: 'AES256' | 'aws:kms';
}

// ─── Error Codes ─────────────────────────────────────────────────────────────

export const DOC_ERROR_CODES = {
  INVALID_FILE_TYPE: 'DOC_INVALID_FILE_TYPE',
  FILE_TOO_LARGE: 'DOC_FILE_TOO_LARGE',
  BATCH_TOO_LARGE: 'DOC_BATCH_TOO_LARGE',
  INVALID_CSV: 'DOC_INVALID_CSV',
  NOT_FOUND: 'DOC_NOT_FOUND',
  FORBIDDEN: 'DOC_FORBIDDEN',
  ALREADY_PROCESSING: 'DOC_ALREADY_PROCESSING',
  RETRY_NOT_ALLOWED: 'DOC_RETRY_NOT_ALLOWED',
  INVALID_TRANSITION: 'DOC_INVALID_TRANSITION',
  UPLOAD_FAILED: 'DOC_UPLOAD_FAILED',
  PROCESSING_FAILED: 'DOC_PROCESSING_FAILED',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type DocErrorCode = (typeof DOC_ERROR_CODES)[keyof typeof DOC_ERROR_CODES];
