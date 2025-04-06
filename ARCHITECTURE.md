# System Architecture

<!-- Version: 1.0 | Last Updated: 2025-04-06 -->

This document outlines the high-level architecture of the MediaCurator (`@sotilab/smo`) application.

## Overview

The application operates as a command-line pipeline, processing media files through distinct stages: discovery, gathering metadata/hashes, deduplication, and transfer/organization. It leverages external tools (FFmpeg, ExifTool, Sharp/libvips), caching (LMDB), a database (SQLite), concurrency (workerpool), and WASM for optimization. Error handling is managed using `neverthrow`, and CLI output is centralized via `CliReporter`.

## Architecture Diagram (Mermaid)

```mermaid
flowchart TD
    subgraph CLI Interface
        A[index.ts (Commander, Manual DI)]
    end

    subgraph Pipeline Stages
        B[discovery.ts]
        C[gatherer.ts]
        D[deduplicator.ts]
        E[transfer.ts]
    end

    subgraph Core Processing Logic
        F[fileProcessor.ts]
        G[comparatorUtils.ts]
        H[utils.ts]
        I[jobs/* (Functional Jobs)]
    end

    subgraph Services &amp; External Wrappers
        J[caching/LmdbCache.ts]
        K[external/* (ExifTool, FFmpeg, Sharp Wrappers)]
        L[services/MetadataDBService.ts (SQLite &amp; LSH Logic)]
        M[reporting/CliReporter.ts]
    end

    subgraph Concurrency &amp; Optimization
        N[worker/ (workerpool for pHash)]
        O[assembly/ (WASM for Hamming)]
    end

    %% Core Pipeline Flow
    A --> B
    B --> C
    C --> D
    D --> E

    %% File Processing Dependencies
    B --> F
    C --> F
    D --> F

    F --> G
    F --> H
    F --> I
    F --> K[External Wrappers]
    F --> J[LMDB Cache]
    F --> L[Metadata DB]
    F --> N[Worker Pool]

    %% Deduplication Dependencies
    D --> L[Metadata DB]
    D --> G[Comparator Utils]
    D --> O[WASM Hamming]

    %% Reporting Integration
    A --> M[CliReporter]
    B --> M
    C --> M
    D --> M
    E --> M

    %% Manual Dependency Injection from index.ts
    A -- Injects --> J
    A -- Injects --> K
    A -- Injects --> L
    A -- Injects --> M
    A -- Injects --> N
```

## Key Components

- **`index.ts`**: Entry point, CLI argument parsing (`commander`), orchestrates the pipeline stages, performs Manual Dependency Injection.
- **Pipeline Stages (`discovery.ts`, `gatherer.ts`, `deduplicator.ts`, `transfer.ts`)**: Implement the core logic for each step of the media processing workflow. They interact with `CliReporter` for user feedback.
- **`fileProcessor.ts`**: Contains the logic for processing a single media file (metadata extraction, hashing). Called by pipeline stages.
- **Core Logic (`comparatorUtils.ts`, `utils.ts`, `jobs/*`)**: Pure functions for calculations (similarity, hashing helpers), utilities, and refactored job logic.
- **Services &amp; Wrappers (`caching/`, `external/`, `services/`, `reporting/`)**: Encapsulate interactions with external tools (FFmpeg, ExifTool, Sharp), database (SQLite via `MetadataDBService`), caching (LMDB), and CLI output (`CliReporter`). `MetadataDBService` also handles LSH indexing and querying.
- **Concurrency &amp; Optimization (`worker/`, `assembly/`)**: Manage worker threads (`workerpool`) for parallel processing (like perceptual hashing) and contain WebAssembly modules (`assembly/`) for performance-critical calculations (like Hamming distance).
