/**
 * Insight controller — Express router factory for insight API endpoints.
 *
 * Provides endpoints for listing, viewing, and managing insight lifecycle
 * (acknowledge, dismiss, resolve) as well as manual refresh.
 *
 * Uses dependency injection via `createInsightRouter(deps)` to receive
 * the LifecycleManager, InsightRepository store, and InsightGenerator.
 *
 * Validates: Requirements 8.1, 8.2, 8.3, 8.4, 10.5
 *
 * @module insights/controllers/insightController
 */

import crypto from 'node:crypto';

import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';

import type { AnalysisContext, Insight, InsightCategory, InsightStatus } from '../types/index.js';
import type { InsightStore } from '../repositories/insightRepository.js';
import {
  getInsightById,
  getInsightsByBusiness,
  getInsightsByCategory,
  getInsightsByStatus,
} from '../repositories/insightRepository.js';
import { InsightLifecycleError, LifecycleManager } from '../services/lifecycleManager.js';
import { InsightGenerator } from '../services/insightGenerator.js';

// ─── Error Codes ─────────────────────────────────────────────────────────────

export const INSIGHT_ERROR_CODES = {
  BUSINESS_NOT_FOUND: 'INSIGHT_BUSINESS_NOT_FOUND',
  INSUFFICIENT_DATA: 'INSIGHT_INSUFFICIENT_DATA',
  ALREADY_RESOLVED: 'INSIGHT_ALREADY_RESOLVED',
  INVALID_TRANSITION: 'INSIGHT_INVALID_TRANSITION',
  GENERATION_FAILED: 'INSIGHT_GENERATION_FAILED',
  NOT_FOUND: 'INSIGHT_NOT_FOUND',
} as const;

const ERROR_STATUS_MAP: Record<string, number> = {
  [INSIGHT_ERROR_CODES.BUSINESS_NOT_FOUND]: 404,
  [INSIGHT_ERROR_CODES.NOT_FOUND]: 404,
  [INSIGHT_ERROR_CODES.INSUFFICIENT_DATA]: 400,
  [INSIGHT_ERROR_CODES.ALREADY_RESOLVED]: 400,
  [INSIGHT_ERROR_CODES.INVALID_TRANSITION]: 400,
  [INSIGHT_ERROR_CODES.GENERATION_FAILED]: 500,
};

// ─── Types ───────────────────────────────────────────────────────────────────

/** Extended Express Request with authenticated user context. */
export interface AuthenticatedRequest extends Request {
  user?: { userId: string };
  businessId?: string;
}

/** Standard success response shape. */
export interface SuccessResponse<T = unknown> {
  success: true;
  data: T;
  requestId: string;
}

/** Standard error response shape. */
export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  requestId: string;
}

/** Dependencies injected into the insight router factory. */
export interface InsightRouterDeps {
  store: InsightStore;
  lifecycleManager: LifecycleManager;
  generator: InsightGenerator;
  /** Build an AnalysisContext for a given business. Returns null if business not found. */
  buildAnalysisContext: (businessId: string) => Promise<AnalysisContext | null>;
}

// ─── Error Helper ────────────────────────────────────────────────────────────

export class InsightControllerError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'InsightControllerError';
    this.code = code;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getRequestId(res: Response): string {
  return (res.getHeader('x-request-id') as string | undefined) ?? crypto.randomUUID();
}

function getAuthenticatedUserId(req: AuthenticatedRequest): string {
  const userId = req.user?.userId;
  if (!userId) {
    throw new InsightControllerError(
      INSIGHT_ERROR_CODES.BUSINESS_NOT_FOUND,
      'Authentication required',
    );
  }
  return userId;
}

function getBusinessId(req: AuthenticatedRequest): string {
  const businessId = req.businessId;
  if (!businessId) {
    throw new InsightControllerError(
      INSIGHT_ERROR_CODES.BUSINESS_NOT_FOUND,
      'Business context required',
    );
  }
  return businessId;
}

const VALID_CATEGORIES = new Set<InsightCategory>([
  'tax',
  'compliance',
  'cashflow',
  'spending',
  'revenue',
  'operational',
]);

const VALID_STATUSES = new Set<InsightStatus>([
  'active',
  'acknowledged',
  'dismissed',
  'resolved',
  'expired',
]);

