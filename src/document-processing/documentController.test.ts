import { describe, expect, it, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';

import {
  createDocumentRouter,
  getDocumentTypeDisplay,
  getFileSizeDisplay,
  getHttpStatusForDocError,
  getStatusDisplay,
  toDocumentPublic,
} from './documentController.js';
import type { AuthenticatedRequest, DocumentRouterDeps } from './documentController.js';
import { DocumentError, DocumentService } from './documentService.js';
import type { StorageService } from './storageService.js';
import type { UploadService } from './uploadService.js';
import type { Document, PaginatedDocuments, UploadedFile } from './types.js';

vi.mock('./idempotencyService.js', () => ({
  generateIdempotencyKey: vi.fn().mockReturnValue('mock-idempotency-key'),
  setIdempotencyKey: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('./processingQueue.js', () => ({
  createDocumentProcessingQueue: vi.fn().mockReturnValue({}),
  addDocumentProcessingJob: vi.fn().mockResolvedValue('job-id'),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeDocument(overrides: Partial<Document> = {}): Document {
  return {
    id: 'doc-uuid-1',
    businessId: 'biz-1',
    userId: 'user-1',
    filename: 'receipt.jpg',
    originalFilename: 'receipt.jpg',
    documentType: 'RECEIPT_IMAGE',
    mimeType: 'image/jpeg',
    fileSize: 2048,
    s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-uuid-1_receipt.jpg',
    s3Bucket: 'test-bucket',
    status: 'UPLOADED',
    processingStartedAt: null,
    processingCompletedAt: null,
    processingDurationMs: null,
    transactionsExtracted: null,
    processingWarnings: [],
    processingErrors: [],
    idempotencyKey: null,
    uploadedAt: new Date('2024-01-15T10:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  };
}

function makeFile(overrides: Partial<UploadedFile> = {}): UploadedFile {
  return {
    buffer: Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Array(100).fill(0)]),
    originalname: 'receipt.jpg',
    mimetype: 'image/jpeg',
    size: 104,
    ...overrides,
  };
}

function makeUploadService(overrides: Partial<UploadService> = {}): UploadService {
  return {
    uploadFile: vi.fn().mockResolvedValue(makeDocument()),
    uploadBatch: vi.fn().mockResolvedValue([makeDocument()]),
    ...overrides,
  } as unknown as UploadService;
}

function makePaginatedResult(
  docs: Document[] = [makeDocument()],
  overrides: Partial<PaginatedDocuments> = {},
): PaginatedDocuments {
  return {
    documents: docs,
    total: docs.length,
    page: 1,
    pageSize: 20,
    totalPages: 1,
    ...overrides,
  };
}

function makeDocumentService(overrides: Partial<DocumentService> = {}): DocumentService {
  const svc = new DocumentService();
  svc.listDocuments = vi.fn().mockResolvedValue(makePaginatedResult());
  Object.assign(svc, overrides);
  return svc;
}

function makeStorageService(
  overrides: Partial<Record<keyof StorageService, unknown>> = {},
): StorageService {
  return {
    deleteFile: vi.fn().mockResolvedValue(undefined),
    uploadFile: vi.fn(),
    uploadMultipart: vi.fn(),
    getPresignedUrl: vi.fn(),
    fileExists: vi.fn(),
    getFile: vi.fn(),
    ...overrides,
  } as unknown as StorageService;
}

function makeDeps(overrides: Partial<DocumentRouterDeps> = {}): DocumentRouterDeps {
  return {
    uploadService: makeUploadService(),
    documentService: makeDocumentService(),
    storageService: makeStorageService(),
    ...overrides,
  };
}

interface MockResponse {
  status: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  headersSent: boolean;
}

function makeRes(): MockResponse {
  const res: MockResponse = {
    status: vi.fn(),
    json: vi.fn(),
    headersSent: false,
  };
  res.status.mockReturnValue(res);
  res.json.mockReturnValue(res);
  return res;
}

function makeReq(overrides: Partial<AuthenticatedRequest> = {}): AuthenticatedRequest {
  return {
    userId: 'user-1',
    businessId: 'biz-1',
    files: [makeFile()],
    headers: { 'x-request-id': 'req-123' },
    ...overrides,
  } as unknown as AuthenticatedRequest;
}

/**
 * Extract the route handler for POST /upload from the router.
 * Express Router stores layers internally; we find the one matching our path.
 */
function getUploadHandler(
  deps: DocumentRouterDeps,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const router = createDocumentRouter(deps);
  const layer = router.stack.find((l) => l.route?.path === '/upload' && l.route?.methods?.post);
  if (!layer) throw new Error('POST /upload route not found');
  const handler = layer.route.stack[0]?.handle;
  if (!handler) throw new Error('Handler not found');
  return handler as (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

/**
 * Extract the route handler for GET / from the router.
 */
function getListHandler(
  deps: DocumentRouterDeps,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const router = createDocumentRouter(deps);
  const layer = router.stack.find((l) => l.route?.path === '/' && l.route?.methods?.get);
  if (!layer) throw new Error('GET / route not found');
  const handler = layer.route.stack[0]?.handle;
  if (!handler) throw new Error('Handler not found');
  return handler as (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

/**
 * Extract the route handler for GET /:id from the router.
 */
function getDetailHandler(
  deps: DocumentRouterDeps,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const router = createDocumentRouter(deps);
  const layer = router.stack.find((l) => l.route?.path === '/:id' && l.route?.methods?.get);
  if (!layer) throw new Error('GET /:id route not found');
  const handler = layer.route.stack[0]?.handle;
  if (!handler) throw new Error('Handler not found');
  return handler as (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

/**
 * Extract the route handler for POST /:id/retry from the router.
 */
function getRetryHandler(
  deps: DocumentRouterDeps,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const router = createDocumentRouter(deps);
  const layer = router.stack.find((l) => l.route?.path === '/:id/retry' && l.route?.methods?.post);
  if (!layer) throw new Error('POST /:id/retry route not found');
  const handler = layer.route.stack[0]?.handle;
  if (!handler) throw new Error('Handler not found');
  return handler as (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

/**
 * Extract the route handler for DELETE /:id from the router.
 */
function getDeleteHandler(
  deps: DocumentRouterDeps,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const router = createDocumentRouter(deps);
  const layer = router.stack.find((l) => l.route?.path === '/:id' && l.route?.methods?.delete);
  if (!layer) throw new Error('DELETE /:id route not found');
  const handler = layer.route.stack[0]?.handle;
  if (!handler) throw new Error('Handler not found');
  return handler as (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

/**
 * Extract the route handler for GET /:id/download from the router.
 */
function getDownloadHandler(
  deps: DocumentRouterDeps,
): (req: Request, res: Response, next: NextFunction) => Promise<void> {
  const router = createDocumentRouter(deps);
  const layer = router.stack.find(
    (l) => l.route?.path === '/:id/download' && l.route?.methods?.get,
  );
  if (!layer) throw new Error('GET /:id/download route not found');
  const handler = layer.route.stack[0]?.handle;
  if (!handler) throw new Error('Handler not found');
  return handler as (req: Request, res: Response, next: NextFunction) => Promise<void>;
}

// ─── Display Helper Tests ────────────────────────────────────────────────────

describe('Display helpers', () => {
  describe('getDocumentTypeDisplay', () => {
    it('should return human-readable type names', () => {
      expect(getDocumentTypeDisplay('RECEIPT_IMAGE')).toBe('Receipt Image');
      expect(getDocumentTypeDisplay('BANK_STATEMENT')).toBe('Bank Statement');
      expect(getDocumentTypeDisplay('POS_EXPORT')).toBe('POS Export');
    });
  });

  describe('getFileSizeDisplay', () => {
    it('should format bytes', () => {
      expect(getFileSizeDisplay(500)).toBe('500 B');
    });

    it('should format kilobytes', () => {
      expect(getFileSizeDisplay(2048)).toBe('2.0 KB');
    });

    it('should format megabytes', () => {
      expect(getFileSizeDisplay(2_621_440)).toBe('2.5 MB');
    });
  });

  describe('getStatusDisplay', () => {
    it('should return human-readable status names', () => {
      expect(getStatusDisplay('UPLOADED')).toBe('Uploaded');
      expect(getStatusDisplay('PROCESSING')).toBe('Processing');
      expect(getStatusDisplay('PARSED')).toBe('Parsed');
      expect(getStatusDisplay('PARTIAL')).toBe('Partially Parsed');
      expect(getStatusDisplay('ERROR')).toBe('Error');
    });
  });

  describe('getHttpStatusForDocError', () => {
    it('should map known error codes to HTTP statuses', () => {
      expect(getHttpStatusForDocError('DOC_INVALID_FILE_TYPE')).toBe(400);
      expect(getHttpStatusForDocError('DOC_FILE_TOO_LARGE')).toBe(413);
      expect(getHttpStatusForDocError('DOC_BATCH_TOO_LARGE')).toBe(413);
      expect(getHttpStatusForDocError('DOC_NOT_FOUND')).toBe(404);
      expect(getHttpStatusForDocError('DOC_FORBIDDEN')).toBe(403);
      expect(getHttpStatusForDocError('DOC_UPLOAD_FAILED')).toBe(500);
    });

    it('should default to 500 for unknown codes', () => {
      expect(getHttpStatusForDocError('UNKNOWN_CODE')).toBe(500);
    });
  });
});

describe('toDocumentPublic', () => {
  it('should map Document to DocumentPublic with display fields', () => {
    const doc = makeDocument();
    const result = toDocumentPublic(doc);

    expect(result.id).toBe('doc-uuid-1');
    expect(result.filename).toBe('receipt.jpg');
    expect(result.documentType).toBe('RECEIPT_IMAGE');
    expect(result.documentTypeDisplay).toBe('Receipt Image');
    expect(result.fileSizeDisplay).toBe('2.0 KB');
    expect(result.status).toBe('UPLOADED');
    expect(result.statusDisplay).toBe('Uploaded');
    expect(result.uploadedAt).toBe('2024-01-15T10:00:00.000Z');
    expect(result.updatedAt).toBe('2024-01-15T10:00:00.000Z');
  });
});

// ─── Upload Endpoint Tests ───────────────────────────────────────────────────

describe('POST /upload', () => {
  it('should return 201 with documents on successful single file upload', async () => {
    const uploadService = makeUploadService();
    const deps = makeDeps({ uploadService });
    const handler = getUploadHandler(deps);
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        requestId: 'req-123',
        documents: expect.arrayContaining([
          expect.objectContaining({
            id: 'doc-uuid-1',
            documentTypeDisplay: 'Receipt Image',
            statusDisplay: 'Uploaded',
          }),
        ]),
      }),
    );
    expect(uploadService.uploadFile).toHaveBeenCalledWith(expect.anything(), 'user-1', 'biz-1');
  });

  it('should call uploadBatch for multiple files', async () => {
    const docs = [makeDocument({ id: 'doc-1' }), makeDocument({ id: 'doc-2' })];
    const uploadService = makeUploadService({
      uploadBatch: vi.fn().mockResolvedValue(docs),
    } as unknown as Partial<UploadService>);
    const deps = makeDeps({ uploadService });
    const handler = getUploadHandler(deps);
    const req = makeReq({ files: [makeFile(), makeFile()] });
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(201);
    expect(uploadService.uploadBatch).toHaveBeenCalled();
    const body = res.json.mock.calls[0]?.[0];
    expect(body.documents).toHaveLength(2);
  });

  it('should return 400 when no files are provided', async () => {
    const handler = getUploadHandler(makeDeps());
    const req = makeReq({ files: [] });
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'VALIDATION_ERROR',
        }),
        requestId: 'req-123',
      }),
    );
  });

  it('should return 400 when files is undefined', async () => {
    const handler = getUploadHandler(makeDeps());
    const req = makeReq({ files: undefined });
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
  });

  it('should return 400 for invalid file type (DocumentError)', async () => {
    const uploadService = makeUploadService({
      uploadFile: vi
        .fn()
        .mockRejectedValue(new DocumentError('DOC_INVALID_FILE_TYPE', 'Unsupported file type')),
    } as unknown as Partial<UploadService>);
    const handler = getUploadHandler(makeDeps({ uploadService }));
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_INVALID_FILE_TYPE',
          message: 'Unsupported file type',
        }),
      }),
    );
  });

  it('should return 413 for file too large (DocumentError)', async () => {
    const uploadService = makeUploadService({
      uploadFile: vi
        .fn()
        .mockRejectedValue(new DocumentError('DOC_FILE_TOO_LARGE', 'File exceeds 10MB limit')),
    } as unknown as Partial<UploadService>);
    const handler = getUploadHandler(makeDeps({ uploadService }));
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_FILE_TOO_LARGE',
        }),
      }),
    );
  });

  it('should return 413 for batch too large (DocumentError)', async () => {
    const uploadService = makeUploadService({
      uploadBatch: vi
        .fn()
        .mockRejectedValue(
          new DocumentError('DOC_BATCH_TOO_LARGE', 'Batch total size exceeds 50MB limit'),
        ),
    } as unknown as Partial<UploadService>);
    const handler = getUploadHandler(makeDeps({ uploadService }));
    const req = makeReq({ files: [makeFile(), makeFile(), makeFile()] });
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_BATCH_TOO_LARGE',
        }),
      }),
    );
  });

  it('should return 401 when userId is missing', async () => {
    const handler = getUploadHandler(makeDeps());
    const req = makeReq({ userId: undefined });
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
  });

  it('should call next for non-DocumentError exceptions', async () => {
    const uploadService = makeUploadService({
      uploadFile: vi.fn().mockRejectedValue(new Error('unexpected')),
    } as unknown as Partial<UploadService>);
    const handler = getUploadHandler(makeDeps({ uploadService }));
    const req = makeReq();
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── List Endpoint Tests ─────────────────────────────────────────────────────

describe('GET /', () => {
  it('should return 200 with documents and pagination', async () => {
    const docs = [makeDocument(), makeDocument({ id: 'doc-uuid-2', filename: 'statement.pdf' })];
    const documentService = makeDocumentService({
      listDocuments: vi.fn().mockResolvedValue(makePaginatedResult(docs, { total: 2 })),
    } as unknown as Partial<DocumentService>);
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({ query: {} } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0]?.[0];
    expect(body.success).toBe(true);
    expect(body.documents).toHaveLength(2);
    expect(body.pagination).toEqual({
      page: 1,
      pageSize: 20,
      total: 2,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    });
    expect(body.requestId).toBe('req-123');
  });

  it('should use default pagination (page=1, pageSize=20)', async () => {
    const documentService = makeDocumentService();
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({ query: {} } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(documentService.listDocuments).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        page: 1,
        pageSize: 20,
        sortBy: 'uploadedAt',
        sortOrder: 'desc',
      }),
    );
  });

  it('should accept custom pagination params', async () => {
    const documentService = makeDocumentService();
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({
      query: { page: '3', pageSize: '10' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(documentService.listDocuments).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        page: 3,
        pageSize: 10,
      }),
    );
  });

  it('should cap pageSize at 100', async () => {
    const documentService = makeDocumentService();
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({
      query: { pageSize: '500' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(documentService.listDocuments).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        pageSize: 100,
      }),
    );
  });

  it('should filter by status', async () => {
    const documentService = makeDocumentService();
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({
      query: { status: 'PARSED' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(documentService.listDocuments).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        status: 'PARSED',
      }),
    );
  });

  it('should filter by type', async () => {
    const documentService = makeDocumentService();
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({
      query: { type: 'RECEIPT_IMAGE' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(documentService.listDocuments).toHaveBeenCalledWith(
      'biz-1',
      expect.objectContaining({
        type: 'RECEIPT_IMAGE',
      }),
    );
  });

  it('should return 401 when businessId is missing', async () => {
    const handler = getListHandler(makeDeps());
    const req = makeReq({
      businessId: undefined,
      query: {},
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'Authentication required',
        }),
      }),
    );
  });

  it('should compute hasNext and hasPrevious correctly', async () => {
    const documentService = makeDocumentService({
      listDocuments: vi.fn().mockResolvedValue(
        makePaginatedResult([makeDocument()], {
          total: 50,
          page: 2,
          pageSize: 20,
          totalPages: 3,
        }),
      ),
    } as unknown as Partial<DocumentService>);
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({
      query: { page: '2' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    const body = res.json.mock.calls[0]?.[0];
    expect(body.pagination.hasNext).toBe(true);
    expect(body.pagination.hasPrevious).toBe(true);
  });

  it('should handle DocumentError from service', async () => {
    const documentService = makeDocumentService({
      listDocuments: vi.fn().mockRejectedValue(new DocumentError('DOC_FORBIDDEN', 'Access denied')),
    } as unknown as Partial<DocumentService>);
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({ query: {} } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_FORBIDDEN',
        }),
      }),
    );
  });

  it('should call next for non-DocumentError exceptions', async () => {
    const documentService = makeDocumentService({
      listDocuments: vi.fn().mockRejectedValue(new Error('db crash')),
    } as unknown as Partial<DocumentService>);
    const handler = getListHandler(makeDeps({ documentService }));
    const req = makeReq({ query: {} } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── Get Detail Endpoint Tests ───────────────────────────────────────────────

describe('GET /:id', () => {
  it('should return 200 with document details on success', async () => {
    const doc = makeDocument({ id: 'doc-detail-1', status: 'PARSED', transactionsExtracted: 5 });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(doc),
    } as unknown as Partial<DocumentService>);
    const deps = makeDeps({ documentService });
    const handler = getDetailHandler(deps);
    const req = makeReq({
      params: { id: 'doc-detail-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0]?.[0];
    expect(body.success).toBe(true);
    expect(body.document.id).toBe('doc-detail-1');
    expect(body.document.status).toBe('PARSED');
    expect(body.document.transactionsExtracted).toBe(5);
    expect(body.document.documentTypeDisplay).toBe('Receipt Image');
    expect(body.requestId).toBe('req-123');
    expect(documentService.getDocumentById).toHaveBeenCalledWith('doc-detail-1', 'biz-1');
  });

  it('should return 404 when document is not found', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(new DocumentError('DOC_NOT_FOUND', 'Document not found')),
    } as unknown as Partial<DocumentService>);
    const handler = getDetailHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'nonexistent-id' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_NOT_FOUND',
          message: 'Document not found',
        }),
      }),
    );
  });

  it('should return 403 when business does not own the document', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(
          new DocumentError('DOC_FORBIDDEN', 'You do not have permission to access this document'),
        ),
    } as unknown as Partial<DocumentService>);
    const handler = getDetailHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'other-biz-doc' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_FORBIDDEN',
        }),
      }),
    );
  });

  it('should return 401 when businessId is missing', async () => {
    const handler = getDetailHandler(makeDeps());
    const req = makeReq({
      businessId: undefined,
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'Authentication required',
        }),
      }),
    );
  });

  it('should call next for non-DocumentError exceptions', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockRejectedValue(new Error('unexpected db error')),
    } as unknown as Partial<DocumentService>);
    const handler = getDetailHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── Retry Endpoint Tests ────────────────────────────────────────────────────

