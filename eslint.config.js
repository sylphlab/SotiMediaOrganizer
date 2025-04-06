import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier"; // Import prettier config

export default tseslint.config(
  {
    // Global ignores - apply to everything
    ignores: [
      "dist/**",
      "scripts/**",
      "build/**",
      "assembly/**",
      "node_modules/**",
      "**/*.config.js", // Ignore JS config files globally
      "**/*.config.ts", // Ignore TS config files globally
      ".test-cache-db/**", // Ignore test cache
      ".test-db/**", // Ignore test DB
    ],
  },
  {
    // Apply Node.js globals to all relevant files (JS and TS, excluding ignored)
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node, // Use Node.js globals
      },
    },
  },
  // Base ESLint recommended rules for all non-ignored files
  pluginJs.configs.recommended,

  // Apply recommended type-checked rules ONLY to .ts files (excluding ignored and config files)
  ...tseslint.configs.recommendedTypeChecked.map((config) => ({
    ...config,
    files: ["**/*.ts"], // Target only TS files explicitly here
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
    files: ["**/*.ts"], // Target only TS files explicitly here
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
    files: ["**/*.ts"],
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Add other TS-specific overrides if needed
      // Example: Relax unbound-method for test files if necessary, though fixing is better
      // "@typescript-eslint/unbound-method": "off", // Consider fixing instead
    },
  },

  // Configuration specific to test files (.test.ts)
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Relax rules that are often problematic in tests, if absolutely necessary
      "@typescript-eslint/no-unsafe-assignment": "warn", // Be cautious, prefer fixing
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-explicit-any": "warn", // Try to avoid 'any'
      "@typescript-eslint/unbound-method": "warn", // Often occurs with expect(mock.method)
    },
  },

  // Prettier config must be last to override other formatting rules
  eslintConfigPrettier
);
