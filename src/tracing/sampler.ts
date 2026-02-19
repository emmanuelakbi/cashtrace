/**
 * Trace Sampler
 *
 * Provides deterministic trace sampling based on trace ID.
 * The same trace ID always produces the same sampling decision,
 * ensuring all spans within a trace are consistently sampled or dropped.
 *
 * Requirements: 4.6 (sample traces at configurable rate, default: 10%)
 */

export interface SamplerConfig {
  /**
   * Sampling rate between 0.0 (sample nothing) and 1.0 (sample everything).
   * Default: 0.1 (10%).
   */
  samplingRate?: number;
}

export interface SamplingDecision {
  /** Whether this trace should be sampled (recorded and exported). */
  sampled: boolean;
  /** The sampling rate that was applied. */
  samplingRate: number;
}

export interface TraceSampler {
  /** Make a deterministic sampling decision for the given trace ID. */
  shouldSample(traceId: string): SamplingDecision;
  /** Get the current sampling rate. */
  getSamplingRate(): number;
  /** Update the sampling rate at runtime. */
  setSamplingRate(rate: number): void;
}

const DEFAULT_SAMPLING_RATE = 0.1;

/**
 * Clamp a value to the [0, 1] range.
 */
function clampRate(rate: number): number {
  if (!Number.isFinite(rate)) return DEFAULT_SAMPLING_RATE;
  return Math.max(0, Math.min(1, rate));
}

/**
 * Compute a deterministic hash of a trace ID, returning a value in [0, 1).
 *
 * Uses a simple FNV-1a-inspired hash over the hex characters of the trace ID.
 * This is fast, deterministic, and produces a uniform distribution.
 */
export function traceIdToSamplingScore(traceId: string): number {
  let hash = 0x811c9dc5; // FNV offset basis (32-bit)
  for (let i = 0; i < traceId.length; i++) {
    hash ^= traceId.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime (32-bit)
  }
  // Convert to unsigned 32-bit and normalize to [0, 1)
  return (hash >>> 0) / 0x100000000;
}

/**
 * Create a TraceSampler with the given configuration.
 *
 * The sampler uses a deterministic hash of the trace ID to decide whether
 * to sample. This ensures:
 * - The same trace ID always gets the same decision (Property 8: Sampling Consistency)
 * - All spans in a trace share the same sampling decision
 * - The sampling rate is statistically respected across many traces
 */
export function createTraceSampler(config?: SamplerConfig): TraceSampler {
  let samplingRate = clampRate(config?.samplingRate ?? DEFAULT_SAMPLING_RATE);

  function shouldSample(traceId: string): SamplingDecision {
    // Rate 0 → never sample, rate 1 → always sample (fast paths)
    if (samplingRate === 0) return { sampled: false, samplingRate };
    if (samplingRate === 1) return { sampled: true, samplingRate };

    const score = traceIdToSamplingScore(traceId);
    return {
      sampled: score < samplingRate,
      samplingRate,
    };
  }

  function getSamplingRate(): number {
    return samplingRate;
  }

  function setSamplingRate(rate: number): void {
    samplingRate = clampRate(rate);
  }

  return { shouldSample, getSamplingRate, setSamplingRate };
}
