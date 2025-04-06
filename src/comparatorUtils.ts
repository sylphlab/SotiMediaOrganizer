import {
  FileInfo,
  FrameInfo,
  MediaInfo,
  SimilarityConfig,
  WasmExports,
} from "./types";
import { AppResult, ok, err, AppError } from "./errors"; // Added AppResult imports

// Popcount for 8-bit numbers
export function popcount8(n: number): number {
  n = n - ((n >> 1) & 0x55);
  n = (n & 0x33) + ((n >> 2) & 0x33);
  return (n + (n >> 4)) & 0x0f;
}

// Popcount for 64-bit BigInts
export function popcount64(n: bigint): bigint {
  // More standard and verified popcount algorithm for 64-bit BigInt
  n = n - ((n >> 1n) & 0x5555555555555555n);
  n = (n & 0x3333333333333333n) + ((n >> 2n) & 0x3333333333333333n);
  n = (n + (n >> 4n)) & 0x0f0f0f0f0f0f0f0fn;
  n = n + (n >> 8n);
  n = n + (n >> 16n);
  n = n + (n >> 32n);
  return n & 0x7fn; // Mask to get the final count (max 64)
}

/**
 * Calculates the Hamming distance between two perceptual hashes.
 * Uses WASM SIMD implementation if provided and available, otherwise falls back to JS.
 * @param hash1 First hash (SharedArrayBuffer).
 * @param hash2 Second hash (SharedArrayBuffer).
 * @param wasmExports Optional WASM exports object containing hammingDistanceSIMD.
 * @returns The Hamming distance.
 */
export function hammingDistance(
  hash1: SharedArrayBuffer,
  hash2: SharedArrayBuffer,
  wasmExports: WasmExports | null,
): number {
  // Use WASM implementation if available
  if (wasmExports?.hammingDistanceSIMD) {
    try {
      const view1 = new Uint8Array(hash1);
      const view2 = new Uint8Array(hash2);
      return wasmExports.hammingDistanceSIMD(view1, view2);
    } catch (wasmError) {
      console.error(
        "WASM hammingDistanceSIMD call failed, falling back to JS:",
        wasmError,
      );
      // Fall through to JS implementation if WASM call fails
    }
  }

  // Fallback to TypeScript implementation
  const len1 = hash1.byteLength;
  const len2 = hash2.byteLength;
  const minLen = Math.min(len1, len2);
  // const maxLen = Math.max(len1, len2); // Removed unused variable
  let distance_ts = 0n;

  // Process full 64-bit chunks common to both arrays
  const commonChunks = Math.floor(minLen / 8);
  if (commonChunks > 0) {
    // Directly use the SharedArrayBuffer, specify byteOffset 0 and length in elements
    const view1_ts = new BigUint64Array(hash1, 0, commonChunks);
    const view2_ts = new BigUint64Array(hash2, 0, commonChunks);
    for (let i = 0; i < commonChunks; i++) {
      distance_ts += popcount64(view1_ts[i] ^ view2_ts[i]);
    }
  }

  // Process remaining bytes
  const uint8View1_ts = new Uint8Array(hash1);
  const uint8View2_ts = new Uint8Array(hash2);
  const startByteIndex = commonChunks * 8;

  // Compare remaining common bytes
  for (let i = startByteIndex; i < minLen; i++) {
    distance_ts += BigInt(popcount8(uint8View1_ts[i] ^ uint8View2_ts[i]));
  }

  // Add bits from the longer hash's remaining bytes (compared against 0)
  if (len1 > len2) {
    for (let i = minLen; i < len1; i++) {
      distance_ts += BigInt(popcount8(uint8View1_ts[i]));
    }
  } else if (len2 > len1) {
    for (let i = minLen; i < len2; i++) {
      distance_ts += BigInt(popcount8(uint8View2_ts[i]));
    }
  }

  return Number(distance_ts);
}

/**
 * Calculates the similarity between two image frames based on Hamming distance.
 * @param frame1 First frame info.
 * @param frame2 Second frame info.
 * @param wasmExports Optional WASM exports for hamming distance calculation.
 * @returns Similarity score (0 to 1).
 */
