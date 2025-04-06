import {
  MediaInfo,
  DeduplicationResult,
  FileInfo,
  // FrameInfo, // Removed unused import
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
import { ok, err, AppResult, AppError } from "./src/errors"; // Removed unused AnyAppError, UnknownError
import {
  calculateImageSimilarity,
  calculateImageVideoSimilarity, // Keep this import
  // calculateSequenceSimilarityDTW, // Removed unused import
  getAdaptiveThreshold, // Keep this import
  sortEntriesByScore, // Keep this import
  selectRepresentativesFromScored, // Keep this import
  mergeAndDeduplicateClusters, // Keep this import
  runDbscanCore, // Keep this import
  // Import the newly moved functions
  calculateVideoSimilarity, // Keep this import
  // getFramesInTimeRange, // Removed unused import
} from "./src/comparatorUtils"; // Import runDbscanCore, Removed expandCluster
// Removed inversify imports
import { type WorkerPool } from "./src/contexts/types"; // Removed unused Types import
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
    private workerPool: WorkerPool // Removed @inject() - WorkerPool might still be needed for pHash
  ) {
    this.minThreshold = Math.min(
      this.similarityConfig.imageSimilarityThreshold,
      this.similarityConfig.imageVideoSimilarityThreshold,
      this.similarityConfig.videoSimilarityThreshold
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
            columnNumber: number
          ) => {
            // In a real app, you might want to decode the message/filename pointers
            // using the WASM memory, but for now, just throw an error.
            throw new Error(
              `WASM aborted: msg=${message} file=${fileName} L${lineNumber} C${columnNumber}`
            );
          },
          // Add other required env functions if any
        },
      });
      this.wasmExports = wasmModule.instance.exports as unknown as WasmExports;

      // Verify the expected function exists
      if (typeof this.wasmExports.hammingDistanceSIMD !== "function") {
        console.warn(
          "WASM loaded but hammingDistanceSIMD function not found. Falling back to JS."
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
    progressCallback?: (progress: string) => void
  ): Promise<AppResult<DeduplicationResult>> {
    // Update return type
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
      // TODO: Refactor VPTree to handle AppResult<number> from distance function
      if (resultA.isErr()) {
        console.error(
          `[VPTree Build] Error processing file ${a} for distance calculation, using Infinity distance:`,
          resultA.error
        );
        return Infinity; // Return max distance on error
      }
      if (resultB.isErr()) {
        console.error(
          `[VPTree Build] Error processing file ${b} for distance calculation, using Infinity distance:`,
          resultB.error
        );
        return Infinity; // Return max distance on error
      }

      // Unwrap successful results
      const fileInfoA = resultA.value;
      const fileInfoB = resultB.value;
      // calculateSimilarity will now potentially use WASM hammingDistance
      return 1 - this.calculateSimilarity(fileInfoA.media, fileInfoB.media);
    });

    progressCallback?.("Running DBSCAN");
    // Call the refactored single-threaded DBSCAN method
    const clusters = await this.dbscanClusters(files, vpTree, progressCallback);

    // processResults now returns AppResult, so we can return it directly
    return this.processResults(clusters, selector);
  }

  // Refactored DBSCAN to run on main thread using the utility function
  // Removed parallelization via worker pool for DBSCAN itself
  public async dbscanClusters(
    // Renamed from parallelDBSCAN
    files: string[],
    vpTree: VPTree<string>,
    progressCallback?: (progress: string) => void // Progress callback might need adjustment
  ): Promise<Set<string>[]> {
    const eps = 1 - this.minThreshold;
    const minPts = 2; // Or get from config

    // Define the neighbor fetching function directly here
    const getNeighborsFn = (p: string): Promise<AppResult<string[]>> => {
      // This still uses 'this' for dependencies, which is acceptable now
      // as it runs on the main thread context.
      // Call static method and pass dependencies
      return MediaComparator.getValidNeighbors(
        p,
        vpTree,
        eps,
        this.fileProcessorConfig,
        this.cache,
        this.exifTool,
        this.workerPool,
        this.similarityConfig
      );
    };

    // TODO: Add progress reporting if needed for single-threaded DBSCAN
    progressCallback?.(`Running DBSCAN on ${files.length} files...`);

    // Call the core DBSCAN logic directly
    const clusters = await runDbscanCore(files, eps, minPts, getNeighborsFn);

    progressCallback?.(`DBSCAN finished, found ${clusters.length} clusters.`);

    // Merging is likely not needed if run single-threaded, but keep for now
    return mergeAndDeduplicateClusters(clusters);
  }

  // Removed mergeAndDeduplicate method (moved to comparatorUtils)

  // Removed workerDBSCAN method (logic moved to runDbscanCore in comparatorUtils)

  // Made public and static (or move to utils) as it no longer relies on 'this' instance state
  // except for dependencies which are now passed in.
  public static async getValidNeighbors(
    // Changed to static, added dependencies
    point: string,
    vpTree: VPTree<string>,
    eps: number,
    // Dependencies passed as arguments:
    fileProcessorConfig: FileProcessorConfig,
    cache: LmdbCache,
    exifTool: ExifTool,
    workerPool: WorkerPool,
    similarityConfig: SimilarityConfig
  ): Promise<AppResult<string[]>> {
    // Search VPTree for potential neighbors within epsilon distance
    const potentialNeighbors = await vpTree.search(point, {
      maxDistance: eps,
      sort: false, // No need to sort here
    });

    // Fetch FileInfo for the query point once
    // Fetch FileInfo using the new functional approach
    const fileInfo1Result = await processSingleFile(
      point,
      fileProcessorConfig,
      cache,
      exifTool,
      workerPool
    ); // Use passed args
    if (fileInfo1Result.isErr()) {
      console.error(
        `Error processing file ${point} in getValidNeighbors: ${fileInfo1Result.error.message}`
      );
      // Cannot proceed without file info, return error or empty array? Returning error.
      return err(
        new AppError(
          `Failed to get FileInfo for ${point} in getValidNeighbors`,
          { cause: fileInfo1Result.error } // Use cause
        )
      ); // Keep AppError for now
    }
    const fileInfo1 = fileInfo1Result.value; // Unwrap
    const media1 = fileInfo1.media;

    // Filter potential neighbors based on the adaptive similarity threshold
    const validNeighbors = await filterAsync(
      potentialNeighbors,
      async (neighbor): Promise<AppResult<boolean>> => {
        // Callback returns AppResult
        // Don't compare a point to itself in the context of finding neighbors
        if (neighbor.point === point) return ok(false);

        // Calculate actual similarity (1 - distance)
        const similarity = 1 - neighbor.distance;

        // Fetch FileInfo for the neighbor using the new functional approach
        const fileInfo2Result = await processSingleFile(
          neighbor.point,
          fileProcessorConfig,
          cache,
          exifTool,
          workerPool
        ); // Use passed args
        if (fileInfo2Result.isErr()) {
          console.error(
            `Error processing neighbor file ${neighbor.point} in getValidNeighbors: ${fileInfo2Result.error.message}`
          );
          // Treat as non-valid neighbor if processing fails
          return ok(false);
        }
        const fileInfo2 = fileInfo2Result.value; // Unwrap
        const media2 = fileInfo2.media;

        // Get the specific threshold for this pair of media types
        const threshold = getAdaptiveThreshold(
          media1,
          media2,
          similarityConfig
        ); // Use passed arg

        // Keep neighbor if similarity meets or exceeds the adaptive threshold
        return ok(similarity >= threshold);
      }
    );

    // Handle the result of filterAsync
    if (validNeighbors.isErr()) {
      return err(validNeighbors.error); // Propagate error
    }

    // Return only the points (file paths) of the valid neighbors
    // Unwrap the value before mapping
    return ok(validNeighbors.value.map((n) => n.point));
  }

  public async processResults(
    // Changed to public
    clusters: Set<string>[],
    selector: FileProcessor
  ): Promise<AppResult<DeduplicationResult>> {
    // Update return type
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
          selector
        );

        if (representativesResult.isErr()) {
          // Decide how to handle error - log and skip cluster? Propagate?
          console.error(
            `Error selecting representatives for cluster: ${representativesResult.error.message}`,
            clusterArray
          );
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
            clusterArray.filter((f) => !representativeSet.has(f))
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
        processSingleFile(
          a,
          this.fileProcessorConfig,
          this.cache,
          this.exifTool,
          this.workerPool
        ), // Use processSingleFile directly
        processSingleFile(
          b,
          this.fileProcessorConfig,
          this.cache,
          this.exifTool,
          this.workerPool
        ),
      ]);
      // Check for errors (similar to the VPTree build distance function)
      // TODO: Refactor VPTree to handle AppResult<number> from distance function
      if (resA.isErr()) {
        console.error(
          `[VPTree Recreate] Error processing file ${a} for distance calculation, using Infinity distance:`,
          resA.error
        );
        return Infinity;
      }
      if (resB.isErr()) {
        console.error(
          `[VPTree Recreate] Error processing file ${b} for distance calculation, using Infinity distance:`,
          resB.error
        );
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
    selector: FileProcessor
  ): Promise<AppResult<string[]>> {
    // Update return type
    if (cluster.length <= 1) return ok(cluster); // Wrap base case in ok()

    // Fetch FileInfo for all entries concurrently
    const entriesWithInfoResult = await mapAsync(
      cluster,
      async (
        entry
      ): Promise<AppResult<{ entry: string; fileInfo: FileInfo }>> => {
        const fileInfoResult = await selector(entry); // selector returns AppResult<FileInfo>
        if (fileInfoResult.isErr()) {
          // Propagate error if file processing fails
          return err(
            new AppError(
              `Failed processing ${entry} in selectRepresentatives`,
              { cause: fileInfoResult.error } // Use cause
            )
          );
        }
        return ok({ entry, fileInfo: fileInfoResult.value }); // Return Ok result
      }
    );

    if (entriesWithInfoResult.isErr()) {
      return err(entriesWithInfoResult.error); // Propagate error
    }
    const entriesWithInfo: { entry: string; fileInfo: FileInfo }[] =
      entriesWithInfoResult.value; // Unwrap with explicit type

    // Score and sort using the utility function
    const sortedScoredEntries = sortEntriesByScore(entriesWithInfo); // Use imported function

    // Select representatives using the utility function
    // Need to map sortedScoredEntries back to { entry, fileInfo } format expected by selectRepresentativesFromScored
    const sortedEntriesWithInfo = sortedScoredEntries
      .map((scored) => {
        // entriesWithInfo is now guaranteed to be an array here
        const original = entriesWithInfo.find((e) => e.entry === scored.entry);
        // Add a check for safety instead of non-null assertion
        if (!original) {
          console.error(
            `Could not find original entry info for ${scored.entry} during representative selection.`
          );
          // Decide how to handle - skip this entry? return error?
          // For now, filter it out later if fileInfo is needed and missing.
          return { entry: scored.entry, fileInfo: null }; // Indicate missing info
        }
        return { entry: scored.entry, fileInfo: original.fileInfo };
      })
      .filter((e) => e.fileInfo !== null) as {
      entry: string;
      fileInfo: FileInfo;
    }[]; // Filter out entries where original wasn't found and cast back

    // selectRepresentativesFromScored likely doesn't return AppResult yet, wrap if needed
    // Assuming it returns string[] for now
    // selectRepresentativesFromScored is deterministic based on input, no try/catch needed here.
    const representatives = selectRepresentativesFromScored(
      sortedEntriesWithInfo,
      this.similarityConfig,
      this.wasmExports
    );
    return ok(representatives);
  }

  // getQuality moved to comparatorUtils.ts

  // handleMultiFrameBest logic moved into selectRepresentativesFromScored in comparatorUtils.ts

  private async scoreEntries(
    entries: string[],
    selector: FileProcessor
  ): Promise<AppResult<string[]>> {
    // Update return type
    // Fetch FileInfo for all entries concurrently
    const entriesWithInfoResult = await mapAsync(
      entries,
      async (
        entry
      ): Promise<AppResult<{ entry: string; fileInfo: FileInfo }>> => {
        const fileInfoResult = await selector(entry); // selector returns AppResult<FileInfo>
        if (fileInfoResult.isErr()) {
          // Propagate error if file processing fails
          return err(
            new AppError(`Failed processing ${entry} in scoreEntries`, {
              cause: fileInfoResult.error, // Use cause
            })
          );
        }
        return ok({ entry, fileInfo: fileInfoResult.value }); // Return Ok result
      }
    );

    if (entriesWithInfoResult.isErr()) {
      return err(entriesWithInfoResult.error); // Propagate error
    }
    const entriesWithInfo: { entry: string; fileInfo: FileInfo }[] =
      entriesWithInfoResult.value; // Unwrap with explicit type

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
      return calculateImageSimilarity(
        media1.frames[0],
        media2.frames[0],
        this.wasmExports
      ); // Use imported function
    } else if (isImage1 || isImage2) {
      return calculateImageVideoSimilarity(
        // Use imported function
        isImage1 ? media1 : media2,
        isImage1 ? media2 : media1,
        this.similarityConfig,
        this.wasmExports
      );
    } else {
      // Call the imported function
      return calculateVideoSimilarity(
        media1,
        media2,
        this.similarityConfig,
        this.wasmExports
      );
    }
  }

  // calculateImageSimilarity moved to comparatorUtils.ts

  // calculateImageVideoSimilarity moved to comparatorUtils.ts

  // calculateVideoSimilarity moved to comparatorUtils.ts
  // getFramesInTimeRange moved to comparatorUtils.ts

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
