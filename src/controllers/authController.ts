/**
 * Authentication controller for handling auth-related API operations.
 *
 * Uses dependency injection for all external dependencies (repositories,
 * services, validators) to enable easy unit testing without mocks of
 * the module system.
 *
 * @module controllers/authController
 */

import type {
  SignupRequest,
  LoginRequest,
  MagicLinkRequest,
  MagicLinkVerifyRequest,
  PasswordResetRequest,
  ResetPasswordRequest,
  RefreshRequest,
  AuthResponse,
  GenericResponse,
  ErrorResponse,
  User,
  UserPublic,
  ValidationResult,
  ConsentRecord,
  AuditLog,
  TokenPair,
  MagicTokenPayload,
  ResetTokenPayload,
} from '../types/index.js';
import { ConsentType, AuthEventType, AUTH_ERROR_CODES } from '../types/index.js';
import {
  formatAuthResponse,
  formatErrorResponse,
  formatGenericResponse,
  formatValidationError,
  generateRequestId,
} from '../utils/responses.js';
import {
  buildLoginFailureResponse,
  buildPasswordResetRequestResponse,
} from '../utils/securityResponses.js';
import { clearAuthCookies } from '../utils/cookies.js';
import type { CookieResponse } from '../utils/cookies.js';

// ─── Dependency Interfaces ───────────────────────────────────────────────────

/** Subset of emailValidator used by the signup controller. */
export interface EmailValidator {
  validateEmail(email: string): ValidationResult;
}

/** Subset of passwordValidator used by the signup controller. */
export interface PasswordValidator {
  validatePassword(password: string): ValidationResult;
}

/** Subset of userRepository used by the signup controller. */
export interface UserRepository {
  findByEmail(email: string): Promise<User | null>;
  createUser(email: string, passwordHash: string): Promise<User>;
}

