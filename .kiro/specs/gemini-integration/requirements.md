# Requirements Document

## Introduction

The Gemini Integration Module (gemini-integration) is Module 6 of 14 for CashTrace - an SME cashflow & compliance copilot for Nigerian small businesses. This module provides an isolated AI service layer for all Gemini API interactions, handling document parsing (receipts, bank statements, POS exports) and narrative insights generation. The module is designed to be robust, cost-efficient, and produce consistent structured outputs optimized for Nigerian business contexts.

## Glossary

- **Gemini_Service**: The AI service module responsible for all Gemini API interactions
- **Extraction_Result**: A structured JSON output containing transactions extracted from a document
- **Extracted_Transaction**: A single transaction record parsed from a document with confidence scoring
- **Insight_Result**: A structured JSON output containing generated business insights
- **Generated_Insight**: A single insight with type, severity, title, body, and action items
- **Business_Context**: Input data containing transaction history and business metadata for insight generation
- **Token_Usage**: A record of input and output tokens consumed by a Gemini API call
- **Usage_Stats**: Aggregated statistics of Gemini API usage including token counts and estimated costs
- **Circuit_Breaker**: A pattern that prevents repeated calls to a failing service
- **Exponential_Backoff**: A retry strategy where wait time increases exponentially between attempts
- **Structured_Output**: Gemini's mode for generating JSON that conforms to a predefined schema
- **System_Prompt**: Instructions provided to Gemini that define its behavior and output format
- **Temperature**: A parameter controlling randomness in Gemini's output (0.0 = deterministic, 1.0 = creative)

## Requirements

### Requirement 1: Receipt Image Parsing

**User Story:** As a system component, I want to extract transactions from receipt images using Gemini so that users can digitize paper receipts.

#### Acceptance Criteria

1. WHEN the Gemini_Service receives a receipt image buffer, THE Gemini_Service SHALL send it to Gemini with a receipt-specific system prompt
2. WHEN parsing a receipt, THE Gemini_Service SHALL use temperature 0.1 for deterministic extraction
3. WHEN parsing a receipt, THE Gemini_Service SHALL enforce a 30-second timeout
4. WHEN parsing a receipt, THE Gemini_Service SHALL preprocess the image by resizing to max 1024px and compressing to reduce token usage
5. WHEN Gemini returns a response, THE Gemini_Service SHALL validate the output against the ExtractedTransaction schema
6. WHEN extraction succeeds, THE Gemini_Service SHALL return an ExtractionResult with document_type set to 'receipt'
7. WHEN extraction produces warnings, THE Gemini_Service SHALL include them in the ExtractionResult warnings array
8. IF the image is invalid or unreadable, THEN THE Gemini_Service SHALL return an ExtractionResult with empty transactions and appropriate warnings

### Requirement 2: Bank Statement PDF Parsing

**User Story:** As a system component, I want to extract transactions from bank statement PDFs using Gemini so that users can import bank transactions.

#### Acceptance Criteria

1. WHEN the Gemini_Service receives a bank statement PDF buffer, THE Gemini_Service SHALL send it to Gemini with a bank-statement-specific system prompt
2. WHEN parsing a bank statement, THE Gemini_Service SHALL use temperature 0.1 for deterministic extraction
3. WHEN parsing a bank statement, THE Gemini_Service SHALL enforce a 30-second timeout
4. WHEN parsing a bank statement, THE Gemini_Service SHALL handle Nigerian bank formats including GTBank, Access Bank, Zenith Bank, First Bank, and UBA
5. WHEN Gemini returns a response, THE Gemini_Service SHALL validate the output against the ExtractedTransaction schema
6. WHEN extraction succeeds, THE Gemini_Service SHALL return an ExtractionResult with document_type set to 'bank_statement'
7. IF Gemini fails to parse the PDF, THEN THE Gemini_Service SHALL attempt text extraction fallback using a PDF parsing library
8. IF the PDF is password-protected or corrupted, THEN THE Gemini_Service SHALL return an ExtractionResult with empty transactions and appropriate warnings

### Requirement 3: POS Export CSV Parsing

**User Story:** As a system component, I want to extract transactions from POS CSV exports using Gemini so that users can import card payment records.

#### Acceptance Criteria

