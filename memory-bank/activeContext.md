<!-- Version: 2.8 | Last Updated: 2025-04-06 | Updated By: Cline -->

# Active Context

- **Current Focus:** Completed core implementation of DB-centric LSH strategy for similarity search (Phase 2). Preparing for next Phase 2 tasks (optimization, workers, benchmarking).
- **Recent Changes:**
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
- **Next Steps:** Continue Phase 2:
  - **Optimization:** Refactor LSH similarity check loop in `deduplicator.ts` to fetch only necessary `MediaInfo` from DB for candidates, instead of relying on `allFileInfoMap`.
  - **Workers (Task 2.4):** Re-evaluate worker usage for pHash generation in the context of DB interaction.
  - **Benchmarking (Task 2.5):** Introduce benchmarking for key pipeline stages.
- **Open Questions/Decisions:**
  - Optimal DI strategy? **Decision:** Manual Injection implemented in Phase 1.
  - Feasibility and approach for a Web UI? **Decision:** Lower priority, deferred past Phase 2.
  - Specific FP patterns to adopt? **Decision:** Using `neverthrow` for `Result`, explicit side-effect isolation. Further patterns TBD.
  - Best way to ensure scalability for millions of files? **Decision:** Adopt SQLite (Phase 2), streaming/batching. **Decision:** Replace VPTree/DBSCAN with DB-centric LSH approach (Phase 2).
  - How to address persistent mocking issues in `bun test`? **Decision:** Defer testing strategy until after major refactoring (Phase 4).
  - **Blocker:** None currently.
