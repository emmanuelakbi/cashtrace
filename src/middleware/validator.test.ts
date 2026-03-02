/**
 * Unit tests for the request validator middleware.
 *
 * Tests cover:
 * - Schema registration and lookup
 * - Body validation (Req 2.1)
 * - Query parameter validation (Req 2.2)
 * - Path parameter validation (Req 2.3)
 * - HTTP 400 with detailed field errors (Req 2.4)
 * - Correlation ID in error responses
 *
 * @module middleware/validator.test
 */

import { describe, it, expect, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

import {
  registerSchema,
  getSchema,
  clearSchemas,
  validate,
  createValidatorMiddleware,
} from './validator.js';
import type { RequestSchema } from './validator.js';
import { GATEWAY_ERROR_CODES } from '../gateway/types.js';

// ─── Test Schemas ────────────────────────────────────────────────────────────

const createUserSchema: RequestSchema = {
  body: {
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      name: { type: 'string', minLength: 1 },
      age: { type: 'integer', minimum: 0 },
    },
    required: ['email', 'name'],
    additionalProperties: false,
  },
};

const searchSchema: RequestSchema = {
  query: {
    type: 'object',
    properties: {
      q: { type: 'string', minLength: 1 },
      page: { type: 'integer', minimum: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 100 },
    },
    required: ['q'],
  },
};

const pathParamSchema: RequestSchema = {
  params: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$',
      },
    },
    required: ['id'],
  },
};

