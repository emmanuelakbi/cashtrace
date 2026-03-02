/**
 * Transaction controller providing Express Router for transaction operations.
 *
 * Handles listing transactions with filtering, pagination, and formatted
 * Naira amounts. Returns structured JSON responses with requestId for correlation.
 *
 * Requirements: 5.1-5.8, 12.1, 12.5
 * @module transaction-engine/transactionController
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

import { query } from '../utils/db.js';

import { getAuditHistory, logDuplicateResolve } from './auditService.js';
import {
  getUnresolvedDuplicates,
  markAsReviewed,
  resolveDuplicate,
} from './duplicateDetectionService.js';
import { getHttpStatusForError } from './errorMiddleware.js';
import { formatAsNaira } from './normalizationService.js';
import { search } from './searchService.js';
import type { SearchFilters } from './searchService.js';
import { findById } from './transactionRepository.js';
import {
  bulkCreate,
  deleteTransaction,
  getTransactionById,
  listTransactions,
  updateTransaction,
} from './transactionService.js';
import type {
  BulkCreateResponse,
  DuplicateListResponse,
  DuplicatePairPublic,
  GenericResponse,
  RawExtractedTransaction,
  SourceType,
  Transaction,
  TransactionAudit,
  TransactionCategory,
  TransactionFilters,
  TransactionListResponse,
  TransactionPublic,
  TransactionResponse,
  TransactionType,
  TransactionUpdates,
} from './types.js';
import { EXPENSE_CATEGORIES, REVENUE_CATEGORIES } from './types.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Express request extended with authenticated user context. */
export interface AuthenticatedRequest extends Request {
  userId?: string;
  businessId?: string;
}

// ─── Display Helpers ─────────────────────────────────────────────────────────

const SOURCE_TYPE_DISPLAY: Record<SourceType, string> = {
  RECEIPT: 'Receipt',
  BANK_STATEMENT: 'Bank Statement',
  POS_EXPORT: 'POS Export',
  MANUAL: 'Manual',
};

const TRANSACTION_TYPE_DISPLAY: Record<TransactionType, string> = {
  INFLOW: 'Inflow',
  OUTFLOW: 'Outflow',
};

/** Look up the display name for a transaction category. */
export function getCategoryDisplayName(category: TransactionCategory): string {
  const expenseInfo = EXPENSE_CATEGORIES[category as keyof typeof EXPENSE_CATEGORIES];
  if (expenseInfo) {
    return expenseInfo.name;
  }
  const revenueInfo = REVENUE_CATEGORIES[category as keyof typeof REVENUE_CATEGORIES];
  if (revenueInfo) {
    return revenueInfo.name;
  }
  return category;
}

/** Convert an internal Transaction to a public-facing TransactionPublic shape. */
export function toTransactionPublic(txn: Transaction): TransactionPublic {
  return {
    id: txn.id,
    sourceType: txn.sourceType,
    sourceTypeDisplay: SOURCE_TYPE_DISPLAY[txn.sourceType],
    sourceDocumentId: txn.sourceDocumentId,
    transactionType: txn.transactionType,
    transactionTypeDisplay: TRANSACTION_TYPE_DISPLAY[txn.transactionType],
    transactionDate: txn.transactionDate.toISOString(),
    description: txn.description,
    amountKobo: txn.amountKobo,
    amountNaira: formatAsNaira(txn.amountKobo),
    counterparty: txn.counterparty,
    reference: txn.reference,
    category: txn.category,
    categoryDisplay: getCategoryDisplayName(txn.category),
    originalCategory: txn.originalCategory,
    categorySource: txn.categorySource,
    categoryConfidence: txn.categoryConfidence,
    isPersonal: txn.isPersonal,
    isDuplicate: txn.isDuplicate,
    notes: txn.notes,
    createdAt: txn.createdAt.toISOString(),
    updatedAt: txn.updatedAt.toISOString(),
  };
}

// ─── Router Factory ──────────────────────────────────────────────────────────

/**
 * Create an Express Router for transaction operations.
 *
 * @returns Configured Express Router
 */