/** Extended user repository interface that also supports findById. */
export interface MagicLinkUserRepository {
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

/** Subset of passwordService used by the signup controller. */
export interface PasswordService {
  hashPassword(plaintext: string): Promise<string>;
  verifyPassword(plaintext: string, hash: string): Promise<boolean>;
}

/** Subset of tokenService used by the login controller. */
export interface TokenService {
  generateTokenPair(userId: string, deviceFingerprint: string): Promise<TokenPair>;
}

/** Extended token service interface for magic link operations. */
export interface MagicLinkTokenService extends TokenService {
  generateMagicToken(userId: string): Promise<string>;
  validateMagicToken(token: string): Promise<MagicTokenPayload | null>;
  invalidateMagicToken(token: string): Promise<void>;
}

/** Email service interface for sending magic link emails. */
export interface EmailService {
  sendMagicLink(email: string, token: string): Promise<void>;
}

/** Subset of consentRepository used by the signup controller. */
export interface ConsentRepository {
  createConsent(
    userId: string,
    consentType: ConsentType,
    consentVersion: string,
    ipAddress: string,
    userAgent: string,
  ): Promise<ConsentRecord>;
}

/** Subset of auditRepository used by the signup controller. */
export interface AuditRepository {
  createAuditLog(event: {
    eventType: AuthEventType;
    userId: string | null;
    ipAddress: string;
    userAgent: string;
    requestId: string;
    success: boolean;
    errorCode?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<AuditLog>;
}

/** All dependencies required by the signup controller. */
export interface SignupDependencies {
  emailValidator: EmailValidator;
  passwordValidator: PasswordValidator;
  userRepository: UserRepository;
  passwordService: PasswordService;
  consentRepository: ConsentRepository;
  auditRepository: AuditRepository;
}

/** All dependencies required by the login controller. */
export interface LoginDependencies {
  userRepository: UserRepository;
  passwordService: PasswordService;
  tokenService: TokenService;
  auditRepository: AuditRepository;
}

/** All dependencies required by the magic link controller. */
export interface MagicLinkDependencies {
  userRepository: MagicLinkUserRepository;
  tokenService: MagicLinkTokenService;
  emailService: EmailService;
  auditRepository: AuditRepository;
}

/** Extended password service interface for password reset operations. */
export interface PasswordResetPasswordService {
  hashPassword(plaintext: string): Promise<string>;
  generateResetToken(userId: string): Promise<string>;
  validateResetToken(token: string): Promise<ResetTokenPayload | null>;
}

/** Extended email service interface that also supports password reset emails. */
export interface PasswordResetEmailService {
  sendPasswordReset(email: string, token: string): Promise<void>;
}

/** Session service interface for invalidating all user sessions. */
export interface SessionService {
  invalidateAllUserSessions(userId: string): Promise<void>;
}

/** Extended user repository interface for password reset operations. */
export interface PasswordResetUserRepository {
  findByEmail(email: string): Promise<User | null>;
  updatePassword(userId: string, newPasswordHash: string): Promise<void>;
}

/** All dependencies required by the password reset request controller. */
export interface PasswordResetRequestDependencies {
  userRepository: MagicLinkUserRepository;
  passwordService: PasswordResetPasswordService;
  emailService: PasswordResetEmailService;
  auditRepository: AuditRepository;
}

/** All dependencies required by the reset password controller. */
export interface ResetPasswordDependencies {
  passwordValidator: PasswordValidator;
  passwordService: PasswordResetPasswordService;
  userRepository: PasswordResetUserRepository;
  sessionService: SessionService;
  auditRepository: AuditRepository;
}

/** Request context providing IP and user agent for audit/consent logging. */
export interface RequestContext {
  ipAddress: string;
  userAgent: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

/** Current version of consent terms. */
const CONSENT_VERSION = '1.0';

/** Session expiration: 15 minutes from now. */
const SESSION_EXPIRY_MS = 15 * 60 * 1000;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Map a User domain object to the public-facing UserPublic shape. */
function toUserPublic(user: User): UserPublic {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
  };
}

// ─── Signup ──────────────────────────────────────────────────────────────────

/**
 * Handle user signup.
 *
 * Flow:
 * 1. Validate email format (Req 1.1)
 * 2. Validate password strength (Req 1.3)
 * 3. Check consent flags (Req 1.5)
 * 4. Check email uniqueness (Req 1.2)
 * 5. Hash password (Req 1.4)
 * 6. Create user
 * 7. Record NDPR consent (Req 1.5)
 * 8. Log audit event (Req 8.2)
 * 9. Return success response (Req 1.6)
 *
 * @param request - The signup request data
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @returns AuthResponse on success, ErrorResponse on failure
 */
export async function signup(
  request: SignupRequest,
  context: RequestContext,
  deps: SignupDependencies,
): Promise<AuthResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // 1. Validate email format
  const emailResult = deps.emailValidator.validateEmail(request.email);
  if (!emailResult.valid) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.SIGNUP,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.INVALID_EMAIL,
    });
    return formatValidationError(
      AUTH_ERROR_CODES.INVALID_EMAIL,
      'Invalid email address',
      { email: emailResult.errors },
      requestId,
    );
  }

  // 2. Validate password strength
  const passwordResult = deps.passwordValidator.validatePassword(request.password);
  if (!passwordResult.valid) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.SIGNUP,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.WEAK_PASSWORD,
    });
    return formatValidationError(
      AUTH_ERROR_CODES.WEAK_PASSWORD,
      'Password does not meet requirements',
      { password: passwordResult.errors },
      requestId,
    );
  }

  // 3. Check consent flags
  if (!request.consentToTerms || !request.consentToPrivacy) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.SIGNUP,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.CONSENT_REQUIRED,
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.CONSENT_REQUIRED,
      'You must accept the terms of service and privacy policy to register',
      requestId,
    );
  }

  // 4. Check email uniqueness
  const existingUser = await deps.userRepository.findByEmail(request.email);
  if (existingUser) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.SIGNUP,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.EMAIL_EXISTS,
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.EMAIL_EXISTS,
      'An account with this email already exists',
      requestId,
    );
  }

  // 5. Hash password
  const passwordHash = await deps.passwordService.hashPassword(request.password);

  // 6. Create user
  const user = await deps.userRepository.createUser(request.email, passwordHash);

  // 7. Record NDPR consent (terms of service, privacy policy, data processing)
  await Promise.all([
    deps.consentRepository.createConsent(
      user.id,
      ConsentType.TERMS_OF_SERVICE,
      CONSENT_VERSION,
      context.ipAddress,
      context.userAgent,
    ),
    deps.consentRepository.createConsent(
      user.id,
      ConsentType.PRIVACY_POLICY,
      CONSENT_VERSION,
      context.ipAddress,
      context.userAgent,
    ),
    deps.consentRepository.createConsent(
      user.id,
      ConsentType.DATA_PROCESSING,
      CONSENT_VERSION,
      context.ipAddress,
      context.userAgent,
    ),
  ]);

  // 8. Log audit event
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.SIGNUP,
    userId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: { email: user.email },
  });

  // 9. Return success response
  const expiresAt = new Date(Date.now() + SESSION_EXPIRY_MS);
  return formatAuthResponse(toUserPublic(user), expiresAt);
}

