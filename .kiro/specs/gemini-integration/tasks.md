# Implementation Plan: Gemini Integration Module

## Overview

This implementation plan breaks down the gemini-integration module into discrete coding tasks. The module is implemented in TypeScript as a fully isolated service layer with no dependencies on other CashTrace modules except shared type definitions.

## Tasks

- [ ] 1. Set up project structure and core types
  - [ ] 1.1 Create module directory structure and package.json
    - Create `src/gemini-integration/` directory
    - Initialize package.json with dependencies: @google/generative-ai, sharp, pdf-parse, papaparse, zod, fast-check
    - Configure TypeScript with strict mode
    - _Requirements: 13.1, 13.2_

  - [ ] 1.2 Define core TypeScript interfaces and types
    - Create `types/extraction.ts` with ExtractedTransaction, ExtractionResult, ExtractionMetadata
    - Create `types/insights.ts` with GeneratedInsight, InsightResult, InsightMetadata, BusinessContext
    - Create `types/config.ts` with GeminiServiceConfig, ModelConfig, GeminiModel
    - Create `types/errors.ts` with all error classes (GeminiServiceError, ValidationError, CircuitOpenError, etc.)
    - _Requirements: 5.6_

  - [ ] 1.3 Create configuration module with defaults
    - Implement `config/defaults.ts` with DEFAULT_EXTRACTION_CONFIG, DEFAULT_INSIGHT_CONFIG
    - Implement `config/index.ts` with configuration loading and validation
    - Support environment variable overrides
    - _Requirements: 13.3, 13.4, 13.5_

- [ ] 2. Implement input validation layer
  - [ ] 2.1 Implement InputValidator for image validation
    - Create `validators/input-validator.ts`
    - Implement validateImageInput() with magic byte detection for JPEG/PNG
    - Validate buffer is non-empty and within size limits (10MB)
    - Return ValidationResult with errors and warnings
    - _Requirements: 9.1, 9.6_

  - [ ] 2.2 Implement InputValidator for PDF validation
    - Implement validatePdfInput() with magic byte detection for PDF
    - Validate buffer is non-empty and within size limits (10MB)
    - Detect password-protected PDFs
    - _Requirements: 9.2, 9.6_

  - [ ] 2.3 Implement InputValidator for CSV validation
    - Implement validateCsvInput() with structure validation
    - Validate content is non-empty and within size limits (5MB)
    - Detect CSV dialect (delimiter, quote char)
    - _Requirements: 9.3, 9.6_

  - [ ] 2.4 Implement InputValidator for BusinessContext validation
    - Implement validateBusinessContext() with required field checks
    - Validate businessId, businessName, transactions array, period object
    - _Requirements: 9.4_

  - [ ] 2.5 Write property tests for input validation
    - **Property 9: Input Validation Early Rejection**
    - Test that invalid inputs are rejected without API calls
    - Generate various invalid inputs (empty, oversized, wrong format)
    - **Validates: Requirements 9.1, 9.2, 9.3, 9.4, 9.5, 9.6**

- [ ] 3. Implement output validation layer
  - [ ] 3.1 Implement schema validation with Zod
    - Create `validators/schemas.ts` with Zod schemas for ExtractedTransaction, GeneratedInsight
    - Define strict validation rules for all fields
    - _Requirements: 5.3, 10.1, 10.4_

  - [ ] 3.2 Implement OutputValidator for extraction results
    - Create `validators/output-validator.ts`
    - Implement validateExtractionResult() with transaction field validation
    - Validate date parseability, amount numeric, type enum, confidence range
    - Exclude invalid transactions and add warnings
    - _Requirements: 10.1, 10.2, 10.3, 10.6_

  - [ ] 3.3 Implement OutputValidator for insight results
    - Implement validateInsightResult() with insight field validation
    - Validate type and severity enum values
    - Exclude invalid insights and add warnings
    - _Requirements: 10.4, 10.5, 10.6_

  - [ ] 3.4 Implement JSON repair utility
    - Create `utils/json-repair.ts`
    - Implement repairJson() with common fix heuristics (trailing commas, unquoted keys, etc.)
    - Return RepairResult with success status and repairs made
    - _Requirements: 5.4_

  - [ ] 3.5 Write property tests for output validation
    - **Property 10: Output Validation Field Completeness**
    - **Property 11: Insight Validation Field Completeness**
    - **Property 12: Partial Validation Exclusion**
    - Generate random transaction/insight objects, verify validation
    - **Validates: Requirements 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 4.6, 4.7**

  - [ ] 3.6 Write property test for JSON repair idempotence
    - **Property 8: JSON Repair Idempotence**
    - Generate valid JSON, verify repair returns unchanged
    - **Validates: Requirements 5.4**

