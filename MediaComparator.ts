import {
  MediaInfo,
  DeduplicationResult,
  FileInfo,
  FrameInfo,
  SimilarityConfig,
  ProgramOptions,
  FileProcessor,
  // WorkerData, // Removed unused import
  // MaybePromise, // Removed unused import
  WasmExports,
  FileProcessorConfig, // Added config type
} from "./src/types";
// import { MediaProcessor } from "./src/MediaProcessor"; // Removed old import
import { LmdbCache } from "./src/caching/LmdbCache"; // Added cache import
import { ExifTool } from "exiftool-vendored"; // Added exiftool import
import { processSingleFile } from "./src/fileProcessor"; // Added file processor function import
import { VPNode, VPTree } from "./VPTree";
import { filterAsync, mapAsync } from "./src/utils";
import { ok, err, AppResult, UnknownError, AppError } from "./src/errors"; // Removed unused AnyAppError
import { calculateImageSimilarity, calculateImageVideoSimilarity, calculateSequenceSimilarityDTW, getAdaptiveThreshold, sortEntriesByScore, selectRepresentativesFromScored, mergeAndDeduplicateClusters, expandCluster } from "./src/comparatorUtils"; // Import expandCluster
// Removed inversify imports: inject, injectable
import { Types, type WorkerPool } from "./src/contexts/types";
import { readFile } from "fs/promises";
import { join } from "path";

// WasmExports interface moved to src/types.ts

// Removed @injectable() decorator
export class MediaComparator {
  private readonly minThreshold: number;
  private wasmExports: WasmExports | null = null;
  private wasmInitializationPromise: Promise<void> | null = null;

  constructor(
    // private mediaProcessor: MediaProcessor, // Removed injection
    private cache: LmdbCache, // Removed @inject()
    private fileProcessorConfig: FileProcessorConfig, // Removed @inject()
    private exifTool: ExifTool, // Removed @inject()
    private similarityConfig: SimilarityConfig,
    private options: ProgramOptions,
    private workerPool: WorkerPool, // Removed @inject()
  ) {
    this.minThreshold = Math.min(
      this.similarityConfig.imageSimilarityThreshold,
      this.similarityConfig.imageVideoSimilarityThreshold,
      this.similarityConfig.videoSimilarityThreshold,
    );
    // Start WASM initialization, but don't block constructor
    this.wasmInitializationPromise = this.initializeWasm().catch((err) => {
      console.error("Failed to initialize WASM for Hamming distance:", err);
      this.wasmExports = null; // Ensure fallback if init fails
    });
  }

  private async initializeWasm(): Promise<void> {
    try {
      // Assuming the WASM file is copied to the dist directory during build
      const wasmPath = join(__dirname, "..", "dist", "index.wasm");
      const wasmBuffer = await readFile(wasmPath);
      const wasmModule = await WebAssembly.instantiate(wasmBuffer, {
        // Add necessary imports if your WASM module requires them
        // Example for AssemblyScript's default abort:
        env: {
          abort: (
            message: number,
            fileName: number,
            lineNumber: number,
            columnNumber: number,
          ) => {
            // In a real app, you might want to decode the message/filename pointers
            // using the WASM memory, but for now, just throw an error.
            throw new Error(
              `WASM aborted: msg=${message} file=${fileName} L${lineNumber} C${columnNumber}`,
            );
          },
          // Add other required env functions if any
        },
      });
      this.wasmExports = wasmModule.instance.exports as unknown as WasmExports;

      // Verify the expected function exists
      if (typeof this.wasmExports?.hammingDistanceSIMD !== "function") {
        console.warn(
          "WASM loaded but hammingDistanceSIMD function not found. Falling back to JS.",
        );
        this.wasmExports = null;
      } else {
        // console.log("WASM Hamming distance function loaded successfully."); // Optional success log
      }
    } catch (err) {
      console.error("Failed to load or instantiate WASM module:", err);
      this.wasmExports = null; // Ensure fallback on error
    }
  }

