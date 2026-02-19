/**
 * Property-based tests for DSAR Response Time
 *
 * **Property 7: DSAR Response Time**
 * For any data subject access request, response SHALL be provided within 30 days
 * as required by NDPR.
 *
 * **Validates: Requirements 7.2, 7.3, 7.4**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { DSARHandler, InMemoryDSARDataProvider } from './dsarHandler.js';
import type { DSARType } from './types.js';

// ─── Constants ───────────────────────────────────────────────────────────────

/** NDPR mandates response within 30 days. */
const NDPR_MAX_RESPONSE_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

// ─── Generators ──────────────────────────────────────────────────────────────

const dsarTypeArb = fc.constantFrom<DSARType>('access', 'portability', 'erasure', 'rectification');

const safeStringArb = fc.stringMatching(/^[a-zA-Z0-9]{1,20}$/);

const userIdArb = safeStringArb.map((s) => `user-${s}`);

const verificationMethodArb = fc.constantFrom('email', 'phone', 'in_person', 'id_document');

/** Generate a DSAR request with all required fields. */
const dsarRequestArb = fc.record({
  userId: userIdArb,
  requestType: dsarTypeArb,
  requestedBy: safeStringArb,
  verificationMethod: verificationMethodArb,
});

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Create a fresh handler + data provider with seeded user data. */
function createHandlerWithUser(userId: string) {
  const dataProvider = new InMemoryDSARDataProvider();
  dataProvider.setUserPersonalData(userId, {
    userId,
    name: 'Test User',
    email: 'test@example.com',
    phone: '+234-800-000-0000',
    financialData: { balance: 50000 },
  });
  dataProvider.setUserConsents(userId, []);
  dataProvider.setUserActivityLog(userId, [{ action: 'login', ts: Date.now() }]);
  const handler = new DSARHandler(dataProvider);
  return { handler, dataProvider };
}

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('DSAR Response Time (Property 7)', () => {
  /**
   * For any valid DSAR request type, the request SHALL be processed and
   * completed within the 30-day NDPR deadline.
   *
   * **Validates: Requirements 7.2, 7.3, 7.4**
   */
  it('all DSAR requests complete within 30-day NDPR deadline', async () => {
    await fc.assert(
      fc.asyncProperty(dsarRequestArb, async (request) => {
        const { handler } = createHandlerWithUser(request.userId);

        const beforeSubmit = new Date();
        const requestId = await handler.submitRequest(request);

        const submittedStatus = await handler.getRequestStatus(requestId);
        expect(submittedStatus).toBe('pending');

        const result = await handler.processRequest(requestId);

        expect(result.status).toBe('completed');
        expect(result.completedAt).toBeInstanceOf(Date);

        // The response time must be within 30 days of submission
        const daysDiff = (result.completedAt.getTime() - beforeSubmit.getTime()) / MS_PER_DAY;
        expect(daysDiff).toBeLessThanOrEqual(NDPR_MAX_RESPONSE_DAYS);
      }),
      { numRuns: 100 },
    );
  });

  /**
   * For any access DSAR request, the response SHALL include the user's
   * personal data in machine-readable format.
   *
   * **Validates: Requirements 7.2**
   */
  it('access requests return user personal data within deadline', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        safeStringArb,
        verificationMethodArb,
        async (userId, requestedBy, verificationMethod) => {
          const { handler } = createHandlerWithUser(userId);

          const beforeSubmit = new Date();
          const requestId = await handler.submitRequest({
            userId,
            requestType: 'access',
            requestedBy,
            verificationMethod,
          });

          const result = await handler.processRequest(requestId);

          expect(result.status).toBe('completed');
          expect(result.data).toBeDefined();
          expect(result.data!.userId).toBe(userId);
          expect(result.data!.format).toBe('json');
          expect(result.data!.personalData).toHaveProperty('name');

          const daysDiff = (result.completedAt.getTime() - beforeSubmit.getTime()) / MS_PER_DAY;
          expect(daysDiff).toBeLessThanOrEqual(NDPR_MAX_RESPONSE_DAYS);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * For any portability DSAR request, the response SHALL export data in
   * machine-readable JSON format within the deadline.
   *
   * **Validates: Requirements 7.3**
   */
  it('portability requests export data in machine-readable format within deadline', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        safeStringArb,
        verificationMethodArb,
        async (userId, requestedBy, verificationMethod) => {
          const { handler } = createHandlerWithUser(userId);

          const beforeSubmit = new Date();
          const requestId = await handler.submitRequest({
            userId,
            requestType: 'portability',
            requestedBy,
            verificationMethod,
          });

          const result = await handler.processRequest(requestId);

          expect(result.status).toBe('completed');
          expect(result.data).toBeDefined();
          expect(result.data!.format).toBe('json');
          expect(result.data!.exportedAt).toBeInstanceOf(Date);

          const daysDiff = (result.completedAt.getTime() - beforeSubmit.getTime()) / MS_PER_DAY;
          expect(daysDiff).toBeLessThanOrEqual(NDPR_MAX_RESPONSE_DAYS);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * For any erasure DSAR request, the user's personal data SHALL be deleted
   * (with regulatory-required fields retained) within the deadline.
   *
   * **Validates: Requirements 7.4**
   */
  it('erasure requests delete personal data within deadline', async () => {
    await fc.assert(
      fc.asyncProperty(
        userIdArb,
        safeStringArb,
        verificationMethodArb,
        async (userId, requestedBy, verificationMethod) => {
          const { handler } = createHandlerWithUser(userId);

          const beforeSubmit = new Date();
          const requestId = await handler.submitRequest({
            userId,
            requestType: 'erasure',
            requestedBy,
            verificationMethod,
          });

          const result = await handler.processRequest(requestId);

          expect(result.status).toBe('completed');
          expect(result.deletionResult).toBeDefined();
          expect(result.deletionResult!.userId).toBe(userId);
          expect(result.deletionResult!.deletedAt).toBeInstanceOf(Date);
          expect(result.deletionResult!.fieldsDeleted.length).toBeGreaterThan(0);

          // Financial data retained for regulatory compliance
          expect(result.deletionResult!.fieldsRetained).toContain('financialData');

          const daysDiff = (result.completedAt.getTime() - beforeSubmit.getTime()) / MS_PER_DAY;
          expect(daysDiff).toBeLessThanOrEqual(NDPR_MAX_RESPONSE_DAYS);

          // Verify data is actually inaccessible after erasure
          const postErasureData = await handler.exportUserData(userId);
          expect(postErasureData.personalData).toEqual({});
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * For any DSAR request, the status transitions SHALL follow the correct
   * lifecycle: pending → processing → completed.
   *
   * **Validates: Requirements 7.2, 7.3, 7.4**
   */
  it('DSAR requests follow correct status lifecycle', async () => {
    await fc.assert(
      fc.asyncProperty(dsarRequestArb, async (request) => {
        const { handler } = createHandlerWithUser(request.userId);

        const requestId = await handler.submitRequest(request);

        // Status starts as pending
        const initialStatus = await handler.getRequestStatus(requestId);
        expect(initialStatus).toBe('pending');

        // After processing, status is completed
        const result = await handler.processRequest(requestId);
        expect(result.status).toBe('completed');

        const finalStatus = await handler.getRequestStatus(requestId);
        expect(finalStatus).toBe('completed');

        // Re-processing a completed request should be rejected
        await expect(handler.processRequest(requestId)).rejects.toThrow('not pending');
      }),
      { numRuns: 100 },
    );
  });
});