- [ ] 4. Implement resilience layer
  - [ ] 4.1 Implement RetryHandler with exponential backoff
    - Create `resilience/retry-handler.ts`
    - Implement executeWithRetry() with configurable max retries, initial delay, multiplier
    - Add jitter (0-500ms) to prevent thundering herd
    - Distinguish transient vs non-transient errors
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6_

  - [ ] 4.2 Write property tests for retry behavior
    - **Property 13: Retry Exponential Backoff**
    - **Property 14: Non-Transient Error No Retry**
    - **Property 15: Retry Exhaustion Error Reporting**
    - Generate retry sequences, verify timing and behavior
    - **Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.5, 7.6**

  - [ ] 4.3 Implement CircuitBreaker state machine
    - Create `resilience/circuit-breaker.ts`
    - Implement state transitions: CLOSED → OPEN → HALF_OPEN → CLOSED
    - Configure failure threshold (5), reset timeout (30s)
    - Expose getStatus() for monitoring
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7_

  - [ ] 4.4 Write property tests for circuit breaker
    - **Property 16: Circuit Breaker State Transitions**
    - **Property 17: Circuit Open Immediate Rejection**
    - Generate failure/success sequences, verify state machine
    - **Validates: Requirements 8.2, 8.3, 8.4, 8.5, 8.6**

  - [ ] 4.5 Implement TimeoutHandler
    - Create `resilience/timeout-handler.ts`
    - Implement executeWithTimeout() with configurable timeout
    - Return TimeoutError on expiration
    - _Requirements: 1.3, 2.3, 3.3, 4.3_

- [ ] 5. Checkpoint - Ensure resilience layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement utility services
  - [ ] 6.1 Implement ImageProcessor
    - Create `utils/image-processor.ts`
    - Implement preprocess() using sharp library
    - Resize to max 1024px maintaining aspect ratio
    - Compress to JPEG with quality 80
    - Implement validateFormat() with magic byte detection
    - _Requirements: 1.4_

  - [ ] 6.2 Write property test for image preprocessing
    - **Property 1: Image Preprocessing Bounds**
    - Generate random images with various dimensions
    - Verify output dimensions ≤ 1024px
    - **Validates: Requirements 1.4**

  - [ ] 6.3 Implement PdfExtractor
    - Create `utils/pdf-extractor.ts`
    - Implement extractText() using pdf-parse library
    - Implement validateFormat() with magic byte detection
    - Handle password-protected and corrupted PDFs gracefully
    - _Requirements: 2.7_

  - [ ] 6.4 Implement CsvParser
    - Create `utils/csv-parser.ts`
    - Implement parse() using papaparse library
    - Implement detectDialect() for auto-detection
    - Implement validateStructure() for CSV validation
    - _Requirements: 3.6_

  - [ ] 6.5 Implement PiiRedactor
    - Create `utils/pii-redactor.ts`
    - Implement redact() with Nigerian PII patterns
    - Handle phone numbers (080x, 081x, 070x, 090x, 091x)
    - Handle account numbers (10-digit), BVN (11-digit), emails
    - Implement redactObject() for deep object redaction
    - _Requirements: 12.3, 12.4_

  - [ ] 6.6 Write property test for PII redaction
    - **Property 21: PII Redaction Completeness**
    - Generate text with Nigerian PII patterns
    - Verify all patterns are redacted
    - **Validates: Requirements 12.3, 12.4**

  - [ ] 6.7 Implement Nigerian format parsers
    - Create `utils/nigerian-formats.ts`
    - Implement parseNigerianDate() for DD/MM/YYYY, DD-MM-YYYY, DD/MMM/YYYY
    - Implement parseNigerianCurrency() for ₦, NGN, N formats
    - Implement extractNigerianPhone() for phone number extraction
    - _Requirements: 11.1, 11.2, 11.3, 11.6_

  - [ ] 6.8 Write property tests for Nigerian format parsing
    - **Property 22: Nigerian Date Format Parsing**
    - **Property 23: Nigerian Currency Format Parsing**
    - **Property 24: Nigerian Phone Number Extraction**
    - Generate Nigerian format strings, verify correct parsing
    - **Validates: Requirements 11.1, 11.2, 11.3, 11.6**

