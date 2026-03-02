import { resolve } from 'path';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': resolve(__dirname, './src'),
    },
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}', 'src/**/*.property.test.{ts,tsx}'],
    exclude: ['node_modules', '.next'],
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    css: true,
  },
});
