# MediaCurator (@sotilab/smo)

<!-- Badges (Update URLs/paths as needed) -->

[![CI Status](https://github.com/shtse8/MediaCurator/actions/workflows/ci.yml/badge.svg)](https://github.com/shtse8/MediaCurator/actions/workflows/ci.yml)
[![Coverage Status](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/shtse8/MediaCurator) <!-- Placeholder: Update if using Codecov etc. -->
[![npm version](https://badge.fury.io/js/%40sotilab%2Fsmo.svg)](https://badge.fury.io/js/%40sotilab%2Fsmo)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**✨ Intelligently curate, organize, and deduplicate your digital photo and video collection. ✨**

MediaCurator is your ultimate command-line tool for bringing order to large, cluttered media libraries. Built with performance, scalability, and robustness in mind using modern TypeScript.

➡️ **[Get Started](#-easy-installation) | [View Documentation](#-documentation) (Coming Soon) | [Contribute](#-contribute-to-mediacurator)** ⬅️

## 🤔 Why MediaCurator?

Managing ever-growing digital photo and video collections is a common challenge. Files get scattered, duplicates accumulate, and finding specific media becomes difficult. MediaCurator addresses this by providing:

- **Automated Organization:** Structure your library logically based on metadata.
- **Intelligent Deduplication:** Reclaim storage space by identifying and handling duplicate or visually similar files.
- **Efficiency:** Process large collections quickly using optimized algorithms and concurrency.
- **Flexibility:** Customize organization and deduplication parameters to fit your needs.

## 💡 Core Philosophy

MediaCurator is developed with these principles:

- **Impact-Driven**: Solve real media management problems effectively.
- **Simplicity & Minimalism**: Favor clear, direct solutions over complexity.
- **Functional Style**: Emphasize pure functions, immutability, and composition.
- **Minimal Dependencies**: Use external libraries judiciously, preferring built-in APIs.

## 🚀 Key Features

- **Smart Organization**: Organize by date, geo, camera model via flexible format strings.
- **Advanced Deduplication**: DB-centric LSH for scalable duplicate/similarity detection (images & videos).
- **High Performance**: Optimized with Sharp (libvips), FFmpeg, SQLite (`better-sqlite3`), WASM, and `workerpool`.
- **Robust Architecture**: Functional TypeScript pipeline (`neverthrow` error handling), Manual DI.
- **Scalable Storage**: SQLite for efficient metadata handling of millions of files.
- **Efficient Caching**: LMDB cache for pause/resume and faster re-runs.
- **Wide Format Support**: Handles common image/video formats (extendable).
- **Refined CLI**: Clear progress indicators and verbose logging (`CliReporter`).

## 📊 Performance & Quality

- **Efficiency**: Designed for speed with optimized algorithms (LSH, WASM) and concurrency. _(Benchmark results coming soon)_
- **Test Coverage**: Aiming for **100% code coverage**, enforced via CI. [![Coverage Status](https://img.shields.io/badge/coverage-100%25-brightgreen)](#) <!-- Placeholder -->
- **Code Quality**: Maintained with strict ESLint rules and Prettier formatting.

## 📚 Documentation

Detailed documentation including guides, API references, and advanced usage examples will be available soon via VitePress.

_(Link to documentation site will be added here)_

## 🌟 Easy Installation

Install MediaCurator globally using Bun:

```bash
bun install --global @sotilab/smo
```

This makes the `smo` command available in your terminal.

## 🔥 Usage

Organize your media with:

```bash
smo <source...> <destination> [options]
```

**Example:**

Organize media from multiple sources, move files, set custom thresholds, and use a specific format:

```bash
smo /media/photos /media/downloads/new_vids /library/organized \
  -d /library/duplicates \
  -e /library/errors \
  --move \
  --resolution 64 \
  --target-fps 2 \
  --image-similarity-threshold 0.98 \
  --video-similarity-threshold 0.95 \
  --format "{D.YYYY}/{D.MMMM}/{TYPE}/{NAME}_{RND}.{EXT}" \
  --verbose
```

**Options:**

- `<source...>`: (Required) Source directories/files.
- `<destination>`: (Required) Destination directory.
- `-e, --error <path>`: Directory for processing errors.
- `-d, --duplicate <path>`: Directory for duplicates.
- `--debug <path>`: Directory for debug reports (all files in duplicate sets).
- `-c, --concurrency <number>`: Number of workers (default: CPU cores - 1).
- `-m, --move`: Move files instead of copying (default: false).
- `-r, --resolution <number>`: pHash resolution (default: 64).
- `--min-frames <number>`: Min video frames (default: 5).
- `--max-scene-frames <number>`: Max scene frames (default: 100).
- `--target-fps <number>`: Target video FPS (default: 2).
- `-w, --window-size <number>`: Frame clustering window (default: 5).
- `-p, --step-size <number>`: Frame clustering step (default: 1).
- `-F, --format <string>`: Destination format string (see below).
- `--scene-change-threshold <number>`: Scene change threshold (default: 0.01).
- `--image-similarity-threshold <number>`: Image similarity threshold (default: 0.99).
- `--image-video-similarity-threshold <number>`: Image-video similarity threshold (default: 0.93).
- `--video-similarity-threshold <number>`: Video similarity threshold (default: 0.93).
- `--max-chunk-size <number>`: Max file processing chunk size (default: 2MB).
- `-v, --verbose`: Enable verbose logging.

**Format String Placeholders:**

_(See previous README version or future documentation for the detailed list of date, filename, metadata, and conditional placeholders.)_

## 🏗️ Architecture Overview

MediaCurator uses a pipeline architecture with SQLite for metadata/LSH and LMDB for caching.

```mermaid
flowchart TD
    A[Start: smo command] --> B{1. Discovery};
    B -- File Paths --> C{2. Gatherer};
    C -- FileInfo (Metadata, Hashes) --> D[Metadata DB (SQLite)];
    C -- Intermediate Results --> E[Cache (LMDB)];
    D -- Stored FileInfo --> F{3. Deduplicator};
    F -- Similarity Candidates --> D;
    F -- Duplicate Sets & Unique Files --> G{4. Transfer};
    G -- Files to Move/Copy --> H[Filesystem];
    G -- Debug Reports --> I[Debug Output];

    subgraph "Pipeline Stages"
        B; C; F; G;
    end

    subgraph "Core Services & Data"
        D; E; H; I;
    end

    subgraph "External Tools (Used by Gatherer)"
        J[FFmpeg]; K[Sharp/libvips]; L[ExifTool];
    end
    subgraph "Concurrency (Used by Gatherer)"
        M[Worker Pool (pHash)];
    end

    C --> J; C --> K; C --> L; C --> M;
```

## 💻 Development Setup

Refer to the [CONTRIBUTING.md](CONTRIBUTING.md) file for details on setting up your development environment, running tests, and contributing.

**Key Commands:**

- Install: `bun install`
- Build: `bun run build`
- Test: `bun test`
- Lint: `bun run lint`
- Format: `bun run format`

**Note on Testing:** Some tests involving complex mocking may currently fail under `bun test`. See `memory-bank/progress.md` for details.

## 🤝 Contribute to MediaCurator

Contributions are welcome! Please read the [CONTRIBUTING.md](CONTRIBUTING.md) guidelines before submitting pull requests.

## 📝 License

MediaCurator is open-source software licensed under the [MIT License](LICENSE).