/** Convert an Insight to a public-facing shape (dates as ISO strings). */
export function toInsightPublic(insight: Insight): Record<string, unknown> {
  return {
    id: insight.id,
    businessId: insight.businessId,
    category: insight.category,
    type: insight.type,
    priority: insight.priority,
    status: insight.status,
    title: insight.title,
    body: insight.body,
    actionItems: insight.actionItems,
    data: insight.data,
    score: insight.score,
    financialImpactKobo: insight.financialImpactKobo,
    createdAt: insight.createdAt.toISOString(),
    acknowledgedAt: insight.acknowledgedAt?.toISOString() ?? null,
    acknowledgedBy: insight.acknowledgedBy,
    dismissedAt: insight.dismissedAt?.toISOString() ?? null,
    dismissedBy: insight.dismissedBy,
    dismissReason: insight.dismissReason,
    resolvedAt: insight.resolvedAt?.toISOString() ?? null,
    resolvedBy: insight.resolvedBy,
    resolutionNotes: insight.resolutionNotes,
    expiresAt: insight.expiresAt.toISOString(),
  };
}

// ─── Error Handler Middleware ─────────────────────────────────────────────────

/**
 * Express error handler for insight routes.
 *
 * Maps InsightControllerError and InsightLifecycleError codes to HTTP statuses.
 */
export function insightErrorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = getRequestId(res);

  if (err instanceof InsightControllerError || err instanceof InsightLifecycleError) {
    const status = ERROR_STATUS_MAP[err.code] ?? 500;
    const body: ErrorResponse = {
      success: false,
      error: {
        code: err.code,
        message: err.message,
      },
      requestId,
    };
    res.status(status).json(body);
    return;
  }

  // Unexpected error — generic 500
  const body: ErrorResponse = {
    success: false,
    error: {
      code: INSIGHT_ERROR_CODES.GENERATION_FAILED,
      message: 'An unexpected error occurred',
    },
    requestId,
  };
  res.status(500).json(body);
}

// ─── Router Factory ──────────────────────────────────────────────────────────

/**
 * Create an Express router with all insight API endpoints.
 *
 * @param deps - Injected dependencies (store, lifecycleManager, generator, buildAnalysisContext).
 * @returns An Express Router to be mounted at `/api/insights`.
 */