export function calculateImageSimilarity(
  frame1: FrameInfo,
  frame2: FrameInfo,
  wasmExports: WasmExports | null,
): number {
  if (!frame1?.hash || !frame2?.hash) return 0; // Guard against missing hashes
  const distance = hammingDistance(frame1.hash, frame2.hash, wasmExports);
  const maxDistance = frame1.hash.byteLength * 8;
  if (maxDistance === 0) return 1; // Avoid division by zero if hash length is 0
  // Ensure similarity is not negative due to potential floating point issues
  return Math.max(0, 1 - distance / maxDistance);
}

/**
 * Calculates the best similarity between an image and any frame of a video.
 * @param image Image media info.
 * @param video Video media info.
 * @param similarityConfig Configuration containing the image-video similarity threshold.
 * @param wasmExports Optional WASM exports for hamming distance calculation.
 * @returns The best similarity score found (0 to 1).
 */
export function calculateImageVideoSimilarity(
  image: MediaInfo,
  video: MediaInfo,
  similarityConfig: Pick<SimilarityConfig, "imageVideoSimilarityThreshold">, // Only need the relevant threshold
  wasmExports: WasmExports | null,
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
    const similarity = calculateImageSimilarity(
      imageFrame,
      videoFrame,
      wasmExports,
    );

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;

      // Early exit only if we find a perfect match
      if (bestSimilarity === 1.0) {
        return bestSimilarity;
      }
    }
  }

  return bestSimilarity;
}

/**
 * Calculates the similarity between two sequences of frames using Dynamic Time Warping (DTW).
 * @param seq1 First sequence of FrameInfo.
 * @param seq2 Second sequence of FrameInfo.
 * @param wasmExports Optional WASM exports for hamming distance calculation.
 * @returns Similarity score (0 to 1).
 */
export function calculateSequenceSimilarityDTW(
  seq1: FrameInfo[],
  seq2: FrameInfo[],
  wasmExports: WasmExports | null,
): number {
  const m = seq1.length;
  const n = seq2.length;
  if (m === 0 && n === 0) return 1; // Perfect similarity if both empty
  if (m === 0 || n === 0) return 0; // Zero similarity if only one is empty

  // Use a 1D array to optimize space for DTW cost matrix (only need previous row)
  const dtw: number[] = new Array(n + 1).fill(Infinity);
  dtw[0] = 0;

  for (let i = 1; i <= m; i++) {
    let prev = dtw[0]; // Store value from top-left (dtw[i-1][j-1])
    dtw[0] = Infinity; // Start of new row calculation

    for (let j = 1; j <= n; j++) {
      const temp = dtw[j]; // Store value from top (dtw[i-1][j]) before overwriting

      // Cost is 1 - similarity (distance) between current frames
      const cost =
        1 - calculateImageSimilarity(seq1[i - 1], seq2[j - 1], wasmExports);
      // Ensure cost is non-negative
      const nonNegativeCost = Math.max(0, cost);

      // Update DTW cost: cost of current match + minimum cost from previous states
      dtw[j] =
        nonNegativeCost +
        Math.min(
          prev, // Cost from diagonal (dtw[i-1][j-1])
          dtw[j], // Cost from top (dtw[i-1][j])
          dtw[j - 1], // Cost from left (dtw[i][j-1])
        );

      prev = temp; // Update prev for the next iteration (becomes dtw[i-1][j])
    }
  }

  const maxLen = Math.max(m, n);
  if (maxLen === 0) return 1; // Perfect similarity if both sequences were initially empty

  // Normalized distance: DTW cost / max path length (heuristic, assumes path length is approx maxLen)
  // A better normalization might be needed depending on the exact DTW path constraints used.
  const normalizedDistance = dtw[n] / maxLen;

  // Return similarity: 1 - normalized distance
  return Math.max(0, 1 - normalizedDistance); // Ensure similarity is not negative
}

// Removed duplicate import

/**
 * Calculates a quality/completeness score for a FileInfo object.
 * Used to select the best representative from a cluster of duplicates.
 * @param fileInfo The FileInfo object to score.
 * @returns A numerical score.
 */
export function calculateEntryScore(fileInfo: FileInfo): number {
  let score = 0;

  // Prioritize videos slightly
  if (fileInfo.media.duration > 0) {
    score += 10000;
  }

  // Add score based on duration (log scale)
  // Add 1 to avoid log(0) or log of negative if duration is somehow negative
  score += Math.log(Math.max(1, fileInfo.media.duration + 1)) * 100;

  // Add score for metadata completeness
  if (fileInfo.metadata.imageDate) score += 2000;
  if (fileInfo.metadata.gpsLatitude && fileInfo.metadata.gpsLongitude)
    score += 300;
  if (fileInfo.metadata.cameraModel) score += 200;

  // Add score based on resolution (sqrt scale)
  const width = fileInfo.metadata.width ?? 0;
  const height = fileInfo.metadata.height ?? 0;
  if (width > 0 && height > 0) {
    score += Math.sqrt(width * height);
  }

  // Add score based on file size (log scale)
  // Add 1 to avoid log(0)
  score += Math.log(fileInfo.fileStats.size + 1) * 5;

  return score;
}

