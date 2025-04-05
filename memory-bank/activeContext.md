<!-- Version: 2.7 | Last Updated: 2025-04-05 | Updated By: Cline -->

# Active Context

- **Current Focus:** Starting Phase 2 (Scalability Enhancements) after completing Phase 1 and committing changes. Approved DB-centric LSH strategy for deduplication.
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
- **Next Steps:** Implement Phase 2 DB-centric LSH strategy:
  - Modify DB schema and service (`MetadataDBService`) to support LSH keys.
  - Refactor `deduplicateFilesFn` to use LSH queries for candidate selection instead of VPTree/DBSCAN.
  - Refactor `comparator.processResults` selector for efficient DB lookups.
- **Open Questions/Decisions:**
  - Optimal DI strategy? **Decision:** Manual Injection implemented in Phase 1.
  - Feasibility and approach for a Web UI? **Decision:** Lower priority, deferred past Phase 2.
  - Specific FP patterns to adopt? **Decision:** Using `neverthrow` for `Result`, explicit side-effect isolation. Further patterns TBD.
  - Best way to ensure scalability for millions of files? **Decision:** Adopt SQLite (Phase 2), streaming/batching. **Decision:** Replace VPTree/DBSCAN with DB-centric LSH approach (Phase 2).
  - How to address persistent mocking issues in `bun test`? **Decision:** Defer testing strategy until after major refactoring (Phase 4).
  - **Blocker:** None currently.
