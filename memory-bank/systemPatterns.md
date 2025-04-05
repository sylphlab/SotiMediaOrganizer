<!-- Version: 1.8 | Last Updated: 2025-04-05 | Updated By: Cline -->

# System Patterns & Architecture

*   **Overall Architecture:** CLI application with a job-based processing pipeline, leveraging dependency injection (`inversify`) and worker threads (`workerpool`) for concurrency.
*   **Entry Point:** `index.ts` serves as the main entry point, utilizing `commander` to parse CLI arguments and options.
*   **Core Orchestration:** The `MediaOrganizer` class orchestrates the main workflow, injected with `MediaProcessor` and `MediaComparator`.
*   **Dependency Injection (`Context.ts`):**
    *   Manages the application's DI container using `inversify`.
    *   Initialized once via `ensureInitialized`.
    *   Binds core services (MediaOrganizer, MediaProcessor, MediaComparator, DatabaseContext, SharpService, FFmpegService) and Jobs (AdaptiveExtractionJob, etc.) as singletons (`inSingletonScope`).
    *   Binds configuration objects (ProgramOptions, SimilarityConfig, etc.) as constants (`toConstantValue`), derived from CLI options or defaults.
    *   Dynamically binds `ExifTool` (`toDynamicValue`) to configure `maxProcs` based on concurrency option.
    *   Dynamically and asynchronously binds the `WorkerPool` (`toDynamicValue`, bound to `Types.WorkerPool`). Uses `workerpool` library, points to `src/worker/worker.ts`, sets `maxWorkers` from concurrency option, uses `workerType: 'web'`, and proxies to a `CustomWorker` interface.
*   **External Tool Services:**
    *   **`DatabaseService.ts`:** Initializes the root LMDB database (`open({ path: '.mediadb', compression: true })`). Injected into Job base classes.
    *   **`SharpService.ts`:** Simple wrapper for the `sharp` library. Sets `sharp.concurrency()` based on `ProgramOptions`. Provides access to the `sharp` function. Injected into `AdaptiveExtractionJob`.
    *   **`FFmpegService.ts`:** Simple wrapper for the `fluent-ffmpeg` library. Provides access to `ffmpeg` command builder and `ffprobe`. Injected into `AdaptiveExtractionJob`.
*   **Single File Processing (`MediaProcessor.ts`):**
    *   Responsible for generating a complete `FileInfo` object for a single media file.
    *   Injects specific job classes (`AdaptiveExtractionJob`, `MetadataExtractionJob`, `FileStatsJob`).
    *   Runs these jobs concurrently (`Promise.all`) via its `process` method.
    *   Implements an in-memory cache (`_cached`) via the `processFile` wrapper method to avoid redundant processing within a single run.
    *   Provides `exportCache`/`importCache` methods for potential external state management.
*   **Job-Based Architecture (`src/jobs/`):**
    *   Specific tasks (stats, metadata, feature extraction) are encapsulated in dedicated Job classes.
    *   Jobs often extend a base class (`BaseFileInfoJob`, `FileHashBaseJob`) which handles persistent caching.
    *   Jobs are injected into `MediaProcessor`.
    *   **`AdaptiveExtractionJob.ts`:**
        *   Extends `FileHashBaseJob<MediaInfo, AdaptiveExtractionConfig>`.
        *   Extracts `MediaInfo` (frame hashes, timestamps, duration).
        *   Uses `SharpService` for image resizing/grayscaling.
        *   Uses `FFmpegService` (`ffprobe`, `ffmpeg`) for video duration and frame extraction.
        *   Employs a complex FFmpeg `select` filter for adaptive frame extraction based on scene changes and intervals.
        *   Delegates perceptual hash computation (`computePerceptualHash`) to the `WorkerPool`.
        *   Overrides `isConfigValid` for image-specific cache validation.
    *   **`MetadataExtractionJob.ts`:**
        *   Extends `FileHashBaseJob<Metadata>`.
        *   Extracts key metadata (`imageDate`, `width`, `height`, `gpsLatitude`, `gpsLongitude`, `cameraModel`).
        *   Uses the injected `ExifTool` service (`exiftool-vendored`).
        *   Includes helper (`toDate`) to parse date fields.
    *   **`FileStatsJob.ts`:**
        *   Extends `BaseFileInfoJob<FileStats, FileStatsConfig>`.
        *   Extracts basic file stats (`size`, `createdAt`, `modifiedAt`) using `fs/promises.stat`.
        *   Calculates an MD5 hash (`hashFile`) using `crypto`. Implements partial hashing (first/last chunks) for files larger than `maxChunkSize` for performance.
