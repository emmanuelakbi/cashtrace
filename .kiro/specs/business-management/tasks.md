# Implementation Plan: Business Management Module

## Overview

This implementation plan breaks down the business-management module into incremental coding tasks. Each task builds on previous work, with property-based tests validating correctness at each stage. The module is implemented in TypeScript with Prisma ORM and PostgreSQL, following the same patterns established in core-auth.

## Tasks

- [ ] 1. Project setup and database schema
  - [ ] 1.1 Create module directory structure
    - Create directories: `src/modules/business/`, `src/modules/business/services/`, `src/modules/business/repositories/`, `src/modules/business/controllers/`, `src/modules/business/types/`, `src/modules/business/validators/`
    - _Requirements: Module independence_

  - [ ] 1.2 Add Prisma schema for business entities
    - Add BusinessSector, Currency, and BusinessEventType enums to schema.prisma
    - Add Business model with soft delete fields (deletedAt, hardDeleteAt)
    - Add BusinessAuditLog model with relation to Business
    - Add unique constraint on userId for single business per user
    - _Requirements: Data Models from design_

  - [ ] 1.3 Generate and run database migration
    - Run `prisma migrate dev` to create migration
    - Verify indexes and constraints are created
    - _Requirements: Data Models from design_

- [ ] 2. Implement validation utilities
  - [ ] 2.1 Implement business name validator
    - Create `src/modules/business/validators/nameValidator.ts`
    - Implement validation for 2-100 character requirement
    - Handle edge cases: whitespace trimming, unicode characters
    - _Requirements: 1.2, 3.2_

  - [ ] 2.2 Write property test for name validation
    - **Property 1: Name Validation Correctness**
    - **Validates: Requirements 1.2, 3.2**

  - [ ] 2.3 Implement sector validator
    - Create `src/modules/business/validators/sectorValidator.ts`
    - Implement validation against 11 predefined Nigerian SME sectors
    - Return list of valid options on validation failure
    - _Requirements: 2.1, 2.3_

  - [ ] 2.4 Write property test for sector validation
    - **Property 2: Sector Validation Correctness**
    - **Validates: Requirements 2.1, 2.3**

- [ ] 3. Checkpoint - Validation utilities complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement BusinessRepository
  - [ ] 4.1 Implement core repository methods
    - Create `src/modules/business/repositories/businessRepository.ts`
    - Implement create, findByUserId, findById, update methods
    - Implement findByUserId to exclude soft-deleted businesses by default
    - Implement findByUserIdIncludeDeleted for recovery scenarios
    - _Requirements: 1.1, 4.1, 4.4_

  - [ ] 4.2 Implement soft delete and restore methods
    - Add softDelete method that sets deletedAt and hardDeleteAt (30 days)
    - Add restore method that clears deletedAt and hardDeleteAt
    - Add hardDelete method for permanent removal
    - Add findPendingHardDelete for batch processing
    - _Requirements: 5.1, 5.2, 5.3, 5.5_

  - [ ] 4.3 Write property test for single business constraint
    - **Property 4: Single Business Per User Constraint**
    - **Validates: Requirements 1.3, 9.1, 9.3**

- [ ] 5. Implement AuditService
  - [ ] 5.1 Implement audit logging service
    - Create `src/modules/business/services/auditService.ts`
    - Implement logEvent method for all business operations
    - Capture previous and new values for update operations
    - Include eventType, userId, businessId, timestamp, ipAddress, requestId
    - _Requirements: 1.5, 3.4, 5.4, 6.3, 7.1, 7.2, 7.3_

  - [ ] 5.2 Implement audit query methods
    - Add getBusinessAuditHistory for business-specific logs
    - Add getUserAuditHistory for NDPR access requests
    - Add deleteBusinessAuditLogs for hard delete cascade
    - _Requirements: 7.5, 5.6_

  - [ ] 5.3 Write property test for audit trail completeness
    - **Property 11: Audit Trail Completeness**
    - **Validates: Requirements 1.5, 3.4, 5.4, 6.3, 7.1, 7.2, 7.3, 7.5**

