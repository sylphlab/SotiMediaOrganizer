import { readdir } from "fs/promises";
import path from "path";
import { Semaphore } from "async-mutex";
import chalk from "chalk"; // Re-add chalk for specific formatting
// Removed Spinner import
// Removed chalk import
import { ALL_SUPPORTED_EXTENSIONS, getFileTypeByExt } from "./utils"; // Assuming utils is in parent dir
import { CliReporter } from "./reporting/CliReporter"; // Import reporter
import { FileSystemError, safeTryAsync } from "./errors"; // Removed unused AppResult, ok, err

/**
 * Discovers supported media files recursively within source directories.
 * @param sourceDirs Array of source directory paths.
 * @param concurrency Maximum number of directories to scan concurrently.
 * @returns A Promise resolving to a Map where keys are file extensions and values are arrays of file paths.
 */
export async function discoverFilesFn(
  sourceDirs: string[],
  concurrency: number = 10,
  reporter: CliReporter, // Add reporter parameter
): Promise<Map<string, string[]>> {
  const allFiles: string[] = [];
  let dirCount = 0;
  let fileCount = 0;
  const semaphore = new Semaphore(concurrency);
  // TODO: Abstract spinner logic later if needed
  reporter.startSpinner("Discovering files..."); // Use reporter

  async function scanDirectory(dirPath: string): Promise<void> {
    dirCount++;
    const readDirResult = await safeTryAsync(
      readdir(dirPath, { withFileTypes: true }),
      (e) =>
        new FileSystemError(
          `Error scanning directory ${dirPath}: ${e instanceof Error ? e.message : String(e)}`,
          {
            path: dirPath,
            operation: "readdir",
            originalError: e instanceof Error ? e : undefined,
          },
        ),
    );

    if (readDirResult.isErr()) {
      // Log error using reporter
      reporter.logError(readDirResult.error.message);
      // Update spinner text even on error to show progress
      reporter.updateSpinnerText(
        `Processed ${dirCount} directories, found ${fileCount} files... (Error in ${dirPath})`,
      );
      return; // Stop processing this directory
    }

    const entries = readDirResult.value;
    const promises: Promise<void>[] = [];
    for (const entry of entries) {
      const entryPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        // Acquire semaphore slot before recursing
        promises.push(semaphore.runExclusive(() => scanDirectory(entryPath)));
      } else if (
        ALL_SUPPORTED_EXTENSIONS.has(
          path.extname(entry.name).slice(1).toLowerCase(),
        )
      ) {
        allFiles.push(entryPath);
        fileCount++;
      }
    }
    // Use try/catch for Promise.all in case semaphore logic throws unexpectedly
    try {
      await Promise.all(promises); // Wait for recursive calls initiated in this directory
    } catch (promiseAllError) {
      reporter.logError(
        `Error during concurrent directory scan under ${dirPath}:`,
        promiseAllError instanceof Error ? promiseAllError : undefined,
      );
    }
    reporter.updateSpinnerText(
      `Processed ${dirCount} directories, found ${fileCount} files...`,
    );
  }

  // Start scanning all source directories concurrently
  const initialScanPromises = sourceDirs.map((dirPath) =>
    semaphore.runExclusive(() => scanDirectory(dirPath)),
  );
  await Promise.all(initialScanPromises);

  // Wait for all recursive scans to complete (ensure semaphore is drained)
  // This simple wait might not be perfectly accurate if new tasks are added rapidly,
  // but should be sufficient for directory scanning. A more robust approach might involve tracking active promises.
  await semaphore.waitForUnlock(concurrency); // Wait for initial tasks
  while (semaphore.isLocked() || semaphore.getValue() !== concurrency) {
    // Wait for recursive tasks
    await new Promise((resolve) => setTimeout(resolve, 50)); // Small delay to prevent busy-waiting
  }

  // spinner.succeed is called within stopSpinnerSuccess
  reporter.stopSpinnerSuccess(
    `Discovery completed: Found ${fileCount} files in ${dirCount} directories`, // Simplified message, reporter might add timing
  );

  // Group files by extension
  const result = new Map<string, string[]>();
  for (const file of allFiles) {
    const ext = path.extname(file).slice(1).toLowerCase();
    if (!result.has(ext)) {
      result.set(ext, []);
    }
    result.get(ext)!.push(file);
  }

  // Log statistics (Keep logging here for now, or abstract later)
  reporter.logInfo("\nFile Format Statistics:"); // Use reporter
  // Sort formats for consistent logging
  const sortedFormats = Array.from(result.keys()).sort(
    (a, b) =>
      getFileTypeByExt(a).unwrapOr(0) - getFileTypeByExt(b).unwrapOr(0) || // Handle AppResult, default to 0 on error
      result.get(b)!.length - result.get(a)!.length, // Then by count descending
  );
  for (const format of sortedFormats) {
    const count = result.get(format)!.length;
    // Use reporter.logInfo, but keep chalk for specific color if desired
    reporter.logInfo(
      `${chalk.white(format.padEnd(6))}: ${count.toString().padStart(8)}`,
    );
  }
  reporter.logSuccess(
    `${chalk.green("Total".padEnd(6))}: ${fileCount.toString().padStart(8)}`,
  );

  return result;
}
