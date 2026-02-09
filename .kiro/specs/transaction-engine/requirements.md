# Requirements Document

## Introduction

The Transaction Engine Module (transaction-engine) is Module 4 of 14 for CashTrace - an SME cashflow & compliance copilot for Nigerian small businesses. This module handles transaction normalization, categorization, and storage. It receives extracted data from the document-processing module and transforms it into normalized transaction records for analytics. The module supports automatic categorization using Nigerian SME expense categories, manual recategorization, duplicate detection, and comprehensive search/filter capabilities.

## Glossary

- **Transaction_System**: The transaction engine module responsible for transaction normalization, categorization, storage, and retrieval
- **Transaction**: A normalized financial record representing money flowing in (revenue) or out (expense) of a business
- **Business**: A Nigerian SME entity that owns transactions (from business-management module)
- **User**: An authenticated CashTrace user who manages transactions (from core-auth module)
- **Document**: A source document from which transactions are extracted (from document-processing module)
- **Category**: A predefined Nigerian SME expense or revenue classification
- **Kobo**: The smallest unit of Nigerian Naira (1 NGN = 100 kobo), used for integer-based amount storage
- **Transaction_Type**: Either INFLOW (revenue/credit) or OUTFLOW (expense/debit)
- **Source_Type**: The origin of a transaction: RECEIPT, BANK_STATEMENT, POS_EXPORT, or MANUAL
- **Duplicate_Detection**: The process of identifying potentially duplicate transactions across different sources
- **Soft_Delete**: A deletion method that marks records as deleted without immediate removal
- **Full_Text_Search**: PostgreSQL-based search capability on transaction description and counterparty fields

## Requirements

### Requirement 1: Transaction Normalization

**User Story:** As a business owner, I want to see all my transactions in one place regardless of source (receipt, bank, POS).

#### Acceptance Criteria

1. WHEN the Transaction_System receives extracted data from document-processing, THE Transaction_System SHALL normalize it into a unified transaction format
2. WHEN normalizing a transaction, THE Transaction_System SHALL convert the amount to kobo (integer) by multiplying Naira by 100
3. WHEN normalizing a transaction, THE Transaction_System SHALL determine the transaction type as INFLOW or OUTFLOW based on the source data
4. WHEN normalizing a transaction, THE Transaction_System SHALL preserve the original source type (RECEIPT, BANK_STATEMENT, POS_EXPORT)
5. WHEN normalizing a transaction, THE Transaction_System SHALL link it to the source document ID for audit trail
6. WHEN normalizing a transaction, THE Transaction_System SHALL extract and store the counterparty name when available
7. WHEN normalizing a transaction, THE Transaction_System SHALL extract and store the transaction reference when available

### Requirement 2: Automatic Categorization

**User Story:** As a business owner, I want my transactions automatically categorized so I can understand my spending patterns.

#### Acceptance Criteria

1. WHEN a transaction is created, THE Transaction_System SHALL automatically assign a category based on description and counterparty analysis
2. THE Transaction_System SHALL support the following expense categories: Inventory & Stock, Rent & Utilities, Salaries & Wages, Transportation & Logistics, Marketing & Advertising, Professional Services, Equipment & Maintenance, Bank Charges & Fees, Taxes & Levies, Miscellaneous Expenses
3. THE Transaction_System SHALL support the following revenue categories: Product Sales, Service Revenue, Other Income
4. WHEN auto-categorization cannot determine a category with sufficient confidence, THE Transaction_System SHALL assign Miscellaneous Expenses for outflows or Other Income for inflows
5. WHEN a transaction is auto-categorized, THE Transaction_System SHALL store the confidence score (0-100) for the categorization
6. WHEN a transaction is auto-categorized, THE Transaction_System SHALL mark the category source as AUTO

### Requirement 3: Manual Recategorization

**User Story:** As a business owner, I want to manually recategorize transactions if the auto-categorization is wrong.

#### Acceptance Criteria

1. WHEN a user updates a transaction category, THE Transaction_System SHALL validate the category against the predefined list
2. WHEN a user updates a transaction category, THE Transaction_System SHALL mark the category source as MANUAL
3. WHEN a user updates a transaction category, THE Transaction_System SHALL preserve the original auto-assigned category for analytics
4. WHEN a user updates a transaction category, THE Transaction_System SHALL record the change in the audit trail
5. IF the user does not own the business that owns the transaction, THEN THE Transaction_System SHALL return a 403 Forbidden error

### Requirement 4: Personal vs Business Flag

**User Story:** As a business owner, I want to flag transactions as personal vs business expenses.

#### Acceptance Criteria

1. WHEN a user updates a transaction, THE Transaction_System SHALL allow setting the isPersonal flag to true or false
2. WHEN a transaction is created, THE Transaction_System SHALL default the isPersonal flag to false
3. WHEN filtering transactions, THE Transaction_System SHALL support filtering by isPersonal flag
4. WHEN calculating business totals, THE Transaction_System SHALL exclude transactions marked as personal
5. WHEN a user updates the isPersonal flag, THE Transaction_System SHALL record the change in the audit trail

### Requirement 5: Transaction Search and Filter

**User Story:** As a business owner, I want to search and filter my transactions by date, amount, category, and source.

#### Acceptance Criteria