  // hammingDistance, popcount64, popcount8 moved to comparatorUtils.ts

  async deduplicateFiles(
    files: string[],
    selector: FileProcessor,
    progressCallback?: (progress: string) => void,
  ): Promise<AppResult<DeduplicationResult>> { // Update return type
    // Ensure WASM is loaded before proceeding with distance calculations if needed
    if (this.wasmInitializationPromise) {
      await this.wasmInitializationPromise;
    }

    progressCallback?.("Building VPTree");
    const vpTree = await VPTree.build(files, async (a, b) => {
      // processSingleFile (selector) now returns AppResult<FileInfo>
      const [resultA, resultB] = await Promise.all([
        selector(a), // selector is processSingleFile
        selector(b),
      ]);

      // Check for errors
      // Check for errors
      if (resultA.isErr()) {
          console.error(`Error processing file ${a} for distance calculation: ${resultA.error.message}`);
          return Infinity; // Return max distance on error
      }
      if (resultB.isErr()) {
          console.error(`Error processing file ${b} for distance calculation: ${resultB.error.message}`);
          return Infinity; // Return max distance on error
      }

      // Unwrap successful results
      const fileInfoA = resultA.value;
      const fileInfoB = resultB.value;
      // calculateSimilarity will now potentially use WASM hammingDistance
      return 1 - this.calculateSimilarity(fileInfoA.media, fileInfoB.media);
    });

    progressCallback?.("Running DBSCAN");
    const clusters = await this.parallelDBSCAN(files, vpTree, progressCallback);

    // processResults now returns AppResult, so we can return it directly
    return this.processResults(clusters, selector);
  }

  private async parallelDBSCAN(
    files: string[],
    vpTree: VPTree<string>,
    progressCallback?: (progress: string) => void,
  ): Promise<Set<string>[]> {
    const batchSize = 2048;

    // Batch the files and send them to the worker pool
    let processedItems = 0;
    const totalItems = files.length;
    const promises = [];
    for (let i = 0; i < totalItems; i += batchSize) {
      const batch = files.slice(i, i + batchSize);
      promises.push(
        this.workerPool
          .performDBSCAN( /* Removed argument as worker function no longer accepts it */ )
          .then((result) => {
            processedItems += batch.length;
            progressCallback?.(
              `Running DBSCAN: ${processedItems} / ${totalItems} files processed`,
            );
            return result;
          }),
      );
    }

    const results = await Promise.all(promises);

    return mergeAndDeduplicateClusters(results.flat()); // Use imported function
  }

  // Removed mergeAndDeduplicate method (moved to comparatorUtils)