describe('POST /:id/retry', () => {
  it('should return 200 with PROCESSING status on successful retry', async () => {
    const errorDoc = makeDocument({ id: 'doc-err-1', status: 'ERROR' });
    const updatedDoc = makeDocument({ id: 'doc-err-1', status: 'PROCESSING' });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(errorDoc),
      updateStatus: vi.fn().mockResolvedValue(updatedDoc),
    } as unknown as Partial<DocumentService>);
    const deps = makeDeps({ documentService });
    const handler = getRetryHandler(deps);
    const req = makeReq({
      params: { id: 'doc-err-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0]?.[0];
    expect(body.success).toBe(true);
    expect(body.document.id).toBe('doc-err-1');
    expect(body.document.status).toBe('PROCESSING');
    expect(body.document.statusDisplay).toBe('Processing');
    expect(body.requestId).toBe('req-123');
    expect(documentService.getDocumentById).toHaveBeenCalledWith('doc-err-1', 'biz-1');
    expect(documentService.updateStatus).toHaveBeenCalledWith('doc-err-1', 'PROCESSING');
  });

  it('should return 400 with DOC_RETRY_NOT_ALLOWED when document is not in ERROR status', async () => {
    const parsedDoc = makeDocument({ id: 'doc-parsed-1', status: 'PARSED' });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(parsedDoc),
    } as unknown as Partial<DocumentService>);
    const handler = getRetryHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'doc-parsed-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(400);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_RETRY_NOT_ALLOWED',
          message: 'Only documents with ERROR status can be retried',
        }),
        requestId: 'req-123',
      }),
    );
  });

  it('should return 404 when document is not found', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(new DocumentError('DOC_NOT_FOUND', 'Document not found')),
    } as unknown as Partial<DocumentService>);
    const handler = getRetryHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'nonexistent-id' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_NOT_FOUND',
        }),
      }),
    );
  });

  it('should return 403 when business does not own the document', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(
          new DocumentError('DOC_FORBIDDEN', 'You do not have permission to access this document'),
        ),
    } as unknown as Partial<DocumentService>);
    const handler = getRetryHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'other-biz-doc' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_FORBIDDEN',
        }),
      }),
    );
  });

  it('should return 401 when userId or businessId is missing', async () => {
    const handler = getRetryHandler(makeDeps());
    const req = makeReq({
      userId: undefined,
      businessId: undefined,
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'Authentication required',
        }),
      }),
    );
  });

  it('should call next for non-DocumentError exceptions', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockRejectedValue(new Error('unexpected db error')),
    } as unknown as Partial<DocumentService>);
    const handler = getRetryHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── Delete Endpoint Tests ───────────────────────────────────────────────────

