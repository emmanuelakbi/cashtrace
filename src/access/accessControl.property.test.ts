/**
 * Property-based tests for Access Control Enforcement
 *
 * **Property 10: Access Control Enforcement**
 * For any data access, it SHALL be permitted only if the user has
 * appropriate role and business membership.
 *
 * **Validates: Requirements 6.1, 6.2**
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fc from 'fast-check';
import { AccessControlService } from './accessControlService.js';
import type { Permission, Role, AccessRequest } from './types.js';

// ─── Generators ──────────────────────────────────────────────────────────────

const actionArb = fc.constantFrom('create', 'read', 'update', 'delete') as fc.Arbitrary<
  'create' | 'read' | 'update' | 'delete'
>;

const safeIdArb = fc.stringMatching(/^[a-zA-Z0-9_-]{1,20}$/);

const permissionArb: fc.Arbitrary<Permission> = fc.record({
  resource: safeIdArb,
  action: actionArb,
});

const roleArb = (businessId: string): fc.Arbitrary<Role> =>
  fc.record({
    id: fc.uuid(),
    name: safeIdArb,
    businessId: fc.constant(businessId),
    permissions: fc.array(permissionArb, { minLength: 1, maxLength: 5 }),
    createdAt: fc.constant(new Date()),
    updatedAt: fc.constant(new Date()),
  });

const accessRequestArb = (userId: string, businessId: string): fc.Arbitrary<AccessRequest> =>
  fc.record({
    userId: fc.constant(userId),
    businessId: fc.constant(businessId),
    resource: safeIdArb,
    action: actionArb,
  });

// ─── Property Tests ──────────────────────────────────────────────────────────

describe('Access Control Enforcement (Property 10)', () => {
  let service: AccessControlService;

  beforeEach(() => {
    service = new AccessControlService();
  });

  /**
   * **Validates: Requirements 6.1** (RBAC default deny / least privilege)
   *
   * For any access request where the user has NO assigned roles,
   * access SHALL always be denied. This enforces the principle of
   * least privilege — no roles means no permissions.
   */
  it('always denies access when user has no roles (default deny)', () => {
    fc.assert(
      fc.property(
        safeIdArb, // userId
        safeIdArb, // businessId
        safeIdArb, // resource
        actionArb,
        (userId, businessId, resource, action) => {
          // Register business membership but assign NO roles
          service.registerBusinessMembership(userId, businessId);

          const decision = service.checkAccess({
            userId,
            businessId,
            resource,
            action,
          });

          expect(decision.allowed).toBe(false);
          expect(decision.reason).toContain('no assigned roles');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.2** (business-level data isolation)
   *
   * For any access request where the user is NOT a member of the
   * requested business, access SHALL always be denied — even if
   * the user has roles with matching permissions in another business.
   */
  it('always denies access when user is not a member of the requested business (business isolation)', () => {
    fc.assert(
      fc.property(
        safeIdArb, // userId
        safeIdArb, // userBusinessId (the business the user belongs to)
        safeIdArb.filter((id) => id.length > 0), // targetBusinessId (the business being accessed)
        roleArb('placeholder'), // role template
        actionArb,
        safeIdArb, // resource
        (userId, userBusinessId, targetBusinessId, roleTemplate, action, resource) => {
          // Ensure the two businesses are different
          fc.pre(userBusinessId !== targetBusinessId);

          // Set up: user belongs to userBusinessId, NOT targetBusinessId
          service.registerBusinessMembership(userId, userBusinessId);

          // Create a role in the target business and assign it
          const role: Role = {
            ...roleTemplate,
            businessId: targetBusinessId,
            permissions: [{ resource, action }],
          };
          service.addRole(role);
          service.assignRole(userId, role.id);

          const decision = service.checkAccess({
            userId,
            businessId: targetBusinessId,
            resource,
            action,
          });

          expect(decision.allowed).toBe(false);
          expect(decision.reason).toContain('not a member');
        },
      ),
      { numRuns: 200 },
    );
  });

  /**
   * **Validates: Requirements 6.1, 6.2** (RBAC + business isolation combined)
   *
   * For any access request, access is granted ONLY when the user has:
   * 1. Business membership for the requested business (Req 6.2)
   * 2. A role in that business with a matching permission (Req 6.1)
   *
   * When both conditions are met, access SHALL be allowed.
   */
  it('grants access only when user has both business membership AND a matching role permission', () => {
    fc.assert(
      fc.property(
        safeIdArb, // userId
        safeIdArb, // businessId
        safeIdArb, // resource
        actionArb,
        safeIdArb, // roleName
        (userId, businessId, resource, action, roleName) => {
          const role: Role = {
            id: `role-${roleName}`,
            name: roleName,
            businessId,
            permissions: [{ resource, action }],
            createdAt: new Date(),
            updatedAt: new Date(),
          };

          // ── Case 1: No membership, no role → denied
          const noSetup = new AccessControlService();
          expect(noSetup.checkAccess({ userId, businessId, resource, action }).allowed).toBe(false);

          // ── Case 2: Membership only, no role → denied
          const memberOnly = new AccessControlService();
          memberOnly.registerBusinessMembership(userId, businessId);
          expect(memberOnly.checkAccess({ userId, businessId, resource, action }).allowed).toBe(
            false,
          );

          // ── Case 3: Role only, no membership → denied
          const roleOnly = new AccessControlService();
          roleOnly.addRole(role);
          roleOnly.assignRole(userId, role.id);
          expect(roleOnly.checkAccess({ userId, businessId, resource, action }).allowed).toBe(
            false,
          );

          // ── Case 4: Both membership AND matching role → allowed
          const full = new AccessControlService();
          full.addRole(role);
          full.assignRole(userId, role.id);
          full.registerBusinessMembership(userId, businessId);
          const decision = full.checkAccess({ userId, businessId, resource, action });
          expect(decision.allowed).toBe(true);
          expect(decision.matchedRole).toBe(roleName);
          expect(decision.matchedPermission).toEqual({ resource, action });
        },
      ),
      { numRuns: 200 },
    );
  });
});
