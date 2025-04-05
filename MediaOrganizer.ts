import {
  // type FileInfo, // No longer needed directly
  type DeduplicationResult,
  type Stats,
  type GatherFileInfoResult,
} from "./src/types";
import {
  mkdir, // Keep mkdir for debug dir creation
  unlink, // Keep unlink for clearing debug dir
  readdir, // Keep readdir for discoverFiles and debug dir clearing
  // copyFile, rename moved to FileTransferService
  // writeFile removed
} from "fs/promises";
import { join } from "path"; // Keep only join for debug dir clearing
// Removed unused path imports: basename, dirname, extname, parse
// import { existsSync } from "fs"; // Moved
// import crypto from "crypto"; // Moved to FileTransferService
import chalk from "chalk";
import cliProgress from "cli-progress"; // Keep for gatherFileInfo
// MultiBar, Presets moved to FileTransferService
// import path from "path"; // Default import no longer needed, using named 'join'
import { Spinner } from "@topcli/spinner";
import { MediaComparator } from "./MediaComparator";
import path from "path"; // Re-add default import for path.join/extname
import { MediaProcessor } from "./src/MediaProcessor";
import { ALL_SUPPORTED_EXTENSIONS, getFileTypeByExt } from "./src/utils";
import { injectable, inject } from "inversify"; // Add inject
import { Semaphore } from "async-mutex";
import { DebugReporter } from "./src/reporting/DebugReporter";
import { FileTransferService } from "./src/services/FileTransferService"; // Import FileTransferService

@injectable()
export class MediaOrganizer {
  constructor(
    private processor: MediaProcessor,
    private comparator: MediaComparator,
    @inject(DebugReporter) private debugReporter: DebugReporter,
    @inject(FileTransferService)
    private fileTransferService: FileTransferService, // Inject FileTransferService
  ) {
    // console.log("MediaOrganizer created");
  }

  async discoverFiles(
    sourceDirs: string[],
    concurrency: number = 10,
  ): Promise<Map<string, string[]>> {
    const allFiles: string[] = [];
    let dirCount = 0;
    let fileCount = 0;
    const semaphore = new Semaphore(concurrency);
    const spinner = new Spinner().start("Discovering files...");

    async function scanDirectory(dirPath: string): Promise<void> {
      try {
        dirCount++;
        const entries = await readdir(dirPath, { withFileTypes: true });

        for (const entry of entries) {
          const entryPath = path.join(dirPath, entry.name);
          if (entry.isDirectory()) {
            semaphore.runExclusive(() => scanDirectory(entryPath));
          } else if (
            ALL_SUPPORTED_EXTENSIONS.has(
              path.extname(entry.name).slice(1).toLowerCase(),
            )
          ) {
            allFiles.push(entryPath);
            fileCount++;
          }
        }
        spinner.text = `Processed ${dirCount} directories, found ${fileCount} files...`;
      } catch (error) {
        console.error(chalk.red(`Error scanning directory ${dirPath}:`, error));
      }
    }

    // Start scanning all source directories
    for (const dirPath of sourceDirs) {
      semaphore.runExclusive(() => scanDirectory(dirPath));
    }

    await semaphore.waitForUnlock(concurrency);

    spinner.succeed(
      `Discovery completed in ${(spinner.elapsedTime / 1000).toFixed(2)} seconds: Found ${fileCount} files in ${dirCount} directories`,
    );

    // print file format statistics
    const result = new Map<string, string[]>();
    for (const file of allFiles) {
      const ext = path.extname(file).slice(1).toLowerCase();
      result.set(ext, result.get(ext) ?? []);
      result.get(ext)!.push(file);
    }

    console.log(chalk.blue("\nFile Format Statistics:"));
    for (const [format, count] of result.entries()) {
      console.log(
        chalk.white(
          `${format.padEnd(6)}: ${count.length.toString().padStart(8)}`,
        ),
      );
    }
    console.log(
      chalk.green(`${"Total".padEnd(6)}: ${fileCount.toString().padStart(8)}`),
    );

    return result;
  }

