# MediaCurator (@sylphlab/MediaCurator)

<!-- Badges (Update URLs/paths as needed) -->

[![CI Status](https://github.com/sylphlab/MediaCurator/actions/workflows/ci.yml/badge.svg)](https://github.com/sylphlab/MediaCurator/actions/workflows/ci.yml)
[![Coverage Status](https://img.shields.io/badge/coverage-100%25-brightgreen)](https://github.com/sylphlab/MediaCurator) <!-- Placeholder: Update if using Codecov etc. -->
[![npm version](https://badge.fury.io/js/%40sylphlab%2Fmedia-curator.svg)](https://badge.fury.io/js/%40sylphlab%2Fmedia-curator)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**✨ Intelligently curate, organize, and deduplicate your digital photo and video collection. ✨**

MediaCurator is your ultimate command-line tool for bringing order to large, cluttered media libraries. Built with performance, scalability, and robustness in mind using modern TypeScript.

➡️ **[Get Started](#-easy-installation) | [View Documentation](#-documentation) (Coming Soon) | [Contribute](#-contribute-to-MediaCurator)** ⬅️

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

- **Smart Organization**: Automatically structure your media library into folders based on date (EXIF or file creation), geolocation tags, camera model, or file type using highly customizable format strings. Bring logic and consistency to your collection effortlessly.
- **Advanced Deduplication**: Go beyond simple filename or hash checks. MediaCurator employs a sophisticated database-centric Locality-Sensitive Hashing (LSH) approach to efficiently find duplicate and visually similar images and videos, even if they have different resolutions or minor edits. Reclaim significant storage space.
- **High Performance**: Engineered for speed. Leverages the power of native libraries like Sharp (libvips) for image processing and FFmpeg for video analysis. Utilizes SQLite (`better-sqlite3`) for fast metadata lookups, WebAssembly (WASM) for optimized calculations (like Hamming distance), and `workerpool` for parallel processing to handle massive libraries efficiently.
- **Robust & Modern Architecture**: Built on a solid foundation using TypeScript with a functional programming approach. Features a clear pipeline architecture, reliable error handling via `neverthrow` (Result type), and clean Manual Dependency Injection for maintainability and testability.
- **Scalable Metadata Storage**: Employs an embedded SQLite database (`better-sqlite3`) to manage metadata and similarity hashes for potentially millions of files without excessive memory usage. Ensures efficient querying during deduplication.
- **Efficient Caching**: Integrates an LMDB-based cache to store intermediate processing results. This allows for seamless pause/resume functionality and significantly speeds up subsequent runs by avoiding redundant computations.
- **Wide Format Support**: Natively handles a broad range of common image and video formats thanks to FFmpeg and Sharp. The architecture is designed to be extensible for future format additions.
- **Refined CLI Experience**: Provides clear, real-time feedback during processing using progress bars and spinners via the dedicated `CliReporter` service. Offers a `--verbose` option for detailed logging when needed.

## 📊 Performance & Quality

- **Efficiency**: Designed for speed with optimized algorithms (LSH, WASM) and concurrency. Benchmarking is planned to quantify performance gains.
- **Test Coverage**: Striving for high test coverage, enforced via CI checks. Testing is ongoing to improve coverage across all modules.
- **Code Quality**: Maintained with strict ESLint rules and Prettier formatting to ensure consistency and readability.

## 📚 Documentation

Detailed documentation including guides, API references, and advanced usage examples will be available soon via VitePress.

_(Link to documentation site will be added here)_

## 🌟 Easy Installation

Install MediaCurator globally using Bun:

```bash
bun install --global @sylphlab/MediaCurator
```

This makes the `media-curator` command available in your terminal.

## 🔥 Usage

Organize your media with:

```bash
MediaCurator <source...> <destination> [options]
```

**Example:**

Organize media from multiple sources, move files, set custom thresholds, and use a specific format:

```bash
MediaCurator /media/photos /media/downloads/new_vids /library/organized \
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

Use these placeholders in the `--format` string to customize the output directory structure and filenames.

**Date Placeholders:**

- Prefix `I.` for Image Date (from EXIF), `F.` for File Creation Date, `D.` for Mixed Date (prefers Image Date, falls back to File Creation Date).
- **Year:** `{?.YYYY}` (e.g., 2023), `{?.YY}` (e.g., 23)
- **Month:** `{?.MMMM}` (e.g., January), `{?.MMM}` (e.g., Jan), `{?.MM}` (e.g., 01), `{?.M}` (e.g., 1)
- **Day:** `{?.DD}` (e.g., 05), `{?.D}` (e.g., 5)
- **Weekday:** `{?.DDDD}` (e.g., Sunday), `{?.DDD}` (e.g., Sun)
- **Hour:** `{?.HH}` (24h, e.g., 14), `{?.H}` (24h, e.g., 14), `{?.hh}` (12h, e.g., 02), `{?.h}` (12h, e.g., 2)
- **Minute:** `{?.mm}` (e.g., 08), `{?.m}` (e.g., 8)
- **Second:** `{?.ss}` (e.g., 09), `{?.s}` (e.g., 9)
- **AM/PM:** `{?.a}` (am/pm), `{?.A}` (AM/PM)
- **Week:** `{?.WW}` (Week number, e.g., 01-53)

**Filename Placeholders:**

- `{NAME}`: Original filename without extension.
- `{NAME.L}`: Lowercase original filename.
- `{NAME.U}`: Uppercase original filename.
- `{EXT}`: Original file extension (including the dot, e.g., `.jpg`).

**Metadata Placeholders:**

- `{GEO}`: GPS coordinates if available (e.g., `34.05_-118.24`), empty otherwise.
- `{CAM}`: Camera model if available, empty otherwise.
- `{TYPE}`: "Image" or "Video".

**Conditional Placeholders:**

- `{HAS.GEO}`: "GeoTagged" or "NoGeo".
- `{HAS.CAM}`: "WithCamera" or "NoCamera".
- `{HAS.DATE}`: "Dated" (if Image Date exists) or "NoDate".

**Other Placeholders:**

- `{RND}`: A random 8-character hexadecimal string (useful for preventing filename collisions).

**Example:** `{D.YYYY}/{D.MMMM}/{TYPE}/{NAME}_{RND}{EXT}` might produce `2023/April/Image/IMG_1234_a1b2c3d4.jpg`.

## 💡 Advanced Usage Examples

**1. Dry Run - Check Organization Without Moving Files:**

Use `--debug` to see a report of what _would_ happen without actually moving or copying files. This is useful for testing your format string or checking potential duplicates.

```bash
MediaCurator /media/photos /library/organized \
  --debug /tmp/smo_debug_report \
  --format "{D.YYYY}-{D.MM}/{TYPE}/{NAME}{EXT}"
```

_(No files are moved/copied, but a report detailing potential actions and duplicates is saved to `/tmp/smo_debug_report`)_

**2. High-Sensitivity Deduplication for Archival:**

Increase sensitivity for finding duplicates, useful when archiving and wanting to be very sure about removing redundant files. Use a lower similarity threshold and potentially a higher pHash resolution.

```bash
MediaCurator /archive_source /library/organized \
  -d /library/duplicates \
  --move \
  --resolution 128 \
  --image-similarity-threshold 0.95 \
  --video-similarity-threshold 0.90 \
  --format "{D.YYYY}/{D.MM}/{NAME}{EXT}" \
  --verbose
```

**3. Organizing Specific File Types Only (Using Shell Globbing):**

While `media-curator` doesn't have a built-in file type filter, you can use your shell's globbing capabilities to process only specific types.

```bash
# Organize only JPG files from the photos directory
MediaCurator /media/photos/**/*.jpg /library/organized_jpgs \
  --format "{D.YYYY}/{NAME}{EXT}"

# Organize only MP4 files
MediaCurator /media/videos/**/*.mp4 /library/organized_mp4s \
  --format "{D.YYYY}/{D.MM}/{NAME}{EXT}"
```

_(Note: Shell globbing behavior might vary. Ensure your shell supports recursive globbing (`**`) if needed.)_

**4. Prioritize EXIF Date, Fallback to File Date, Group by Camera:**

Organize photos primarily by the date they were taken (EXIF), but use the file creation date if EXIF is missing. Also, create subfolders for each camera model found.

```bash
MediaCurator /camera_roll /library/by_camera \
  --format "{HAS.CAM}/{CAM}/{D.YYYY}-{D.MM}/{NAME}_{RND}{EXT}" \
  --verbose
```

_(This might create paths like: `WithCamera/iPhone 14 Pro/2023-10/IMG_001_abc123ef.jpg` or `NoCamera/Unknown/2024-01/video_clip_xyz98765.mp4`)_

## 🏗️ Architecture Overview

For a more detailed diagram and component description, see [ARCHITECTURE.md](ARCHITECTURE.md).

MediaCurator uses a pipeline architecture with SQLite for metadata/LSH and LMDB for caching.

```mermaid
flowchart TD
    A[Start: MediaCurator command] --> B{1. Discovery};
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
