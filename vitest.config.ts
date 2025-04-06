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
      reportsDirectory: './coverage', // Explicitly define reports directory
      thresholds: {
        // Aim for high coverage, e.g., >90%
        lines: 90,
        functions: 90,
        branches: 90,
        statements: 90, // Add statements threshold
      },
      include: ['src/**/*.ts'], // Only include src files
      exclude: [
        // Exclude non-source files
        'src/index.ts',
        'src/types/**',
        '**/*.d.ts',
        '**/*.config.ts',
        '**/constants.ts',
      ],
      clean: true, // Clean coverage directory before run
    },
  },
});
