# MediaCurator (@sotilab/smo)

<!-- Version: 1.0 | Last Updated: 2025-04-06 | Updated By: Cline -->

**MediaCurator** is your ultimate tool for intelligently curating, organizing,
and decluttering your digital photo and video collection. Whether you're a
casual photographer or a seasoned professional, MediaCurator offers powerful
solutions to bring order to your growing media library, efficiently and
effortlessly. Built with a focus on performance, scalability, and robustness using modern TypeScript and functional programming principles.

## 🚀 Key Features

- **Smart Organization**: Automatically organizes photos and videos by metadata
  like creation date, geolocation, and camera model using a flexible format string.
- **Advanced Deduplication**: Eliminate duplicate/similar files using perceptual hashing and a scalable DB-centric approach with Locality-Sensitive Hashing (LSH) stored in SQLite.
- **Blazing Performance**: Optimized for speed with Sharp (libvips), Fluent-FFmpeg, SQLite (`better-sqlite3`), and WASM for core calculations (Hamming distance).
- **Functional &amp; Robust Architecture**: Built with TypeScript using functional programming principles (`neverthrow` for error handling) and Manual Dependency Injection for clarity and testability. Core logic is decomposed into a clear pipeline (`discovery`, `gatherer`, `deduplicator`, `transfer`).
- **Scalable Metadata Storage**: Utilizes SQLite (`better-sqlite3`) for efficient storage and querying of metadata for potentially millions of files.
- **Efficient Caching**: Leverages LMDB for caching intermediate processing results (file stats, metadata, hashes), enabling pause/resume and faster re-runs.
- **Wide Format Support**: Handles a vast range of image and video formats via FFmpeg and Sharp. Extend support by recompiling underlying libraries (libvips, FFmpeg) if needed.
- **Refined CLI Experience**: Centralized reporting via `CliReporter` provides clear progress indicators (spinners, progress bars) and logging, controllable with a `--verbose` flag.
- **Concurrency**: Employs `workerpool` for parallel processing of CPU-intensive tasks like perceptual hash generation.

## 🌟 Easy Installation

Get started with MediaCurator in no time by installing it globally with Bun:

```bash
bun install --global @sotilab/smo
```

This command makes the `smo` command available directly from your terminal.

## 🔥 Simple and Powerful Usage

Start organizing your media with a single command:

```bash
smo <source...> <destination> [options]
```

### Command Options

- **Required Arguments:**

  - `<source...>`: One or more source directories/files to process.
  - `<destination>`: Destination directory for organized media.

- **Optional Options:**
  - `-e, --error <path>`: Directory for files that couldn't be processed.
  - `-d, --duplicate <path>`: Directory for duplicate files.
  - `--debug <path>`: Debug directory for storing all files in duplicate sets.
  - `-c, --concurrency <number>`: Number of workers to use (default: CPU cores - 1).
  - `-m, --move`: Move files instead of copying them (default: false).
  - `-r, --resolution <number>`: Resolution for perceptual hashing (default: 64).
  - `--min-frames <number>`: Minimum number of frames to extract from videos (default: 5).
  - `--max-scene-frames <number>`: Maximum number of frames to extract from scene changes (default: 100).
  - `--target-fps <number>`: Target frames per second for video extraction (default: 2).
  - `-w, --window-size <number>`: Window size for frame clustering (default: 5).
  - `-p, --step-size <number>`: Step size for frame clustering (default: 1).
  - `-F, --format <string>`: Format for destination directory (default: `"{D.YYYY}/{D.MM}/{D.DD}/{NAME}.{EXT}"`).
  - `--scene-change-threshold <number>`: Threshold for scene change detection (default: 0.01).
  - `--image-similarity-threshold <number>`: Threshold for image similarity (default: 0.99).
  - `--image-video-similarity-threshold <number>`: Threshold for image-video similarity (default: 0.93).
  - `--video-similarity-threshold <number>`: Threshold for video similarity (default: 0.93).
  - `--max-chunk-size <number>`: Maximum chunk size for file processing in bytes (default: 2MB).
  - `-v, --verbose`: Enable verbose logging output.

### Example Usage

Organize media from multiple sources, move files, set custom thresholds, and use a specific format:

