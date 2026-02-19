import { describe, it, expect, beforeEach } from 'vitest';
import { ClassificationService } from './classificationService.js';
import type { ClassificationLevel, UserSecurityContext } from './types.js';

/**
 * Tests for classification-based access control.
 * Validates: Requirement 5.3 - Apply access control requirements based on classification.
 */
describe('ClassificationService - Access Control by Classification', () => {
  let service: ClassificationService;

  const makeUser = (overrides: Partial<UserSecurityContext> = {}): UserSecurityContext => ({
    userId: 'user-1',
    authenticated: true,
    roles: [],
    permissions: [],
    clearanceLevel: 'public',
    ...overrides,
  });

  beforeEach(() => {
    service = new ClassificationService();
  });

  describe('getAccessRequirement', () => {
    it('should return no explicit permission needed for public data', () => {
      const req = service.getAccessRequirement('public');
      expect(req.minimumClearance).toBe('public');
      expect(req.requiresExplicitPermission).toBe(false);
    });

    it('should return no explicit permission needed for internal data', () => {
      const req = service.getAccessRequirement('internal');
      expect(req.minimumClearance).toBe('internal');
      expect(req.requiresExplicitPermission).toBe(false);
    });

    it('should require explicit permission for confidential data', () => {
      const req = service.getAccessRequirement('confidential');
      expect(req.minimumClearance).toBe('confidential');
      expect(req.requiresExplicitPermission).toBe(true);
    });

    it('should require explicit permission for restricted data', () => {
      const req = service.getAccessRequirement('restricted');
      expect(req.minimumClearance).toBe('restricted');
      expect(req.requiresExplicitPermission).toBe(true);
    });
  });

  describe('checkAccess', () => {
    it('should deny unauthenticated users for any classification', () => {
      const levels: ClassificationLevel[] = ['public', 'internal', 'confidential', 'restricted'];
      const user = makeUser({ authenticated: false });

      for (const level of levels) {
        const decision = service.checkAccess(user, level);
        expect(decision.allowed).toBe(false);
        expect(decision.reason).toContain('not authenticated');
      }
    });

    it('should allow any authenticated user to access public data', () => {
      const user = makeUser({ clearanceLevel: 'public' });
      const decision = service.checkAccess(user, 'public');
      expect(decision.allowed).toBe(true);
    });

    it('should deny public-clearance user from accessing internal data', () => {
      const user = makeUser({ clearanceLevel: 'public' });
      const decision = service.checkAccess(user, 'internal');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('Insufficient clearance');
    });

    it('should allow internal-clearance user to access internal data', () => {
      const user = makeUser({ clearanceLevel: 'internal' });
      const decision = service.checkAccess(user, 'internal');
      expect(decision.allowed).toBe(true);
    });

    it('should deny confidential access without explicit permission even with sufficient clearance', () => {
      const user = makeUser({ clearanceLevel: 'confidential', permissions: [] });
      const decision = service.checkAccess(user, 'confidential');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('access:confidential_data');
    });

    it('should allow confidential access with clearance and explicit permission', () => {
      const user = makeUser({
        clearanceLevel: 'confidential',
        permissions: ['access:confidential_data'],
      });
      const decision = service.checkAccess(user, 'confidential');
      expect(decision.allowed).toBe(true);
    });

    it('should deny restricted access without explicit permission even with sufficient clearance', () => {
      const user = makeUser({ clearanceLevel: 'restricted', permissions: [] });
      const decision = service.checkAccess(user, 'restricted');
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toContain('access:restricted_data');
    });

    it('should allow restricted access with clearance and explicit permission', () => {
      const user = makeUser({
        clearanceLevel: 'restricted',
        permissions: ['access:restricted_data'],
      });
      const decision = service.checkAccess(user, 'restricted');
      expect(decision.allowed).toBe(true);
    });

    it('should allow higher-clearance users to access lower-classification data', () => {
      const user = makeUser({ clearanceLevel: 'restricted', permissions: [] });
      // Public and internal don't require explicit permission
      expect(service.checkAccess(user, 'public').allowed).toBe(true);
      expect(service.checkAccess(user, 'internal').allowed).toBe(true);
    });

    it('should include correct clearance info in the decision', () => {
      const user = makeUser({ clearanceLevel: 'internal' });
      const decision = service.checkAccess(user, 'confidential');
      expect(decision.requiredClearance).toBe('confidential');
      expect(decision.userClearance).toBe('internal');
      expect(decision.allowed).toBe(false);
    });
  });
});
