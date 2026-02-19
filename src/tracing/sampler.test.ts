import { describe, it, expect } from 'vitest';
import { createTraceSampler, traceIdToSamplingScore } from './sampler.js';
import { generateTraceId } from './tracer.js';
import { createTracer } from './tracer.js';
import type { SpanData, SpanExporter } from './opentelemetryConfig.js';

describe('traceIdToSamplingScore', () => {
  it('returns a value in [0, 1)', () => {
    for (let i = 0; i < 100; i++) {
      const score = traceIdToSamplingScore(generateTraceId());
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThan(1);
    }
  });

  it('is deterministic — same trace ID always gives same score', () => {
    const traceId = generateTraceId();
    const score1 = traceIdToSamplingScore(traceId);
    const score2 = traceIdToSamplingScore(traceId);
    expect(score1).toBe(score2);
  });

  it('produces different scores for different trace IDs', () => {
    const scores = new Set<number>();
    for (let i = 0; i < 50; i++) {
      scores.add(traceIdToSamplingScore(generateTraceId()));
    }
    // With 50 random IDs, we should get many distinct scores
    expect(scores.size).toBeGreaterThan(40);
  });
});

describe('createTraceSampler', () => {
  it('defaults to 10% sampling rate', () => {
    const sampler = createTraceSampler();
    expect(sampler.getSamplingRate()).toBe(0.1);
  });

  it('accepts a custom sampling rate', () => {
    const sampler = createTraceSampler({ samplingRate: 0.5 });
    expect(sampler.getSamplingRate()).toBe(0.5);
  });

  it('clamps rate below 0 to 0', () => {
    const sampler = createTraceSampler({ samplingRate: -0.5 });
    expect(sampler.getSamplingRate()).toBe(0);
  });

  it('clamps rate above 1 to 1', () => {
    const sampler = createTraceSampler({ samplingRate: 2.0 });
    expect(sampler.getSamplingRate()).toBe(1);
  });

  it('falls back to default for NaN', () => {
    const sampler = createTraceSampler({ samplingRate: NaN });
    expect(sampler.getSamplingRate()).toBe(0.1);
  });

  it('falls back to default for Infinity', () => {
    const sampler = createTraceSampler({ samplingRate: Infinity });
    expect(sampler.getSamplingRate()).toBe(0.1);
  });

  describe('shouldSample', () => {
    it('is deterministic for the same trace ID', () => {
      const sampler = createTraceSampler({ samplingRate: 0.5 });
      const traceId = generateTraceId();
      const d1 = sampler.shouldSample(traceId);
      const d2 = sampler.shouldSample(traceId);
      expect(d1.sampled).toBe(d2.sampled);
    });

    it('returns samplingRate in the decision', () => {
      const sampler = createTraceSampler({ samplingRate: 0.3 });
      const decision = sampler.shouldSample(generateTraceId());
      expect(decision.samplingRate).toBe(0.3);
    });

    it('never samples when rate is 0', () => {
      const sampler = createTraceSampler({ samplingRate: 0 });
      for (let i = 0; i < 100; i++) {
        expect(sampler.shouldSample(generateTraceId()).sampled).toBe(false);
      }
    });

    it('always samples when rate is 1', () => {
      const sampler = createTraceSampler({ samplingRate: 1 });
      for (let i = 0; i < 100; i++) {
        expect(sampler.shouldSample(generateTraceId()).sampled).toBe(true);
      }
    });

    it('samples approximately the configured rate over many traces', () => {
      const sampler = createTraceSampler({ samplingRate: 0.5 });
      let sampled = 0;
      const total = 10000;
      for (let i = 0; i < total; i++) {
        if (sampler.shouldSample(generateTraceId()).sampled) sampled++;
      }
      const ratio = sampled / total;
      // Allow ±5% tolerance
      expect(ratio).toBeGreaterThan(0.45);
      expect(ratio).toBeLessThan(0.55);
    });
  });

  describe('setSamplingRate', () => {
    it('updates the sampling rate', () => {
      const sampler = createTraceSampler({ samplingRate: 0.1 });
      sampler.setSamplingRate(0.8);
      expect(sampler.getSamplingRate()).toBe(0.8);
    });

    it('clamps invalid values', () => {
      const sampler = createTraceSampler();
      sampler.setSamplingRate(-1);
      expect(sampler.getSamplingRate()).toBe(0);
      sampler.setSamplingRate(5);
      expect(sampler.getSamplingRate()).toBe(1);
    });
  });
});

describe('Tracer sampling integration', () => {
  it('root span traceFlags=1 when sampled', () => {
    // Use rate=1 so everything is sampled
    const tracer = createTracer({ serviceName: 'test', samplingRate: 1 });
    const span = tracer.startSpan('root');
    expect(span.context.traceFlags).toBe(1);
  });

  it('root span traceFlags=0 when not sampled', () => {
    const tracer = createTracer({ serviceName: 'test', samplingRate: 0 });
    const span = tracer.startSpan('root');
    expect(span.context.traceFlags).toBe(0);
  });

  it('child span inherits traceFlags from parent', () => {
    const tracer = createTracer({ serviceName: 'test', samplingRate: 1 });
    const parent = tracer.startSpan('parent');
    const child = tracer.startSpan('child', { parent });
    expect(child.context.traceFlags).toBe(parent.context.traceFlags);
  });

  it('child span inherits unsampled traceFlags from parent', () => {
    const tracer = createTracer({ serviceName: 'test', samplingRate: 0 });
    const parent = tracer.startSpan('parent');
    const child = tracer.startSpan('child', { parent });
    expect(child.context.traceFlags).toBe(0);
  });

  it('all spans in a trace share the same sampling decision via withSpan', () => {
    const tracer = createTracer({ serviceName: 'test', samplingRate: 1 });
    const root = tracer.startSpan('root');
    tracer.withSpan(root, () => {
      const child1 = tracer.startSpan('child1');
      const child2 = tracer.startSpan('child2');
      expect(child1.context.traceFlags).toBe(root.context.traceFlags);
      expect(child2.context.traceFlags).toBe(root.context.traceFlags);
    });
  });

  it('flush only exports sampled spans', async () => {
    const exported: SpanData[][] = [];
    const exporter: SpanExporter = {
      async export(spans) {
        exported.push(spans);
      },
      async shutdown() {},
    };

    // Rate 0 → nothing sampled
    const tracer = createTracer({ serviceName: 'test', samplingRate: 0, exporter });
    const span = tracer.startSpan('unsampled');
    span.end();
    tracer.withSpan(span, () => {});
    await tracer.flush();

    // Exporter should not have been called
    expect(exported).toHaveLength(0);
  });

  it('flush exports sampled spans', async () => {
    const exported: SpanData[][] = [];
    const exporter: SpanExporter = {
      async export(spans) {
        exported.push(spans);
      },
      async shutdown() {},
    };

    const tracer = createTracer({ serviceName: 'test', samplingRate: 1, exporter });
    const span = tracer.startSpan('sampled');
    span.end();
    tracer.withSpan(span, () => {});
    await tracer.flush();

    expect(exported).toHaveLength(1);
    expect(exported[0]![0]!.name).toBe('sampled');
  });

  it('accepts a custom sampler instance', () => {
    const customSampler = createTraceSampler({ samplingRate: 1 });
    const tracer = createTracer({ serviceName: 'test', sampler: customSampler });
    const span = tracer.startSpan('root');
    expect(span.context.traceFlags).toBe(1);
  });
});
