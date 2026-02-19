/**
 * Property-based tests for Trace Completeness
 *
 * **Property 4: Trace Completeness**
 * For any traced request, all significant operations (DB queries, external calls)
 * SHALL have corresponding spans.
 *
 * **Validates: Requirements 4.3**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createTracer, type Span } from './tracer.js';
import { withDbSpan, withHttpSpan, withOperationSpan } from './spanHelpers.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a DB system name. */
const dbSystemArb = fc.constantFrom('postgres', 'mysql', 'redis', 'mongodb', 'sqlite');

/** Generate a DB operation name. */
const dbOperationArb = fc.constantFrom(
  'SELECT',
  'INSERT',
  'UPDATE',
  'DELETE',
  'findOne',
  'aggregate',
);

/** Generate a DB name. */
const dbNameArb = fc.constantFrom('cashtrace', 'users_db', 'transactions_db', 'analytics');

/** Generate a simple SQL-like statement. */
const dbStatementArb = fc.constantFrom(
  'SELECT * FROM users WHERE id = $1',
  'INSERT INTO transactions (amount) VALUES ($1)',
  'UPDATE invoices SET status = $1 WHERE id = $2',
  'DELETE FROM sessions WHERE expired_at < NOW()',
);

/** Generate DB span options. */
const dbSpanOptionsArb = fc.record({
  dbSystem: dbSystemArb,
  dbStatement: fc.option(dbStatementArb, { nil: undefined }),
  dbOperation: fc.option(dbOperationArb, { nil: undefined }),
  dbName: fc.option(dbNameArb, { nil: undefined }),
});

/** Generate an HTTP method. */
const httpMethodArb = fc.constantFrom('GET', 'POST', 'PUT', 'PATCH', 'DELETE');

/** Generate a URL. */
const httpUrlArb = fc
  .tuple(
    fc.constantFrom(
      'https://api.example.com',
      'https://gemini.googleapis.com',
      'https://mail.provider.ng',
    ),
    fc.constantFrom('/v1/users', '/v1/transactions', '/v1/predict', '/v1/send'),
  )
  .map(([base, path]) => `${base}${path}`);

/** Generate HTTP span options. */
const httpSpanOptionsArb = fc.record({
  method: httpMethodArb,
  url: httpUrlArb,
});

/** Generate a generic operation name. */
const operationNameArb = fc.constantFrom(
  'process-payment',
  'parse-document',
  'send-notification',
  'validate-bvn',
  'compute-report',
);

/** Discriminated union representing an operation type. */
type OperationDef =
  | {
      type: 'db';
      options: { dbSystem: string; dbStatement?: string; dbOperation?: string; dbName?: string };
    }
  | { type: 'http'; options: { method: string; url: string } }
  | { type: 'generic'; name: string };

/** Generate a single operation definition. */
const operationDefArb: fc.Arbitrary<OperationDef> = fc.oneof(
  dbSpanOptionsArb.map((options) => ({ type: 'db' as const, options })),
  httpSpanOptionsArb.map((options) => ({ type: 'http' as const, options })),
  operationNameArb.map((name) => ({ type: 'generic' as const, name })),
);

/** Generate a non-empty sequence of operations. */
const operationSequenceArb = fc.array(operationDefArb, { minLength: 1, maxLength: 8 });

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Execute an operation using the appropriate span helper and capture the span
 * provided to the callback. Returns the captured span data.
 */
async function executeAndCapture(
  tracer: ReturnType<typeof createTracer>,
  op: OperationDef,
): Promise<{ span: Span; spanData: ReturnType<Span['toSpanData']> }> {
  let captured!: Span;

  switch (op.type) {
    case 'db':
      await withDbSpan(tracer, op.options, async (span) => {
        captured = span;
      });
      break;
    case 'http':
      await withHttpSpan(tracer, op.options, async (span) => {
        captured = span;
      });
      break;
    case 'generic':
      await withOperationSpan(tracer, op.name, {}, async (span) => {
        captured = span;
      });
      break;
  }

  return { span: captured, spanData: captured.toSpanData() };
}

