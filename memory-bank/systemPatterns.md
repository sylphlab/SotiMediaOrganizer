<!-- Version: 2.1 | Last Updated: 2025-04-06 | Updated By: Cline -->

# System Patterns & Architecture

- **Current State (Post-Phase 3 Initial):**
  - CLI application entry via `index.ts` using `commander`.
  - Core logic decomposed into pipeline stage functions (`src/discovery.ts`, `src/gatherer.ts`, `src/deduplicator.ts`, `src/transfer.ts`).
  - Pure computational logic extracted to utils (`src/utils.ts`, `src/comparatorUtils.ts`).
  - Caching isolated (`src/caching/LmdbCache.ts`), using `AppResult`.
  - External tool interactions wrapped (`src/external/`), using `AppResult`.
  - Job logic refactored into functional forms (`src/jobs/`), using `AppResult`.
  - `MediaProcessor` class replaced by functional `processSingleFile` (`src/fileProcessor.ts`).
  - **Dependency Management:** Manual Injection implemented in `index.ts`.
  - **Error Handling:** Standardized using `neverthrow` (`AppResult`) via `src/errors.ts`.
  - **Database:** SQLite (`better-sqlite3`) used for metadata storage via `MetadataDBService`.
  - **Deduplication:** DB-centric LSH approach implemented in `deduplicator.ts` and `MetadataDBService`. `MediaComparator` role reduced (primarily similarity calculation).
  - **UI:** Centralized CLI reporting via `CliReporter` service. Basic `--verbose` option added.
  - Concurrency via `workerpool` for pHash.
  - WASM used for optimized Hamming distance.
- **Future Direction (User Request):**
  - **Major Refactoring (Ongoing):** Focus on testing (Phase 4), documentation, and potential optimizations (Phase 2 continued).
  - **Dependency Injection:** **Decision:** Manual Injection adopted.
  - **UI:** **Decision:** Initial CLI refactoring done (`CliReporter`). Further refinement planned. Web UI deferred.
  - **Scalability:** **Decision:** SQLite and DB-centric LSH implemented. Further optimization (e.g., DB queries in LSH loop) pending.
- **Key Components (Post-Phase 3 Initial):**
  - `index.ts`: CLI setup, orchestrates pipeline, performs Manual DI (including `CliReporter`).
  - `src/discovery.ts`, `src/gatherer.ts`, `src/deduplicator.ts`, `src/transfer.ts`: Pipeline stage logic (using `AppResult`, integrated with `CliReporter`).
  - `src/fileProcessor.ts`: Handles processing of a single file (using `AppResult`).
  - `src/comparatorUtils.ts`, `src/utils.ts`: Utility functions (using `AppResult` where applicable).
  - `src/jobs/`: Refactored job logic (functional style, using `AppResult`).
  - `src/caching/LmdbCache.ts`: LMDB caching implementation (using `AppResult`).
  - `src/external/`: Wrappers for exiftool, sharp, ffmpeg (using `AppResult`).
  - `src/services/MetadataDBService.ts`: SQLite database service (using `AppResult`, includes LSH support).
  - `src/reporting/CliReporter.ts`: Centralized CLI output service.
  - `MediaComparator.ts`: Primarily contains similarity calculation logic.
  - `src/errors.ts`: Defines `AppError` classes and `AppResult` type (using `neverthrow`).
  - `src/worker/`: Worker thread logic (pHash).
  - `assembly/`: WASM code (Hamming distance).
