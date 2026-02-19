/**
 * Type definitions for the Access Control module.
 */

export interface Permission {
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete';
  conditions?: Record<string, unknown>;
}

export interface Role {
  id: string;
  name: string;
  businessId: string;
  permissions: Permission[];
  parentRoleId?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccessRequest {
  userId: string;
  businessId: string;
  resource: string;
  action: 'create' | 'read' | 'update' | 'delete';
  resourceId?: string;
}

export interface AccessDecision {
  allowed: boolean;
  reason: string;
  matchedRole?: string;
  matchedPermission?: Permission;
}

export type ElevatedAccessStatus = 'pending' | 'approved' | 'denied';

export interface ElevatedAccessRequest {
  id: string;
  userId: string;
  businessId: string;
  permissions: Permission[];
  reason: string;
  status: ElevatedAccessStatus;
  requestedAt: Date;
  decidedAt?: Date;
  decidedBy?: string;
}

export interface ElevatedAccessGrant {
  requestId: string;
  userId: string;
  businessId: string;
  permissions: Permission[];
  grantedAt: Date;
  expiresAt: Date;
}