// ─── Login ───────────────────────────────────────────────────────────────────

/**
 * Handle password-based login.
 *
 * Flow:
 * 1. Find user by email (Req 2.1)
 * 2. If not found, return uniform failure response (Req 2.4)
 * 3. Verify password against stored hash (Req 2.1)
 * 4. If wrong, return same uniform failure response (Req 2.4)
 * 5. Generate token pair (Req 2.2)
 * 6. Log successful audit event (Req 2.5)
 * 7. Return AuthResponse with user data
 *
 * @param request - The login request data
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @returns AuthResponse on success, ErrorResponse on failure
 */
export async function login(
  request: LoginRequest,
  context: RequestContext,
  deps: LoginDependencies,
): Promise<AuthResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // 1. Find user by email
  const user = await deps.userRepository.findByEmail(request.email);

  // 2. If user not found, return uniform login failure (Req 2.4)
  if (!user) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.LOGIN_PASSWORD,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
      metadata: { reason: 'user_not_found' },
    });
    return buildLoginFailureResponse(requestId);
  }

  // 3. Verify password against stored hash (Req 2.1)
  const passwordValid = await deps.passwordService.verifyPassword(
    request.password,
    user.passwordHash ?? '',
  );

  // 4. If password wrong, return same uniform failure (Req 2.4)
  if (!passwordValid) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.LOGIN_PASSWORD,
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.INVALID_CREDENTIALS,
      metadata: { reason: 'invalid_password' },
    });
    return buildLoginFailureResponse(requestId);
  }

  // 5. Generate token pair (Req 2.2)
  const tokenPair = await deps.tokenService.generateTokenPair(user.id, request.deviceFingerprint);

  // 6. Log successful audit event (Req 2.5)
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.LOGIN_PASSWORD,
    userId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: { deviceFingerprint: request.deviceFingerprint },
  });

  // 7. Return AuthResponse with user data
  return formatAuthResponse(toUserPublic(user), tokenPair.accessTokenExpiresAt);
}

// ─── Magic Link Request ──────────────────────────────────────────────────────

/**
 * Generic success message for magic link requests.
 * Returned for both existing and non-existing emails to prevent enumeration.
 */
export const MAGIC_LINK_REQUEST_MESSAGE =
  'If an account with that email exists, a magic link has been sent.';

/**
 * Error message when email service is unavailable (Req 3.7).
 */
export const EMAIL_SERVICE_UNAVAILABLE_MESSAGE =
  'Unable to send magic link at this time. Please try logging in with your password instead.';

/**
 * Handle magic link request.
 *
 * Flow:
 * 1. Find user by email
 * 2. If not found, return generic success (don't reveal email existence)
 * 3. Generate magic link token (Req 3.1, 3.2)
 * 4. Send email with magic link (Req 3.3)
 * 5. If email service fails, return graceful error suggesting password login (Req 3.7)
 * 6. Log audit event
 * 7. Return generic success response
 *
 * @param request - The magic link request data
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @returns GenericResponse on success, ErrorResponse on email service failure
 */
