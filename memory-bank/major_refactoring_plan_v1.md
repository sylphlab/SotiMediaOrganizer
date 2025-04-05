# MediaCurator Major Refactoring Plan

**Version:** 1.0
**Date:** 2025-04-05
**Author:** Cline

### 1. Introduction & Goals

This document outlines the plan for a major architectural refactoring of the MediaCurator application. The primary goals are:

1.  **Adopt Thorough Functional Programming (FP):** Move beyond the initial refactor to deeply embed FP principles (purity, immutability, composition, explicit side-effect management) throughout the codebase.
2.  **Re-evaluate Dependency Injection (DI):** Critically assess the current use of Inversify. Explore alternatives like Riverpod-inspired patterns (simple state/service locators suitable for FP) or potentially removing the DI framework altogether in favor of manual injection or context passing. **Decision:** Remove Inversify.
3.  **Enhance User Interface (UI):** Improve the usability and feedback of the existing Command Line Interface (CLI). Design and potentially implement a foundation for a future Web UI. **Decision:** Web UI foundation is lower priority for this refactor.
4.  **Ensure Scalability:** Architect the system to efficiently handle potentially millions of media files, focusing on memory usage, data processing, concurrency, and caching strategies. **Decision:** Adopt SQLite for metadata/state management.

### 2. Analysis of Current State

Based on the Memory Bank (`systemPatterns.md`, `refactoring_plan_functional.md`, `.clinerules`):

*   **Strengths:** Initial functional decomposition into pipeline stages, isolation of caching (LMDB) and external tools, use of WASM/Workers for performance.
*   **Areas for Improvement:**
    *   **FP Depth:** While some parts are functional, core areas like `MediaComparator.ts` (VPTree/DBSCAN logic) remain imperative. Error handling isn't consistently functional.
    *   **DI:** Inversify is still present and manages dependencies. Its necessity in a more functional architecture is questionable and adds complexity, especially in workers.
    *   **Scalability:** Current approach likely loads significant data into memory for deduplication (VPTree). Caching is present but might need optimization for massive datasets. Concurrency is handled by `workerpool`, but its interaction with state/cache needs review for scalability.
    *   **UI:** CLI is functional but could benefit from better progress reporting, error presentation, and configuration clarity. No Web UI exists.
    *   **Testing:** Known issues with mocking (`bun test`) need addressing in the new architecture.

### 3. Proposed Architecture & Principles

We will evolve the architecture based on the following:

*   **Functional Core:**
    *   Prioritize pure functions for all core computations (hashing, comparison, metadata transformation, scoring, etc.).
    *   Utilize immutable data structures where feasible (e.g., using libraries like `immer` or careful manual copying).
    *   Compose the main application logic as a pipeline of functions.
    *   Explicitly manage side effects (IO, Caching, DB access, API calls, Tool execution) by isolating them in dedicated modules/functions.
    *   Adopt a consistent FP error handling strategy (e.g., using a `Result` type monad or similar pattern) to avoid exceptions in pure code.
*   **Dependency Management Strategy:**
    *   **Decision:** Remove `Inversify`.
    *   **Replacement:** Implement a simple, explicit dependency provision mechanism. Options considered: Manual Injection, Context/Reader Monad.
    *   **Chosen Approach:** Evaluate Manual Injection and Context/Reader during Phase 1 and select the most suitable. `Context.ts` will be removed or drastically simplified.
*   **Scalability Strategy:**
    *   **Data Handling:** Avoid loading all file metadata/hashes into memory at once. Implement streaming or batch processing where possible.
    *   **Metadata/State Storage:** Introduce SQLite to store file metadata, hashes, and potentially deduplication state via a dedicated `Metadata DB Module`. This allows for more complex querying and better scaling. LMDB might still be used for simpler caching tasks if appropriate, managed by a separate `Caching Module`.
    *   **Deduplication Algorithm:** Re-evaluate VPTree/DBSCAN for memory usage with millions of points. Explore alternatives or optimizations (e.g., approximate nearest neighbor algorithms, different clustering approaches, pre-filtering).
    *   **Concurrency:** Refine worker usage. Ensure workers operate on batches of data and interact minimally with shared state/cache/DB to avoid bottlenecks.
*   **UI Strategy:**
    *   **CLI:** Refine output using libraries like `chalk`, improve progress indicators (potentially per-stage), provide clearer error messages, and potentially interactive configuration prompts.
    *   **Web UI (Foundation):** Lower priority for this refactor.
