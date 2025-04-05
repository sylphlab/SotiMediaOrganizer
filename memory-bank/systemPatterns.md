<!-- Version: 2.0 | Last Updated: 2025-04-05 | Updated By: Cline -->

# System Patterns & Architecture

- **Current State (Post-Phase 1 Refactor):**
  - CLI application entry via `index.ts` using `commander`.
  - Core logic decomposed into pipeline stage functions (`src/discovery.ts`, `src/gatherer.ts`, `src/deduplicator.ts`, `src/transfer.ts`).
  - Pure computational logic extracted to utils (`src/utils.ts`, `src/comparatorUtils.ts`).
  - Caching isolated (`src/caching/LmdbCache.ts`), refactored to use `AppResult`.
  - External tool interactions wrapped (`src/external/`), refactored to use `AppResult`.
  - Job logic refactored into functional forms (`src/jobs/`), using `AppResult`.
  - `MediaProcessor` class replaced by functional `processSingleFile` (`src/fileProcessor.ts`).
  - **Dependency Management:** Manual Injection implemented in `index.ts` (Inversify removed).
  - **Error Handling:** Standardized using `neverthrow` (`AppResult`) via `src/errors.ts`.
  - Concurrency via `workerpool` for pHash.
  - WASM used for optimized Hamming distance.
  - **Deduplication (Pre-Phase 2):** Still uses VPTree/DBSCAN via `MediaComparator`, relying on pre-fetched data. Exact matching uses DB pHash.
- **Future Direction (User Request):**
  - **Major Refactoring (Ongoing):** Continue functional refactoring, focusing on scalability and potentially UI.
  - **Dependency Injection:** **Decision:** Manual Injection adopted.
  - **UI:** **Decision:** CLI improvements prioritized over Web UI for now.
  - **Scalability:** **Decision:** Adopt SQLite (`better-sqlite3`) for metadata/state. **Decision:** Replace VPTree/DBSCAN with DB-centric LSH approach for similarity search (Phase 2).
- **Key Components (Post-Phase 1):**
  - `index.ts`: CLI setup, orchestrates pipeline, performs Manual DI.
  - `src/discovery.ts`, `src/gatherer.ts`, `src/deduplicator.ts`, `src/transfer.ts`: Pipeline stage logic (using `AppResult`).
  - `src/fileProcessor.ts`: Handles processing of a single file (using `AppResult`).
  - `src/comparatorUtils.ts`, `src/utils.ts`: Utility functions (using `AppResult` where applicable).
  - `src/jobs/`: Refactored job logic (functional style, using `AppResult`).
  - `src/caching/LmdbCache.ts`: LMDB caching implementation (using `AppResult`).
  - `src/external/`: Wrappers for exiftool, sharp, ffmpeg (using `AppResult`).
  - `src/services/MetadataDBService.ts`: SQLite database service (using `AppResult`).
  - `MediaComparator.ts`: Contains similarity calculation logic and legacy VPTree/DBSCAN orchestration (partially refactored, target for Phase 2 changes).
  - `src/errors.ts`: Defines `AppError` classes and `AppResult` type (using `neverthrow`).
  - `src/worker/`: Worker thread logic (pHash).
  - `assembly/`: WASM code (Hamming distance).