describe('DELETE /:id', () => {
  it('should return 200 with success message on successful delete', async () => {
    const doc = makeDocument({
      id: 'doc-del-1',
      s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-del-1_receipt.jpg',
    });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(doc),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    } as unknown as Partial<DocumentService>);
    const storageService = makeStorageService();
    const deps = makeDeps({ documentService, storageService });
    const handler = getDeleteHandler(deps);
    const req = makeReq({
      params: { id: 'doc-del-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0]?.[0];
    expect(body.success).toBe(true);
    expect(body.message).toBe('Document deleted successfully');
    expect(body.requestId).toBe('req-123');
  });

  it('should call storageService.deleteFile with correct s3Key', async () => {
    const doc = makeDocument({
      id: 'doc-del-2',
      s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-del-2_receipt.jpg',
    });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(doc),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    } as unknown as Partial<DocumentService>);
    const storageService = makeStorageService();
    const deps = makeDeps({ documentService, storageService });
    const handler = getDeleteHandler(deps);
    const req = makeReq({
      params: { id: 'doc-del-2' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(storageService.deleteFile).toHaveBeenCalledWith(
      'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-del-2_receipt.jpg',
    );
  });

  it('should call documentService.deleteDocument with correct args', async () => {
    const doc = makeDocument({ id: 'doc-del-3' });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(doc),
      deleteDocument: vi.fn().mockResolvedValue(undefined),
    } as unknown as Partial<DocumentService>);
    const deps = makeDeps({ documentService });
    const handler = getDeleteHandler(deps);
    const req = makeReq({
      params: { id: 'doc-del-3' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(documentService.deleteDocument).toHaveBeenCalledWith('doc-del-3', 'biz-1');
  });

  it('should return 404 when document is not found', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(new DocumentError('DOC_NOT_FOUND', 'Document not found')),
    } as unknown as Partial<DocumentService>);
    const handler = getDeleteHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'nonexistent-id' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_NOT_FOUND',
        }),
      }),
    );
  });

  it('should return 403 when business does not own the document', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(
          new DocumentError('DOC_FORBIDDEN', 'You do not have permission to access this document'),
        ),
    } as unknown as Partial<DocumentService>);
    const handler = getDeleteHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'other-biz-doc' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_FORBIDDEN',
        }),
      }),
    );
  });

  it('should return 401 when businessId is missing', async () => {
    const handler = getDeleteHandler(makeDeps());
    const req = makeReq({
      businessId: undefined,
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'Authentication required',
        }),
      }),
    );
  });

  it('should call next for non-DocumentError exceptions', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockRejectedValue(new Error('unexpected s3 error')),
    } as unknown as Partial<DocumentService>);
    const handler = getDeleteHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});