  // This method is intended to be run inside a worker thread
  // Refactored to use expandCluster utility
  async workerDBSCAN(
    chunk: string[],
    vpTree: VPTree<string>,
  ): Promise<Set<string>[]> {
    const eps = 1 - this.minThreshold; // Epsilon based on min similarity
    const minPts = 2; // Minimum points to form a core point (including self)
    const clusters: Set<string>[] = [];
    const visited = new Set<string>(); // Track visited points within this worker's chunk

    // Define the neighbor fetching function required by expandCluster
    // This still uses 'this', highlighting the need to refactor workerDBSCAN further
    // or change how dependencies are handled in workers.
    const getNeighborsFn = (p: string): Promise<AppResult<string[]>> => {
        return this.getValidNeighbors(p, vpTree, eps);
    };

    for (const point of chunk) {
      if (visited.has(point)) continue;
      // Note: We mark point as visited *before* getting neighbors,
      // but expandCluster expects the initial point *not* to be in visited yet.
      // Let's adjust: mark visited inside expandCluster or after initial neighbor check.
      // For simplicity, let expandCluster handle marking the initial point visited.
      // visited.add(point); // Mark point as visited immediately - Moved inside expandCluster logic implicitly

      // Find initial neighbors for the starting point
      const neighborsResult = await getNeighborsFn(point);

      if (neighborsResult.isErr()) {
          console.error(`Error getting initial neighbors for ${point}: ${neighborsResult.error.message}`);
          visited.add(point); // Ensure point is marked visited even if neighbors fail
          continue; // Skip point if neighbors can't be fetched
      }
      const neighbors = neighborsResult.value;

      // Check if it's a core point (has enough neighbors)
      // Note: DBSCAN typically requires minPts *including* the point itself.
      // getValidNeighbors might or might not include the point itself depending on distance=0.
      // Assuming getValidNeighbors doesn't include the point itself unless it's a true neighbor.
      // So, check >= minPts. If it should include self, check should be >= minPts.
      if (neighbors.length >= minPts -1) { // Check if it *could* be a core point (needs self + minPts-1 others)
          // It *might* be a core point, try expanding the cluster
          // Pass the initial point and its neighbors to expandCluster
          const clusterResult = await expandCluster(
              point,
              neighbors, // Pass initial neighbors
              visited,   // Pass the shared visited set (modified by expandCluster)
              minPts,
              getNeighborsFn // Pass the function to get neighbors for subsequent points
          );

          if (clusterResult.isErr()) {
              console.error(`Error expanding cluster for ${point}: ${clusterResult.error.message}`);
              // Ensure point is marked visited even if expansion fails
              visited.add(point);
              // Decide how to handle cluster expansion errors - skip cluster?
              continue;
          }

          // Add the successfully expanded cluster
          // expandCluster handles adding the initial point and marking all cluster members visited
          clusters.push(clusterResult.value);
      } else {
           // Not enough neighbors to be a core point, mark as visited (noise for now)
           visited.add(point);
      }
      // If not a core point, it's noise (or will be picked up by another cluster's expansion)
      // No need to explicitly handle noise here as expandCluster handles visited set.
    }

    // Add remaining unclustered points as single-element clusters (optional, depends on noise handling)
    // for (const point of chunk) {
    //     if (!visited.has(point)) {
    //         clusters.push(new Set([point]));
    //     }
    // }

    return clusters;
  }

  private async getValidNeighbors(
    point: string,
    vpTree: VPTree<string>,
    eps: number,
  ): Promise<AppResult<string[]>> { // Update return type
    // Search VPTree for potential neighbors within epsilon distance
    const potentialNeighbors = await vpTree.search(point, {
      maxDistance: eps,
      sort: false, // No need to sort here
    });

    // Fetch FileInfo for the query point once
    // Fetch FileInfo using the new functional approach
    const fileInfo1Result = await processSingleFile(point, this.fileProcessorConfig, this.cache, this.exifTool, this.workerPool);
    if (fileInfo1Result.isErr()) {
        console.error(`Error processing file ${point} in getValidNeighbors: ${fileInfo1Result.error.message}`);
        // Cannot proceed without file info, return error or empty array? Returning error.
        return err(new AppError(`Failed to get FileInfo for ${point} in getValidNeighbors`, { originalError: fileInfo1Result.error }));
    }
    const fileInfo1 = fileInfo1Result.value; // Unwrap
    const media1 = fileInfo1.media;

    // Filter potential neighbors based on the adaptive similarity threshold
    const validNeighbors = await filterAsync(
      potentialNeighbors,
      async (neighbor): Promise<AppResult<boolean>> => { // Callback returns AppResult
        // Don't compare a point to itself in the context of finding neighbors
        if (neighbor.point === point) return ok(false);

        // Calculate actual similarity (1 - distance)
        const similarity = 1 - neighbor.distance;

        // Fetch FileInfo for the neighbor using the new functional approach
        // TODO: processSingleFile should also return AppResult - handle this later
        const fileInfo2Result = await processSingleFile(neighbor.point, this.fileProcessorConfig, this.cache, this.exifTool, this.workerPool);
         if (fileInfo2Result.isErr()) {
            console.error(`Error processing neighbor file ${neighbor.point} in getValidNeighbors: ${fileInfo2Result.error.message}`);
            // Treat as non-valid neighbor if processing fails
            return ok(false);
        }
        const fileInfo2 = fileInfo2Result.value; // Unwrap
        const media2 = fileInfo2.media;

        // Get the specific threshold for this pair of media types
        const threshold = getAdaptiveThreshold(media1, media2, this.similarityConfig); // Use imported function

        // Keep neighbor if similarity meets or exceeds the adaptive threshold
        return ok(similarity >= threshold);
      },
    );

    // Handle the result of filterAsync
    if (validNeighbors.isErr()) {
        return err(validNeighbors.error); // Propagate error
    }

    // Return only the points (file paths) of the valid neighbors
    // Unwrap the value before mapping
    return ok(validNeighbors.value.map((n) => n.point));
  }

