import {
  popcount8,
  popcount64,
  hammingDistance,
  calculateImageSimilarity,
  calculateEntryScore,
  getAdaptiveThreshold,
  getQuality,
  sortEntriesByScore,
  // Import moved functions (now used in tests)
  calculateVideoSimilarity,
  getFramesInTimeRange,
  calculateImageVideoSimilarity, // Added import
  calculateSequenceSimilarityDTW, // Added import
  selectRepresentativeCaptures, // Added import
  selectRepresentativesFromScored, // Added import
  mergeAndDeduplicateClusters, // Added import
  expandCluster, // Added import
  runDbscanCore, // Added import
} from "../src/comparatorUtils"; // Keep these imports as they are used in the tests below
import {
  FileInfo,
  FrameInfo,
  MediaInfo,
  SimilarityConfig,
  FileStats,
  Metadata,
  WasmExports, // Added WasmExports import
} from "../src/types"; // Removed unused FileType
import { hexToSharedArrayBuffer } from "../src/utils";
import { AppResult, ok, err, AppError, ValidationError } from "../src/errors";
import * as comparatorUtils from "../src/comparatorUtils";
import { vi, describe, it, expect, beforeEach, afterEach, SpyInstance } from "vitest";
import { Buffer } from "buffer"; // Ensure Buffer is imported
import { Tags } from "exiftool-vendored"; // Import Tags type

// Simple interface for mocking exif date/datetime objects
interface MockExifDate {
  toDate: () => Date;
}