*   **Persistent Caching (`BaseFileInfoJob.ts`, `FileHashBaseJob.ts`, `DatabaseService.ts`):**
    *   Managed by abstract base classes for Jobs.
    *   Uses LMDB via injected `DatabaseContext`.
    *   `DatabaseContext` initializes the root LMDB database (`open({ path: '.mediadb', compression: true })`).
    *   `BaseFileInfoJob` opens two job-specific sub-databases (results, config) within the root DB.
    *   Cache key determined by `getHashKey` (defaults to `filePath` in `BaseFileInfoJob`, overridden to use MD5 hash from `FileStatsJob` in `FileHashBaseJob`).
    *   Cache validation (`isConfigValid`) compares current job config with cached config using `deep-eql`.
    *   Uses in-memory `Mutex` per cache key to prevent race conditions during cache checks/writes.
    *   Includes helpers for serializing/deserializing complex types (e.g., `SharedArrayBuffer`) for LMDB storage.
*   **Deduplication (`MediaComparator.ts`):**
    *   **Algorithm:** Uses VPTree + parallelized DBSCAN.
        *   Builds a VPTree (`VPTree.build`) using a distance function based on `calculateSimilarity`.
        *   Performs DBSCAN clustering (`parallelDBSCAN`, `workerDBSCAN`) using the injected `WorkerPool` for parallelism.
        *   DBSCAN uses the VPTree (`getValidNeighbors`) for efficient neighbor search within an epsilon derived from the minimum similarity threshold.
        *   Validates neighbors using adaptive thresholds (`getAdaptiveThreshold`) based on media types (Image-Image, Image-Video, Video-Video).
        *   Merges results from worker batches (`mergeAndDeduplicate`).
    *   **Similarity Calculation (`calculateSimilarity`):
        *   Image-Image: Hamming distance. Likely uses WASM (`assembly/index.ts#hammingDistanceSIMD`) for performance, falling back to TypeScript (`MediaComparator#hammingDistance`).
        *   Image-Video: Best Hamming distance between image hash and all video frame hashes.
        *   Video-Video: Dynamic Time Warping (DTW) (`calculateSequenceSimilarityDTW`) on frame hash sequences, using a sliding window approach.
    *   **Representative Selection (`processResults`, `selectRepresentatives`):
        *   Selects the best file(s) from each duplicate cluster based on a scoring function (`calculateEntryScore` - considers duration, metadata, resolution, size).
        *   Includes special logic (`handleMultiFrameBest`) to potentially preserve high-quality image captures found within video clusters.
*   **Worker Implementation (`src/worker/`):**
    *   **`worker.ts`:** Defines functions exposed via `workerpool` (`performDBSCAN`, `computePerceptualHash`).
        *   `performDBSCAN` worker function re-initializes DI container, imports main thread cache, recreates VPTree, and calls `MediaComparator.workerDBSCAN`.
        *   `computePerceptualHash` worker function instantiates/caches `PerceptualHashWorker` and calls its method.
    *   **`perceptualHashWorker.ts`:** Contains the core pHash logic.
        *   Implements DCT-based perceptual hashing (similar to pHash).
        *   Pre-computes DCT coefficients based on resolution.
        *   Uses Quickselect algorithm to find median of AC coefficients for thresholding.
        *   Pure TypeScript implementation.
*   **AssemblyScript/WASM (`assembly/index.ts`):**
    *   Provides a highly optimized `hammingDistanceSIMD` function using WASM SIMD instructions.
    *   Likely loaded and used by `MediaComparator` at runtime for fast perceptual hash comparisons.
*   **Utilities:**
    *   **`src/utils.ts`:** Provides helper functions for determining file type from extension, defines supported extensions, includes helpers for Buffer/SharedArrayBuffer/Hex conversions, and async array helpers.
    *   **`VPTree.ts`:** Implements a Vantage-Point Tree for efficient nearest neighbor search based on a provided distance function. Used by `MediaComparator` to accelerate DBSCAN.
