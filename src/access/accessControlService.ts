/**
 * Access Control Service for CashTrace Security & Compliance Module.
 *
 * Implements Role-Based Access Control (RBAC) with default-deny
 * (principle of least privilege). Users are assigned roles, and
 * permissions are checked against those roles for each access request.
 *
 * @module access
 */

import type {
  Permission,
  Role,
  AccessRequest,
  AccessDecision,
  ElevatedAccessRequest,
  ElevatedAccessGrant,
} from './types.js';

export class AccessControlService {
  /** roleId → Role */
  private readonly roles = new Map<string, Role>();
  /** userId → Set of roleIds */
  private readonly userRoles = new Map<string, Set<string>>();
  /** userId → Set of businessIds the user belongs to */
  private readonly userBusinesses = new Map<string, Set<string>>();
  /** requestId → ElevatedAccessRequest */
  private readonly elevatedRequests = new Map<string, ElevatedAccessRequest>();
  /** Active grants keyed by requestId */
  private readonly elevatedGrants = new Map<string, ElevatedAccessGrant>();
  /** Counter for generating request IDs */
  private elevatedRequestCounter = 0;

  /**
   * Register a role that can later be assigned to users.
   */
  addRole(role: Role): void {
    this.roles.set(role.id, role);
  }

  /**
   * Retrieve a role by its ID, or undefined if not found.
   */
  getRole(roleId: string): Role | undefined {
    return this.roles.get(roleId);
  }

  /**
   * Assign a role to a user. The role must already exist.
   * @returns true if the role was assigned, false if the role doesn't exist.
   */
  assignRole(userId: string, roleId: string): boolean {
    if (!this.roles.has(roleId)) {
      return false;
    }
    let set = this.userRoles.get(userId);
    if (!set) {
      set = new Set();
      this.userRoles.set(userId, set);
    }
    set.add(roleId);
    return true;
  }

  /**
   * Remove a role from a user.
   * @returns true if the role was removed, false if the user didn't have it.
   */
  removeRole(userId: string, roleId: string): boolean {
    const set = this.userRoles.get(userId);
    if (!set) return false;
    return set.delete(roleId);
  }

  /**
   * Get all role IDs currently assigned to a user.
   */
  getUserRoleIds(userId: string): string[] {
    const set = this.userRoles.get(userId);
    return set ? [...set] : [];
  }

  /**
   * Register a user as a member of a business.
   */
  registerBusinessMembership(userId: string, businessId: string): void {
    let set = this.userBusinesses.get(userId);
    if (!set) {
      set = new Set();
      this.userBusinesses.set(userId, set);
    }
    set.add(businessId);
  }

  /**
   * Check whether a user is a member of a business.
   */
  isBusinessMember(userId: string, businessId: string): boolean {
    const set = this.userBusinesses.get(userId);
    return set ? set.has(businessId) : false;
  }

  /**
   * Get all business IDs a user is a member of.
   */
  getUserBusinessIds(userId: string): string[] {
    const set = this.userBusinesses.get(userId);
    return set ? [...set] : [];
  }

  /**
   * Request temporary elevated access. Returns a request ID.
   * The request starts in 'pending' status and must be approved.
   */
  requestElevatedAccess(
    userId: string,
    businessId: string,
    permissions: Permission[],
    reason: string,
  ): string {
    const id = `elev-${++this.elevatedRequestCounter}`;
    const request: ElevatedAccessRequest = {
      id,
      userId,
      businessId,
      permissions,
      reason,
      status: 'pending',
      requestedAt: new Date(),
    };
    this.elevatedRequests.set(id, request);
    return id;
  }

