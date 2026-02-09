# Requirements Document

## Introduction

The Business Management Module (business-management) is Module 2 of 14 for CashTrace - an SME cashflow & compliance copilot for Nigerian small businesses. This module manages business profiles for Nigerian SMEs, enabling users to create, update, and manage their business information. The module supports Nigerian business sectors, NGN as the primary currency, and includes NDPR compliance features including data export and right to erasure. The architecture supports single business per user for MVP while being designed for future multi-business expansion.

## Glossary

- **Business_System**: The business management module responsible for business profile CRUD operations and data management
- **Business**: A Nigerian SME entity with profile information including name, sector, and currency
- **User**: An authenticated CashTrace user who owns a business profile (from core-auth module)
- **Sector**: A predefined Nigerian SME business category (e.g., Retail & Trading, Professional Services)
- **Soft_Delete**: A deletion method that marks records as deleted without immediate removal, allowing recovery
- **Hard_Delete**: Permanent removal of data from the database after the recovery window expires
- **NDPR**: Nigeria Data Protection Regulation - the legal framework governing personal data processing in Nigeria
- **Audit_Trail**: A chronological record of all changes made to business data for compliance and debugging
- **Data_Export**: A JSON file containing all business-related data for NDPR compliance

## Requirements

### Requirement 1: Business Profile Creation

**User Story:** As a new user, I want to create my business profile after signup so I can start tracking cashflow.

#### Acceptance Criteria

1. WHEN a user submits a business creation request with a valid name, THE Business_System SHALL create a new business profile linked to the authenticated user
2. WHEN validating business name, THE Business_System SHALL require between 2 and 100 characters inclusive
3. WHEN a user already has a business profile, THE Business_System SHALL reject the creation request with a clear error message
4. WHEN a business is created, THE Business_System SHALL default the currency to NGN
5. WHEN a business is created, THE Business_System SHALL record the creation in the audit trail with timestamp, user ID, and action type
6. WHEN a business is created successfully, THE Business_System SHALL return the complete business profile including generated ID and timestamps
7. IF business creation validation fails, THEN THE Business_System SHALL return a consistent error response with specific field errors

### Requirement 2: Business Sector Selection

**User Story:** As a business owner, I want to select my business sector so insights are relevant to my industry.

#### Acceptance Criteria

1. WHEN a user creates or updates a business, THE Business_System SHALL accept only predefined Nigerian SME sector values
2. THE Business_System SHALL support the following sectors: Retail & Trading, Professional Services, Manufacturing, Agriculture & Agribusiness, Technology & Digital Services, Hospitality & Food Services, Transportation & Logistics, Healthcare & Pharmaceuticals, Education & Training, Construction & Real Estate, Other
3. WHEN an invalid sector is provided, THE Business_System SHALL return a validation error listing valid options
4. WHEN sector is not provided during creation, THE Business_System SHALL default to Other

### Requirement 3: Business Profile Update

**User Story:** As a business owner, I want to update my business details as my business evolves.

#### Acceptance Criteria

1. WHEN a user submits a business update request, THE Business_System SHALL validate the user owns the business
2. WHEN updating business name, THE Business_System SHALL apply the same validation rules as creation (2-100 characters)
3. WHEN updating business sector, THE Business_System SHALL validate against the predefined sector list
4. WHEN a business is updated, THE Business_System SHALL record the change in the audit trail with previous and new values
5. WHEN a business is updated successfully, THE Business_System SHALL return the updated business profile with new timestamps
6. IF the user does not own the business, THEN THE Business_System SHALL return a 403 Forbidden error

### Requirement 4: Business Profile Retrieval

**User Story:** As a business owner, I want to see my business summary on the dashboard.

#### Acceptance Criteria

1. WHEN a user requests their business profile, THE Business_System SHALL return the business linked to the authenticated user
2. WHEN a user has no business profile, THE Business_System SHALL return a 404 Not Found response
3. WHEN retrieving a business, THE Business_System SHALL include all profile fields: id, name, sector, currency, createdAt, updatedAt
4. WHEN a business is soft-deleted, THE Business_System SHALL NOT return it in normal retrieval requests
5. THE Business_System SHALL complete retrieval requests within 200ms under normal load

### Requirement 5: Business Deletion (NDPR Right to Erasure)

**User Story:** As a user, I want to delete my business and all associated data (NDPR right to erasure).

#### Acceptance Criteria

1. WHEN a user requests business deletion, THE Business_System SHALL perform a soft delete marking the business as deleted
2. WHEN a business is soft-deleted, THE Business_System SHALL set a deletion timestamp and 30-day recovery window
3. WHEN the 30-day recovery window expires, THE Business_System SHALL permanently delete the business and all associated data
4. WHEN a business is deleted, THE Business_System SHALL record the deletion in the audit trail
5. WHEN a soft-deleted business is within the recovery window, THE Business_System SHALL allow recovery upon user request
6. WHEN a business is hard-deleted, THE Business_System SHALL remove all associated audit trail entries for that business
7. IF the user does not own the business, THEN THE Business_System SHALL return a 403 Forbidden error

### Requirement 6: Data Export (NDPR Compliance)

**User Story:** As a user, I want to export all my business data for NDPR compliance.

#### Acceptance Criteria

1. WHEN a user requests data export, THE Business_System SHALL generate a JSON file containing all business data
2. WHEN generating export, THE Business_System SHALL include business profile, audit trail, and all associated metadata
3. WHEN export is generated, THE Business_System SHALL record the export request in the audit trail
4. THE Business_System SHALL complete export generation within 5 seconds for typical business profiles
5. WHEN export is requested for a soft-deleted business within recovery window, THE Business_System SHALL include the data with deletion status

### Requirement 7: Audit Trail

**User Story:** As a system administrator, I want comprehensive audit logging so that all business changes are traceable.

#### Acceptance Criteria

1. THE Business_System SHALL log all business operations: create, update, delete, restore, export
2. WHEN logging an audit event, THE Business_System SHALL record: event type, user ID, business ID, timestamp, IP address, and changes made
3. WHEN logging update events, THE Business_System SHALL capture both previous and new values for changed fields
4. THE Business_System SHALL retain audit logs for the lifetime of the business plus 7 years for compliance
5. WHEN a user requests their audit history, THE Business_System SHALL provide access logs as required by NDPR

### Requirement 8: API Response Standards

**User Story:** As a developer integrating with the business module, I want consistent API responses so that error handling is predictable.

#### Acceptance Criteria

1. THE Business_System SHALL return JSON responses with consistent structure for success and error cases
2. WHEN an error occurs, THE Business_System SHALL include error code, message, and field-specific details
3. THE Business_System SHALL use appropriate HTTP status codes (200, 201, 400, 403, 404, 500)
4. THE Business_System SHALL include request correlation IDs in all responses for debugging

### Requirement 9: Multi-Business Architecture Readiness

**User Story:** As a system architect, I want the module designed for future multi-business support while enforcing single business for MVP.

#### Acceptance Criteria

1. THE Business_System SHALL enforce one business per user constraint at the database level for MVP
2. THE Business_System SHALL design the data model to support multiple businesses per user in future versions
3. WHEN the single-business constraint is violated, THE Business_System SHALL return a clear error indicating the user already has a business
4. THE Business_System SHALL use user ID as a foreign key reference without embedding user data