- [ ] 6. Checkpoint - Repository and audit service complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement BusinessService
  - [ ] 7.1 Implement business creation
    - Create `src/modules/business/services/businessService.ts`
    - Implement createBusiness with name/sector validation
    - Apply default values: NGN currency, OTHER sector
    - Check for existing business before creation
    - Log creation event to audit trail
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 2.4_

  - [ ] 7.2 Write property test for default values
    - **Property 3: Default Values on Creation**
    - **Validates: Requirements 1.4, 2.4**

  - [ ] 7.3 Implement business retrieval
    - Add getBusinessByUserId method
    - Add getBusinessById with ownership validation
    - Return null/404 for soft-deleted businesses in normal queries
    - _Requirements: 4.1, 4.2, 4.3, 4.4_

  - [ ] 7.4 Write property test for business retrieval
    - **Property 6: Business Retrieval Correctness**
    - **Validates: Requirements 4.1, 4.4**

  - [ ] 7.5 Implement business update
    - Add updateBusiness method with ownership check
    - Validate name and sector on update
    - Log update event with previous and new values
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ] 7.6 Write property test for ownership enforcement
    - **Property 5: Ownership Enforcement**
    - **Validates: Requirements 3.1, 3.6, 5.7**

  - [ ] 7.7 Implement soft delete and restore
    - Add softDeleteBusiness method with ownership check
    - Set deletedAt to now, hardDeleteAt to now + 30 days
    - Add restoreBusiness method for recovery within window
    - Log delete and restore events
    - _Requirements: 5.1, 5.2, 5.4, 5.5_

  - [ ] 7.8 Write property tests for soft delete behavior
    - **Property 7: Soft Delete Behavior**
    - **Property 8: Business Restore Within Recovery Window**
    - **Validates: Requirements 5.1, 5.2, 5.5**

- [ ] 8. Checkpoint - Business service complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement ExportService
  - [ ] 9.1 Implement data export generation
    - Create `src/modules/business/services/exportService.ts`
    - Implement generateExport method
    - Include business profile, audit trail, and metadata
    - Handle soft-deleted businesses within recovery window
    - Log export event to audit trail
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [ ] 9.2 Write property test for export completeness
    - **Property 10: Data Export Completeness**
    - **Validates: Requirements 6.1, 6.2, 6.5**

- [ ] 10. Implement hard delete scheduler
  - [ ] 10.1 Create hard delete job
    - Create `src/modules/business/jobs/hardDeleteJob.ts`
    - Query businesses where hardDeleteAt < now
    - Delete audit logs first, then business record
    - Log hard delete events before removal
    - _Requirements: 5.3, 5.6_

  - [ ] 10.2 Write property test for hard delete cascade
    - **Property 9: Hard Delete Cascade**
    - **Validates: Requirements 5.3, 5.6**

- [ ] 11. Checkpoint - Services complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 12. Implement API response utilities
  - [ ] 12.1 Create response formatters
    - Create `src/modules/business/utils/responses.ts`
    - Implement success response formatter with requestId
    - Implement error response formatter with code, message, fields
    - Implement sector display name mapper
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ] 12.2 Write property test for API response consistency
    - **Property 12: API Response Consistency**
    - **Validates: Requirements 1.6, 1.7, 3.5, 4.3, 8.1, 8.2, 8.3, 8.4**

- [ ] 13. Implement BusinessController
  - [ ] 13.1 Implement POST /api/business endpoint
    - Create `src/modules/business/controllers/businessController.ts`
    - Handle business creation with validation
    - Return 201 Created with business data
    - Return 400 for validation errors or existing business
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7_

  - [ ] 13.2 Implement GET /api/business endpoint
    - Return current user's business profile
    - Return 404 if no business exists
    - Include all profile fields in response
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ] 13.3 Implement PUT /api/business endpoint
    - Handle business updates with validation
    - Verify ownership before update
    - Return 200 with updated business data
    - Return 403 for ownership violations
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ] 13.4 Implement DELETE /api/business endpoint
    - Perform soft delete with 30-day recovery window
    - Verify ownership before deletion
    - Return 200 with success message
    - Return 403 for ownership violations
    - _Requirements: 5.1, 5.2, 5.4, 5.7_

  - [ ] 13.5 Implement POST /api/business/export endpoint
    - Generate and return JSON export
    - Include business, audit trail, and metadata
    - Handle soft-deleted businesses within recovery window
    - _Requirements: 6.1, 6.2, 6.3, 6.5_

  - [ ] 13.6 Implement POST /api/business/restore endpoint
    - Restore soft-deleted business within recovery window
    - Verify ownership and recovery window validity
    - Return 200 with restored business data
    - Return 400 if recovery window expired
    - _Requirements: 5.5_

- [ ] 14. Checkpoint - Controller complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 15. Wire up routes and middleware
  - [ ] 15.1 Create business routes
    - Create `src/modules/business/routes.ts`
    - Wire up all endpoints with auth middleware
    - Add request validation middleware
    - Add correlation ID middleware
    - _Requirements: All_

  - [ ] 15.2 Register module with main application
    - Add business routes to main Express app
    - Ensure auth middleware from core-auth is applied
    - _Requirements: Module integration_

  - [ ] 15.3 Write integration tests for full business flows
    - Test create → update → delete → restore flow
    - Test NDPR export flow
    - Test ownership validation across endpoints
    - Test single business constraint
    - _Requirements: All_

- [ ] 16. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive correctness
- Each task references specific requirements for traceability
- Property tests use fast-check with minimum 100 iterations
- Integration tests require test database instance
- Module depends only on core-auth for user authentication context
- Hard delete job should be scheduled to run daily via cron or similar
