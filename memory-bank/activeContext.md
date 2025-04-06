<!-- Version: 3.8 | Last Updated: 2025-06-04 | Updated By: Cline -->

# Active Context

- **Current Focus:** Phase 4 (Testing & Documentation). Completed initial README updates for Task 4.x. Continuing with Task 4.x (further documentation) and Task 4.1 (Testing, where possible).
- **Recent Changes:**

  - **Project Renaming:** Updated project to use `media-curator` (kebab-case) for repository name, npm package (`@sylphlab/media-curator`), and command name, while keeping `MediaCurator` (PascalCase) as the conceptual project name. Updated GitHub description/topics, `package.json`, CI files, documentation, and Memory Bank accordingly. Committed and pushed changes.

  - Planned Phase 1 refactoring (Architect Mode), saved plan to `phase1_refactoring_plan.md`.
  - Added `neverthrow` dependency.
  - Removed `inversify` and `reflect-metadata` dependencies.
  - Removed `Context.ts` and related service wrappers (`DatabaseService`, `SharpService`, `FFmpegService`).
  - Implemented Manual Dependency Injection in `index.ts`.
  - Refactored `LmdbCache`, `BaseFileInfoJob`, `fileStats`, `metadataExtraction`, `transfer`, `discovery` to use `AppResult` from `neverthrow` via `src/errors.ts`.
  - Standardized error handling using classes from `src/errors.ts`.
  - Improved error logging in `MediaComparator` distance functions.
  - Fixed ESLint parsing error ('}' expected) in `src/jobs/adaptiveExtraction.ts`.
  - Successfully committed Phase 1 refactoring changes.
  - Successfully committed initial Phase 2 changes (adding `better-sqlite3`, integrating `MetadataDBService` into `deduplicator.ts` for exact matching).
  - Approved DB-centric LSH strategy for Phase 2 similarity search.
  - Updated `MetadataDBService` schema and methods for LSH keys.
  - Refactored `deduplicateFilesFn` to replace VPTree/DBSCAN with LSH query loop.
  - Committed LSH implementation changes.
  - **Phase 3:** Created `CliReporter` service (`src/reporting/CliReporter.ts`) to centralize CLI output (spinners, progress bars, logging).
  - **Phase 3:** Added `--verbose` option to `index.ts`.
  - **Phase 3:** Refactored `index.ts`, `discovery.ts`, `gatherer.ts`, `deduplicator.ts`, `transfer.ts` to use `CliReporter`.
  - **Phase 3:** Refined `CliReporter` progress bar formatting.
  - **Phase 4 (Task 4.3):** Updated `README.md` to reflect current architecture and features.
  - **Phase 4 (Task 4.1):** Added/Updated integration/unit tests for `LmdbCache`, `discovery`, `gatherer`, `deduplicator`, `transfer`, `CliReporter`.
  - **Phase 4 (Task 4.1):** Added/Updated unit tests for `src/utils.ts` (covering buffer/hex conversions, async helpers, DCT helpers, quickSelect, EXIF parsing).
  - **Phase 4 (Task 4.2):** Updated Memory Bank files (Completed).
  - **Phase 4 (Task 4.x):** Created `ARCHITECTURE.md` with Mermaid diagram.
  - **Phase 4 (Task 4.x):** Updated `README.md` to link to `ARCHITECTURE.md`.
  - **Phase 4 (Task 4.x):** Updated `README.md` with detailed format string placeholders.
  - **Phase 4 (Task 4.x):** Added "Advanced Usage Examples" section to `README.md`.
  - **Phase 4 (Task 4.x):** Expanded "Key Features" descriptions in `README.md`.
  - **Phase 4 (Task 4.x):** Refined "Performance & Quality" section in `README.md`.
  - **Phase 4 (Task 4.x):** Created initial VitePress documentation structure (`docs/`, `.vitepress/config.js`, `index.md`).
  - **Phase 4 (Task 4.x):** Added basic content framework for initial guide pages (`introduction.md`, `installation.md`, `getting-started.md`, `format-string.md`, `deduplication.md`).

- **Next Steps:** Phase 4 (Testing & Documentation):\n - **Task 4.1:** Continue implementing tests (add more test cases, cover edge cases, improve coverage for other modules like `comparatorUtils.ts`, integration tests where possible given mocking issues).\n - **Task 4.x:** Continue populating content in the created VitePress documentation pages (`docs/guide/*.md`), refine existing sections in README/ARCHITECTURE, add more examples.\n- **Open Questions/Decisions:**\n - Specific LSH function/parameters and DB indexing strategy for optimal performance? **Decision:** Current LSH (4x16bit bands) implemented; further tuning deferred.\n - How to address persistent mocking issues in `bun test`? **Decision:** Focus on integration tests and higher-level mocking. Skip `better-sqlite3` tests under Bun for now.\n - Need for further Phase 2 optimizations (LSH loop DB fetch, worker refinement, benchmarking)? **Decision:** Postpone until after initial testing/documentation pass.\n - Need for further Phase 3 UI refinements? **Decision:** Postpone until after initial testing/documentation pass.\n - Need for end-to-end testing framework/strategy? **Decision:** Deferred.\n
