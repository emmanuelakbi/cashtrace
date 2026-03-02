import { readFileSync } from 'fs';
import { resolve } from 'path';

import { describe, expect, it } from 'vitest';

describe('Web App Manifest', () => {
  const manifestPath = resolve(__dirname, '../../public/manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));

  it('should have required app identity fields', () => {
    expect(manifest.name).toBe('CashTrace');
    expect(manifest.short_name).toBe('CashTrace');
    expect(manifest.description).toBe('SME Cashflow & Compliance Copilot');
  });

  it('should configure standalone display mode', () => {
    expect(manifest.start_url).toBe('/');
    expect(manifest.display).toBe('standalone');
    expect(manifest.scope).toBe('/');
    expect(manifest.orientation).toBe('any');
  });

  it('should use theme colors from design tokens', () => {
    expect(manifest.theme_color).toBe('#0d9488');
    expect(manifest.background_color).toBe('#f8fafc');
  });

  it('should include icons at 192x192 and 512x512 sizes', () => {
    expect(manifest.icons).toHaveLength(2);

    const icon192 = manifest.icons.find(
      (icon: { sizes: string }) => icon.sizes === '192x192',
    );
    const icon512 = manifest.icons.find(
      (icon: { sizes: string }) => icon.sizes === '512x512',
    );

    expect(icon192).toBeDefined();
    expect(icon192.src).toBe('/icons/icon-192x192.svg');
    expect(icon192.type).toBe('image/svg+xml');

    expect(icon512).toBeDefined();
    expect(icon512.src).toBe('/icons/icon-512x512.svg');
    expect(icon512.type).toBe('image/svg+xml');
  });

  it('should include finance and business categories', () => {
    expect(manifest.categories).toEqual(['finance', 'business']);
  });
});