  private async processResults(
    clusters: Set<string>[],
    selector: FileProcessor,
  ): Promise<AppResult<DeduplicationResult>> { // Update return type
    const uniqueFiles = new Set<string>();
    const duplicateSets: Array<{
      bestFile: string;
      representatives: Set<string>;
      duplicates: Set<string>;
    }> = [];

    for (const cluster of clusters) {
      if (cluster.size === 1) {
        uniqueFiles.add(cluster.values().next().value);
      } else if (cluster.size > 1) {
        // Ensure cluster has more than one item
        const clusterArray = Array.from(cluster);
        const representativesResult = await this.selectRepresentatives(
          clusterArray,
          selector,
        );

        if (representativesResult.isErr()) {
            // Decide how to handle error - log and skip cluster? Propagate?
            console.error(`Error selecting representatives for cluster: ${representativesResult.error.message}`, clusterArray);
            // Option: Skip this cluster
            continue;
            // Option: Propagate error (would require changing processResults signature further)
            // return err(representativesResult.error);
        }
        const representatives = representativesResult.value;
        // Ensure representatives is not empty before proceeding
        if (representatives.length > 0) {
          const representativeSet = new Set(representatives);
          const duplicateSet = new Set(
            clusterArray.filter((f) => !representativeSet.has(f)),
          );

          // Only add if there are actual duplicates
          if (duplicateSet.size > 0 || representativeSet.size > 1) {
            duplicateSets.push({
              bestFile: representatives[0], // Assume first representative is 'best' for folder naming
              representatives: representativeSet,
              duplicates: duplicateSet,
            });
          } else {
            // If only one representative and no duplicates, treat as unique
            uniqueFiles.add(representatives[0]);
          }
        } else {
          // Handle cases where no representative could be selected (should not happen ideally)
          // Add all items as unique for safety? Or log an error?
          cluster.forEach((item) => uniqueFiles.add(item));
        }
      }
    }

    return ok({ uniqueFiles, duplicateSets }); // Wrap result in ok()
  }

  createVPTreeByRoot(root: VPNode<string>): VPTree<string> {
    // Recreate the distance function for the new VPTree instance
    const distanceFn = async (a: string, b: string): Promise<number> => {
      // Use different variable names to avoid redeclaration
      const [resA, resB] = await Promise.all([
        processSingleFile(a, this.fileProcessorConfig, this.cache, this.exifTool, this.workerPool), // Use processSingleFile directly
        processSingleFile(b, this.fileProcessorConfig, this.cache, this.exifTool, this.workerPool),
      ]);
      // Check for errors (similar to the VPTree build distance function)
      if (resA.isErr()) {
          console.error(`Error processing file ${a} for distance calculation (recreated tree): ${resA.error.message}`);
          return Infinity;
      }
      if (resB.isErr()) {
          console.error(`Error processing file ${b} for distance calculation (recreated tree): ${resB.error.message}`);
          return Infinity;
      }
      // Unwrap successful results
      const infoA = resA.value;
      const infoB = resB.value;
      return 1 - this.calculateSimilarity(infoA.media, infoB.media);
    };
    return new VPTree<string>(root, distanceFn);
  }

