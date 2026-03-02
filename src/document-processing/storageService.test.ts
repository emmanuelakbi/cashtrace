import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { describe, expect, it, vi } from 'vitest';

import { createStorageService, generateS3Key, StorageService } from './storageService.js';

describe('generateS3Key', () => {
  it('should include businessId in the key path', () => {
    const key = generateS3Key('biz-123', 'RECEIPT_IMAGE', 'doc-456', 'receipt.jpg');
    expect(key).toContain('biz-123');
  });

  it('should include documentType in the key path', () => {
    const key = generateS3Key('biz-123', 'BANK_STATEMENT', 'doc-456', 'statement.pdf');
    expect(key).toContain('BANK_STATEMENT');
  });

  it('should include documentId in the key', () => {
    const key = generateS3Key('biz-123', 'POS_EXPORT', 'doc-789', 'export.csv');
    expect(key).toContain('doc-789');
  });

  it('should follow the design key structure', () => {
    const key = generateS3Key('biz-123', 'RECEIPT_IMAGE', 'doc-456', 'receipt.jpg');
    const pattern = /^documents\/biz-123\/RECEIPT_IMAGE\/\d{4}\/\d{2}\/doc-456_receipt\.jpg$/;
    expect(key).toMatch(pattern);
  });

  it('should sanitize unsafe characters in filenames', () => {
    const key = generateS3Key('biz-1', 'RECEIPT_IMAGE', 'doc-1', 'My Receipt (1).jpg');
    expect(key).not.toContain(' ');
    expect(key).not.toContain('(');
    expect(key).not.toContain(')');
    expect(key).toMatch(/documents\/biz-1\/RECEIPT_IMAGE\/\d{4}\/\d{2}\/doc-1_my_receipt_1\.jpg/);
  });

  it('should handle filenames with no extension', () => {
    const key = generateS3Key('biz-1', 'RECEIPT_IMAGE', 'doc-1', 'noext');
    expect(key).toMatch(/doc-1_noext$/);
  });

  it('should handle filenames that sanitize to empty string', () => {
    const key = generateS3Key('biz-1', 'RECEIPT_IMAGE', 'doc-1', '!!!.jpg');
    expect(key).toContain('doc-1_file.jpg');
  });

  it('should produce unique keys for different documentIds', () => {
    const key1 = generateS3Key('biz-1', 'RECEIPT_IMAGE', 'doc-1', 'receipt.jpg');
    const key2 = generateS3Key('biz-1', 'RECEIPT_IMAGE', 'doc-2', 'receipt.jpg');
    expect(key1).not.toBe(key2);
  });
});

describe('StorageService', () => {
  it('should be constructable with config', () => {
    const service = new StorageService({
      bucket: 'test-bucket',
      region: 'us-east-1',
      encryption: 'AES256',
    });

    expect(service.bucketName).toBe('test-bucket');
    expect(service.serverSideEncryption).toBe('AES256');
  });

  it('should default encryption to AES256', () => {
    const service = new StorageService({
      bucket: 'test-bucket',
      region: 'us-east-1',
    });

    expect(service.serverSideEncryption).toBe('AES256');
  });

  it('should support custom endpoint for R2/MinIO', () => {
    const service = new StorageService({
      bucket: 'test-bucket',
      region: 'auto',
      endpoint: 'https://my-minio.example.com:9000',
      forcePathStyle: true,
    });

    expect(service.bucketName).toBe('test-bucket');
    expect(service.s3Client).toBeDefined();
  });

  it('should expose the S3 client', () => {
    const service = new StorageService({
      bucket: 'test-bucket',
      region: 'us-east-1',
    });

    expect(service.s3Client).toBeDefined();
  });
});

describe('createStorageService', () => {
  it('should create a service with default env config', () => {
    const service = createStorageService();
    expect(service).toBeInstanceOf(StorageService);
    expect(service.bucketName).toBe('cashtrace-documents');
  });

  it('should allow partial config overrides', () => {
    const service = createStorageService({ bucket: 'custom-bucket' });
    expect(service.bucketName).toBe('custom-bucket');
  });

  it('should support R2 configuration', () => {
    const service = createStorageService({
      bucket: 'r2-bucket',
      region: 'auto',
      endpoint: 'https://account.r2.cloudflarestorage.com',
      forcePathStyle: true,
    });

    expect(service.bucketName).toBe('r2-bucket');
  });

  it('should support MinIO configuration', () => {
    const service = createStorageService({
      bucket: 'minio-bucket',
      region: 'us-east-1',
      endpoint: 'http://localhost:9000',
      accessKeyId: 'minioadmin',
      secretAccessKey: 'minioadmin',
      forcePathStyle: true,
    });

    expect(service.bucketName).toBe('minio-bucket');
  });
});

