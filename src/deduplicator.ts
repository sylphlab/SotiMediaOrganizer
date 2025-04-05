import { DeduplicationResult, FileInfo } from "./types"; // Removed FileProcessorConfig
import { MediaComparator } from "../MediaComparator";
import { Spinner } from "@topcli/spinner";
import { MetadataDBService } from "./services/MetadataDBService"; // Import DB Service
import { AppResult, err, ok, DatabaseError } from "./errors"; // Import error types
import { mergeAndDeduplicateClusters } from "./comparatorUtils"; // Import merge function
import { bufferToSharedArrayBuffer } from "./utils"; // Import buffer utility
import { FileInfoRow } from "./services/MetadataDBService"; // Import row type
import { VPTree } from "../VPTree"; // Import VPTree
import { MediaInfo } from "./types"; // Import MediaInfo

/**
 * Performs deduplication on a list of valid files.
 * @param validFiles Array of file paths that were successfully processed.
 * @param comparator Instance of MediaComparator (contains VPTree/DBSCAN logic).
 * @param dbService MetadataDBService instance.
 * @returns A Promise resolving to an AppResult containing the DeduplicationResult or an error.
 */
export async function deduplicateFilesFn(
    validFiles: string[],
    comparator: MediaComparator,
    dbService: MetadataDBService // Add dbService, remove others
): Promise<AppResult<DeduplicationResult>> { // Update return type
    // TODO: Abstract spinner logic later
    const spinner = new Spinner().start("Deduplicating files...");

    // --- Step 1: Find Exact Duplicates using DB ---
    spinner.text = "Finding exact duplicates (DB query)...";
    const pHashMap = new Map<string, string[]>(); // pHash -> [filePath1, filePath2, ...]
    const filesWithPHash: string[] = [];
    const filesWithoutPHash: string[] = []; // Files missing pHash in DB (shouldn't happen ideally)

    // Fetch pHashes for all valid files (consider batching for millions of files)
    const allFileInfoResult = await dbService.getMultipleFileInfo(validFiles);
    if (allFileInfoResult.isErr()) {
        // @ts-expect-error - Suppress potential type error for spinner.stop()
        spinner.stop();
        console.error(`DB Error fetching file info for deduplication: ${allFileInfoResult.error.message}`);
        return err(allFileInfoResult.error);
    }
    const allFileInfoMap = allFileInfoResult.value;

    for (const filePath of validFiles) {
        const fileInfo = allFileInfoMap.get(filePath);
        // Extract pHash (first frame hash) and convert to hex for map key
        const pHashBuffer = fileInfo?.media?.frames?.[0]?.hash;
        const pHashHex = pHashBuffer ? Buffer.from(pHashBuffer).toString('hex') : null;

        if (pHashHex) {
            if (!pHashMap.has(pHashHex)) {
                pHashMap.set(pHashHex, []);
            }
            pHashMap.get(pHashHex)!.push(filePath);
            filesWithPHash.push(filePath); // Keep track of files with pHash
        } else {
            console.warn(`File ${filePath} missing pHash in DB, excluding from exact match check.`);
            filesWithoutPHash.push(filePath); // Treat as unique for now, or handle differently
        }
    }

    const exactDuplicateClusters: Set<string>[] = [];
    const potentiallySimilarFiles = new Set<string>();

    pHashMap.forEach((fileList) => {
        if (fileList.length > 1) {
            // Found exact duplicates based on pHash
            exactDuplicateClusters.push(new Set(fileList));
        } else if (fileList.length === 1) {
            // Single file with this pHash, add to potentially similar list
            potentiallySimilarFiles.add(fileList[0]);
        }
    });
    spinner.text = `Found ${exactDuplicateClusters.length} exact duplicate sets via pHash.`;

    // --- Step 2: Cluster Potentially Similar Files using VPTree/DBSCAN ---
    const filesToCluster = Array.from(potentiallySimilarFiles);
    let similarityClusters: Set<string>[] = [];

    if (filesToCluster.length > 1) {
        spinner.text = `Building VPTree for ${filesToCluster.length} potentially similar files...`;
        // Define DB-aware distance function for the reduced set
        const distanceFn = async (a: string, b: string): Promise<number> => {
            // Info should already be in allFileInfoMap from earlier fetch
            const fileInfoA = allFileInfoMap.get(a);
            const fileInfoB = allFileInfoMap.get(b);
            if (!fileInfoA || !fileInfoB || !fileInfoA.media || !fileInfoB.media) {
                 console.warn(`Missing FileInfo in map for distance calc (${a}, ${b})`);
                 return Infinity;
            }
            return 1 - comparator.calculateSimilarity(fileInfoA.media as MediaInfo, fileInfoB.media as MediaInfo);
        };

        const vpTree = await VPTree.build(filesToCluster, distanceFn);

        spinner.text = `Running DBSCAN on ${filesToCluster.length} files...`;
        // Call the refactored single-threaded DBSCAN method
        similarityClusters = await comparator.dbscanClusters( // Use renamed method
            filesToCluster,
            vpTree,
            (progress) => (spinner.text = `Running DBSCAN... ${progress}`), // Keep progress callback
        );
    } else {
         spinner.text = "Skipping VPTree/DBSCAN (<=1 potentially similar file).";
    }


    // --- Step 3: Merge Exact and Similarity Clusters ---
    spinner.text = "Merging cluster results...";
    // Combine exact matches and results from DBSCAN on potentially similar files
    // Ensure mergeAndDeduplicateClusters is imported
    const allClusters = mergeAndDeduplicateClusters([
        ...exactDuplicateClusters,
        ...similarityClusters
    ]);

    // --- Step 4: Process Final Clusters ---
    spinner.text = "Processing final clusters...";
    // Create selector using DB for processResults (needed for scoring/representative selection)
     const dbSelector = async (file: string): Promise<AppResult<FileInfo>> => {
         // Use the already fetched map first for efficiency
         const cachedInfo = allFileInfoMap.get(file);
         if (cachedInfo) {
             // TODO: Ensure rowToFileInfo reconstructs full FileInfo if needed, or adjust types
             return ok(cachedInfo as FileInfo);
         }
         // Fallback to DB query if somehow missed (shouldn't happen ideally)
         console.warn(`File ${file} not found in pre-fetched map, querying DB again.`);
         const result = await dbService.getFileInfo(file);
         if (result.isErr()) return err(result.error);
         if (!result.value) return err(new DatabaseError(`FileInfo not found in DB for ${file}`));
         return ok(result.value as FileInfo);
     };

    const finalResult = await comparator.processResults(allClusters, dbSelector);

     if (finalResult.isErr()) {
        // @ts-expect-error - Suppress potential type error for spinner.stop()
        spinner.stop(); // Stop spinner first
        console.error(`\nDeduplication failed during result processing: ${finalResult.error.message}`); // Log error manually
        return err(finalResult.error); // Propagate error
    }
    const { uniqueFiles, duplicateSets } = finalResult.value; // Unwrap result

    // Add files without pHash back to unique list (as they weren't clustered)
    filesWithoutPHash.forEach(file => uniqueFiles.add(file));

    // Log results
    const duplicateCount = duplicateSets.reduce(
        (sum, set) => sum + set.duplicates.size,
        0,
    );
    spinner.succeed(
        `Deduplication completed in ${(spinner.elapsedTime / 1000).toFixed(2)} seconds: Found ${duplicateSets.length} duplicate sets, ${uniqueFiles.size} unique files, ${duplicateCount} duplicates`,
    );

    return ok({ uniqueFiles, duplicateSets }); // Return Ok result
}