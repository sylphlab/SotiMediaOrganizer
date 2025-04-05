import globals from "globals";
import pluginJs from "@eslint/js";
import tseslint from "typescript-eslint";

export default [
  { files: ["**/*.{js,mjs,cjs,ts}"] },
  // Apply browser globals generally
  { languageOptions: { globals: { ...globals.browser } } },
  // Apply Node.js globals specifically to .js files (like jest.config.js)
  { files: ["**/*.js"], languageOptions: { globals: { ...globals.node } } },
  pluginJs.configs.recommended,
  ...tseslint.configs.recommended,
  { ignores: ["dist", "scripts", "build", "assembly"] },
];