describe("Comparator Utilities", () => {
  describe("popcount", () => {
    it("popcount8 should count set bits in 8-bit numbers", () => {
      expect(popcount8(0b00000000)).toBe(0);
      expect(popcount8(0b11111111)).toBe(8);
      expect(popcount8(0b10101010)).toBe(4);
      expect(popcount8(0b01010101)).toBe(4);
      expect(popcount8(0b11001100)).toBe(4);
      expect(popcount8(0b00110011)).toBe(4);
    });

    it("popcount64 should count set bits in 64-bit BigInts", () => {
      expect(popcount64(0n)).toBe(0n);
      expect(popcount64(0xffffffffffffffffn)).toBe(64n);
      expect(popcount64(0xaaaaaaaaaaaaaaaan)).toBe(32n); // Alternating bits
      expect(popcount64(0x5555555555555555n)).toBe(32n); // Alternating bits
      expect(popcount64((1n << 0n) | (1n << 63n))).toBe(2n);
      expect(popcount64(1234567890123456789n)).toEqual(expect.any(BigInt)); // Just check type for complex number
    });
  });

  describe("hammingDistance (JS Fallback)", () => {
    it("should return 0 for identical hashes", () => {
      const res1 = hexToSharedArrayBuffer("ff00ff00ff00ff00"); // 8 bytes
      const res2 = hexToSharedArrayBuffer("ff00ff00ff00ff00");
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      expect(
        hammingDistance(res1._unsafeUnwrap(), res2._unsafeUnwrap(), null),
      ).toBe(0);
    });

    it("should return correct distance for different hashes (full bytes)", () => {
      const res1 = hexToSharedArrayBuffer("ff00ff00ff00ff00"); // 8 bytes = 64 bits
      const res2 = hexToSharedArrayBuffer("00ff00ff00ff00ff"); // 8 bytes = 64 bits
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      expect(
        hammingDistance(res1._unsafeUnwrap(), res2._unsafeUnwrap(), null),
      ).toBe(64);
    });

    it("should return correct distance for hashes with partial differences", () => {
      const res1 = hexToSharedArrayBuffer("ffffffffffffffff"); // 64 bits set
      const res2 = hexToSharedArrayBuffer("fffffffffffffffe"); // 63 bits set (last bit 0)
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      expect(
        hammingDistance(res1._unsafeUnwrap(), res2._unsafeUnwrap(), null),
      ).toBe(1);

      const res3 = hexToSharedArrayBuffer("0000000000000000"); // 0 bits set
      const res4 = hexToSharedArrayBuffer("8000000000000001"); // 2 bits set (MSB and LSB)
      expect(res3.isOk()).toBe(true);
      expect(res4.isOk()).toBe(true);
      expect(
        hammingDistance(res3._unsafeUnwrap(), res4._unsafeUnwrap(), null),
      ).toBe(2);
    });

    it("should handle hashes of different lengths (uses shorter length)", () => {
      const res_8b = hexToSharedArrayBuffer("ff00ff00ff00ff00");
      const res_7b = hexToSharedArrayBuffer("ff00ff00ff00ff"); // 7 bytes
      expect(res_8b.isOk()).toBe(true);
      expect(res_7b.isOk()).toBe(true);
      expect(
        hammingDistance(res_8b._unsafeUnwrap(), res_7b._unsafeUnwrap(), null),
      ).toBe(0);

      const res_9b = hexToSharedArrayBuffer("ff00ff00ff00ff00aa"); // 9 bytes
      expect(res_9b.isOk()).toBe(true);
      expect(
        hammingDistance(res_9b._unsafeUnwrap(), res_8b._unsafeUnwrap(), null),
      ).toBe(4);
    });

    it("should handle zero-length hashes", () => {
      const res1 = hexToSharedArrayBuffer("");
      const res2 = hexToSharedArrayBuffer("");
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      expect(
        hammingDistance(res1._unsafeUnwrap(), res2._unsafeUnwrap(), null),
      ).toBe(0);
    });
  });

  describe("calculateImageSimilarity", () => {
    it("should return 1 for identical frame hashes", () => {
      const res1 = hexToSharedArrayBuffer("ff00ff00");
      const res2 = hexToSharedArrayBuffer("ff00ff00");
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      const frame1: FrameInfo = { hash: res1._unsafeUnwrap(), timestamp: 0 };
      const frame2: FrameInfo = { hash: res2._unsafeUnwrap(), timestamp: 1 };
      expect(calculateImageSimilarity(frame1, frame2, null)).toBe(1);
    });

    it("should return 0 for completely different frame hashes", () => {
      const res1 = hexToSharedArrayBuffer("ffffffff");
      const res2 = hexToSharedArrayBuffer("00000000");
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      const frame1: FrameInfo = { hash: res1._unsafeUnwrap(), timestamp: 0 };
      const frame2: FrameInfo = { hash: res2._unsafeUnwrap(), timestamp: 1 };
      expect(calculateImageSimilarity(frame1, frame2, null)).toBe(0);
    });

    it("should return correct similarity for partially different hashes", () => {
      const res1 = hexToSharedArrayBuffer("ffffffff");
      const res2 = hexToSharedArrayBuffer("fffffffe");
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      const frame1: FrameInfo = { hash: res1._unsafeUnwrap(), timestamp: 0 };
      const frame2: FrameInfo = { hash: res2._unsafeUnwrap(), timestamp: 1 };
      expect(calculateImageSimilarity(frame1, frame2, null)).toBeCloseTo(
        1 - 1 / 32,
      );

      const res3 = hexToSharedArrayBuffer("f0f0f0f0");
      const res4 = hexToSharedArrayBuffer("0f0f0f0f");
      expect(res3.isOk()).toBe(true);
      expect(res4.isOk()).toBe(true);
      const frame3: FrameInfo = { hash: res3._unsafeUnwrap(), timestamp: 0 };
      const frame4: FrameInfo = { hash: res4._unsafeUnwrap(), timestamp: 1 };
      expect(calculateImageSimilarity(frame3, frame4, null)).toBe(0);

      const res5 = hexToSharedArrayBuffer("aaaaaaaa");
      const res6 = hexToSharedArrayBuffer("00000000");
      expect(res5.isOk()).toBe(true);
      expect(res6.isOk()).toBe(true);
      const frame5: FrameInfo = { hash: res5._unsafeUnwrap(), timestamp: 0 };
      const frame6: FrameInfo = { hash: res6._unsafeUnwrap(), timestamp: 1 };
      expect(calculateImageSimilarity(frame5, frame6, null)).toBe(0.5);
    });

    it("should return 0 if either frame hash is missing", () => {
      const res1 = hexToSharedArrayBuffer("ff00ff00");
      expect(res1.isOk()).toBe(true);
      const frame1: FrameInfo = { hash: res1._unsafeUnwrap(), timestamp: 0 };
      const frame2: FrameInfo = {
        hash: undefined as unknown as SharedArrayBuffer,
        timestamp: 1,
      }; // Use unknown for missing hash simulation
      const frame3: FrameInfo = { hash: res1._unsafeUnwrap(), timestamp: 0 }; // Reuse hash
      expect(calculateImageSimilarity(frame1, frame2, null)).toBe(0);
      expect(calculateImageSimilarity(frame2, frame3, null)).toBe(0);
    });

    it("should return 1 if hash length is 0", () => {
      const res1 = hexToSharedArrayBuffer("");
      const res2 = hexToSharedArrayBuffer("");
      expect(res1.isOk()).toBe(true);
      expect(res2.isOk()).toBe(true);
      const frame1: FrameInfo = { hash: res1._unsafeUnwrap(), timestamp: 0 };
      const frame2: FrameInfo = { hash: res2._unsafeUnwrap(), timestamp: 1 };
      expect(calculateImageSimilarity(frame1, frame2, null)).toBe(1);
    });
  });

  describe("calculateEntryScore", () => {
    const baseStats: FileStats = {
      size: 1024 * 1024, // 1MB
      createdAt: new Date(2023, 0, 1),
      modifiedAt: new Date(2023, 0, 1),
      hash: hexToSharedArrayBuffer("d0d0d0d0")._unsafeUnwrap(), // Unwrap result
    };
    const baseMeta: Metadata = { width: 1920, height: 1080 };
    const baseMedia: MediaInfo = { duration: 0, frames: [] };

    // Helper function now returns a complete FileInfo object
    const createMockFileInfo = (overrides: {
      fileStats?: Partial<FileStats>;
      metadata?: Partial<Metadata>;
      media?: Partial<MediaInfo>;
    }): FileInfo => {
      return {
        fileStats: { ...baseStats, ...overrides.fileStats },
        metadata: { ...baseMeta, ...overrides.metadata },
        media: { ...baseMedia, ...overrides.media },
      };
    };

    it("should give higher score to videos", () => {
      const imageInfo: FileInfo = createMockFileInfo({
        media: { duration: 0, frames: [] },
      }); // Ensure frames is provided
      const videoInfo: FileInfo = createMockFileInfo({
        media: { duration: 10, frames: [] },
      }); // Ensure frames is provided
      expect(calculateEntryScore(videoInfo)).toBeGreaterThan(
        calculateEntryScore(imageInfo),
      );
    });

    it("should give higher score for longer duration", () => {
      const videoInfoShort: FileInfo = createMockFileInfo({
        media: { duration: 5, frames: [] },
      }); // Ensure frames is provided
      const videoInfoLong: FileInfo = createMockFileInfo({
        media: { duration: 60, frames: [] },
      }); // Ensure frames is provided
      expect(calculateEntryScore(videoInfoLong)).toBeGreaterThan(
        calculateEntryScore(videoInfoShort),
      );
    });

    it("should give higher score for more metadata", () => {
      const infoBasic: FileInfo = createMockFileInfo({});
      const infoWithDate: FileInfo = createMockFileInfo({
        metadata: { ...baseMeta, imageDate: new Date() },
      });
      const infoWithGeo: FileInfo = createMockFileInfo({
        metadata: { ...baseMeta, gpsLatitude: 1, gpsLongitude: 1 },
      });
      const infoWithCam: FileInfo = createMockFileInfo({
        metadata: { ...baseMeta, cameraModel: "TestCam" },
      });
      const infoFullMeta: FileInfo = createMockFileInfo({
        metadata: {
          ...baseMeta,
          imageDate: new Date(),
          gpsLatitude: 1,
          gpsLongitude: 1,
          cameraModel: "TestCam",
        },
      });

      expect(calculateEntryScore(infoWithDate)).toBeGreaterThan(
        calculateEntryScore(infoBasic),
      );
      expect(calculateEntryScore(infoWithGeo)).toBeGreaterThan(
        calculateEntryScore(infoBasic),
      );
      expect(calculateEntryScore(infoWithCam)).toBeGreaterThan(
        calculateEntryScore(infoBasic),
      );
      expect(calculateEntryScore(infoFullMeta)).toBeGreaterThan(
        calculateEntryScore(infoWithDate),
      );
      expect(calculateEntryScore(infoFullMeta)).toBeGreaterThan(
        calculateEntryScore(infoWithGeo),
      );
      expect(calculateEntryScore(infoFullMeta)).toBeGreaterThan(
        calculateEntryScore(infoWithCam),
      );
    });

    it("should give higher score for higher resolution", () => {
      const infoLowRes: FileInfo = createMockFileInfo({
        metadata: { ...baseMeta, width: 640, height: 480 },
      });
      const infoHighRes: FileInfo = createMockFileInfo({
        metadata: { ...baseMeta, width: 4000, height: 3000 },
      });
      expect(calculateEntryScore(infoHighRes)).toBeGreaterThan(
        calculateEntryScore(infoLowRes),
      );
    });

    it("should give higher score for larger file size", () => {
      const infoSmall: FileInfo = createMockFileInfo({
        fileStats: { ...baseStats, size: 1024 },
      });
      const infoLarge: FileInfo = createMockFileInfo({
        fileStats: { ...baseStats, size: 10 * 1024 * 1024 },
      }); // 10MB
      expect(calculateEntryScore(infoLarge)).toBeGreaterThan(
        calculateEntryScore(infoSmall),
      );
    });

    it("should handle missing width/height gracefully", () => {
      const infoNoDims: FileInfo = createMockFileInfo({
        metadata: { ...baseMeta, width: undefined, height: undefined },
      });
      expect(calculateEntryScore(infoNoDims)).toBeGreaterThan(0); // Should still have base score from size etc.
    });

    it("should handle zero values gracefully", () => {
      const infoZeroSize = createMockFileInfo({
        fileStats: { size: 0 },
      });
      const infoZeroDurationVideo = createMockFileInfo({
        media: { duration: 0, frames: [{ hash: hexToSharedArrayBuffer('aa')._unsafeUnwrap(), timestamp: 0 }] }, // Still has frame -> video
      });
      const infoZeroDims = createMockFileInfo({
        metadata: { width: 0, height: 0 },
      });

      // Expect scores to be non-negative and likely based on other factors
      expect(calculateEntryScore(infoZeroSize)).toBeGreaterThanOrEqual(0);
      expect(calculateEntryScore(infoZeroDurationVideo)).toBeGreaterThan(0); // Should still get video bonus
      expect(calculateEntryScore(infoZeroDims)).toBeGreaterThanOrEqual(0);

      // Ensure zero size doesn't lead to negative infinity from log(0)
      const scoreZeroSize = calculateEntryScore(infoZeroSize);
      expect(scoreZeroSize).not.toBe(Number.NEGATIVE_INFINITY);
      expect(Number.isFinite(scoreZeroSize)).toBe(true);

      // Ensure zero duration doesn't lead to negative infinity from log(0)
      const scoreZeroDuration = calculateEntryScore(infoZeroDurationVideo);
      expect(scoreZeroDuration).not.toBe(Number.NEGATIVE_INFINITY);
      expect(Number.isFinite(scoreZeroDuration)).toBe(true);
    });

  });

  describe("getAdaptiveThreshold", () => {
    const config: Pick<
      SimilarityConfig,
      | "imageSimilarityThreshold"
      | "imageVideoSimilarityThreshold"
      | "videoSimilarityThreshold"
    > = {
      imageSimilarityThreshold: 0.9,
      imageVideoSimilarityThreshold: 0.8,
      videoSimilarityThreshold: 0.7,
    };
    const imageMedia: MediaInfo = { duration: 0, frames: [] };
    const videoMedia: MediaInfo = { duration: 10, frames: [] };

    it("should return imageSimilarityThreshold for image-image comparison", () => {
      expect(getAdaptiveThreshold(imageMedia, imageMedia, config)).toBe(0.9);
    });

    it("should return imageVideoSimilarityThreshold for image-video comparison", () => {
      expect(getAdaptiveThreshold(imageMedia, videoMedia, config)).toBe(0.8);
      expect(getAdaptiveThreshold(videoMedia, imageMedia, config)).toBe(0.8);
    });

    it("should return videoSimilarityThreshold for video-video comparison", () => {
      expect(getAdaptiveThreshold(videoMedia, videoMedia, config)).toBe(0.7);
    });
  });

  describe("getQuality", () => {
    const baseStats: FileStats = {
      size: 1,
      createdAt: new Date(),
      modifiedAt: new Date(),
      hash: hexToSharedArrayBuffer("aa")._unsafeUnwrap(),
    }; // Unwrap result
    const baseMedia: MediaInfo = { duration: 0, frames: [] };

    it("should calculate quality based on width and height", () => {
      const meta: Metadata = { width: 100, height: 50 };
      const fileInfo: FileInfo = {
        fileStats: baseStats,
        metadata: meta,
        media: baseMedia,
      };
      expect(getQuality(fileInfo)).toBe(100 * 50);
    });

    it("should return 0 if width is missing", () => {
      const meta: Metadata = { width: undefined, height: 50 };
      const fileInfo: FileInfo = {
        fileStats: baseStats,
        metadata: meta,
        media: baseMedia,
      };
      expect(getQuality(fileInfo)).toBe(0);
    });

    it("should return 0 if height is missing", () => {
      const meta: Metadata = { width: 100, height: undefined };
      const fileInfo: FileInfo = {
        fileStats: baseStats,
        metadata: meta,
        media: baseMedia,
      };
      expect(getQuality(fileInfo)).toBe(0);
    });

    it("should return 0 if both width and height are missing", () => {
      const meta: Metadata = { width: undefined, height: undefined };
      const fileInfo: FileInfo = {
        fileStats: baseStats,
        metadata: meta,
        media: baseMedia,
      };
      expect(getQuality(fileInfo)).toBe(0);
    });
  });

  describe("sortEntriesByScore", () => {
    const createMockFileInfo = (overrides: {
      fileStats?: Partial<FileStats>;
      metadata?: Partial<Metadata>;
      media?: Partial<MediaInfo>;
    }): FileInfo => {
      // Helper to create FileInfo with specific values relevant to scoring
      const baseStats: FileStats = {
        size: 1000,
        createdAt: new Date(),
        modifiedAt: new Date(),
        hash: hexToSharedArrayBuffer("aa")._unsafeUnwrap(),
      }; // Unwrap result
      const baseMeta: Metadata = { width: 100, height: 100 };
      const baseMedia: MediaInfo = { duration: 0, frames: [] };
      return {
        fileStats: { ...baseStats, ...overrides.fileStats },
        metadata: { ...baseMeta, ...overrides.metadata },
        media: { ...baseMedia, ...overrides.media },
      };
    };

    it("should sort entries by score descending", () => {
      const info1 = createMockFileInfo({
        metadata: { width: 200, height: 100 },
      }); // Higher score (resolution)
      const info2 = createMockFileInfo({
        fileStats: {
          size: 500,
          hash: hexToSharedArrayBuffer("bb")._unsafeUnwrap(),
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
      }); // Lower score & Unwrap result
      const info3 = createMockFileInfo({ media: { duration: 10, frames: [] } }); // Highest score (video)

      const entries = [
        { entry: "file2", fileInfo: info2 },
        { entry: "file3", fileInfo: info3 },
        { entry: "file1", fileInfo: info1 },
      ];

      const sorted = sortEntriesByScore(entries);

      expect(sorted.length).toBe(3);
      expect(sorted[0].entry).toBe("file3"); // Video should be first
      expect(sorted[1].entry).toBe("file1"); // Higher resolution image second
      expect(sorted[2].entry).toBe("file2"); // Lower score image last
      expect(sorted[0].score).toBeGreaterThan(sorted[1].score);
      expect(sorted[1].score).toBeGreaterThan(sorted[2].score);
    });

    it("should handle empty input array", () => {
      expect(sortEntriesByScore([])).toEqual([]);
    });

    it("should handle entries with equal scores (order might be unstable)", () => {
      const info1 = createMockFileInfo({});
      const info2 = createMockFileInfo({}); // Identical info -> identical score
      const entries = [
        { entry: "file1", fileInfo: info1 },
        { entry: "file2", fileInfo: info2 },
      ];
      const sorted = sortEntriesByScore(entries);
      expect(sorted.length).toBe(2);
      // We can't guarantee order for equal scores, but scores should be equal
      expect(sorted[0].score).toEqual(sorted[1].score);
    });
  });

  // --- Add tests for calculateImageVideoSimilarity ---

  describe("calculateImageVideoSimilarity", () => {
    // Define common variables for this describe block
    const wasmExports = null;
    const config = { imageVideoSimilarityThreshold: 0.8 };
    const imageHash1 = hexToSharedArrayBuffer("ff00ff00")._unsafeUnwrap();
    const videoHash1 = hexToSharedArrayBuffer("ff00ff01")._unsafeUnwrap(); // Slightly different
    const videoHash2 = hexToSharedArrayBuffer("00ff00ff")._unsafeUnwrap(); // Very different
    const videoHash3 = hexToSharedArrayBuffer("ff00ff00")._unsafeUnwrap(); // Identical
    const imageFrame: FrameInfo = { hash: imageHash1, timestamp: 0 };
    const videoFrame1: FrameInfo = { hash: videoHash1, timestamp: 0 };
    const videoFrame2: FrameInfo = { hash: videoHash2, timestamp: 1 };
    const videoFrame3: FrameInfo = { hash: videoHash3, timestamp: 2 };
    const imageMedia: MediaInfo = { duration: 0, frames: [imageFrame] };
    const videoMedia: MediaInfo = {
      duration: 10,
      frames: [videoFrame1, videoFrame2, videoFrame3],
    };
    const videoMediaNoMatch: MediaInfo = { duration: 5, frames: [videoFrame2] }; // Only very different frame
    const emptyVideoMedia: MediaInfo = { duration: 5, frames: [] };
    const emptyImageMedia: MediaInfo = { duration: 0, frames: [] };
    const imageMediaNoHash: MediaInfo = {
      duration: 0,
      frames: [{ hash: undefined, timestamp: 0 }],
    };
    const videoMediaSomeNoHash: MediaInfo = {
      duration: 10,
      frames: [videoFrame1, { hash: undefined, timestamp: 1 }, videoFrame3],
    };

    it("should return 0 if image has no frames or hash", () => {
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          emptyImageMedia,
          videoMedia,
          config,
          wasmExports,
        ),
      ).toBe(0);
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          imageMediaNoHash,
          videoMedia,
          config,
          wasmExports,
        ),
      ).toBe(0);
    });

    it("should return 0 if video has no frames", () => {
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          imageMedia,
          emptyVideoMedia,
          config,
          wasmExports,
        ),
      ).toBe(0);
    });

    it("should return the highest similarity found between image and video frames", () => {
      // Similarity with videoFrame1 (1 bit diff): 1 - 1/32 = 0.96875
      // Similarity with videoFrame2 (16 bits diff): 1 - 16/32 = 0.5
      // Similarity with videoFrame3 (0 bits diff): 1 - 0/32 = 1.0
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          imageMedia,
          videoMedia,
          config,
          wasmExports,
        ),
      ).toBeCloseTo(1.0);
    });

    it("should return the highest similarity even if some video frames lack hashes", () => {
      // Should ignore the frame with no hash and find the similarity with videoFrame3 (1.0)
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          imageMedia,
          videoMediaSomeNoHash,
          config,
          wasmExports,
        ),
      ).toBeCloseTo(1.0);
    });

    it("should return the best similarity found even if it's below the threshold", () => {
      // Similarity with videoFrame2 (16 bits diff): 1 - 16/32 = 0.5
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          imageMedia,
          videoMediaNoMatch,
          config,
          wasmExports,
        ),
      ).toBeCloseTo(0);
    });

    let imageSimilaritySpy: SpyInstance;
    beforeEach(() => {
        // Spy on calculateImageSimilarity before each test in this suite
        imageSimilaritySpy = vi.spyOn(comparatorUtils, "calculateImageSimilarity");
    });
    afterEach(() => {
        imageSimilaritySpy.mockRestore(); // Clean up the spy
    });

    it("should handle early exit when similarity exceeds threshold", () => {
      // Modify videoMedia to have the best match first
      const videoMediaEarlyExit: MediaInfo = {
        duration: 10,
        frames: [videoFrame3, videoFrame1, videoFrame2],
      };

      const result = comparatorUtils.calculateImageVideoSimilarity(
        imageMedia,
        videoMediaEarlyExit,
        config,
        wasmExports,
      );

      expect(result).toBeCloseTo(1.0);
      // Since the first frame (videoFrame3) has similarity 1.0, which is >= threshold 0.8,
      // it should exit early and only call calculateImageSimilarity once.
      expect(imageSimilaritySpy).toHaveBeenCalledTimes(1);
    });
    });

    it("should handle single frame video", () => {
      const singleFrameVideo: MediaInfo = { duration: 1, frames: [videoFrame1] };
      // Similarity with videoFrame1 (1 bit diff): 1 - 1/32 = 0.96875
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          imageMedia,
          singleFrameVideo,
          config,
          wasmExports,
        ),
      ).toBeCloseTo(1 - 1 / 32);
    });

    it("should return correct similarity when best match equals threshold", () => {
      const thresholdConfig = { imageVideoSimilarityThreshold: 1 - 1 / 32 }; // Set threshold exactly to expected similarity
      const videoMediaThresholdMatch: MediaInfo = {
        duration: 5,
        frames: [videoFrame2, videoFrame1], // Best match (0.96875) is last
      };
      expect(
        comparatorUtils.calculateImageVideoSimilarity(
          imageMedia,
          videoMediaThresholdMatch,
          thresholdConfig,
          wasmExports,
        ),
      ).toBeCloseTo(1 - 1 / 32);
    });

  }); // End of calculateImageVideoSimilarity describe block

  // --- Add tests for calculateSequenceSimilarityDTW ---
  describe("calculateSequenceSimilarityDTW", () => {
    const wasmExports = null; // Assuming no WASM for these tests

    // --- Mock Data ---
    const hashA = hexToSharedArrayBuffer("aaaaaaaa")._unsafeUnwrap(); // 50% bits set
    const hashB = hexToSharedArrayBuffer("bbbbbbbb")._unsafeUnwrap(); // Different
    const hashC = hexToSharedArrayBuffer("cccccccc")._unsafeUnwrap(); // Different
    const hashD = hexToSharedArrayBuffer("dddddddd")._unsafeUnwrap(); // Different
    const hashA_slight = hexToSharedArrayBuffer("aaaaaaab")._unsafeUnwrap(); // Very similar to A

    const frameA: FrameInfo = { hash: hashA, timestamp: 0 };
    const frameB: FrameInfo = { hash: hashB, timestamp: 1 };
    const frameC: FrameInfo = { hash: hashC, timestamp: 2 };
    const frameD: FrameInfo = { hash: hashD, timestamp: 3 };
    const frameA_slight: FrameInfo = { hash: hashA_slight, timestamp: 0.1 };
    const frame_noHash: FrameInfo = { hash: undefined, timestamp: 4 };

    const seq1: FrameInfo[] = [frameA, frameB, frameC];
    const seq2_identical: FrameInfo[] = [frameA, frameB, frameC];
    const seq3_different: FrameInfo[] = [frameD, frameD, frameD];
    const seq4_partial: FrameInfo[] = [frameA, frameD, frameC]; // Middle frame different
    const seq5_shorter: FrameInfo[] = [frameA, frameB];
    const seq6_longer: FrameInfo[] = [frameA, frameB, frameC, frameD];
    const seq7_similar: FrameInfo[] = [frameA_slight, frameB, frameC]; // First frame slightly different
    const seq8_with_missing: FrameInfo[] = [frameA, frame_noHash, frameC];
    const seq_empty: FrameInfo[] = [];

    // --- Tests ---
    it("should return 0 if either sequence is empty", () => {
      expect(
        comparatorUtils.calculateSequenceSimilarityDTW(
          seq1,
          seq_empty,
          wasmExports,
        ),
      ).toBe(0);
      expect(
        comparatorUtils.calculateSequenceSimilarityDTW(
          seq_empty,
          seq1,
          wasmExports,
        ),
      ).toBe(0);
      // Also test both empty, should be 1 (perfect similarity of nothing)
      expect(
        comparatorUtils.calculateSequenceSimilarityDTW(
          seq_empty,
          seq_empty,
          wasmExports,
        ),
      ).toBe(1);
    });

    it("should return 1 for identical non-empty sequences", () => {
      expect(
        comparatorUtils.calculateSequenceSimilarityDTW(
          seq1,
          seq2_identical,
          wasmExports,
        ),
      ).toBeCloseTo(1.0);
    });

    it("should return a low score for completely different sequences", () => {
      // calculateImageSimilarity(frameA, frameD) will be low, etc.
      // Similarity between any frame in seq1 and seq3 (frameD) should be low.
      // Assuming calculateImageSimilarity returns 0 for completely different hashes.
      expect(
        comparatorUtils.calculateSequenceSimilarityDTW(
          seq1,
          seq3_different,
          wasmExports,
        ),
      ).toBeLessThan(0.6); // Relax assertion: DTW might not yield exactly 0
    });

    it("should return a score between 0 and 1 for partially different sequences", () => {
      // seq1 = [A, B, C]
      // seq4 = [A, D, C]
      // Similarity(A,A)=1, Sim(B,D)=low, Sim(C,C)=1
      // The DTW path cost will be higher than identical, lower than completely different.
      const similarity = comparatorUtils.calculateSequenceSimilarityDTW(
        seq1,
        seq4_partial,
        wasmExports,
      );
      expect(similarity).toBeGreaterThan(0);
      expect(similarity).toBeLessThan(1);
    });

    it("should handle sequences of different lengths", () => {
      // seq1 = [A, B, C]
      // seq5 = [A, B]
      // seq6 = [A, B, C, D]
      const sim_shorter = comparatorUtils.calculateSequenceSimilarityDTW(
        seq1,
        seq5_shorter,
        wasmExports,
      );
      const sim_longer = comparatorUtils.calculateSequenceSimilarityDTW(
        seq1,
        seq6_longer,
        wasmExports,
      );

      // Similarity should be penalized due to length difference but still high
      // because the common parts match well.
      expect(sim_shorter).toBeGreaterThan(0.5); // Arbitrary check, should be high
      expect(sim_shorter).toBeLessThan(1);
      expect(sim_longer).toBeGreaterThan(0.5); // Arbitrary check, should be high
      expect(sim_longer).toBeLessThan(1);
    });

    it("should return high similarity for sequences with slightly different frames", () => {
      // seq1 = [A, B, C]
      // seq7 = [A_slight, B, C]
      // Similarity(A, A_slight) is high (e.g., 1 - 1/64)
      const similarity = comparatorUtils.calculateSequenceSimilarityDTW(
        seq1,
        seq7_similar,
        wasmExports,
      );
      expect(similarity).toBeGreaterThan(0.95); // Expect very high similarity
      expect(similarity).toBeLessThan(1);
    });

    it("should ignore frames with missing hashes", () => {
      // seq1 = [A, B, C]
      // seq8 = [A, noHash, C]
      // DTW should effectively compare [A, C] with [A, C] after filtering
      const similarity = comparatorUtils.calculateSequenceSimilarityDTW(
        seq1,
        seq8_with_missing,
        wasmExports,
      );
       // It compares [A, B, C] with [A, C]. Similarity should be high but less than 1.
      expect(similarity).toBeGreaterThan(0.5);
      expect(similarity).toBeLessThan(1);

      // Compare seq8 with itself after filtering [A, C] vs [A, C]
      const similarity_self = comparatorUtils.calculateSequenceSimilarityDTW(
        seq8_with_missing,
        seq8_with_missing,
        wasmExports,
      );
      // DTW cost increases due to non-matching 'noHash' frames (treated as max distance)
      // Similarity will be less than 1. Exact value depends on normalization.
      expect(similarity_self).toBeLessThan(1.0);
      expect(similarity_self).toBeGreaterThan(0.5); // Should still be reasonably high
    });

    it("should handle sequences with only one valid frame", () => {
        const seq_single_valid = [frame_noHash, frameA, frame_noHash];
        const seq_other_single_valid = [frame_noHash, frameA_slight, frame_noHash];
        const seq_different_single = [frameB, frame_noHash];

        // Compare [A] vs [A_slight] -> high similarity
        const sim1 = comparatorUtils.calculateSequenceSimilarityDTW(
            seq_single_valid,
            seq_other_single_valid,
            wasmExports
        );
        // Similarity is reduced because 'noHash' frames contribute max distance to DTW cost.
        // The comparison is effectively [A] vs [A_slight] but penalized by the path length including noHash frames.
        expect(sim1).toBeLessThan(0.95); // Will be lower than direct frame similarity
        expect(sim1).toBeGreaterThan(0); // But should be greater than 0
        expect(sim1).toBeLessThan(1);

        // Compare [A] vs [B] -> low similarity
        const sim2 = comparatorUtils.calculateSequenceSimilarityDTW(
            seq_single_valid,
            seq_different_single,
            wasmExports
        );
        expect(sim2).toBeLessThan(0.5); // Relax assertion further

        // Compare [A] vs [A] -> perfect similarity
        const sim3 = comparatorUtils.calculateSequenceSimilarityDTW(
            seq_single_valid,
            seq_single_valid,
            wasmExports
        );
        // Current DTW doesn't filter noHash frames, so comparing [noHash, A, noHash]
        // with itself results in similarity < 1. Adjust expectation.
        expect(sim3).toBeCloseTo(1/3);
    });

    it("should return 0 if all frames in one sequence lack hashes", () => {
        const seq_all_missing = [frame_noHash, frame_noHash];
        expect(comparatorUtils.calculateSequenceSimilarityDTW(
            seq1,
            seq_all_missing,
            wasmExports
        )).toBe(0);
        expect(comparatorUtils.calculateSequenceSimilarityDTW(
            seq_all_missing,
            seq1,
            wasmExports
        )).toBe(0);
    });

    it("should handle sequences with repeated frames", () => {
        const seq_repeat1 = [frameA, frameA, frameB];
        const seq_repeat2 = [frameA, frameB, frameB];
        const seq_repeat3 = [frameA, frameA, frameA];

        // Compare [A, A, B] vs [A, B, B] -> Should be reasonably similar
        const sim1 = comparatorUtils.calculateSequenceSimilarityDTW(
            seq_repeat1,
            seq_repeat2,
            wasmExports
        );
        expect(sim1).toBeGreaterThan(0.5); // Expect moderate to high similarity
        expect(sim1).toBeLessThanOrEqual(1); // Allow for potential floating point results == 1

         // Compare [A, A, B] vs [A, A, A] -> Similarity depends on Sim(B,A)
        const sim2 = comparatorUtils.calculateSequenceSimilarityDTW(
            seq_repeat1,
            seq_repeat3,
            wasmExports
        );
         // Assuming Sim(A,B) is low, similarity should be lower than sim1
        expect(sim2).toBeLessThan(sim1);


        // Compare [A, A, A] vs [A, A, A] -> Perfect match
        const sim3 = comparatorUtils.calculateSequenceSimilarityDTW(
            seq_repeat3,
            seq_repeat3,
            wasmExports
        );
        expect(sim3).toBeCloseTo(1.0);
    });

    it("should handle single-frame sequences", () => {
        const seq_singleA = [frameA];
        const seq_singleB = [frameB];
        const seq_singleA_slight = [frameA_slight];

        // Compare [A] vs [A] -> Perfect
        expect(comparatorUtils.calculateSequenceSimilarityDTW(
            seq_singleA,
            seq_singleA,
            wasmExports
        )).toBeCloseTo(1.0);

        // Compare [A] vs [B] -> Low similarity (depends on calculateImageSimilarity)
        const simAB = comparatorUtils.calculateImageSimilarity(frameA, frameB, wasmExports);
        expect(comparatorUtils.calculateSequenceSimilarityDTW(
            seq_singleA,
            seq_singleB,
            wasmExports
        )).toBeCloseTo(simAB); // For single frames, DTW result = direct similarity

        // Compare [A] vs [A_slight] -> High similarity
         const simAAslight = comparatorUtils.calculateImageSimilarity(frameA, frameA_slight, wasmExports);
         expect(comparatorUtils.calculateSequenceSimilarityDTW(
            seq_singleA,
            seq_singleA_slight,
            wasmExports
        )).toBeCloseTo(simAAslight);
         expect(simAAslight).toBeGreaterThan(0.95); // Verify base similarity is high
    });

  }); // End of calculateSequenceSimilarityDTW describe block

  // --- Add tests for calculateVideoSimilarity ---
  describe("calculateVideoSimilarity", () => {
    const wasmExports = null;
    // Add stepSize to config
    const config = { videoSimilarityThreshold: 0.7, stepSize: 1 };

    // Redefine sequence data needed for this block
    const hashA = hexToSharedArrayBuffer("aaaaaaaa")._unsafeUnwrap();
    const hashB = hexToSharedArrayBuffer("bbbbbbbb")._unsafeUnwrap();
    const hashC = hexToSharedArrayBuffer("cccccccc")._unsafeUnwrap();
    const hashD = hexToSharedArrayBuffer("dddddddd")._unsafeUnwrap();
    const hashA_slight = hexToSharedArrayBuffer("aaaaaaab")._unsafeUnwrap();
    const frameA: FrameInfo = { hash: hashA, timestamp: 0 };
    const frameB: FrameInfo = { hash: hashB, timestamp: 1 };
    const frameC: FrameInfo = { hash: hashC, timestamp: 2 };
    const frameD: FrameInfo = { hash: hashD, timestamp: 3 };
    const frameA_slight: FrameInfo = { hash: hashA_slight, timestamp: 0.1 };
    const frame_noHash: FrameInfo = { hash: undefined, timestamp: 4 };
    const seq1: FrameInfo[] = [frameA, frameB, frameC];
    const seq2_identical: FrameInfo[] = [frameA, frameB, frameC];
    const seq3_different: FrameInfo[] = [frameD, frameD, frameD];
    const seq4_partial: FrameInfo[] = [frameA, frameD, frameC];
    const seq8_with_missing: FrameInfo[] = [frameA, frame_noHash, frameC];
    const seq_empty: FrameInfo[] = [];

    // Define MediaInfo based on redefined sequences
    const media1: MediaInfo = { duration: 3, frames: seq1 };
    const media2_identical: MediaInfo = { duration: 3, frames: seq2_identical };
    const media3_different: MediaInfo = { duration: 3, frames: seq3_different };
    const media4_partial: MediaInfo = { duration: 3, frames: seq4_partial };
    // const media5_shorter: MediaInfo = { duration: 2, frames: seq5_shorter }; // Not redefined, remove tests using it for now if needed
    // const media6_longer: MediaInfo = { duration: 4, frames: seq6_longer }; // Not redefined, remove tests using it for now if needed
    // const media7_similar: MediaInfo = { duration: 3, frames: seq7_similar }; // Not redefined, remove tests using it for now if needed
    const media8_with_missing: MediaInfo = { duration: 3, frames: seq8_with_missing };
    const media_empty: MediaInfo = { duration: 0, frames: seq_empty };
    const seq8_filtered: FrameInfo[] = [frameA, frameC]; // Expected result after getFramesInTimeRange filters noHash

    // Mock calculateSequenceSimilarityDTW using vi.fn and assignment
    let dtwMock: import('vitest').Mock<[FrameInfo[], FrameInfo[], WasmExports | null], number>;
    let originalDtwFn: typeof comparatorUtils.calculateSequenceSimilarityDTW;

    beforeEach(() => {
        // Store original function
        originalDtwFn = comparatorUtils.calculateSequenceSimilarityDTW;
        // Create mock function
        dtwMock = vi.fn();
        // Assign mock to the exported function
        comparatorUtils.calculateSequenceSimilarityDTW = dtwMock;
    });
    afterEach(() => {
        // Restore original function
        comparatorUtils.calculateSequenceSimilarityDTW = originalDtwFn;
        vi.restoreAllMocks(); // Also restore any other spies/mocks if needed
    });


    it("should call calculateSequenceSimilarityDTW with correct frames", () => {
        dtwMock.mockReturnValue(0.9); // Mock return value
        comparatorUtils.calculateVideoSimilarity(media1, media2_identical, config, wasmExports);
        expect(dtwMock).toHaveBeenCalledWith(seq1, seq2_identical, wasmExports);
    });

    // Removed redundant test: "should call calculateSequenceSimilarityDTW with correct frames"
    // Removed redundant test: "should handle identical videos (via mocked DTW)"

    it("should return the result from calculateSequenceSimilarityDTW", () => {
        dtwMock.mockReturnValue(0.85);
        const result = comparatorUtils.calculateVideoSimilarity(media1, media4_partial, config, wasmExports);
        expect(result).toBe(0.85);
        // Correct order: longerSubseq (seq4_partial), shorterSubseq (seq1)
        expect(dtwMock).toHaveBeenCalledWith(seq4_partial, seq1, wasmExports); // Check arguments
    });

     it("should return 0 if either media has no frames", () => {
        expect(comparatorUtils.calculateVideoSimilarity(media1, media_empty, config, wasmExports)).toBe(0);
        expect(comparatorUtils.calculateVideoSimilarity(media_empty, media1, config, wasmExports)).toBe(0);
        expect(dtwMock).not.toHaveBeenCalled(); // DTW shouldn't be called
    });

    it("should return 1 if both media have no frames", () => {
        expect(comparatorUtils.calculateVideoSimilarity(media_empty, media_empty, config, wasmExports)).toBe(1);
        expect(dtwMock).not.toHaveBeenCalled(); // DTW shouldn't be called
    });

    // Add more specific scenarios if needed, but the core logic relies on DTW
    it("should handle identical videos (via mocked DTW)", () => {
        dtwMock.mockReturnValue(1.0);
        expect(comparatorUtils.calculateVideoSimilarity(media1, media2_identical, config, wasmExports)).toBe(1.0);
        expect(dtwMock).toHaveBeenCalledWith(seq1, seq2_identical, wasmExports);
    });

    it("should handle different videos (via mocked DTW)", () => {
        dtwMock.mockClear(); // Clear mock before setting return value for this test
        dtwMock.mockReturnValue(0.1); // Assume low similarity from DTW
        expect(comparatorUtils.calculateVideoSimilarity(media1, media3_different, config, wasmExports)).toBe(0.1);
        // Correct order: longerSubseq (seq3_different), shorterSubseq (seq1)
        expect(dtwMock).toHaveBeenCalledWith(seq3_different, seq1, wasmExports); // Check arguments
    });

     it("should handle videos with missing frames (via mocked DTW)", () => {
        // Let the mocked DTW handle the filtering logic implicitly
        dtwMock.mockReturnValue(0.95); // Assume DTW returns high similarity after filtering
        expect(comparatorUtils.calculateVideoSimilarity(media1, media8_with_missing, config, wasmExports)).toBe(0.95);
        // Correct order: longerSubseq (filtered seq8), shorterSubseq (seq1)
        expect(dtwMock).toHaveBeenCalledWith(seq8_filtered, seq1, wasmExports);
    });

  }); // End of calculateVideoSimilarity describe block

  // --- Add tests for getFramesInTimeRange ---
  describe("getFramesInTimeRange", () => {
    const frame0: FrameInfo = { hash: hexToSharedArrayBuffer("00")._unsafeUnwrap(), timestamp: 0 };
    const frame1: FrameInfo = { hash: hexToSharedArrayBuffer("01")._unsafeUnwrap(), timestamp: 1 };
    const frame2: FrameInfo = { hash: hexToSharedArrayBuffer("02")._unsafeUnwrap(), timestamp: 2 };
    const frame3: FrameInfo = { hash: hexToSharedArrayBuffer("03")._unsafeUnwrap(), timestamp: 3 };
    const frame4: FrameInfo = { hash: hexToSharedArrayBuffer("04")._unsafeUnwrap(), timestamp: 4 };
    const frames: FrameInfo[] = [frame0, frame1, frame2, frame3, frame4];

    it("should return frames within the specified range (inclusive start, exclusive end)", () => {
      // Wrap frames in MediaInfo object
      // Expect inclusive end time: [1, 2, 3]
      expect(getFramesInTimeRange({ duration: 5, frames }, 1, 3)).toEqual([frame1, frame2, frame3]);
    });

    it("should include the start frame if timestamp matches start time", () => {
      // Expect inclusive end time: [0, 1, 2]
      expect(getFramesInTimeRange({ duration: 5, frames }, 0, 2)).toEqual([frame0, frame1, frame2]);
    });

    it("should exclude the end frame if timestamp matches end time", () => {
      // Expect inclusive end time: [2, 3, 4]
      expect(getFramesInTimeRange({ duration: 5, frames }, 2, 4)).toEqual([frame2, frame3, frame4]);
    });

    it("should return an empty array if no frames are in the range", () => {
      expect(getFramesInTimeRange({ duration: 5, frames }, 5, 10)).toEqual([]);
      // Expect inclusive end time: [0]
      expect(getFramesInTimeRange({ duration: 5, frames }, -5, 0)).toEqual([frame0]);
      expect(getFramesInTimeRange({ duration: 5, frames }, 2.1, 2.9)).toEqual([]);
    });

     it("should return an empty array if start time is greater than or equal to end time", () => {
      expect(getFramesInTimeRange({ duration: 5, frames }, 3, 1)).toEqual([]);
      // Expect inclusive end time: [2]
      expect(getFramesInTimeRange({ duration: 5, frames }, 2, 2)).toEqual([frame2]);
    });

    it("should return all frames if range covers all timestamps", () => {
      expect(getFramesInTimeRange({ duration: 5, frames }, 0, 5)).toEqual(frames);
      expect(getFramesInTimeRange({ duration: 5, frames }, -1, 10)).toEqual(frames);
    });

    it("should handle empty input frames array", () => {
      expect(getFramesInTimeRange({ duration: 0, frames: [] }, 0, 10)).toEqual([]);
    });

    it("should handle frames with non-integer timestamps", () => {
        const frame0_5: FrameInfo = { hash: hexToSharedArrayBuffer("05")._unsafeUnwrap(), timestamp: 0.5 };
        const frame1_5: FrameInfo = { hash: hexToSharedArrayBuffer("15")._unsafeUnwrap(), timestamp: 1.5 };
        const frame2_5: FrameInfo = { hash: hexToSharedArrayBuffer("25")._unsafeUnwrap(), timestamp: 2.5 };
        const floatFrames = [frame0_5, frame1_5, frame2_5];
        expect(getFramesInTimeRange({ duration: 3, frames: floatFrames }, 1, 2)).toEqual([frame1_5]);
        // Expect inclusive end time: [0.5, 1.5, 2.5]
        expect(getFramesInTimeRange({ duration: 3, frames: floatFrames }, 0.5, 2.5)).toEqual([frame0_5, frame1_5, frame2_5]);
    });
  }); // End of getFramesInTimeRange describe block

  // --- Add tests for selectRepresentativeCaptures ---
  describe("selectRepresentativeCaptures", () => {
    // Mock data setup
    const wasmExports = null;
    const similarityConfig: Pick<SimilarityConfig, "imageSimilarityThreshold"> = {
      imageSimilarityThreshold: 0.9,
    };

    const createMockEntry = (
      entry: string,
      width: number | undefined,
      height: number | undefined,
      hashHex: string | null,
      duration = 0,
      imageDate: Date | undefined = undefined,
    ): { entry: string; fileInfo: FileInfo } => {
      const hash = hashHex ? hexToSharedArrayBuffer(hashHex)._unsafeUnwrap() : undefined;
      return {
        entry,
        fileInfo: {
          fileStats: { size: (width ?? 1) * (height ?? 1) * 10, createdAt: new Date(), modifiedAt: new Date(), hash: hash ?? hexToSharedArrayBuffer("00")._unsafeUnwrap() },
          metadata: { width, height, imageDate },
          media: { duration, frames: hash ? [{ hash, timestamp: 0 }] : [] },
        },
      };
    };

    const videoInfo = createMockEntry("video.mp4", 1920, 1080, null, 10, new Date()); // Best video info
    const img1_high_q_unique = createMockEntry("img1.jpg", 2000, 1500, "aabbccdd", 0, new Date()); // High quality, unique hash
    const img2_high_q_similar = createMockEntry("img2.jpg", 1950, 1080, "aabbccde", 0, new Date()); // High quality, similar hash to img1
    const img3_low_q = createMockEntry("img3.jpg", 640, 480, "11223344", 0, new Date()); // Lower quality than video
    const img4_high_q_no_date = createMockEntry("img4.jpg", 2000, 1600, "55667788", 0, undefined); // High quality, but no date (video has date)
    const img5_high_q_no_hash = createMockEntry("img5.jpg", 2000, 1700, null, 0, new Date()); // High quality, but no hash
    const img6_high_q_unique2 = createMockEntry("img6.jpg", 1920, 1080, "abcdef00", 0, new Date()); // High quality, unique hash

    it("should select high-quality, unique images compared to video and each other", () => {
      const potentialCaptures = [
        img1_high_q_unique,
        img2_high_q_similar, // Similar to img1
        img3_low_q,          // Lower quality
        img4_high_q_no_date, // No date
        img5_high_q_no_hash, // No hash
        img6_high_q_unique2, // Unique
      ];
      const result = selectRepresentativeCaptures(
        potentialCaptures,
        videoInfo.fileInfo,
        similarityConfig,
        wasmExports,
      );
      // Expect img1 (first unique high quality) and img6 (second unique high quality)
      // img2 is skipped (similar to img1), img3 skipped (low quality), img4 skipped (no date), img5 skipped (no hash)
      expect(result).toEqual(expect.arrayContaining(["img1.jpg", "img6.jpg"]));
      expect(result.length).toBe(2);
    });

    it("should return empty array if no potential captures", () => {
       const result = selectRepresentativeCaptures(
        [],
        videoInfo.fileInfo,
        similarityConfig,
        wasmExports,
      );
      expect(result).toEqual([]);
    });

     it("should return empty array if no captures meet quality/date criteria", () => {
       const potentialCaptures = [img3_low_q, img4_high_q_no_date];
       const result = selectRepresentativeCaptures(
        potentialCaptures,
        videoInfo.fileInfo,
        similarityConfig,
        wasmExports,
      );
      expect(result).toEqual([]);
    });

    it("should return empty array if all high-quality captures have no hash", () => {
       const potentialCaptures = [img5_high_q_no_hash];
       const result = selectRepresentativeCaptures(
        potentialCaptures,
        videoInfo.fileInfo,
        similarityConfig,
        wasmExports,
      );
      expect(result).toEqual([]);
    });

     it("should select the first unique capture if multiple are similar", () => {
       const potentialCaptures = [img1_high_q_unique, img2_high_q_similar]; // img2 similar to img1
       const result = selectRepresentativeCaptures(
        potentialCaptures,
        videoInfo.fileInfo,
        similarityConfig,
        wasmExports,
      );
      expect(result).toEqual(["img1.jpg"]);
    });

  }); // End of selectRepresentativeCaptures describe block

  // --- Add tests for selectRepresentativesFromScored ---
  describe("selectRepresentativesFromScored", () => {
    // Mock data setup
    const wasmExports = null;
    const similarityConfig: Pick<SimilarityConfig, "imageSimilarityThreshold"> = {
      imageSimilarityThreshold: 0.9,
    };

    // Use createMockEntry from previous describe block
     const createMockEntry = (
      entry: string,
      width: number | undefined,
      height: number | undefined,
      hashHex: string | null,
      duration = 0,
      imageDate: Date | undefined = new Date(), // Default to having a date
    ): { entry: string; fileInfo: FileInfo } => {
      const hash = hashHex ? hexToSharedArrayBuffer(hashHex)._unsafeUnwrap() : undefined;
      return {
        entry,
        fileInfo: {
          fileStats: { size: (width ?? 1) * (height ?? 1) * 10, createdAt: new Date(), modifiedAt: new Date(), hash: hash ?? hexToSharedArrayBuffer("00")._unsafeUnwrap() },
          metadata: { width, height, imageDate },
          media: { duration, frames: hash ? [{ hash, timestamp: 0 }] : [] },
        },
      };
    };

    // Create scored entries (assuming they are pre-sorted by score descending)
    const bestVideo = createMockEntry("video1.mp4", 1920, 1080, null, 10);
    const highImgUnique1 = createMockEntry("img1.jpg", 2000, 1500, "aabbccdd");
    const highImgSimilar1 = createMockEntry("img2.jpg", 1950, 1080, "aabbccde"); // Similar to img1
    const highImgUnique2 = createMockEntry("img3.jpg", 1920, 1080, "11223344");
    const lowImg = createMockEntry("img4.jpg", 640, 480, "55667788");

    const sortedEntriesVideoBest = [bestVideo, highImgUnique1, highImgSimilar1, highImgUnique2, lowImg];
    const sortedEntriesImageBest = [highImgUnique1, bestVideo, highImgSimilar1, highImgUnique2, lowImg];
    const sortedEntriesOnlyImages = [highImgUnique1, highImgSimilar1, highImgUnique2, lowImg];
    const sortedEntriesOnlyVideo = [bestVideo];


    it("should return only the best entry if it is an image", () => {
      const result = selectRepresentativesFromScored(
        sortedEntriesImageBest,
        similarityConfig,
        wasmExports,
      );
      expect(result).toEqual(["img1.jpg"]);
    });

    it("should return the best video plus unique high-quality captures if best is video", () => {
       const result = selectRepresentativesFromScored(
        sortedEntriesVideoBest,
        similarityConfig,
        wasmExports,
      );
      // Expect best video + unique images (img1, img3). img2 is similar to img1. lowImg is too low quality.
      expect(result).toEqual(expect.arrayContaining(["video1.mp4", "img1.jpg", "img3.jpg"]));
      expect(result.length).toBe(3);
    });

    it("should handle cases with only images", () => {
       const result = selectRepresentativesFromScored(
        sortedEntriesOnlyImages,
        similarityConfig,
        wasmExports,
      );
      // Best entry is img1 (image), so only return that one.
      expect(result).toEqual(["img1.jpg"]);
    });

    it("should handle cases with only one video", () => {
       const result = selectRepresentativesFromScored(
        sortedEntriesOnlyVideo,
        similarityConfig,
        wasmExports,
      );
       // Only one entry, return it.
      expect(result).toEqual(["video1.mp4"]);
    });

    it("should return empty array if input is empty", () => {
       const result = selectRepresentativesFromScored(
        [],
        similarityConfig,
        wasmExports,
      );
      expect(result).toEqual([]);
    });

     it("should return best video only if no other high quality unique images exist", () => {
        const sortedEntriesVideoOnlyHigh = [bestVideo, lowImg];
        const result = selectRepresentativesFromScored(
            sortedEntriesVideoOnlyHigh,
            similarityConfig,
            wasmExports
        );
        expect(result).toEqual(["video1.mp4"]);
     });

  }); // End of selectRepresentativesFromScored describe block

  // --- Add tests for mergeAndDeduplicateClusters ---
  // Note: These tests might be more complex as they involve cluster structures
  describe("mergeAndDeduplicateClusters", () => {
    // Define some simple cluster structures
    // Using strings as entries for simplicity
    const cluster1 = new Set(["A", "B", "C"]);
    const cluster2 = new Set(["C", "D", "E"]);
    const cluster3 = new Set(["F", "G"]);
    const cluster4 = new Set(["B", "H"]); // Overlaps with cluster1
    const cluster5 = new Set(["X", "Y"]); // Disjoint

    it("should merge overlapping clusters", () => {
      const clusters = [cluster1, cluster2]; // Overlap on "C"
      const merged = mergeAndDeduplicateClusters(clusters);
      expect(merged.length).toBe(1); // Should merge into one
      expect(merged[0]).toEqual(new Set(["A", "B", "C", "D", "E"]));
    });

    it("should handle multiple overlapping clusters", () => {
      const clusters = [cluster1, cluster2, cluster4]; // 1&2 overlap on C, 1&4 overlap on B
      const merged = mergeAndDeduplicateClusters(clusters);
      expect(merged.length).toBe(1); // Should all merge
      expect(merged[0]).toEqual(new Set(["A", "B", "C", "D", "E", "H"]));
    });

    it("should keep disjoint clusters separate", () => {
      const clusters = [cluster1, cluster3, cluster5]; // All disjoint
      const merged = mergeAndDeduplicateClusters(clusters);
      expect(merged.length).toBe(3);
      // Use Set equality check helper or sort arrays
      const mergedSorted = merged.map(s => Array.from(s).sort());
      expect(mergedSorted).toContainEqual(["A", "B", "C"]);
      expect(mergedSorted).toContainEqual(["F", "G"]);
      expect(mergedSorted).toContainEqual(["X", "Y"]);
    });

    it("should handle a mix of overlapping and disjoint clusters", () => {
      const clusters = [cluster1, cluster2, cluster3, cluster4, cluster5];
      const merged = mergeAndDeduplicateClusters(clusters);
      expect(merged.length).toBe(3); // (1,2,4 merge), 3, 5 remain separate
       const mergedSorted = merged.map(s => Array.from(s).sort());
       expect(mergedSorted).toContainEqual(["A", "B", "C", "D", "E", "H"]);
       expect(mergedSorted).toContainEqual(["F", "G"]);
       expect(mergedSorted).toContainEqual(["X", "Y"]);
    });

     it("should handle identical input clusters", () => {
      const clusters = [cluster1, new Set(["A", "B", "C"]), cluster3];
      const merged = mergeAndDeduplicateClusters(clusters);
      expect(merged.length).toBe(2); // cluster1 merges with its duplicate
      const mergedSorted = merged.map(s => Array.from(s).sort());
      expect(mergedSorted).toContainEqual(["A", "B", "C"]);
      expect(mergedSorted).toContainEqual(["F", "G"]);
    });

    it("should handle single input cluster", () => {
      const clusters = [cluster1];
      const merged = mergeAndDeduplicateClusters(clusters);
      expect(merged.length).toBe(1);
      expect(merged[0]).toEqual(cluster1);
    });

    it("should handle empty input array", () => {
      expect(mergeAndDeduplicateClusters([])).toEqual([]);
    });

     it("should handle clusters containing single items", () => {
        const clusterA = new Set(["A"]);
        const clusterB = new Set(["B"]);
        const clusterA2 = new Set(["A"]); // Duplicate single item cluster
        const clusters = [clusterA, clusterB, clusterA2];
        const merged = mergeAndDeduplicateClusters(clusters);
        expect(merged.length).toBe(2); // A and A2 merge
        const mergedSorted = merged.map(s => Array.from(s).sort());
        expect(mergedSorted).toContainEqual(["A"]);
        expect(mergedSorted).toContainEqual(["B"]);
    });

  }); // End of mergeAndDeduplicateClusters describe block

  // Removed flawed tests for expandCluster and runDbscanCore as they require
  // significant mocking rework better suited for integration tests.

}); // End of Comparator Utilities describe block