describe('StorageService.uploadMultipart', () => {
  function createServiceWithMockedClient(): {
    service: StorageService;
    sendMock: ReturnType<typeof vi.fn>;
  } {
    const service = new StorageService({
      bucket: 'test-bucket',
      region: 'us-east-1',
      encryption: 'AES256',
    });

    const sendMock = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (service as any).client.send = sendMock;

    return { service, sendMock };
  }

  it('should initiate, upload parts, and complete a multipart upload', async () => {
    const { service, sendMock } = createServiceWithMockedClient();

    // 6MB buffer → 2 parts (5MB + 1MB)
    const buffer = Buffer.alloc(6 * 1024 * 1024, 0xab);

    sendMock
      .mockResolvedValueOnce({ UploadId: 'upload-123' }) // CreateMultipartUpload
      .mockResolvedValueOnce({ ETag: '"etag-part-1"' }) // UploadPart 1
      .mockResolvedValueOnce({ ETag: '"etag-part-2"' }) // UploadPart 2
      .mockResolvedValueOnce({ ETag: '"etag-final"' }); // CompleteMultipartUpload

    const result = await service.uploadMultipart(buffer, 'test-key', 'application/pdf');

    expect(result).toEqual({
      key: 'test-key',
      bucket: 'test-bucket',
      etag: 'etag-final',
      size: buffer.length,
    });

    expect(sendMock).toHaveBeenCalledTimes(4);
    expect(sendMock.mock.calls[0][0]).toBeInstanceOf(CreateMultipartUploadCommand);
    expect(sendMock.mock.calls[1][0]).toBeInstanceOf(UploadPartCommand);
    expect(sendMock.mock.calls[2][0]).toBeInstanceOf(UploadPartCommand);
    expect(sendMock.mock.calls[3][0]).toBeInstanceOf(CompleteMultipartUploadCommand);
  });

  it('should split buffer into correct 5MB parts', async () => {
    const { service, sendMock } = createServiceWithMockedClient();

    // 11MB → 3 parts (5MB + 5MB + 1MB)
    const buffer = Buffer.alloc(11 * 1024 * 1024, 0xcd);

    sendMock
      .mockResolvedValueOnce({ UploadId: 'upload-456' })
      .mockResolvedValueOnce({ ETag: '"p1"' })
      .mockResolvedValueOnce({ ETag: '"p2"' })
      .mockResolvedValueOnce({ ETag: '"p3"' })
      .mockResolvedValueOnce({ ETag: '"final"' });

    await service.uploadMultipart(buffer, 'key', 'image/jpeg');

    // 1 create + 3 parts + 1 complete = 5 calls
    expect(sendMock).toHaveBeenCalledTimes(5);
  });

  it('should abort multipart upload on part upload failure', async () => {
    const { service, sendMock } = createServiceWithMockedClient();

    const buffer = Buffer.alloc(6 * 1024 * 1024, 0xef);

    sendMock
      .mockResolvedValueOnce({ UploadId: 'upload-789' }) // CreateMultipartUpload
      .mockRejectedValueOnce(new Error('Network error')); // UploadPart fails

    // AbortMultipartUpload should be called
    sendMock.mockResolvedValueOnce({});

    await expect(service.uploadMultipart(buffer, 'key', 'application/pdf')).rejects.toThrow(
      'Network error',
    );

    const abortCall = sendMock.mock.calls.find(
      (call) => call[0] instanceof AbortMultipartUploadCommand,
    );
    expect(abortCall).toBeDefined();
  });

  it('should throw if CreateMultipartUpload returns no UploadId', async () => {
    const { service, sendMock } = createServiceWithMockedClient();

    const buffer = Buffer.alloc(6 * 1024 * 1024);

    sendMock.mockResolvedValueOnce({ UploadId: undefined });

    await expect(service.uploadMultipart(buffer, 'key', 'application/pdf')).rejects.toThrow(
      'Failed to initiate multipart upload',
    );
  });

  it('should pass correct part numbers starting from 1', async () => {
    const { service, sendMock } = createServiceWithMockedClient();

    const buffer = Buffer.alloc(6 * 1024 * 1024);

    sendMock
      .mockResolvedValueOnce({ UploadId: 'upload-pn' })
      .mockResolvedValueOnce({ ETag: '"e1"' })
      .mockResolvedValueOnce({ ETag: '"e2"' })
      .mockResolvedValueOnce({ ETag: '"final"' });

    await service.uploadMultipart(buffer, 'key', 'image/png');

    const partCalls = sendMock.mock.calls.filter((call) => call[0] instanceof UploadPartCommand);

    expect(partCalls[0][0].input.PartNumber).toBe(1);
    expect(partCalls[1][0].input.PartNumber).toBe(2);
  });

  it('should include completed parts with ETags in CompleteMultipartUpload', async () => {
    const { service, sendMock } = createServiceWithMockedClient();

    const buffer = Buffer.alloc(6 * 1024 * 1024);

    sendMock
      .mockResolvedValueOnce({ UploadId: 'upload-etag' })
      .mockResolvedValueOnce({ ETag: '"etag-1"' })
      .mockResolvedValueOnce({ ETag: '"etag-2"' })
      .mockResolvedValueOnce({ ETag: '"complete-etag"' });

    await service.uploadMultipart(buffer, 'key', 'application/pdf');

    const completeCall = sendMock.mock.calls.find(
      (call) => call[0] instanceof CompleteMultipartUploadCommand,
    );

    expect(completeCall).toBeDefined();
    const parts = completeCall![0].input.MultipartUpload.Parts;
    expect(parts).toEqual([
      { ETag: '"etag-1"', PartNumber: 1 },
      { ETag: '"etag-2"', PartNumber: 2 },
    ]);
  });

  it('should still surface original error even if abort fails', async () => {
    const { service, sendMock } = createServiceWithMockedClient();

    const buffer = Buffer.alloc(6 * 1024 * 1024);

    sendMock
      .mockResolvedValueOnce({ UploadId: 'upload-abort-fail' })
      .mockRejectedValueOnce(new Error('Part upload failed'))
      .mockRejectedValueOnce(new Error('Abort also failed'));

    await expect(service.uploadMultipart(buffer, 'key', 'application/pdf')).rejects.toThrow(
      'Part upload failed',
    );
  });
});
