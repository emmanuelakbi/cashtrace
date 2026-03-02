/**
 * Unit tests for the Insight Controller.
 *
 * Tests all six API endpoints:
 * - GET /  (list insights)
 * - GET /:id  (get single insight)
 * - POST /:id/acknowledge
 * - POST /:id/dismiss
 * - POST /:id/resolve
 * - POST /refresh
 *
 * @module insights/controllers/insightController.test
 */

import express from 'express';
import type { Express } from 'express';
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';

import type { AnalysisContext, Insight, ScoredInsight } from '../types/index.js';
import type { InsightStore } from '../repositories/insightRepository.js';
import { createInsightStore, saveInsight } from '../repositories/insightRepository.js';
import { LifecycleManager } from '../services/lifecycleManager.js';
import { makeInsight, makeScoredInsight, makeAnalysisContext } from '../test/fixtures.js';

import { createInsightRouter, INSIGHT_ERROR_CODES } from './insightController.js';
import type { InsightRouterDeps } from './insightController.js';
import { InsightGenerator } from '../services/insightGenerator.js';
import { PriorityScorer } from '../services/priorityScorer.js';
import { InsightLimitEnforcer } from '../services/insightLimiter.js';
import { DismissalCooldownTracker } from '../services/dismissalCooldown.js';

// ─── Test Helpers ────────────────────────────────────────────────────────────

const TEST_BUSINESS_ID = 'biz-001';
const TEST_USER_ID = 'user-001';

/**
 * Middleware that injects auth context into the request,
 * simulating an authenticated user with a business.
 */
function authMiddleware(businessId: string, userId: string) {
  return (req: express.Request, _res: express.Response, next: express.NextFunction): void => {
    (req as Record<string, unknown>)['user'] = { userId };
    (req as Record<string, unknown>)['businessId'] = businessId;
    next();
  };
}

/** Create a minimal InsightGenerator for testing refresh. */
function makeTestGenerator(results: ScoredInsight[] = []): InsightGenerator {
  return {
    generateForBusiness: async (_ctx: AnalysisContext) => results,
    generateByCategory: async () => [],
    evaluateRealTime: async () => [],
  } as unknown as InsightGenerator;
}