export async function requestMagicLink(
  request: MagicLinkRequest,
  context: RequestContext,
  deps: MagicLinkDependencies,
): Promise<GenericResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // 1. Find user by email
  const user = await deps.userRepository.findByEmail(request.email);

  // 2. If not found, return generic success to prevent email enumeration
  if (!user) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.LOGIN_MAGIC_LINK,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: null,
      metadata: { reason: 'user_not_found' },
    });
    return formatGenericResponse(MAGIC_LINK_REQUEST_MESSAGE);
  }

  // 3. Generate magic link token (Req 3.1, 3.2)
  const magicToken = await deps.tokenService.generateMagicToken(user.id);

  // 4. Send email with magic link (Req 3.3)
  try {
    await deps.emailService.sendMagicLink(user.email, magicToken);
  } catch {
    // 5. If email service fails, return graceful error (Req 3.7)
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.LOGIN_MAGIC_LINK,
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR,
      metadata: { reason: 'email_service_failure' },
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR,
      EMAIL_SERVICE_UNAVAILABLE_MESSAGE,
      requestId,
    );
  }

  // 6. Log audit event
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.LOGIN_MAGIC_LINK,
    userId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: { email: user.email },
  });

  // 7. Return generic success response
  return formatGenericResponse(MAGIC_LINK_REQUEST_MESSAGE);
}

// ─── Magic Link Verify ───────────────────────────────────────────────────────

/**
 * Handle magic link verification.
 *
 * Flow:
 * 1. Validate magic token (Req 3.4)
 * 2. If invalid/expired/used, return appropriate error (Req 3.5, 3.6)
 * 3. Invalidate the token — single-use (Req 3.5)
 * 4. Find user to build response
 * 5. Generate token pair for the user (Req 3.4)
 * 6. Log audit event
 * 7. Return AuthResponse
 *
 * @param request - The magic link verify request data
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @returns AuthResponse on success, ErrorResponse on failure
 */
export async function verifyMagicLink(
  request: MagicLinkVerifyRequest,
  context: RequestContext,
  deps: MagicLinkDependencies,
): Promise<AuthResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // 1. Validate magic token
  const payload = await deps.tokenService.validateMagicToken(request.token);

  // 2. If invalid/expired/used, return appropriate error
  if (!payload) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.LOGIN_MAGIC_LINK,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
      metadata: { reason: 'invalid_magic_token' },
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.TOKEN_INVALID,
      'The magic link is invalid or has expired. Please request a new one.',
      requestId,
    );
  }

  // 3. Invalidate the token — single-use (Req 3.5)
  await deps.tokenService.invalidateMagicToken(request.token);

  // 4. Find user by ID from token payload
  const user = await deps.userRepository.findById(payload.userId);
  if (!user) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.LOGIN_MAGIC_LINK,
      userId: payload.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
      metadata: { reason: 'user_not_found_for_token' },
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.TOKEN_INVALID,
      'The magic link is invalid or has expired. Please request a new one.',
      requestId,
    );
  }

  // 5. Generate token pair for the user (Req 3.4)
  const tokenPair = await deps.tokenService.generateTokenPair(user.id, request.deviceFingerprint);

  // 6. Log audit event
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.LOGIN_MAGIC_LINK,
    userId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: { deviceFingerprint: request.deviceFingerprint },
  });

  // 7. Return AuthResponse
  return formatAuthResponse(toUserPublic(user), tokenPair.accessTokenExpiresAt);
}

// ─── Password Reset Request ──────────────────────────────────────────────────

/**
 * Error message when email service is unavailable during password reset.
 */
export const PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE =
  'Unable to send password reset email at this time. Please try again later.';

/**
 * Handle password reset request.
 *
 * Flow:
 * 1. Find user by email
 * 2. If not found, return same generic response as if found (Req 5.6)
 * 3. Generate reset token (Req 5.1)
 * 4. Send reset email (Req 5.3)
 * 5. If email service fails, return graceful error
 * 6. Log audit event
 * 7. Return generic success response (same as step 2)
 *
 * @param request - The password reset request data
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @returns GenericResponse on success, ErrorResponse on email service failure
 */
