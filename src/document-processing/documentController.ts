/**
 * Document controller providing Express Router for document upload operations.
 *
 * Handles multipart form data uploads, validates file types and sizes,
 * and returns created documents with requestId for correlation.
 *
 * Requirements: 1.6, 2.5, 3.4, 12.1, 12.4
 * @module document-processing/documentController
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

import type { Queue } from 'bullmq';

import { DocumentError } from './documentService.js';
import type { DocumentService } from './documentService.js';
import { generateIdempotencyKey, setIdempotencyKey } from './idempotencyService.js';
import { addDocumentProcessingJob, createDocumentProcessingQueue } from './processingQueue.js';
import { PRESIGNED_URL_EXPIRY } from './storageService.js';
import type { StorageService } from './storageService.js';
import type { UploadService } from './uploadService.js';
import type {
  Document,
  DocumentListResponse,
  DocumentPublic,
  DocumentStatus,
  DocumentType,
  ListOptions,
  PaginationInfo,
  UploadedFile,
} from './types.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Express request extended with authenticated user context and file uploads. */
export interface AuthenticatedRequest extends Request {
  userId?: string;
  businessId?: string;
  files?: UploadedFile[];
}

/** Dependencies required by the document router. */
export interface DocumentRouterDeps {
  uploadService: UploadService;
  documentService: DocumentService;
  storageService: StorageService;
  queue?: Queue;
}

// ─── Display Helpers ─────────────────────────────────────────────────────────
/** Map DocumentType enum to a human-readable display string. */
export function getDocumentTypeDisplay(type: DocumentType): string {
  const displayMap: Record<DocumentType, string> = {
    RECEIPT_IMAGE: 'Receipt Image',
    BANK_STATEMENT: 'Bank Statement',
    POS_EXPORT: 'POS Export',
  };
  return displayMap[type];
}

