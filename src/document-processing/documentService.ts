/**
 * Document service providing business logic for document management.
 *
 * Handles document CRUD operations with ownership verification,
 * pagination, and proper error handling using DOC_ERROR_CODES.
 *
 * @module document-processing/documentService
 */

import * as documentRepository from './documentRepository.js';
import type {
  CreateDocumentData,
  Document,
  DocumentStatus,
  ListOptions,
  PaginatedDocuments,
  ProcessingMetadata,
} from './types.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── Error Class ─────────────────────────────────────────────────────────────

/**
 * Custom error class for document-related errors.
 * Carries a machine-readable error code from DOC_ERROR_CODES.
 */
export class DocumentError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'DocumentError';
    this.code = code;
  }
}

// ─── DocumentService ─────────────────────────────────────────────────────────

export class DocumentService {
  /**
   * Create a new document record.
   *
   * Delegates directly to the repository after populating metadata.
   */
  async createDocument(data: CreateDocumentData): Promise<Document> {
    return documentRepository.createDocument(data);
  }

  /**
   * Get a document by ID with ownership verification.
   *
   * @param documentId - The document UUID
   * @param businessId - The requesting user's business ID
   * @throws DocumentError with DOC_NOT_FOUND if document does not exist
   * @throws DocumentError with DOC_FORBIDDEN if business does not own the document
   */
  async getDocumentById(documentId: string, businessId: string): Promise<Document> {
    const document = await documentRepository.findDocumentById(documentId);

    if (!document) {
      throw new DocumentError(DOC_ERROR_CODES.NOT_FOUND, 'Document not found');
    }

    if (document.businessId !== businessId) {
      throw new DocumentError(
        DOC_ERROR_CODES.FORBIDDEN,
        'You do not have permission to access this document',
      );
    }

    return document;
  }

  /**
   * List documents for a business with pagination and filtering.
   *
   * @param businessId - The business UUID to list documents for
   * @param options - Pagination, sorting, and filtering options
   */
  async listDocuments(businessId: string, options: ListOptions): Promise<PaginatedDocuments> {
    return documentRepository.findDocumentsByBusinessId(businessId, options);
  }

  /**
   * Update a document's processing status and metadata.
   *
   * @param documentId - The document UUID
   * @param status - The new status
   * @param metadata - Optional processing metadata
   * @throws DocumentError with DOC_NOT_FOUND if document does not exist
   */
  async updateStatus(
    documentId: string,
    status: DocumentStatus,
    metadata?: ProcessingMetadata,
  ): Promise<Document> {
    const updated = await documentRepository.updateDocumentStatus(documentId, status, metadata);

    if (!updated) {
      throw new DocumentError(DOC_ERROR_CODES.NOT_FOUND, 'Document not found');
    }

    return updated;
  }

  /**
   * Delete a document after verifying ownership.
   *
   * @param documentId - The document UUID
   * @param businessId - The requesting user's business ID
   * @throws DocumentError with DOC_NOT_FOUND if document does not exist
   * @throws DocumentError with DOC_FORBIDDEN if business does not own the document
   */
  async deleteDocument(documentId: string, businessId: string): Promise<void> {
    const document = await documentRepository.findDocumentById(documentId);

    if (!document) {
      throw new DocumentError(DOC_ERROR_CODES.NOT_FOUND, 'Document not found');
    }

    if (document.businessId !== businessId) {
      throw new DocumentError(
        DOC_ERROR_CODES.FORBIDDEN,
        'You do not have permission to delete this document',
      );
    }

    await documentRepository.deleteDocument(documentId);
  }

  /**
   * Verify that a document belongs to the given business.
   *
   * @param documentId - The document UUID
   * @param businessId - The business UUID to check against
   * @returns true if the document belongs to the business, false otherwise
   */
  async verifyOwnership(documentId: string, businessId: string): Promise<boolean> {
    const document = await documentRepository.findDocumentById(documentId);

    if (!document) {
      return false;
    }

    return document.businessId === businessId;
  }
}
