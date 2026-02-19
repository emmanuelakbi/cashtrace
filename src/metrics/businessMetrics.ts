/**
 * Business Metrics
 *
 * Collects business-specific metrics: transactions processed and documents parsed.
 * Integrates with the MetricsCollector to expose Prometheus-compatible metrics.
 *
 * Requirements: 3.4 - THE Observability_Service SHALL collect business metrics
 *   (transactions processed, documents parsed)
 */

import { type MetricsCollector, type Counter, type Labels } from './collector.js';

/** Valid transaction types */
export type TransactionType = 'payment' | 'transfer' | 'withdrawal' | 'deposit' | 'refund';

const VALID_TRANSACTION_TYPES: ReadonlySet<string> = new Set<string>([
  'payment',
  'transfer',
  'withdrawal',
  'deposit',
  'refund',
]);

/** Valid transaction statuses */
export type TransactionStatus = 'success' | 'failure' | 'pending';

const VALID_TRANSACTION_STATUSES: ReadonlySet<string> = new Set<string>([
  'success',
  'failure',
  'pending',
]);

/** Valid document types */
export type DocumentType = 'invoice' | 'receipt' | 'statement' | 'report';

const VALID_DOCUMENT_TYPES: ReadonlySet<string> = new Set<string>([
  'invoice',
  'receipt',
  'statement',
  'report',
]);

/** Valid document parse statuses */
export type DocumentStatus = 'success' | 'failure';

const VALID_DOCUMENT_STATUSES: ReadonlySet<string> = new Set<string>(['success', 'failure']);

export interface TransactionInfo {
  /** The type of transaction */
  type: string;
  /** The status of the transaction */
  status: string;
}

export interface DocumentParseInfo {
  /** The type of document parsed */
  type: string;
  /** The status of the parse operation */
  status: string;
}

export interface BusinessMetrics {
  /** Record a processed transaction */
  recordTransaction(info: TransactionInfo): void;
  /** Record a parsed document */
  recordDocumentParse(info: DocumentParseInfo): void;
  /** Get the underlying transaction counter */
  getTransactionCounter(): Counter;
  /** Get the underlying document parse counter */
  getDocumentParseCounter(): Counter;
}

/**
 * Normalizes a transaction type string to lowercase.
 * Returns the lowercased value if valid, otherwise returns 'other'.
 */
export function normalizeTransactionType(type: string): string {
  const lower = type.toLowerCase();
  return VALID_TRANSACTION_TYPES.has(lower) ? lower : 'other';
}

/**
 * Normalizes a transaction status string to lowercase.
 * Returns the lowercased value if valid, otherwise returns 'unknown'.
 */
export function normalizeTransactionStatus(status: string): string {
  const lower = status.toLowerCase();
  return VALID_TRANSACTION_STATUSES.has(lower) ? lower : 'unknown';
}

/**
 * Normalizes a document type string to lowercase.
 * Returns the lowercased value if valid, otherwise returns 'other'.
 */
export function normalizeDocumentType(type: string): string {
  const lower = type.toLowerCase();
  return VALID_DOCUMENT_TYPES.has(lower) ? lower : 'other';
}

/**
 * Normalizes a document status string to lowercase.
 * Returns the lowercased value if valid, otherwise returns 'unknown'.
 */
export function normalizeDocumentStatus(status: string): string {
  const lower = status.toLowerCase();
  return VALID_DOCUMENT_STATUSES.has(lower) ? lower : 'unknown';
}

/**
 * Creates a BusinessMetrics instance backed by the given MetricsCollector.
 */
export function createBusinessMetrics(collector: MetricsCollector): BusinessMetrics {
  const transactionCounter = collector.counter('business_transactions_total', {
    type: '',
    status: '',
  });

  const documentParseCounter = collector.counter('business_documents_parsed_total', {
    type: '',
    status: '',
  });

  return {
    recordTransaction(info: TransactionInfo): void {
      const normalizedType = normalizeTransactionType(info.type);
      const normalizedStatus = normalizeTransactionStatus(info.status);

      const labels: Labels = {
        type: normalizedType,
        status: normalizedStatus,
      };

      transactionCounter.inc(1, labels);
    },

    recordDocumentParse(info: DocumentParseInfo): void {
      const normalizedType = normalizeDocumentType(info.type);
      const normalizedStatus = normalizeDocumentStatus(info.status);

      const labels: Labels = {
        type: normalizedType,
        status: normalizedStatus,
      };

      documentParseCounter.inc(1, labels);
    },

    getTransactionCounter(): Counter {
      return transactionCounter;
    },

    getDocumentParseCounter(): Counter {
      return documentParseCounter;
    },
  };
}
