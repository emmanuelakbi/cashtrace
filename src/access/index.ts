/**
 * Access Control Module for CashTrace Security & Compliance
 *
 * Provides role-based access control (RBAC), business-level
 * data isolation, and permission management.
 *
 * @module access
 */

export type {
  Role,
  Permission,
  AccessDecision,
  AccessRequest,
  ElevatedAccessRequest,
  ElevatedAccessGrant,
  ElevatedAccessStatus,
} from './types.js';
export { AccessControlService } from './accessControlService.js';
