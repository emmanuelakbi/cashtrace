# Requirements Document

## Introduction

The Document Processing Module (document-processing) is Module 3 of 14 for CashTrace - an SME cashflow & compliance copilot for Nigerian small businesses. This module handles document uploads and processing for Nigerian SMEs, supporting receipt images, bank statements from Nigerian banks, and POS transaction exports. The module provides a mobile-first upload experience with camera capture and file picker support, secure cloud storage with presigned URLs, and asynchronous processing via Gemini AI for transaction extraction.

## Glossary

- **Document_System**: The document processing module responsible for file uploads, storage, and processing orchestration
- **Document**: A file uploaded by a user containing financial information (receipt, bank statement, or POS export)
- **Business**: A Nigerian SME entity that owns documents (from business-management module)
- **User**: An authenticated CashTrace user who uploads documents (from core-auth module)
- **Receipt_Image**: A photograph of a receipt or invoice in JPEG or PNG format
- **Bank_Statement**: A PDF document from a Nigerian bank containing transaction history
- **POS_Export**: A CSV file exported from a Nigerian POS terminal containing card payment transactions
- **Presigned_URL**: A time-limited, secure URL that grants temporary access to a private file in cloud storage
- **Processing_Queue**: An asynchronous job queue that handles document parsing via Gemini AI
- **Magic_Bytes**: The first few bytes of a file that identify its true format regardless of file extension
- **Multipart_Upload**: A method for uploading large files in chunks for reliability and resumability
- **Idempotency_Key**: A unique identifier that ensures the same operation is not performed twice

## Requirements

### Requirement 1: Receipt Image Upload

**User Story:** As a business owner, I want to upload receipt images from my phone camera so I can track expenses.

#### Acceptance Criteria

1. WHEN a user uploads a receipt image, THE Document_System SHALL accept JPEG and PNG formats only
2. WHEN validating an image file, THE Document_System SHALL verify the file type using magic bytes, not just the file extension
3. WHEN an image exceeds 1MB, THE Document_System SHALL compress it on the client-side before upload to target 1MB
4. WHEN a receipt image is uploaded successfully, THE Document_System SHALL store it in S3-compatible storage with a unique key
5. WHEN storing a document, THE Document_System SHALL associate it with the user's business ID
6. IF an invalid file type is uploaded, THEN THE Document_System SHALL reject the upload with a clear error message listing supported formats

### Requirement 2: Bank Statement Upload

**User Story:** As a business owner, I want to upload bank statement PDFs so I can import all my transactions.

#### Acceptance Criteria

1. WHEN a user uploads a bank statement, THE Document_System SHALL accept PDF format only
2. WHEN validating a PDF file, THE Document_System SHALL verify the file type using magic bytes
3. WHEN a bank statement is uploaded, THE Document_System SHALL support statements from Nigerian banks including GTBank, Access Bank, Zenith Bank, First Bank, and UBA
4. WHEN a bank statement is uploaded successfully, THE Document_System SHALL store it in S3-compatible storage with a unique key
5. IF an invalid file type is uploaded, THEN THE Document_System SHALL reject the upload with a clear error message

### Requirement 3: POS Export Upload

**User Story:** As a business owner, I want to upload POS export CSVs so I can track card payments received.

#### Acceptance Criteria

1. WHEN a user uploads a POS export, THE Document_System SHALL accept CSV format only
2. WHEN validating a CSV file, THE Document_System SHALL verify the file contains valid CSV structure
3. WHEN a POS export is uploaded successfully, THE Document_System SHALL store it in S3-compatible storage with a unique key
4. IF an invalid file format is uploaded, THEN THE Document_System SHALL reject the upload with a clear error message

### Requirement 4: File Size and Batch Limits

**User Story:** As a system administrator, I want to enforce file size limits so that storage costs are controlled and uploads are reliable.

#### Acceptance Criteria

1. THE Document_System SHALL enforce a maximum file size of 10MB per individual file
2. THE Document_System SHALL enforce a maximum total size of 50MB per upload batch
3. WHEN a file exceeds the size limit, THE Document_System SHALL reject the upload with a clear error message indicating the limit
4. WHEN a batch exceeds the total size limit, THE Document_System SHALL reject the entire batch with a clear error message
5. WHEN uploading files larger than 5MB, THE Document_System SHALL use multipart upload for reliability

### Requirement 5: Upload Progress and Status

**User Story:** As a business owner, I want to see upload progress and status so I know when processing is complete.

#### Acceptance Criteria

