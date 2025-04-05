// eslint-env node
/** @type {import('ts-jest').JestConfigWithTsJest} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  // Automatically clear mock calls, instances, contexts and results before every test
  clearMocks: true,
  // The directory where Jest should output its coverage files
  coverageDirectory: "coverage",
  // Indicates which provider should be used to instrument code for coverage
  coverageProvider: "v8", // or 'babel'
  // A list of paths to directories that Jest should use to search for files in
  roots: ["<rootDir>/src", "<rootDir>/tests"],
  // The test environment that will be used for testing (duplicate removed)
  // The glob patterns Jest uses to detect test files
  testMatch: ["**/tests/**/*.test.ts", "**/src/**/*.test.ts"],
  // A map from regular expressions to paths to transformers
  transform: {
    "^.+\\.ts$": [
      "ts-jest",
      {
        // ts-jest configuration goes here
        tsconfig: "tsconfig.json", // Ensure this points to your tsconfig
      },
    ],
  },
  // An array of regexp pattern strings that are matched against all source file paths, matched files will skip transformation
  transformIgnorePatterns: ["/node_modules/", "\\.pnp\\.[^\\/]+$"],
  // Indicates whether each individual test should be reported during the run
  verbose: true,
  // A list of paths to modules that run some code to configure or set up the testing environment before each test
  setupFiles: ["reflect-metadata"],
  // We might not need setupFilesAfterEnv anymore if setupFiles works
  // setupFilesAfterEnv: ["<rootDir>/tests/jest.setup.ts"],
};