  private async selectRepresentatives(
    cluster: string[],
    selector: FileProcessor,
  ): Promise<AppResult<string[]>> { // Update return type
    if (cluster.length <= 1) return ok(cluster); // Wrap base case in ok()

    // Fetch FileInfo for all entries concurrently
    const entriesWithInfoResult = await mapAsync(cluster, async (entry): Promise<AppResult<{ entry: string; fileInfo: FileInfo }>> => {
        const fileInfoResult = await selector(entry); // selector returns AppResult<FileInfo>
        if (fileInfoResult.isErr()) {
            // Propagate error if file processing fails
            return err(new AppError(`Failed processing ${entry} in selectRepresentatives`, { originalError: fileInfoResult.error }));
        }
        return ok({ entry, fileInfo: fileInfoResult.value }); // Return Ok result
    });

    if (entriesWithInfoResult.isErr()) {
        return err(entriesWithInfoResult.error); // Propagate error
    }
    const entriesWithInfo: { entry: string; fileInfo: FileInfo }[] = entriesWithInfoResult.value; // Unwrap with explicit type

    // Score and sort using the utility function
    const sortedScoredEntries = sortEntriesByScore(entriesWithInfo); // Use imported function

    // Select representatives using the utility function
    // Need to map sortedScoredEntries back to { entry, fileInfo } format expected by selectRepresentativesFromScored
    const sortedEntriesWithInfo = sortedScoredEntries.map(scored => {
        // entriesWithInfo is now guaranteed to be an array here
        const original = entriesWithInfo.find(e => e.entry === scored.entry);
        // Add a check for safety instead of non-null assertion
        if (!original) {
             console.error(`Could not find original entry info for ${scored.entry} during representative selection.`);
             // Decide how to handle - skip this entry? return error?
             // For now, filter it out later if fileInfo is needed and missing.
             return { entry: scored.entry, fileInfo: null }; // Indicate missing info
        }
        return { entry: scored.entry, fileInfo: original.fileInfo };
    }).filter(e => e.fileInfo !== null) as { entry: string; fileInfo: FileInfo }[]; // Filter out entries where original wasn't found and cast back


    // selectRepresentativesFromScored likely doesn't return AppResult yet, wrap if needed
    // Assuming it returns string[] for now
    try {
        const representatives = selectRepresentativesFromScored(
            sortedEntriesWithInfo,
            this.similarityConfig,
            this.wasmExports
        );
        return ok(representatives);
    } catch (error) {
        return err(new UnknownError(error)); // Wrap potential errors
    }
  }

  // getQuality moved to comparatorUtils.ts

  // handleMultiFrameBest logic moved into selectRepresentativesFromScored in comparatorUtils.ts

  private async scoreEntries(
    entries: string[],
    selector: FileProcessor,
  ): Promise<AppResult<string[]>> { // Update return type
    // Fetch FileInfo for all entries concurrently
    const entriesWithInfoResult = await mapAsync(entries, async (entry): Promise<AppResult<{ entry: string; fileInfo: FileInfo }>> => {
        const fileInfoResult = await selector(entry); // selector returns AppResult<FileInfo>
         if (fileInfoResult.isErr()) {
            // Propagate error if file processing fails
            return err(new AppError(`Failed processing ${entry} in scoreEntries`, { originalError: fileInfoResult.error }));
        }
        return ok({ entry, fileInfo: fileInfoResult.value }); // Return Ok result
    });

     if (entriesWithInfoResult.isErr()) {
        return err(entriesWithInfoResult.error); // Propagate error
    }
    const entriesWithInfo: { entry: string; fileInfo: FileInfo }[] = entriesWithInfoResult.value; // Unwrap with explicit type

    // Score and sort using the utility function
    const sortedScoredEntries = sortEntriesByScore(entriesWithInfo); // Use imported function

    // Return just the sorted entry paths
    // Assuming sortEntriesByScore doesn't throw and returns the expected type
    return ok(sortedScoredEntries.map((scored) => scored.entry));
  }

