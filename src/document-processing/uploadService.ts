/**
 * Upload service orchestrating file validation, S3 storage, database record creation,
 * and processing queue submission.
 *
 * Requirements: 1.4, 1.5, 5.2, 11.1
 * @module document-processing/uploadService
 */

import type { Queue } from 'bullmq';
import { v4 as uuidv4 } from 'uuid';

import * as documentRepository from './documentRepository.js';
import { DocumentError } from './documentService.js';
import { validateFileType } from './fileTypeValidator.js';
import { addDocumentProcessingJob, createDocumentProcessingQueue } from './processingQueue.js';
import { shouldUseMultipart, validateBatchSize, validateFileSize } from './sizeValidator.js';
import { generateS3Key, sanitizeFilename, type StorageService } from './storageService.js';
import type { CreateDocumentData, Document, UploadedFile } from './types.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── UploadService ───────────────────────────────────────────────────────────

export class UploadService {
  private readonly storageService: StorageService;
  private queue: Queue | null = null;

  constructor(storageService: StorageService, queue?: Queue) {
    this.storageService = storageService;
    this.queue = queue ?? null;
  }

  /**
   * Upload a single file: validate, store in S3, create DB record, queue processing.
   *
   * @param file - The uploaded file with buffer and metadata
   * @param userId - The authenticated user's ID
   * @param businessId - The user's business ID
   * @returns The created Document with UPLOADED status
   */
  async uploadFile(file: UploadedFile, userId: string, businessId: string): Promise<Document> {
    // 1. Validate file type using magic bytes
    const typeValidation = validateFileType(file.buffer);
    if (!typeValidation.valid || !typeValidation.detectedType || !typeValidation.detectedMime) {
      throw new DocumentError(
        DOC_ERROR_CODES.INVALID_FILE_TYPE,
        typeValidation.error ?? 'Unsupported file type. Supported formats: JPEG, PNG, PDF, CSV',
      );
    }

    // 2. Validate file size
    const sizeValidation = validateFileSize(file.size);
    if (!sizeValidation.valid) {
      throw new DocumentError(
        DOC_ERROR_CODES.FILE_TOO_LARGE,
        sizeValidation.error ?? `File size exceeds the maximum limit of 10MB`,
      );
    }

    // 3. Generate document ID and S3 key
    const documentId = uuidv4();
    const s3Key = generateS3Key(
      businessId,
      typeValidation.detectedType,
      documentId,
      file.originalname,
    );

    // 4. Upload to S3 (multipart if > 5MB)
    const uploadResult = shouldUseMultipart(file.size)
      ? await this.storageService.uploadMultipart(file.buffer, s3Key, typeValidation.detectedMime)
      : await this.storageService.uploadFile(file.buffer, s3Key, typeValidation.detectedMime);

    // 5. Create document record in database with UPLOADED status
    const createData: CreateDocumentData = {
      businessId,
      userId,
      filename: sanitizeFilename(file.originalname),
      originalFilename: file.originalname,
      documentType: typeValidation.detectedType,
      mimeType: typeValidation.detectedMime,
      fileSize: file.size,
      s3Key: uploadResult.key,
      s3Bucket: uploadResult.bucket,
    };

    const document = await documentRepository.createDocument(createData);

    // 6. Queue processing job (placeholder — actual queue in task 12)
    await this.queueProcessingJob(document.id);

    return document;
  }

  /**
   * Upload multiple files as a batch.
   * Validates total batch size before processing individual files.
   *
   * @param files - Array of uploaded files
   * @param userId - The authenticated user's ID
   * @param businessId - The user's business ID
   * @returns Array of created Documents
   */
  async uploadBatch(
    files: UploadedFile[],
    userId: string,
    businessId: string,
  ): Promise<Document[]> {
    // Validate batch total size
    const batchValidation = validateBatchSize(files.map((f) => f.size));
    if (!batchValidation.valid) {
      throw new DocumentError(
        DOC_ERROR_CODES.BATCH_TOO_LARGE,
        batchValidation.error ?? 'Batch total size exceeds the maximum limit of 50MB',
      );
    }

    const documents: Document[] = [];
    for (const file of files) {
      const doc = await this.uploadFile(file, userId, businessId);
      documents.push(doc);
    }

    return documents;
  }

  /**
   * Queue a document for async processing via BullMQ.
   *
   * @param documentId - The document ID to queue for processing
   */
  protected async queueProcessingJob(documentId: string): Promise<void> {
    if (!this.queue) {
      this.queue = createDocumentProcessingQueue();
    }
    await addDocumentProcessingJob(this.queue, documentId);
  }
}
