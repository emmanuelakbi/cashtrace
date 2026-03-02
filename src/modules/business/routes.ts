/**
 * Business module route definitions.
 *
 * Creates an Express Router with all business endpoints wired up,
 * including correlation ID and authentication middleware applied
 * to every route.
 *
 * @module modules/business/routes
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';

import {
  createBusiness,
  deleteBusiness,
  exportBusinessData,
  getBusiness,
  restoreBusiness,
  updateBusiness,
} from './controllers/index.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Express request extended with authenticated user context from auth middleware */
interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

// ─── Middleware ───────────────────────────────────────────────────────────────

/**
 * Ensures every request has a correlation ID for tracing.
 *
 * Checks for an existing `x-request-id` header; if absent, generates
 * a new UUID v4 and sets it on the request headers.
 */
function correlationId(req: Request, _res: Response, next: NextFunction): void {
  if (!req.headers['x-request-id']) {
    req.headers['x-request-id'] = uuidv4();
  }
  next();
}

/**
 * Authentication guard middleware.
 *
 * Verifies that the upstream auth middleware has populated `req.user`.
 * Returns 401 if the user is not authenticated.
 */
function requireAuth(req: AuthenticatedRequest, res: Response, next: NextFunction): void {
  if (!req.user?.id) {
    const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();
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
  next();
}

// ─── Router ──────────────────────────────────────────────────────────────────

const router = Router();

// Apply middleware to all business routes
router.use(correlationId);
router.use(requireAuth);

// Business profile CRUD
router.post('/', createBusiness);
router.get('/', getBusiness);
router.put('/:id', updateBusiness);
router.delete('/:id', deleteBusiness);

// NDPR compliance
router.post('/export', exportBusinessData);

// Recovery
router.post('/:id/restore', restoreBusiness);

export { router as businessRouter };