  private formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);

    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
  }

  private getBrailleProgressChar(progress: number): string {
    if (progress >= 0.875) return "⣿"; // Fully filled (8 dots)
    if (progress >= 0.75) return "⣷"; // 7 dots
    if (progress >= 0.625) return "⣧"; // 6 dots
    if (progress >= 0.5) return "⣇"; // 5 dots
    if (progress >= 0.375) return "⡇"; // 4 dots
    if (progress >= 0.25) return "⡆"; // 3 dots
    if (progress >= 0.125) return "⡄"; // 2 dots
    if (progress > 0) return "⡀"; // 1 dot
    return " "; // Empty
  }

  async gatherFileInfo(
    files: Map<string, string[]>,
    concurrency: number = 10,
  ): Promise<GatherFileInfoResult> {
    const formatStats = new Map<string, Stats>();
    const semaphore = new Semaphore(concurrency);
    const errorFiles: string[] = [];
    const validFiles: string[] = [];

    const multibar = new cliProgress.MultiBar(
      {
        clearOnComplete: false,
        stopOnComplete: true,
        hideCursor: true,
        etaBuffer: 1000,
        barsize: 15,
        etaAsynchronousUpdate: true,
        format: (options, params, payload) => {
          const barSize = options.barsize || 10;

          const completeBars = Math.floor(params.progress * barSize);
          const remainderProgress = params.progress * barSize - completeBars;

          const microProgressChar =
            this.getBrailleProgressChar(remainderProgress);

          const bar =
            "⣿".repeat(completeBars) +
            microProgressChar +
            " ".repeat(barSize - completeBars);

          const percentage = (params.progress * 100).toFixed(2);

          // Determine whether to show ETA or duration
          let timeInfo: string;
          if (params.stopTime == null) {
            if (params.eta > 0) {
              const eta = this.formatTime(params.eta);
              timeInfo = `ETA: ${chalk.yellow(eta.padStart(9))}`;
            } else {
              timeInfo = " ".repeat(14);
            }
          } else {
            const duration = this.formatTime(
              (params.stopTime! - params.startTime) / 1000,
            );
            timeInfo = `Time: ${chalk.yellow(duration.padStart(8))}`;
          }

          const stats = payload.stats as Stats;

          return (
            `${chalk.white(payload.format.padEnd(6))} ${bar} ${chalk.green(percentage.padStart(6))}% | ` +
            `${chalk.cyan(params.value.toString().padStart(7))}/${chalk.cyan(params.total.toString().padStart(7))} | ` +
            `${timeInfo} | ` +
            `${chalk.magenta(stats.withImageDateCount.toString().padStart(5))} w/date | ` +
            `${chalk.magenta(stats.withCameraCount.toString().padStart(5))} w/camera | ` +
            `${chalk.magenta(stats.withGeoCount.toString().padStart(5))} w/geo | ` +
            `${chalk.red(stats.errorCount.toString().padStart(5))} errors`
          );
        },
      },
      cliProgress.Presets.shades_classic,
    );

    const sortedFormats = Array.from(files.keys()).sort(
      (a, b) =>
        getFileTypeByExt(a) - getFileTypeByExt(b) ||
        files.get(b)!.length - files.get(a)!.length,
    );

    const bars = new Map<string, cliProgress.Bar>();
    for (const format of sortedFormats) {
      const formatFiles = files.get(format)!;

      const stats: Stats = {
        withGeoCount: 0,
        withImageDateCount: 0,
        withCameraCount: 0,
        errorCount: 0,
      };
      formatStats.set(format, stats);

      const bar = multibar.create(formatFiles.length, 0, {
        format,
        stats,
      });
      bars.set(format, bar);
    }

    // Process files format by format
    for (const format of sortedFormats) {
      const formatFiles = files.get(format)!;
      const stats = formatStats.get(format)!;
      const bar = bars.get(format)!;
      bar.start(bar.getTotal(), 0, {
        format,
        stats: stats,
      });

      for (const file of formatFiles) {
        const [, release] = await semaphore.acquire();
        (async () => {
          try {
            const fileInfo = await this.processor.processFile(file);

            if (fileInfo.metadata.gpsLatitude && fileInfo.metadata.gpsLongitude)
              stats.withGeoCount++;
            if (fileInfo.metadata.imageDate) stats.withImageDateCount++;
            if (fileInfo.metadata.cameraModel) stats.withCameraCount++;
            validFiles.push(file);
          } catch {
            stats.errorCount++;
            errorFiles.push(file);
          } finally {
            bar.increment();
            release();
          }
        })();
      }
      await semaphore.waitForUnlock(concurrency);
    }

    multibar.stop();

    return { validFiles, errorFiles };
  }

  async deduplicateFiles(files: string[]): Promise<DeduplicationResult> {
    const spinner = new Spinner().start("Deduplicating files...");

    const { uniqueFiles, duplicateSets } =
      await this.comparator.deduplicateFiles(
        files,
        (file) => this.processor.processFile(file),
        (progress) => (spinner.text = `Deduplicating files... ${progress}`),
      );

    const duplicateCount = duplicateSets.reduce(
      (sum, set) => sum + set.duplicates.size,
      0,
    );
    spinner.succeed(
      `Deduplication completed in ${(spinner.elapsedTime / 1000).toFixed(2)} seconds: Found ${duplicateSets.length} duplicate sets, ${uniqueFiles.size} unique files, ${duplicateCount} duplicates`,
    );

    return { uniqueFiles, duplicateSets };
  }
  // Removed generateReports and generateIndex methods - moved to DebugReporter

  async transferFiles(
    gatherFileInfoResult: GatherFileInfoResult,
    deduplicationResult: DeduplicationResult,
    targetDir: string,
    duplicateDir: string | undefined,
    errorDir: string | undefined,
    debugDir: string | undefined,
    format: string,
    shouldMove: boolean,
  ): Promise<void> {
    // Handle debug report generation first
    if (debugDir) {
      await mkdir(debugDir, { recursive: true });
      // Clear the debug directory (optional, depends on desired behavior)
      const debugFiles = await readdir(debugDir);
      for (const file of debugFiles) {
        // Be cautious with unlink, maybe move to a timestamped subfolder instead?
        // For now, keeping original behavior.
        try {
          await unlink(join(debugDir, file));
        } catch (err) {
          console.warn(
            chalk.yellow(
              `Could not clear file in debug directory: ${join(debugDir, file)}`,
            ),
            err,
          );
        }
      }

      if (deduplicationResult.duplicateSets.length > 0) {
        await this.debugReporter.generateHtmlReports(
          deduplicationResult.duplicateSets,
          debugDir,
        );
        console.log(
          chalk.yellow(
            `\nDebug mode: Duplicate set reports have been saved to ${debugDir}`,
          ),
        );
      } else {
        console.log(chalk.yellow("\nDebug mode: No duplicate sets found"));
      }
    }

    // Delegate actual file transfers to the service
    await this.fileTransferService.transferOrganizedFiles(
      gatherFileInfoResult,
      deduplicationResult,
      targetDir,
      duplicateDir,
      errorDir,
      format,
      shouldMove,
    );
  }

  // Removed transferOrCopyFile, generateTargetPath, formatDate, getWeekNumber
  // These are now handled by FileTransferService
}