```bash
smo /media/photos /media/downloads/new_vids /library/organized \\\
  -d /library/duplicates \\\
  -e /library/errors \\\
  --move \\\
  --resolution 64 \\\
  --target-fps 2 \\\
  --image-similarity-threshold 0.98 \\\
  --video-similarity-threshold 0.95 \\\
  --format "{D.YYYY}/{D.MMMM}/{TYPE}/{NAME}_{RND}.{EXT}" \\\
  --verbose
```

This command will:

- Process files from `/media/photos` and `/media/downloads/new_vids`.
- Organize unique files into `/library/organized`.
- Move duplicates to `/library/duplicates` and errors to `/library/errors`.
- Use a 64x64 resolution for perceptual hashing.
- Target 2 FPS for video frame extraction.
- Set custom similarity thresholds.
- Organize files into a `Year/MonthName/MediaType/` structure with a random suffix for uniqueness.
- Enable verbose output.

### Format String Placeholders

Customize your file organization with these powerful placeholders:

#### Date Placeholders

Use these prefixes for different date sources:

- `I.` : Image metadata date (e.g., EXIF Original Date)
- `F.` : File system creation date
- `D.` : Mixed date (prefers image metadata date `I.`, falls back to file creation date `F.`)

Available formats for each prefix:

- `{*.YYYY}` : Year (4 digits)
- `{*.YY}` : Year (2 digits)
- `{*.MMMM}` : Month (full name, e.g., January)
- `{*.MMM}` : Month (abbreviated name, e.g., Jan)
- `{*.MM}` : Month (2 digits, e.g., 01)
- `{*.M}` : Month (1-2 digits, e.g., 1)
- `{*.DD}` : Day of month (2 digits, e.g., 05)
- `{*.D}` : Day of month (1-2 digits, e.g., 5)
- `{*.DDDD}` : Day of week (full name, e.g., Sunday)
- `{*.DDD}` : Day of week (abbreviated name, e.g., Sun)
- `{*.HH}` : Hour, 24-hour format (2 digits)
- `{*.H}` : Hour, 24-hour format (1-2 digits)
- `{*.hh}` : Hour, 12-hour format (2 digits)
- `{*.h}` : Hour, 12-hour format (1-2 digits)
- `{*.mm}` : Minute (2 digits)
- `{*.m}` : Minute (1-2 digits)
- `{*.ss}` : Second (2 digits)
- `{*.s}` : Second (1-2 digits)
- `{*.a}` : AM/PM (lowercase, e.g., am)
- `{*.A}` : AM/PM (uppercase, e.g., AM)
- `{*.WW}` : Week of year (2 digits)

#### Filename Placeholders

- `{NAME}` : Original filename (without extension)
- `{NAME.L}` : Lowercase filename
- `{NAME.U}` : Uppercase filename
- `{EXT}` : File extension (without dot)
- `{RND}` : Random 8-character hexadecimal string (useful for ensuring unique filenames)

#### Metadata Placeholders

- `{GEO}` : GPS coordinates (format: latitude_longitude)
- `{CAM}` : Camera model
- `{TYPE}` : Media type ('Image' or 'Video')

#### Conditional Placeholders

- `{HAS.GEO}` : 'GeoTagged' if GPS data is available, 'NoGeo' otherwise
- `{HAS.CAM}` : 'WithCamera' if camera model is available, 'NoCamera' otherwise
- `{HAS.DATE}` : 'Dated' if image date (`I.`) is available, 'NoDate' otherwise

#### Example Format Strings

```text
"{D.YYYY}/{D.MM}/{D.DD}/{NAME}.{EXT}"
"{HAS.GEO}/{TYPE}/{D.YYYY}/{D.MMMM}/{NAME}_{D.HH}{D.mm}.{EXT}"
"{CAM}/{D.YYYY}/{D.WW}/{TYPE}/{D.YYYY}{D.MM}{D.DD}_{NAME.L}.{EXT}"
"{HAS.DATE}/{D.YYYY}/{D.MMMM}/{D.D}-{D.DDDD}/{D.h}{D.mm}{D.a}_{NAME}.{EXT}"
"{TYPE}/{HAS.CAM}/{D.YYYY}/{D.MM}/{D.DD}_{D.HH}{D.mm}_{NAME.U}_{RND}.{EXT}"
```

### Advanced Examples

**1. Organize only specific file types (e.g., videos) and use a complex format:**

