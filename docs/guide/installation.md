# Installation

Follow these steps to install MediaCurator (`smo`) and its dependencies on your system.

## Step 1: Install Core Dependencies

MediaCurator relies on several powerful external tools for media processing and metadata extraction. You need to install these first:

### 1.1 Node.js and Bun

- **Node.js:** MediaCurator requires Node.js. Version 16 or higher is recommended. Download and install it from [nodejs.org](https://nodejs.org/).
- **Bun:** The recommended way to install and run MediaCurator is using the Bun runtime. Install it by following the instructions on [bun.sh](https://bun.sh/).

### 1.2 FFmpeg

FFmpeg is essential for video analysis (extracting frames, metadata).

- **Download:** Get FFmpeg from the official website: [ffmpeg.org/download.html](https://ffmpeg.org/download.html). Choose a static build suitable for your operating system if available.
- **Installation:** Follow the specific instructions for your OS. Often, this involves downloading the executable(s) and placing them in a directory.
- **Add to PATH:** **Crucially**, ensure the directory containing the `ffmpeg` (and `ffprobe`) executable is added to your system's `PATH` environment variable. This allows MediaCurator to find and execute it.
- **Verification:** Open a new terminal/command prompt and run:
  ```bash
  ffmpeg -version
  ```
  If FFmpeg is installed correctly and in your PATH, this command should output version information.

### 1.3 ExifTool

ExifTool is used for extracting detailed metadata from various file types.

- **Download:** Get ExifTool from the official website: [exiftool.org](https://exiftool.org/).
- **Installation:** Follow the installation instructions provided for your operating system (Windows, macOS, Linux).
- **Add to PATH (if necessary):** Similar to FFmpeg, ensure the `exiftool` executable is accessible via your system's `PATH`. On some systems (like Linux/macOS with package managers), this might be handled automatically. On Windows, you might need to add it manually.
- **Verification:** Open a new terminal/command prompt and run:
  ```bash
  exiftool -ver
  ```
  This should output the ExifTool version number.

### 1.4 libvips (via Sharp)

MediaCurator uses the [Sharp](https://sharp.pixelplumbing.com/) library for high-performance image processing, which in turn relies on the `libvips` library.

- **Automatic Installation (Usually):** When you install MediaCurator (or Sharp directly), `npm` or `bun` will typically attempt to download a pre-compiled binary of `libvips` suitable for your system. For most common operating systems (Windows x64, macOS, Linux x64), this works automatically.
- **Manual Installation (Rarely Needed):** If the automatic download fails (e.g., unsupported OS/architecture, network issues), you might need to install `libvips` manually _before_ installing MediaCurator. Refer to the official [Sharp installation documentation](https://sharp.pixelplumbing.com/install) for detailed instructions specific to your environment.

## Step 2: Install MediaCurator

With the prerequisites in place, install MediaCurator globally using Bun:

```bash
bun install --global @sotilab/smo
```

This command downloads the MediaCurator package and makes the `smo` command accessible from anywhere in your terminal.

## Step 3: Verify Installation

Finally, verify that MediaCurator is installed correctly:

```bash
smo --version
```

This command should display the installed version number of MediaCurator (e.g., `1.2.3`).

If you encounter any issues during installation, double-check that all prerequisites (Node.js, Bun, FFmpeg, ExifTool) are correctly installed and accessible in your system's PATH. Consult the respective tool's documentation and the Sharp installation guide if necessary.
