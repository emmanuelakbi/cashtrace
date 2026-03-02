/**
 * Business controller for handling business profile HTTP requests.
 *
 * Follows the functional pattern established by core-auth controllers.
 * Each exported function handles a specific endpoint, delegating to
 * the business service for logic and using response formatters for
 * consistent API responses.
 *
 * @module modules/business/controllers/businessController
 */

import { type Request, type Response } from 'express';
import { v4 as uuidv4 } from 'uuid';

import * as businessService from '../services/businessService.js';
import { BusinessError } from '../services/businessService.js';
import * as exportService from '../services/exportService.js';
import { type ExportResponse } from '../types/index.js';
import {
  formatBusinessResponse,
  formatErrorResponse,
  formatGenericResponse,
  getHttpStatusForError,
} from '../utils/responses.js';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Express request extended with authenticated user context from auth middleware */
interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

// ─── Controller Functions ────────────────────────────────────────────────────

/**
 * Handle POST /api/business — create a new business profile.
 *
 * Extracts user context from auth middleware, validates the request body,
 * delegates to the business service, and returns a 201 response with the
 * created business or an appropriate error response.
 *
 * @param req - Express request with authenticated user and business data in body
 * @param res - Express response
 */
export async function createBusiness(req: AuthenticatedRequest, res: Response): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  try {
    const userId = req.user?.id;

    if (!userId) {
      res
        .status(401)
        .json(
          formatErrorResponse(
            new BusinessError('INTERNAL_ERROR', 'Authentication required'),
            requestId,
          ),
        );
      return;
    }

    const name: string = req.body.name ?? '';
    const sector: string | undefined = req.body.sector;

    const context = {
      ipAddress: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'],
      requestId,
    };

    const business = await businessService.createBusiness(userId, { name, sector }, context);

    res.status(201).json(formatBusinessResponse(business, requestId));
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = getHttpStatusForError(error.code);
      res.status(status).json(formatErrorResponse(error, requestId));
      return;
    }

    res
      .status(500)
      .json(
        formatErrorResponse(
          new BusinessError('INTERNAL_ERROR', 'An unexpected error occurred'),
          requestId,
        ),
      );
  }
}

/**
 * Handle GET /api/business — retrieve the current user's business profile.
 *
 * Extracts user context from auth middleware, delegates to the business
 * service, and returns a 200 response with the business profile or a
 * 404 if no business exists for the user.
 *
 * @param req - Express request with authenticated user
 * @param res - Express response
 */
export async function getBusiness(req: AuthenticatedRequest, res: Response): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  try {
    const userId = req.user?.id;

    if (!userId) {
      res
        .status(401)
        .json(
          formatErrorResponse(
            new BusinessError('INTERNAL_ERROR', 'Authentication required'),
            requestId,
          ),
        );
      return;
    }

    const business = await businessService.getBusinessByUserId(userId);

    if (!business) {
      res
        .status(404)
        .json(
          formatErrorResponse(
            new BusinessError('BUSINESS_NOT_FOUND', 'No business found for user'),
            requestId,
          ),
        );
      return;
    }

    res.status(200).json(formatBusinessResponse(business, requestId));
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = getHttpStatusForError(error.code);
      res.status(status).json(formatErrorResponse(error, requestId));
      return;
    }

    res
      .status(500)
      .json(
        formatErrorResponse(
          new BusinessError('INTERNAL_ERROR', 'An unexpected error occurred'),
          requestId,
        ),
      );
  }
}

/**
 * Handle PUT /api/business/:id — update an existing business profile.
 *
 * Extracts user context from auth middleware, validates ownership via the
 * business service, and returns a 200 response with the updated business
 * or an appropriate error response (403 for ownership, 404 for not found,
 * 400 for validation errors).
 *
 * @param req - Express request with authenticated user, business ID in params, and update data in body
 * @param res - Express response
 */
export async function updateBusiness(req: AuthenticatedRequest, res: Response): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  try {
    const userId = req.user?.id;

    if (!userId) {
      res
        .status(401)
        .json(
          formatErrorResponse(
            new BusinessError('INTERNAL_ERROR', 'Authentication required'),
            requestId,
          ),
        );
      return;
    }

    const businessId = req.params.id;
    const name: string | undefined = req.body.name;
    const sector: string | undefined = req.body.sector;

    const context = {
      ipAddress: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'],
      requestId,
    };

    const business = await businessService.updateBusiness(
      businessId,
      userId,
      { name, sector },
      context,
    );

    res.status(200).json(formatBusinessResponse(business, requestId));
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = getHttpStatusForError(error.code);
      res.status(status).json(formatErrorResponse(error, requestId));
      return;
    }

    res
      .status(500)
      .json(
        formatErrorResponse(
          new BusinessError('INTERNAL_ERROR', 'An unexpected error occurred'),
          requestId,
        ),
      );
  }
}