/** Format file size in bytes to a human-readable string. */
export function getFileSizeDisplay(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Map DocumentStatus enum to a human-readable display string. */
export function getStatusDisplay(status: DocumentStatus): string {
  const displayMap: Record<DocumentStatus, string> = {
    UPLOADED: 'Uploaded',
    PROCESSING: 'Processing',
    PARSED: 'Parsed',
    PARTIAL: 'Partially Parsed',
    ERROR: 'Error',
  };
  return displayMap[status];
}

/** Map a DocumentError code to the appropriate HTTP status code. */
export function getHttpStatusForDocError(code: string): number {
  const statusMap: Record<string, number> = {
    DOC_INVALID_FILE_TYPE: 400,
    DOC_FILE_TOO_LARGE: 413,
    DOC_BATCH_TOO_LARGE: 413,
    DOC_INVALID_CSV: 400,
    DOC_NOT_FOUND: 404,
    DOC_FORBIDDEN: 403,
    VALIDATION_ERROR: 400,
    INTERNAL_ERROR: 500,
    DOC_RETRY_NOT_ALLOWED: 400,
    DOC_UPLOAD_FAILED: 500,
  };
  return statusMap[code] ?? 500;
}

/** Convert an internal Document to a public-facing DocumentPublic shape. */
export function toDocumentPublic(doc: Document): DocumentPublic {
  return {
    id: doc.id,
    filename: doc.filename,
    originalFilename: doc.originalFilename,
    documentType: doc.documentType,
    documentTypeDisplay: getDocumentTypeDisplay(doc.documentType),
    fileSize: doc.fileSize,
    fileSizeDisplay: getFileSizeDisplay(doc.fileSize),
    status: doc.status,
    statusDisplay: getStatusDisplay(doc.status),
    transactionsExtracted: doc.transactionsExtracted,
    processingWarnings: doc.processingWarnings,
    processingErrors: doc.processingErrors,
    uploadedAt: doc.uploadedAt.toISOString(),
    updatedAt: doc.updatedAt.toISOString(),
  };
}

// ─── Router Factory ──────────────────────────────────────────────────────────

/**
 * Create an Express Router for document operations.
 *
 * @param deps - Injected dependencies (UploadService)
 * @returns Configured Express Router
 */
export function createDocumentRouter(deps: DocumentRouterDeps): Router {
  const router = Router();

  // POST /upload — handle multipart file uploads
  router.post('/upload', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      const userId = authReq.userId;
      const businessId = authReq.businessId;

      if (!userId || !businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const files = authReq.files;

      if (!files || files.length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'No files provided. Please upload at least one file.',
          },
          requestId,
        });
        return;
      }

      let documents: Document[];

      if (files.length === 1) {
        const doc = await deps.uploadService.uploadFile(files[0]!, userId, businessId);
        documents = [doc];
      } else {
        documents = await deps.uploadService.uploadBatch(files, userId, businessId);
      }

      const publicDocs = documents.map(toDocumentPublic);

      res.status(201).json({
        success: true,
        documents: publicDocs,
        requestId,
      });
    } catch (err) {
      if (err instanceof DocumentError) {
        const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
        const httpStatus = getHttpStatusForDocError(err.code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // GET / — list documents for the authenticated user's business
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      const businessId = authReq.businessId;

      if (!businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
      const rawPageSize = parseInt(req.query['pageSize'] as string, 10) || 20;
      const pageSize = Math.min(Math.max(1, rawPageSize), 100);
      const status = req.query['status'] as DocumentStatus | undefined;
      const type = req.query['type'] as DocumentType | undefined;

      const options: ListOptions = {
        page,
        pageSize,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
        ...(status ? { status } : {}),
        ...(type ? { type } : {}),
      };

      const result = await deps.documentService.listDocuments(businessId, options);

      const documents: DocumentPublic[] = result.documents.map(toDocumentPublic);

      const pagination: PaginationInfo = {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: result.totalPages,
        hasNext: result.page < result.totalPages,
        hasPrevious: result.page > 1,
      };

      const body: DocumentListResponse = {
        success: true,
        documents,
        pagination,
        requestId,
      };

      res.status(200).json(body);
    } catch (err) {
      if (err instanceof DocumentError) {
        const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
        const httpStatus = getHttpStatusForDocError(err.code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // GET /:id — get document details by ID with ownership check
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      const businessId = authReq.businessId;

      if (!businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const documentId = req.params['id']!;
      const document = await deps.documentService.getDocumentById(documentId, businessId);
      const documentPublic = toDocumentPublic(document);

      res.status(200).json({
        success: true,
        document: documentPublic,
        requestId,
      });
    } catch (err) {
      if (err instanceof DocumentError) {
        const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
        const httpStatus = getHttpStatusForDocError(err.code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // POST /:id/retry — retry processing for a document in ERROR status
  router.post('/:id/retry', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      const userId = authReq.userId;
      const businessId = authReq.businessId;

      if (!userId || !businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const documentId = req.params['id']!;
      const document = await deps.documentService.getDocumentById(documentId, businessId);

      if (document.status !== 'ERROR') {
        res.status(400).json({
          success: false,
          error: {
            code: DOC_ERROR_CODES.RETRY_NOT_ALLOWED,
            message: 'Only documents with ERROR status can be retried',
          },
          requestId,
        });
        return;
      }

      const idempotencyKey = generateIdempotencyKey(documentId, 1);
      await setIdempotencyKey(documentId, idempotencyKey);
      const updated = await deps.documentService.updateStatus(documentId, 'PROCESSING');

      const queue = deps.queue ?? createDocumentProcessingQueue();
      await addDocumentProcessingJob(queue, documentId);

      const documentPublic = toDocumentPublic(updated);

      res.status(200).json({
        success: true,
        document: documentPublic,
        requestId,
      });
    } catch (err) {
      if (err instanceof DocumentError) {
        const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
        const httpStatus = getHttpStatusForDocError(err.code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // DELETE /:id — delete a document (S3 + DB) with ownership check
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      const businessId = authReq.businessId;

      if (!businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const documentId = req.params['id']!;
      const document = await deps.documentService.getDocumentById(documentId, businessId);

      await deps.storageService.deleteFile(document.s3Key);
      await deps.documentService.deleteDocument(documentId, businessId);

      res.status(200).json({
        success: true,
        message: 'Document deleted successfully',
        requestId,
      });
    } catch (err) {
      if (err instanceof DocumentError) {
        const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
        const httpStatus = getHttpStatusForDocError(err.code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // GET /:id/download — generate a presigned download URL (Requirements: 8.3, 8.4)
  router.get('/:id/download', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      const businessId = authReq.businessId;

      if (!businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const documentId = req.params['id']!;
      const document = await deps.documentService.getDocumentById(documentId, businessId);

      const url = await deps.storageService.getPresignedUrl(document.s3Key, PRESIGNED_URL_EXPIRY);
      const expiresAt = new Date(Date.now() + PRESIGNED_URL_EXPIRY * 1000).toISOString();

      res.status(200).json({
        success: true,
        url,
        expiresAt,
        requestId,
      });
    } catch (err) {
      if (err instanceof DocumentError) {
        const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
        const httpStatus = getHttpStatusForDocError(err.code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code: err.code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  return router;
}