  /**
   * Approve or deny an elevated access request.
   * If approved, creates a time-limited grant that expires after `durationMs`.
   * @returns true if the request was found and updated, false otherwise.
   */
  decideElevatedAccess(
    requestId: string,
    decision: 'approved' | 'denied',
    decidedBy: string,
    durationMs: number = 60 * 60 * 1000, // default 1 hour
  ): boolean {
    const request = this.elevatedRequests.get(requestId);
    if (!request || request.status !== 'pending') return false;

    request.status = decision;
    request.decidedAt = new Date();
    request.decidedBy = decidedBy;

    if (decision === 'approved') {
      const now = new Date();
      const grant: ElevatedAccessGrant = {
        requestId,
        userId: request.userId,
        businessId: request.businessId,
        permissions: request.permissions,
        grantedAt: now,
        expiresAt: new Date(now.getTime() + durationMs),
      };
      this.elevatedGrants.set(requestId, grant);
    }

    return true;
  }

  /**
   * Get an elevated access request by ID.
   */
  getElevatedRequest(requestId: string): ElevatedAccessRequest | undefined {
    return this.elevatedRequests.get(requestId);
  }

  /**
   * Get all active (non-expired) elevated grants for a user in a business.
   */
  getActiveElevatedGrants(
    userId: string,
    businessId: string,
    now: Date = new Date(),
  ): ElevatedAccessGrant[] {
    const grants: ElevatedAccessGrant[] = [];
    for (const grant of this.elevatedGrants.values()) {
      if (grant.userId === userId && grant.businessId === businessId && grant.expiresAt > now) {
        grants.push(grant);
      }
    }
    return grants;
  }

  /**
   * Check whether a user is allowed to perform the requested action.
   *
   * Implements default-deny: if no role grants the permission,
   * access is denied (principle of least privilege, Req 6.6).
   * Also enforces business-level data isolation (Req 6.2).
   * Considers active elevated access grants (Req 6.5).
   */
  checkAccess(request: AccessRequest): AccessDecision {
    const roleIds = this.userRoles.get(request.userId);

    if (!roleIds || roleIds.size === 0) {
      return {
        allowed: false,
        reason: 'User has no assigned roles',
      };
    }

    // Enforce business membership (Req 6.2)
    if (!this.isBusinessMember(request.userId, request.businessId)) {
      return {
        allowed: false,
        reason: 'User is not a member of the requested business',
      };
    }

    for (const roleId of roleIds) {
      const role = this.roles.get(roleId);
      if (!role) continue;

      // Role must belong to the same business as the request
      if (role.businessId !== request.businessId) continue;

      const allPermissions = this.collectPermissions(roleId);
      const matchedPermission = allPermissions.find((p) => this.matchesPermission(p, request));

      if (matchedPermission) {
        return {
          allowed: true,
          reason: 'Permission granted by role',
          matchedRole: role.name,
          matchedPermission,
        };
      }
    }

    // Check active elevated access grants (Req 6.5)
    const activeGrants = this.getActiveElevatedGrants(request.userId, request.businessId);
    for (const grant of activeGrants) {
      const matchedPermission = grant.permissions.find((p) => this.matchesPermission(p, request));
      if (matchedPermission) {
        return {
          allowed: true,
          reason: 'Permission granted by elevated access',
          matchedPermission,
        };
      }
    }

    return {
      allowed: false,
      reason: 'No role grants the required permission',
    };
  }

  /**
   * Collect all permissions for a role, including inherited permissions
   * from parent roles. Detects and prevents circular inheritance.
   */
  private collectPermissions(roleId: string): Permission[] {
    const permissions: Permission[] = [];
    const visited = new Set<string>();
    let currentId: string | undefined = roleId;

    while (currentId) {
      if (visited.has(currentId)) break; // circular inheritance guard
      visited.add(currentId);

      const role = this.roles.get(currentId);
      if (!role) break;

      permissions.push(...role.permissions);
      currentId = role.parentRoleId;
    }

    return permissions;
  }

  /**
   * Check if a permission entry matches the access request.
   * Supports wildcard '*' for resource matching.
   */
  private matchesPermission(permission: Permission, request: AccessRequest): boolean {
    if (permission.action !== request.action) return false;
    if (permission.resource === '*') return true;
    return permission.resource === request.resource;
  }
}