  // Public for potential use in DebugReporter
  // calculateEntryScore moved to comparatorUtils.ts

  calculateSimilarity(media1: MediaInfo, media2: MediaInfo): number {
    const isImage1 = media1.duration === 0;
    const isImage2 = media2.duration === 0;

    if (isImage1 && isImage2) {
      return calculateImageSimilarity(media1.frames[0], media2.frames[0], this.wasmExports); // Use imported function
    } else if (isImage1 || isImage2) {
      return calculateImageVideoSimilarity( // Use imported function
        isImage1 ? media1 : media2,
        isImage1 ? media2 : media1,
        this.similarityConfig,
        this.wasmExports,
      );
    } else {
      return this.calculateVideoSimilarity(media1, media2);
    }
  }

  // calculateImageSimilarity moved to comparatorUtils.ts

  // calculateImageVideoSimilarity moved to comparatorUtils.ts

  private calculateVideoSimilarity(
    media1: MediaInfo,
    media2: MediaInfo,
  ): number {
    if (media1.frames.length === 0 || media2.frames.length === 0) {
      return 0; // Return 0 similarity if either video has no frames
    }

    const [shorterMedia, longerMedia] =
      media1.duration <= media2.duration ? [media1, media2] : [media2, media1];

    // Ensure durations are positive before proceeding
    if (shorterMedia.duration <= 0 || longerMedia.duration <= 0) return 0;

    const windowDuration = shorterMedia.duration;
    const stepSize =
      this.similarityConfig.stepSize > 0 ? this.similarityConfig.stepSize : 1; // Ensure stepSize is positive

    let bestSimilarity = 0;

    for (
      let startTime = 0;
      // Ensure loop condition prevents infinite loops if windowDuration is 0 or negative
      startTime <= longerMedia.duration - windowDuration && windowDuration > 0;
      startTime += stepSize
    ) {
      const endTime = startTime + windowDuration;

      const longerSubseq = this.getFramesInTimeRange(
        longerMedia,
        startTime,
        endTime,
      );
      const shorterSubseq = shorterMedia.frames;

      // Ensure subsequences are not empty before calculating similarity
      if (longerSubseq.length === 0 || shorterSubseq.length === 0) continue;

      const windowSimilarity = calculateSequenceSimilarityDTW( // Use imported function
        longerSubseq,
        shorterSubseq,
        this.wasmExports,
      );
      bestSimilarity = Math.max(bestSimilarity, windowSimilarity);

      // Early termination if we find a similarity over the threshold
      if (bestSimilarity >= this.similarityConfig.videoSimilarityThreshold)
        break;
    }

    return bestSimilarity;
  }

  private getFramesInTimeRange(
    media: MediaInfo,
    startTime: number,
    endTime: number,
  ): FrameInfo[] {
    // Filter out frames with missing hashes as well
    return media.frames.filter(
      (frame) =>
        frame?.hash &&
        frame.timestamp >= startTime &&
        frame.timestamp <= endTime,
    );
  }

  // calculateSequenceSimilarityDTW moved to comparatorUtils.ts

  private getAdaptiveThreshold(media1: MediaInfo, media2: MediaInfo): number {
    const isImage1 = media1.duration === 0;
    const isImage2 = media2.duration === 0;

    if (isImage1 && isImage2)
      return this.similarityConfig.imageSimilarityThreshold;
    if (isImage1 || isImage2)
      return this.similarityConfig.imageVideoSimilarityThreshold;
    return this.similarityConfig.videoSimilarityThreshold;
  }
}
