import { describe, it, expect, beforeEach } from 'vitest';
import { DriftDetector } from './driftDetector.js';
import { ConfigValidator } from './configValidator.js';
import type { ServiceConfig } from './types.js';

function secureConfig(): ServiceConfig {
  return new ConfigValidator().getSecureDefaults();
}

describe('DriftDetector', () => {
  let detector: DriftDetector;

  beforeEach(() => {
    detector = new DriftDetector();
  });

  // ─── constructor / getBaseline ───

  describe('constructor', () => {
    it('uses secure defaults as baseline when none provided', () => {
      const baseline = detector.getBaseline();
      const defaults = new ConfigValidator().getSecureDefaults();

      expect(baseline).toEqual(defaults);
    });

    it('uses custom baseline when provided', () => {
      const custom = secureConfig();
      custom.authentication.passwordMinLength = 20;

      const d = new DriftDetector(custom);
      expect(d.getBaseline().authentication.passwordMinLength).toBe(20);
    });

    it('deep-copies the baseline so mutations do not affect it', () => {
      const custom = secureConfig();
      const d = new DriftDetector(custom);
      custom.authentication.passwordMinLength = 999;

      expect(d.getBaseline().authentication.passwordMinLength).not.toBe(999);
    });
  });

  // ─── setBaseline ───

  describe('setBaseline()', () => {
    it('updates the baseline', () => {
      const updated = secureConfig();
      updated.logging.retentionDays = 730;

      detector.setBaseline(updated);
      expect(detector.getBaseline().logging.retentionDays).toBe(730);
    });
  });

  // ─── detectDrift ───

  describe('detectDrift()', () => {
    it('returns empty array when config matches baseline', () => {
      const drifts = detector.detectDrift(secureConfig());
      expect(drifts).toEqual([]);
    });

    it('detects a single field drift', () => {
      const config = secureConfig();
      config.authentication.mfaEnabled = false;

      const drifts = detector.detectDrift(config);
      expect(drifts).toHaveLength(1);
      expect(drifts[0].fieldPath).toBe('authentication.mfaEnabled');
      expect(drifts[0].baselineValue).toBe(true);
      expect(drifts[0].currentValue).toBe(false);
    });

    it('detects multiple drifts across sections', () => {
      const config = secureConfig();
      config.encryption.algorithm = 'des';
      config.logging.enabled = false;

      const drifts = detector.detectDrift(config);
      expect(drifts.length).toBe(2);

      const paths = drifts.map((d) => d.fieldPath);
      expect(paths).toContain('encryption.algorithm');
      expect(paths).toContain('logging.enabled');
    });

    it('detects array field drift (allowedPorts)', () => {
      const config = secureConfig();
      config.network.allowedPorts = [80, 443];

      const drifts = detector.detectDrift(config);
      const portDrift = drifts.find((d) => d.fieldPath === 'network.allowedPorts');

      expect(portDrift).toBeDefined();
      expect(portDrift!.currentValue).toEqual([80, 443]);
    });

    it('assigns correct severity based on section', () => {
      const config = secureConfig();
      config.encryption.enforceHttps = false;
      config.network.corsAllowAll = true;
      config.accessControl.rbacEnabled = false;

      const drifts = detector.detectDrift(config);

      const encDrift = drifts.find((d) => d.fieldPath === 'encryption.enforceHttps');
      const netDrift = drifts.find((d) => d.fieldPath === 'network.corsAllowAll');
      const acDrift = drifts.find((d) => d.fieldPath === 'accessControl.rbacEnabled');

      expect(encDrift!.severity).toBe('critical');
      expect(netDrift!.severity).toBe('medium');
      expect(acDrift!.severity).toBe('high');
    });
  });

  // ─── getDriftSummary ───

  describe('getDriftSummary()', () => {
    it('returns all zeros when no drift', () => {
      const summary = detector.getDriftSummary(secureConfig());
      expect(summary).toEqual({ critical: 0, high: 0, medium: 0, low: 0, total: 0 });
    });

    it('counts drifts by severity', () => {
      const config = secureConfig();
      config.encryption.algorithm = 'des'; // critical
      config.encryption.enforceHttps = false; // critical
      config.network.corsAllowAll = true; // medium

      const summary = detector.getDriftSummary(config);
      expect(summary.critical).toBe(2);
      expect(summary.medium).toBe(1);
      expect(summary.total).toBe(3);
    });
  });

  // ─── isCompliant ───

  describe('isCompliant()', () => {
    it('returns true when config matches baseline', () => {
      expect(detector.isCompliant(secureConfig())).toBe(true);
    });

    it('returns false when critical drift exists', () => {
      const config = secureConfig();
      config.encryption.algorithm = 'des';

      expect(detector.isCompliant(config)).toBe(false);
    });

    it('returns false when high severity drift exists', () => {
      const config = secureConfig();
      config.accessControl.rbacEnabled = false;

      expect(detector.isCompliant(config)).toBe(false);
    });

    it('returns true when only medium/low drifts exist', () => {
      const config = secureConfig();
      config.network.corsAllowAll = true; // medium severity

      expect(detector.isCompliant(config)).toBe(true);
    });
  });
});
