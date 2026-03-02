/**
 * Document repository for database operations on the documents table.
 *
 * Provides CRUD operations for document records with pagination support
 * and snake_case ↔ camelCase mapping between PostgreSQL and TypeScript.
 *
 * @module document-processing/documentRepository
 */

import { query } from '../utils/db.js';
import type {
  CreateDocumentData,
  Document,
  DocumentStatus,
  DocumentType,
  ListOptions,
  PaginatedDocuments,
  ProcessingMetadata,
} from './types.js';

// ─── Row Mapping ─────────────────────────────────────────────────────────────

/** Raw row shape returned by PostgreSQL for the documents table. */
interface DocumentRow {
  id: string;
  business_id: string;
  user_id: string;
  filename: string;
  original_filename: string;
  document_type: string;
  mime_type: string;
  file_size: number;
  s3_key: string;
  s3_bucket: string;
  status: string;
  processing_started_at: Date | null;
  processing_completed_at: Date | null;
  processing_duration_ms: number | null;
  transactions_extracted: number | null;
  processing_warnings: string[];
  processing_errors: string[];
  idempotency_key: string | null;
  uploaded_at: Date;
  updated_at: Date;
}

/**
 * Map a database row (snake_case) to a Document domain object (camelCase).
 */
export function mapRowToDocument(row: DocumentRow): Document {
  return {
    id: row.id,
    businessId: row.business_id,
    userId: row.user_id,
    filename: row.filename,
    originalFilename: row.original_filename,
    documentType: row.document_type as DocumentType,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    s3Key: row.s3_key,
    s3Bucket: row.s3_bucket,
    status: row.status as DocumentStatus,
    processingStartedAt: row.processing_started_at,
    processingCompletedAt: row.processing_completed_at,
    processingDurationMs: row.processing_duration_ms,
    transactionsExtracted: row.transactions_extracted,
    processingWarnings: row.processing_warnings ?? [],
    processingErrors: row.processing_errors ?? [],
    idempotencyKey: row.idempotency_key,
    uploadedAt: row.uploaded_at,
    updatedAt: row.updated_at,
  };
}

/** All columns to select from the documents table. */
const ALL_COLUMNS = `id, business_id, user_id, filename, original_filename, document_type,
  mime_type, file_size, s3_key, s3_bucket, status, processing_started_at,
  processing_completed_at, processing_duration_ms, transactions_extracted,
  processing_warnings, processing_errors, idempotency_key, uploaded_at, updated_at`;

/** Map sortBy field names to snake_case column names. */
const SORT_COLUMN_MAP: Record<string, string> = {
  uploadedAt: 'uploaded_at',
  filename: 'filename',
  status: 'status',
};

// ─── Repository Functions ────────────────────────────────────────────────────

/**
 * Create a new document record in the database.
 *
 * @param data - Document creation data
 * @returns The newly created Document record
 */
export async function createDocument(data: CreateDocumentData): Promise<Document> {
  const result = await query<DocumentRow>(
    `INSERT INTO documents (business_id, user_id, filename, original_filename, document_type,
       mime_type, file_size, s3_key, s3_bucket)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${ALL_COLUMNS}`,
    [
      data.businessId,
      data.userId,
      data.filename,
      data.originalFilename,
      data.documentType,
      data.mimeType,
      data.fileSize,
      data.s3Key,
      data.s3Bucket,
    ],
  );

  return mapRowToDocument(result.rows[0]!);
}

/**
 * Find a document by its UUID.
 *
 * @param id - The document UUID
 * @returns The matching Document or null if not found
 */
