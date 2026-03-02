/**
 * Property-based tests for Image Preprocessing — Property 1: Image Preprocessing Bounds
 *
 * For any image buffer with dimensions exceeding 1024px in width or height,
 * after preprocessing, the resulting image SHALL have both dimensions ≤ 1024px
 * while maintaining aspect ratio.
 *
 * **Validates: Requirements 1.4**
 */
import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import sharp from 'sharp';

import { getMetadata, preprocess } from './image-processor.js';

/**
 * Helper: create a real image buffer with the given dimensions using sharp.
 */
async function createTestImage(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3, 128);
  return sharp(raw, { raw: { width, height, channels: 3 } })
    .jpeg()
    .toBuffer();
}

describe('Image Preprocessing Bounds (Property 1)', () => {
  /**
   * **Validates: Requirements 1.4**
   *
   * For any image with random dimensions (1–4096 px), after preprocessing
   * with default options (max 1024×1024), the output width and height
   * SHALL both be ≤ 1024px.
   */
  it('output dimensions are always ≤ 1024px (default max)', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        async (width, height) => {
          const img = await createTestImage(width, height);
          const result = await preprocess(img);
          const meta = await getMetadata(result);

          expect(meta.width).toBeLessThanOrEqual(1024);
          expect(meta.height).toBeLessThanOrEqual(1024);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * For any image with random dimensions (≥2px each to avoid degenerate
   * single-pixel rounding), after preprocessing the aspect ratio SHALL be
   * approximately preserved. We compare ratios using a relative tolerance
   * that accounts for integer pixel rounding.
   */
  it('aspect ratio is approximately preserved after preprocessing', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 2, max: 4096 }),
        fc.integer({ min: 2, max: 4096 }),
        async (width, height) => {
          const img = await createTestImage(width, height);
          const result = await preprocess(img);
          const meta = await getMetadata(result);

          const originalRatio = width / height;
          const resultRatio = meta.width / meta.height;

          // For extreme aspect ratios (e.g. 3074×2), one output dimension
          // may round to 1px, causing large absolute ratio differences.
          // Use a relative tolerance: ±1px rounding on each output dimension
          // means the relative error is bounded by 1/min(outW, outH).
          const minDim = Math.min(meta.width, meta.height);
          const relativeTolerance = minDim > 0 ? 1 / minDim : 1;

          const relDiff =
            Math.abs(originalRatio - resultRatio) / Math.max(originalRatio, resultRatio, 1);
          expect(relDiff).toBeLessThanOrEqual(relativeTolerance + 0.01);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * Images that are already smaller than the max dimensions SHALL NOT
   * be enlarged by preprocessing (withoutEnlargement behaviour).
   */
  it('images smaller than max dimensions are not enlarged', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 1024 }),
        fc.integer({ min: 1, max: 1024 }),
        async (width, height) => {
          const img = await createTestImage(width, height);
          const result = await preprocess(img);
          const meta = await getMetadata(result);

          expect(meta.width).toBeLessThanOrEqual(width);
          expect(meta.height).toBeLessThanOrEqual(height);
        },
      ),
      { numRuns: 100 },
    );
  });

  /**
   * **Validates: Requirements 1.4**
   *
   * For any custom maxWidth/maxHeight in [64, 2048], the output dimensions
   * SHALL respect the specified bounds.
   */
  it('output respects custom maxWidth and maxHeight bounds', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 1, max: 4096 }),
        fc.integer({ min: 64, max: 2048 }),
        fc.integer({ min: 64, max: 2048 }),
        async (width, height, maxWidth, maxHeight) => {
          const img = await createTestImage(width, height);
          const result = await preprocess(img, { maxWidth, maxHeight });
          const meta = await getMetadata(result);

          expect(meta.width).toBeLessThanOrEqual(maxWidth);
          expect(meta.height).toBeLessThanOrEqual(maxHeight);
        },
      ),
      { numRuns: 100 },
    );
  });
});
