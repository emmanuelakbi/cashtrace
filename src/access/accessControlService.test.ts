import { describe, it, expect, beforeEach } from 'vitest';
import { AccessControlService } from './accessControlService.js';
import type { Role, AccessRequest } from './types.js';

function makeRole(overrides: Partial<Role> = {}): Role {
  return {
    id: 'role-1',
    name: 'Accountant',
    businessId: 'biz-1',
    permissions: [{ resource: 'transactions', action: 'read' }],
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function makeRequest(overrides: Partial<AccessRequest> = {}): AccessRequest {
  return {
    userId: 'user-1',
    businessId: 'biz-1',
    resource: 'transactions',
    action: 'read',
    ...overrides,
  };
}

describe('AccessControlService', () => {
  let service: AccessControlService;

  beforeEach(() => {
    service = new AccessControlService();
  });

  describe('addRole / getRole', () => {
    it('should store and retrieve a role', () => {
      const role = makeRole();
      service.addRole(role);
      expect(service.getRole('role-1')).toBe(role);
    });

    it('should return undefined for unknown role', () => {
      expect(service.getRole('nonexistent')).toBeUndefined();
    });
  });

  describe('assignRole / removeRole / getUserRoleIds', () => {
    it('should assign a role to a user', () => {
      service.addRole(makeRole());
      expect(service.assignRole('user-1', 'role-1')).toBe(true);
      expect(service.getUserRoleIds('user-1')).toEqual(['role-1']);
    });

    it('should return false when assigning a nonexistent role', () => {
      expect(service.assignRole('user-1', 'no-such-role')).toBe(false);
      expect(service.getUserRoleIds('user-1')).toEqual([]);
    });

    it('should remove a role from a user', () => {
      service.addRole(makeRole());
      service.assignRole('user-1', 'role-1');
      expect(service.removeRole('user-1', 'role-1')).toBe(true);
      expect(service.getUserRoleIds('user-1')).toEqual([]);
    });

    it('should return false when removing a role the user does not have', () => {
      expect(service.removeRole('user-1', 'role-1')).toBe(false);
    });

    it('should return empty array for user with no roles', () => {
      expect(service.getUserRoleIds('unknown-user')).toEqual([]);
    });
  });

  describe('registerBusinessMembership / isBusinessMember / getUserBusinessIds', () => {
    it('should register and check business membership', () => {
      service.registerBusinessMembership('user-1', 'biz-1');
      expect(service.isBusinessMember('user-1', 'biz-1')).toBe(true);
      expect(service.isBusinessMember('user-1', 'biz-2')).toBe(false);
    });

    it('should return false for unknown user', () => {
      expect(service.isBusinessMember('unknown', 'biz-1')).toBe(false);
    });

    it('should return all business IDs for a user', () => {
      service.registerBusinessMembership('user-1', 'biz-1');
      service.registerBusinessMembership('user-1', 'biz-2');
      expect(service.getUserBusinessIds('user-1')).toEqual(
        expect.arrayContaining(['biz-1', 'biz-2']),
      );
    });

    it('should return empty array for user with no memberships', () => {
      expect(service.getUserBusinessIds('unknown')).toEqual([]);
    });

    it('should not duplicate memberships', () => {
      service.registerBusinessMembership('user-1', 'biz-1');
      service.registerBusinessMembership('user-1', 'biz-1');
      expect(service.getUserBusinessIds('user-1')).toEqual(['biz-1']);
    });
  });

  describe('checkAccess – default deny (Req 6.6)', () => {
    it('should deny access when user has no roles', () => {
      const decision = service.checkAccess(makeRequest());
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('no assigned roles');
    });

    it('should deny access when no role grants the permission', () => {
      service.addRole(makeRole());
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-1');

      const decision = service.checkAccess(makeRequest({ resource: 'invoices', action: 'delete' }));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('No role grants');
    });
  });

  describe('checkAccess – permission matching', () => {
    it('should allow access when role grants exact permission', () => {
      service.addRole(makeRole());
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-1');

      const decision = service.checkAccess(makeRequest());
      expect(decision.allowed).toBe(true);
      expect(decision.matchedRole).toBe('Accountant');
      expect(decision.matchedPermission).toEqual({
        resource: 'transactions',
        action: 'read',
      });
    });

    it('should allow access with wildcard resource permission', () => {
      service.addRole(
        makeRole({
          id: 'admin-role',
          name: 'Admin',
          permissions: [{ resource: '*', action: 'read' }],
        }),
      );
      service.assignRole('user-1', 'admin-role');
      service.registerBusinessMembership('user-1', 'biz-1');

      const decision = service.checkAccess(makeRequest({ resource: 'any-resource' }));
      expect(decision.allowed).toBe(true);
    });

    it('should deny when action does not match', () => {
      service.addRole(makeRole()); // only has read on transactions
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-1');

      const decision = service.checkAccess(makeRequest({ action: 'delete' }));
      expect(decision.allowed).toBe(false);
    });

    it('should deny when resource does not match', () => {
      service.addRole(makeRole());
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-1');

      const decision = service.checkAccess(makeRequest({ resource: 'invoices' }));
      expect(decision.allowed).toBe(false);
    });
  });

  describe('checkAccess – business isolation', () => {
    it('should deny access when role belongs to a different business', () => {
      service.addRole(makeRole({ businessId: 'biz-other' }));
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-1');

      const decision = service.checkAccess(makeRequest({ businessId: 'biz-1' }));
      expect(decision.allowed).toBe(false);
    });

    it('should allow access only for the matching business', () => {
      service.addRole(makeRole({ businessId: 'biz-1' }));
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-1');

      expect(service.checkAccess(makeRequest({ businessId: 'biz-1' })).allowed).toBe(true);
      expect(service.checkAccess(makeRequest({ businessId: 'biz-2' })).allowed).toBe(false);
    });

    it('should deny access when user is not a member of the requested business', () => {
      service.addRole(makeRole({ businessId: 'biz-1' }));
      service.assignRole('user-1', 'role-1');
      // user-1 is NOT registered as a member of biz-1

      const decision = service.checkAccess(makeRequest({ businessId: 'biz-1' }));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not a member');
    });

    it('should deny access when user is member of a different business', () => {
      service.addRole(makeRole({ businessId: 'biz-1' }));
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-2');

      const decision = service.checkAccess(makeRequest({ businessId: 'biz-1' }));
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('not a member');
    });

    it('should allow access when user is member of multiple businesses', () => {
      service.addRole(makeRole({ id: 'role-biz1', businessId: 'biz-1' }));
      service.addRole(makeRole({ id: 'role-biz2', businessId: 'biz-2' }));
      service.assignRole('user-1', 'role-biz1');
      service.assignRole('user-1', 'role-biz2');
      service.registerBusinessMembership('user-1', 'biz-1');
      service.registerBusinessMembership('user-1', 'biz-2');

      expect(service.checkAccess(makeRequest({ businessId: 'biz-1' })).allowed).toBe(true);
      expect(service.checkAccess(makeRequest({ businessId: 'biz-2' })).allowed).toBe(true);
      // But not a third business
      expect(service.checkAccess(makeRequest({ businessId: 'biz-3' })).allowed).toBe(false);
    });
  });

  describe('checkAccess – permission inheritance (Req 6.3)', () => {
    it('should inherit permissions from parent role', () => {
      const parentRole = makeRole({
        id: 'parent',
        name: 'BaseUser',
        permissions: [{ resource: 'reports', action: 'read' }],
      });
      const childRole = makeRole({
        id: 'child',
        name: 'Accountant',
        parentRoleId: 'parent',
        permissions: [{ resource: 'transactions', action: 'read' }],
      });

      service.addRole(parentRole);
      service.addRole(childRole);
      service.assignRole('user-1', 'child');
      service.registerBusinessMembership('user-1', 'biz-1');

      // Child's own permission
      expect(
        service.checkAccess(makeRequest({ resource: 'transactions', action: 'read' })).allowed,
      ).toBe(true);
      // Inherited from parent
      expect(
        service.checkAccess(makeRequest({ resource: 'reports', action: 'read' })).allowed,
      ).toBe(true);
      // Not granted anywhere
      expect(
        service.checkAccess(makeRequest({ resource: 'invoices', action: 'delete' })).allowed,
      ).toBe(false);
    });

    it('should inherit permissions through multiple levels (grandparent)', () => {
      const grandparent = makeRole({
        id: 'gp',
        name: 'Base',
        permissions: [{ resource: 'dashboard', action: 'read' }],
      });
      const parent = makeRole({
        id: 'parent',
        name: 'Staff',
        parentRoleId: 'gp',
        permissions: [{ resource: 'reports', action: 'read' }],
      });
      const child = makeRole({
        id: 'child',
        name: 'Accountant',
        parentRoleId: 'parent',
        permissions: [{ resource: 'transactions', action: 'read' }],
      });

      service.addRole(grandparent);
      service.addRole(parent);
      service.addRole(child);
      service.assignRole('user-1', 'child');
      service.registerBusinessMembership('user-1', 'biz-1');

      expect(
        service.checkAccess(makeRequest({ resource: 'transactions', action: 'read' })).allowed,
      ).toBe(true);
      expect(
        service.checkAccess(makeRequest({ resource: 'reports', action: 'read' })).allowed,
      ).toBe(true);
      expect(
        service.checkAccess(makeRequest({ resource: 'dashboard', action: 'read' })).allowed,
      ).toBe(true);
    });

    it('should handle circular inheritance without infinite loop', () => {
      const roleA = makeRole({
        id: 'a',
        name: 'RoleA',
        parentRoleId: 'b',
        permissions: [{ resource: 'transactions', action: 'read' }],
      });
      const roleB = makeRole({
        id: 'b',
        name: 'RoleB',
        parentRoleId: 'a',
        permissions: [{ resource: 'reports', action: 'read' }],
      });

      service.addRole(roleA);
      service.addRole(roleB);
      service.assignRole('user-1', 'a');
      service.registerBusinessMembership('user-1', 'biz-1');

      // Should not hang — both permissions are reachable before the cycle is detected
      const decision = service.checkAccess(makeRequest({ resource: 'reports', action: 'read' }));
      expect(decision.allowed).toBe(true);
    });

    it('should handle missing parent role gracefully', () => {
      const child = makeRole({
        id: 'child',
        name: 'Orphan',
        parentRoleId: 'nonexistent',
        permissions: [{ resource: 'transactions', action: 'read' }],
      });

      service.addRole(child);
      service.assignRole('user-1', 'child');
      service.registerBusinessMembership('user-1', 'biz-1');

      // Own permission still works
      expect(
        service.checkAccess(makeRequest({ resource: 'transactions', action: 'read' })).allowed,
      ).toBe(true);
      // No inherited permission
      expect(
        service.checkAccess(makeRequest({ resource: 'reports', action: 'read' })).allowed,
      ).toBe(false);
    });
  });

  describe('checkAccess – multiple roles', () => {
    it('should grant access if any assigned role has the permission', () => {
      const viewerRole = makeRole({
        id: 'viewer',
        name: 'Viewer',
        permissions: [{ resource: 'reports', action: 'read' }],
      });
      const editorRole = makeRole({
        id: 'editor',
        name: 'Editor',
        permissions: [{ resource: 'transactions', action: 'update' }],
      });

      service.addRole(viewerRole);
      service.addRole(editorRole);
      service.assignRole('user-1', 'viewer');
      service.assignRole('user-1', 'editor');
      service.registerBusinessMembership('user-1', 'biz-1');

      expect(
        service.checkAccess(makeRequest({ resource: 'reports', action: 'read' })).allowed,
      ).toBe(true);
      expect(
        service.checkAccess(makeRequest({ resource: 'transactions', action: 'update' })).allowed,
      ).toBe(true);
      // Still denied for ungranted permissions
      expect(
        service.checkAccess(makeRequest({ resource: 'transactions', action: 'delete' })).allowed,
      ).toBe(false);
    });
  });

  describe('elevated access (Req 6.5)', () => {
    beforeEach(() => {
      // Set up a basic user with a role that only has read on transactions
      service.addRole(makeRole());
      service.assignRole('user-1', 'role-1');
      service.registerBusinessMembership('user-1', 'biz-1');
    });

    it('should create a pending elevated access request', () => {
      const reqId = service.requestElevatedAccess(
        'user-1',
        'biz-1',
        [{ resource: 'transactions', action: 'delete' }],
        'Need to clean up duplicates',
      );

      const req = service.getElevatedRequest(reqId);
      expect(req).toBeDefined();
      expect(req!.status).toBe('pending');
      expect(req!.userId).toBe('user-1');
      expect(req!.reason).toBe('Need to clean up duplicates');
    });

    it('should approve an elevated access request and grant time-limited access', () => {
      const reqId = service.requestElevatedAccess(
        'user-1',
        'biz-1',
        [{ resource: 'transactions', action: 'delete' }],
        'Cleanup',
      );

      const result = service.decideElevatedAccess(reqId, 'approved', 'admin-1', 60_000);
      expect(result).toBe(true);

      const req = service.getElevatedRequest(reqId);
      expect(req!.status).toBe('approved');
      expect(req!.decidedBy).toBe('admin-1');

      // The elevated permission should now grant access
      const decision = service.checkAccess(makeRequest({ action: 'delete' }));
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toContain('elevated');
    });

    it('should deny an elevated access request', () => {
      const reqId = service.requestElevatedAccess(
        'user-1',
        'biz-1',
        [{ resource: 'transactions', action: 'delete' }],
        'Cleanup',
      );

      const result = service.decideElevatedAccess(reqId, 'denied', 'admin-1');
      expect(result).toBe(true);

      const req = service.getElevatedRequest(reqId);
      expect(req!.status).toBe('denied');

      // Should NOT grant access
      const decision = service.checkAccess(makeRequest({ action: 'delete' }));
      expect(decision.allowed).toBe(false);
    });

    it('should not grant access for expired elevated grants', () => {
      const reqId = service.requestElevatedAccess(
        'user-1',
        'biz-1',
        [{ resource: 'transactions', action: 'delete' }],
        'Cleanup',
      );

      // Approve with a very short duration (1ms)
      service.decideElevatedAccess(reqId, 'approved', 'admin-1', 1);

      // Wait for expiration — use getActiveElevatedGrants with a future date
      const futureDate = new Date(Date.now() + 10_000);
      const grants = service.getActiveElevatedGrants('user-1', 'biz-1', futureDate);
      expect(grants).toHaveLength(0);
    });

    it('should return false when deciding on a nonexistent request', () => {
      expect(service.decideElevatedAccess('no-such-id', 'approved', 'admin-1')).toBe(false);
    });

    it('should return false when deciding on an already-decided request', () => {
      const reqId = service.requestElevatedAccess(
        'user-1',
        'biz-1',
        [{ resource: 'transactions', action: 'delete' }],
        'Cleanup',
      );
      service.decideElevatedAccess(reqId, 'approved', 'admin-1');

      // Trying to decide again should fail
      expect(service.decideElevatedAccess(reqId, 'denied', 'admin-2')).toBe(false);
    });

    it('should return undefined for unknown elevated request', () => {
      expect(service.getElevatedRequest('nonexistent')).toBeUndefined();
    });

    it('should not grant elevated access for a different business', () => {
      service.registerBusinessMembership('user-1', 'biz-2');
      service.addRole(makeRole({ id: 'role-biz2', businessId: 'biz-2' }));
      service.assignRole('user-1', 'role-biz2');

      const reqId = service.requestElevatedAccess(
        'user-1',
        'biz-1',
        [{ resource: 'transactions', action: 'delete' }],
        'Cleanup',
      );
      service.decideElevatedAccess(reqId, 'approved', 'admin-1');

      // Elevated grant is for biz-1, request is for biz-2
      const decision = service.checkAccess(makeRequest({ businessId: 'biz-2', action: 'delete' }));
      expect(decision.allowed).toBe(false);
    });
  });
});