```bash
# Note: Currently, smo processes all supported types found.
# Filtering by type would require pre-filtering sources or a new feature.
# This example focuses on the format string for videos.
smo /path/to/videos /output/organized_videos \\\
  --format "{TYPE}/{CAM}/{D.YYYY}/{D.MMMM}/{NAME}_{GEO}.{EXT}" \\\
  --verbose
```

**2. Perform a dry run (copy mode) to see potential duplicates without moving files:**

```bash
smo /path/to/media /output/dry_run_target \\\
  -d /output/dry_run_duplicates \\\
  -e /output/dry_run_errors \\\
  --debug /output/dry_run_debug_reports # Use debug to get reports
# Default is copy mode (move=false)
```

_This allows you to review the debug reports in `/output/dry_run_debug_reports` before committing to moving files._

**3. Maximize concurrency and use stricter similarity thresholds for archival purposes:**

```bash
smo /archive/source /archive/target \\\
  -d /archive/duplicates \\\
  -c 16 # Use more cores if available
  --image-similarity-threshold 0.995 \\\
  --video-similarity-threshold 0.98 \\\
  --move # Move files for archival
```

## 🔍 Sophisticated Deduplication (LSH Powered)

MediaCurator employs a robust, database-centric approach using Locality-Sensitive Hashing (LSH) for efficient and scalable deduplication:

1.  **Metadata &amp; pHash Generation**: For each file, extract metadata, calculate a content hash (for caching via LMDB), and generate a perceptual hash (pHash). Store essential info (path, pHash, duration, resolution, LSH keys) in the SQLite database (`MetadataDBService`). Adaptive frame extraction is used for videos.
2.  **Exact Duplicate Detection**: Query the SQLite database for files sharing the _exact same pHash_. These form initial "exact match" clusters.
3.  **Similarity Candidate Search (LSH)**: For files not part of exact duplicate sets, use their pre-calculated LSH keys to efficiently query the SQLite database. This retrieves a small set of _potential_ similar candidates, drastically reducing the number of comparisons needed compared to checking all pairs.
4.  **Similarity Verification**: Fetch the necessary `MediaInfo` (pHash, duration, etc.) from the database only for the target file and its LSH candidates. Calculate the precise perceptual similarity (e.g., Hamming distance for pHashes) between the target and each candidate.
5.  **Similarity Clustering**: Group the target file with candidates that meet the configured similarity thresholds (different thresholds can be set for image-image, image-video, video-video comparisons).
6.  **Cluster Merging**: Combine the exact duplicate clusters (from Step 2) and the similarity clusters (from Step 5) into final duplicate sets.
7.  **Smart File Selection**: Within each final cluster, select the best representative file(s) based on a scoring system (considering duration, resolution, metadata completeness).
    - If the highest-scoring item is an image, only that image is kept as unique.
    - If the highest-scoring item is a video, that video is kept, along with any unique, high-quality images from the same cluster that are not overly similar to each other.

This LSH-based approach significantly improves scalability for large collections by avoiding N^2 comparisons.

### Supported Scenarios

MediaCurator handles a wide range of comparison scenarios:

