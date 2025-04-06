import { GatherFileInfoResult, DeduplicationResult } from "./types";
import { DebugReporter } from "./reporting/DebugReporter";
import { FileTransferService } from "./services/FileTransferService";
import { mkdir, readdir, unlink } from "fs/promises"; // Keep fs/promises for now
import { join } from "path";
// Removed chalk import
// Removed Spinner import
import { FileSystemError, safeTryAsync } from "./errors"; // Removed unused AppResult, ok, err
import { CliReporter } from "./reporting/CliReporter"; // Import reporter

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
  reporter: CliReporter, // Add reporter parameter
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
            cause: e instanceof Error ? e : undefined,
            context: { path: debugDir, operation: "mkdir" },
          },
        ),
    );

    if (mkdirResult.isErr()) {
      reporter.logError(mkdirResult.error.message, mkdirResult.error); // Use reporter
      debugDir = undefined; // Prevent further attempts
    } else {
      // Clear the debug directory (optional)
      const readDirResult = await safeTryAsync(
        readdir(debugDir, { withFileTypes: true }), // Add withFileTypes: true
        (e) =>
          new FileSystemError(
            `Failed to read debug directory ${debugDir}: ${e instanceof Error ? e.message : String(e)}`,
            {
              cause: e instanceof Error ? e : undefined,
              context: { path: debugDir, operation: "readdir" },
            },
          ),
      );

      if (readDirResult.isOk()) {
        // Ensure readDirResult.value is an array of objects with a 'name' property
        for (const fileEntry of readDirResult.value) {
          // Access the 'name' property for the file path
          const filePath = join(debugDir, fileEntry.name);
          const unlinkResult = await safeTryAsync(
            unlink(filePath),
            (e) =>
              new FileSystemError(
                `Could not clear file in debug directory: ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
                {
                  cause: e instanceof Error ? e : undefined,
                  context: { path: filePath, operation: "unlink" },
                },
              ),
          );
          if (unlinkResult.isErr()) {
            reporter.logWarning(unlinkResult.error.message); // Use reporter
          }
        }
      } else {
        reporter.logWarning(
          // Use reporter
          `Could not read debug directory ${debugDir} to clear files: ${readDirResult.error.message}`,
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
        reporter.logWarning(
          // Use reporter (warning level seems appropriate)
          `\nDebug mode: Duplicate set reports have been saved to ${debugDir}`,
        );
      } catch (reportError) {
        reporter.logError(
          // Use reporter
          `Failed to generate debug reports in ${debugDir}:`,
          reportError instanceof Error ? reportError : undefined,
        );
        // Continue without reports
      }
    } else if (debugDir) {
      reporter.logWarning("\nDebug mode: No duplicate sets found"); // Use reporter
    }
  }

  // Delegate actual file transfers to the service
  // TODO: Abstract progress reporting later
  reporter.startSpinner("Transferring files..."); // Use reporter

  // Check if there are any files to transfer at all
  const hasUniqueFiles = deduplicationResult.uniqueFiles.size > 0;
  // Check if any set actually contains duplicates to be moved/copied
  const hasDuplicateFiles = duplicateDir
    ? deduplicationResult.duplicateSets.some((set) => set.duplicates.size > 0)
    : false;
  // Check if error files need moving/copying
  const hasErrorFiles = errorDir
    ? gatherFileInfoResult.errorFiles.length > 0
    : false;
  const needsTransfer = hasUniqueFiles || hasDuplicateFiles || hasErrorFiles;

  if (!needsTransfer) {
    reporter.stopSpinnerSuccess(
      "File transfer completed (No files needed transferring).",
    );
    return; // Nothing to transfer
  }

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
    reporter.stopSpinnerSuccess(
      // Use reporter
      `File transfer completed.`, // Simplified message
    );
  } catch (transferError) {
    // Workaround for spinner type issue: stop and log error manually
    reporter.stopSpinnerFailure(
      // Use reporter
      `File transfer failed: ${transferError instanceof Error ? transferError.message : String(transferError)}`, // Ensure message is string
    );
    throw transferError; // Rethrow after stopping spinner and logging
  }
}