/** Build a test Express app with the insight router mounted. */
function buildApp(deps: InsightRouterDeps, businessId = TEST_BUSINESS_ID): Express {
  const app = express();
  app.use(express.json());
  app.use(authMiddleware(businessId, TEST_USER_ID));
  app.use('/api/insights', createInsightRouter(deps));
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Insight Controller', () => {
  let store: InsightStore;
  let lifecycleManager: LifecycleManager;
  let deps: InsightRouterDeps;
  let app: Express;

  beforeEach(() => {
    store = createInsightStore();
    lifecycleManager = new LifecycleManager();

    deps = {
      store,
      lifecycleManager,
      generator: makeTestGenerator(),
      buildAnalysisContext: async (businessId: string) => makeAnalysisContext({ businessId }),
    };

    app = buildApp(deps);
  });

  // ─── GET / ───────────────────────────────────────────────────────────────

  describe('GET /api/insights', () => {
    it('returns empty list when no insights exist', async () => {
      const res = await request(app).get('/api/insights');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.insights).toEqual([]);
      expect(res.body.data.total).toBe(0);
      expect(res.body.requestId).toBeDefined();
    });

    it('returns insights for the business sorted by priority then score', async () => {
      const low = makeInsight({
        businessId: TEST_BUSINESS_ID,
        priority: 'low',
        score: 30,
        title: 'Low priority',
      });
      const high = makeInsight({
        businessId: TEST_BUSINESS_ID,
        priority: 'high',
        score: 80,
        title: 'High priority',
      });
      const critical = makeInsight({
        businessId: TEST_BUSINESS_ID,
        priority: 'critical',
        score: 90,
        title: 'Critical',
      });

      saveInsight(store, low);
      saveInsight(store, high);
      saveInsight(store, critical);

      const res = await request(app).get('/api/insights');

      expect(res.status).toBe(200);
      expect(res.body.data.total).toBe(3);
      expect(res.body.data.insights[0].title).toBe('Critical');
      expect(res.body.data.insights[1].title).toBe('High priority');
      expect(res.body.data.insights[2].title).toBe('Low priority');
    });

    it('does not return insights from other businesses', async () => {
      const ours = makeInsight({ businessId: TEST_BUSINESS_ID });
      const theirs = makeInsight({ businessId: 'other-biz' });

      saveInsight(store, ours);
      saveInsight(store, theirs);

      const res = await request(app).get('/api/insights');

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.insights[0].id).toBe(ours.id);
    });

    it('filters by status query parameter', async () => {
      const active = makeInsight({
        businessId: TEST_BUSINESS_ID,
        status: 'active',
      });
      const dismissed = makeInsight({
        businessId: TEST_BUSINESS_ID,
        status: 'dismissed',
      });

      saveInsight(store, active);
      saveInsight(store, dismissed);

      const res = await request(app).get('/api/insights?status=active');

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.insights[0].status).toBe('active');
    });

    it('filters by category query parameter', async () => {
      const tax = makeInsight({
        businessId: TEST_BUSINESS_ID,
        category: 'tax',
      });
      const cashflow = makeInsight({
        businessId: TEST_BUSINESS_ID,
        category: 'cashflow',
      });

      saveInsight(store, tax);
      saveInsight(store, cashflow);

      const res = await request(app).get('/api/insights?category=tax');

      expect(res.body.data.total).toBe(1);
      expect(res.body.data.insights[0].category).toBe('tax');
    });
  });

  // ─── GET /:id ────────────────────────────────────────────────────────────

  describe('GET /api/insights/:id', () => {
    it('returns a single insight by ID', async () => {
      const insight = makeInsight({ businessId: TEST_BUSINESS_ID });
      saveInsight(store, insight);

      // Also store in lifecycle manager so it can be found
      const res = await request(app).get(`/api/insights/${insight.id}`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.id).toBe(insight.id);
      expect(res.body.data.title).toBe(insight.title);
      expect(res.body.data.createdAt).toBeDefined();
    });

    it('returns 404 for non-existent insight', async () => {
      const res = await request(app).get('/api/insights/non-existent-id');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe(INSIGHT_ERROR_CODES.NOT_FOUND);
    });

    it('returns 404 for insight belonging to another business', async () => {
      const insight = makeInsight({ businessId: 'other-biz' });
      saveInsight(store, insight);

      const res = await request(app).get(`/api/insights/${insight.id}`);

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /:id/acknowledge ──────────────────────────────────────────────

  describe('POST /api/insights/:id/acknowledge', () => {
    it('acknowledges an active insight', async () => {
      // Create insight via lifecycle manager so it can be mutated
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);

      // Also save to the repository store for the ownership check
      saveInsight(store, created);

      const res = await request(app).post(`/api/insights/${created.id}/acknowledge`);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('acknowledged');
      expect(res.body.data.acknowledgedBy).toBe(TEST_USER_ID);
      expect(res.body.data.acknowledgedAt).toBeDefined();
    });

    it('returns 400 for invalid transition (already dismissed)', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);
      saveInsight(store, created);

      // Dismiss first
      await lifecycleManager.dismiss(created.id, TEST_USER_ID, 'not relevant');

      const res = await request(app).post(`/api/insights/${created.id}/acknowledge`);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error.code).toBe('INSIGHT_INVALID_TRANSITION');
    });

    it('returns 404 for non-existent insight', async () => {
      const res = await request(app).post('/api/insights/non-existent/acknowledge');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── POST /:id/dismiss ─────────────────────────────────────────────────

  describe('POST /api/insights/:id/dismiss', () => {
    it('dismisses an active insight with a reason', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);
      saveInsight(store, created);

      const res = await request(app)
        .post(`/api/insights/${created.id}/dismiss`)
        .send({ reason: 'Not applicable to my business' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('dismissed');
      expect(res.body.data.dismissedBy).toBe(TEST_USER_ID);
      expect(res.body.data.dismissReason).toBe('Not applicable to my business');
    });

    it('dismisses with empty reason when none provided', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);
      saveInsight(store, created);

      const res = await request(app).post(`/api/insights/${created.id}/dismiss`);

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('dismissed');
      expect(res.body.data.dismissReason).toBe('');
    });

    it('returns 400 for invalid transition', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);
      saveInsight(store, created);

      // Acknowledge first, then try to dismiss (invalid: acknowledged → dismissed)
      await lifecycleManager.acknowledge(created.id, TEST_USER_ID);

      const res = await request(app)
        .post(`/api/insights/${created.id}/dismiss`)
        .send({ reason: 'test' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSIGHT_INVALID_TRANSITION');
    });
  });

  // ─── POST /:id/resolve ─────────────────────────────────────────────────

  describe('POST /api/insights/:id/resolve', () => {
    it('resolves an acknowledged insight with notes', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);
      saveInsight(store, created);

      // Must acknowledge first
      await lifecycleManager.acknowledge(created.id, TEST_USER_ID);

      const res = await request(app)
        .post(`/api/insights/${created.id}/resolve`)
        .send({ notes: 'Filed VAT return for Q2' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('resolved');
      expect(res.body.data.resolvedBy).toBe(TEST_USER_ID);
      expect(res.body.data.resolutionNotes).toBe('Filed VAT return for Q2');
    });

    it('returns 400 when resolving an active insight (must acknowledge first)', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);
      saveInsight(store, created);

      const res = await request(app)
        .post(`/api/insights/${created.id}/resolve`)
        .send({ notes: 'Done' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSIGHT_INVALID_TRANSITION');
    });

    it('returns 400 when resolving an already resolved insight', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
      });
      const created = await lifecycleManager.create(scored);
      saveInsight(store, created);

      await lifecycleManager.acknowledge(created.id, TEST_USER_ID);
      await lifecycleManager.resolve(created.id, TEST_USER_ID, 'First resolution');

      const res = await request(app)
        .post(`/api/insights/${created.id}/resolve`)
        .send({ notes: 'Second attempt' });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INSIGHT_ALREADY_RESOLVED');
    });
  });

  // ─── POST /refresh ──────────────────────────────────────────────────────

  describe('POST /api/insights/refresh', () => {
    it('generates and returns new insights', async () => {
      const scored = makeScoredInsight({
        data: { businessId: TEST_BUSINESS_ID },
        title: 'Fresh insight',
      });

      deps.generator = makeTestGenerator([scored]);
      app = buildApp(deps);

      const res = await request(app).post('/api/insights/refresh');

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.generated).toBe(1);
      expect(res.body.data.insights).toHaveLength(1);
      expect(res.body.data.insights[0].title).toBe('Fresh insight');
    });

    it('returns empty list when no insights generated', async () => {
      deps.generator = makeTestGenerator([]);
      app = buildApp(deps);

      const res = await request(app).post('/api/insights/refresh');

      expect(res.status).toBe(200);
      expect(res.body.data.generated).toBe(0);
      expect(res.body.data.insights).toHaveLength(0);
    });

    it('returns 404 when business context cannot be built', async () => {
      deps.buildAnalysisContext = async () => null;
      app = buildApp(deps);

      const res = await request(app).post('/api/insights/refresh');

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe(INSIGHT_ERROR_CODES.BUSINESS_NOT_FOUND);
    });
  });

  // ─── Auth / Business context ────────────────────────────────────────────

  describe('Authentication and business context', () => {
    it('returns 404 when no business context is set', async () => {
      // Build app without business context
      const noAuthApp = express();
      noAuthApp.use(express.json());
      // Inject user but no businessId
      noAuthApp.use((req, _res, next) => {
        (req as Record<string, unknown>)['user'] = { userId: TEST_USER_ID };
        next();
      });
      noAuthApp.use('/api/insights', createInsightRouter(deps));

      const res = await request(noAuthApp).get('/api/insights');

      expect(res.status).toBe(404);
      expect(res.body.success).toBe(false);
    });
  });

  // ─── Response format ────────────────────────────────────────────────────

  describe('Response format', () => {
    it('includes requestId in all responses', async () => {
      const res = await request(app).get('/api/insights');

      expect(res.body.requestId).toBeDefined();
      expect(typeof res.body.requestId).toBe('string');
    });

    it('serializes dates as ISO strings', async () => {
      const insight = makeInsight({ businessId: TEST_BUSINESS_ID });
      saveInsight(store, insight);

      const res = await request(app).get(`/api/insights/${insight.id}`);

      expect(typeof res.body.data.createdAt).toBe('string');
      expect(typeof res.body.data.expiresAt).toBe('string');
      // Verify it's a valid ISO date
      expect(new Date(res.body.data.createdAt).toISOString()).toBe(res.body.data.createdAt);
    });
  });
});