- [ ] 7. Implement prompt management
  - [ ] 7.1 Implement PromptManager
    - Create `prompts/prompt-manager.ts`
    - Implement getPrompt() with type and version support
    - Implement getActiveVersion(), listVersions(), setActiveVersion()
    - Store prompts with version history
    - _Requirements: 14.6_

  - [ ] 7.2 Create extraction prompts
    - Create `prompts/templates/receipt-extraction.ts`
    - Create `prompts/templates/bank-statement-extraction.ts`
    - Create `prompts/templates/pos-export-extraction.ts`
    - Include Nigerian business context, example outputs, JSON schema
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5_

  - [ ] 7.3 Create insight generation prompt
    - Create `prompts/templates/insight-generation.ts`
    - Include Nigerian tax context (VAT, WHT, CIT)
    - Include insight types and severity definitions
    - Include example outputs
    - _Requirements: 4.8, 14.1, 14.2, 14.3_

  - [ ] 7.4 Write property test for prompt versioning
    - **Property 26: Prompt Version Management**
    - Verify version history and retrieval
    - **Validates: Requirements 14.6**

- [ ] 8. Implement usage tracking
  - [ ] 8.1 Implement UsageTracker
    - Create `monitoring/usage-tracker.ts`
    - Implement recordUsage() with all required fields
    - Implement getStats() with filtering and aggregation
    - Implement getStatsByOperation() for operation-specific stats
    - Calculate estimated costs based on Gemini pricing
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5_

  - [ ] 8.2 Implement usage storage
    - Create `monitoring/usage-storage.ts`
    - Support in-memory storage for development
    - Support database storage interface for production
    - _Requirements: 6.6_

  - [ ] 8.3 Write property tests for usage tracking
    - **Property 18: Usage Tracking Completeness**
    - **Property 19: Usage Aggregation Correctness**
    - **Property 20: Usage Filtering Correctness**
    - Generate usage records, verify tracking and aggregation
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4, 6.5**

- [ ] 9. Implement logging
  - [ ] 9.1 Implement Logger with PII redaction
    - Create `monitoring/logger.ts`
    - Implement log methods (debug, info, warn, error)
    - Integrate PiiRedactor for automatic redaction
    - Include correlation IDs in all log entries
    - _Requirements: 12.1, 12.2, 12.5, 12.6_

  - [ ] 9.2 Write property test for correlation ID presence
    - **Property 25: Correlation ID Presence**
    - Verify all log entries include correlation ID
    - **Validates: Requirements 12.5**

