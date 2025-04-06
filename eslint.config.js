import globals from 'globals';
import pluginJs from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintPluginPrettierRecommended from 'eslint-plugin-prettier/recommended'; // Includes config and plugin

export default tseslint.config(
  {
    // Global ignores - apply to everything
    ignores: [
      'dist/**',
      'scripts/**',
      'build/**',
      'assembly/**',
      'node_modules/**',
      '**/*.config.js', // Ignore JS config files globally
      '**/*.config.ts', // Ignore TS config files globally
      '.test-cache-db/**', // Ignore test cache
      '.test-db/**', // Ignore test DB
    ],
  },
  {
    // Apply Node.js globals to all relevant files (JS and TS, excluding ignored)
    files: ['**/*.{js,mjs,cjs,ts}'],
    languageOptions: {
      globals: {
        ...globals.node, // Use Node.js globals
      },
    },
  },
  // Base ESLint recommended rules for all non-ignored files
  eslint.configs.recommended, // Use eslint.configs.recommended

  // Apply recommended type-checked rules ONLY to .ts files (excluding ignored and config files)
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'], // Target only TS files explicitly here
    languageOptions: {
      ...(config.languageOptions ?? {}),
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),

  // Apply strict type-checked rules ONLY to .ts files (excluding ignored and config files)
  ...tseslint.configs.strictTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'], // Target only TS files explicitly here
    languageOptions: {
      ...(config.languageOptions ?? {}),
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),
  // Apply stylistic type-checked rules ONLY to .ts files
  ...tseslint.configs.stylisticTypeChecked.map((config) => ({
    ...config,
    files: ['**/*.ts'], // Target only TS files explicitly here
    languageOptions: {
      ...(config.languageOptions ?? {}),
      parserOptions: {
        project: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),

  // Custom rules specific to TypeScript files (excluding ignored and config files)
  {
    files: ['**/*.ts'],
    rules: {
      // General JS/TS Rules (additions/overrides)
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }], // Allow info
      'prefer-const': 'error',
      eqeqeq: ['error', 'always'],
      'no-unused-vars': 'off', // Use TS version
      complexity: ['error', { max: 10 }], // Cyclomatic complexity
      'max-lines': [
        'warn',
        { max: 300, skipBlankLines: true, skipComments: true },
      ],
      'max-lines-per-function': [
        'warn',
        { max: 50, skipBlankLines: true, skipComments: true },
      ],
      'max-depth': ['warn', 3], // Max nesting depth
      'max-params': ['warn', 4], // Max function parameters

      // TypeScript Specific Rules (additions/overrides)
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ], // Use error level
      '@typescript-eslint/no-explicit-any': 'error', // Already covered by strict, but explicit is good
      '@typescript-eslint/explicit-function-return-type': 'error', // Require return types
      '@typescript-eslint/no-non-null-assertion': 'error', // Disallow '!' (already covered by strict)
      '@typescript-eslint/no-use-before-define': 'error',
      '@typescript-eslint/no-floating-promises': 'error', // Require handling promises (already covered by strict)
      '@typescript-eslint/consistent-type-imports': 'error', // Use 'import type'
      '@typescript-eslint/no-misused-promises': 'error', // Already covered by strict
      '@typescript-eslint/prefer-readonly': 'warn', // Encourage immutability
    },
  },

  // Configuration specific to test files (.test.ts)
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Relax rules that are often problematic in tests, if absolutely necessary
      '@typescript-eslint/no-unsafe-assignment': 'warn', // Be cautious, prefer fixing
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn', // Try to avoid 'any'
      '@typescript-eslint/unbound-method': 'warn', // Often occurs with expect(mock.method)
    },
  },

  // Prettier config must be last to override other formatting rules
  // Prettier plugin/config must be last to override other style rules
  eslintPluginPrettierRecommended,
  {
    // Ignore config files from some rules
    files: ['*.config.js', '*.config.ts', '.*rc.js'],
    rules: {
      'max-lines': 'off',
    },
  },
);