export function createTransactionRouter(): Router {
  const router = Router();

  // GET / — list transactions with filters and pagination
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const authReq = req as AuthenticatedRequest;
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      const businessId = authReq.businessId;

      if (!businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      // Parse pagination
      const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
      const rawPageSize = parseInt(req.query['pageSize'] as string, 10) || 20;
      const pageSize = Math.min(Math.max(1, rawPageSize), 100);

      // Parse date filters
      const startDateStr = req.query['startDate'] as string | undefined;
      const endDateStr = req.query['endDate'] as string | undefined;
      const startDate = startDateStr ? new Date(startDateStr) : undefined;
      const endDate = endDateStr ? new Date(endDateStr) : undefined;

      // Parse amount filters (kobo)
      const minAmountStr = req.query['minAmount'] as string | undefined;
      const maxAmountStr = req.query['maxAmount'] as string | undefined;
      const minAmount = minAmountStr ? Number(minAmountStr) : undefined;
      const maxAmount = maxAmountStr ? Number(maxAmountStr) : undefined;

      // Parse enum filters
      const category = req.query['category'] as TransactionCategory | undefined;
      const sourceType = req.query['sourceType'] as SourceType | undefined;
      const transactionType = req.query['transactionType'] as TransactionType | undefined;

      // Parse boolean filter
      const isPersonalStr = req.query['isPersonal'] as string | undefined;
      const isPersonal =
        isPersonalStr === 'true' ? true : isPersonalStr === 'false' ? false : undefined;

      // Parse sort options
      const sortByParam = req.query['sortBy'] as string | undefined;
      const validSortBy = ['transactionDate', 'amount', 'createdAt'] as const;
      const sortBy = validSortBy.includes(sortByParam as (typeof validSortBy)[number])
        ? (sortByParam as TransactionFilters['sortBy'])
        : 'transactionDate';

      const sortOrderParam = req.query['sortOrder'] as string | undefined;
      const sortOrder: 'asc' | 'desc' = sortOrderParam === 'asc' ? 'asc' : 'desc';

      const filters: TransactionFilters = {
        startDate,
        endDate,
        minAmount,
        maxAmount,
        category,
        sourceType,
        transactionType,
        isPersonal,
        page,
        pageSize,
        sortBy,
        sortOrder,
      };

      const result = await listTransactions(businessId, filters);

      const transactions: TransactionPublic[] = result.transactions.map(toTransactionPublic);

      const body: TransactionListResponse = {
        success: true,
        transactions,
        pagination: result.pagination,
        requestId,
      };

      res.status(200).json(body);
    } catch (err) {
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      if (err instanceof Error && 'code' in err) {
        const code = (err as Error & { code: string }).code;
        const httpStatus = getHttpStatusForError(code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // POST /bulk — bulk create transactions from document processing
  router.post('/bulk', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    try {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.userId;
      const businessId = authReq.businessId;

      if (!userId || !businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const body = req.body as Record<string, unknown>;
      const sourceDocumentId = body['sourceDocumentId'] as string | undefined;
      const sourceType = body['sourceType'] as SourceType | undefined;
      const transactions = body['transactions'] as RawExtractedTransaction[] | undefined;

      if (
        !sourceDocumentId ||
        !sourceType ||
        !transactions ||
        !Array.isArray(transactions) ||
        transactions.length === 0
      ) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message:
              'sourceDocumentId, sourceType, and a non-empty transactions array are required',
          },
          requestId,
        });
        return;
      }

      const ipAddress = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const userAgent = req.get('user-agent');

      const result = await bulkCreate(
        transactions,
        businessId,
        sourceType,
        sourceDocumentId,
        userId,
        ipAddress,
        userAgent,
      );

      const responseBody: BulkCreateResponse = {
        success: true,
        created: result.created,
        duplicatesDetected: result.duplicatesDetected,
        transactions: result.transactions.map(toTransactionPublic),
        requestId,
      };

      res.status(201).json(responseBody);
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as Error & { code: string }).code;
        const httpStatus = getHttpStatusForError(code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // GET /search — full-text search with filters
  router.get('/search', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    try {
      const authReq = req as AuthenticatedRequest;
      const businessId = authReq.businessId;

      if (!businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const queryParam = req.query['query'] as string | undefined;
      if (!queryParam || queryParam.trim().length === 0) {
        res.status(400).json({
          success: false,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'query parameter is required',
          },
          requestId,
        });
        return;
      }

      // Parse optional filters
      const startDateStr = req.query['startDate'] as string | undefined;
      const endDateStr = req.query['endDate'] as string | undefined;
      const startDate = startDateStr ? new Date(startDateStr) : undefined;
      const endDate = endDateStr ? new Date(endDateStr) : undefined;
      const category = req.query['category'] as TransactionCategory | undefined;
      const transactionType = req.query['transactionType'] as TransactionType | undefined;

      const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
      const rawPageSize = parseInt(req.query['pageSize'] as string, 10) || 20;
      const pageSize = Math.min(Math.max(1, rawPageSize), 100);

      const filters: SearchFilters = {
        startDate,
        endDate,
        category,
        transactionType,
        page,
        pageSize,
      };

      const result = await search(queryParam, businessId, filters);

      const transactions: TransactionPublic[] = result.transactions.map(toTransactionPublic);

      const body: TransactionListResponse = {
        success: true,
        transactions,
        pagination: {
          page: result.page,
          pageSize: result.pageSize,
          total: result.total,
          totalPages: result.totalPages,
          hasNext: result.page < result.totalPages,
          hasPrevious: result.page > 1,
        },
        requestId,
      };

      res.status(200).json(body);
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as Error & { code: string }).code;
        const httpStatus = getHttpStatusForError(code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // GET /duplicates — list unresolved duplicate pairs with pagination
  router.get('/duplicates', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    try {
      const authReq = req as AuthenticatedRequest;
      const businessId = authReq.businessId;

      if (!businessId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      // Parse pagination
      const page = Math.max(1, parseInt(req.query['page'] as string, 10) || 1);
      const rawPageSize = parseInt(req.query['pageSize'] as string, 10) || 20;
      const pageSize = Math.min(Math.max(1, rawPageSize), 100);

      const allPairs = await getUnresolvedDuplicates(businessId);

      // Map each pair to DuplicatePairPublic with full transaction details
      const mappedPairs: DuplicatePairPublic[] = [];
      for (const pair of allPairs) {
        const [txn1, txn2] = await Promise.all([
          findById(pair.transaction1Id),
          findById(pair.transaction2Id),
        ]);

        if (txn1 && txn2) {
          mappedPairs.push({
            id: pair.id,
            transaction1: toTransactionPublic(txn1),
            transaction2: toTransactionPublic(txn2),
            similarityScore: pair.similarityScore,
            amountMatch: pair.amountMatch,
            dateProximity: pair.dateProximity,
            descriptionSimilarity: pair.descriptionSimilarity,
            status: pair.status,
            createdAt: pair.createdAt.toISOString(),
          });
        }
      }

      // Client-side pagination
      const total = mappedPairs.length;
      const totalPages = Math.max(1, Math.ceil(total / pageSize));
      const start = (page - 1) * pageSize;
      const paginatedPairs = mappedPairs.slice(start, start + pageSize);

      const body: DuplicateListResponse = {
        success: true,
        duplicates: paginatedPairs,
        pagination: {
          page,
          pageSize,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrevious: page > 1,
        },
        requestId,
      };

      res.status(200).json(body);
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as Error & { code: string }).code;
        const httpStatus = getHttpStatusForError(code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // POST /duplicates/:id/resolve — resolve a duplicate pair
  router.post(
    '/duplicates/:id/resolve',
    async (req: Request, res: Response, next: NextFunction) => {
      const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
      try {
        const authReq = req as AuthenticatedRequest;
        const userId = authReq.userId;

        if (!userId) {
          res.status(401).json({
            success: false,
            error: {
              code: 'AUTH_REQUIRED',
              message: 'Authentication required',
            },
            requestId,
          });
          return;
        }

        const duplicatePairId = req.params['id'] as string;
        const body = req.body as Record<string, unknown>;
        const action = body['action'] as string | undefined;

        const validActions = ['KEEP_FIRST', 'KEEP_SECOND', 'NOT_DUPLICATE'];
        if (!action || !validActions.includes(action)) {
          res.status(400).json({
            success: false,
            error: {
              code: 'VALIDATION_ERROR',
              message:
                'action is required and must be one of: KEEP_FIRST, KEEP_SECOND, NOT_DUPLICATE',
            },
            requestId,
          });
          return;
        }

        const ipAddress = req.ip ?? req.socket.remoteAddress ?? 'unknown';
        const userAgent = req.get('user-agent');

        if (action === 'NOT_DUPLICATE') {
          await markAsReviewed(duplicatePairId, userId);
          await logDuplicateResolve(
            duplicatePairId,
            userId,
            duplicatePairId,
            action,
            ipAddress,
            userAgent,
          );

          const responseBody: GenericResponse = {
            success: true,
            message: 'Duplicate pair marked as not duplicate',
            requestId,
          };
          res.status(200).json(responseBody);
          return;
        }

        // KEEP_FIRST or KEEP_SECOND — look up the pair to determine which transaction to keep
        interface DuplicatePairRow {
          transaction1_id: string;
          transaction2_id: string;
        }

        const pairResult = await query<DuplicatePairRow>(
          'SELECT transaction1_id, transaction2_id FROM duplicate_pairs WHERE id = $1',
          [duplicatePairId],
        );

        if (pairResult.rows.length === 0) {
          res.status(404).json({
            success: false,
            error: {
              code: 'DUPLICATE_PAIR_NOT_FOUND',
              message: 'Duplicate pair not found',
            },
            requestId,
          });
          return;
        }

        const pair = pairResult.rows[0];
        const keepTransactionId =
          action === 'KEEP_FIRST' ? pair?.transaction1_id : pair?.transaction2_id;

        if (!keepTransactionId) {
          res.status(404).json({
            success: false,
            error: {
              code: 'DUPLICATE_PAIR_NOT_FOUND',
              message: 'Duplicate pair not found',
            },
            requestId,
          });
          return;
        }

        await resolveDuplicate(duplicatePairId, keepTransactionId, userId);
        await logDuplicateResolve(
          keepTransactionId,
          userId,
          duplicatePairId,
          action,
          ipAddress,
          userAgent,
        );

        const responseBody: GenericResponse = {
          success: true,
          message: 'Duplicate resolved successfully',
          requestId,
        };
        res.status(200).json(responseBody);
      } catch (err) {
        if (err instanceof Error && 'code' in err) {
          const code = (err as Error & { code: string }).code;
          const httpStatus = getHttpStatusForError(code);
          res.status(httpStatus).json({
            success: false,
            error: {
              code,
              message: err.message,
            },
            requestId,
          });
          return;
        }
        next(err);
      }
    },
  );

  // GET /:id — get transaction details with audit history
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    try {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const transactionId = req.params['id'] as string;

      const transaction = await getTransactionById(transactionId, userId);

      const auditHistory: TransactionAudit[] = await getAuditHistory(transactionId);

      const body: TransactionResponse & { auditHistory: TransactionAudit[] } = {
        success: true,
        transaction: toTransactionPublic(transaction),
        auditHistory,
        requestId,
      };

      res.status(200).json(body);
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as Error & { code: string }).code;
        const httpStatus = getHttpStatusForError(code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // PUT /:id — update transaction
  router.put('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    try {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const transactionId = req.params['id'] as string;

      // Build updates object — only include fields present in the body
      const body = req.body as Record<string, unknown>;
      const updates: TransactionUpdates = {};

      if (body['description'] !== undefined) {
        updates.description = body['description'] as string;
      }
      if (body['transactionDate'] !== undefined) {
        updates.transactionDate = new Date(body['transactionDate'] as string);
      }
      if (body['category'] !== undefined) {
        updates.category = body['category'] as TransactionCategory;
      }
      if (body['isPersonal'] !== undefined) {
        updates.isPersonal = body['isPersonal'] as boolean;
      }
      if (body['notes'] !== undefined) {
        updates.notes = body['notes'] as string;
      }

      const ipAddress = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const userAgent = req.get('user-agent');

      const updated = await updateTransaction(transactionId, userId, updates, ipAddress, userAgent);

      const responseBody: TransactionResponse = {
        success: true,
        transaction: toTransactionPublic(updated),
        requestId,
      };

      res.status(200).json(responseBody);
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as Error & { code: string }).code;
        const httpStatus = getHttpStatusForError(code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code,
            message: err.message,
          },
          requestId,
        });
        return;
      }
      next(err);
    }
  });

  // DELETE /:id — soft delete transaction
  router.delete('/:id', async (req: Request, res: Response, next: NextFunction) => {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
    try {
      const authReq = req as AuthenticatedRequest;
      const userId = authReq.userId;

      if (!userId) {
        res.status(401).json({
          success: false,
          error: {
            code: 'AUTH_REQUIRED',
            message: 'Authentication required',
          },
          requestId,
        });
        return;
      }

      const transactionId = req.params['id'] as string;
      const ipAddress = req.ip ?? req.socket.remoteAddress ?? 'unknown';
      const userAgent = req.get('user-agent');

      await deleteTransaction(transactionId, userId, ipAddress, userAgent);

      const body: GenericResponse = {
        success: true,
        message: 'Transaction deleted successfully',
        requestId,
      };

      res.status(200).json(body);
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        const code = (err as Error & { code: string }).code;
        const httpStatus = getHttpStatusForError(code);
        res.status(httpStatus).json({
          success: false,
          error: {
            code,
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
