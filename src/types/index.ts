// Core type definitions for the auth module

export type UserStatus = "ACTIVE" | "SUSPENDED" | "DELETED";

export type ConsentType = "TERMS_OF_SERVICE" | "PRIVACY_POLICY" | "DATA_PROCESSING";

export type AuthEventType =
  | "SIGNUP"
  | "LOGIN_PASSWORD"
  | "LOGIN_MAGIC_LINK"
  | "LOGOUT"
  | "LOGOUT_ALL"
  | "PASSWORD_RESET_REQUEST"
  | "PASSWORD_RESET_COMPLETE"
  | "TOKEN_REFRESH"
  | "RATE_LIMIT_EXCEEDED";

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

export interface UserPublic {
  id: string;
  email: string;
  emailVerified: boolean;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
}

export interface TokenPayload {
  userId: string;
  email: string;
  iat: number;
  exp: number;
}
