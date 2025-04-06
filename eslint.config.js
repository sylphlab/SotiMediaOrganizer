import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";
import eslintConfigPrettier from "eslint-config-prettier"; // Import prettier config

export default tseslint.config( // Use tseslint.config for type-aware linting setup
  {
    // Global ignores
    ignores: ["dist", "scripts", "build", "assembly", "node_modules"],
  },
  {
    // Apply Node.js globals to all relevant files
    files: ["**/*.{js,mjs,cjs,ts}"],
    languageOptions: {
      globals: {
        ...globals.node, // Use Node.js globals
      },
    },
  },
  // Base ESLint recommended rules
  pluginJs.configs.recommended,
  // TypeScript recommended rules
  ...tseslint.configs.recommendedTypeChecked, // Use type-checked version
  // TypeScript strict rules (requires type information)
  ...tseslint.configs.strictTypeChecked, // Add strict type-checked rules
  {
    // Configure parser options for TypeScript files to enable type-aware rules
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: true, // Point to tsconfig.json for type information
        tsconfigRootDir: import.meta.dirname, // Set root directory for tsconfig lookup
      },
    },
    rules: {
      // Add any project-specific rule overrides here if needed
      // e.g., "@typescript-eslint/no-unused-vars": "warn"
    }
  },
  // Prettier config must be last to override other formatting rules
  eslintConfigPrettier,
);