export async function requestPasswordReset(
  request: PasswordResetRequest,
  context: RequestContext,
  deps: PasswordResetRequestDependencies,
): Promise<GenericResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // 1. Find user by email
  const user = await deps.userRepository.findByEmail(request.email);

  // 2. If not found, return same generic response (Req 5.6)
  if (!user) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.PASSWORD_RESET_REQUEST,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: null,
      metadata: { reason: 'user_not_found' },
    });
    return buildPasswordResetRequestResponse();
  }

  // 3. Generate reset token (Req 5.1)
  const resetToken = await deps.passwordService.generateResetToken(user.id);

  // 4. Send reset email (Req 5.3)
  try {
    await deps.emailService.sendPasswordReset(user.email, resetToken);
  } catch {
    // 5. If email service fails, return graceful error
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.PASSWORD_RESET_REQUEST,
      userId: user.id,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR,
      metadata: { reason: 'email_service_failure' },
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.EMAIL_SERVICE_ERROR,
      PASSWORD_RESET_EMAIL_UNAVAILABLE_MESSAGE,
      requestId,
    );
  }

  // 6. Log audit event
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.PASSWORD_RESET_REQUEST,
    userId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: { email: user.email },
  });

  // 7. Return generic success response (same as step 2)
  return buildPasswordResetRequestResponse();
}

// ─── Password Reset ──────────────────────────────────────────────────────────

/**
 * Handle password reset (completing the reset with a new password).
 *
 * Flow:
 * 1. Validate reset token (Req 5.1, 5.2)
 * 2. If invalid/expired, return error
 * 3. Validate new password strength (Req 1.3)
 * 4. Hash new password (Req 5.4)
 * 5. Update user password (Req 5.4)
 * 6. Invalidate all sessions (Req 5.5)
 * 7. Log audit event
 * 8. Return generic success response
 *
 * @param request - The reset password request data
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @returns GenericResponse on success, ErrorResponse on failure
 */
export async function resetPassword(
  request: ResetPasswordRequest,
  context: RequestContext,
  deps: ResetPasswordDependencies,
): Promise<GenericResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // 1. Validate reset token
  const payload = await deps.passwordService.validateResetToken(request.token);

  // 2. If invalid/expired, return error
  if (!payload) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.PASSWORD_RESET_COMPLETE,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
      metadata: { reason: 'invalid_reset_token' },
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.TOKEN_INVALID,
      'The password reset link is invalid or has expired. Please request a new one.',
      requestId,
    );
  }

  // 3. Validate new password strength
  const passwordResult = deps.passwordValidator.validatePassword(request.newPassword);
  if (!passwordResult.valid) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.PASSWORD_RESET_COMPLETE,
      userId: payload.userId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.WEAK_PASSWORD,
      metadata: { reason: 'weak_password' },
    });
    return formatValidationError(
      AUTH_ERROR_CODES.WEAK_PASSWORD,
      'Password does not meet requirements',
      { password: passwordResult.errors },
      requestId,
    );
  }

  // 4. Hash new password
  const newPasswordHash = await deps.passwordService.hashPassword(request.newPassword);

  // 5. Update user password (Req 5.4)
  await deps.userRepository.updatePassword(payload.userId, newPasswordHash);

  // 6. Invalidate all sessions (Req 5.5)
  await deps.sessionService.invalidateAllUserSessions(payload.userId);

  // 7. Log audit event
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.PASSWORD_RESET_COMPLETE,
    userId: payload.userId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: {},
  });

  // 8. Return generic success response
  return formatGenericResponse('Your password has been reset successfully.');
}

// ─── Session Management Dependency Interfaces ────────────────────────────────

/** Token service interface for session management (refresh, revoke). */
export interface SessionManagementTokenService {
  refreshTokens(refreshToken: string, deviceFingerprint: string): Promise<TokenPair>;
  revokeRefreshToken(tokenId: string): Promise<void>;
  revokeAllUserTokens(userId: string): Promise<void>;
}

/** User repository interface for session management (lookup by ID). */
export interface SessionManagementUserRepository {
  findById(id: string): Promise<User | null>;
}

/** All dependencies required by the refresh controller. */
export interface RefreshDependencies {
  tokenService: SessionManagementTokenService;
  userRepository: SessionManagementUserRepository;
  auditRepository: AuditRepository;
}