/**
 * Gets the appropriate similarity threshold based on the types of the two media items.
 * @param media1 First media info.
 * @param media2 Second media info.
 * @param similarityConfig Configuration containing the different thresholds.
 * @returns The similarity threshold (0 to 1).
 */
export function getAdaptiveThreshold(
  media1: MediaInfo,
  media2: MediaInfo,
  similarityConfig: Pick<
    SimilarityConfig,
    | "imageSimilarityThreshold"
    | "imageVideoSimilarityThreshold"
    | "videoSimilarityThreshold"
  >,
): number {
  const isImage1 = media1.duration === 0;
  const isImage2 = media2.duration === 0;

  if (isImage1 && isImage2) return similarityConfig.imageSimilarityThreshold;
  if (isImage1 || isImage2)
    return similarityConfig.imageVideoSimilarityThreshold;
  return similarityConfig.videoSimilarityThreshold;
}

// Removed duplicate import

/**
 * Calculates a simple quality metric based on resolution.
 * @param fileInfo The FileInfo object.
 * @returns The resolution (width * height) or 0 if dimensions are missing.
 */
export function getQuality(fileInfo: FileInfo): number {
  // Use optional chaining and provide default 0 if width/height are missing
  return (fileInfo.metadata.width ?? 0) * (fileInfo.metadata.height ?? 0);
}

/**
 * Scores and sorts file entries based on their FileInfo.
 * @param entriesWithInfo Array of objects containing file path and its corresponding FileInfo.
 * @returns A sorted array of objects containing file path and score, sorted descending by score.
 */
export function sortEntriesByScore(
  entriesWithInfo: { entry: string; fileInfo: FileInfo }[],
): { entry: string; score: number }[] {
  const scoredEntries = entriesWithInfo.map(({ entry, fileInfo }) => ({
    entry,
    score: calculateEntryScore(fileInfo), // Use already extracted function
  }));

  // Sort by score descending
  scoredEntries.sort((a, b) => b.score - a.score);

  return scoredEntries;
}

/**
 * Selects unique, high-quality image captures from a list of potential captures,
 * comparing them against a reference video's quality and against each other for similarity.
 * Assumes potentialCaptures are pre-sorted by score (descending) if score-based tie-breaking is desired.
 * @param potentialCaptures Array of objects containing image file paths and their FileInfo.
 * @param bestVideoInfo FileInfo of the highest-scoring video in the cluster.
 * @param similarityConfig Configuration containing the image similarity threshold.
 * @param wasmExports Optional WASM exports for hamming distance calculation.
 * @returns An array of file paths for the unique, high-quality image captures.
 */
export function selectRepresentativeCaptures(
  potentialCaptures: { entry: string; fileInfo: FileInfo }[],
  bestVideoInfo: FileInfo,
  similarityConfig: Pick<SimilarityConfig, "imageSimilarityThreshold">,
  wasmExports: WasmExports | null,
): string[] {
  const uniqueCaptures = new Set<string>();
  const processedCaptures = new Set<string>(); // Keep track of processed captures to avoid redundant comparisons

  // Filter for high-quality captures first
  const highQualityCaptures = potentialCaptures.filter(
    ({ fileInfo }) =>
      fileInfo.media.duration === 0 && // Is an image
      getQuality(fileInfo) >= getQuality(bestVideoInfo) && // Comparable or better quality
      (!bestVideoInfo.metadata.imageDate || !!fileInfo.metadata.imageDate), // Has date if video has date
  );

  // Assumes highQualityCaptures are sorted by score descending by the caller (scoreEntries)

  for (const { entry: capture1, fileInfo: info1 } of highQualityCaptures) {
    if (processedCaptures.has(capture1)) continue;
    // Skip captures that don't have a hash for comparison
    if (!info1.media.frames[0]?.hash) {
      processedCaptures.add(capture1); // Mark as processed (cannot be compared or selected)
      continue;
    }

    let isDuplicate = false;
    // Compare against already selected unique captures
    for (const capture2 of uniqueCaptures) {
      // Find FileInfo for capture2 within highQualityCaptures
      const capture2Data = highQualityCaptures.find(
        (c) => c.entry === capture2,
      );
      if (!capture2Data) continue; // Should not happen
      const info2 = capture2Data.fileInfo;

      // Ensure both frames exist before comparing
      if (!info1.media.frames[0]?.hash || !info2.media.frames[0]?.hash)
        continue;

      const similarity = calculateImageSimilarity(
        info1.media.frames[0],
        info2.media.frames[0],
        wasmExports,
      );
      if (similarity >= similarityConfig.imageSimilarityThreshold) {
        isDuplicate = true;
        processedCaptures.add(capture1); // Mark as processed (duplicate of an existing unique capture)
        break;
      }
    }

    if (!isDuplicate) {
      uniqueCaptures.add(capture1);
      processedCaptures.add(capture1); // Mark as processed (added as unique)
    }
  }

  return Array.from(uniqueCaptures);
}

