/**
 * Tracing Module
 *
 * Provides distributed tracing with OpenTelemetry compatibility,
 * span creation, and configurable sampling for CashTrace observability.
 */

export {
  type OpenTelemetryConfig,
  type TracingExporter,
  type PropagationFormat,
  type SpanProcessorType,
  type SpanKind,
  type SpanStatusCode,
  type SpanAttributes,
  type SpanContext,
  type SpanData,
  type SpanEvent,
  type SpanExporter,
  type ContextPropagator,
  loadOpenTelemetryConfig,
  createSpanExporter,
  createW3CPropagator,
  createContextPropagator,
} from './opentelemetryConfig.js';

export {
  type ExporterConfig,
  type BatchConfig,
  type ExportResult,
  type HttpTransport,
  type HttpResponse,
  type OTLPSpan,
  type OTLPExportRequest,
  type XRaySegment,
  formatSpanToOTLP,
  formatSpanToXRay,
  buildOTLPExportPayload,
  convertToXRayTraceId,
  createJaegerExporter,
  createXRayExporter,
  createBatchingExporter,
  HttpExportError,
} from './exporters.js';

export {
  type Span,
  type SpanOptions,
  type SpanStatus,
  type Tracer,
  type TracerConfig,
  createTracer,
  generateTraceId,
  generateSpanId,
} from './tracer.js';

export {
  type SamplerConfig,
  type SamplingDecision,
  type TraceSampler,
  createTraceSampler,
  traceIdToSamplingScore,
} from './sampler.js';

export {
  type DbSpanOptions,
  type HttpSpanOptions,
  type OperationSpanOptions,
  withDbSpan,
  withHttpSpan,
  withOperationSpan,
} from './spanHelpers.js';
