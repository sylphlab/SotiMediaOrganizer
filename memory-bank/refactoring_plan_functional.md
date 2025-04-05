<!-- Version: 1.0 | Last Updated: 2025-04-05 | Updated By: Cline -->

# Functional Refactoring Plan for MediaCurator

## 1. Goal

Refactor the MediaCurator application towards a more functional programming
style. This involves emphasizing pure functions, immutability where practical,
and clearly isolating side effects (like I/O, caching, external tool usage).

## 2. Analysis of Current State

The current architecture (as documented in `systemPatterns.md`) is heavily
object-oriented:

- Relies on classes (`MediaOrganizer`, `MediaProcessor`, `MediaComparator`,
  various `Jobs`) for core logic and state management.
- Uses Dependency Injection (`inversify`) extensively for wiring components.
- Employs a job-based system where individual tasks are encapsulated in classes.
- Integrates caching (in-memory via `MediaProcessor`, persistent via LMDB in Job
  base classes) directly within the logic flow, leading to side effects within
  core components.
- Manages concurrency via `workerpool` and `async-mutex`.

## 3. Proposed Functional Architecture

The refactoring aims to shift towards function composition and explicit data
flow, minimizing reliance on classes and isolating side effects.

**Core Concepts:**

- **Pipeline Composition:** The main workflow (`MediaOrganizer`) will be
  refactored into a sequence of composed functions, each representing a stage
  and passing data explicitly.
- **Pure Computation Functions:** Core logic (hashing, similarity, metadata
  extraction, etc.) will be extracted into pure functions that take data and
  configuration, returning results without side effects.
- **Isolated Side-Effecting Modules:** Operations involving I/O, external tools,
  caching, and reporting will be moved into dedicated modules/functions whose
  primary purpose is to handle these side effects.

**Key Functional Components:**

- **Pipeline Functions:**
  - `discoverFilesFn(config) -> FileList`
  - `gatherInfoFn(fileList, config, cacheReader, toolRunners) -> ProcessedFiles`
  - `deduplicateFn(processedFiles, config, cacheReader, toolRunners) -> { unique: FileInfo[], duplicates: DuplicateSet[] }`
  - `transferFilesFn(results, config, ioHandler) -> TransferReport`
- **Pure Computation Functions (Examples):**
  - `extractMetadataFn(filePath, exifToolRunner) -> Metadata`
  - `calculateHashFn(filePath, cryptoRunner) -> Hash`
  - `calculateSimilarityFn(fileA, fileB, config) -> SimilarityScore`
  - `selectRepresentativeFn(duplicateSet, scoringFn) -> FileInfo`
  - `buildVPTreeFn(data, distanceFn) -> VPTree`
  - `runDBSCANFn(tree, data, config, distanceFn) -> Clusters`
- **Side-Effecting Modules/Functions (Examples):**
  - `Caching Module (LMDB)`: Handles reads, writes, validation, mutex logic for
    persistent cache.
  - `Filesystem I/O Module`: Handles file reads, writes, stats, directory
    scanning.
  - `External Tools Module`: Wrappers for `ffmpeg`, `sharp`, `exiftool`.
  - `Reporting Module`: Handles console output, progress bars, debug reports.
  - `Simplified Workers`: Execute pure computation functions, receiving data
    explicitly.

**Architecture Visualization:**

```mermaid
graph TD
    subgraph Proposed Functional Architecture (Simplified)
        CLI --> F_Config[Configuration]
        F_Config --> F_Pipeline[Pipeline Composition]

        subgraph Pipeline Functions
            F_Discover[discoverFilesFn] --> F_Gather[gatherInfoFn]
            F_Gather --> F_Deduplicate[deduplicateFn]
            F_Deduplicate --> F_Transfer[transferFilesFn]
        end

        F_Pipeline --> F_PureFuncs[Pure Computation Functions]
        F_Pipeline --> F_SideEffects[Side-Effecting Functions/Modules]

        subgraph Pure Functions
            direction LR
            F_Metadata[extractMetadataFn]
            F_Hash[calculateHashFn]
            F_Similarity[calculateSimilarityFn]
            F_Select[selectRepresentativeFn]
            F_VPTree[buildVPTreeFn]
            F_DBSCAN[runDBSCANFn]
        end

        subgraph Side-Effecting Functions/Modules
            direction LR
            F_Cache[Caching Module (LMDB)]
            F_IO[Filesystem I/O Module]
            F_Tools[External Tools Module]
            F_Report[Reporting Module]
            F_Workers[Simplified Workers]
        end

        F_Pipeline --> F_Workers --> F_PureFuncs
        F_SideEffects --> F_Cache
        F_SideEffects --> F_IO
        F_SideEffects --> F_Tools
        F_SideEffects --> F_Report
    end
```

## 4. Refactoring Steps Outline

1. **Identify & Refactor Pure Computations:** Extract core algorithms (hashing,
   similarity, metadata parsing logic, etc.) from existing classes (`Jobs`,
   `MediaComparator`, workers) into standalone pure functions.
2. **Isolate Caching:** Design and implement an explicit `Caching Module`. This
   module will encapsulate all LMDB interactions (get, set, check config, handle
   mutexes). Update Job logic to call this module instead of handling caching
   internally.
3. **Isolate I/O & External Tools:** Create dedicated functions/modules to wrap
   filesystem operations (`fs`), external tool calls (`ffmpeg`, `sharp`,
   `exiftool`), and console reporting (`cli-progress`, spinners).
4. **Refactor Core Logic (`MediaProcessor`, `MediaComparator`):** Replace the
   class-based logic with compositions of the new pure functions and calls to
   the isolated side-effecting modules (Caching, Tools, IO). Data should be
   passed explicitly.
5. **Refactor Orchestration (`MediaOrganizer`):** Reimplement the four-stage
   pipeline using function composition, passing data between stages. Remove
   state management from the orchestrator.
6. **Simplify Workers:** Refactor worker entry points (`worker.ts`) to receive
   data/config and primarily call the refactored pure computation functions.
   Remove complex DI setup within workers.
7. **Revisit Dependency Injection:** Reduce reliance on `inversify`. Pass
   dependencies (like the Caching Module instance, tool runners, configuration
   objects) explicitly down the function call chain where needed.
8. **Testing:** Adapt existing tests and add new unit tests for pure functions
   and integration tests for the refactored pipeline and side-effecting modules.

## 5. Agreed Decisions & Approach

- **Language:** Use standard TypeScript features and patterns. Avoid introducing
  large FP libraries like `fp-ts` for now.
- **Purity:** Aim for a pragmatic level of purity. Core computations should be
  pure, but minor, controlled side effects (like logging within helper
  functions) might be acceptable if clearly documented. Major side effects (I/O,
  Caching, External Tools) MUST be isolated.
- **Caching:** Implement an explicit `Caching Module` to handle all LMDB
  interactions. This module will be passed as a dependency where needed.
- **Performance:** Prioritize correctness and clear functional separation during
  the initial refactoring. Performance optimization can be addressed
  subsequently if needed, but the current performance level is not a strict
  constraint for this phase.