- [ ] 10. Checkpoint - Ensure utility and monitoring tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 11. Implement core extraction service
  - [ ] 11.1 Implement Gemini API client wrapper
    - Create `services/gemini-client.ts`
    - Wrap @google/generative-ai SDK
    - Support model selection (Flash, Pro)
    - Support structured output mode
    - Handle API key rotation
    - _Requirements: 13.1, 13.2, 13.6_

  - [ ] 11.2 Implement ExtractionService for receipts
    - Create `services/extraction-service.ts`
    - Implement extractFromReceipt() with image preprocessing
    - Use receipt extraction prompt
    - Apply input validation, retry, circuit breaker, output validation
    - Set document_type to 'receipt'
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [ ] 11.3 Write property test for receipt document type
    - **Property 3: Receipt Document Type**
    - Verify document_type is 'receipt' for receipt extractions
    - **Validates: Requirements 1.6**

  - [ ] 11.4 Implement ExtractionService for bank statements
    - Implement extractFromBankStatement() with PDF handling
    - Use bank statement extraction prompt
    - Implement PDF text extraction fallback
    - Set document_type to 'bank_statement'
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8_

  - [ ] 11.5 Write property test for bank statement document type
    - **Property 4: Bank Statement Document Type**
    - Verify document_type is 'bank_statement' for bank statement extractions
    - **Validates: Requirements 2.6**

  - [ ] 11.6 Implement ExtractionService for POS exports
    - Implement extractFromPosExport() with CSV handling
    - Use POS export extraction prompt
    - Implement CSV parsing fallback
    - Set document_type to 'pos_export'
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ] 11.7 Write property test for POS export document type
    - **Property 5: POS Export Document Type**
    - Verify document_type is 'pos_export' for POS export extractions
    - **Validates: Requirements 3.5**

  - [ ] 11.8 Write property tests for schema validation and warnings
    - **Property 2: Schema Validation Completeness**
    - **Property 6: Warning Propagation**
    - **Property 7: Invalid Input Graceful Handling**
    - Generate various responses, verify validation and warning behavior
    - **Validates: Requirements 1.5, 1.7, 1.8, 2.5, 2.8, 3.4, 3.7, 5.3**

- [ ] 12. Implement insight service
  - [ ] 12.1 Implement InsightService
    - Create `services/insight-service.ts`
    - Implement generateInsights() with BusinessContext
    - Use insight generation prompt
    - Apply input validation, retry, circuit breaker, output validation
    - Include analysis_period in result
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8_

  - [ ] 12.2 Write property test for insight analysis period
    - **Property 27: Insight Analysis Period Consistency**
    - Verify analysis_period matches input BusinessContext period
    - **Validates: Requirements 4.5**

- [ ] 13. Implement main service facade
  - [ ] 13.1 Implement GeminiService facade
    - Create `services/gemini-service.ts`
    - Implement parseReceipt(), parseBankStatement(), parsePosExport()
    - Implement generateInsights()
    - Implement getUsageStats(), getCircuitBreakerStatus()
    - Wire all components together
    - _Requirements: All_

  - [ ] 13.2 Create module exports
    - Create `index.ts` with public API exports
    - Export GeminiService, types, errors
    - Hide internal implementation details
    - _Requirements: All_

- [ ] 14. Integration testing
  - [ ] 14.1 Write integration tests with mocked Gemini API
    - Test end-to-end receipt parsing flow
    - Test end-to-end bank statement parsing flow
    - Test end-to-end POS export parsing flow
    - Test end-to-end insight generation flow
    - Test fallback scenarios
    - Test circuit breaker integration
    - _Requirements: All_

  - [ ] 14.2 Write error handling integration tests
    - Test timeout handling
    - Test rate limit handling
    - Test invalid API key handling
    - Test malformed response handling
    - _Requirements: 7.1, 7.5, 8.2, 8.3_

- [ ] 15. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive coverage
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties
- Unit tests validate specific examples and edge cases
- All Gemini API calls should be mocked in tests using msw
- Use fast-check with minimum 100 iterations for property tests
