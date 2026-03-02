/**
 * Document status state machine.
 *
 * Defines valid status transitions for document processing lifecycle:
 *   UPLOADED → PROCESSING
 *   PROCESSING → PARSED | PARTIAL | ERROR
 *   ERROR → PROCESSING (retry)
 *
 * No other transitions are allowed. Initial status is always UPLOADED.
 *
 * @module document-processing/statusMachine
 */

import { DocumentError } from './documentService.js';
import type { DocumentStatus } from './types.js';
import { DOC_ERROR_CODES } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** The initial status for all newly uploaded documents. */
export const INITIAL_STATUS: DocumentStatus = 'UPLOADED';

/** Map of each status to its valid target statuses. */
export const VALID_TRANSITIONS: Record<DocumentStatus, DocumentStatus[]> = {
  UPLOADED: ['PROCESSING'],
  PROCESSING: ['PARSED', 'PARTIAL', 'ERROR'],
  PARSED: [],
  PARTIAL: [],
  ERROR: ['PROCESSING'],
};

// ─── Functions ───────────────────────────────────────────────────────────────

/**
 * Check whether a status transition is valid.
 *
 * @param from - The current document status
 * @param to - The desired target status
 * @returns true if the transition is allowed, false otherwise
 */
export function isValidTransition(from: DocumentStatus, to: DocumentStatus): boolean {
  const allowed = VALID_TRANSITIONS[from];
  return allowed !== undefined && allowed.includes(to);
}

/**
 * Get all valid target statuses for a given status.
 *
 * @param from - The current document status
 * @returns Array of statuses that can be transitioned to
 */
export function getValidTransitions(from: DocumentStatus): DocumentStatus[] {
  return VALID_TRANSITIONS[from] ?? [];
}

/**
 * Validate a status transition, throwing if invalid.
 *
 * @param from - The current document status
 * @param to - The desired target status
 * @throws DocumentError with DOC_INVALID_TRANSITION if the transition is not allowed
 */
export function validateTransition(from: DocumentStatus, to: DocumentStatus): void {
  if (!isValidTransition(from, to)) {
    const allowed = getValidTransitions(from);
    const allowedStr = allowed.length > 0 ? allowed.join(', ') : 'none';
    throw new DocumentError(
      DOC_ERROR_CODES.INVALID_TRANSITION,
      `Invalid status transition from ${from} to ${to}. Allowed transitions from ${from}: ${allowedStr}`,
    );
  }
}
