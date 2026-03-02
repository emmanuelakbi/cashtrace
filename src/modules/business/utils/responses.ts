/**
 * Response formatters for the business management module.
 * Provides consistent API response structures for success and error cases.
 *
 * @module business/utils/responses
 */

import {
  type Business,
  type BusinessErrorCode,
  type BusinessPublic,
  type BusinessResponse,
  type ErrorResponse,
  type GenericResponse,
  SECTOR_DISPLAY_NAMES,
} from '../types/index.js';

import { BusinessError } from '../services/businessService.js';

/** HTTP status code mapping for business error codes */
const ERROR_HTTP_STATUS: Record<BusinessErrorCode, number> = {
  BUSINESS_ALREADY_EXISTS: 400,
  BUSINESS_NOT_FOUND: 404,
  BUSINESS_DELETED: 404,
  BUSINESS_FORBIDDEN: 403,
  BUSINESS_INVALID_NAME: 400,
  BUSINESS_INVALID_SECTOR: 400,
  BUSINESS_RECOVERY_EXPIRED: 400,
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
};

/**
 * Converts a Business entity to a public-facing representation.
 * Maps sector to display name and converts dates to ISO 8601 strings.
 */
export function formatBusinessPublic(business: Business): BusinessPublic {
  return {
    id: business.id,
    name: business.name,
    sector: business.sector,
    sectorDisplay: SECTOR_DISPLAY_NAMES[business.sector],
    currency: business.currency,
    createdAt: business.createdAt.toISOString(),
    updatedAt: business.updatedAt.toISOString(),
  };
}

/**
 * Wraps a Business entity in a success response with requestId.
 */
export function formatBusinessResponse(business: Business, requestId: string): BusinessResponse {
  return {
    success: true,
    business: formatBusinessPublic(business),
    requestId,
  };
}

/**
 * Wraps a BusinessError in a structured error response with requestId.
 */
export function formatErrorResponse(error: BusinessError, requestId: string): ErrorResponse {
  const response: ErrorResponse = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
    requestId,
  };

  if (error.fields) {
    response.error.fields = error.fields;
  }

  return response;
}

/**
 * Wraps a message in a generic success response with requestId.
 */
export function formatGenericResponse(message: string, requestId: string): GenericResponse {
  return {
    success: true,
    message,
    requestId,
  };
}

/**
 * Maps a business error code to the appropriate HTTP status code.
 */
export function getHttpStatusForError(code: BusinessErrorCode): number {
  return ERROR_HTTP_STATUS[code];
}