/** Return the expected span name for an operation. */
function expectedSpanName(op: OperationDef): string {
  switch (op.type) {
    case 'db':
      return op.options.dbOperation
        ? `${op.options.dbSystem}.${op.options.dbOperation}`
        : op.options.dbSystem;
    case 'http':
      return `HTTP ${op.options.method}`;
    case 'generic':
      return op.name;
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 4: Trace Completeness', () => {
  /**
   * **Validates: Requirements 4.3**
   *
   * For any sequence of operations (DB queries, HTTP calls, generic operations),
   * each operation SHALL produce a corresponding span with the correct name,
   * ensuring no operation goes untraced.
   */
  it('every operation produces a corresponding span', async () => {
    await fc.assert(
      fc.asyncProperty(operationSequenceArb, async (operations) => {
        const tracer = createTracer({ serviceName: 'test-service' });
        const results = [];

        for (const op of operations) {
          const result = await executeAndCapture(tracer, op);
          results.push({ op, ...result });
        }

        // Every operation must have produced a span
        expect(results.length).toBe(operations.length);

        // Each span must have the expected name and be ended
        for (const { op, span, spanData } of results) {
          expect(spanData.name).toBe(expectedSpanName(op));
          expect(span.isEnded()).toBe(true);
          // Span must have a valid trace context
          expect(spanData.context.traceId).toBeTruthy();
          expect(spanData.context.spanId).toBeTruthy();
        }
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any DB query, the resulting span SHALL carry correct db.* semantic
   * attributes matching the operation parameters.
   */
  it('DB spans carry correct semantic attributes', async () => {
    await fc.assert(
      fc.asyncProperty(dbSpanOptionsArb, async (dbOpts) => {
        const tracer = createTracer({ serviceName: 'test-service' });
        const { spanData } = await executeAndCapture(tracer, { type: 'db', options: dbOpts });

        expect(spanData.attributes['db.system']).toBe(dbOpts.dbSystem);
        if (dbOpts.dbStatement != null) {
          expect(spanData.attributes['db.statement']).toBe(dbOpts.dbStatement);
        }
        if (dbOpts.dbOperation != null) {
          expect(spanData.attributes['db.operation']).toBe(dbOpts.dbOperation);
        }
        if (dbOpts.dbName != null) {
          expect(spanData.attributes['db.name']).toBe(dbOpts.dbName);
        }
        expect(spanData.kind).toBe('client');
        expect(spanData.status).toBe('ok');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any HTTP/external call, the resulting span SHALL carry correct http.*
   * semantic attributes matching the request parameters.
   */
  it('HTTP spans carry correct semantic attributes', async () => {
    await fc.assert(
      fc.asyncProperty(httpSpanOptionsArb, async (httpOpts) => {
        const tracer = createTracer({ serviceName: 'test-service' });
        const { spanData } = await executeAndCapture(tracer, { type: 'http', options: httpOpts });

        expect(spanData.attributes['http.method']).toBe(httpOpts.method);
        expect(spanData.attributes['http.url']).toBe(httpOpts.url);
        expect(spanData.kind).toBe('client');
        expect(spanData.status).toBe('ok');
      }),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 4.3**
   *
   * For any operation that throws an error, the span SHALL still be created
   * with status 'error' and an exception event, ensuring trace completeness
   * even on failure paths.
   */
  it('failed operations still produce spans with error status', async () => {
    await fc.assert(
      fc.asyncProperty(
        operationDefArb,
        fc.string({ minLength: 1, maxLength: 50 }),
        async (op, errorMsg) => {
          const tracer = createTracer({ serviceName: 'test-service' });
          let captured!: Span;

          const failingFn = async (span: Span) => {
            captured = span;
            throw new Error(errorMsg);
          };

          try {
            switch (op.type) {
              case 'db':
                await withDbSpan(tracer, op.options, failingFn);
                break;
              case 'http':
                await withHttpSpan(tracer, op.options, failingFn);
                break;
              case 'generic':
                await withOperationSpan(tracer, op.name, {}, failingFn);
                break;
            }
          } catch {
            // expected
          }

          // Span must still exist and be ended even after failure
          expect(captured).toBeDefined();
          expect(captured.isEnded()).toBe(true);

          const spanData = captured.toSpanData();
          expect(spanData.status).toBe('error');

          // Must have an exception event with the error message
          const exceptionEvent = spanData.events.find((e) => e.name === 'exception');
          expect(exceptionEvent).toBeDefined();
          expect(exceptionEvent!.attributes?.['exception.message']).toBe(errorMsg);
        },
      ),
      { numRuns: 200 },
    );
  });
});
