// Gemini Integration - Image preprocessing utility
// Validates: Requirements 1.4
// Property 1: Image Preprocessing Bounds

import sharp from 'sharp';

/**
 * Options for image preprocessing.
 */
export interface ImageOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png';
}

/**
 * Metadata extracted from an image buffer.
 */
export interface ImageMetadata {
  width: number;
  height: number;
  format: string;
  sizeBytes: number;
}

/**
 * Result of validating an image buffer's format via magic bytes.
 */
export interface ImageFormatResult {
  valid: boolean;
  format: string | null;
  mimeType: string | null;
}

// Magic byte signatures
const JPEG_MAGIC = [0xff, 0xd8, 0xff] as const;
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47] as const;
/**
 * Validates an image buffer's format using magic byte detection.
 *
 * Checks for JPEG (0xFF 0xD8 0xFF) and PNG (0x89 0x50 0x4E 0x47) signatures.
 *
 * @param buffer - The image buffer to validate
 * @returns ImageFormatResult with validity, detected format, and MIME type
 */
export function validateFormat(buffer: Buffer): ImageFormatResult {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    return { valid: false, format: null, mimeType: null };
  }

  if (buffer[0] === JPEG_MAGIC[0] && buffer[1] === JPEG_MAGIC[1] && buffer[2] === JPEG_MAGIC[2]) {
    return { valid: true, format: 'jpeg', mimeType: 'image/jpeg' };
  }

  if (
    buffer[0] === PNG_MAGIC[0] &&
    buffer[1] === PNG_MAGIC[1] &&
    buffer[2] === PNG_MAGIC[2] &&
    buffer[3] === PNG_MAGIC[3]
  ) {
    return { valid: true, format: 'png', mimeType: 'image/png' };
  }

  return { valid: false, format: null, mimeType: null };
}

/**
 * Retrieves metadata from an image buffer using sharp.
 *
 * @param buffer - The image buffer to inspect
 * @returns Promise resolving to ImageMetadata with dimensions, format, and size
 */
export async function getMetadata(buffer: Buffer): Promise<ImageMetadata> {
  const meta = await sharp(buffer).metadata();

  return {
    width: meta.width ?? 0,
    height: meta.height ?? 0,
    format: meta.format ?? 'unknown',
    sizeBytes: buffer.length,
  };
}

/**
 * Preprocesses an image for Gemini API consumption.
 *
 * Resizes to fit within maxWidth × maxHeight (default 1024×1024) while
 * maintaining aspect ratio, then compresses to the target format (default JPEG
 * at quality 80) to reduce token usage.
 *
 * @param buffer - The raw image buffer
 * @param options - Optional preprocessing parameters
 * @returns Promise resolving to the processed image buffer
 */
export async function preprocess(buffer: Buffer, options?: ImageOptions): Promise<Buffer> {
  const maxWidth = options?.maxWidth ?? 1024;
  const maxHeight = options?.maxHeight ?? 1024;
  const quality = options?.quality ?? 80;
  const format = options?.format ?? 'jpeg';

  let pipeline = sharp(buffer).resize({
    width: maxWidth,
    height: maxHeight,
    fit: 'inside',
    withoutEnlargement: true,
  });

  if (format === 'png') {
    pipeline = pipeline.png({ quality });
  } else {
    pipeline = pipeline.jpeg({ quality });
  }

  return pipeline.toBuffer();
}
