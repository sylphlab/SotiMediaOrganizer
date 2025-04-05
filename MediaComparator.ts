import {
  MediaInfo,
  DeduplicationResult,
  FileInfo,
  FrameInfo,
  SimilarityConfig,
  ProgramOptions,
  FileProcessor,
  WorkerData,
  // MaybePromise, // Removed unused import
} from "./src/types";
import { MediaProcessor } from "./src/MediaProcessor";
import { VPNode, VPTree } from "./VPTree";
import { filterAsync, mapAsync } from "./src/utils";
import { inject, injectable } from "inversify";
import { Types, type WorkerPool } from "./src/contexts/types";
import { readFile } from "fs/promises";
import { join } from "path";

// Define the expected exports from the WASM module
interface WasmExports {
  hammingDistanceSIMD(a: Uint8Array, b: Uint8Array): number;
  // Add other exports if needed, ensure memory is exported if using complex types
  memory: WebAssembly.Memory;
}

@injectable()
export class MediaComparator {
  private readonly minThreshold: number;
  private wasmExports: WasmExports | null = null;
  private wasmInitializationPromise: Promise<void> | null = null;

  constructor(
    private mediaProcessor: MediaProcessor,
    private similarityConfig: SimilarityConfig,
    private options: ProgramOptions,
    @inject(Types.WorkerPool) private workerPool: WorkerPool,
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

  private hammingDistance(
    hash1: SharedArrayBuffer,
    hash2: SharedArrayBuffer,
  ): number {
    // Use WASM implementation if available and loaded successfully
    // Note: We don't await the initialization promise here for performance.
    // If WASM isn't ready on the first few calls, it falls back to JS.
    // Subsequent calls will use WASM once it's loaded.
    if (this.wasmExports?.hammingDistanceSIMD) {
      try {
        // Pass Uint8Array views to the WASM function
        const view1 = new Uint8Array(hash1);
        const view2 = new Uint8Array(hash2);
        // Ensure the WASM function is called correctly.
        // AssemblyScript StaticArray<u8> maps to Uint8Array in JS.
        return this.wasmExports.hammingDistanceSIMD(view1, view2);
      } catch (wasmError) {
        console.error(
          "WASM hammingDistanceSIMD call failed, falling back to JS:",
          wasmError,
        );
        // Fall through to JS implementation if WASM call fails
      }
    }

    // Fallback to TypeScript implementation
    const view1_ts = new BigUint64Array(hash1);
    const view2_ts = new BigUint64Array(hash2);
    let distance_ts = 0n;

    // Process 64-bit chunks
    for (let i = 0; i < view1_ts.length; i++) {
      distance_ts += this.popcount64(view1_ts[i] ^ view2_ts[i]);
    }

    // Handle remaining bytes
    const remainingBytes_ts = hash1.byteLength % 8;
    if (remainingBytes_ts > 0) {
      const uint8View1_ts = new Uint8Array(hash1);
      const uint8View2_ts = new Uint8Array(hash2);
      const startIndex_ts = hash1.byteLength - remainingBytes_ts;

      for (let i = startIndex_ts; i < hash1.byteLength; i++) {
        distance_ts += BigInt(
          this.popcount8(uint8View1_ts[i] ^ uint8View2_ts[i]),
        );
      }
    }

    return Number(distance_ts);
  }

  private popcount64(n: bigint): bigint {
    n = n - ((n >> 1n) & 0x5555555555555555n);
    n = (n & 0x3333333333333333n) + ((n >> 2n) & 0x3333333333333333n);
    n = (n + (n >> 4n)) & 0x0f0f0f0f0f0f0f0fn;
    return (n * 0x0101010101010101n) >> 56n;
  }

  private popcount8(n: number): number {
    n = n - ((n >> 1) & 0x55);
    n = (n & 0x33) + ((n >> 2) & 0x33);
    return (n + (n >> 4)) & 0x0f;
  }

  async deduplicateFiles(
    files: string[],
    selector: FileProcessor,
    progressCallback?: (progress: string) => void,
  ): Promise<DeduplicationResult> {
    // Ensure WASM is loaded before proceeding with distance calculations if needed
    if (this.wasmInitializationPromise) {
      await this.wasmInitializationPromise;
    }

    progressCallback?.("Building VPTree");
    const vpTree = await VPTree.build(files, async (a, b) => {
      const [fileInfoA, fileInfoB] = await Promise.all([
        selector(a),
        selector(b),
      ]);
      // calculateSimilarity will now potentially use WASM hammingDistance
      return 1 - this.calculateSimilarity(fileInfoA.media, fileInfoB.media);
    });

    progressCallback?.("Running DBSCAN");
    const clusters = await this.parallelDBSCAN(files, vpTree, progressCallback);

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
          .performDBSCAN(
            <WorkerData>{
              root: vpTree.getRoot(), // Pass VPTree root node
              fileInfoCache: this.mediaProcessor.exportCache(), // Pass current cache
              options: this.options, // Pass program options
            },
            batch,
          )
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

    return this.mergeAndDeduplicate(results.flat());
  }

  private mergeAndDeduplicate(clusters: Set<string>[]): Set<string>[] {
    const merged: Set<string>[] = [];
    const elementToClusterMap = new Map<string, Set<string>>();

    for (const cluster of clusters) {
      const relatedClusters = new Set<Set<string>>();
      for (const element of cluster) {
        const existingCluster = elementToClusterMap.get(element);
        if (existingCluster) {
          relatedClusters.add(existingCluster);
        }
      }

      if (relatedClusters.size === 0) {
        merged.push(cluster);
        for (const element of cluster) {
          elementToClusterMap.set(element, cluster);
        }
      } else {
        const mergedCluster = new Set<string>(cluster);
        for (const relatedCluster of relatedClusters) {
          for (const element of relatedCluster) {
            mergedCluster.add(element);
          }
          // Remove the old cluster from merged list
          const indexToRemove = merged.indexOf(relatedCluster);
          if (indexToRemove > -1) {
            merged.splice(indexToRemove, 1);
          }
        }
        merged.push(mergedCluster);
        // Update map for all elements in the newly merged cluster
        for (const element of mergedCluster) {
          elementToClusterMap.set(element, mergedCluster);
        }
      }
    }

    return merged;
  }

  // This method is intended to be run inside a worker thread
  async workerDBSCAN(
    chunk: string[],
    vpTree: VPTree<string>,
  ): Promise<Set<string>[]> {
    const eps = 1 - this.minThreshold; // Epsilon based on min similarity
    const minPts = 2; // Minimum points to form a core point (including self)
    const clusters: Set<string>[] = [];
    const visited = new Set<string>(); // Track visited points within this worker's chunk

    for (const point of chunk) {
      if (visited.has(point)) continue;
      visited.add(point);

      // Find neighbors using VPTree and validate with adaptive threshold
      const neighbors = await this.getValidNeighbors(point, vpTree, eps);

      // If not enough neighbors, it's noise (or a single-element cluster for now)
      if (neighbors.length < minPts) {
        // Mark as noise or handle later during merge? For now, treat as single cluster.
        // clusters.push(new Set([point])); // Option 1: Treat as single cluster
        continue; // Option 2: Mark as noise (implicitly handled by not adding to any cluster)
      }

      // Expand cluster
      const currentCluster = new Set<string>();
      const queue = [...neighbors]; // Initialize queue with neighbors

      while (queue.length > 0) {
        const currentPoint = queue.shift()!; // Get next point from queue

        // If point hasn't been visited or added to a cluster yet
        if (!visited.has(currentPoint)) {
          visited.add(currentPoint);
          currentCluster.add(currentPoint);

          // Find neighbors of the current point
          const currentNeighbors = await this.getValidNeighbors(
            currentPoint,
            vpTree,
            eps,
          );

          // If it's a core point, add its neighbors to the queue
          if (currentNeighbors.length >= minPts) {
            for (const neighbor of currentNeighbors) {
              if (!visited.has(neighbor)) {
                // Add only unvisited neighbors
                queue.push(neighbor);
              }
            }
          }
        }
        // If point was visited but not yet part of any cluster (noise initially), add it
        // This handles border points correctly.
        // Note: This check might not be strictly necessary if noise points are ignored earlier.
        // else if (!elementToClusterMap.has(currentPoint)) { // Assuming elementToClusterMap is available or handled differently
        //    currentCluster.add(currentPoint);
        // }
      }

      // Add the formed cluster if it's not empty
      if (currentCluster.size > 0) {
        // Add the initial point if it wasn't added during expansion (can happen if it was visited early)
        if (!currentCluster.has(point)) {
          currentCluster.add(point);
        }
        clusters.push(currentCluster);
      } else if (!visited.has(point)) {
        // Handle the case where the initial point itself was noise but wasn't processed
        // clusters.push(new Set([point])); // Or ignore noise
      }
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
  ): Promise<string[]> {
    // Search VPTree for potential neighbors within epsilon distance
    const potentialNeighbors = await vpTree.search(point, {
      maxDistance: eps,
      sort: false, // No need to sort here
    });

    // Fetch FileInfo for the query point once
    const media1 = (await this.mediaProcessor.processFile(point)).media;

    // Filter potential neighbors based on the adaptive similarity threshold
    const validNeighbors = await filterAsync(
      potentialNeighbors,
      async (neighbor) => {
        // Don't compare a point to itself in the context of finding neighbors
        if (neighbor.point === point) return false;

        // Calculate actual similarity (1 - distance)
        const similarity = 1 - neighbor.distance;

        // Fetch FileInfo for the neighbor
        const media2 = (await this.mediaProcessor.processFile(neighbor.point))
          .media;

        // Get the specific threshold for this pair of media types
        const threshold = this.getAdaptiveThreshold(media1, media2);

        // Keep neighbor if similarity meets or exceeds the adaptive threshold
        return similarity >= threshold;
      },
    );

    // Return only the points (file paths) of the valid neighbors
    return validNeighbors.map((n) => n.point);
  }

  private async processResults(
    clusters: Set<string>[],
    selector: FileProcessor,
  ): Promise<DeduplicationResult> {
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
        const representatives = await this.selectRepresentatives(
          clusterArray,
          selector,
        );
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

    return { uniqueFiles, duplicateSets };
  }

  createVPTreeByRoot(root: VPNode<string>): VPTree<string> {
    // Recreate the distance function for the new VPTree instance
    const distanceFn = async (a: string, b: string): Promise<number> => {
      const [fileInfoA, fileInfoB] = await Promise.all([
        this.mediaProcessor.processFile(a),
        this.mediaProcessor.processFile(b),
      ]);
      return 1 - this.calculateSimilarity(fileInfoA.media, fileInfoB.media);
    };
    return new VPTree<string>(root, distanceFn);
  }

  private async selectRepresentatives(
    cluster: string[],
    selector: FileProcessor,
  ): Promise<string[]> {
    if (cluster.length <= 1) return cluster;

    const sortedEntries = await this.scoreEntries(cluster, selector);
    const bestEntry = sortedEntries[0];
    const bestFileInfo = await selector(bestEntry);

    // If the best entry is an image, only return that image.
    if (bestFileInfo.media.duration === 0) {
      return [bestEntry];
    } else {
      // If the best entry is a video, handle potential high-quality image captures within the cluster.
      return this.handleMultiFrameBest(sortedEntries, selector);
    }
  }

  private getQuality(fileInfo: FileInfo): number {
    // Use optional chaining and provide default 0 if width/height are missing
    return (fileInfo.metadata.width ?? 0) * (fileInfo.metadata.height ?? 0);
  }

  private async handleMultiFrameBest(
    sortedEntries: string[],
    selector: FileProcessor,
  ): Promise<string[]> {
    const bestEntry = sortedEntries[0]; // This is guaranteed to be a video based on caller logic
    const bestFileInfo = await selector(bestEntry);
    const representatives: string[] = [bestEntry]; // Start with the best video

    // Find potential high-quality image captures within the same cluster
    const potentialCaptures = await filterAsync(
      sortedEntries.slice(1), // Exclude the best video itself
      async (entry) => {
        const fileInfo = await selector(entry);
        // Check if it's an image, has comparable or better quality, and has date info if the video does
        return (
          fileInfo.media.duration === 0 &&
          this.getQuality(fileInfo) >= this.getQuality(bestFileInfo) &&
          (!bestFileInfo.metadata.imageDate || !!fileInfo.metadata.imageDate)
        );
      },
    );

    // If high-quality image captures exist, deduplicate them among themselves
    if (potentialCaptures.length > 0) {
      // Need a temporary comparator instance or pass necessary config/methods if running this outside main flow
      // For simplicity here, assume we can call deduplicateFiles recursively (might need adjustment)
      // This recursive call needs careful handling to avoid infinite loops if logic isn't strict.
      // A safer approach might be to just compare these images pairwise.
      // Let's simplify: just compare pairwise for now.
      const uniqueCaptures = new Set<string>();
      const processedCaptures = new Set<string>();

      for (const capture1 of potentialCaptures) {
        if (processedCaptures.has(capture1)) continue;

        let isDuplicate = false;
        for (const capture2 of uniqueCaptures) {
          const info1 = await selector(capture1);
          const info2 = await selector(capture2);
          const similarity = this.calculateImageSimilarity(
            info1.media.frames[0],
            info2.media.frames[0],
          );
          if (similarity >= this.similarityConfig.imageSimilarityThreshold) {
            isDuplicate = true;
            // Keep the one with the higher score (already sorted by score)
            processedCaptures.add(capture1);
            break;
          }
        }

        if (!isDuplicate) {
          uniqueCaptures.add(capture1);
          processedCaptures.add(capture1);
        }
      }

      representatives.push(...uniqueCaptures);
    }

    return representatives;
  }

  private async scoreEntries(
    entries: string[],
    selector: FileProcessor,
  ): Promise<string[]> {
    // Map entries to { entry, score } objects
    const scoredEntries = await mapAsync(entries, async (entry) => ({
      entry,
      score: this.calculateEntryScore(await selector(entry)),
    }));

    // Sort by score descending
    scoredEntries.sort((a, b) => b.score - a.score);

    // Return just the sorted entry paths
    return scoredEntries.map((scored) => scored.entry);
  }

  // Public for potential use in DebugReporter
  calculateEntryScore(fileInfo: FileInfo): number {
    let score = 0;

    // Prioritize videos slightly
    if (fileInfo.media.duration > 0) {
      score += 10000;
    }

    // Add score based on duration (log scale)
    score += Math.log(fileInfo.media.duration + 1) * 100;

    // Add score for metadata completeness
    if (fileInfo.metadata.imageDate) score += 2000;
    if (fileInfo.metadata.gpsLatitude && fileInfo.metadata.gpsLongitude)
      score += 300;
    if (fileInfo.metadata.cameraModel) score += 200;

    // Add score based on resolution (sqrt scale)
    if (fileInfo.metadata.width && fileInfo.metadata.height) {
      score += Math.sqrt(fileInfo.metadata.width * fileInfo.metadata.height);
    }

    // Add score based on file size (log scale)
    score += Math.log(fileInfo.fileStats.size + 1) * 5; // Add 1 to avoid log(0)

    return score;
  }

  calculateSimilarity(media1: MediaInfo, media2: MediaInfo): number {
    const isImage1 = media1.duration === 0;
    const isImage2 = media2.duration === 0;

    if (isImage1 && isImage2) {
      return this.calculateImageSimilarity(media1.frames[0], media2.frames[0]);
    } else if (isImage1 || isImage2) {
      return this.calculateImageVideoSimilarity(
        isImage1 ? media1 : media2,
        isImage1 ? media2 : media1,
      );
    } else {
      return this.calculateVideoSimilarity(media1, media2);
    }
  }

  private calculateImageSimilarity(
    frame1: FrameInfo,
    frame2: FrameInfo,
  ): number {
    if (!frame1?.hash || !frame2?.hash) return 0; // Guard against missing hashes
    const distance = this.hammingDistance(frame1.hash, frame2.hash);
    const maxDistance = frame1.hash.byteLength * 8;
    if (maxDistance === 0) return 1; // Avoid division by zero if hash length is 0
    return 1 - distance / maxDistance;
  }

  private calculateImageVideoSimilarity(
    image: MediaInfo,
    video: MediaInfo,
  ): number {
    if (
      image.frames.length === 0 ||
      video.frames.length === 0 ||
      !image.frames[0]?.hash
    ) {
      return 0; // Return 0 similarity if either has no frames or image hash is missing
    }

    const imageFrame = image.frames[0];
    let bestSimilarity = 0;

    for (const videoFrame of video.frames) {
      if (!videoFrame?.hash) continue; // Skip frames with missing hashes
      const similarity = this.calculateImageSimilarity(imageFrame, videoFrame);

      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;

        // Early exit if we find a similarity above the threshold
        if (
          bestSimilarity >= this.similarityConfig.imageVideoSimilarityThreshold
        ) {
          return bestSimilarity;
        }
      }
    }

    return bestSimilarity;
  }

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

      const windowSimilarity = this.calculateSequenceSimilarityDTW(
        longerSubseq,
        shorterSubseq,
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

  private calculateSequenceSimilarityDTW(
    seq1: FrameInfo[],
    seq2: FrameInfo[],
  ): number {
    const m = seq1.length;
    const n = seq2.length;
    if (m === 0 || n === 0) return 0; // Return 0 if either sequence is empty

    const dtw: number[] = new Array(n + 1).fill(Infinity);
    dtw[0] = 0;

    for (let i = 1; i <= m; i++) {
      let prev = dtw[0];
      dtw[0] = Infinity; // Reset start of row
      for (let j = 1; j <= n; j++) {
        const temp = dtw[j];
        // Cost is 1 - similarity (distance)
        const cost =
          1 - this.calculateImageSimilarity(seq1[i - 1], seq2[j - 1]);
        // Ensure cost is non-negative
        const nonNegativeCost = Math.max(0, cost);
        dtw[j] = nonNegativeCost + Math.min(prev, dtw[j], dtw[j - 1]);
        prev = temp;
      }
    }

    const maxLen = Math.max(m, n);
    if (maxLen === 0) return 1; // Perfect similarity if both sequences are empty? Or 0? Let's say 1.

    // Normalized distance: DTW cost / max path length (heuristic)
    const normalizedDistance = dtw[n] / maxLen;
    // Return similarity: 1 - normalized distance
    return Math.max(0, 1 - normalizedDistance); // Ensure similarity is not negative
  }

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
