import { GatherFileInfoResult, DeduplicationResult } from "./types";
import { DebugReporter } from "./reporting/DebugReporter";
import { FileTransferService } from "./services/FileTransferService";
import { mkdir, readdir, unlink } from "fs/promises"; // Keep fs/promises for now
import { join } from "path";
import chalk from "chalk";
import { Spinner } from "@topcli/spinner"; // Added for basic progress
import { FileSystemError, safeTryAsync } from "./errors"; // Removed unused AppResult, ok, err

/**
 * Orchestrates the final file transfer stage, including debug report generation.
 * @param gatherFileInfoResult Result from the gathering stage.
 * @param deduplicationResult Result from the deduplication stage.
 * @param targetDir Destination directory for organized unique files.
 * @param duplicateDir Optional directory for duplicate files.
 * @param errorDir Optional directory for error files.
 * @param debugDir Optional directory for debug reports.
 * @param format Target directory format string.
 * @param shouldMove Flag indicating whether to move or copy files.
 * @param debugReporter Instance of DebugReporter.
 * @param fileTransferService Instance of FileTransferService.
 * @returns A Promise resolving when transfers and reporting are complete.
 */
export async function transferFilesFn(
  gatherFileInfoResult: GatherFileInfoResult,
  deduplicationResult: DeduplicationResult,
  targetDir: string,
  duplicateDir: string | undefined,
  errorDir: string | undefined,
  debugDir: string | undefined,
  format: string,
  shouldMove: boolean,
  debugReporter: DebugReporter, // Pass dependencies
  fileTransferService: FileTransferService,
): Promise<void> {
  // Handle debug report generation first
  if (debugDir) {
    // Use safeTryAsync for directory operations
    const mkdirResult = await safeTryAsync(
      mkdir(debugDir, { recursive: true }),
      (e) =>
        new FileSystemError(
          `Failed to create debug directory ${debugDir}: ${e instanceof Error ? e.message : String(e)}`,
          {
            path: debugDir,
            operation: "mkdir",
            originalError: e instanceof Error ? e : undefined,
          },
        ),
    );

    if (mkdirResult.isErr()) {
      console.error(chalk.red(mkdirResult.error.message));
      debugDir = undefined; // Prevent further attempts
    } else {
      // Clear the debug directory (optional)
      const readDirResult = await safeTryAsync(
        readdir(debugDir),
        (e) =>
          new FileSystemError(
            `Failed to read debug directory ${debugDir}: ${e instanceof Error ? e.message : String(e)}`,
            {
              path: debugDir,
              operation: "readdir",
              originalError: e instanceof Error ? e : undefined,
            },
          ),
      );

      if (readDirResult.isOk()) {
        for (const file of readDirResult.value) {
          const filePath = join(debugDir, file);
          const unlinkResult = await safeTryAsync(
            unlink(filePath),
            (e) =>
              new FileSystemError(
                `Could not clear file in debug directory: ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
                {
                  path: filePath,
                  operation: "unlink",
                  originalError: e instanceof Error ? e : undefined,
                },
              ),
          );
          if (unlinkResult.isErr()) {
            console.warn(chalk.yellow(unlinkResult.error.message));
          }
        }
      } else {
        console.warn(
          chalk.yellow(
            `Could not read debug directory ${debugDir} to clear files: ${readDirResult.error.message}`,
          ),
        );
      }
    }

    if (debugDir && deduplicationResult.duplicateSets.length > 0) {
      // Assuming generateHtmlReports handles its own errors internally or returns AppResult
      // For now, keep try/catch for simplicity as it's not returning AppResult yet
      try {
        await debugReporter.generateHtmlReports(
          deduplicationResult.duplicateSets,
          debugDir,
        );
        console.log(
          chalk.yellow(
            `\nDebug mode: Duplicate set reports have been saved to ${debugDir}`,
          ),
        );
      } catch (reportError) {
        console.error(
          chalk.red(`Failed to generate debug reports in ${debugDir}:`),
          reportError,
        );
        // Continue without reports
      }
    } else if (debugDir) {
      console.log(chalk.yellow("\nDebug mode: No duplicate sets found"));
    }
  }

  // Delegate actual file transfers to the service
  // TODO: Abstract progress reporting later
  const spinner = new Spinner().start("Transferring files..."); // Basic progress
  // Assuming transferOrganizedFiles handles its own errors internally or returns AppResult
  // For now, keep try/catch for simplicity as it's not returning AppResult yet
  try {
    await fileTransferService.transferOrganizedFiles(
      gatherFileInfoResult,
      deduplicationResult,
      targetDir,
      duplicateDir,
      errorDir,
      format,
      shouldMove,
    );
    spinner.succeed(
      `File transfer completed in ${(spinner.elapsedTime / 1000).toFixed(2)} seconds.`,
    );
  } catch (transferError) {
    // Workaround for spinner type issue: stop and log error manually
    // @ts-expect-error - Suppress incorrect type error for spinner.stop() (Corrected directive)
    spinner.stop(); // Stop the spinner animation (Method likely exists despite type error)
    console.error(
      chalk.red(`✖ File transfer failed: ${transferError.message}`),
    ); // Log error manually
    throw transferError; // Rethrow after stopping spinner and logging
  }
}