1. WHEN the Gemini_Service receives CSV content, THE Gemini_Service SHALL send it to Gemini with a POS-export-specific system prompt
2. WHEN parsing a POS export, THE Gemini_Service SHALL use temperature 0.1 for deterministic extraction
3. WHEN parsing a POS export, THE Gemini_Service SHALL enforce a 30-second timeout
4. WHEN Gemini returns a response, THE Gemini_Service SHALL validate the output against the ExtractedTransaction schema
5. WHEN extraction succeeds, THE Gemini_Service SHALL return an ExtractionResult with document_type set to 'pos_export'
6. IF Gemini fails to parse the CSV, THEN THE Gemini_Service SHALL attempt direct CSV parsing fallback
7. IF the CSV structure is invalid, THEN THE Gemini_Service SHALL return an ExtractionResult with empty transactions and appropriate warnings

### Requirement 4: Narrative Insights Generation

**User Story:** As a system component, I want to generate narrative insights from transaction data so that users receive actionable business advice.

#### Acceptance Criteria

1. WHEN the Gemini_Service receives a BusinessContext, THE Gemini_Service SHALL send it to Gemini with an insights-specific system prompt
2. WHEN generating insights, THE Gemini_Service SHALL use temperature 0.5 for balanced creativity
3. WHEN generating insights, THE Gemini_Service SHALL enforce a 60-second timeout
4. WHEN Gemini returns a response, THE Gemini_Service SHALL validate the output against the GeneratedInsight schema
5. WHEN insights are generated, THE Gemini_Service SHALL return an InsightResult with the analysis period
6. THE Gemini_Service SHALL support insight types: tax_exposure, personal_spend, cashflow_risk, cost_optimization, revenue_opportunity
7. THE Gemini_Service SHALL assign severity levels: info, warning, alert based on urgency
8. WHEN generating insights, THE Gemini_Service SHALL include Nigerian business context in the system prompt

### Requirement 5: Structured JSON Output

**User Story:** As a developer, I want consistent structured JSON output from all Gemini calls so that downstream processing is reliable.

#### Acceptance Criteria

1. THE Gemini_Service SHALL use Gemini's structured output mode when available
2. WHEN structured output mode is unavailable, THE Gemini_Service SHALL include JSON schema examples in the system prompt
3. WHEN Gemini returns a response, THE Gemini_Service SHALL validate it against the expected schema
4. IF validation fails, THEN THE Gemini_Service SHALL attempt to repair the JSON using heuristics
5. IF repair fails, THEN THE Gemini_Service SHALL return an error with the raw response for debugging
6. THE Gemini_Service SHALL serialize all outputs to match predefined TypeScript interfaces

### Requirement 6: API Usage Monitoring

**User Story:** As a system administrator, I want to monitor Gemini API usage and costs so that I can manage expenses.

#### Acceptance Criteria

1. WHEN a Gemini API call completes, THE Gemini_Service SHALL record input tokens, output tokens, and model used
2. THE Gemini_Service SHALL aggregate usage statistics by time period (hourly, daily, monthly)
3. THE Gemini_Service SHALL calculate estimated costs based on current Gemini pricing
4. WHEN getUsageStats is called, THE Gemini_Service SHALL return total tokens, total calls, and estimated cost
5. THE Gemini_Service SHALL support filtering usage stats by operation type (extraction, insights)
6. THE Gemini_Service SHALL persist usage data for historical analysis

### Requirement 7: Retry Logic with Exponential Backoff

**User Story:** As a system component, I want automatic retries for transient failures so that temporary issues don't cause permanent failures.

#### Acceptance Criteria

1. WHEN a Gemini API call fails with a transient error, THE Gemini_Service SHALL retry with exponential backoff
2. THE Gemini_Service SHALL retry up to 3 times before failing permanently
3. THE Gemini_Service SHALL use initial backoff of 1 second, doubling with each retry
4. THE Gemini_Service SHALL add jitter (0-500ms) to prevent thundering herd
5. THE Gemini_Service SHALL NOT retry on non-transient errors (invalid input, quota exceeded)
6. WHEN all retries are exhausted, THE Gemini_Service SHALL return the last error with retry count

### Requirement 8: Circuit Breaker Pattern

**User Story:** As a system component, I want graceful degradation when Gemini is unavailable so that the system remains partially functional.

#### Acceptance Criteria

1. THE Gemini_Service SHALL implement a circuit breaker for Gemini API calls
2. WHEN 5 consecutive failures occur, THE Gemini_Service SHALL open the circuit breaker
3. WHILE the circuit breaker is open, THE Gemini_Service SHALL immediately return a service unavailable error
4. AFTER 30 seconds, THE Gemini_Service SHALL allow a single test request (half-open state)
5. IF the test request succeeds, THE Gemini_Service SHALL close the circuit breaker
6. IF the test request fails, THE Gemini_Service SHALL keep the circuit breaker open for another 30 seconds
7. THE Gemini_Service SHALL expose circuit breaker state for monitoring