*   **Architecture Visualization:**

    ```mermaid
    graph TD
        subgraph User Interface
            direction LR
            UI_CLI[CLI (Refined)]
            %% UI_Web[Web UI (Optional)] --> API[API Layer (Optional)]
        end

        subgraph Core Application Logic (Functional)
            direction TB
            A[Input (Config, Paths)] --> B(Pipeline Orchestrator);

            subgraph Pipeline Stages (Function Composition w/ Result Type)
                B --> Stage1[1. Discovery (IO Effects)];
                Stage1 --> Stage2[2. Gathering (IO/Tool/Cache/DB Effects)];
                Stage2 --> Stage3[3. Deduplication (Cache/DB/Compute Effects)];
                Stage3 --> Stage4[4. Transfer (IO Effects)];
            end

            subgraph Core Services / Effects (Explicitly Provided)
                direction LR
                S_IO[Filesystem IO Module]
                S_Cache[Caching Module (LMDB?)]
                S_DB[Metadata DB Module (SQLite)]
                S_Tools[External Tools Module]
                S_Compute[Computation Module (WASM, Workers)]
                S_Error[Error Handling (Result Type)]
                S_Config[Configuration Provider]
            end

            Stage1 -- Uses --> S_IO;
            Stage2 -- Uses --> S_IO;
            Stage2 -- Uses --> S_Tools;
            Stage2 -- Uses --> S_Cache;
            Stage2 -- Uses --> S_DB;
            Stage3 -- Uses --> S_Cache;
            Stage3 -- Uses --> S_DB;
            Stage3 -- Uses --> S_Compute;
            Stage4 -- Uses --> S_IO;

            B -- Provides --> S_Config;
            Pipeline -- Returns --> S_Error;

        end

        UI_CLI --> B;
        %% API --> B; % If Web UI exists
    ```

### 4. Refactoring Phases/Tasks

1.  **Phase 1: Foundational FP Refinement & Dependency Strategy**
    *   **Task 1.1:** Define and implement `Result` type and error handling patterns. Refactor existing functions to use it.
    *   **Task 1.2:** Deep refactor of `MediaComparator.ts` and related logic into pure functions using the `Result` type.
    *   **Task 1.3:** Implement the chosen Dependency Management strategy (Manual Injection or Context/Reader). Remove Inversify. Refactor how dependencies are provided.
    *   **Task 1.4:** Refactor remaining imperative code sections into pure functions or clearly isolated side-effecting modules.
2.  **Phase 2: Scalability Enhancements**
    *   **Task 2.1:** Implement the `Metadata DB Module` using SQLite.
    *   **Task 2.2:** Refactor pipeline stages (`Gathering`, `Deduplication`) to use the SQLite DB, focusing on streaming/batching and reduced memory footprint.
    *   **Task 2.3:** Optimize/Re-evaluate the deduplication algorithm (VPTree/DBSCAN) for memory and performance with large datasets. Implement changes in the `Computation Module`.
    *   **Task 2.4:** Refine worker implementation for better batching and reduced contention with the DB.
    *   **Task 2.5:** Introduce benchmarking for key stages and perform initial optimizations.
3.  **Phase 3: UI Improvements**
    *   **Task 3.1:** Refine CLI output, progress reporting, and error presentation.
4.  **Phase 4: Testing & Documentation**
    *   **Task 4.1:** Develop a robust testing strategy addressing previous mocking issues. Implement comprehensive unit tests for pure functions and integration tests for pipeline stages and side-effecting modules (especially DB interactions).
    *   **Task 4.2:** Update ALL Memory Bank documents (`projectbrief.md`, `systemPatterns.md`, etc.) to reflect the new architecture. Update this plan document if necessary.
    *   **Task 4.3:** Ensure user documentation (README.md) is updated.

### 5. Technology Choices/Considerations

*   **Error Handling:** `neverthrow` or a similar lightweight `Result` type library.
*   **Immutability:** Potentially `immer` if complex state updates are needed, otherwise rely on careful copying/spreading.
*   **Database:** `better-sqlite3`.
*   **Testing:** Continue with Jest/Bun Test, focusing on testing pure functions directly and mocking the *interfaces* of side-effecting modules.

### 6. Timeline & Milestones (High-Level)

*   **Milestone 1 (Phase 1 Complete):** Core logic is functional, DI removed, error handling standardized.
*   **Milestone 2 (Phase 2 Complete):** SQLite DB integrated, pipeline stages refactored for scalability, algorithm reviewed/optimized, basic benchmarking done.
*   **Milestone 3 (Phase 3 Complete):** CLI improved.
*   **Milestone 4 (Phase 4 Complete):** Comprehensive tests passing, documentation updated.

### 7. Open Questions & Next Steps

*   Final decision between Manual Injection vs. Context/Reader approach for dependency provision (during Phase 1).
*   Specific optimizations for the deduplication algorithm (during Phase 2).

**Next Step:** Begin implementation, starting with Phase 1.