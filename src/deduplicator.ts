import { DeduplicationResult, FileInfo } from "./types"; // Removed FileProcessorConfig
import { MediaComparator } from "../MediaComparator";
import { Spinner } from "@topcli/spinner";
import { MetadataDBService } from "./services/MetadataDBService"; // Import DB Service
import { AppResult, err, ok, DatabaseError } from "./errors"; // Import error types
import {
  mergeAndDeduplicateClusters,
  getAdaptiveThreshold,
} from "./comparatorUtils"; // Import merge function and threshold helper
// import { bufferToSharedArrayBuffer } from "./utils"; // Removed unused import
// import { FileInfoRow } from "./services/MetadataDBService"; // Removed unused import
// import { VPTree } from "../VPTree"; // Removed VPTree import
import { MediaInfo, SimilarityConfig } from "./types"; // Import MediaInfo and SimilarityConfig

/**
 * Performs deduplication on a list of valid files.
 * @param validFiles Array of file paths that were successfully processed.
 * @param comparator Instance of MediaComparator (used for similarity calculation and result processing).
 * @param dbService MetadataDBService instance.
 * @returns A Promise resolving to an AppResult containing the DeduplicationResult or an error.
 */
export async function deduplicateFilesFn(
  validFiles: string[],
  comparator: MediaComparator, // Still needed for calculateSimilarity and processResults
  dbService: MetadataDBService,
  similarityConfig: SimilarityConfig, // Pass config directly
): Promise<AppResult<DeduplicationResult>> {
  // Update return type
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
    console.error(
      `DB Error fetching file info for deduplication: ${allFileInfoResult.error.message}`,
    );
    return err(allFileInfoResult.error);
  }
  const allFileInfoMap = allFileInfoResult.value;

  for (const filePath of validFiles) {
    const fileInfo = allFileInfoMap.get(filePath);
    // Extract pHash (first frame hash) and convert to hex for map key
    const pHashBuffer = fileInfo?.media?.frames?.[0]?.hash;
    const pHashHex = pHashBuffer
      ? Buffer.from(pHashBuffer).toString("hex")
      : null;

    if (pHashHex) {
      if (!pHashMap.has(pHashHex)) {
        pHashMap.set(pHashHex, []);
      }
      pHashMap.get(pHashHex)!.push(filePath);
      filesWithPHash.push(filePath); // Keep track of files with pHash
    } else {
      console.warn(
        `File ${filePath} missing pHash in DB, excluding from exact match check.`,
      );
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

  // --- Step 2: Find Similarity Clusters using LSH ---
  spinner.text = `Finding similar files using LSH for ${potentiallySimilarFiles.size} candidates...`;
  const similarityClusters: Set<string>[] = [];
  const processedForSimilarity = new Set<string>(); // Track files already added to a similarity cluster

  // Helper to generate LSH keys (copied from MetadataDBService for local use)
  const generateLshKeys = (pHashHex: string | null): (string | null)[] => {
    const keys: (string | null)[] = [null, null, null, null];
    if (pHashHex && pHashHex.length === 16) {
      // Expect 64-bit hash (16 hex chars)
      keys[0] = pHashHex.substring(0, 4);
      keys[1] = pHashHex.substring(4, 8);
      keys[2] = pHashHex.substring(8, 12);
      keys[3] = pHashHex.substring(12, 16);
    } else if (pHashHex) {
      console.warn(
        `Invalid pHash length (${pHashHex.length}) for LSH key generation: ${pHashHex}`,
      );
    }
    return keys;
  };

  for (const targetFile of potentiallySimilarFiles) {
    if (processedForSimilarity.has(targetFile)) {
      continue; // Skip if already part of a similarity cluster
    }

    const targetFileInfo = allFileInfoMap.get(targetFile);
    const targetPHashBuffer = targetFileInfo?.media?.frames?.[0]?.hash;
    const targetPHashHex = targetPHashBuffer
      ? Buffer.from(targetPHashBuffer).toString("hex")
      : null;

    if (!targetPHashHex) {
      console.warn(
        `Skipping similarity check for ${targetFile} due to missing pHash.`,
      );
      processedForSimilarity.add(targetFile); // Mark as processed (treated as unique in similarity phase)
      continue;
    }

    const targetLshKeys = generateLshKeys(targetPHashHex);
    const candidateResult = await dbService.findSimilarCandidates(
      targetFile,
      targetLshKeys,
    );

    if (candidateResult.isErr()) {
      console.error(
        `Error finding LSH candidates for ${targetFile}: ${candidateResult.error.message}`,
      );
      processedForSimilarity.add(targetFile); // Mark as processed to avoid retrying
      continue;
    }

    const candidatePaths = candidateResult.value;
    const similarNeighbors = new Set<string>([targetFile]); // Start cluster with the target file

    if (candidatePaths.length > 0) {
      // Fetch info for candidates (can optimize by fetching only needed fields)
      // For now, use the existing map, assuming candidates were in the initial fetch
      const candidateInfoMap = new Map<string, Partial<FileInfo>>();
      candidatePaths.forEach((p) => {
        if (allFileInfoMap.has(p)) {
          candidateInfoMap.set(p, allFileInfoMap.get(p)!);
        } else {
          console.warn(
            `Candidate ${p} for ${targetFile} not found in pre-fetched map.`,
          );
        }
      });

      for (const candidateFile of candidatePaths) {
        if (processedForSimilarity.has(candidateFile)) {
          continue; // Skip if candidate already belongs to another cluster
        }

        const candidateFileInfo = candidateInfoMap.get(candidateFile);
        // Ensure targetFileInfo is also valid here before comparison
        if (!targetFileInfo?.media || !candidateFileInfo?.media) {
          continue; // Skip if media info is missing for comparison
        }

        const similarity = comparator.calculateSimilarity(
          targetFileInfo.media as MediaInfo,
          candidateFileInfo.media as MediaInfo,
        );
        // Ensure comparator.similarityConfig is accessible or passed correctly
        const threshold = getAdaptiveThreshold(
          targetFileInfo.media as MediaInfo,
          candidateFileInfo.media as MediaInfo,
          similarityConfig,
        ); // Use passed config

        if (similarity >= threshold) {
          similarNeighbors.add(candidateFile);
        }
      }
    }

    // If neighbors were found (cluster size > 1), add to similarityClusters and mark all as processed
    if (similarNeighbors.size > 1) {
      similarityClusters.push(similarNeighbors);
      similarNeighbors.forEach((file) => processedForSimilarity.add(file));
    } else {
      // If no similar neighbors found, mark only the target file as processed (unique in similarity phase)
      processedForSimilarity.add(targetFile);
    }
    spinner.text = `Finding similar files... (${processedForSimilarity.size}/${potentiallySimilarFiles.size} checked)`;
  }
  spinner.text = `Found ${similarityClusters.length} similarity clusters via LSH.`;

  // --- Step 3: Merge Exact and Similarity Clusters ---
  spinner.text = "Merging cluster results...";
  // Combine exact matches and results from DBSCAN on potentially similar files
  // Ensure mergeAndDeduplicateClusters is imported
  const allClusters = mergeAndDeduplicateClusters([
    ...exactDuplicateClusters,
    ...similarityClusters,
  ]);

  // --- Step 4: Process Final Clusters ---
  spinner.text = "Processing final clusters...";
  // Create selector using DB for processResults (needed for scoring/representative selection)
  // Create selector using DB for processResults (needed for scoring/representative selection)
  // This selector now primarily uses the pre-fetched map.
  const dbSelector = async (file: string): Promise<AppResult<FileInfo>> => {
    const cachedInfo = allFileInfoMap.get(file);
    if (cachedInfo) {
      // TODO: Ensure rowToFileInfo reconstructs full FileInfo if needed, or adjust types
      // Assuming Partial<FileInfo> is sufficient for scoring/selection for now.
      return ok(cachedInfo as FileInfo); // Cast needed as map stores Partial<FileInfo>
    } else {
      console.warn(
        `File ${file} not found in pre-fetched map during selector call.`,
      );
      // Fallback to DB query if absolutely necessary (should be rare)
      const result = await dbService.getFileInfo(file);
      if (result.isErr()) return err(result.error);
      if (!result.value)
        return err(new DatabaseError(`FileInfo not found in DB for ${file}`));
      // Update map? Might not be thread-safe if used concurrently later.
      // allFileInfoMap.set(file, result.value);
      return ok(result.value as FileInfo); // Cast needed
    }
  };

  const finalResult = await comparator.processResults(allClusters, dbSelector);

  if (finalResult.isErr()) {
    // @ts-expect-error - Suppress potential type error for spinner.stop()
    spinner.stop(); // Stop spinner first
    console.error(
      `\nDeduplication failed during result processing: ${finalResult.error.message}`,
    ); // Log error manually
    return err(finalResult.error); // Propagate error
  }
  const { uniqueFiles, duplicateSets } = finalResult.value; // Unwrap result

  // Add files without pHash back to unique list (as they weren't clustered)
  filesWithoutPHash.forEach((file) => uniqueFiles.add(file));

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