### Requirement 9: Input Validation

**User Story:** As a system component, I want input validation before API calls so that invalid requests are rejected early.

#### Acceptance Criteria

1. WHEN parseReceipt is called, THE Gemini_Service SHALL validate the image buffer is non-empty and valid image format
2. WHEN parseBankStatement is called, THE Gemini_Service SHALL validate the PDF buffer is non-empty and valid PDF format
3. WHEN parsePosExport is called, THE Gemini_Service SHALL validate the CSV content is non-empty and valid CSV structure
4. WHEN generateInsights is called, THE Gemini_Service SHALL validate the BusinessContext contains required fields
5. IF validation fails, THEN THE Gemini_Service SHALL return a validation error without calling Gemini API
6. THE Gemini_Service SHALL validate file sizes do not exceed maximum limits (10MB for images/PDFs, 5MB for CSV)

### Requirement 10: Output Validation

**User Story:** As a system component, I want output validation after API calls so that malformed responses are caught.

#### Acceptance Criteria

1. WHEN Gemini returns an extraction response, THE Gemini_Service SHALL validate each transaction has required fields
2. WHEN validating transactions, THE Gemini_Service SHALL ensure date is parseable, amount is numeric, and type is valid
3. WHEN validating transactions, THE Gemini_Service SHALL ensure confidence is between 0 and 100
4. WHEN Gemini returns an insights response, THE Gemini_Service SHALL validate each insight has required fields
5. WHEN validating insights, THE Gemini_Service SHALL ensure type and severity are valid enum values
6. IF any transaction or insight fails validation, THE Gemini_Service SHALL exclude it and add a warning

### Requirement 11: Nigerian Business Context

**User Story:** As a system component, I want Nigerian-specific handling so that local formats and conventions are supported.

#### Acceptance Criteria

1. THE Gemini_Service SHALL handle Nigerian date formats (DD/MM/YYYY) in extraction
2. THE Gemini_Service SHALL handle Nigerian currency formats (₦, NGN, N) in extraction
3. THE Gemini_Service SHALL normalize all amounts to Naira numeric values
4. THE Gemini_Service SHALL include Nigerian business context in insight generation prompts
5. THE Gemini_Service SHALL recognize common Nigerian bank transaction descriptions
6. THE Gemini_Service SHALL handle Nigerian phone number formats in counterparty extraction

### Requirement 12: Request/Response Logging

**User Story:** As a system administrator, I want request/response logging so that I can debug issues and audit API usage.

#### Acceptance Criteria

1. THE Gemini_Service SHALL log all API requests with timestamp, operation type, and input metadata
2. THE Gemini_Service SHALL log all API responses with status, token usage, and latency
3. WHEN logging requests, THE Gemini_Service SHALL redact PII (names, account numbers, phone numbers)
4. WHEN logging responses, THE Gemini_Service SHALL redact PII from extracted data
5. THE Gemini_Service SHALL include correlation IDs in all logs for request tracing
6. THE Gemini_Service SHALL log errors with full context for debugging

### Requirement 13: Model Configuration

**User Story:** As a system administrator, I want configurable model settings so that I can optimize for cost and quality.

#### Acceptance Criteria

1. THE Gemini_Service SHALL support Gemini 2.0 Flash model for cost-efficient extraction
2. THE Gemini_Service SHALL support Gemini 2.0 Pro model for complex documents
3. THE Gemini_Service SHALL allow model selection per operation type via configuration
4. THE Gemini_Service SHALL use configurable temperature settings (default 0.1 for extraction, 0.5 for insights)
5. THE Gemini_Service SHALL use configurable timeout settings (default 30s for extraction, 60s for insights)
6. THE Gemini_Service SHALL support API key rotation for high availability

### Requirement 14: Prompt Engineering

**User Story:** As a system component, I want optimized prompts so that Gemini produces accurate and consistent outputs.

#### Acceptance Criteria

1. THE Gemini_Service SHALL use system prompts that include Nigerian business context
2. THE Gemini_Service SHALL include example outputs in prompts for consistency
3. THE Gemini_Service SHALL specify exact JSON schema in prompts
4. THE Gemini_Service SHALL include instructions for handling ambiguous data
5. THE Gemini_Service SHALL include instructions for confidence scoring
6. THE Gemini_Service SHALL version prompts for A/B testing and rollback