| Scenario                                                                  | Support Level       | Details                                                                                                      |
| ------------------------------------------------------------------------- | ------------------- | ------------------------------------------------------------------------------------------------------------ |
| Video is a subset of another video                                        | **Supported**       | Perceptual hashing comparison of frame sequences detects subset relationships. (DTW removed in refactoring). |
| Different rotations of the same image                                     | **Supported**       | Perceptual hashing (pHash) is generally robust to rotation.                                                  |
| Video duplicates images                                                   | **Supported**       | Compares frames from both videos and images using pHash.                                                     |
| One video transcoded in different qualities                               | **Supported**       | pHash and adaptive thresholds handle varying quality levels.                                                 |
| Captured moments from video                                               | **Supported**       | Detects when an image is a frame from a video.                                                               |
| Thumbnails generated by software                                          | **Supported**       | Smart file selection differentiates genuine captures from low-quality thumbnails.                            |
| Animated images (GIFs) vs. one-frame videos                               | **Supported**       | Treats videos and images equally based on content hash.                                                      |
| Duplicate detection in different resolutions                              | **Supported**       | pHash is robust to resolution differences.                                                                   |
| Cropped images or videos                                                  | **Supported**       | pHash is robust to minor cropping.                                                                           |
| Color-adjusted images or videos                                           | **Supported**       | pHash is generally resilient to minor color adjustments.                                                     |
| Horizontally flipped images or videos                                     | **Supported**       | Current pHash implementation can detect horizontally flipped duplicates.                                     |
| Time-shifted duplicate videos                                             | **Supported**       | Similarity comparison logic handles time shifts.                                                             |
| Duplicate detection across different file formats                         | **Supported**       | Focuses on content (pHash) rather than file format.                                                          |
| Detecting duplicates with added watermarks                                | **Partial Support** | Small watermarks might be ignored, large ones might interfere.                                               |
| Detecting duplicates with added text overlays                             | **Partial Support** | Similar to watermarks.                                                                                       |
| Detecting reuploaded, re-compressed social media versions                 | **Supported**       | pHash is robust against typical re-compression artifacts.                                                    |
| Detecting duplicates with different aspect ratios                         | **Future Planned**  | Significant aspect ratio changes might interfere currently.                                                  |
| Detecting duplicates with significant editing (e.g., Photoshopped images) | **Future Planned**  | Heavily edited images may not be detected.                                                                   |
| Detecting duplicates across different video framerates                    | **Supported**       | Adaptive frame extraction helps normalize comparisons.                                                       |
| Handling of RAW image formats and their JPEG counterparts                 | **Partial Support** | Basic support exists; enhanced RAW+JPEG handling planned.                                                    |
| Detecting slow-motion or sped-up video duplicates                         | **Future Planned**  | Current methods may not reliably detect significant speed changes.                                           |

_(Note: Scenario support table reviewed and updated based on current LSH implementation and removal of DTW)._

### Leveraging FFmpeg and libvips for Comprehensive Format Support

MediaCurator relies on the powerful decoding capabilities of FFmpeg and libvips
to handle a wide range of media formats. While the default installations of
these libraries cover most common formats, you may need to compile them with
additional codecs to support specialized or proprietary formats.

#### Expanding FFmpeg Support

FFmpeg is used primarily for video processing in MediaCurator. To enable support
for additional video codecs:

