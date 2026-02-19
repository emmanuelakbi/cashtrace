/**
 * Tracer Service
 *
 * Provides distributed tracing with trace ID generation, span management,
 * and context propagation to downstream services.
 *
 * Requirements: 4.1 (generate trace IDs), 4.2 (propagate trace context)
 */

import { randomBytes } from 'crypto';
import type {
  SpanKind,
  SpanStatusCode,
  SpanAttributes,
  SpanContext,
  SpanData,
  SpanEvent,
  SpanExporter,
  ContextPropagator,
} from './opentelemetryConfig.js';
import { createTraceSampler } from './sampler.js';
import type { TraceSampler } from './sampler.js';

// Re-export types used by consumers
export type { SpanKind, SpanAttributes };
export type SpanStatus = SpanStatusCode;

export interface SpanOptions {
  parent?: Span;
  attributes?: SpanAttributes;
  kind?: SpanKind;
}

export interface Span {
  readonly name: string;
  readonly context: SpanContext;
  readonly parentSpanId?: string;
  setAttributes(attributes: SpanAttributes): void;
  addEvent(name: string, attributes?: SpanAttributes): void;
  setStatus(status: SpanStatus): void;
  end(): void;
  /** Returns true if end() has been called */
  isEnded(): boolean;
  /** Returns the collected span data (for export) */
  toSpanData(): SpanData;
}

export interface Tracer {
  startSpan(name: string, options?: SpanOptions): Span;
  getCurrentSpan(): Span | null;
  withSpan<T>(span: Span, fn: () => T): T;
}

export interface TracerConfig {
  serviceName: string;
  exporter?: SpanExporter;
  propagator?: ContextPropagator;
  /**
   * Sampling rate between 0.0 and 1.0 (default: 0.1 = 10%).
   * When set, only a fraction of traces will be recorded/exported.
   * The decision is deterministic per trace ID, so all spans in a
   * trace share the same sampling decision.
   * Requirement 4.6.
   */
  samplingRate?: number;
  /** Provide a custom sampler instance (overrides samplingRate). */
  sampler?: TraceSampler;
}

/**
 * Generate a random hex string of the given byte length.
 */
function generateHexId(byteLength: number): string {
  return randomBytes(byteLength).toString('hex');
}

/**
 * Generate a 32-character hex trace ID (16 bytes).
 * Requirement 4.1: Generate trace IDs for incoming requests.
 */
export function generateTraceId(): string {
  return generateHexId(16);
}

/**
 * Generate a 16-character hex span ID (8 bytes).
 */
export function generateSpanId(): string {
  return generateHexId(8);
}

class SpanImpl implements Span {
  readonly name: string;
  readonly context: SpanContext;
  readonly parentSpanId?: string;

  private _kind: SpanKind;
  private _attributes: SpanAttributes;
  private _status: SpanStatusCode;
  private _events: SpanEvent[];
  private _startTime: number;
  private _endTime?: number;
  private _ended: boolean;

  constructor(name: string, context: SpanContext, options?: SpanOptions) {
    this.name = name;
    this.context = context;
    this._kind = options?.kind ?? 'internal';
    this._attributes = { ...(options?.attributes ?? {}) };
    this._status = 'unset';
    this._events = [];
    this._startTime = Date.now();
    this._ended = false;
    this.parentSpanId = options?.parent?.context.spanId;
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this._ended) return;
    Object.assign(this._attributes, attributes);
  }

  addEvent(name: string, attributes?: SpanAttributes): void {
    if (this._ended) return;
    this._events.push({
      name,
      timestamp: Date.now(),
      attributes,
    });
  }

  setStatus(status: SpanStatus): void {
    if (this._ended) return;
    this._status = status;
  }

  end(): void {
    if (this._ended) return;
    this._endTime = Date.now();
    this._ended = true;
  }

  isEnded(): boolean {
    return this._ended;
  }

  toSpanData(): SpanData {
    return {
      name: this.name,
      kind: this._kind,
      startTime: this._startTime,
      endTime: this._endTime,
      attributes: { ...this._attributes },
      status: this._status,
      events: [...this._events],
      context: { ...this.context },
      parentSpanId: this.parentSpanId,
    };
  }
}

/**
 * Creates a Tracer instance for distributed tracing.
 *
 * The tracer generates unique trace IDs for incoming requests (Req 4.1)
 * and supports context propagation to downstream services (Req 4.2)
 * via the inject/extract methods on the propagator.
 */
export function createTracer(config: TracerConfig): Tracer & {
  /**
   * Inject the current span's trace context into outgoing headers.
   * Requirement 4.2: Propagate trace context to downstream services.
   */
  injectContext(span: Span): Record<string, string>;
  /**
   * Extract trace context from incoming request headers and create a span
   * that continues the trace.
   */
  extractContext(headers: Record<string, string | undefined>): SpanContext | null;
  /**
   * Flush completed spans to the exporter.
   */
  flush(): Promise<void>;
  /**
   * Shutdown the tracer and flush remaining spans.
   */
  shutdown(): Promise<void>;
} {
  const exporter = config.exporter;
  const propagator = config.propagator;
  const sampler = config.sampler ?? createTraceSampler({ samplingRate: config.samplingRate });
  const completedSpans: SpanData[] = [];
  let currentSpan: Span | null = null;

  function startSpan(name: string, options?: SpanOptions): Span {
    const parentSpan = options?.parent ?? currentSpan;
    const traceId = parentSpan ? parentSpan.context.traceId : generateTraceId();
    const spanId = generateSpanId();

    // Sampling decision: inherit from parent, or make a new decision for root spans.
    // traceFlags bit 0 (0x01) = sampled flag per W3C Trace Context spec.
    let traceFlags: number;
    if (parentSpan) {
      traceFlags = parentSpan.context.traceFlags;
    } else {
      const decision = sampler.shouldSample(traceId);
      traceFlags = decision.sampled ? 1 : 0;
    }

    const context: SpanContext = {
      traceId,
      spanId,
      traceFlags,
    };

    const spanOptions: SpanOptions = {
      ...options,
      parent: parentSpan ?? undefined,
    };

    const span = new SpanImpl(name, context, spanOptions);
    return span;
  }

  function getCurrentSpan(): Span | null {
    return currentSpan;
  }

  function withSpan<T>(span: Span, fn: () => T): T {
    const previousSpan = currentSpan;
    currentSpan = span;
    try {
      const result = fn();
      return result;
    } finally {
      if (span.isEnded()) {
        completedSpans.push(span.toSpanData());
      }
      currentSpan = previousSpan;
    }
  }

  function injectContext(span: Span): Record<string, string> {
    if (!propagator) return {};
    return propagator.inject(span.context);
  }

  function extractContext(headers: Record<string, string | undefined>): SpanContext | null {
    if (!propagator) return null;
    return propagator.extract(headers);
  }

  async function flush(): Promise<void> {
    if (!exporter || completedSpans.length === 0) return;
    const spans = completedSpans.splice(0, completedSpans.length);
    // Only export sampled spans (traceFlags bit 0 = sampled)
    const sampledSpans = spans.filter((s) => (s.context.traceFlags & 1) === 1);
    if (sampledSpans.length === 0) return;
    await exporter.export(sampledSpans);
  }

  async function shutdown(): Promise<void> {
    await flush();
    if (exporter) {
      await exporter.shutdown();
    }
  }

  return {
    startSpan,
    getCurrentSpan,
    withSpan,
    injectContext,
    extractContext,
    flush,
    shutdown,
  };
}
