import { describe, expect, it } from 'vitest';

import { BusinessSector, Currency, type Business, type BusinessErrorCode } from '../types/index.js';
import { BusinessError } from '../services/businessService.js';

import {
  formatBusinessPublic,
  formatBusinessResponse,
  formatErrorResponse,
  formatGenericResponse,
  getHttpStatusForError,
} from './responses.js';

/** Helper to create a Business entity for testing */
function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 'biz-001',
    userId: 'user-001',
    name: 'Test Business',
    sector: BusinessSector.RETAIL_TRADING,
    currency: Currency.NGN,
    createdAt: new Date('2024-01-15T10:30:00.000Z'),
    updatedAt: new Date('2024-02-20T14:45:00.000Z'),
    deletedAt: null,
    hardDeleteAt: null,
    ...overrides,
  };
}

describe('formatBusinessPublic', () => {
  it('converts dates to ISO 8601 strings', () => {
    const business = makeBusiness();
    const result = formatBusinessPublic(business);

    expect(result.createdAt).toBe('2024-01-15T10:30:00.000Z');
    expect(result.updatedAt).toBe('2024-02-20T14:45:00.000Z');
  });

  it('maps sector to display name', () => {
    const business = makeBusiness({ sector: BusinessSector.TECHNOLOGY_DIGITAL });
    const result = formatBusinessPublic(business);

    expect(result.sectorDisplay).toBe('Technology & Digital Services');
  });

  it('includes id, name, sector, currency', () => {
    const business = makeBusiness();
    const result = formatBusinessPublic(business);

    expect(result.id).toBe('biz-001');
    expect(result.name).toBe('Test Business');
    expect(result.sector).toBe(BusinessSector.RETAIL_TRADING);
    expect(result.currency).toBe(Currency.NGN);
  });

  it('excludes internal fields like userId, deletedAt, hardDeleteAt', () => {
    const business = makeBusiness({ deletedAt: new Date(), hardDeleteAt: new Date() });
    const result = formatBusinessPublic(business);

    expect(result).not.toHaveProperty('userId');
    expect(result).not.toHaveProperty('deletedAt');
    expect(result).not.toHaveProperty('hardDeleteAt');
  });

  it('maps OTHER sector display name', () => {
    const business = makeBusiness({ sector: BusinessSector.OTHER });
    const result = formatBusinessPublic(business);

    expect(result.sectorDisplay).toBe('Other');
  });
});

describe('formatBusinessResponse', () => {
  it('wraps business in success response with requestId', () => {
    const business = makeBusiness();
    const result = formatBusinessResponse(business, 'req-123');

    expect(result.success).toBe(true);
    expect(result.requestId).toBe('req-123');
    expect(result.business.id).toBe('biz-001');
    expect(result.business.name).toBe('Test Business');
  });

  it('formats the nested business as BusinessPublic', () => {
    const business = makeBusiness({ sector: BusinessSector.MANUFACTURING });
    const result = formatBusinessResponse(business, 'req-456');

    expect(result.business.sectorDisplay).toBe('Manufacturing');
    expect(typeof result.business.createdAt).toBe('string');
    expect(typeof result.business.updatedAt).toBe('string');
  });
});

describe('formatErrorResponse', () => {
  it('includes code and message', () => {
    const error = new BusinessError('BUSINESS_NOT_FOUND', 'No business found');
    const result = formatErrorResponse(error, 'req-789');

    expect(result.success).toBe(false);
    expect(result.error.code).toBe('BUSINESS_NOT_FOUND');
    expect(result.error.message).toBe('No business found');
    expect(result.requestId).toBe('req-789');
  });

  it('includes field-specific errors when present', () => {
    const fields = { name: ['Name is too short'] };
    const error = new BusinessError('BUSINESS_INVALID_NAME', 'Validation failed', fields);
    const result = formatErrorResponse(error, 'req-abc');

    expect(result.error.fields).toEqual({ name: ['Name is too short'] });
  });

  it('omits fields when not present on error', () => {
    const error = new BusinessError('INTERNAL_ERROR', 'Something went wrong');
    const result = formatErrorResponse(error, 'req-def');

    expect(result.error.fields).toBeUndefined();
  });
});

describe('formatGenericResponse', () => {
  it('wraps message in success response with requestId', () => {
    const result = formatGenericResponse('Business deleted successfully', 'req-ghi');

    expect(result.success).toBe(true);
    expect(result.message).toBe('Business deleted successfully');
    expect(result.requestId).toBe('req-ghi');
  });
});

describe('getHttpStatusForError', () => {
  const cases: [BusinessErrorCode, number][] = [
    ['BUSINESS_ALREADY_EXISTS', 400],
    ['BUSINESS_NOT_FOUND', 404],
    ['BUSINESS_DELETED', 404],
    ['BUSINESS_FORBIDDEN', 403],
    ['BUSINESS_INVALID_NAME', 400],
    ['BUSINESS_INVALID_SECTOR', 400],
    ['BUSINESS_RECOVERY_EXPIRED', 400],
    ['VALIDATION_ERROR', 400],
    ['INTERNAL_ERROR', 500],
  ];

  it.each(cases)('returns %i for %s', (code, expectedStatus) => {
    expect(getHttpStatusForError(code)).toBe(expectedStatus);
  });
});
