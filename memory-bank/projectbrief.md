<!-- Version: 0.2 | Last Updated: 2025-04-05 | Updated By: Cline -->

# Project Brief

- **Project Name:** MediaCurator (MediaCurator) / `@sotilab/smo`
- **Core Goal:** To provide a powerful CLI tool for intelligently organizing and deduplicating digital photo and video collections based on metadata and content analysis.
- **Key Requirements:**
  - Organize media files into a user-defined directory structure based on metadata (date, geo, camera) and file info.
  - Detect and handle duplicate/similar media files (images and videos) using advanced techniques (perceptual hashing, VP Tree, DTW).
  - Support a wide range of media formats, leveraging FFmpeg and Sharp (libvips).
  - Offer high performance through concurrency (worker threads) and optimized libraries (AssemblyScript/WASM).
  - Provide robust operation with features like pause/resume (caching via LMDB).
  - Offer flexible configuration via CLI options (concurrency, thresholds, format strings, etc.).
  - Utilize Dependency Injection (`inversify`) for modularity and testability.
  - Implement a job-based architecture for processing steps.
- **Scope:**
  - **In Scope:** CLI application for local media organization and deduplication, support for common image/video formats, configurable organization and deduplication parameters.
  - **Out of Scope:** Cloud storage integration, real-time monitoring, GUI, advanced media editing features.