export function createInsightRouter(deps: InsightRouterDeps): Router {
  const { store, lifecycleManager, generator, buildAnalysisContext } = deps;
  const router = Router();

  // Attach requestId to every response
  router.use((_req: Request, res: Response, next: NextFunction) => {
    const requestId = crypto.randomUUID();
    res.setHeader('x-request-id', requestId);
    next();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET / — list insights for a business
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/insights
   *
   * Returns insights for the authenticated user's business.
   * Supports optional `status` and `category` query filters.
   *
   * Validates: All requirements (listing)
   */
  router.get('/', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = getRequestId(res);
      const businessId = getBusinessId(req as AuthenticatedRequest);

      const statusFilter = req.query['status'] as string | undefined;
      const categoryFilter = req.query['category'] as string | undefined;

      let insights: Insight[];

      if (statusFilter && VALID_STATUSES.has(statusFilter as InsightStatus)) {
        insights = getInsightsByStatus(store, businessId, statusFilter as InsightStatus);
      } else if (categoryFilter && VALID_CATEGORIES.has(categoryFilter as InsightCategory)) {
        insights = getInsightsByCategory(store, businessId, categoryFilter as InsightCategory);
      } else {
        insights = getInsightsByBusiness(store, businessId);
      }

      // Sort by priority rank then score descending
      const priorityRank: Record<string, number> = {
        critical: 0,
        high: 1,
        medium: 2,
        low: 3,
        info: 4,
      };
      insights.sort((a, b) => {
        const pDiff = (priorityRank[a.priority] ?? 5) - (priorityRank[b.priority] ?? 5);
        if (pDiff !== 0) return pDiff;
        return b.score - a.score;
      });

      const body: SuccessResponse = {
        success: true,
        data: {
          insights: insights.map(toInsightPublic),
          total: insights.length,
        },
        requestId,
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /refresh — manual insight refresh
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/insights/refresh
   *
   * Triggers a manual insight refresh for the authenticated user's business.
   *
   * Validates: Requirement 10.5
   */
  router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = getRequestId(res);
      const businessId = getBusinessId(req as AuthenticatedRequest);

      const context = await buildAnalysisContext(businessId);
      if (!context) {
        throw new InsightControllerError(
          INSIGHT_ERROR_CODES.BUSINESS_NOT_FOUND,
          `Business ${businessId} not found`,
        );
      }

      const scored = await generator.generateForBusiness(context);

      // Persist generated insights via the lifecycle manager
      const created: Insight[] = [];
      for (const s of scored) {
        const insight = await lifecycleManager.create(s);
        created.push(insight);
      }

      const body: SuccessResponse = {
        success: true,
        data: {
          insights: created.map(toInsightPublic),
          generated: created.length,
        },
        requestId,
      };
      res.status(200).json(body);
    } catch (err) {
      if (err instanceof InsightControllerError || err instanceof InsightLifecycleError) {
        next(err);
        return;
      }
      next(
        new InsightControllerError(
          INSIGHT_ERROR_CODES.GENERATION_FAILED,
          'Failed to refresh insights',
        ),
      );
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // GET /:id — get a single insight
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * GET /api/insights/:id
   *
   * Returns a single insight by ID. Verifies it belongs to the user's business.
   */
  router.get('/:id', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = getRequestId(res);
      const businessId = getBusinessId(req as AuthenticatedRequest);
      const insightId = req.params['id'];

      if (!insightId) {
        throw new InsightControllerError(INSIGHT_ERROR_CODES.NOT_FOUND, 'Insight ID is required');
      }

      const insight = getInsightById(store, insightId);
      if (!insight || insight.businessId !== businessId) {
        throw new InsightControllerError(
          INSIGHT_ERROR_CODES.NOT_FOUND,
          `Insight ${insightId} not found`,
        );
      }

      const body: SuccessResponse = {
        success: true,
        data: toInsightPublic(insight),
        requestId,
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/acknowledge
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/insights/:id/acknowledge
   *
   * Acknowledges an active insight.
   *
   * Validates: Requirement 8.1
   */
  router.post('/:id/acknowledge', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = getRequestId(res);
      const authReq = req as AuthenticatedRequest;
      const userId = getAuthenticatedUserId(authReq);
      const businessId = getBusinessId(authReq);
      const insightId = req.params['id'];

      if (!insightId) {
        throw new InsightControllerError(INSIGHT_ERROR_CODES.NOT_FOUND, 'Insight ID is required');
      }

      // Verify insight belongs to business
      const insight = getInsightById(store, insightId);
      if (!insight || insight.businessId !== businessId) {
        throw new InsightControllerError(
          INSIGHT_ERROR_CODES.NOT_FOUND,
          `Insight ${insightId} not found`,
        );
      }

      await lifecycleManager.acknowledge(insightId, userId);

      // Re-fetch after mutation
      const updated = lifecycleManager.get(insightId);
      const body: SuccessResponse = {
        success: true,
        data: updated ? toInsightPublic(updated) : null,
        requestId,
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/dismiss
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/insights/:id/dismiss
   *
   * Dismisses an active insight with a reason.
   *
   * Validates: Requirement 8.2
   */
  router.post('/:id/dismiss', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = getRequestId(res);
      const authReq = req as AuthenticatedRequest;
      const userId = getAuthenticatedUserId(authReq);
      const businessId = getBusinessId(authReq);
      const insightId = req.params['id'];

      if (!insightId) {
        throw new InsightControllerError(INSIGHT_ERROR_CODES.NOT_FOUND, 'Insight ID is required');
      }

      const reason = (req.body as { reason?: string }).reason ?? '';

      // Verify insight belongs to business
      const insight = getInsightById(store, insightId);
      if (!insight || insight.businessId !== businessId) {
        throw new InsightControllerError(
          INSIGHT_ERROR_CODES.NOT_FOUND,
          `Insight ${insightId} not found`,
        );
      }

      await lifecycleManager.dismiss(insightId, userId, reason);

      const updated = lifecycleManager.get(insightId);
      const body: SuccessResponse = {
        success: true,
        data: updated ? toInsightPublic(updated) : null,
        requestId,
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─────────────────────────────────────────────────────────────────────────
  // POST /:id/resolve
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * POST /api/insights/:id/resolve
   *
   * Resolves an acknowledged insight with resolution notes.
   *
   * Validates: Requirement 8.3
   */
  router.post('/:id/resolve', async (req: Request, res: Response, next: NextFunction) => {
    try {
      const requestId = getRequestId(res);
      const authReq = req as AuthenticatedRequest;
      const userId = getAuthenticatedUserId(authReq);
      const businessId = getBusinessId(authReq);
      const insightId = req.params['id'];

      if (!insightId) {
        throw new InsightControllerError(INSIGHT_ERROR_CODES.NOT_FOUND, 'Insight ID is required');
      }

      const notes = (req.body as { notes?: string }).notes ?? '';

      // Verify insight belongs to business
      const insight = getInsightById(store, insightId);
      if (!insight || insight.businessId !== businessId) {
        throw new InsightControllerError(
          INSIGHT_ERROR_CODES.NOT_FOUND,
          `Insight ${insightId} not found`,
        );
      }

      await lifecycleManager.resolve(insightId, userId, notes);

      const updated = lifecycleManager.get(insightId);
      const body: SuccessResponse = {
        success: true,
        data: updated ? toInsightPublic(updated) : null,
        requestId,
      };
      res.status(200).json(body);
    } catch (err) {
      next(err);
    }
  });

  // ─── Error handler (must be last) ────────────────────────────────────────
  router.use(insightErrorHandler);

  return router;
}