/**
 * Handle DELETE /api/business/:id — soft delete a business profile.
 *
 * Extracts user context from auth middleware, verifies ownership via the
 * business service, performs a soft delete with a 30-day recovery window,
 * and returns a 200 response with a success message or an appropriate
 * error response (403 for ownership, 404 for not found).
 *
 * @param req - Express request with authenticated user and business ID in params
 * @param res - Express response
 */
export async function deleteBusiness(req: AuthenticatedRequest, res: Response): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  try {
    const userId = req.user?.id;

    if (!userId) {
      res
        .status(401)
        .json(
          formatErrorResponse(
            new BusinessError('INTERNAL_ERROR', 'Authentication required'),
            requestId,
          ),
        );
      return;
    }

    const businessId = req.params.id;

    const context = {
      ipAddress: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'],
      requestId,
    };

    await businessService.softDeleteBusiness(businessId, userId, context);

    res.status(200).json(formatGenericResponse('Business deleted successfully', requestId));
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = getHttpStatusForError(error.code);
      res.status(status).json(formatErrorResponse(error, requestId));
      return;
    }

    res
      .status(500)
      .json(
        formatErrorResponse(
          new BusinessError('INTERNAL_ERROR', 'An unexpected error occurred'),
          requestId,
        ),
      );
  }
}

/**
 * Handle POST /api/business/export — generate NDPR-compliant data export.
 *
 * Extracts user context from auth middleware, delegates to the export
 * service to generate a complete business data export including profile,
 * audit trail, and metadata. Handles soft-deleted businesses within the
 * recovery window.
 *
 * @param req - Express request with authenticated user
 * @param res - Express response
 */
export async function exportBusinessData(req: AuthenticatedRequest, res: Response): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  try {
    const userId = req.user?.id;

    if (!userId) {
      res
        .status(401)
        .json(
          formatErrorResponse(
            new BusinessError('INTERNAL_ERROR', 'Authentication required'),
            requestId,
          ),
        );
      return;
    }

    const context = {
      ipAddress: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'],
      requestId,
    };

    const exportData = await exportService.generateExport(userId, context);

    const response: ExportResponse = {
      success: true,
      data: exportData,
      requestId,
    };

    res.status(200).json(response);
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = getHttpStatusForError(error.code);
      res.status(status).json(formatErrorResponse(error, requestId));
      return;
    }

    res
      .status(500)
      .json(
        formatErrorResponse(
          new BusinessError('INTERNAL_ERROR', 'An unexpected error occurred'),
          requestId,
        ),
      );
  }
}

/**
 * Handle POST /api/business/:id/restore — restore a soft-deleted business.
 *
 * Extracts user context from auth middleware, verifies ownership and that
 * the recovery window has not expired via the business service, and returns
 * a 200 response with the restored business or an appropriate error response
 * (400 for expired recovery window, 403 for ownership, 404 for not found).
 *
 * @param req - Express request with authenticated user and business ID in params
 * @param res - Express response
 */
export async function restoreBusiness(req: AuthenticatedRequest, res: Response): Promise<void> {
  const requestId = (req.headers['x-request-id'] as string) ?? uuidv4();

  try {
    const userId = req.user?.id;

    if (!userId) {
      res
        .status(401)
        .json(
          formatErrorResponse(
            new BusinessError('INTERNAL_ERROR', 'Authentication required'),
            requestId,
          ),
        );
      return;
    }

    const businessId = req.params.id;

    const context = {
      ipAddress: req.ip ?? '0.0.0.0',
      userAgent: req.headers['user-agent'],
      requestId,
    };

    const business = await businessService.restoreBusiness(businessId, userId, context);

    res.status(200).json(formatBusinessResponse(business, requestId));
  } catch (error) {
    if (error instanceof BusinessError) {
      const status = getHttpStatusForError(error.code);
      res.status(status).json(formatErrorResponse(error, requestId));
      return;
    }

    res
      .status(500)
      .json(
        formatErrorResponse(
          new BusinessError('INTERNAL_ERROR', 'An unexpected error occurred'),
          requestId,
        ),
      );
  }
}
