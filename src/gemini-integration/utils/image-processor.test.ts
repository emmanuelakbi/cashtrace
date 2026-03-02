// Gemini Integration - ImageProcessor unit tests
// Validates: Requirements 1.4

import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { getMetadata, preprocess, validateFormat } from './image-processor.js';

// --- Helpers ---

async function createTestImage(
  width: number,
  height: number,
  format: 'jpeg' | 'png' = 'jpeg',
): Promise<Buffer> {
  const channels = format === 'png' ? 4 : 3;
  const raw = Buffer.alloc(width * height * channels, 128);
  let pipeline = sharp(raw, {
    raw: { width, height, channels },
  });
  if (format === 'png') {
    pipeline = pipeline.png();
  } else {
    pipeline = pipeline.jpeg();
  }
  return pipeline.toBuffer();
}

// JPEG magic bytes: 0xFF 0xD8 0xFF
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
// PNG magic bytes: 0x89 0x50 0x4E 0x47
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
// --- validateFormat ---

describe('validateFormat', () => {
  it('should detect JPEG format from magic bytes', () => {
    const result = validateFormat(JPEG_HEADER);
    expect(result).toEqual({ valid: true, format: 'jpeg', mimeType: 'image/jpeg' });
  });

  it('should detect PNG format from magic bytes', () => {
    const result = validateFormat(PNG_HEADER);
    expect(result).toEqual({ valid: true, format: 'png', mimeType: 'image/png' });
  });

  it('should reject an empty buffer', () => {
    const result = validateFormat(Buffer.alloc(0));
    expect(result).toEqual({ valid: false, format: null, mimeType: null });
  });

  it('should reject a buffer shorter than 4 bytes', () => {
    const result = validateFormat(Buffer.from([0xff, 0xd8]));
    expect(result).toEqual({ valid: false, format: null, mimeType: null });
  });

  it('should reject an unrecognised format', () => {
    const gif = Buffer.from([0x47, 0x49, 0x46, 0x38]); // GIF87a header
    const result = validateFormat(gif);
    expect(result).toEqual({ valid: false, format: null, mimeType: null });
  });

  it('should detect format from a real JPEG buffer', async () => {
    const img = await createTestImage(100, 100, 'jpeg');
    const result = validateFormat(img);
    expect(result.valid).toBe(true);
    expect(result.format).toBe('jpeg');
  });

  it('should detect format from a real PNG buffer', async () => {
    const img = await createTestImage(100, 100, 'png');
    const result = validateFormat(img);
    expect(result.valid).toBe(true);
    expect(result.format).toBe('png');
  });
});

// --- getMetadata ---

describe('getMetadata', () => {
  it('should return correct dimensions for a JPEG image', async () => {
    const img = await createTestImage(640, 480, 'jpeg');
    const meta = await getMetadata(img);
    expect(meta.width).toBe(640);
    expect(meta.height).toBe(480);
    expect(meta.format).toBe('jpeg');
    expect(meta.sizeBytes).toBe(img.length);
  });

  it('should return correct dimensions for a PNG image', async () => {
    const img = await createTestImage(320, 240, 'png');
    const meta = await getMetadata(img);
    expect(meta.width).toBe(320);
    expect(meta.height).toBe(240);
    expect(meta.format).toBe('png');
  });
});

// --- preprocess ---

describe('preprocess', () => {
  it('should resize a large image to fit within 1024px defaults', async () => {
    const img = await createTestImage(2048, 1536, 'jpeg');
    const result = await preprocess(img);
    const meta = await getMetadata(result);
    expect(meta.width).toBeLessThanOrEqual(1024);
    expect(meta.height).toBeLessThanOrEqual(1024);
  });

  it('should maintain aspect ratio when resizing', async () => {
    const img = await createTestImage(2000, 1000, 'jpeg');
    const result = await preprocess(img);
    const meta = await getMetadata(result);
    // 2000x1000 → 1024x512 (2:1 ratio preserved)
    expect(meta.width).toBe(1024);
    expect(meta.height).toBe(512);
  });

  it('should not enlarge images smaller than max dimensions', async () => {
    const img = await createTestImage(200, 150, 'jpeg');
    const result = await preprocess(img);
    const meta = await getMetadata(result);
    expect(meta.width).toBe(200);
    expect(meta.height).toBe(150);
  });

  it('should output JPEG by default', async () => {
    const img = await createTestImage(100, 100, 'png');
    const result = await preprocess(img);
    const formatResult = validateFormat(result);
    expect(formatResult.format).toBe('jpeg');
  });

  it('should output PNG when requested', async () => {
    const img = await createTestImage(100, 100, 'jpeg');
    const result = await preprocess(img, { format: 'png' });
    const formatResult = validateFormat(result);
    expect(formatResult.format).toBe('png');
  });

  it('should respect custom maxWidth and maxHeight', async () => {
    const img = await createTestImage(800, 600, 'jpeg');
    const result = await preprocess(img, { maxWidth: 400, maxHeight: 400 });
    const meta = await getMetadata(result);
    expect(meta.width).toBeLessThanOrEqual(400);
    expect(meta.height).toBeLessThanOrEqual(400);
  });

  it('should handle a tall portrait image correctly', async () => {
    const img = await createTestImage(500, 2000, 'jpeg');
    const result = await preprocess(img);
    const meta = await getMetadata(result);
    // 500x2000 → 256x1024 (1:4 ratio preserved, constrained by height)
    expect(meta.width).toBeLessThanOrEqual(1024);
    expect(meta.height).toBeLessThanOrEqual(1024);
    expect(meta.height).toBe(1024);
    expect(meta.width).toBe(256);
  });

  it('should compress the output (result smaller than uncompressed)', async () => {
    const img = await createTestImage(1024, 1024, 'png');
    const result = await preprocess(img, { quality: 50 });
    // JPEG at quality 50 should be smaller than the PNG source
    expect(result.length).toBeLessThan(img.length);
  });
});
