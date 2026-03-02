/**
 * Integration tests for the business module routes.
 *
 * Tests full HTTP request/response cycles through the Express router
 * using supertest, with service-level mocking.
 *
 * @module modules/business/business.integration.test
 */

import express from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  type Business,
  type BusinessExport,
  BusinessEventType,
  BusinessSector,
  Currency,
} from './types/index.js';

// ─── Mocks ───────────────────────────────────────────────────────────────────

vi.mock('./services/businessService.js', () => ({
  createBusiness: vi.fn(),
  getBusinessByUserId: vi.fn(),
  getBusinessById: vi.fn(),
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

vi.mock('./services/exportService.js', () => ({
  generateExport: vi.fn(),
}));

// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const businessServiceMock = vi.mocked(await import('./services/businessService.js'));
// eslint-disable-next-line @typescript-eslint/consistent-type-imports
const exportServiceMock = vi.mocked(await import('./services/exportService.js'));

// Dynamic import of the router after mocks are set up
const { businessRouter } = await import('./routes.js');

// ─── Helpers ─────────────────────────────────────────────────────────────────

const now = new Date('2025-01-15T10:00:00.000Z');
const USER_A = 'user-aaa-001';
const USER_B = 'user-bbb-002';
const BIZ_ID = 'biz-001';

function createTestApp(userId?: string): express.Express {
  const app = express();
  app.use(express.json());

  if (userId) {
    app.use((req, _res, next) => {
      (req as unknown as { user: { id: string } }).user = { id: userId };
      next();
    });
  }

  app.use('/api/business', businessRouter);
  return app;
}

function makeBusiness(overrides: Partial<Business> = {}): Business {
  return {
    id: BIZ_ID,
    userId: USER_A,
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

function makeExportData(overrides: Partial<BusinessExport> = {}): BusinessExport {
  return {
    exportedAt: now,
    business: makeBusiness(),
    auditTrail: [
      {
        id: 'audit-001',
        eventType: BusinessEventType.BUSINESS_CREATED,
        userId: USER_A,
        businessId: BIZ_ID,
        ipAddress: '127.0.0.1',
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

// ─── Tests ───────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
});

describe('Business Integration Tests', () => {
  // ─── 1. Full Business Lifecycle ──────────────────────────────────────────

  describe('Full business lifecycle (create → update → delete → restore)', () => {
    it('should create a business profile', async () => {
      const created = makeBusiness();
      businessServiceMock.createBusiness.mockResolvedValueOnce(created);

      const app = createTestApp(USER_A);
      const res = await request(app)
        .post('/api/business')
        .send({ name: 'Ade Stores', sector: 'RETAIL_TRADING' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.business.id).toBe(BIZ_ID);
      expect(res.body.business.name).toBe('Ade Stores');
      expect(res.body.business.sector).toBe('RETAIL_TRADING');
      expect(res.body.business.currency).toBe('NGN');
      expect(res.body.requestId).toBeDefined();
    });

    it('should update the business profile', async () => {
      const updated = makeBusiness({ name: 'Ade Global', updatedAt: new Date() });
      businessServiceMock.updateBusiness.mockResolvedValueOnce(updated);

      const app = createTestApp(USER_A);
      const res = await request(app).put(`/api/business/${BIZ_ID}`).send({ name: 'Ade Global' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.business.name).toBe('Ade Global');
    });

    it('should soft delete the business', async () => {
      businessServiceMock.softDeleteBusiness.mockResolvedValueOnce(undefined);

      const app = createTestApp(USER_A);
      const res = await request(app).delete(`/api/business/${BIZ_ID}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Business deleted successfully');
    });

    it('should restore the soft-deleted business', async () => {
      const restored = makeBusiness();
      businessServiceMock.restoreBusiness.mockResolvedValueOnce(restored);

      const app = createTestApp(USER_A);
      const res = await request(app).post(`/api/business/${BIZ_ID}/restore`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.business.id).toBe(BIZ_ID);
      expect(res.body.business.name).toBe('Ade Stores');
    });
  });

  // ─── 2. NDPR Export Flow ─────────────────────────────────────────────────

  describe('NDPR export flow', () => {
    it('should create a business and export its data', async () => {
      const created = makeBusiness();
      businessServiceMock.createBusiness.mockResolvedValueOnce(created);

      const app = createTestApp(USER_A);

      // Create business
      const createRes = await request(app).post('/api/business').send({ name: 'Ade Stores' });

      expect(createRes.status).toBe(201);

      // Export data
      const exportData = makeExportData();
      exportServiceMock.generateExport.mockResolvedValueOnce(exportData);

      const exportRes = await request(app).post('/api/business/export');

      expect(exportRes.status).toBe(200);
      expect(exportRes.body.success).toBe(true);
      expect(exportRes.body.data.business.name).toBe('Ade Stores');
      expect(exportRes.body.data.auditTrail).toHaveLength(1);
      expect(exportRes.body.data.metadata.format).toBe('json');
      expect(exportRes.body.data.metadata.version).toBe('1.0.0');
      expect(exportRes.body.requestId).toBeDefined();
    });

    it('should export data for a soft-deleted business within recovery window', async () => {
      const deletedBiz = makeBusiness({
        deletedAt: now,
        hardDeleteAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      });
      const exportData = makeExportData({
        business: deletedBiz,
        metadata: { version: '1.0.0', format: 'json', includesDeletedData: true },
      });
      exportServiceMock.generateExport.mockResolvedValueOnce(exportData);

      const app = createTestApp(USER_A);
      const res = await request(app).post('/api/business/export');

      expect(res.status).toBe(200);
      expect(res.body.data.metadata.includesDeletedData).toBe(true);
    });
  });

  // ─── 3. Ownership Validation ───────────────────────────────────────────

  describe('Ownership validation across endpoints', () => {
    it('should reject update from non-owner with 403', async () => {
      businessServiceMock.updateBusiness.mockRejectedValueOnce(
        new businessServiceMock.BusinessError(
          'BUSINESS_FORBIDDEN',
          'User does not own this business',
        ),
      );

      const app = createTestApp(USER_B);
      const res = await request(app).put(`/api/business/${BIZ_ID}`).send({ name: 'Hijacked' });

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BUSINESS_FORBIDDEN');
    });

    it('should reject delete from non-owner with 403', async () => {
      businessServiceMock.softDeleteBusiness.mockRejectedValueOnce(
        new businessServiceMock.BusinessError(
          'BUSINESS_FORBIDDEN',
          'User does not own this business',
        ),
      );

      const app = createTestApp(USER_B);
      const res = await request(app).delete(`/api/business/${BIZ_ID}`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BUSINESS_FORBIDDEN');
    });

    it('should reject restore from non-owner with 403', async () => {
      businessServiceMock.restoreBusiness.mockRejectedValueOnce(
        new businessServiceMock.BusinessError(
          'BUSINESS_FORBIDDEN',
          'User does not own this business',
        ),
      );

      const app = createTestApp(USER_B);
      const res = await request(app).post(`/api/business/${BIZ_ID}/restore`);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BUSINESS_FORBIDDEN');
    });
  });

  // ─── 4. Authentication Required ────────────────────────────────────────

  describe('Authentication required', () => {
    it('should return 401 for POST /api/business without auth', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/business').send({ name: 'No Auth' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INTERNAL_ERROR');
      expect(res.body.error.message).toBe('Authentication required');
    });

    it('should return 401 for GET /api/business without auth', async () => {
      const app = createTestApp();
      const res = await request(app).get('/api/business');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for PUT /api/business/:id without auth', async () => {
      const app = createTestApp();
      const res = await request(app).put(`/api/business/${BIZ_ID}`).send({ name: 'Updated' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for DELETE /api/business/:id without auth', async () => {
      const app = createTestApp();
      const res = await request(app).delete(`/api/business/${BIZ_ID}`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for POST /api/business/export without auth', async () => {
      const app = createTestApp();
      const res = await request(app).post('/api/business/export');

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });

    it('should return 401 for POST /api/business/:id/restore without auth', async () => {
      const app = createTestApp();
      const res = await request(app).post(`/api/business/${BIZ_ID}/restore`);

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── 5. Single Business Constraint ─────────────────────────────────────

  describe('Single business constraint', () => {
    it('should create first business successfully', async () => {
      const created = makeBusiness();
      businessServiceMock.createBusiness.mockResolvedValueOnce(created);

      const app = createTestApp(USER_A);
      const res = await request(app).post('/api/business').send({ name: 'Ade Stores' });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should reject second business creation with 400', async () => {
      businessServiceMock.createBusiness.mockRejectedValueOnce(
        new businessServiceMock.BusinessError(
          'BUSINESS_ALREADY_EXISTS',
          'User already has a business profile',
        ),
      );

      const app = createTestApp(USER_A);
      const res = await request(app).post('/api/business').send({ name: 'Second Business' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('BUSINESS_ALREADY_EXISTS');
    });
  });

  // ─── 6. Correlation ID ─────────────────────────────────────────────────

  describe('Correlation ID handling', () => {
    it('should include requestId in all responses', async () => {
      const created = makeBusiness();
      businessServiceMock.createBusiness.mockResolvedValueOnce(created);

      const app = createTestApp(USER_A);
      const res = await request(app).post('/api/business').send({ name: 'Ade Stores' });

      expect(res.body.requestId).toBeDefined();
      expect(typeof res.body.requestId).toBe('string');
    });

    it('should use provided x-request-id header', async () => {
      const created = makeBusiness();
      businessServiceMock.createBusiness.mockResolvedValueOnce(created);

      const app = createTestApp(USER_A);
      const res = await request(app)
        .post('/api/business')
        .set('x-request-id', 'custom-req-id')
        .send({ name: 'Ade Stores' });

      expect(res.body.requestId).toBe('custom-req-id');
    });
  });
});
