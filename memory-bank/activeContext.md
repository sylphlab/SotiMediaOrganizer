<!-- Version: 1.9 | Last Updated: 2025-04-05 | Updated By: Cline -->

# Active Context

*   **Current Focus:** Understanding the SotiMediaOrganizer project by analyzing existing files and populating the Memory Bank.
*   **Recent Changes:** 
    *   Analyzed `README.md`, `package.json`, `index.ts`, `MediaOrganizer.ts`, `src/MediaProcessor.ts`, `MediaComparator.ts`, `src/contexts/Context.ts`.
    *   Analyzed core job files: `AdaptiveExtractionJob.ts`, `MetadataExtractionJob.ts`, `FileStatsJob.ts`.
    *   Analyzed job base classes: `FileHashBaseJob.ts`, `BaseFileInfoJob.ts`.
    *   Analyzed worker entry point: `src/worker/worker.ts`.
    *   Analyzed pHash implementation: `src/worker/perceptualHashWorker.ts`.
    *   Analyzed AssemblyScript code: `assembly/index.ts` (SIMD Hamming distance).
    *   Analyzed context services: `DatabaseService.ts`, `SharpService.ts`, `FFmpegService.ts`.
    *   Analyzed utilities: `src/utils.ts`, `VPTree.ts`.
    *   Updated Memory Bank files with comprehensive details on architecture, DI, pipeline stages, job responsibilities, deduplication algorithms, concurrency model, caching system, pHash implementation, WASM usage, service wrappers, and utilities.
*   **Next Steps:** 
    *   Review remaining minor files/configs (e.g., `src/types.ts`, `tsconfig.json`, `eslint.config.js`).
    *   Finalize Memory Bank population.
*   **Open Questions/Decisions:** How is the WASM Hamming distance function loaded and integrated into the TypeScript code (likely via `workerpool` or direct WASM instantiation)? 