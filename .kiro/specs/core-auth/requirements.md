# Requirements Document

## Introduction

The Core Authentication Module (core-auth) is the foundational security layer for CashTrace - an SME cashflow & compliance copilot designed for Nigerian small businesses. This module provides user registration, authentication, session management, and security features optimized for mobile-first usage on low-end Android devices. The design prioritizes simplicity for non-technical SME owners while maintaining robust security and NDPR compliance.

## Glossary

- **Auth_System**: The core authentication module responsible for user identity verification and session management
- **User**: A Nigerian SME owner or operator who accesses CashTrace
- **Magic_Link**: A time-limited, single-use URL sent via email that authenticates a user without requiring a password
- **Session_Token**: A JWT access token used to authenticate API requests
- **Refresh_Token**: A long-lived token used to obtain new session tokens without re-authentication
- **Rate_Limiter**: A component that restricts the number of requests from a single IP address within a time window
- **Email_Service**: An external service responsible for sending transactional emails (magic links, password resets)
- **NDPR**: Nigeria Data Protection Regulation - the legal framework governing personal data processing in Nigeria
- **Consent_Record**: A timestamped record of user agreement to data processing terms

## Requirements

### Requirement 1: User Registration

**User Story:** As a new user, I want to sign up with email and password so I can create my account.

#### Acceptance Criteria

1. WHEN a user submits a registration request with email and password, THE Auth_System SHALL validate the email format using RFC 5322 standards
2. WHEN a user submits a registration request, THE Auth_System SHALL verify the email is unique in the system
3. WHEN a user submits a password, THE Auth_System SHALL validate it contains minimum 8 characters and at least 1 number
4. WHEN validation passes, THE Auth_System SHALL hash the password using bcrypt with cost factor 12
5. WHEN a user is created, THE Auth_System SHALL record NDPR consent with timestamp and IP address
6. IF registration validation fails, THEN THE Auth_System SHALL return a consistent error response with specific field errors
7. WHEN a duplicate email is detected, THE Auth_System SHALL return the same response time as a successful check to prevent timing attacks

### Requirement 2: Password-Based Login

**User Story:** As a user, I want to login with my email and password so I can access my account.

#### Acceptance Criteria

1. WHEN a user submits valid credentials, THE Auth_System SHALL verify the password against the stored bcrypt hash
2. WHEN authentication succeeds, THE Auth_System SHALL issue a JWT session token and a refresh token
3. WHEN issuing tokens, THE Auth_System SHALL set secure cookies with httpOnly, secure, and sameSite=strict attributes
4. WHEN a login attempt fails, THE Auth_System SHALL return a generic error message without revealing whether email exists
5. WHEN login succeeds, THE Auth_System SHALL log the authentication event with timestamp, IP address, and device info
6. THE Auth_System SHALL complete login requests within 500ms under normal load

### Requirement 3: Magic Link Authentication

**User Story:** As a user, I want to login with magic link (passwordless) so I can access my account easily on mobile.

#### Acceptance Criteria

1. WHEN a user requests a magic link, THE Auth_System SHALL generate a cryptographically secure token
2. WHEN generating a magic link, THE Auth_System SHALL set expiration to 15 minutes from creation
3. WHEN a magic link is created, THE Email_Service SHALL send the link to the user's registered email
4. WHEN a user clicks a valid magic link, THE Auth_System SHALL authenticate the user and issue session tokens
5. WHEN a magic link is used, THE Auth_System SHALL invalidate it immediately to prevent reuse
6. IF the magic link has expired, THEN THE Auth_System SHALL return an expiration error and prompt for a new link
7. IF the Email_Service is unavailable, THEN THE Auth_System SHALL return a graceful error message and suggest password login

### Requirement 4: Session Management

**User Story:** As a user, I want to stay logged in on my device so I don't have to login repeatedly.

#### Acceptance Criteria

1. THE Auth_System SHALL issue refresh tokens with a 7-day expiration period
2. THE Auth_System SHALL issue session tokens with a 15-minute expiration period
3. WHEN a session token expires, THE Auth_System SHALL allow token refresh using a valid refresh token
4. WHEN refreshing tokens, THE Auth_System SHALL issue a new refresh token and invalidate the old one (rotation)
5. THE Auth_System SHALL store refresh tokens securely with device fingerprint association
6. WHEN a refresh token is used from a different device fingerprint, THE Auth_System SHALL invalidate all tokens for that user

### Requirement 5: Password Reset

**User Story:** As a user, I want to reset my password if I forget it.

#### Acceptance Criteria

1. WHEN a user requests password reset, THE Auth_System SHALL generate a secure reset token
2. WHEN generating a reset token, THE Auth_System SHALL set expiration to 1 hour from creation
3. WHEN a reset token is created, THE Email_Service SHALL send the reset link to the user's email
4. WHEN a user submits a new password with valid reset token, THE Auth_System SHALL update the password hash
5. WHEN password is reset, THE Auth_System SHALL invalidate all existing sessions for that user
6. WHEN a reset is requested for non-existent email, THE Auth_System SHALL return the same response as for existing email

### Requirement 6: Logout and Session Revocation

**User Story:** As a user, I want to logout from all devices if my phone is stolen.

#### Acceptance Criteria

1. WHEN a user requests logout, THE Auth_System SHALL invalidate the current session token and refresh token
2. WHEN a user requests logout from all devices, THE Auth_System SHALL invalidate all refresh tokens for that user
3. WHEN tokens are invalidated, THE Auth_System SHALL clear authentication cookies from the response
4. WHEN logout-all is performed, THE Auth_System SHALL log the security event with timestamp and reason

### Requirement 7: Rate Limiting

**User Story:** As a system administrator, I want to prevent brute force attacks so that user accounts remain secure.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL allow maximum 5 login attempts per IP address within a 15-minute window
2. WHEN rate limit is exceeded, THE Auth_System SHALL return a 429 status with retry-after header
3. THE Rate_Limiter SHALL track attempts separately for password login and magic link requests
4. WHEN rate limit is triggered, THE Auth_System SHALL log the event for security monitoring

### Requirement 8: Security and Compliance

**User Story:** As a system administrator, I want comprehensive security measures so that user data is protected and NDPR compliant.

#### Acceptance Criteria

1. THE Auth_System SHALL implement CSRF protection using double-submit cookie pattern
2. THE Auth_System SHALL log all authentication events to an audit trail
3. THE Auth_System SHALL encrypt sensitive data at rest using AES-256
4. THE Auth_System SHALL track user consent for NDPR compliance with version and timestamp
5. WHEN a user requests their data, THE Auth_System SHALL provide access logs as required by NDPR
6. THE Auth_System SHALL return consistent error response formats across all endpoints

### Requirement 9: API Response Standards

**User Story:** As a developer integrating with the auth module, I want consistent API responses so that error handling is predictable.

#### Acceptance Criteria

1. THE Auth_System SHALL return JSON responses with consistent structure for success and error cases
2. WHEN an error occurs, THE Auth_System SHALL include error code, message, and field-specific details
3. THE Auth_System SHALL use appropriate HTTP status codes (200, 400, 401, 403, 429, 500)
4. THE Auth_System SHALL include request correlation IDs in all responses for debugging
