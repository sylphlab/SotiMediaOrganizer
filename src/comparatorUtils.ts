import { FileInfo, FrameInfo, MediaInfo, SimilarityConfig, WasmExports } from "./types"; // Added FileInfo

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
  const maxLen = Math.max(len1, len2);
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
  similarityConfig: Pick<SimilarityConfig, 'imageVideoSimilarityThreshold'>, // Only need the relevant threshold
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
    const similarity = calculateImageSimilarity(imageFrame, videoFrame, wasmExports);

    if (similarity > bestSimilarity) {
      bestSimilarity = similarity;

      // Early exit if we find a similarity above the threshold
      if (
        bestSimilarity >= similarityConfig.imageVideoSimilarityThreshold
      ) {
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
  if (m === 0 || n === 0) return 0; // Return 0 if either sequence is empty

  // Use a 1D array to optimize space for DTW cost matrix (only need previous row)
  const dtw: number[] = new Array(n + 1).fill(Infinity);
  dtw[0] = 0;

  for (let i = 1; i <= m; i++) {
    let prev = dtw[0]; // Store value from top-left (dtw[i-1][j-1])
    dtw[0] = Infinity; // Start of new row calculation

    for (let j = 1; j <= n; j++) {
      const temp = dtw[j]; // Store value from top (dtw[i-1][j]) before overwriting

      // Cost is 1 - similarity (distance) between current frames
      const cost = 1 - calculateImageSimilarity(seq1[i - 1], seq2[j - 1], wasmExports);
      // Ensure cost is non-negative
      const nonNegativeCost = Math.max(0, cost);

      // Update DTW cost: cost of current match + minimum cost from previous states
      dtw[j] = nonNegativeCost + Math.min(
        prev,       // Cost from diagonal (dtw[i-1][j-1])
        dtw[j],     // Cost from top (dtw[i-1][j])
        dtw[j - 1]  // Cost from left (dtw[i][j-1])
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
  if (fileInfo.metadata.gpsLatitude && fileInfo.metadata.gpsLongitude) score += 300;
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
  similarityConfig: Pick<SimilarityConfig, 'imageSimilarityThreshold' | 'imageVideoSimilarityThreshold' | 'videoSimilarityThreshold'>
): number {
  const isImage1 = media1.duration === 0;
  const isImage2 = media2.duration === 0;

  if (isImage1 && isImage2)
    return similarityConfig.imageSimilarityThreshold;
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
  entriesWithInfo: { entry: string; fileInfo: FileInfo }[]
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
  similarityConfig: Pick<SimilarityConfig, 'imageSimilarityThreshold'>,
  wasmExports: WasmExports | null,
): string[] {
  const uniqueCaptures = new Set<string>();
  const processedCaptures = new Set<string>(); // Keep track of processed captures to avoid redundant comparisons

  // Filter for high-quality captures first
  const highQualityCaptures = potentialCaptures.filter(({ fileInfo }) =>
    fileInfo.media.duration === 0 && // Is an image
    getQuality(fileInfo) >= getQuality(bestVideoInfo) && // Comparable or better quality
    (!bestVideoInfo.metadata.imageDate || !!fileInfo.metadata.imageDate) // Has date if video has date
  );

  // Assumes highQualityCaptures are sorted by score descending by the caller (scoreEntries)

  for (const { entry: capture1, fileInfo: info1 } of highQualityCaptures) {
    if (processedCaptures.has(capture1)) continue;

    let isDuplicate = false;
    // Compare against already selected unique captures
    for (const capture2 of uniqueCaptures) {
      // Find FileInfo for capture2 within highQualityCaptures
      const capture2Data = highQualityCaptures.find(c => c.entry === capture2);
      if (!capture2Data) continue; // Should not happen
      const info2 = capture2Data.fileInfo;

      // Ensure both frames exist before comparing
      if (!info1.media.frames[0]?.hash || !info2.media.frames[0]?.hash) continue;

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
  similarityConfig: Pick<SimilarityConfig, 'imageSimilarityThreshold'>,
  wasmExports: WasmExports | null,
): string[] {
  if (!sortedEntriesWithInfo || sortedEntriesWithInfo.length === 0) return [];
  if (sortedEntriesWithInfo.length === 1) return [sortedEntriesWithInfo[0].entry];

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
      wasmExports
    );
    // Combine the best video with the selected unique image captures
    return [bestEntry, ...uniqueImageCaptures];
  }
}

// Removed extra closing brace