*   **Processing Pipeline:** The core logic follows a distinct four-stage process managed by `MediaOrganizer`:
    1.  **File Discovery (`discoverFiles`):** Recursively scans source directories using `fs/promises.readdir` and filters by supported extensions. Uses `async-mutex.Semaphore` for concurrency control and `@topcli/spinner` for basic progress feedback. Returns files grouped by extension.
    2.  **Information Gathering (`gatherFileInfo`):** Processes discovered files concurrently (using `Semaphore`). Calls `MediaProcessor.processFile` for each file to get `FileInfo`. Uses `cli-progress.MultiBar` for detailed, per-format progress display. Returns lists of valid and error file paths.
    3.  **Deduplication (`deduplicateFiles`):** Delegates to `MediaComparator.deduplicateFiles`, passing `MediaProcessor.processFile` as a callback for on-demand `FileInfo` retrieval (leveraging `MediaProcessor`'s in-memory cache). Uses `@topcli/spinner` for progress feedback. Returns unique files and duplicate sets.
    4.  **File Transfer (`transferFiles`):** Moves or copies files based on deduplication results and user options. Uses `generateTargetPath` to calculate destination paths based on the format string, handling potential filename collisions with random suffixes. Uses `transferOrCopyFile` for actual file operations (including cross-device move fallback). Uses `cli-progress.MultiBar` for transfer progress. Generates detailed HTML debug reports (`generateReports`, `generateIndex`) if a `debugDir` is specified.
*   **Concurrency:** Uses `workerpool` (configured in `Context.ts`, functions defined in `worker.ts`, used in `MediaComparator` for DBSCAN, used in `AdaptiveExtractionJob` for pHash) for CPU-intensive tasks and `async-mutex.Semaphore` within `MediaOrganizer` for controlling I/O-bound concurrency during discovery and info gathering.
*   **Caching/State:** Two layers:
    *   Persistent (LMDB): Managed by Job base classes (`BaseFileInfoJob`, `FileHashBaseJob`) via `DatabaseContext`. Keyed by path or content hash, validated against config.
    *   In-Memory (Map): Managed by `MediaProcessor`. Keyed by path, valid per run. Passed to workers during parallel tasks.
*   **Target Path Generation (`generateTargetPath`):** Substitutes placeholders in the user-provided format string using data from `FileInfo` (dates, metadata, filename parts). Handles missing data gracefully and resolves filename conflicts.
*   **Key Components:**
    *   `index.ts`: CLI setup and main process flow initiation.
    *   `MediaOrganizer.ts`: Central orchestrator for the four-stage pipeline, handles file discovery, transfer, progress reporting, and debug report generation.
    *   `Context.ts`: DI container setup, service/config/workerpool binding.
    *   `MediaProcessor.ts`: Responsible for processing individual files by running injected Jobs and providing in-memory caching.
    *   `MediaComparator.ts`: Implements VPTree + parallel DBSCAN for clustering, calculates similarity using Hamming/DTW, selects representatives.
    *   `src/jobs/`: Contains individual processing units (e.g., `AdaptiveExtractionJob`, `MetadataExtractionJob`, `FileStatsJob`). Base classes like `FileHashBaseJob`, `BaseFileInfoJob` handle caching.
    *   `src/worker/worker.ts`: Defines functions executed by `workerpool`.
    *   `src/worker/perceptualHashWorker.ts`: Contains core DCT-based pHash logic (TypeScript).
    *   `assembly/index.ts`: Provides WASM SIMD-optimized Hamming distance function.
    *   `src/contexts/DatabaseService.ts`: Initializes the root LMDB database.
    *   `src/contexts/SharpService.ts`: Wrapper for `sharp` library, sets concurrency.
    *   `src/contexts/FFmpegService.ts`: Wrapper for `fluent-ffmpeg` library.
    *   `src/utils.ts`: Common utility functions and constants.
    *   `VPTree.ts`: Implementation of the Vantage-Point Tree data structure.
*   **Data Flow:** CLI options -> Context Initialization -> MediaOrganizer orchestrates stages -> Calls MediaProcessor/MediaComparator -> MediaProcessor calls specific Jobs -> MediaComparator builds VPTree, runs parallel DBSCAN (using workers, passing cache/options/VPTree root) -> Jobs executed (potentially in workers, using LMDB cache via DatabaseContext) -> Results aggregated -> Files transferred by MediaOrganizer.