const fullSchema: RequestSchema = {
  body: {
    type: 'object',
    properties: {
      amount: { type: 'integer', minimum: 1 },
    },
    required: ['amount'],
  },
  query: {
    type: 'object',
    properties: {
      currency: { type: 'string', enum: ['NGN', 'USD'] },
    },
    required: ['currency'],
  },
  params: {
    type: 'object',
    properties: {
      accountId: { type: 'string', minLength: 1 },
    },
    required: ['accountId'],
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a minimal Express app with the validator middleware on a test route.
 */
function createTestApp(schemaName: string, method: 'post' | 'get' = 'post'): express.Express {
  const app = express();
  app.use(express.json());

  // Attach a fake context with correlationId
  app.use((_req, _res, next) => {
    _req.context = {
      correlationId: 'test-corr-id',
      clientIP: '127.0.0.1',
      userAgent: 'test',
      timestamp: new Date(),
      permissions: [],
    };
    next();
  });

  const handler = (_req: express.Request, res: express.Response): void => {
    res.status(200).json({ success: true });
  };

  if (method === 'post') {
    app.post('/test', createValidatorMiddleware(schemaName), handler);
    app.post('/test/:id', createValidatorMiddleware(schemaName), handler);
  } else {
    app.get('/test', createValidatorMiddleware(schemaName), handler);
    app.get('/test/:id', createValidatorMiddleware(schemaName), handler);
  }

  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('validator', () => {
  beforeEach(() => {
    clearSchemas();
  });

  // ── Schema Registry ──────────────────────────────────────────────────────

  describe('schema registry', () => {
    it('should register and retrieve a schema', () => {
      registerSchema('createUser', createUserSchema);
      expect(getSchema('createUser')).toEqual(createUserSchema);
    });

    it('should return undefined for unregistered schema', () => {
      expect(getSchema('nonexistent')).toBeUndefined();
    });

    it('should overwrite existing schema on re-registration', () => {
      registerSchema('test', createUserSchema);
      registerSchema('test', searchSchema);
      expect(getSchema('test')).toEqual(searchSchema);
    });

    it('should clear all schemas', () => {
      registerSchema('a', createUserSchema);
      registerSchema('b', searchSchema);
      clearSchemas();
      expect(getSchema('a')).toBeUndefined();
      expect(getSchema('b')).toBeUndefined();
    });
  });

  // ── validate() function ──────────────────────────────────────────────────

  describe('validate()', () => {
    it('should return valid for correct body data', () => {
      registerSchema('createUser', createUserSchema);
      const result = validate('createUser', {
        body: { email: 'user@example.com', name: 'Ada' },
      });
      expect(result.valid).toBe(true);
      expect(result.errors).toBeUndefined();
    });

    it('should return errors for invalid body data', () => {
      registerSchema('createUser', createUserSchema);
      const result = validate('createUser', {
        body: { email: 'not-an-email', name: '' },
      });
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should return errors for missing required fields', () => {
      registerSchema('createUser', createUserSchema);
      const result = validate('createUser', { body: {} });
      expect(result.valid).toBe(false);
      const paths = result.errors!.map((e) => e.path);
      expect(paths).toContain('body.email');
      expect(paths).toContain('body.name');
    });

    it('should return error for unregistered schema', () => {
      const result = validate('ghost', { body: {} });
      expect(result.valid).toBe(false);
      expect(result.errors![0]!.keyword).toBe('schema');
    });

    it('should validate query parameters', () => {
      registerSchema('search', searchSchema);
      const result = validate('search', { query: { q: 'test', page: 1 } });
      expect(result.valid).toBe(true);
    });

    it('should return errors for invalid query parameters', () => {
      registerSchema('search', searchSchema);
      const result = validate('search', { query: {} });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.path === 'query.q')).toBe(true);
    });

    it('should validate path parameters', () => {
      registerSchema('getById', pathParamSchema);
      const result = validate('getById', {
        params: { id: '550e8400-e29b-41d4-a716-446655440000' },
      });
      expect(result.valid).toBe(true);
    });

    it('should return errors for invalid path parameters', () => {
      registerSchema('getById', pathParamSchema);
      const result = validate('getById', { params: { id: 'not-a-uuid' } });
      expect(result.valid).toBe(false);
      expect(result.errors!.some((e) => e.path === 'params.id')).toBe(true);
    });

    it('should aggregate errors from body, query, and params', () => {
      registerSchema('full', fullSchema);
      const result = validate('full', {
        body: {},
        query: {},
        params: {},
      });
      expect(result.valid).toBe(false);
      const paths = result.errors!.map((e) => e.path);
      expect(paths.some((p) => p.startsWith('body'))).toBe(true);
      expect(paths.some((p) => p.startsWith('query'))).toBe(true);
      expect(paths.some((p) => p.startsWith('params'))).toBe(true);
    });
  });

  // ── Middleware (supertest) ───────────────────────────────────────────────

  describe('createValidatorMiddleware', () => {
    it('should pass valid request through to handler', async () => {
      registerSchema('createUser', createUserSchema);
      const app = createTestApp('createUser');

      const res = await request(app).post('/test').send({ email: 'user@example.com', name: 'Ada' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('should return 400 for invalid body (Req 2.4)', async () => {
      registerSchema('createUser', createUserSchema);
      const app = createTestApp('createUser');

      const res = await request(app).post('/test').send({ email: 'bad', name: '' });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(GATEWAY_ERROR_CODES.VALIDATION_FAILED);
    });

    it('should return detailed field errors (Req 2.4)', async () => {
      registerSchema('createUser', createUserSchema);
      const app = createTestApp('createUser');

      const res = await request(app).post('/test').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.fields).toBeDefined();
      expect(res.body.error.fields['body.email']).toBeDefined();
      expect(res.body.error.fields['body.name']).toBeDefined();
    });

    it('should include correlationId in error response', async () => {
      registerSchema('createUser', createUserSchema);
      const app = createTestApp('createUser');

      const res = await request(app).post('/test').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBe('test-corr-id');
    });

    it('should include timestamp in error response', async () => {
      registerSchema('createUser', createUserSchema);
      const app = createTestApp('createUser');

      const res = await request(app).post('/test').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.timestamp).toBeDefined();
      // Should be a valid ISO 8601 string
      expect(new Date(res.body.error.timestamp).toISOString()).toBe(res.body.error.timestamp);
    });

    it('should return 400 for invalid query params (Req 2.2)', async () => {
      registerSchema('search', searchSchema);
      const app = createTestApp('search', 'get');

      const res = await request(app).get('/test');

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(GATEWAY_ERROR_CODES.VALIDATION_FAILED);
      expect(res.body.error.fields['query.q']).toBeDefined();
    });

    it('should pass valid query params through', async () => {
      registerSchema('search', searchSchema);
      const app = createTestApp('search', 'get');

      const res = await request(app).get('/test?q=hello&page=1');

      expect(res.status).toBe(200);
    });

    it('should return 400 for missing required body fields', async () => {
      registerSchema('createUser', createUserSchema);
      const app = createTestApp('createUser');

      const res = await request(app).post('/test').send({ email: 'user@example.com' }); // missing 'name'

      expect(res.status).toBe(400);
      expect(res.body.error.fields['body.name']).toBeDefined();
    });

    it('should return 400 for schema not found', async () => {
      // Don't register any schema
      const app = createTestApp('nonexistent');

      const res = await request(app).post('/test').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe(GATEWAY_ERROR_CODES.VALIDATION_FAILED);
    });

    it('should use "unknown" correlationId when context is missing', async () => {
      registerSchema('createUser', createUserSchema);

      const app = express();
      app.use(express.json());
      // No context middleware
      app.post('/test', createValidatorMiddleware('createUser'), (_req, res) => {
        res.status(200).json({ success: true });
      });

      const res = await request(app).post('/test').send({});

      expect(res.status).toBe(400);
      expect(res.body.error.correlationId).toBe('unknown');
    });
  });
});