/**
 * Selects representative file(s) from a cluster of already scored and sorted entries.
 * Handles the logic for choosing between a single best image or a best video plus unique high-quality captures.
 * @param sortedEntriesWithInfo Array of objects { entry: string, fileInfo: FileInfo }, pre-sorted descending by score.
 * @param similarityConfig Configuration containing the image similarity threshold.
 * @param wasmExports Optional WASM exports for hamming distance calculation.
 * @returns An array of file paths for the selected representative(s).
 */
export function selectRepresentativesFromScored(
  sortedEntriesWithInfo: { entry: string; fileInfo: FileInfo }[],
  similarityConfig: Pick<SimilarityConfig, "imageSimilarityThreshold">,
  wasmExports: WasmExports | null,
): string[] {
  if (!sortedEntriesWithInfo || sortedEntriesWithInfo.length === 0) return [];
  if (sortedEntriesWithInfo.length === 1)
    return [sortedEntriesWithInfo[0].entry];

  const bestEntryData = sortedEntriesWithInfo[0];
  const bestEntry = bestEntryData.entry;
  const bestFileInfo = bestEntryData.fileInfo;

  // If the best entry is an image, only return that image.
  if (bestFileInfo.media.duration === 0) {
    return [bestEntry];
  } else {
    // If the best entry is a video, select unique high-quality captures from the rest
    const potentialCapturesWithInfo = sortedEntriesWithInfo.slice(1);
    const uniqueImageCaptures = selectRepresentativeCaptures(
      potentialCapturesWithInfo,
      bestFileInfo,
      similarityConfig,
      wasmExports,
    );
    // Combine the best video with the selected unique image captures
    return [bestEntry, ...uniqueImageCaptures];
  }
}

/**
 * Selects unique, high-quality image captures from a list of potential captures,
 * comparing them against a reference video's quality and against each other for similarity.
 * Assumes potentialCaptures are pre-sorted by score (descending) if score-based tie-breaking is desired.
 * @param potentialCaptures Array of objects containing image file paths and their FileInfo.
 * @param bestVideoInfo FileInfo of the highest-scoring video in the cluster.
 * @param similarityConfig Configuration containing the image similarity threshold.
 * @param wasmExports Optional WASM exports for hamming distance calculation.
 * @returns An array of file paths for the unique, high-quality image captures.
}

// Removed extra closing brace

/**
 * Merges overlapping clusters from potentially parallel DBSCAN results.
 * @param clusters An array of cluster sets (Set<string>).
 * @returns An array of merged, unique cluster sets.
 */
