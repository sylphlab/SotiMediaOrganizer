import { DeduplicationResult, FileInfo, FileProcessorConfig } from "./types";
import { MediaComparator } from "../MediaComparator"; // Still need the class for now
import { Spinner } from "@topcli/spinner"; // Keep spinner for now
import { LmdbCache } from "./caching/LmdbCache"; // Dependencies for processSingleFile
import { ExifTool } from "exiftool-vendored";
import { WorkerPool } from "./contexts/types";
import { processSingleFile } from "./fileProcessor";

/**
 * Performs deduplication on a list of valid files.
 * @param validFiles Array of file paths that were successfully processed.
 * @param comparator Instance of MediaComparator (contains VPTree/DBSCAN logic).
 * @param config Combined configuration object for file processing.
 * @param cache LmdbCache instance.
 * @param exifTool ExifTool instance.
 * @param workerPool WorkerPool instance.
 * @returns A Promise resolving to the DeduplicationResult.
 */
export async function deduplicateFilesFn(
    validFiles: string[],
    comparator: MediaComparator, // Pass comparator instance
    config: FileProcessorConfig,
    cache: LmdbCache,
    exifTool: ExifTool,
    workerPool: WorkerPool
): Promise<DeduplicationResult> {
    // TODO: Abstract spinner logic later
    const spinner = new Spinner().start("Deduplicating files...");

    // Define the selector function needed by comparator.deduplicateFiles
    // This uses the functional processSingleFile
    const selector = (file: string): Promise<FileInfo> => {
        return processSingleFile(file, config, cache, exifTool, workerPool);
    };

    const { uniqueFiles, duplicateSets } = await comparator.deduplicateFiles(
        validFiles,
        selector, // Pass the selector function
        (progress) => (spinner.text = `Deduplicating files... ${progress}`),
    );

    // Log results (Keep logging here for now, or abstract later)
    const duplicateCount = duplicateSets.reduce(
        (sum, set) => sum + set.duplicates.size,
        0,
    );
    spinner.succeed(
        `Deduplication completed in ${(spinner.elapsedTime / 1000).toFixed(2)} seconds: Found ${duplicateSets.length} duplicate sets, ${uniqueFiles.size} unique files, ${duplicateCount} duplicates`,
    );

    return { uniqueFiles, duplicateSets };
}