1. Download the FFmpeg source code from the
   [official FFmpeg website](https://ffmpeg.org/download.html).

2. Configure FFmpeg with the additional codecs you need. For example:

   ```bash
   ./configure --enable-gpl --enable-libx264 --enable-libx265 --enable-libvpx --enable-libopus
   ```

   This configuration enables support for H.264, H.265, VP8/VP9, and Opus
   codecs.

3. Compile and install FFmpeg:

   ```bash
   make
   sudo make install
   ```

Common video formats that might require additional codec support:

- HEVC/H.265
- VP9
- AV1
- ProRes

#### Enhancing libvips Capabilities

libvips is used for image processing in MediaCurator. To add support for more
image formats:

1. Ensure you have the necessary dependencies. For Ubuntu/Debian:

   ```bash
   sudo apt-get install libheif-dev libopenexr-dev libwebp-dev
   ```

2. Download the libvips source code from the
   [libvips GitHub repository](https://github.com/libvips/libvips).

3. Configure libvips with additional format support:

   ```bash
   ./configure --enable-heif --enable-openexr --enable-webp
   ```

4. Compile and install libvips:

   ```bash
   make
   sudo make install
   ```

Common image formats that might require additional support:

- HEIF/HEIC (common in newer iPhones)
- OpenEXR
- WebP

#### Integrating Custom Builds with MediaCurator

After compiling FFmpeg and libvips with extended format support:

1. Ensure the custom-built libraries are in your system's library path.
2. If you're using a package manager like npm or yarn, you might need to rebuild
   the node modules that depend on these libraries:

   ```bash
   npm rebuild sharp
   npm rebuild fluent-ffmpeg
   ```

3. Restart your MediaCurator application to use the newly compiled libraries.

#### Note on Proprietary Codecs

Some codecs (like H.264 and H.265) may require licensing for commercial use.
Ensure you have the necessary rights or licenses when enabling support for these
codecs.

By following these steps, you can significantly expand MediaCurator's ability to
handle various media formats, allowing for more comprehensive organization of
your media collection. Remember that enabling support for additional formats may
increase the size of your application and potentially impact performance, so
consider enabling only the formats you actually need.

### 🏎️ High-Performance Engine

MediaCurator is built for speed and scale:

- **Scalable Metadata Storage**: Uses SQLite (`better-sqlite3`) for efficient storage and indexed querying of metadata, crucial for handling millions of files.
- **Efficient Similarity Search (LSH)**: Employs Locality-Sensitive Hashing keys stored and queried in SQLite to rapidly find potential duplicates, avoiding costly N^2 comparisons.
- **Optimized Calculations**: Uses WASM (compiled AssemblyScript) for lightning-fast Hamming distance calculations during similarity verification.
- **Concurrency**: Leverages worker threads (`workerpool`) for parallel perceptual hash generation, maximizing CPU utilization.
- **Robust Caching (LMDB)**: Utilizes LMDB for high-speed caching of intermediate results (file stats, metadata, hashes), enabling quick resumption and avoiding redundant computations.
- **Functional Pipeline**: A clear, functional pipeline architecture enhances maintainability and testability.

## 🏗️ Architecture Overview

MediaCurator processes files through a sequential pipeline, leveraging caching and a central database for efficiency and state management.

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
        J[FFmpeg];
        K[Sharp/libvips];
        L[ExifTool];
    end

    subgraph "Concurrency (Used by Gatherer)"
        M[Worker Pool (pHash)];
    end

    C --> J;
    C --> K;
    C --> L;
    C --> M;
```

**Key Components:**

- **Pipeline Stages (`src/discovery.ts`, `src/gatherer.ts`, etc.):** Functional modules responsible for each step of the process.
- **Metadata DB (`src/services/MetadataDBService.ts`):** SQLite database storing file paths, hashes (content & perceptual), LSH keys, duration, resolution, etc. Used for efficient querying during deduplication.
- **Cache (`src/caching/LmdbCache.ts`):** LMDB database caching results from expensive operations (file stats, metadata extraction, hashing) to speed up re-runs and enable pause/resume.
- **File Transfer (`src/services/FileTransferService.ts`):** Handles the actual moving or copying of files based on the deduplication results and user configuration.
- **Reporting (`src/reporting/CliReporter.ts`, `src/reporting/DebugReporter.ts`):** Provides user feedback via the CLI and generates detailed HTML reports for duplicate sets in debug mode.
- **External Wrappers (`src/external/`):** Interfaces with external tools like FFmpeg, Sharp, and ExifTool.
- **Workers (`src/worker/`):** Offloads CPU-intensive tasks (like perceptual hashing) to separate threads.


## 💻 Development Setup

Interested in contributing? Here's how to set up your development environment:

1.  **Prerequisites:**
    *   Node.js (>=14 recommended)
    *   Bun (>=0.5 recommended for running/testing)
    *   Git
    *   FFmpeg (ensure it's in your system's PATH)
    *   ExifTool (ensure it's in your system's PATH)
    *   libvips (required by Sharp, installation varies by OS)

2.  **Clone the Repository:**
    ```bash
    git clone https://github.com/your-username/mediacurator.git # Replace with actual repo URL if known
    cd mediacurator
    ```

3.  **Install Dependencies:**
    ```bash
    bun install
    ```

4.  **Build the Project:**
    *   Compile TypeScript and AssemblyScript:
        ```bash
        bun run build
        ```

5.  **Run Tests:**
    *   Run all tests:
        ```bash
        bun test
        ```
    *   **Note:** Currently, several unit and integration tests involving mocking (`jest.mock`, `jest.resetAllMocks`) are known to fail when run with `bun test` due to compatibility issues. Tests for core utilities and simpler integration tests should pass. See `memory-bank/progress.md` for details.

6.  **Linting and Formatting:**
    *   Check for linting errors:
        ```bash
        bun run lint
        ```
    *   Format code (using Prettier, configured in `package.json`):
        ```bash
        bun run format
        ```

7.  **Running Locally:**
    *   Build the project first (`bun run build`).
    *   Run the compiled code directly:
        ```bash
        bun dist/index.js <source...> <destination> [options]
        ```
    *   Alternatively, use `bun run` to execute the TypeScript source directly (slower):
        ```bash
        bun run src/index.ts <source...> <destination> [options]
        ```

8.  **Pre-commit Hook:** Husky is configured to run linters and tests before committing. Ensure tests pass (or skip problematic ones temporarily) for the commit to succeed.

## 🤝 Contribute to MediaCurator

Join the community and help make MediaCurator even better! Fork the repository,
make your improvements, and submit a pull request.

## 📝 License

MediaCurator is open-source software licensed under the MIT License.