export async function findDocumentById(id: string): Promise<Document | null> {
  const result = await query<DocumentRow>(
    `SELECT ${ALL_COLUMNS}
     FROM documents
     WHERE id = $1`,
    [id],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocument(result.rows[0]!);
}

/**
 * Find documents by business ID with pagination, filtering, and sorting.
 *
 * @param businessId - The business UUID to filter by
 * @param options - Pagination, sorting, and filtering options
 * @returns Paginated documents result
 */
export async function findDocumentsByBusinessId(
  businessId: string,
  options: ListOptions,
): Promise<PaginatedDocuments> {
  const { page, pageSize, sortBy, sortOrder, status, type } = options;

  const whereClauses: string[] = ['business_id = $1'];
  const params: unknown[] = [businessId];
  let paramIndex = 2;

  if (status) {
    whereClauses.push(`status = $${paramIndex}`);
    params.push(status);
    paramIndex++;
  }

  if (type) {
    whereClauses.push(`document_type = $${paramIndex}`);
    params.push(type);
    paramIndex++;
  }

  const whereClause = whereClauses.join(' AND ');
  const sortColumn = SORT_COLUMN_MAP[sortBy] ?? 'uploaded_at';
  const order = sortOrder === 'asc' ? 'ASC' : 'DESC';
  const offset = (page - 1) * pageSize;

  const total = await countDocumentsByBusinessId(businessId, { status, type });

  const result = await query<DocumentRow>(
    `SELECT ${ALL_COLUMNS}
     FROM documents
     WHERE ${whereClause}
     ORDER BY ${sortColumn} ${order}
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    [...params, pageSize, offset],
  );

  const documents = result.rows.map(mapRowToDocument);
  const totalPages = Math.ceil(total / pageSize);

  return {
    documents,
    total,
    page,
    pageSize,
    totalPages,
  };
}

/**
 * Update a document's status and optional processing metadata.
 *
 * @param id - The document UUID
 * @param status - The new document status
 * @param metadata - Optional processing metadata to update
 * @returns The updated Document or null if not found
 */
export async function updateDocumentStatus(
  id: string,
  status: DocumentStatus,
  metadata?: ProcessingMetadata,
): Promise<Document | null> {
  const setClauses: string[] = ['status = $2', 'updated_at = NOW()'];
  const params: unknown[] = [id, status];
  let paramIndex = 3;

  if (metadata?.processingStartedAt !== undefined) {
    setClauses.push(`processing_started_at = $${paramIndex}`);
    params.push(metadata.processingStartedAt);
    paramIndex++;
  }

  if (metadata?.processingCompletedAt !== undefined) {
    setClauses.push(`processing_completed_at = $${paramIndex}`);
    params.push(metadata.processingCompletedAt);
    paramIndex++;
  }

  if (metadata?.processingDurationMs !== undefined) {
    setClauses.push(`processing_duration_ms = $${paramIndex}`);
    params.push(metadata.processingDurationMs);
    paramIndex++;
  }

  if (metadata?.transactionsExtracted !== undefined) {
    setClauses.push(`transactions_extracted = $${paramIndex}`);
    params.push(metadata.transactionsExtracted);
    paramIndex++;
  }

  if (metadata?.processingWarnings !== undefined) {
    setClauses.push(`processing_warnings = $${paramIndex}`);
    params.push(metadata.processingWarnings);
    paramIndex++;
  }

  if (metadata?.processingErrors !== undefined) {
    setClauses.push(`processing_errors = $${paramIndex}`);
    params.push(metadata.processingErrors);
    paramIndex++;
  }

  const result = await query<DocumentRow>(
    `UPDATE documents
     SET ${setClauses.join(', ')}
     WHERE id = $1
     RETURNING ${ALL_COLUMNS}`,
    params,
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocument(result.rows[0]!);
}

/**
 * Delete a document by its UUID.
 *
 * @param id - The document UUID
 * @returns true if a row was deleted, false if not found
 */
export async function deleteDocument(id: string): Promise<boolean> {
  const result = await query(`DELETE FROM documents WHERE id = $1`, [id]);
  return (result.rowCount ?? 0) > 0;
}

/**
 * Count documents for a business with optional status and type filters.
 *
 * @param businessId - The business UUID
 * @param filters - Optional status and type filters
 * @returns The count of matching documents
 */
export async function countDocumentsByBusinessId(
  businessId: string,
  filters?: { status?: DocumentStatus; type?: DocumentType },
): Promise<number> {
  const whereClauses: string[] = ['business_id = $1'];
  const params: unknown[] = [businessId];
  let paramIndex = 2;

  if (filters?.status) {
    whereClauses.push(`status = $${paramIndex}`);
    params.push(filters.status);
    paramIndex++;
  }

  if (filters?.type) {
    whereClauses.push(`document_type = $${paramIndex}`);
    params.push(filters.type);
    paramIndex++;
  }

  const whereClause = whereClauses.join(' AND ');

  const result = await query<{ count: string }>(
    `SELECT COUNT(*) as count FROM documents WHERE ${whereClause}`,
    params,
  );

  return parseInt(result.rows[0]!.count, 10);
}

/**
 * Find a document by its idempotency key.
 *
 * @param idempotencyKey - The idempotency key to search for
 * @returns The matching Document or null if not found
 */
export async function findDocumentByIdempotencyKey(
  idempotencyKey: string,
): Promise<Document | null> {
  const result = await query<DocumentRow>(
    `SELECT ${ALL_COLUMNS}
     FROM documents
     WHERE idempotency_key = $1`,
    [idempotencyKey],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocument(result.rows[0]!);
}

/**
 * Set the idempotency key on a document record.
 *
 * @param id - The document UUID
 * @param idempotencyKey - The idempotency key to set
 * @returns The updated Document or null if not found
 */
export async function setDocumentIdempotencyKey(
  id: string,
  idempotencyKey: string,
): Promise<Document | null> {
  const result = await query<DocumentRow>(
    `UPDATE documents
     SET idempotency_key = $2, updated_at = NOW()
     WHERE id = $1
     RETURNING ${ALL_COLUMNS}`,
    [id, idempotencyKey],
  );

  if (result.rows.length === 0) {
    return null;
  }

  return mapRowToDocument(result.rows[0]!);
}