1. WHEN a user requests transactions, THE Transaction_System SHALL support filtering by date range (startDate, endDate)
2. WHEN a user requests transactions, THE Transaction_System SHALL support filtering by amount range (minAmount, maxAmount in kobo)
3. WHEN a user requests transactions, THE Transaction_System SHALL support filtering by category
4. WHEN a user requests transactions, THE Transaction_System SHALL support filtering by source type (RECEIPT, BANK_STATEMENT, POS_EXPORT, MANUAL)
5. WHEN a user requests transactions, THE Transaction_System SHALL support filtering by transaction type (INFLOW, OUTFLOW)
6. WHEN a user requests transactions, THE Transaction_System SHALL support filtering by isPersonal flag
7. WHEN listing transactions, THE Transaction_System SHALL support pagination with configurable page size (default 20, max 100)
8. WHEN listing transactions, THE Transaction_System SHALL sort by transaction date descending by default
9. THE Transaction_System SHALL complete listing requests within 200ms under normal load

### Requirement 6: Full-Text Search

**User Story:** As a business owner, I want to search transactions by description or counterparty name.

#### Acceptance Criteria

1. WHEN a user performs a text search, THE Transaction_System SHALL search across description and counterparty fields
2. WHEN performing full-text search, THE Transaction_System SHALL use PostgreSQL full-text search capabilities
3. WHEN performing full-text search, THE Transaction_System SHALL support partial word matching
4. WHEN performing full-text search, THE Transaction_System SHALL rank results by relevance
5. WHEN combining text search with filters, THE Transaction_System SHALL apply both criteria
6. THE Transaction_System SHALL complete search requests within 300ms under normal load

### Requirement 7: Transaction Details

**User Story:** As a business owner, I want to see transaction details including the source document.

#### Acceptance Criteria

1. WHEN a user requests transaction details, THE Transaction_System SHALL return all transaction fields
2. WHEN a user requests transaction details, THE Transaction_System SHALL include the source document ID and type
3. WHEN a user requests transaction details, THE Transaction_System SHALL include the original and current category with sources
4. WHEN a user requests transaction details, THE Transaction_System SHALL include audit history for the transaction
5. IF the user does not own the business that owns the transaction, THEN THE Transaction_System SHALL return a 403 Forbidden error
6. IF the transaction does not exist, THEN THE Transaction_System SHALL return a 404 Not Found error

### Requirement 8: Bulk Transaction Creation

**User Story:** As a system component, I want to efficiently create multiple transactions from document processing.

#### Acceptance Criteria

1. WHEN the document-processing module sends extracted transactions, THE Transaction_System SHALL accept bulk creation requests
2. WHEN processing bulk creation, THE Transaction_System SHALL normalize and categorize all transactions
3. WHEN processing bulk creation, THE Transaction_System SHALL use database transactions for atomicity
4. WHEN processing bulk creation, THE Transaction_System SHALL return the count of successfully created transactions
5. WHEN processing bulk creation, THE Transaction_System SHALL use batch inserts for efficiency
6. IF any transaction in the bulk fails validation, THEN THE Transaction_System SHALL reject the entire batch with specific errors
7. THE Transaction_System SHALL complete bulk creation of 100 transactions within 2 seconds

### Requirement 9: Duplicate Detection

**User Story:** As a business owner, I want the system to detect potential duplicates across different sources.

#### Acceptance Criteria

1. WHEN transactions are created, THE Transaction_System SHALL check for potential duplicates based on amount, date, and description similarity
2. WHEN a potential duplicate is detected, THE Transaction_System SHALL mark both transactions with a duplicate flag and link them
3. WHEN listing potential duplicates, THE Transaction_System SHALL return pairs of transactions that may be duplicates
4. WHEN a user confirms transactions are not duplicates, THE Transaction_System SHALL mark them as reviewed and not show them again
5. WHEN a user confirms transactions are duplicates, THE Transaction_System SHALL soft-delete one and link to the retained transaction
6. THE Transaction_System SHALL consider transactions as potential duplicates if: same amount, date within 3 days, and description similarity above 70%

### Requirement 10: Transaction Soft Delete

**User Story:** As a business owner, I want to delete incorrect transactions while maintaining audit trail.

#### Acceptance Criteria

1. WHEN a user deletes a transaction, THE Transaction_System SHALL perform a soft delete by setting deletedAt timestamp
2. WHEN a transaction is soft-deleted, THE Transaction_System SHALL NOT return it in normal listing or search requests
3. WHEN a transaction is soft-deleted, THE Transaction_System SHALL preserve it for audit purposes
4. WHEN a transaction is soft-deleted, THE Transaction_System SHALL record the deletion in the audit trail
5. IF the user does not own the business that owns the transaction, THEN THE Transaction_System SHALL return a 403 Forbidden error

### Requirement 11: Transaction Update

**User Story:** As a business owner, I want to update transaction details like description or date if they are incorrect.

#### Acceptance Criteria

1. WHEN a user updates a transaction, THE Transaction_System SHALL allow updating: description, transactionDate, category, isPersonal, and notes
2. WHEN a user updates a transaction, THE Transaction_System SHALL NOT allow updating: amount, sourceType, sourceDocumentId, or transactionType
3. WHEN a user updates a transaction, THE Transaction_System SHALL record all changes in the audit trail with previous and new values
4. WHEN a user updates a transaction, THE Transaction_System SHALL update the updatedAt timestamp
5. IF the user does not own the business that owns the transaction, THEN THE Transaction_System SHALL return a 403 Forbidden error

### Requirement 12: API Response Standards

**User Story:** As a developer integrating with the transaction module, I want consistent API responses so that error handling is predictable.

#### Acceptance Criteria

1. THE Transaction_System SHALL return JSON responses with consistent structure for success and error cases
2. WHEN an error occurs, THE Transaction_System SHALL include error code, message, and field-specific details
3. THE Transaction_System SHALL use appropriate HTTP status codes (200, 201, 400, 403, 404, 500)
4. THE Transaction_System SHALL include request correlation IDs in all responses for debugging
5. WHEN returning amounts, THE Transaction_System SHALL include both kobo (integer) and formatted Naira string
