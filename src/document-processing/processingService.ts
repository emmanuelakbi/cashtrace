/**
 * ProcessingService — orchestrates document processing by routing to
 * the appropriate extractor based on document type.
 *
 * Downloads the file from S3, delegates extraction to type-specific
 * extractors (receipt, bank statement, POS export), and returns a
 * ProcessingResult with status, transaction count, and timing.
 *
 * Requirements: 10.2, 10.3, 11.3
 * @module document-processing/processingService
 */

import * as documentRepository from './documentRepository.js';
import type { ProcessingServiceInterface } from './processingWorker.js';
import type { StorageService } from './storageService.js';
import type { Document, ExtractionResult, ProcessingResult } from './types.js';

// ─── Extractor Interface ─────────────────────────────────────────────────────

/**
 * Interface for document type-specific extraction handlers.
 * Each extractor receives the raw file buffer and document metadata,
 * then returns extracted transactions with confidence and warnings.
 */
export interface DocumentExtractor {
  extract(buffer: Buffer, document: Document): Promise<ExtractionResult>;
}

// ─── Dependencies ────────────────────────────────────────────────────────────

export interface ProcessingServiceDeps {
  storageService: StorageService;
  receiptExtractor: DocumentExtractor;
  bankStatementExtractor: DocumentExtractor;
  posExportExtractor: DocumentExtractor;
}

// ─── ProcessingService ───────────────────────────────────────────────────────

export class ProcessingService implements ProcessingServiceInterface {
  private readonly storageService: StorageService;
  private readonly receiptExtractor: DocumentExtractor;
  private readonly bankStatementExtractor: DocumentExtractor;
  private readonly posExportExtractor: DocumentExtractor;

  constructor(deps: ProcessingServiceDeps) {
    this.storageService = deps.storageService;
    this.receiptExtractor = deps.receiptExtractor;
    this.bankStatementExtractor = deps.bankStatementExtractor;
    this.posExportExtractor = deps.posExportExtractor;
  }

  async processDocument(documentId: string): Promise<ProcessingResult> {
    const startTime = Date.now();

    // 1. Fetch document from DB
    const document = await documentRepository.findDocumentById(documentId);

    if (!document) {
      throw new Error(`Document not found: ${documentId}`);
    }

    // 2. Download file from S3
    const buffer = await this.storageService.getFile(document.s3Key);

    // 3. Route to appropriate extractor based on document type
    const extractor = this.getExtractor(document.documentType);
    const extraction = await extractor.extract(buffer, document);

    // 4. Build ProcessingResult
    const processingTimeMs = Date.now() - startTime;
    const hasWarnings = extraction.warnings.length > 0;
    const status = hasWarnings ? 'PARTIAL' : 'PARSED';

    return {
      success: true,
      status,
      transactionsExtracted: extraction.transactions.length,
      warnings: extraction.warnings,
      errors: extraction.errors,
      processingTimeMs,
    };
  }

  /**
   * Select the correct extractor for a given document type.
   */
  private getExtractor(documentType: Document['documentType']): DocumentExtractor {
    switch (documentType) {
      case 'RECEIPT_IMAGE':
        return this.receiptExtractor;
      case 'BANK_STATEMENT':
        return this.bankStatementExtractor;
      case 'POS_EXPORT':
        return this.posExportExtractor;
    }
  }
}
