import { GatherFileInfoResult, FileProcessorConfig } from "./types"; // Removed unused FileInfo, Stats
import { LmdbCache } from "./caching/LmdbCache";
import { ExifTool } from "exiftool-vendored";
import { WorkerPool } from "./contexts/types";
import { processSingleFile } from "./fileProcessor"; // Returns AppResult<FileInfo>
import { MetadataDBService } from "./services/MetadataDBService"; // Import DB service
import { Semaphore } from "async-mutex";
import cliProgress from "cli-progress"; // Keep for now, or abstract later
import chalk from "chalk";
import { getFileTypeByExt } from "./utils";
import { FileType } from "./types"; // Import FileType enum

// TODO: Abstract progress bar logic later
function formatTime(seconds: number): string {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${remainingSeconds.toString().padStart(2, "0")}`;
}

function getBrailleProgressChar(progress: number): string {
    if (progress >= 0.875) return "⣿"; if (progress >= 0.75) return "⣷";
    if (progress >= 0.625) return "⣧"; if (progress >= 0.5) return "⣇";
    if (progress >= 0.375) return "⡇"; if (progress >= 0.25) return "⡆";
    if (progress >= 0.125) return "⡄"; if (progress > 0) return "⡀";
    return " ";
}
// End TODO

/**
 * Gathers FileInfo for all discovered files, handling concurrency and progress reporting.
 * @param files A Map where keys are file extensions and values are arrays of file paths.
 * @param concurrency Maximum number of files to process concurrently.
 * @param config Combined configuration object.
 * @param cache LmdbCache instance.
 * @param exifTool ExifTool instance.
 * @param workerPool WorkerPool instance.
 * @param dbService MetadataDBService instance.
 * @returns A Promise resolving to GatherFileInfoResult containing lists of valid and error file paths.
 */
export async function gatherFileInfoFn(
    files: Map<string, string[]>,
    concurrency: number,
    config: FileProcessorConfig,
    cache: LmdbCache,
    exifTool: ExifTool,
    workerPool: WorkerPool,
    dbService: MetadataDBService // Add dbService parameter
): Promise<GatherFileInfoResult> {
    const errorFiles: string[] = [];
    const validFiles: string[] = [];
    const semaphore = new Semaphore(concurrency);

    // TODO: Abstract progress bar logic later
    const multibar = new cliProgress.MultiBar(
        {
            clearOnComplete: false,
            stopOnComplete: true,
            hideCursor: true,
            etaBuffer: 1000,
            barsize: 15,
            etaAsynchronousUpdate: true,
            format: (options, params, payload) => { // Copied format function
                const barSize = options.barsize || 10;
                const completeBars = Math.floor(params.progress * barSize);
                const remainderProgress = params.progress * barSize - completeBars;
                const microProgressChar = getBrailleProgressChar(remainderProgress);
                const bar = "⣿".repeat(completeBars) + microProgressChar + " ".repeat(barSize - completeBars);
                const percentage = (params.progress * 100).toFixed(2);
                let timeInfo: string;
                if (params.stopTime == null) {
                    if (params.eta > 0) {
                        const eta = formatTime(params.eta);
                        timeInfo = `ETA: ${chalk.yellow(eta.padStart(9))}`;
                    } else {
                        timeInfo = " ".repeat(14);
                    }
                } else {
                    const duration = formatTime((params.stopTime! - params.startTime) / 1000);
                    timeInfo = `Time: ${chalk.yellow(duration.padStart(8))}`;
                }
                // Use simplified stats payload
                const stats = payload.stats as { errorCount: number };
                return (
                    `${chalk.white(payload.format.padEnd(6))} ${bar} ${chalk.green(percentage.padStart(6))}% | ` +
                    `${chalk.cyan(params.value.toString().padStart(7))}/${chalk.cyan(params.total.toString().padStart(7))} | ` +
                    `${timeInfo} | ` +
                    // Removed detailed stats display for simplicity in this function
                    `${chalk.red(stats.errorCount.toString().padStart(5))} errors`
                );
            },
        },
        cliProgress.Presets.shades_classic
    );
    // --- Start Progress Bar Setup (Adapted from MediaOrganizer) ---
     const formatStats = new Map<string, { errorCount: number }>(); // Simplified stats for progress
     const bars = new Map<string, cliProgress.Bar>();
     const sortedFormats = Array.from(files.keys()).sort(
       (a, b) =>
         // Unwrap results, defaulting to Image on error for sorting
         getFileTypeByExt(a).unwrapOr(FileType.Image) - getFileTypeByExt(b).unwrapOr(FileType.Image) ||
         files.get(b)!.length - files.get(a)!.length,
     );

     for (const format of sortedFormats) {
       const formatFiles = files.get(format)!;
       const stats = { errorCount: 0 };
       formatStats.set(format, stats);
       const bar = multibar.create(formatFiles.length, 0, { format, stats });
       bars.set(format, bar);
     }
    // --- End Progress Bar Setup ---


    const processingPromises: Promise<void>[] = [];

    for (const format of sortedFormats) {
        const formatFiles = files.get(format)!;
        const stats = formatStats.get(format)!;
        const bar = bars.get(format)!;
        // bar.start(bar.getTotal(), 0, { format, stats }); // Start bar if needed

        for (const file of formatFiles) {
            processingPromises.push(
                semaphore.runExclusive(async () => {
                    try { // Re-add try block
                        // Call the core processing function, which now returns AppResult
                        const fileInfoResult = await processSingleFile(file, config, cache, exifTool, workerPool);

                        if (fileInfoResult.isOk()) {
                            // Store successful result in DB
                            const upsertResult = dbService.upsertFileInfo(file, fileInfoResult.value);
                            if (upsertResult.isErr()) {
                                // Log DB error but still count file as 'valid' for processing pipeline
                                console.error(chalk.yellow(`\nDB upsert failed for ${file}: ${upsertResult.error.message}`));
                                // Optionally add to a separate list of DB error files?
                            }
                            validFiles.push(file);
                        } else {
                            // Log processing error
                            console.error(chalk.red(`\nError processing ${file}: ${fileInfoResult.error.message}`));
                            stats.errorCount++;
                            errorFiles.push(file);
                        }
                    } catch (unexpectedError) { // Catch any unexpected errors during the process
                         console.error(chalk.red(`\nUnexpected error during processing for ${file}: ${unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError)}`));
                        // Log error minimally here, detailed logging within processSingleFile
                        // console.error(`Error processing ${file}: ${error.message}`);
                        stats.errorCount++;
                        errorFiles.push(file);
                    } finally {
                        bar.increment(1, { stats }); // Update progress bar
                    }
                })
            );
        }
    }

    // Wait for all files associated with the current format to finish before starting the next format?
    // No, let Promise.all handle overall completion.

    await Promise.all(processingPromises); // Wait for all files to be processed
    multibar.stop(); // Stop the progress bar

    return { validFiles, errorFiles };
}