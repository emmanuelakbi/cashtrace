import { type Request, type Response } from 'express';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BusinessError } from '../services/businessService.js';
import {
  type Business,
  type BusinessExport,
  BusinessEventType,
  BusinessSector,
  Currency,
} from '../types/index.js';

import {
  createBusiness,
  deleteBusiness,
  exportBusinessData,
  getBusiness,
  restoreBusiness,
  updateBusiness,
} from './businessController.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('../services/businessService.js', () => ({
  createBusiness: vi.fn(),
  getBusinessByUserId: vi.fn(),
  updateBusiness: vi.fn(),
  softDeleteBusiness: vi.fn(),
  restoreBusiness: vi.fn(),
  BusinessError: class BusinessError extends Error {
    readonly code: string;
    readonly fields?: Record<string, string[]>;
    constructor(code: string, message: string, fields?: Record<string, string[]>) {
      super(message);
      this.name = 'BusinessError';
      this.code = code;
      this.fields = fields;
    }
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'generated-request-id'),
}));

vi.mock('../services/exportService.js', () => ({
  generateExport: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const businessServiceMock = vi.mocked(await import('../services/businessService.js'));
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const exportServiceMock = vi.mocked(await import('../services/exportService.js'));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = new Date('2025-01-15T10:00:00.000Z');

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: 'biz-001',
    userId: 'user-001',
    name: 'Ade Stores',
    sector: BusinessSector.RETAIL_TRADING,
    currency: Currency.NGN,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    hardDeleteAt: null,
    ...overrides,
  };
}

interface AuthenticatedRequest extends Request {
  user?: { id: string };
}

function makeRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    user: { id: 'user-001' },
    body: { name: 'Ade Stores' },
    ip: '192.168.1.1',
    headers: {
      'user-agent': 'test-agent',
    },
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

function makeResponse(): Response & {
  _status: number;
  _json: unknown;
} {
  const res = {
    _status: 0,
    _json: null as unknown,
    status(code: number) {
      res._status = code;
      return res;
    },
    json(body: unknown) {
      res._json = body;
      return res;
    },
  };
  return res as unknown as Response & { _status: number; _json: unknown };
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('createBusiness controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 201 with business data on successful creation', async () => {
    const business = makeBusiness();
    businessServiceMock.createBusiness.mockResolvedValue(business);

    const req = makeRequest();
    const res = makeResponse();

    await createBusiness(req, res);

    expect(res._status).toBe(201);
    expect(res._json).toEqual({
      success: true,
      business: {
        id: 'biz-001',
        name: 'Ade Stores',
        sector: BusinessSector.RETAIL_TRADING,
        sectorDisplay: 'Retail & Trading',
        currency: Currency.NGN,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      requestId: 'generated-request-id',
    });
  });

  it('should return 400 with error when name validation fails', async () => {
    businessServiceMock.createBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_INVALID_NAME', 'Name must be between 2 and 100 characters', {
        name: ['Name must be between 2 and 100 characters'],
      }),
    );

    const req = makeRequest({ body: { name: 'A' } });
    const res = makeResponse();

    await createBusiness(req, res);

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_INVALID_NAME',
        message: 'Name must be between 2 and 100 characters',
        fields: { name: ['Name must be between 2 and 100 characters'] },
      },
    });
  });

  it('should return 400 when user already has a business', async () => {
    businessServiceMock.createBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_ALREADY_EXISTS', 'User already has a business profile'),
    );

    const req = makeRequest();
    const res = makeResponse();

    await createBusiness(req, res);

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_ALREADY_EXISTS',
        message: 'User already has a business profile',
      },
    });
  });

  it('should return 500 for unexpected errors', async () => {
    businessServiceMock.createBusiness.mockRejectedValue(new Error('DB connection failed'));

    const req = makeRequest();
    const res = makeResponse();

    await createBusiness(req, res);

    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  it('should pass correct context (ipAddress, userAgent, requestId) to service', async () => {
    const business = makeBusiness();
    businessServiceMock.createBusiness.mockResolvedValue(business);

    const req = makeRequest({
      ip: '10.0.0.5',
      headers: { 'user-agent': 'CashTrace/1.0' },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await createBusiness(req, res);

    expect(businessServiceMock.createBusiness).toHaveBeenCalledWith(
      'user-001',
      { name: 'Ade Stores', sector: undefined },
      {
        ipAddress: '10.0.0.5',
        userAgent: 'CashTrace/1.0',
        requestId: 'generated-request-id',
      },
    );
  });

  it('should use x-request-id header when present', async () => {
    const business = makeBusiness();
    businessServiceMock.createBusiness.mockResolvedValue(business);

    const req = makeRequest({
      headers: {
        'x-request-id': 'custom-req-id-123',
        'user-agent': 'test-agent',
      },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await createBusiness(req, res);

    expect(businessServiceMock.createBusiness).toHaveBeenCalledWith(
      'user-001',
      expect.anything(),
      expect.objectContaining({ requestId: 'custom-req-id-123' }),
    );
    expect(res._json).toMatchObject({ requestId: 'custom-req-id-123' });
  });

  it('should return 401 when user is not authenticated', async () => {
    const req = makeRequest({ user: undefined });
    const res = makeResponse();

    await createBusiness(req, res);

    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication required',
      },
    });
  });
});

// ─── getBusiness Tests ───────────────────────────────────────────────────────

describe('getBusiness controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 200 with business data when business exists', async () => {
    const business = makeBusiness();
    businessServiceMock.getBusinessByUserId.mockResolvedValue(business);

    const req = makeRequest({ body: {} });
    const res = makeResponse();

    await getBusiness(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      success: true,
      business: {
        id: 'biz-001',
        name: 'Ade Stores',
        sector: BusinessSector.RETAIL_TRADING,
        sectorDisplay: 'Retail & Trading',
        currency: Currency.NGN,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      requestId: 'generated-request-id',
    });
    expect(businessServiceMock.getBusinessByUserId).toHaveBeenCalledWith('user-001');
  });

  it('should return 404 when no business exists for user', async () => {
    businessServiceMock.getBusinessByUserId.mockResolvedValue(null);

    const req = makeRequest({ body: {} });
    const res = makeResponse();

    await getBusiness(req, res);

    expect(res._status).toBe(404);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_NOT_FOUND',
        message: 'No business found for user',
      },
    });
  });

  it('should return 401 when user is not authenticated', async () => {
    const req = makeRequest({ user: undefined, body: {} });
    const res = makeResponse();

    await getBusiness(req, res);

    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication required',
      },
    });
    expect(businessServiceMock.getBusinessByUserId).not.toHaveBeenCalled();
  });

  it('should use x-request-id header when present', async () => {
    const business = makeBusiness();
    businessServiceMock.getBusinessByUserId.mockResolvedValue(business);

    const req = makeRequest({
      body: {},
      headers: {
        'x-request-id': 'custom-req-id-456',
        'user-agent': 'test-agent',
      },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await getBusiness(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toMatchObject({ requestId: 'custom-req-id-456' });
  });

  it('should return 500 for unexpected errors', async () => {
    businessServiceMock.getBusinessByUserId.mockRejectedValue(new Error('DB connection failed'));

    const req = makeRequest({ body: {} });
    const res = makeResponse();

    await getBusiness(req, res);

    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });
});

// ─── updateBusiness Tests ────────────────────────────────────────────────────

describe('updateBusiness controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeUpdateRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
    return {
      user: { id: 'user-001' },
      params: { id: 'biz-001' },
      body: { name: 'Updated Stores' },
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'test-agent',
      },
      ...overrides,
    } as unknown as AuthenticatedRequest;
  }

  it('should return 200 with updated business data', async () => {
    const updatedAt = new Date('2025-01-15T12:00:00.000Z');
    const business = makeBusiness({ name: 'Updated Stores', updatedAt });
    businessServiceMock.updateBusiness.mockResolvedValue(business);

    const req = makeUpdateRequest();
    const res = makeResponse();

    await updateBusiness(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      success: true,
      business: {
        id: 'biz-001',
        name: 'Updated Stores',
        sector: BusinessSector.RETAIL_TRADING,
        sectorDisplay: 'Retail & Trading',
        currency: Currency.NGN,
        createdAt: now.toISOString(),
        updatedAt: updatedAt.toISOString(),
      },
      requestId: 'generated-request-id',
    });
    expect(businessServiceMock.updateBusiness).toHaveBeenCalledWith(
      'biz-001',
      'user-001',
      { name: 'Updated Stores', sector: undefined },
      {
        ipAddress: '192.168.1.1',
        userAgent: 'test-agent',
        requestId: 'generated-request-id',
      },
    );
  });

  it('should return 403 when user does not own the business', async () => {
    businessServiceMock.updateBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_FORBIDDEN', 'User does not own this business'),
    );

    const req = makeUpdateRequest();
    const res = makeResponse();

    await updateBusiness(req, res);

    expect(res._status).toBe(403);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_FORBIDDEN',
        message: 'User does not own this business',
      },
    });
  });

  it('should return 404 when business does not exist', async () => {
    businessServiceMock.updateBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_NOT_FOUND', 'Business not found'),
    );

    const req = makeUpdateRequest();
    const res = makeResponse();

    await updateBusiness(req, res);

    expect(res._status).toBe(404);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_NOT_FOUND',
        message: 'Business not found',
      },
    });
  });

  it('should return 400 for invalid name', async () => {
    businessServiceMock.updateBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_INVALID_NAME', 'Name must be between 2 and 100 characters', {
        name: ['Name must be between 2 and 100 characters'],
      }),
    );

    const req = makeUpdateRequest({ body: { name: 'A' } } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await updateBusiness(req, res);

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_INVALID_NAME',
        message: 'Name must be between 2 and 100 characters',
        fields: { name: ['Name must be between 2 and 100 characters'] },
      },
    });
  });

  it('should return 401 when user is not authenticated', async () => {
    const req = makeUpdateRequest({ user: undefined });
    const res = makeResponse();

    await updateBusiness(req, res);

    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication required',
      },
    });
    expect(businessServiceMock.updateBusiness).not.toHaveBeenCalled();
  });

  it('should return 500 for unexpected errors', async () => {
    businessServiceMock.updateBusiness.mockRejectedValue(new Error('DB connection failed'));

    const req = makeUpdateRequest();
    const res = makeResponse();

    await updateBusiness(req, res);

    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  it('should use x-request-id header when present', async () => {
    const business = makeBusiness({ name: 'Updated Stores' });
    businessServiceMock.updateBusiness.mockResolvedValue(business);

    const req = makeUpdateRequest({
      headers: {
        'x-request-id': 'custom-req-id-789',
        'user-agent': 'test-agent',
      },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await updateBusiness(req, res);

    expect(businessServiceMock.updateBusiness).toHaveBeenCalledWith(
      'biz-001',
      'user-001',
      expect.anything(),
      expect.objectContaining({ requestId: 'custom-req-id-789' }),
    );
    expect(res._json).toMatchObject({ requestId: 'custom-req-id-789' });
  });
});

// ─── deleteBusiness Tests ────────────────────────────────────────────────────

describe('deleteBusiness controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeDeleteRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
    return {
      user: { id: 'user-001' },
      params: { id: 'biz-001' },
      body: {},
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'test-agent',
      },
      ...overrides,
    } as unknown as AuthenticatedRequest;
  }

  it('should return 200 with success message on soft delete', async () => {
    businessServiceMock.softDeleteBusiness.mockResolvedValue(undefined);

    const req = makeDeleteRequest();
    const res = makeResponse();

    await deleteBusiness(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      success: true,
      message: 'Business deleted successfully',
      requestId: 'generated-request-id',
    });
    expect(businessServiceMock.softDeleteBusiness).toHaveBeenCalledWith('biz-001', 'user-001', {
      ipAddress: '192.168.1.1',
      userAgent: 'test-agent',
      requestId: 'generated-request-id',
    });
  });

  it('should return 403 when user does not own the business', async () => {
    businessServiceMock.softDeleteBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_FORBIDDEN', 'User does not own this business'),
    );

    const req = makeDeleteRequest();
    const res = makeResponse();

    await deleteBusiness(req, res);

    expect(res._status).toBe(403);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_FORBIDDEN',
        message: 'User does not own this business',
      },
    });
  });

  it('should return 404 when business does not exist', async () => {
    businessServiceMock.softDeleteBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_NOT_FOUND', 'Business not found'),
    );

    const req = makeDeleteRequest();
    const res = makeResponse();

    await deleteBusiness(req, res);

    expect(res._status).toBe(404);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_NOT_FOUND',
        message: 'Business not found',
      },
    });
  });

  it('should return 401 when user is not authenticated', async () => {
    const req = makeDeleteRequest({ user: undefined });
    const res = makeResponse();

    await deleteBusiness(req, res);

    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication required',
      },
    });
    expect(businessServiceMock.softDeleteBusiness).not.toHaveBeenCalled();
  });

  it('should return 500 for unexpected errors', async () => {
    businessServiceMock.softDeleteBusiness.mockRejectedValue(new Error('DB connection failed'));

    const req = makeDeleteRequest();
    const res = makeResponse();

    await deleteBusiness(req, res);

    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  it('should use x-request-id header when present', async () => {
    businessServiceMock.softDeleteBusiness.mockResolvedValue(undefined);

    const req = makeDeleteRequest({
      headers: {
        'x-request-id': 'custom-req-id-delete',
        'user-agent': 'test-agent',
      },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await deleteBusiness(req, res);

    expect(businessServiceMock.softDeleteBusiness).toHaveBeenCalledWith(
      'biz-001',
      'user-001',
      expect.objectContaining({ requestId: 'custom-req-id-delete' }),
    );
    expect(res._json).toMatchObject({ requestId: 'custom-req-id-delete' });
  });
});

// ─── exportBusinessData Tests ────────────────────────────────────────────────

describe('exportBusinessData controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const exportedAt = new Date('2025-01-15T11:00:00.000Z');

  function makeExportData(overrides: Partial<BusinessExport> = {}): BusinessExport {
    return {
      exportedAt,
      business: makeBusiness(),
      auditTrail: [
        {
          id: 'audit-001',
          eventType: BusinessEventType.BUSINESS_CREATED,
          userId: 'user-001',
          businessId: 'biz-001',
          ipAddress: '192.168.1.1',
          userAgent: 'test-agent',
          requestId: 'req-001',
          previousValues: null,
          newValues: { name: 'Ade Stores' },
          createdAt: now,
        },
      ],
      metadata: {
        version: '1.0.0',
        format: 'json',
        includesDeletedData: false,
      },
      ...overrides,
    };
  }

  function makeExportRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
    return {
      user: { id: 'user-001' },
      body: {},
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'test-agent',
      },
      ...overrides,
    } as unknown as AuthenticatedRequest;
  }

  it('should return 200 with export data on success', async () => {
    const exportData = makeExportData();
    exportServiceMock.generateExport.mockResolvedValue(exportData);

    const req = makeExportRequest();
    const res = makeResponse();

    await exportBusinessData(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      success: true,
      data: exportData,
      requestId: 'generated-request-id',
    });
  });

  it('should pass correct context to export service', async () => {
    const exportData = makeExportData();
    exportServiceMock.generateExport.mockResolvedValue(exportData);

    const req = makeExportRequest({
      ip: '10.0.0.5',
      headers: { 'user-agent': 'CashTrace/1.0' },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await exportBusinessData(req, res);

    expect(exportServiceMock.generateExport).toHaveBeenCalledWith('user-001', {
      ipAddress: '10.0.0.5',
      userAgent: 'CashTrace/1.0',
      requestId: 'generated-request-id',
    });
  });

  it('should return 401 when user is not authenticated', async () => {
    const req = makeExportRequest({ user: undefined });
    const res = makeResponse();

    await exportBusinessData(req, res);

    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication required',
      },
    });
    expect(exportServiceMock.generateExport).not.toHaveBeenCalled();
  });

  it('should return 404 when business not found', async () => {
    exportServiceMock.generateExport.mockRejectedValue(
      new BusinessError('BUSINESS_NOT_FOUND', 'Business not found'),
    );

    const req = makeExportRequest();
    const res = makeResponse();

    await exportBusinessData(req, res);

    expect(res._status).toBe(404);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_NOT_FOUND',
        message: 'Business not found',
      },
    });
  });

  it('should return 500 for unexpected errors', async () => {
    exportServiceMock.generateExport.mockRejectedValue(new Error('DB connection failed'));

    const req = makeExportRequest();
    const res = makeResponse();

    await exportBusinessData(req, res);

    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  it('should use x-request-id header when present', async () => {
    const exportData = makeExportData();
    exportServiceMock.generateExport.mockResolvedValue(exportData);

    const req = makeExportRequest({
      headers: {
        'x-request-id': 'custom-req-id-export',
        'user-agent': 'test-agent',
      },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await exportBusinessData(req, res);

    expect(exportServiceMock.generateExport).toHaveBeenCalledWith(
      'user-001',
      expect.objectContaining({ requestId: 'custom-req-id-export' }),
    );
    expect(res._json).toMatchObject({ requestId: 'custom-req-id-export' });
  });
});

// ─── restoreBusiness Tests ───────────────────────────────────────────────────

describe('restoreBusiness controller', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeRestoreRequest(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
    return {
      user: { id: 'user-001' },
      params: { id: 'biz-001' },
      body: {},
      ip: '192.168.1.1',
      headers: {
        'user-agent': 'test-agent',
      },
      ...overrides,
    } as unknown as AuthenticatedRequest;
  }

  it('should return 200 with restored business data on success', async () => {
    const business = makeBusiness();
    businessServiceMock.restoreBusiness.mockResolvedValue(business);

    const req = makeRestoreRequest();
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(res._status).toBe(200);
    expect(res._json).toEqual({
      success: true,
      business: {
        id: 'biz-001',
        name: 'Ade Stores',
        sector: BusinessSector.RETAIL_TRADING,
        sectorDisplay: 'Retail & Trading',
        currency: Currency.NGN,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      },
      requestId: 'generated-request-id',
    });
  });

  it('should pass correct context to service', async () => {
    const business = makeBusiness();
    businessServiceMock.restoreBusiness.mockResolvedValue(business);

    const req = makeRestoreRequest({
      ip: '10.0.0.5',
      headers: { 'user-agent': 'CashTrace/1.0' },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(businessServiceMock.restoreBusiness).toHaveBeenCalledWith('biz-001', 'user-001', {
      ipAddress: '10.0.0.5',
      userAgent: 'CashTrace/1.0',
      requestId: 'generated-request-id',
    });
  });

  it('should return 401 when user is not authenticated', async () => {
    const req = makeRestoreRequest({ user: undefined });
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(res._status).toBe(401);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Authentication required',
      },
    });
    expect(businessServiceMock.restoreBusiness).not.toHaveBeenCalled();
  });

  it('should return 404 when business not found', async () => {
    businessServiceMock.restoreBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_NOT_FOUND', 'Business not found'),
    );

    const req = makeRestoreRequest();
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(res._status).toBe(404);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_NOT_FOUND',
        message: 'Business not found',
      },
    });
  });

  it('should return 403 when user does not own the business', async () => {
    businessServiceMock.restoreBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_FORBIDDEN', 'User does not own this business'),
    );

    const req = makeRestoreRequest();
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(res._status).toBe(403);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_FORBIDDEN',
        message: 'User does not own this business',
      },
    });
  });

  it('should return 400 when recovery window expired', async () => {
    businessServiceMock.restoreBusiness.mockRejectedValue(
      new BusinessError('BUSINESS_RECOVERY_EXPIRED', 'Recovery window has expired'),
    );

    const req = makeRestoreRequest();
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(res._status).toBe(400);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'BUSINESS_RECOVERY_EXPIRED',
        message: 'Recovery window has expired',
      },
    });
  });

  it('should return 500 for unexpected errors', async () => {
    businessServiceMock.restoreBusiness.mockRejectedValue(new Error('DB connection failed'));

    const req = makeRestoreRequest();
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(res._status).toBe(500);
    expect(res._json).toMatchObject({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: 'An unexpected error occurred',
      },
    });
  });

  it('should use x-request-id header when present', async () => {
    const business = makeBusiness();
    businessServiceMock.restoreBusiness.mockResolvedValue(business);

    const req = makeRestoreRequest({
      headers: {
        'x-request-id': 'custom-req-id-restore',
        'user-agent': 'test-agent',
      },
    } as Partial<AuthenticatedRequest>);
    const res = makeResponse();

    await restoreBusiness(req, res);

    expect(businessServiceMock.restoreBusiness).toHaveBeenCalledWith(
      'biz-001',
      'user-001',
      expect.objectContaining({ requestId: 'custom-req-id-restore' }),
    );
    expect(res._json).toMatchObject({ requestId: 'custom-req-id-restore' });
  });
});
