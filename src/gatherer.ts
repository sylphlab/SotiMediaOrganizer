import { GatherFileInfoResult, FileProcessorConfig } from "./types"; // Removed unused FileInfo, Stats
import { LmdbCache } from "./caching/LmdbCache";
import { ExifTool } from "exiftool-vendored";
import { WorkerPool } from "./contexts/types";
import { processSingleFile } from "./fileProcessor"; // Returns AppResult<FileInfo>
import { MetadataDBService } from "./services/MetadataDBService"; // Import DB service
import { Semaphore } from "async-mutex";
// Removed cliProgress import
// Removed chalk import
import { getFileTypeByExt } from "./utils";
import { CliReporter } from "./reporting/CliReporter"; // Import reporter
import { FileType } from "./types"; // Import FileType enum

// Removed progress bar helper functions (moved to CliReporter)

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
  dbService: MetadataDBService, // Add dbService parameter
  reporter: CliReporter, // Add reporter parameter
): Promise<GatherFileInfoResult> {
  const errorFiles: string[] = [];
  const validFiles: string[] = [];
  const semaphore = new Semaphore(concurrency);

  // --- Progress Bar Setup using Reporter ---
  const formatStats = new Map<string, { errorCount: number }>(); // Keep track of stats per format
  const sortedFormats = Array.from(files.keys()).sort(
    (a, b) =>
      getFileTypeByExt(a).unwrapOr(FileType.Image) -
        getFileTypeByExt(b).unwrapOr(FileType.Image) ||
      files.get(b)!.length - files.get(a)!.length,
  );
  const formatTotals = new Map<string, number>();
  for (const format of sortedFormats) {
    formatTotals.set(format, files.get(format)!.length);
    formatStats.set(format, { errorCount: 0 }); // Initialize stats
  }
  reporter.initializeMultiBar(sortedFormats, formatTotals);
  // --- End Progress Bar Setup ---

  const processingPromises: Promise<void>[] = [];

  for (const format of sortedFormats) {
    const formatFiles = files.get(format)!;
    const stats = formatStats.get(format)!; // Get stats for the current format
    // No need to get bar instance here, reporter manages it

    for (const file of formatFiles) {
      processingPromises.push(
        semaphore.runExclusive(async () => {
          try {
            // Re-add try block
            // Call the core processing function, which now returns AppResult
            const fileInfoResult = await processSingleFile(
              file,
              config,
              cache,
              exifTool,
              workerPool,
            );

            if (fileInfoResult.isOk()) {
              // Store successful result in DB
              const upsertResult = dbService.upsertFileInfo(
                file,
                fileInfoResult.value,
              );
              if (upsertResult.isErr()) {
                // Log DB error using reporter
                reporter.logWarning(
                  `\nDB upsert failed for ${file}: ${upsertResult.error.message}`,
                );
                // Optionally add to a separate list of DB error files?
              }
              validFiles.push(file);
            } else {
              // Log processing error using reporter
              reporter.logError(
                `\nError processing ${file}: ${fileInfoResult.error.message}`,
                fileInfoResult.error, // Pass the error object
              );
              stats.errorCount++;
              errorFiles.push(file);
            }
          } catch (unexpectedError) {
            // Catch any unexpected errors during the process using reporter
            reporter.logError(
              `\nUnexpected error during processing for ${file}: ${unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError)}`,
              unexpectedError instanceof Error ? unexpectedError : undefined,
            );
            // Log error minimally here, detailed logging within processSingleFile
            // console.error(`Error processing ${file}: ${error.message}`);
            stats.errorCount++;
            errorFiles.push(file);
          } finally {
            reporter.updateProgress(format, 1, stats); // Update progress bar via reporter
          }
        }),
      );
    }
  }

  // Wait for all files associated with the current format to finish before starting the next format?
  // No, let Promise.all handle overall completion.

  await Promise.all(processingPromises); // Wait for all files to be processed
  reporter.stopMultiBar(); // Stop the progress bar via reporter

  return { validFiles, errorFiles };
}
