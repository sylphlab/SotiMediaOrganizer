import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Enable Jest-like globals (describe, it, expect, etc.)
    environment: 'node', // Specify the test environment
    // Optional: Add setup files if needed (e.g., for global mocks or polyfills)
    // setupFiles: ['./tests/vitest.setup.ts'],
    // Optional: Configure coverage
    // coverage: {
    //   provider: 'v8', // or 'istanbul'
    //   reporter: ['text', 'json', 'html'],
    // },
  },
});