/** All dependencies required by the logout controller. */
export interface LogoutDependencies {
  tokenService: SessionManagementTokenService;
  auditRepository: AuditRepository;
}

/** All dependencies required by the logout-all controller. */
export interface LogoutAllDependencies {
  tokenService: SessionManagementTokenService;
  auditRepository: AuditRepository;
}

// ─── Refresh ─────────────────────────────────────────────────────────────────

/**
 * Handle token refresh.
 *
 * Flow:
 * 1. Extract refresh token from cookie/request (Req 4.3)
 * 2. Refresh tokens with rotation via tokenService (Req 4.4)
 * 3. If token invalid/expired, return error (AUTH_TOKEN_INVALID, AUTH_TOKEN_EXPIRED)
 * 4. If device fingerprint mismatch, tokenService invalidates all tokens (Req 4.6)
 *    and throws AUTH_DEVICE_MISMATCH
 * 5. Look up user for response
 * 6. Log audit event
 * 7. Return AuthResponse with new tokens
 *
 * @param request - The refresh request data (deviceFingerprint)
 * @param refreshToken - The refresh token extracted from httpOnly cookie
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @returns AuthResponse on success, ErrorResponse on failure
 */
export async function refresh(
  request: RefreshRequest,
  refreshToken: string | undefined,
  context: RequestContext,
  deps: RefreshDependencies,
): Promise<AuthResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // 1. Validate refresh token is present
  if (!refreshToken) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.TOKEN_REFRESH,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode: AUTH_ERROR_CODES.TOKEN_INVALID,
      metadata: { reason: 'missing_refresh_token' },
    });
    return formatErrorResponse(
      AUTH_ERROR_CODES.TOKEN_INVALID,
      'Refresh token is missing or invalid.',
      requestId,
    );
  }

  // 2. Refresh tokens with rotation (Req 4.3, 4.4)
  let tokenPair: TokenPair;
  try {
    tokenPair = await deps.tokenService.refreshTokens(refreshToken, request.deviceFingerprint);
  } catch (error: unknown) {
    const errorCode = extractErrorCode(error);

    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.TOKEN_REFRESH,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: false,
      errorCode,
      metadata: {
        reason:
          errorCode === AUTH_ERROR_CODES.DEVICE_MISMATCH
            ? 'device_mismatch'
            : 'token_refresh_failed',
      },
    });

    if (errorCode === AUTH_ERROR_CODES.DEVICE_MISMATCH) {
      return formatErrorResponse(
        AUTH_ERROR_CODES.DEVICE_MISMATCH,
        'Device fingerprint mismatch. All sessions have been revoked for security.',
        requestId,
      );
    }

    if (errorCode === AUTH_ERROR_CODES.TOKEN_EXPIRED) {
      return formatErrorResponse(
        AUTH_ERROR_CODES.TOKEN_EXPIRED,
        'Refresh token has expired. Please log in again.',
        requestId,
      );
    }

    return formatErrorResponse(
      AUTH_ERROR_CODES.TOKEN_INVALID,
      'Refresh token is missing or invalid.',
      requestId,
    );
  }

  // 3. Extract userId from the new token pair to look up user
  //    We decode the userId from the access token payload (sub claim)
  //    For simplicity, we use a helper that parses the JWT without full validation
  //    since we just generated it ourselves.
  const userId = extractUserIdFromAccessToken(tokenPair.accessToken);
  if (!userId) {
    return formatErrorResponse(
      AUTH_ERROR_CODES.INTERNAL_ERROR,
      'An unexpected error occurred. Please try again later.',
      requestId,
    );
  }

  // 4. Look up user for response
  const user = await deps.userRepository.findById(userId);
  if (!user) {
    return formatErrorResponse(
      AUTH_ERROR_CODES.TOKEN_INVALID,
      'Refresh token is missing or invalid.',
      requestId,
    );
  }

  // 5. Log audit event
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.TOKEN_REFRESH,
    userId: user.id,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: { deviceFingerprint: request.deviceFingerprint },
  });

  // 6. Return AuthResponse with new tokens
  return formatAuthResponse(toUserPublic(user), tokenPair.accessTokenExpiresAt);
}

// ─── Logout ──────────────────────────────────────────────────────────────────

