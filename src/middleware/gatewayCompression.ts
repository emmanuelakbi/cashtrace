/**
 * Compression middleware for the API Gateway.
 *
 * Supports gzip and Brotli compression using Node.js built-in `zlib`.
 * Responses larger than the configured threshold are compressed on the fly.
 * Already-compressed content types (images, PDFs, etc.) are skipped.
 *
 * @module middleware/gatewayCompression
 * @see Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6
 */

import type { Request, Response, NextFunction } from 'express';
import { createGzip, createBrotliCompress, constants as zlibConstants } from 'zlib';
import type { Transform } from 'stream';

// ─── Types ───────────────────────────────────────────────────────────────────

/** Configuration for the compression middleware. */
export interface CompressionConfig {
  /** Minimum response size in bytes to trigger compression. */
  threshold: number;
  /** Compression level (1–9 for gzip, 0–11 for Brotli). */
  level: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Default compression threshold: 1 KB. */
const DEFAULT_THRESHOLD = 1024;

/** Default compression level (6 = balanced speed/ratio for gzip). */
const DEFAULT_LEVEL = 6;

/**
 * Content-type prefixes/values that should NOT be compressed because
 * they are already in a compressed or binary format.
 *
 * @see Requirement 11.5
 */
export const SKIP_CONTENT_TYPES: ReadonlySet<string> = new Set([
  'image/',
  'application/pdf',
  'application/zip',
  'application/gzip',
  'audio/',
  'video/',
]);

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Returns `true` when the content-type should skip compression. */
function shouldSkipContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;
  const lower = contentType.toLowerCase();
  for (const entry of SKIP_CONTENT_TYPES) {
    if (entry.endsWith('/') ? lower.startsWith(entry) : lower.startsWith(entry)) {
      return true;
    }
  }
  return false;
}

/** Determine the best encoding from the Accept-Encoding header. */
function selectEncoding(acceptEncoding: string | undefined): 'br' | 'gzip' | null {
  if (!acceptEncoding) return null;
  const lower = acceptEncoding.toLowerCase();
  // Prefer Brotli over gzip when both are accepted
  if (lower.includes('br')) return 'br';
  if (lower.includes('gzip')) return 'gzip';
  return null;
}

// ─── Factory ─────────────────────────────────────────────────────────────────

/**
 * Create compression middleware.
 *
 * - Inspects `Accept-Encoding` to choose Brotli or gzip.
 * - Buffers the response body; compresses only when it exceeds `threshold`.
 * - Skips already-compressed content types (images, PDFs, etc.).
 * - Sets `Content-Encoding` and removes `Content-Length` when compressing.
 */
export function createCompressionMiddleware(
  config?: Partial<CompressionConfig>,
): (req: Request, res: Response, next: NextFunction) => void {
  const threshold = config?.threshold ?? DEFAULT_THRESHOLD;
  const level = config?.level ?? DEFAULT_LEVEL;

  return (req: Request, res: Response, next: NextFunction): void => {
    const acceptEncoding = req.headers['accept-encoding'] as string | undefined;
    const encoding = selectEncoding(acceptEncoding);

    // No supported encoding → skip
    if (!encoding) {
      next();
      return;
    }

    // Intercept write/end to buffer and conditionally compress
    const originalWrite = res.write.bind(res) as Response['write'];
    const originalEnd = res.end.bind(res) as Response['end'];
    const chunks: Buffer[] = [];

    // Override write to buffer chunks
    res.write = function (
      chunk: unknown,
      encodingOrCb?: BufferEncoding | ((error: Error | null | undefined) => void),
      cb?: (error: Error | null | undefined) => void,
    ): boolean {
      if (chunk !== undefined && chunk !== null) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8');
        chunks.push(buf);
      }
      if (typeof encodingOrCb === 'function') {
        encodingOrCb(null);
      } else if (cb) {
        cb(null);
      }
      return true;
    } as unknown as Response['write'];

    // Override end to flush buffered data
    res.end = function (
      chunk?: unknown,
      encodingOrCb?: BufferEncoding | (() => void),
      cb?: () => void,
    ): Response {
      if (chunk !== undefined && chunk !== null) {
        const buf = Buffer.isBuffer(chunk)
          ? chunk
          : Buffer.from(chunk as string, typeof encodingOrCb === 'string' ? encodingOrCb : 'utf8');
        chunks.push(buf);
      }

      const body = Buffer.concat(chunks);
      const contentType = res.getHeader('content-type') as string | undefined;

      // Skip compression for already-compressed content types (Req 11.5)
      if (shouldSkipContentType(contentType) || body.length < threshold) {
        // Restore original Content-Length and send uncompressed
        res.setHeader('Content-Length', body.length);
        originalEnd.call(res, body);
        return res;
      }

      // Compress
      const stream: Transform =
        encoding === 'br'
          ? createBrotliCompress({
              params: { [zlibConstants.BROTLI_PARAM_QUALITY]: level },
            })
          : createGzip({ level });

      const compressed: Buffer[] = [];
      stream.on('data', (data: Buffer) => compressed.push(data));
      stream.on('end', () => {
        const result = Buffer.concat(compressed);
        res.setHeader('Content-Encoding', encoding);
        res.removeHeader('Content-Length');
        originalEnd.call(res, result);
      });

      stream.end(body);
      return res;
    } as unknown as Response['end'];

    next();
  };
}
