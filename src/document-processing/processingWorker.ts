/**
 * BullMQ processing worker for async document processing.
 *
 * Listens on the document-processing queue, transitions document status
 * through the state machine, delegates extraction to a ProcessingService,
 * and records processing timing metadata.
 *
 * Requirements: 5.3, 5.4, 5.5, 5.6
 * @module document-processing/processingWorker
 */

import { Worker, type Job } from 'bullmq';

import * as documentRepository from './documentRepository.js';
import {
  QUEUE_NAME,
  type DocumentJobData,
  type QueueRedisConfig,
  getWorkerConnectionOptions,
} from './processingQueue.js';
import { validateTransition } from './statusMachine.js';
import type { DocumentStatus, ProcessingMetadata, ProcessingResult } from './types.js';

// ─── ProcessingService Interface ─────────────────────────────────────────────

/**
 * Interface for the processing service dependency.
 * The concrete implementation is created in task 13.
 */
export interface ProcessingServiceInterface {
  processDocument(documentId: string): Promise<ProcessingResult>;
}

// ─── Worker Dependencies ─────────────────────────────────────────────────────

export interface ProcessingWorkerDeps {
  processingService: ProcessingServiceInterface;
  redisConfig?: QueueRedisConfig;
  concurrency?: number;
}

// ─── Worker Result ───────────────────────────────────────────────────────────

export interface WorkerResult {
  documentId: string;
  status: DocumentStatus;
  processingDurationMs: number;
}

// ─── Job Processor ───────────────────────────────────────────────────────────

/**
 * Process a single document job.
 *
 * 1. Fetches the document and validates UPLOADED/ERROR → PROCESSING transition
 * 2. Updates status to PROCESSING with processingStartedAt
 * 3. Calls ProcessingService.processDocument
 * 4. On success: updates to PARSED or PARTIAL based on result
 * 5. On failure: updates to ERROR with error details
 */
export async function processJob(
  job: Job<DocumentJobData>,
  processingService: ProcessingServiceInterface,
): Promise<WorkerResult> {
  const { documentId } = job.data;
  const processingStartedAt = new Date();

  // 1. Fetch document and validate transition to PROCESSING
  const document = await documentRepository.findDocumentById(documentId);

  if (!document) {
    throw new Error(`Document not found: ${documentId}`);
  }

  validateTransition(document.status, 'PROCESSING');

  // 2. Update status to PROCESSING
  await documentRepository.updateDocumentStatus(documentId, 'PROCESSING', {
    processingStartedAt,
  });

  // 3. Call ProcessingService
  let result: ProcessingResult;
  try {
    result = await processingService.processDocument(documentId);
  } catch (error) {
    // 5. On failure: update to ERROR
    const processingCompletedAt = new Date();
    const processingDurationMs = processingCompletedAt.getTime() - processingStartedAt.getTime();
    const errorMessage = error instanceof Error ? error.message : String(error);

    await documentRepository.updateDocumentStatus(documentId, 'ERROR', {
      processingCompletedAt,
      processingDurationMs,
      processingErrors: [errorMessage],
    });

    throw error;
  }

  // 4. On success: update to PARSED or PARTIAL
  const processingCompletedAt = new Date();
  const processingDurationMs = processingCompletedAt.getTime() - processingStartedAt.getTime();

  const finalStatus: DocumentStatus = result.status === 'PARTIAL' ? 'PARTIAL' : 'PARSED';

  const metadata: ProcessingMetadata = {
    processingCompletedAt,
    processingDurationMs,
    transactionsExtracted: result.transactionsExtracted,
    processingWarnings: result.warnings,
    processingErrors: result.errors,
  };

  await documentRepository.updateDocumentStatus(documentId, finalStatus, metadata);

  return {
    documentId,
    status: finalStatus,
    processingDurationMs,
  };
}

// ─── Worker Factory ──────────────────────────────────────────────────────────

/**
 * Create a BullMQ Worker that listens on the document-processing queue.
 *
 * @param deps - Worker dependencies including the processing service
 * @returns A running BullMQ Worker instance
 */
export function createProcessingWorker(deps: ProcessingWorkerDeps): Worker<DocumentJobData> {
  const { processingService, redisConfig, concurrency = 1 } = deps;
  const connection = getWorkerConnectionOptions(redisConfig);

  const worker = new Worker<DocumentJobData>(
    QUEUE_NAME,
    async (job) => processJob(job, processingService),
    {
      connection,
      concurrency,
    },
  );

  return worker;
}
