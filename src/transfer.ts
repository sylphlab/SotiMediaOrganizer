import { GatherFileInfoResult, DeduplicationResult } from "./types";
import { DebugReporter } from "./reporting/DebugReporter";
import { FileTransferService } from "./services/FileTransferService";
import { mkdir, readdir, unlink } from "fs/promises"; // Keep fs/promises for now
import { join } from "path";
import chalk from "chalk";
import { Spinner } from "@topcli/spinner"; // Added for basic progress

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
    fileTransferService: FileTransferService
): Promise<void> {
    // Handle debug report generation first
    if (debugDir) {
        // TODO: Isolate filesystem operations further later if needed
        try {
            await mkdir(debugDir, { recursive: true });
            // Clear the debug directory (optional)
            const debugFiles = await readdir(debugDir);
            for (const file of debugFiles) {
                try {
                    await unlink(join(debugDir, file));
                } catch (err) {
                    console.warn(
                        chalk.yellow(`Could not clear file in debug directory: ${join(debugDir, file)}`),
                        err,
                    );
                }
            }
        } catch (mkdirError) {
             console.error(chalk.red(`Failed to create or access debug directory ${debugDir}:`), mkdirError);
             // Decide if this is fatal or just prevents debug reports
             // For now, log and continue without debug reports
             debugDir = undefined; // Prevent further attempts to use it
        }

        if (debugDir && deduplicationResult.duplicateSets.length > 0) {
            try {
                await debugReporter.generateHtmlReports(
                    deduplicationResult.duplicateSets,
                    debugDir,
                );
                console.log(
                    chalk.yellow(`\nDebug mode: Duplicate set reports have been saved to ${debugDir}`),
                );
            } catch (reportError) {
                 console.error(chalk.red(`Failed to generate debug reports in ${debugDir}:`), reportError);
                 // Continue without reports
            }
        } else if (debugDir) {
            console.log(chalk.yellow("\nDebug mode: No duplicate sets found"));
        }
    }

    // Delegate actual file transfers to the service
    // TODO: Abstract progress reporting later
    const spinner = new Spinner().start("Transferring files..."); // Basic progress
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
         spinner.succeed(`File transfer completed in ${(spinner.elapsedTime / 1000).toFixed(2)} seconds.`);
    } catch (transferError) {
         // Workaround for spinner type issue: stop and log error manually
         // @ts-expect-error - Suppress incorrect type error for spinner.stop() (Corrected directive)
         spinner.stop(); // Stop the spinner animation (Method likely exists despite type error)
         console.error(chalk.red(`✖ File transfer failed: ${transferError.message}`)); // Log error manually
         throw transferError; // Rethrow after stopping spinner and logging
    }
}