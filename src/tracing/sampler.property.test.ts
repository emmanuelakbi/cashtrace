/**
 * Property-based tests for Sampling Consistency
 *
 * **Property 8: Sampling Consistency**
 * For any trace sampling decision, it SHALL be consistent across all
 * spans in the same trace.
 *
 * **Validates: Requirements 4.6**
 */
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createTraceSampler, traceIdToSamplingScore } from './sampler.js';
import { createTracer, generateTraceId } from './tracer.js';

// ─── Generators ──────────────────────────────────────────────────────────────

/** Generate a valid 32-character hex trace ID. */
const traceIdArb = fc
  .uint8Array({ minLength: 16, maxLength: 16 })
  .map((bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''));

/** Generate a valid sampling rate in [0, 1]. */
const samplingRateArb = fc.double({ min: 0, max: 1, noNaN: true, noDefaultInfinity: true });

/** Generate a sampling rate that is neither 0 nor 1 (non-trivial). */
const nonTrivialSamplingRateArb = fc.double({
  min: 0.01,
  max: 0.99,
  noNaN: true,
  noDefaultInfinity: true,
});

/** Generate a span tree depth (number of child spans under root). */
const spanCountArb = fc.integer({ min: 1, max: 20 });

/** Generate a span name. */
const spanNameArb = fc.constantFrom(
  'db.query',
  'http.request',
  'cache.get',
  'auth.verify',
  'email.send',
  'gemini.call',
  'parse.document',
  'validate.input',
);

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('Property 8: Sampling Consistency', () => {
  /**
   * **Validates: Requirements 4.6**
   *
   * For any trace ID, the sampling decision is deterministic:
   * calling shouldSample with the same trace ID always returns the same result.
   */
  it('sampling decision is deterministic for any trace ID and rate', () => {
    fc.assert(
      fc.property(traceIdArb, samplingRateArb, (traceId, rate) => {
        const sampler = createTraceSampler({ samplingRate: rate });
        const decision1 = sampler.shouldSample(traceId);
        const decision2 = sampler.shouldSample(traceId);

        expect(decision1.sampled).toBe(decision2.sampled);
        expect(decision1.samplingRate).toBe(decision2.samplingRate);
      }),
      { numRuns: 500 },
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * For any trace with parent-child spans, all spans share the same
   * sampling decision (traceFlags) as the root span.
   */
  it('all spans in a trace share the same sampling decision', () => {
    fc.assert(
      fc.property(
        samplingRateArb,
        fc.array(spanNameArb, { minLength: 1, maxLength: 15 }),
        (rate, childNames) => {
          const tracer = createTracer({ serviceName: 'test', samplingRate: rate });
          const root = tracer.startSpan('root');
          const rootFlags = root.context.traceFlags;

          // Create child spans parented to root
          for (const name of childNames) {
            const child = tracer.startSpan(name, { parent: root });
            expect(child.context.traceFlags).toBe(rootFlags);
            expect(child.context.traceId).toBe(root.context.traceId);
          }
        },
      ),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * For any trace with deeply nested spans (grandchildren, etc.),
   * the sampling decision propagates through the entire hierarchy.
   */
  it('sampling decision propagates through nested span hierarchies', () => {
    fc.assert(
      fc.property(samplingRateArb, fc.integer({ min: 2, max: 10 }), (rate, depth) => {
        const tracer = createTracer({ serviceName: 'test', samplingRate: rate });
        const root = tracer.startSpan('root');
        const rootFlags = root.context.traceFlags;
        const rootTraceId = root.context.traceId;

        let current = root;
        for (let i = 0; i < depth; i++) {
          const child = tracer.startSpan(`span-depth-${i}`, { parent: current });
          expect(child.context.traceFlags).toBe(rootFlags);
          expect(child.context.traceId).toBe(rootTraceId);
          current = child;
        }
      }),
      { numRuns: 300 },
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * The sampling rate is statistically respected across many traces.
   * The observed sampling ratio should be within a tolerance of the configured rate.
   */
  it('sampling rate is statistically respected across many traces', () => {
    fc.assert(
      fc.property(nonTrivialSamplingRateArb, (rate) => {
        const sampler = createTraceSampler({ samplingRate: rate });
        const total = 5000;
        let sampled = 0;

        for (let i = 0; i < total; i++) {
          if (sampler.shouldSample(generateTraceId()).sampled) {
            sampled++;
          }
        }

        const observedRate = sampled / total;
        // Allow ±5% absolute tolerance for statistical variation
        expect(observedRate).toBeGreaterThanOrEqual(rate - 0.05);
        expect(observedRate).toBeLessThanOrEqual(rate + 0.05);
      }),
      { numRuns: 50 },
    );
  });

  /**
   * **Validates: Requirements 4.6**
   *
   * The traceIdToSamplingScore function always produces a value in [0, 1)
   * for any trace ID, ensuring the sampling comparison is well-defined.
   */
  it('traceIdToSamplingScore always returns a value in [0, 1) for any trace ID', () => {
    fc.assert(
      fc.property(traceIdArb, (traceId) => {
        const score = traceIdToSamplingScore(traceId);
        expect(score).toBeGreaterThanOrEqual(0);
        expect(score).toBeLessThan(1);
      }),
      { numRuns: 1000 },
    );
  });
});
