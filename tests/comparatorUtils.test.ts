import {
  popcount8,
  popcount64,
  hammingDistance,
  calculateImageSimilarity,
  calculateImageVideoSimilarity,
  calculateSequenceSimilarityDTW,
  calculateEntryScore,
  getAdaptiveThreshold,
  getQuality,
  sortEntriesByScore,
  selectRepresentativeCaptures,
  selectRepresentativesFromScored,
} from "../src/comparatorUtils";
import { FileInfo, FrameInfo, MediaInfo, SimilarityConfig, FileStats, Metadata, FileType } from "../src/types";
import { hexToSharedArrayBuffer } from "../src/utils";

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
      expect(popcount64(0xAAAAAAAAAAAAAAAAn)).toBe(32n); // Alternating bits
      expect(popcount64(0x5555555555555555n)).toBe(32n); // Alternating bits
      expect(popcount64(1n << 0n | 1n << 63n)).toBe(2n);
      expect(popcount64(1234567890123456789n)).toEqual(expect.any(BigInt)); // Just check type for complex number
    });
  });

  describe("hammingDistance (JS Fallback)", () => {
    it("should return 0 for identical hashes", () => {
      const hash1 = hexToSharedArrayBuffer("ff00ff00ff00ff00"); // 8 bytes
      const hash2 = hexToSharedArrayBuffer("ff00ff00ff00ff00");
      expect(hammingDistance(hash1, hash2, null)).toBe(0);
    });

    it("should return correct distance for different hashes (full bytes)", () => {
      const hash1 = hexToSharedArrayBuffer("ff00ff00ff00ff00"); // 8 bytes = 64 bits
      const hash2 = hexToSharedArrayBuffer("00ff00ff00ff00ff"); // 8 bytes = 64 bits
      expect(hammingDistance(hash1, hash2, null)).toBe(64);
    });

     it("should return correct distance for hashes with partial differences", () => {
       const hash1 = hexToSharedArrayBuffer("ffffffffffffffff"); // 64 bits set
       const hash2 = hexToSharedArrayBuffer("fffffffffffffffe"); // 63 bits set (last bit 0)
       expect(hammingDistance(hash1, hash2, null)).toBe(1);

       const hash3 = hexToSharedArrayBuffer("0000000000000000"); // 0 bits set
       const hash4 = hexToSharedArrayBuffer("8000000000000001"); // 2 bits set (MSB and LSB)
       expect(hammingDistance(hash3, hash4, null)).toBe(2);
     });

     it("should handle hashes of different lengths (uses shorter length)", () => {
        const hash_8b = hexToSharedArrayBuffer("ff00ff00ff00ff00");
        const hash_7b = hexToSharedArrayBuffer("ff00ff00ff00ff"); // 7 bytes
        expect(hammingDistance(hash_8b, hash_7b, null)).toBe(0); // Corrected expectation: Only common bytes are compared first, then extra bytes of longer hash are compared to 0. hash_8b[7] is 0x00, popcount8(0x00) is 0.

        const hash_9b = hexToSharedArrayBuffer("ff00ff00ff00ff00aa"); // 9 bytes
        expect(hammingDistance(hash_9b, hash_8b, null)).toBe(4); // 4 bits difference from the last byte of hash_9b
     });

     it("should handle zero-length hashes", () => {
       const hash1 = hexToSharedArrayBuffer("");
       const hash2 = hexToSharedArrayBuffer("");
       expect(hammingDistance(hash1, hash2, null)).toBe(0);
     });
  });

  describe("calculateImageSimilarity", () => {
    it("should return 1 for identical frame hashes", () => {
      const frame1: FrameInfo = { hash: hexToSharedArrayBuffer("ff00ff00"), timestamp: 0 };
      const frame2: FrameInfo = { hash: hexToSharedArrayBuffer("ff00ff00"), timestamp: 1 };
      expect(calculateImageSimilarity(frame1, frame2, null)).toBe(1);
    });

    it("should return 0 for completely different frame hashes", () => {
      const frame1: FrameInfo = { hash: hexToSharedArrayBuffer("ffffffff"), timestamp: 0 };
      const frame2: FrameInfo = { hash: hexToSharedArrayBuffer("00000000"), timestamp: 1 };
      expect(calculateImageSimilarity(frame1, frame2, null)).toBe(0);
    });

    it("should return correct similarity for partially different hashes", () => {
      const frame1: FrameInfo = { hash: hexToSharedArrayBuffer("ffffffff"), timestamp: 0 };
      const frame2: FrameInfo = { hash: hexToSharedArrayBuffer("fffffffe"), timestamp: 1 };
      expect(calculateImageSimilarity(frame1, frame2, null)).toBeCloseTo(1 - 1 / 32);

      const frame3: FrameInfo = { hash: hexToSharedArrayBuffer("f0f0f0f0"), timestamp: 0 };
      const frame4: FrameInfo = { hash: hexToSharedArrayBuffer("0f0f0f0f"), timestamp: 1 };
      expect(calculateImageSimilarity(frame3, frame4, null)).toBe(0);

      const frame5: FrameInfo = { hash: hexToSharedArrayBuffer("aaaaaaaa"), timestamp: 0 };
      const frame6: FrameInfo = { hash: hexToSharedArrayBuffer("00000000"), timestamp: 1 };
      expect(calculateImageSimilarity(frame5, frame6, null)).toBe(0.5);
    });

     it("should return 0 if either frame hash is missing", () => {
       const frame1: FrameInfo = { hash: hexToSharedArrayBuffer("ff00ff00"), timestamp: 0 };
       const frame2: FrameInfo = { hash: undefined as any, timestamp: 1 }; // Simulate missing hash
       const frame3: FrameInfo = { hash: hexToSharedArrayBuffer("ff00ff00"), timestamp: 0 };
       expect(calculateImageSimilarity(frame1, frame2, null)).toBe(0);
       expect(calculateImageSimilarity(frame2, frame3, null)).toBe(0);
     });

     it("should return 1 if hash length is 0", () => {
        const frame1: FrameInfo = { hash: hexToSharedArrayBuffer(""), timestamp: 0 };
        const frame2: FrameInfo = { hash: hexToSharedArrayBuffer(""), timestamp: 1 };
        expect(calculateImageSimilarity(frame1, frame2, null)).toBe(1);
     });
  });

  describe("calculateEntryScore", () => {
    const baseStats: FileStats = {
        size: 1024 * 1024, // 1MB
        createdAt: new Date(2023, 0, 1),
        modifiedAt: new Date(2023, 0, 1),
        hash: hexToSharedArrayBuffer("d0d0d0d0")
    };
    const baseMeta: Metadata = { width: 1920, height: 1080 };
    const baseMedia: MediaInfo = { duration: 0, frames: [] };

    // Helper function now returns a complete FileInfo object
    const createMockFileInfo = (overrides: {
        fileStats?: Partial<FileStats>,
        metadata?: Partial<Metadata>,
        media?: Partial<MediaInfo>
    }): FileInfo => {
        return {
            fileStats: { ...baseStats, ...overrides.fileStats },
            metadata: { ...baseMeta, ...overrides.metadata },
            media: { ...baseMedia, ...overrides.media },
        };
    };

    it("should give higher score to videos", () => {
        const imageInfo: FileInfo = createMockFileInfo({ media: { duration: 0, frames: [] } }); // Ensure frames is provided
        const videoInfo: FileInfo = createMockFileInfo({ media: { duration: 10, frames: [] } }); // Ensure frames is provided
        expect(calculateEntryScore(videoInfo)).toBeGreaterThan(calculateEntryScore(imageInfo));
    });

    it("should give higher score for longer duration", () => {
        const videoInfoShort: FileInfo = createMockFileInfo({ media: { duration: 5, frames: [] } }); // Ensure frames is provided
        const videoInfoLong: FileInfo = createMockFileInfo({ media: { duration: 60, frames: [] } }); // Ensure frames is provided
        expect(calculateEntryScore(videoInfoLong)).toBeGreaterThan(calculateEntryScore(videoInfoShort));
    });

    it("should give higher score for more metadata", () => {
        const infoBasic: FileInfo = createMockFileInfo({});
        const infoWithDate: FileInfo = createMockFileInfo({ metadata: { ...baseMeta, imageDate: new Date() } });
        const infoWithGeo: FileInfo = createMockFileInfo({ metadata: { ...baseMeta, gpsLatitude: 1, gpsLongitude: 1 } });
        const infoWithCam: FileInfo = createMockFileInfo({ metadata: { ...baseMeta, cameraModel: "TestCam" } });
        const infoFullMeta: FileInfo = createMockFileInfo({ metadata: { ...baseMeta, imageDate: new Date(), gpsLatitude: 1, gpsLongitude: 1, cameraModel: "TestCam" } });

        expect(calculateEntryScore(infoWithDate)).toBeGreaterThan(calculateEntryScore(infoBasic));
        expect(calculateEntryScore(infoWithGeo)).toBeGreaterThan(calculateEntryScore(infoBasic));
        expect(calculateEntryScore(infoWithCam)).toBeGreaterThan(calculateEntryScore(infoBasic));
        expect(calculateEntryScore(infoFullMeta)).toBeGreaterThan(calculateEntryScore(infoWithDate));
        expect(calculateEntryScore(infoFullMeta)).toBeGreaterThan(calculateEntryScore(infoWithGeo));
        expect(calculateEntryScore(infoFullMeta)).toBeGreaterThan(calculateEntryScore(infoWithCam));
    });

     it("should give higher score for higher resolution", () => {
        const infoLowRes: FileInfo = createMockFileInfo({ metadata: { ...baseMeta, width: 640, height: 480 } });
        const infoHighRes: FileInfo = createMockFileInfo({ metadata: { ...baseMeta, width: 4000, height: 3000 } });
        expect(calculateEntryScore(infoHighRes)).toBeGreaterThan(calculateEntryScore(infoLowRes));
     });

     it("should give higher score for larger file size", () => {
        const infoSmall: FileInfo = createMockFileInfo({ fileStats: { ...baseStats, size: 1024 } });
        const infoLarge: FileInfo = createMockFileInfo({ fileStats: { ...baseStats, size: 10 * 1024 * 1024 } }); // 10MB
        expect(calculateEntryScore(infoLarge)).toBeGreaterThan(calculateEntryScore(infoSmall));
     });

      it("should handle missing width/height gracefully", () => {
         const infoNoDims: FileInfo = createMockFileInfo({ metadata: { ...baseMeta, width: undefined, height: undefined } });
         expect(calculateEntryScore(infoNoDims)).toBeGreaterThan(0); // Should still have base score from size etc.
      });

  });

  describe("getAdaptiveThreshold", () => {
    const config: Pick<SimilarityConfig, 'imageSimilarityThreshold' | 'imageVideoSimilarityThreshold' | 'videoSimilarityThreshold'> = {
        imageSimilarityThreshold: 0.9,
        imageVideoSimilarityThreshold: 0.8,
        videoSimilarityThreshold: 0.7
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
      const baseStats: FileStats = { size: 1, createdAt: new Date(), modifiedAt: new Date(), hash: hexToSharedArrayBuffer("aa") };
      const baseMedia: MediaInfo = { duration: 0, frames: [] };

      it("should calculate quality based on width and height", () => {
          const meta: Metadata = { width: 100, height: 50 };
          const fileInfo: FileInfo = { fileStats: baseStats, metadata: meta, media: baseMedia };
          expect(getQuality(fileInfo)).toBe(100 * 50);
      });

      it("should return 0 if width is missing", () => {
          const meta: Metadata = { width: undefined, height: 50 };
          const fileInfo: FileInfo = { fileStats: baseStats, metadata: meta, media: baseMedia };
          expect(getQuality(fileInfo)).toBe(0);
      });

      it("should return 0 if height is missing", () => {
          const meta: Metadata = { width: 100, height: undefined };
          const fileInfo: FileInfo = { fileStats: baseStats, metadata: meta, media: baseMedia };
          expect(getQuality(fileInfo)).toBe(0);
      });

       it("should return 0 if both width and height are missing", () => {
           const meta: Metadata = { width: undefined, height: undefined };
           const fileInfo: FileInfo = { fileStats: baseStats, metadata: meta, media: baseMedia };
           expect(getQuality(fileInfo)).toBe(0);
       });
  });

  describe("sortEntriesByScore", () => {
      const createMockFileInfo = (overrides: {
          fileStats?: Partial<FileStats>,
          metadata?: Partial<Metadata>,
          media?: Partial<MediaInfo>
      }): FileInfo => {
          // Helper to create FileInfo with specific values relevant to scoring
          const baseStats: FileStats = { size: 1000, createdAt: new Date(), modifiedAt: new Date(), hash: hexToSharedArrayBuffer("aa") };
          const baseMeta: Metadata = { width: 100, height: 100 };
          const baseMedia: MediaInfo = { duration: 0, frames: [] };
          return {
              fileStats: { ...baseStats, ...overrides.fileStats },
              metadata: { ...baseMeta, ...overrides.metadata },
              media: { ...baseMedia, ...overrides.media },
          };
      };

      it("should sort entries by score descending", () => {
          const info1 = createMockFileInfo({ metadata: { width: 200, height: 100 } }); // Higher score (resolution)
          const info2 = createMockFileInfo({ fileStats: { size: 500, hash: hexToSharedArrayBuffer("bb"), createdAt: new Date(), modifiedAt: new Date() } });   // Lower score
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
  // --- Add tests for calculateSequenceSimilarityDTW ---
  // --- Add tests for selectRepresentativeCaptures ---
  // --- Add tests for selectRepresentativesFromScored ---

});