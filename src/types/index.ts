/**
 * Core type definitions for the authentication module.
 * All types are derived from the design document data models.
 */

// ─── Enums ───────────────────────────────────────────────────────────────────

export enum UserStatus {
  ACTIVE = 'ACTIVE',
  SUSPENDED = 'SUSPENDED',
  DELETED = 'DELETED',
}

export enum ConsentType {
  TERMS_OF_SERVICE = 'TERMS_OF_SERVICE',
  PRIVACY_POLICY = 'PRIVACY_POLICY',
  DATA_PROCESSING = 'DATA_PROCESSING',
}

export enum AuthEventType {
  SIGNUP = 'SIGNUP',
  LOGIN_PASSWORD = 'LOGIN_PASSWORD',
  LOGIN_MAGIC_LINK = 'LOGIN_MAGIC_LINK',
  LOGOUT = 'LOGOUT',
  LOGOUT_ALL = 'LOGOUT_ALL',
  PASSWORD_RESET_REQUEST = 'PASSWORD_RESET_REQUEST',
  PASSWORD_RESET_COMPLETE = 'PASSWORD_RESET_COMPLETE',
  TOKEN_REFRESH = 'TOKEN_REFRESH',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
}

// ─── Data Models ─────────────────────────────────────────────────────────────

export interface User {
  id: string;
  email: string;
  passwordHash: string | null;
  emailVerified: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt: Date | null;
  status: UserStatus;
}

export interface RefreshToken {
  id: string;
  userId: string;
  tokenHash: string;
  deviceFingerprint: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt: Date | null;
  revokedReason: string | null;
}

export interface MagicLinkToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

export interface PasswordResetToken {
  id: string;
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  createdAt: Date;
  usedAt: Date | null;
}

export interface ConsentRecord {
  id: string;
  userId: string;
  consentType: ConsentType;
  consentVersion: string;
  ipAddress: string;
  userAgent: string;
  grantedAt: Date;
  revokedAt: Date | null;
}

export interface AuditLog {
  id: string;
  eventType: AuthEventType;
  userId: string | null;
  ipAddress: string;
  userAgent: string;
  requestId: string;
  success: boolean;
  errorCode: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
}

// ─── API Request Types ───────────────────────────────────────────────────────

export interface SignupRequest {
  email: string;
  password: string;
  consentToTerms: boolean;
  consentToPrivacy: boolean;
}

export interface LoginRequest {
  email: string;
  password: string;
  deviceFingerprint: string;
}

export interface MagicLinkRequest {
  email: string;
}

export interface MagicLinkVerifyRequest {
  token: string;
  deviceFingerprint: string;
}

export interface PasswordResetRequest {
  email: string;
}

export interface ResetPasswordRequest {
  token: string;
  newPassword: string;
}

export interface RefreshRequest {
  deviceFingerprint: string;
}

// ─── API Response Types ──────────────────────────────────────────────────────

export interface UserPublic {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface AuthResponse {
  success: boolean;
  user: UserPublic;
  expiresAt: Date;
}

export interface GenericResponse {
  success: boolean;
  message: string;
}

export interface ErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
    fields?: Record<string, string[]>;
  };
  requestId: string;
}

// ─── Token Types ─────────────────────────────────────────────────────────────

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: Date;
  refreshTokenExpiresAt: Date;
}

export interface TokenPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}

export interface MagicTokenPayload {
  userId: string;
  tokenId: string;
}

export interface ResetTokenPayload {
  userId: string;
  tokenId: string;
}

// ─── Service Types ───────────────────────────────────────────────────────────

export interface DeviceInfo {
  fingerprint: string;
  userAgent: string;
  ipAddress: string;
}

export interface Session {
  id: string;
  userId: string;
  deviceFingerprint: string;
  createdAt: Date;
  expiresAt: Date;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export interface AuthEvent {
  eventType: AuthEventType;
  userId: string | null;
  ipAddress: string;
  userAgent: string;
  timestamp: Date;
  success: boolean;
  metadata: Record<string, unknown>;
}

export interface SecurityEventFilter {
  eventType?: AuthEventType;
  userId?: string;
  ipAddress?: string;
  from: Date;
  to: Date;
  success?: boolean;
}

// ─── Error Codes ─────────────────────────────────────────────────────────────

export const AUTH_ERROR_CODES = {
  INVALID_CREDENTIALS: 'AUTH_INVALID_CREDENTIALS',
  EMAIL_EXISTS: 'AUTH_EMAIL_EXISTS',
  INVALID_EMAIL: 'AUTH_INVALID_EMAIL',
  WEAK_PASSWORD: 'AUTH_WEAK_PASSWORD',
  TOKEN_EXPIRED: 'AUTH_TOKEN_EXPIRED',
  TOKEN_INVALID: 'AUTH_TOKEN_INVALID',
  TOKEN_USED: 'AUTH_TOKEN_USED',
  RATE_LIMITED: 'AUTH_RATE_LIMITED',
  CSRF_INVALID: 'AUTH_CSRF_INVALID',
  CONSENT_REQUIRED: 'AUTH_CONSENT_REQUIRED',
  SESSION_INVALID: 'AUTH_SESSION_INVALID',
  DEVICE_MISMATCH: 'AUTH_DEVICE_MISMATCH',
  EMAIL_SERVICE_ERROR: 'EMAIL_SERVICE_ERROR',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];
