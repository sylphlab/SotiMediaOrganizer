import { DeduplicationResult, FileInfo } from "./types";
import { MediaComparator } from "../MediaComparator";
import { Spinner } from "@topcli/spinner";
import { MetadataDBService } from "./services/MetadataDBService"; // Removed unused FileInfoRow import
import { AppResult, err, ok, DatabaseError } from "./errors"; // Import error types
import {
  mergeAndDeduplicateClusters,
  getAdaptiveThreshold,
} from "./comparatorUtils"; // Import merge function and threshold helper
import { bufferToSharedArrayBuffer } from "./utils"; // Need this for reconstructing MediaInfo
import { MediaInfo, SimilarityConfig } from "./types"; // Import MediaInfo and SimilarityConfig

/**
 * Performs deduplication on a list of valid files.
 * @param validFiles Array of file paths that were successfully processed.
 * @param comparator Instance of MediaComparator (used for similarity calculation and result processing).
 * @param dbService MetadataDBService instance.
 * @param similarityConfig Configuration for similarity thresholds.
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
  const filesWithoutPHash: string[] = []; // Files missing pHash in DB
  const potentiallySimilarFiles = new Set<string>(); // Files to check for similarity

  // Fetch only pHash and filePath needed for exact matching
  // TODO: Optimize - create a dedicated DB method getPHashesForFiles?
  const initialInfoResult = await dbService.getMultipleFileInfo(validFiles);
  if (initialInfoResult.isErr()) {
    // @ts-expect-error - Suppress potential type error for spinner.stop()
    spinner.stop();
    console.error(
      `DB Error fetching initial file info for deduplication: ${initialInfoResult.error.message}`,
    );
    return err(initialInfoResult.error);
  }
  const initialInfoMap = initialInfoResult.value; // Map<string, Partial<FileInfo>>

  for (const filePath of validFiles) {
    const fileInfo = initialInfoMap.get(filePath);
    const pHashBuffer = fileInfo?.media?.frames?.[0]?.hash;
    const pHashHex = pHashBuffer
      ? Buffer.from(pHashBuffer).toString("hex")
      : null;

    if (pHashHex) {
      if (!pHashMap.has(pHashHex)) {
        pHashMap.set(pHashHex, []);
      }
      pHashMap.get(pHashHex)!.push(filePath);
    } else {
      console.warn(
        `File ${filePath} missing pHash in DB, excluding from exact match check.`,
      );
      filesWithoutPHash.push(filePath); // Treat as unique for now
    }
  }

  const exactDuplicateClusters: Set<string>[] = [];

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

  // Helper to generate LSH keys
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

  let checkedCount = 0; // Counter for progress update
  for (const targetFile of potentiallySimilarFiles) {
    checkedCount++;
    if (processedForSimilarity.has(targetFile)) {
      continue; // Skip if already part of a similarity cluster
    }

    // Fetch required MediaInfo for the target file
    const targetMediaInfoResult = await dbService.getMediaInfoForFiles([
      targetFile,
    ]);
    if (
      targetMediaInfoResult.isErr() ||
      !targetMediaInfoResult.value.has(targetFile)
    ) {
      console.error(
        `Failed to fetch MediaInfo for target ${targetFile}, skipping similarity check.`,
      );
      processedForSimilarity.add(targetFile);
      continue;
    }
    const targetMediaData = targetMediaInfoResult.value.get(targetFile)!;
    const targetPHashHex = targetMediaData.pHash;

    if (!targetPHashHex) {
      console.warn(
        `Skipping similarity check for ${targetFile} due to missing pHash in DB.`,
      );
      processedForSimilarity.add(targetFile); // Mark as processed (treated as unique in similarity phase)
      continue;
    }

    const targetLshKeys = generateLshKeys(targetPHashHex);
    // Find candidates using the DB service
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
      // Fetch required MediaInfo for candidates from DB
      const candidateMediaInfoResult =
        await dbService.getMediaInfoForFiles(candidatePaths);
      if (candidateMediaInfoResult.isErr()) {
        console.error(
          `Failed to fetch MediaInfo for candidates of ${targetFile}, skipping comparisons.`,
        );
        // Mark target as processed, but don't mark candidates as they might be compared later
        processedForSimilarity.add(targetFile);
        continue;
      }
      const candidateMediaInfoMap = candidateMediaInfoResult.value;

      // Reconstruct minimal MediaInfo for the target file
      const targetMediaInfo: MediaInfo | null = targetPHashHex
        ? {
            duration: targetMediaData.mediaDuration ?? 0,
            frames: [
              {
                hash: bufferToSharedArrayBuffer(
                  Buffer.from(targetPHashHex, "hex"),
                ),
                timestamp: 0,
              },
            ],
          }
        : null;

      if (!targetMediaInfo) {
        // Should not happen due to earlier check, but safety first
        console.error(
          `Failed to reconstruct target MediaInfo for ${targetFile}.`,
        );
        processedForSimilarity.add(targetFile);
        continue;
      }

      for (const candidateFile of candidatePaths) {
        // Avoid comparing already clustered files within this loop iteration
        if (processedForSimilarity.has(candidateFile)) {
          continue;
        }

        const candidateMediaData = candidateMediaInfoMap.get(candidateFile);
        const candidatePHashHex = candidateMediaData?.pHash;

        // Reconstruct minimal MediaInfo for the candidate file
        const candidateMediaInfo: MediaInfo | null = candidatePHashHex
          ? {
              duration: candidateMediaData?.mediaDuration ?? 0,
              frames: [
                {
                  hash: bufferToSharedArrayBuffer(
                    Buffer.from(candidatePHashHex, "hex"),
                  ),
                  timestamp: 0,
                },
              ],
            }
          : null;

        // Ensure MediaInfo could be reconstructed for candidate before comparison
        if (!candidateMediaInfo) {
          console.warn(
            `Skipping comparison between ${targetFile} and ${candidateFile} due to missing candidate MediaInfo.`,
          );
          continue;
        }

        const similarity = comparator.calculateSimilarity(
          targetMediaInfo,
          candidateMediaInfo,
        );
        const threshold = getAdaptiveThreshold(
          targetMediaInfo,
          candidateMediaInfo,
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
    spinner.text = `Finding similar files... (${checkedCount}/${potentiallySimilarFiles.size} checked)`;
  }
  spinner.text = `Found ${similarityClusters.length} similarity clusters via LSH.`;

  // --- Step 3: Merge Exact and Similarity Clusters ---
  spinner.text = "Merging cluster results...";
  // Combine exact matches and results from LSH similarity check
  const allClusters = mergeAndDeduplicateClusters([
    ...exactDuplicateClusters,
    ...similarityClusters,
  ]);

  // --- Step 4: Process Final Clusters ---
  spinner.text = "Processing final clusters...";
  // Updated dbSelector to always fetch from DB, as allFileInfoMap is removed
  const dbSelector = async (file: string): Promise<AppResult<FileInfo>> => {
    const result = await dbService.getFileInfo(file);
    if (result.isErr()) return err(result.error);
    if (!result.value) {
      return err(
        new DatabaseError(
          `FileInfo not found in DB for ${file} during final processing`,
        ),
      );
    }
    // TODO: Ensure rowToFileInfo reconstructs full FileInfo if needed by processResults/scoring
    // Assuming Partial<FileInfo> is sufficient for now.
    return ok(result.value as FileInfo); // Cast needed
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
