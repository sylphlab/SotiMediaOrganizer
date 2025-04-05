<!-- Version: 0.3 | Last Updated: 2025-04-05 | Updated By: Cline -->

# Project Brief

- **Project Name:** MediaCurator (MediaCurator) / `@sotilab/smo`
- **Core Goal:** To provide a powerful, efficient, and scalable tool for intelligently organizing and deduplicating large digital photo and video collections based on metadata and content analysis.
- **Key Requirements:**
  - Organize media files into a user-defined directory structure based on metadata (date, geo, camera) and file info.
  - Detect and handle duplicate/similar media files (images and videos) using advanced techniques (perceptual hashing, VP Tree, DTW).
  - Support a wide range of media formats, leveraging FFmpeg and Sharp (libvips).
  - Offer high performance through concurrency (worker threads) and optimized libraries (AssemblyScript/WASM).
  - Provide robust operation with features like pause/resume (caching via LMDB).
  - Offer flexible configuration via CLI options (concurrency, thresholds, format strings, etc.).
  - **Scalability:** Must be designed to handle millions of media files efficiently.
  - **Architecture Style:** Primarily functional programming style preferred.
  - **Dependency Injection:** Re-evaluate current DI (Inversify); consider alternatives (e.g., Riverpod-like) or no framework.
  - **User Interface:** Improve CLI usability; potentially add a Web UI in the future.
- **Scope:**
  - **In Scope:** CLI application for local media organization and deduplication, support for common image/video formats, configurable parameters, high scalability.
  - **Out of Scope (Current):** Cloud storage integration, real-time monitoring, advanced media editing features. (Web UI is a potential future scope item).