// ─── Download Endpoint Tests ─────────────────────────────────────────────────

describe('GET /:id/download', () => {
  it('should return 200 with presigned URL and expiresAt on success', async () => {
    const doc = makeDocument({
      id: 'doc-dl-1',
      s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-dl-1_receipt.jpg',
    });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(doc),
    } as unknown as Partial<DocumentService>);
    const storageService = makeStorageService({
      getPresignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/presigned-url'),
    });
    const deps = makeDeps({ documentService, storageService });
    const handler = getDownloadHandler(deps);
    const req = makeReq({
      params: { id: 'doc-dl-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    const before = Date.now();
    await handler(req as unknown as Request, res as unknown as Response, next);
    const after = Date.now();

    expect(res.status).toHaveBeenCalledWith(200);
    const body = res.json.mock.calls[0]?.[0];
    expect(body.success).toBe(true);
    expect(body.url).toBe('https://s3.example.com/presigned-url');
    expect(body.requestId).toBe('req-123');

    const expiresAt = new Date(body.expiresAt).getTime();
    expect(expiresAt).toBeGreaterThanOrEqual(before + 900 * 1000);
    expect(expiresAt).toBeLessThanOrEqual(after + 900 * 1000);
  });

  it('should call storageService.getPresignedUrl with correct key and expiry', async () => {
    const doc = makeDocument({
      id: 'doc-dl-2',
      s3Key: 'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-dl-2_receipt.jpg',
    });
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockResolvedValue(doc),
    } as unknown as Partial<DocumentService>);
    const storageService = makeStorageService({
      getPresignedUrl: vi.fn().mockResolvedValue('https://s3.example.com/url'),
    });
    const deps = makeDeps({ documentService, storageService });
    const handler = getDownloadHandler(deps);
    const req = makeReq({
      params: { id: 'doc-dl-2' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(storageService.getPresignedUrl).toHaveBeenCalledWith(
      'documents/biz-1/RECEIPT_IMAGE/2024/01/doc-dl-2_receipt.jpg',
      900,
    );
  });

  it('should return 404 when document is not found', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(new DocumentError('DOC_NOT_FOUND', 'Document not found')),
    } as unknown as Partial<DocumentService>);
    const handler = getDownloadHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'nonexistent-id' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(404);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_NOT_FOUND',
        }),
      }),
    );
  });

  it('should return 403 when business does not own the document', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi
        .fn()
        .mockRejectedValue(
          new DocumentError('DOC_FORBIDDEN', 'You do not have permission to access this document'),
        ),
    } as unknown as Partial<DocumentService>);
    const handler = getDownloadHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'other-biz-doc' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'DOC_FORBIDDEN',
        }),
      }),
    );
  });

  it('should return 401 when businessId is missing', async () => {
    const handler = getDownloadHandler(makeDeps());
    const req = makeReq({
      businessId: undefined,
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: 'INTERNAL_ERROR',
          message: 'Authentication required',
        }),
      }),
    );
  });

  it('should call next for non-DocumentError exceptions', async () => {
    const documentService = makeDocumentService({
      getDocumentById: vi.fn().mockRejectedValue(new Error('unexpected s3 error')),
    } as unknown as Partial<DocumentService>);
    const handler = getDownloadHandler(makeDeps({ documentService }));
    const req = makeReq({
      params: { id: 'doc-1' },
    } as unknown as Partial<AuthenticatedRequest>);
    const res = makeRes();
    const next = vi.fn();

    await handler(req as unknown as Request, res as unknown as Response, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
    expect(res.status).not.toHaveBeenCalled();
  });
});