1. WHEN a file upload begins, THE Document_System SHALL provide progress updates as percentage complete
2. WHEN a file is uploaded, THE Document_System SHALL set the initial status to UPLOADED
3. WHEN processing begins, THE Document_System SHALL update the status to PROCESSING
4. WHEN processing completes successfully, THE Document_System SHALL update the status to PARSED
5. WHEN processing partially succeeds, THE Document_System SHALL update the status to PARTIAL with details of what succeeded and failed
6. IF processing fails completely, THEN THE Document_System SHALL update the status to ERROR with an error message

### Requirement 6: Upload Retry

**User Story:** As a business owner, I want to retry failed uploads without re-selecting the file.

#### Acceptance Criteria

1. WHEN a document has ERROR status, THE Document_System SHALL allow the user to retry processing
2. WHEN retrying processing, THE Document_System SHALL use the already-uploaded file without requiring re-upload
3. WHEN a retry is initiated, THE Document_System SHALL reset the status to PROCESSING
4. THE Document_System SHALL use idempotency keys to prevent duplicate transaction creation during retries
5. WHEN a retry succeeds, THE Document_System SHALL update the status to PARSED or PARTIAL as appropriate

### Requirement 7: Document Listing and Details

**User Story:** As a business owner, I want to view my uploaded documents and their processing status.

#### Acceptance Criteria

1. WHEN a user requests their documents, THE Document_System SHALL return all documents for the user's business
2. WHEN listing documents, THE Document_System SHALL include: id, filename, document type, file size, upload timestamp, and processing status
3. WHEN a user requests document details, THE Document_System SHALL return complete metadata including processing results
4. WHEN listing documents, THE Document_System SHALL support pagination with configurable page size
5. WHEN listing documents, THE Document_System SHALL sort by upload timestamp descending by default
6. THE Document_System SHALL complete document listing requests within 200ms under normal load

### Requirement 8: Secure File Storage

**User Story:** As a system administrator, I want secure file storage so that user documents are protected.

#### Acceptance Criteria

1. THE Document_System SHALL store all documents in S3-compatible storage (AWS S3, Cloudflare R2, or MinIO)
2. THE Document_System SHALL NOT allow public access to any stored documents
3. WHEN a user requests to download a document, THE Document_System SHALL generate a presigned URL with 15-minute expiration
4. WHEN generating presigned URLs, THE Document_System SHALL verify the user owns the business that owns the document
5. THE Document_System SHALL organize documents by business ID in the storage bucket
6. THE Document_System SHALL encrypt documents at rest using server-side encryption

### Requirement 9: Document Deletion

**User Story:** As a business owner, I want to delete documents I no longer need.

#### Acceptance Criteria

1. WHEN a user requests document deletion, THE Document_System SHALL verify the user owns the business that owns the document
2. WHEN a document is deleted, THE Document_System SHALL remove the file from cloud storage
3. WHEN a document is deleted, THE Document_System SHALL remove the document metadata from the database
4. WHEN a document is deleted, THE Document_System SHALL NOT delete any transactions that were extracted from the document
5. IF the user does not own the document, THEN THE Document_System SHALL return a 403 Forbidden error

### Requirement 10: Document Metadata

**User Story:** As a system administrator, I want comprehensive document metadata for tracking and debugging.

#### Acceptance Criteria

1. WHEN a document is uploaded, THE Document_System SHALL record: filename, original filename, document type, MIME type, file size in bytes, and upload timestamp
2. WHEN a document is processed, THE Document_System SHALL record: processing start time, processing end time, and processing duration
3. WHEN processing produces results, THE Document_System SHALL record: number of transactions extracted, any warnings, and any errors
4. THE Document_System SHALL generate a unique document ID using UUID v4
5. THE Document_System SHALL store the S3 object key for each document

### Requirement 11: Processing Queue

**User Story:** As a system administrator, I want asynchronous document processing so that uploads are fast and processing is reliable.

#### Acceptance Criteria

1. WHEN a document is uploaded, THE Document_System SHALL immediately return success and queue the document for processing
2. THE Document_System SHALL process documents asynchronously using a job queue
3. WHEN processing a document, THE Document_System SHALL call Gemini AI for transaction extraction
4. WHEN the processing queue is full, THE Document_System SHALL still accept uploads and queue them for later processing
5. WHEN a processing job fails, THE Document_System SHALL retry up to 3 times with exponential backoff
6. WHEN all retries are exhausted, THE Document_System SHALL mark the document as ERROR

### Requirement 12: API Response Standards

**User Story:** As a developer integrating with the document module, I want consistent API responses so that error handling is predictable.

#### Acceptance Criteria

1. THE Document_System SHALL return JSON responses with consistent structure for success and error cases
2. WHEN an error occurs, THE Document_System SHALL include error code, message, and field-specific details
3. THE Document_System SHALL use appropriate HTTP status codes (200, 201, 400, 403, 404, 413, 500)
4. THE Document_System SHALL include request correlation IDs in all responses for debugging
