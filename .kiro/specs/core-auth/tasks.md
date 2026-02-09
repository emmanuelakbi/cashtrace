# Implementation Plan: Core Authentication Module

## Overview

This implementation plan breaks down the core-auth module into incremental coding tasks. Each task builds on previous work, with property-based tests validating correctness at each stage. The module is implemented in TypeScript with PostgreSQL for persistence and Redis for session caching.

## Tasks

- [x] 1. Project setup and core infrastructure
  - [x] 1.1 Initialize project structure with TypeScript configuration
    - Create directory structure: `src/`, `src/services/`, `src/repositories/`, `src/middleware/`, `src/types/`, `src/utils/`
    - Configure TypeScript with strict mode
    - Set up ESLint and Prettier
    - _Requirements: Module independence_

  - [x] 1.2 Set up database schema and migrations
    - Create PostgreSQL migration files for all tables (users, refresh_tokens, magic_link_tokens, password_reset_tokens, consent_records, audit_logs)
    - Set up database connection pool
    - _Requirements: Data Models from design_

  - [x] 1.3 Set up testing framework
    - Configure Vitest for unit and integration tests
    - Configure fast-check for property-based testing
    - Set up test database and Redis for integration tests
    - _Requirements: Testing Strategy_

- [ ] 2. Implement validation utilities
  - [ ] 2.1 Implement email validator
    - Create `src/utils/validators/emailValidator.ts`
    - Implement RFC 5322 email validation
    - _Requirements: 1.1_

  - [ ] 2.2 Write property test for email validation
    - **Property 1: Email Validation Correctness**
    - **Validates: Requirements 1.1**

  - [ ] 2.3 Implement password validator
    - Create `src/utils/validators/passwordValidator.ts`
    - Implement minimum 8 characters and at least 1 number validation
    - _Requirements: 1.3_

  - [ ] 2.4 Write property test for password validation
    - **Property 2: Password Validation Correctness**
    - **Validates: Requirements 1.3**

- [ ] 3. Checkpoint - Validation utilities complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 4. Implement PasswordService
  - [ ] 4.1 Implement password hashing and verification
    - Create `src/services/passwordService.ts`
    - Implement bcrypt hashing with cost factor 12
    - Implement password verification
    - _Requirements: 1.4, 2.1_

  - [ ] 4.2 Write property test for password hashing round-trip
    - **Property 3: Password Hashing Round-Trip**
    - **Validates: Requirements 1.4, 2.1**

  - [ ] 4.3 Implement password reset token generation
    - Add secure token generation for password reset
    - Implement token validation with 1-hour expiration
    - _Requirements: 5.1, 5.2_

  - [ ] 4.4 Write property test for reset token expiration
    - **Property 10: Password Reset Token Expiration**
    - **Validates: Requirements 5.2**

- [ ] 5. Implement TokenService
  - [ ] 5.1 Implement JWT generation and validation
    - Create `src/services/tokenService.ts`
    - Implement access token generation with 15-minute expiration
    - Implement refresh token generation with 7-day expiration
    - Implement token validation
    - _Requirements: 4.1, 4.2_

  - [ ] 5.2 Write property test for token issuance
    - **Property 5: Successful Authentication Issues Valid Tokens**
    - **Validates: Requirements 2.2, 3.4, 4.1, 4.2**

  - [ ] 5.3 Implement refresh token rotation
    - Implement token refresh with old token invalidation
    - Store token hashes in database
    - _Requirements: 4.4_

  - [ ] 5.4 Write property test for refresh token rotation
    - **Property 8: Refresh Token Rotation**
    - **Validates: Requirements 4.4**

  - [ ] 5.5 Implement magic link token generation
    - Add cryptographically secure magic link token generation
    - Implement 15-minute expiration
    - Implement single-use enforcement
    - _Requirements: 3.1, 3.2, 3.5_

  - [ ] 5.6 Write property tests for magic link tokens
    - **Property 6: Magic Link Single-Use Enforcement**
    - **Property 7: Magic Link Expiration Enforcement**
    - **Validates: Requirements 3.2, 3.5, 3.6**

- [ ] 6. Checkpoint - Token services complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 7. Implement repositories
  - [ ] 7.1 Implement UserRepository
    - Create `src/repositories/userRepository.ts`
    - Implement create, findByEmail, findById, updatePassword
    - Implement case-insensitive email lookup
    - _Requirements: 1.2_

  - [ ] 7.2 Write property test for email uniqueness
    - **Property 4: Email Uniqueness Enforcement**
    - **Validates: Requirements 1.2**

  - [ ] 7.3 Implement SessionRepository
    - Create `src/repositories/sessionRepository.ts`
    - Implement refresh token storage with device fingerprint
    - Implement token revocation (single and all)
    - _Requirements: 4.5, 6.1, 6.2_

  - [ ] 7.4 Write property tests for session management
    - **Property 12: Logout Invalidates Current Session**
    - **Property 13: Logout-All Invalidates All Sessions**
    - **Validates: Requirements 6.1, 6.2**

  - [ ] 7.5 Implement ConsentRepository
    - Create `src/repositories/consentRepository.ts`
    - Implement consent record creation with version tracking
    - _Requirements: 1.5, 8.4_

  - [ ] 7.6 Write property test for consent records
    - **Property 18: Consent Record Creation**
    - **Validates: Requirements 1.5, 8.4**

  - [ ] 7.7 Implement AuditRepository
    - Create `src/repositories/auditRepository.ts`
    - Implement audit log creation with encryption
    - Implement query by user for NDPR compliance
    - _Requirements: 8.2, 8.5_

  - [ ] 7.8 Write property test for audit logging
    - **Property 17: Audit Trail Completeness**
    - **Validates: Requirements 2.5, 6.4, 7.4, 8.2**