/**
 * Handle single-session logout.
 *
 * Flow:
 * 1. Extract refresh token from cookie/request
 * 2. Revoke the refresh token (Req 6.1)
 * 3. Log audit event (Req 6.1)
 * 4. Return generic success response
 *
 * @param refreshToken - The refresh token extracted from httpOnly cookie
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @param res - Response object for clearing cookies (Req 6.3)
 * @returns GenericResponse on success, ErrorResponse on failure
 */
export async function logout(
  refreshToken: string | undefined,
  context: RequestContext,
  deps: LogoutDependencies,
  res?: CookieResponse,
): Promise<GenericResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // Clear auth cookies regardless of token validity (Req 6.3)
  if (res) {
    clearAuthCookies(res);
  }

  // 1. If no refresh token, still return success (idempotent logout)
  if (!refreshToken) {
    await deps.auditRepository.createAuditLog({
      eventType: AuthEventType.LOGOUT,
      userId: null,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      requestId,
      success: true,
      metadata: { reason: 'no_refresh_token' },
    });
    return formatGenericResponse('Logged out successfully.');
  }

  // 2. Revoke the refresh token (Req 6.1)
  await deps.tokenService.revokeRefreshToken(refreshToken);

  // 3. Log audit event (Req 6.1)
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.LOGOUT,
    userId: null,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: {},
  });

  // 4. Return generic success response
  return formatGenericResponse('Logged out successfully.');
}

// ─── Logout All ──────────────────────────────────────────────────────────────

/**
 * Handle logout from all devices.
 *
 * Flow:
 * 1. Get userId from authenticated session
 * 2. Revoke all refresh tokens for user (Req 6.2)
 * 3. Log security event with timestamp and reason (Req 6.4)
 * 4. Return generic success response
 *
 * @param userId - The authenticated user's ID
 * @param context - Request context (IP, user agent)
 * @param deps - Injected dependencies
 * @param res - Response object for clearing cookies (Req 6.3)
 * @returns GenericResponse on success, ErrorResponse on failure
 */
export async function logoutAll(
  userId: string,
  context: RequestContext,
  deps: LogoutAllDependencies,
  res?: CookieResponse,
): Promise<GenericResponse | ErrorResponse> {
  const requestId = generateRequestId();

  // Clear auth cookies (Req 6.3)
  if (res) {
    clearAuthCookies(res);
  }

  // 1. Validate userId is present
  if (!userId) {
    return formatErrorResponse(
      AUTH_ERROR_CODES.SESSION_INVALID,
      'No active session found.',
      requestId,
    );
  }

  // 2. Revoke all refresh tokens for user (Req 6.2)
  await deps.tokenService.revokeAllUserTokens(userId);

  // 3. Log security event with timestamp and reason (Req 6.4)
  await deps.auditRepository.createAuditLog({
    eventType: AuthEventType.LOGOUT_ALL,
    userId,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    requestId,
    success: true,
    metadata: {
      reason: 'user_requested_logout_all',
      timestamp: new Date().toISOString(),
    },
  });

  // 4. Return generic success response
  return formatGenericResponse('Logged out from all devices successfully.');
}

// ─── Internal Helpers ────────────────────────────────────────────────────────

/**
 * Extract an error code from an unknown error thrown by tokenService.
 * The tokenService is expected to throw errors with a `code` property
 * matching AUTH_ERROR_CODES values.
 */
function extractErrorCode(error: unknown): string {
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    typeof (error as { code: unknown }).code === 'string'
  ) {
    return (error as { code: string }).code;
  }
  return AUTH_ERROR_CODES.TOKEN_INVALID;
}

/**
 * Extract userId from a JWT access token by decoding the payload (no verification).
 * This is safe because we just generated the token ourselves in the refresh flow.
 */
function extractUserIdFromAccessToken(accessToken: string): string | null {
  try {
    const parts = accessToken.split('.');
    if (parts.length !== 3) return null;
    const payloadPart = parts[1];
    if (!payloadPart) return null;
    const payload = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf-8'));
    return payload.userId ?? payload.sub ?? null;
  } catch {
    return null;
  }
}
