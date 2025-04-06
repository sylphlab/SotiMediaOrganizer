import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true, // Enable Jest-like globals (describe, it, expect, etc.)
    environment: 'node', // Specify the test environment
    // Enable setup file (assuming tests/jest.setup.ts contains relevant setup)
    setupFiles: ['./tests/jest.setup.ts'],
    // Configure coverage for 100% target
    coverage: {
      provider: 'v8', // Use v8 provider
      reporter: ['text', 'json', 'html', 'lcov'], // Include lcov for CI
      thresholds: { // Enforce 100% coverage
        lines: 100,
        functions: 100,
        branches: 100,
      },
    },
  },
});