export function mergeAndDeduplicateClusters(
  clusters: Set<string>[],
): Set<string>[] {
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
      // New cluster, no overlap found yet
      merged.push(cluster);
      for (const element of cluster) {
        elementToClusterMap.set(element, cluster);
      }
    } else {
      // Merge this cluster with all related existing clusters
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

/**
 * Expands a cluster in DBSCAN starting from a core point.
 * Modifies the passed 'visited' set directly.
 * @param point The starting core point.
 * @param neighbors Initial neighbors of the starting point (must include the point itself if relevant).
 * @param visited A Set containing all points visited so far across the entire dataset.
 * @param minPts Minimum number of points required to form a core point.
 * @param getNeighborsFn An async function that fetches neighbors for a given point: (p: string) => Promise<AppResult<string[]>>.
 * @returns A Promise resolving to an AppResult containing the Set<string> of points in the expanded cluster or an error.
 */
export async function expandCluster( // Add export back
  point: string,
  neighbors: string[],
  visited: Set<string>,
  minPts: number,
  getNeighborsFn: (p: string) => Promise<AppResult<string[]>>,
): Promise<AppResult<Set<string>>> {
  const cluster = new Set<string>([point]);
  const queue = [...neighbors]; // Initialize queue with initial neighbors

  let queueIndex = 0;
  while (queueIndex < queue.length) {
    const currentPoint = queue[queueIndex++]; // Process queue iteratively

    if (!visited.has(currentPoint)) {
      // visited.add(currentPoint); // Move this after successful neighbor fetch
      cluster.add(currentPoint); // Add to cluster immediately

      // Find neighbors of the current point
      const currentNeighborsResult = await getNeighborsFn(currentPoint);

      if (currentNeighborsResult.isErr()) {
        // Propagate error if neighbor fetching fails
        return err(
          new AppError(
            `Failed to get neighbors for ${currentPoint} during cluster expansion`,
            {
              cause: currentNeighborsResult.error, // Standard way
              context: { originalError: currentNeighborsResult.error }, // For test workaround
            },
          ),
        );
      }

      const currentNeighbors = currentNeighborsResult.value;
      visited.add(currentPoint); // Mark as visited only after successful neighbor fetch

      // If it's a core point, add its *unvisited* neighbors to the queue
      if (currentNeighbors.length >= minPts) {
        for (const neighbor of currentNeighbors) {
          if (!visited.has(neighbor)) {
            // Check if already in queue to avoid duplicates (though Set handles final cluster)
            if (!queue.slice(queueIndex).includes(neighbor)) {
              queue.push(neighbor);
            }
          }
          // Add to cluster even if visited but not yet clustered (handles border points)
          // Note: This logic might need refinement depending on exact DBSCAN variant
          // For now, we primarily rely on adding unvisited points to the queue.
          // If a point was visited but determined to be noise initially, it might be added here.
          cluster.add(neighbor); // Ensure border points are included
        }
      }
    }
    // If visited but not part of *this* cluster yet (e.g., border point found via another core point)
    // Add it to ensure completeness. DBSCAN variants handle this differently.
    // A simple approach is to just add it if it's a neighbor.
    // cluster.add(currentPoint); // Re-adding might be redundant if handled above
  }

  return ok(cluster);
}

/**
 * Core DBSCAN clustering logic.
 * @param chunk The subset of file paths to process.
 * @param eps The maximum distance (1 - minThreshold) for neighborhood search.
 * @param minPts Minimum number of points to form a core point.
 * @param getNeighborsFn Async function to retrieve neighbors for a point.
 * @returns A Promise resolving to an array of clusters (Set<string>).
 */
export async function runDbscanCore(
  chunk: string[],
  eps: number,
  minPts: number,
  getNeighborsFn: (p: string) => Promise<AppResult<string[]>>,
): Promise<Set<string>[]> {
  // Return raw clusters, error handling done within getNeighborsFn/expandCluster calls
  const clusters: Set<string>[] = [];
  const visited = new Set<string>(); // Track visited points for this chunk

  for (const point of chunk) {
    if (visited.has(point)) continue;
    // Note: visited is marked within expandCluster or if neighbor fetch fails/not core point

    // Find initial neighbors for the starting point
    const neighborsResult = await getNeighborsFn(point);

    if (neighborsResult.isErr()) {
      console.error(
        `Error getting initial neighbors for ${point}: ${neighborsResult.error.message}`,
      );
      visited.add(point); // Ensure point is marked visited even if neighbors fail
      continue; // Skip point if neighbors can't be fetched
    }
    const neighbors = neighborsResult.value;

    // Check if it's a core point (has enough neighbors)
    if (neighbors.length >= minPts - 1) {
      // Check if it *could* be a core point
      const clusterResult = await expandCluster(
        point,
        neighbors,
        visited,
        minPts,
        getNeighborsFn,
      );

      if (clusterResult.isErr()) {
        console.error(
          `Error expanding cluster for ${point}: ${clusterResult.error.message}`,
        );
        visited.add(point); // Ensure point is marked visited even if expansion fails
        continue;
      }
      clusters.push(clusterResult.value);
    } else {
      // Not enough neighbors to be a core point, mark as visited (noise for now)
      visited.add(point);
    }
  }
  return clusters;
}