- [ ] 8. Checkpoint - Repositories complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 9. Implement SessionService
  - [ ] 9.1 Implement session management logic
    - Create `src/services/sessionService.ts`
    - Implement session creation with device fingerprint
    - Implement device fingerprint validation
    - _Requirements: 4.5, 4.6_

  - [ ] 9.2 Write property test for device fingerprint security
    - **Property 9: Device Fingerprint Security**
    - **Validates: Requirements 4.6**

  - [ ] 9.3 Implement password reset session invalidation
    - Add logic to invalidate all sessions on password reset
    - _Requirements: 5.5_

  - [ ] 9.4 Write property test for password reset session invalidation
    - **Property 11: Password Reset Invalidates Sessions**
    - **Validates: Requirements 5.5**

- [ ] 10. Implement RateLimiter
  - [ ] 10.1 Implement rate limiting with Redis
    - Create `src/middleware/rateLimiter.ts`
    - Implement sliding window rate limiting
    - Configure 5 attempts per 15 minutes per IP
    - Implement separate tracking for different endpoints
    - _Requirements: 7.1, 7.3_

  - [ ] 10.2 Write property tests for rate limiting
    - **Property 14: Rate Limiting Enforcement**
    - **Property 15: Rate Limit Independence**
    - **Validates: Requirements 7.1, 7.2, 7.3**

- [ ] 11. Implement security middleware
  - [ ] 11.1 Implement CSRF protection
    - Create `src/middleware/csrfProtection.ts`
    - Implement double-submit cookie pattern
    - _Requirements: 8.1_

  - [ ] 11.2 Write property test for CSRF protection
    - **Property 16: CSRF Protection**
    - **Validates: Requirements 8.1**

  - [ ] 11.3 Implement secure cookie utilities
    - Create `src/utils/cookies.ts`
    - Implement cookie setting with httpOnly, secure, sameSite=strict
    - _Requirements: 2.3_

  - [ ] 11.4 Write property test for secure cookie attributes
    - **Property 21: Secure Cookie Attributes**
    - **Validates: Requirements 2.3**

- [ ] 12. Checkpoint - Middleware complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 13. Implement API response utilities
  - [ ] 13.1 Implement response formatters
    - Create `src/utils/responses.ts`
    - Implement success response formatter
    - Implement error response formatter with correlation IDs
    - _Requirements: 9.1, 9.2, 9.3, 9.4_

  - [ ] 13.2 Write property test for API response consistency
    - **Property 19: API Response Consistency**
    - **Validates: Requirements 1.6, 9.1, 9.2, 9.4**

  - [ ] 13.3 Implement uniform error messages for security
    - Ensure failed auth returns identical messages for existing/non-existing emails
    - _Requirements: 2.4, 5.6_

  - [ ] 13.4 Write property test for error message uniformity
    - **Property 20: Error Message Uniformity for Security**
    - **Validates: Requirements 2.4, 5.6**

- [ ] 14. Implement AuthController
  - [ ] 14.1 Implement signup endpoint
    - Create `src/controllers/authController.ts`
    - Implement POST /api/auth/signup
    - Wire up validation, user creation, consent recording
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ] 14.2 Implement login endpoint
    - Implement POST /api/auth/login
    - Wire up password verification, token issuance, audit logging
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [ ] 14.3 Implement magic link endpoints
    - Implement POST /api/auth/magic-link/request
    - Implement POST /api/auth/magic-link/verify
    - Wire up email service integration
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7_

  - [ ] 14.4 Implement password reset endpoints
    - Implement POST /api/auth/password/reset-request
    - Implement POST /api/auth/password/reset
    - Wire up email service and session invalidation
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6_

  - [ ] 14.5 Implement session management endpoints
    - Implement POST /api/auth/refresh
    - Implement POST /api/auth/logout
    - Implement POST /api/auth/logout-all
    - _Requirements: 4.3, 4.4, 6.1, 6.2, 6.3, 6.4_

- [ ] 15. Checkpoint - Controller complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 16. Implement email service integration
  - [ ] 16.1 Create email service adapter
    - Create `src/services/emailService.ts`
    - Implement interface for sending magic links and password reset emails
    - Implement graceful degradation when service unavailable
    - _Requirements: 3.3, 3.7, 5.3_

  - [ ] 16.2 Write unit tests for email service
    - Test magic link email formatting
    - Test password reset email formatting
    - Test graceful degradation behavior
    - _Requirements: 3.3, 3.7, 5.3_

- [ ] 17. Wire up application
  - [ ] 17.1 Create Express application with middleware
    - Create `src/app.ts`
    - Wire up rate limiter, CSRF protection, auth routes
    - Configure error handling middleware
    - _Requirements: All_

  - [ ] 17.2 Write integration tests for full auth flows
    - Test signup → login flow
    - Test magic link flow
    - Test password reset flow
    - Test token refresh flow
    - Test logout and logout-all flows
    - _Requirements: All_

- [ ] 18. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- All tasks including property tests are required for comprehensive correctness
- Each task references specific requirements for traceability
- Property tests use fast-check with minimum 100 iterations
- Integration tests require test database and Redis instances
- All sensitive data encrypted at rest using AES-256
