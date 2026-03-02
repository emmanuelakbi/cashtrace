/**
 * StorageService — S3-compatible storage operations for document processing.
 * Supports AWS S3, Cloudflare R2, and MinIO via configurable endpoint.
 *
 * Requirements: 8.1 (S3-compatible storage), 8.6 (server-side encryption)
 */

import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
  type CompletedPart,
  type S3ClientConfig,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { DocumentType, StorageServiceConfig, UploadResult } from './types.js';

/** Size of each part in a multipart upload: 5MB */
const MULTIPART_PART_SIZE = 5_242_880;

/** Presigned URL expiration time in seconds: 15 minutes (Requirements 8.3) */
export const PRESIGNED_URL_EXPIRY = 900;

// ─── S3 Key Generation ───────────────────────────────────────────────────────

/**
 * Sanitize a filename for use in S3 keys.
 * Removes unsafe characters, preserves extension, and lowercases.
 */
export function sanitizeFilename(filename: string): string {
  const trimmed = filename.trim();
  const dotIndex = trimmed.lastIndexOf('.');
  const name = dotIndex > 0 ? trimmed.slice(0, dotIndex) : trimmed;
  const ext = dotIndex > 0 ? trimmed.slice(dotIndex) : '';

  const sanitized = name
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');

  const safeName = sanitized || 'file';
  const safeExt = ext.toLowerCase().replace(/[^a-z0-9.]/g, '');

  return `${safeName}${safeExt}`;
}

/**
 * Generate an S3 key following the design structure:
 * documents/{businessId}/{documentType}/{year}/{month}/{documentId}_{sanitizedFilename}
 */
export function generateS3Key(
  businessId: string,
  documentType: DocumentType,
  documentId: string,
  filename: string,
): string {
  const now = new Date();
  const year = now.getUTCFullYear().toString();
  const month = (now.getUTCMonth() + 1).toString().padStart(2, '0');
  const sanitized = sanitizeFilename(filename);

  return `documents/${businessId}/${documentType}/${year}/${month}/${documentId}_${sanitized}`;
}

// ─── Default Configuration ───────────────────────────────────────────────────

function loadConfigFromEnv(): StorageServiceConfig {
  return {
    bucket: process.env['S3_BUCKET'] ?? 'cashtrace-documents',
    region: process.env['S3_REGION'] ?? 'us-east-1',
    endpoint: process.env['S3_ENDPOINT'] || undefined,
    accessKeyId: process.env['S3_ACCESS_KEY_ID'] || undefined,
    secretAccessKey: process.env['S3_SECRET_ACCESS_KEY'] || undefined,
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] === 'true',
    encryption: 'AES256',
  };
}

function buildS3ClientConfig(config: StorageServiceConfig): S3ClientConfig {
  const s3Config: S3ClientConfig = {
    region: config.region,
    forcePathStyle: config.forcePathStyle ?? false,
  };

  if (config.endpoint) {
    s3Config.endpoint = config.endpoint;
  }

  if (config.accessKeyId && config.secretAccessKey) {
    s3Config.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }

  return s3Config;
}

// ─── StorageService Class ────────────────────────────────────────────────────

export class StorageService {
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly encryption: 'AES256' | 'aws:kms';

  constructor(config: StorageServiceConfig) {
    this.client = new S3Client(buildS3ClientConfig(config));
    this.bucket = config.bucket;
    this.encryption = config.encryption ?? 'AES256';
  }

  get s3Client(): S3Client {
    return this.client;
  }

  get bucketName(): string {
    return this.bucket;
  }

  get serverSideEncryption(): string {
    return this.encryption;
  }

  async uploadFile(buffer: Buffer, key: string, contentType: string): Promise<UploadResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      ServerSideEncryption: this.encryption,
    });

    const response = await this.client.send(command);

    return {
      key,
      bucket: this.bucket,
      etag: response.ETag?.replace(/"/g, '') ?? '',
      size: buffer.length,
    };
  }

  async uploadMultipart(buffer: Buffer, key: string, contentType: string): Promise<UploadResult> {
    const createCommand = new CreateMultipartUploadCommand({
      Bucket: this.bucket,
      Key: key,
      ContentType: contentType,
      ServerSideEncryption: this.encryption,
    });

    const { UploadId: uploadId } = await this.client.send(createCommand);

    if (!uploadId) {
      throw new Error('Failed to initiate multipart upload: no UploadId returned');
    }

    try {
      const parts: CompletedPart[] = [];
      const totalParts = Math.ceil(buffer.length / MULTIPART_PART_SIZE);

      for (let i = 0; i < totalParts; i++) {
        const start = i * MULTIPART_PART_SIZE;
        const end = Math.min(start + MULTIPART_PART_SIZE, buffer.length);
        const partNumber = i + 1;

        const uploadPartCommand = new UploadPartCommand({
          Bucket: this.bucket,
          Key: key,
          UploadId: uploadId,
          PartNumber: partNumber,
          Body: buffer.subarray(start, end),
        });

        const partResponse = await this.client.send(uploadPartCommand);

        parts.push({
          ETag: partResponse.ETag,
          PartNumber: partNumber,
        });
      }

      const completeCommand = new CompleteMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts },
      });

      const completeResponse = await this.client.send(completeCommand);

      return {
        key,
        bucket: this.bucket,
        etag: completeResponse.ETag?.replace(/"/g, '') ?? '',
        size: buffer.length,
      };
    } catch (error: unknown) {
      const abortCommand = new AbortMultipartUploadCommand({
        Bucket: this.bucket,
        Key: key,
        UploadId: uploadId,
      });

      await this.client.send(abortCommand).catch(() => {
        // Best-effort abort — swallow errors to surface the original failure
      });

      throw error;
    }
  }

  async getPresignedUrl(key: string, expiresIn: number): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    return getSignedUrl(this.client, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  async fileExists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch {
      return false;
    }
  }

  async getFile(key: string): Promise<Buffer> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    const response = await this.client.send(command);
    const stream = response.Body;

    if (!stream) {
      throw new Error(`Empty response body for key: ${key}`);
    }

    const chunks: Uint8Array[] = [];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for await (const chunk of stream as AsyncIterable<Uint8Array>) {
      chunks.push(chunk);
    }

    return Buffer.concat(chunks);
  }
}

// ─── Factory Function ────────────────────────────────────────────────────────

/**
 * Create a StorageService instance.
 * If no config is provided, loads from environment variables.
 */
export function createStorageService(config?: Partial<StorageServiceConfig>): StorageService {
  const envConfig = loadConfigFromEnv();
  const mergedConfig: StorageServiceConfig = {
    ...envConfig,
    ...config,
  };

  return new StorageService(mergedConfig);
}
