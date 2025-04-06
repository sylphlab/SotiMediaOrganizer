import { deduplicateFilesFn } from "../src/deduplicator";
import { MediaComparator } from "../MediaComparator";
import { MetadataDBService } from "../src/services/MetadataDBService";
import { CliReporter } from "../src/reporting/CliReporter";
import * as comparatorUtils from "../src/comparatorUtils";
import { FileInfoRow } from "../src/services/MetadataDBService"; // Import FileInfoRow
import * as utils from "../src/utils";
import {
  DeduplicationResult,
  FileInfo,
  SimilarityConfig,
  MediaInfo,
  DuplicateSet,
  FileStats,
  Metadata,
} from "../src/types";
import { ok, err, AppError, DatabaseError, AppResult } from "../src/errors";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";

// Mock dependencies
// jest.mock("../MediaComparator"); // Mock the class constructor and methods
// jest.mock("../src/services/MetadataDBService");
// jest.mock("../src/reporting/CliReporter");
// jest.mock("../src/comparatorUtils");
// jest.mock("../src/utils");

// --- Using Bun's mock.module ---
// Remove redundant top-level vi.fn definitions

// Use vi.mock() for module mocking
// Define mocks inside factories to avoid hoisting issues
vi.mock("../MediaComparator", () => ({
  MediaComparator: class {
    calculateSimilarity = vi.fn((info1: MediaInfo, info2: MediaInfo) => 0.95);
    processResults = vi.fn(async () => ok({ uniqueFiles: new Set<string>(), duplicateSets: [] as DuplicateSet[] }));
    constructor() {}
  },
}));
vi.mock("../src/services/MetadataDBService", () => ({
  MetadataDBService: class {
    getMultipleFileInfo = vi.fn(async () => ok(new Map<string, Partial<FileInfo>>()));
    getMediaInfoForFiles = vi.fn(async (paths: string[]) => ok(new Map<string, { pHash: string | null; mediaDuration: number | null }>()));
    findSimilarCandidates = vi.fn(async (targetFile: string, lshKeys: (string | null)[]) => ok([] as string[]));
    getFileInfo = vi.fn<(filePath: string) => AppResult<Partial<FileInfo>>>(); // Define signature here
    constructor() {}
    close() {}
    upsertFileInfo = vi.fn(() => ok(undefined));
  },
}));
vi.mock("../src/reporting/CliReporter", () => ({
  CliReporter: class {
    startSpinner = vi.fn();
    updateSpinnerText = vi.fn();
    stopSpinnerSuccess = vi.fn();
    stopSpinnerFailure = vi.fn();
    logWarning = vi.fn();
    logError = vi.fn();
    constructor() {}
    logInfo = vi.fn();
    logSuccess = vi.fn();
  },
}));
vi.mock("../src/comparatorUtils", async (importOriginal) => {
    const original = await importOriginal<typeof comparatorUtils>();
    return {
        ...original,
        mergeAndDeduplicateClusters: vi.fn((clusters: Set<string>[]) => clusters),
        getAdaptiveThreshold: vi.fn(() => 0.9),
    };
});
vi.mock("../src/utils", async (importOriginal) => {
    const original = await importOriginal<typeof utils>();
    return {
        ...original,
        bufferToSharedArrayBuffer: vi.fn(() => new SharedArrayBuffer(8)),
    };
});


// Mock instances (created after mocks are set up)
const mockComparator = new MediaComparator({} as any, {} as any, {} as any, {} as any, {} as any, {} as any); // Provide 6 args
const mockDbService = new MetadataDBService(":memory:");
const mockReporter = new CliReporter(false);

// Helper function for hexToSharedArrayBuffer
// Keep helper function, ensure AppResult is imported
function hexToSharedArrayBuffer(hex: string): AppResult<SharedArrayBuffer> {
  if (hex.length % 2 !== 0) {
    return err(new AppError(`Invalid hex string length: ${hex.length}`));
  }
  try {
    const buffer = Buffer.from(hex, 'hex');
    const sab = new SharedArrayBuffer(buffer.length);
    const view = new Uint8Array(sab);
    view.set(buffer);
    return ok(sab);
  } catch (e: any) {
    return err(new AppError(`Failed to convert hex to SharedArrayBuffer: ${e.message}`, { cause: e }));
  }
}

// Mock config
const mockSimilarityConfig: SimilarityConfig = {
  windowSize: 5, stepSize: 1, imageSimilarityThreshold: 0.9, imageVideoSimilarityThreshold: 0.8, videoSimilarityThreshold: 0.7,
};

// Mock data
// Use vi.fn() for mockBufferToSABFn call
// Use vi.fn() for mockBufferToSABFn call
// Use vi.fn() for mockBufferToSABFn call
// Use vi.fn() for mockBufferToSABFn call
// Use a simple SharedArrayBuffer directly for mock data, or import the mocked function
const mockSAB = new SharedArrayBuffer(8);
const mockFileInfoA: FileInfo = { fileStats: { hash: mockSAB, size: 100 } as FileStats, metadata: {} as Metadata, media: { duration: 0, frames: [{ hash: mockSAB, timestamp: 0 }] } };
const mockFileInfoB: FileInfo = { fileStats: { hash: mockSAB, size: 110 } as FileStats, metadata: {} as Metadata, media: { duration: 0, frames: [{ hash: mockSAB, timestamp: 0 }] } };
const mockFileInfoC: FileInfo = { fileStats: { hash: mockSAB, size: 120 } as FileStats, metadata: {} as Metadata, media: { duration: 5, frames: [{ hash: mockSAB, timestamp: 0 }] } }; // Video


describe("deduplicateFilesFn", () => {
  // Use vi.mocked() on the original imported functions/methods
  // Note: For methods on classes, access them via the instance
  // Need to await dynamic imports for utils and comparatorUtils inside an async context (e.g., beforeAll or test)
  // Let's define them inside beforeEach for simplicity for now.
  // Declare variables for mocked functions/methods
  let mockedCalculateSimilarity: ReturnType<typeof vi.mocked<MediaComparator['calculateSimilarity']>>;
  let mockedProcessResults: ReturnType<typeof vi.mocked<MediaComparator['processResults']>>;
  let mockedGetMultipleFileInfo: ReturnType<typeof vi.mocked<MetadataDBService['getMultipleFileInfo']>>;
  let mockedGetMediaInfoForFiles: ReturnType<typeof vi.mocked<MetadataDBService['getMediaInfoForFiles']>>;
  let mockedFindSimilarCandidates: ReturnType<typeof vi.mocked<MetadataDBService['findSimilarCandidates']>>;
  let mockedGetFileInfo: ReturnType<typeof vi.mocked<MetadataDBService['getFileInfo']>>;
  let mockedStartSpinner: ReturnType<typeof vi.mocked<CliReporter['startSpinner']>>;
  let mockedUpdateSpinnerText: ReturnType<typeof vi.mocked<CliReporter['updateSpinnerText']>>;
  let mockedStopSpinnerSuccess: ReturnType<typeof vi.mocked<CliReporter['stopSpinnerSuccess']>>;
  let mockedStopSpinnerFailure: ReturnType<typeof vi.mocked<CliReporter['stopSpinnerFailure']>>;
  let mockedLogWarning: ReturnType<typeof vi.mocked<CliReporter['logWarning']>>;
  let mockedLogError: ReturnType<typeof vi.mocked<CliReporter['logError']>>;
  let mockedMergeClusters: ReturnType<typeof vi.mocked<typeof comparatorUtils.mergeAndDeduplicateClusters>>;
  let mockedGetAdaptiveThreshold: ReturnType<typeof vi.mocked<typeof comparatorUtils.getAdaptiveThreshold>>;
  let mockedBufferToSAB: ReturnType<typeof vi.mocked<typeof utils.bufferToSharedArrayBuffer>>;

  beforeEach(async () => {
    // Import actual functions here to use with vi.mocked
    // Need to cast the imported module because vi.mock factory returns a different type
    const actualComparatorUtils = await import("../src/comparatorUtils") as typeof comparatorUtils;
    const actualUtils = await import("../src/utils") as typeof utils;

    // Assign mocked variables
    mockedCalculateSimilarity = vi.mocked(mockComparator.calculateSimilarity);
    mockedProcessResults = vi.mocked(mockComparator.processResults);
    mockedGetMultipleFileInfo = vi.mocked(mockDbService.getMultipleFileInfo);
    mockedGetMediaInfoForFiles = vi.mocked(mockDbService.getMediaInfoForFiles);
    mockedFindSimilarCandidates = vi.mocked(mockDbService.findSimilarCandidates);
    mockedGetFileInfo = vi.mocked(mockDbService.getFileInfo);
    mockedStartSpinner = vi.mocked(mockReporter.startSpinner);
    mockedUpdateSpinnerText = vi.mocked(mockReporter.updateSpinnerText);
    mockedStopSpinnerSuccess = vi.mocked(mockReporter.stopSpinnerSuccess);
    mockedStopSpinnerFailure = vi.mocked(mockReporter.stopSpinnerFailure);
    mockedLogWarning = vi.mocked(mockReporter.logWarning);
    mockedLogError = vi.mocked(mockReporter.logError);
    mockedMergeClusters = vi.mocked(actualComparatorUtils.mergeAndDeduplicateClusters);
    mockedGetAdaptiveThreshold = vi.mocked(actualComparatorUtils.getAdaptiveThreshold);
    mockedBufferToSAB = vi.mocked(actualUtils.bufferToSharedArrayBuffer);

    // Reset all mocks
    mockedCalculateSimilarity.mockClear();
    mockedProcessResults.mockClear();
    mockedGetMultipleFileInfo.mockClear();
    mockedGetMediaInfoForFiles.mockClear();
    mockedFindSimilarCandidates.mockClear();
    mockedGetFileInfo.mockClear();
    mockedStartSpinner.mockClear();
    mockedUpdateSpinnerText.mockClear();
    mockedStopSpinnerSuccess.mockClear();
    mockedStopSpinnerFailure.mockClear();
    mockedLogWarning.mockClear();
    mockedLogError.mockClear();
    mockedMergeClusters.mockClear();
    mockedGetAdaptiveThreshold.mockClear();
    mockedBufferToSAB.mockClear();

    // Reset default implementations
    mockedCalculateSimilarity.mockReturnValue(0.95);
    mockedProcessResults.mockResolvedValue(ok({ uniqueFiles: new Set<string>(), duplicateSets: [] }));
    mockedGetMultipleFileInfo.mockResolvedValue(ok(new Map()));
    mockedGetMediaInfoForFiles.mockResolvedValue(ok(new Map()));
    mockedFindSimilarCandidates.mockResolvedValue(ok([]));
    mockedGetFileInfo.mockReturnValue(ok(mockFileInfoA as Partial<FileInfo>));
    mockedMergeClusters.mockImplementation((clusters: Set<string>[]) => clusters);
    mockedGetAdaptiveThreshold.mockReturnValue(0.9);
    // Correct the mock implementation to return SharedArrayBuffer directly
    mockedBufferToSAB.mockImplementation((buffer: Buffer): SharedArrayBuffer => {
        const sab = new SharedArrayBuffer(buffer.length);
        const view = new Uint8Array(sab);
        view.set(buffer);
        return sab;
    });
  });


  // Removed old beforeEach block

  it("should return empty result for empty input", async () => {
    const result = await deduplicateFilesFn([], mockComparator, mockDbService, mockSimilarityConfig, mockReporter);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.uniqueFiles.size).toBe(0);
      expect(result.value.duplicateSets.length).toBe(0);
    }
    expect(mockedGetMultipleFileInfo).toHaveBeenCalledTimes(1); // Still called once
    expect(mockedFindSimilarCandidates).not.toHaveBeenCalled();
    expect(mockedProcessResults).toHaveBeenCalledTimes(1); // Called with empty clusters
    expect(mockedMergeClusters).toHaveBeenCalledWith([]);
  });

  it("should handle only exact duplicates", async () => {
    const files = ["a.jpg", "b.jpg", "c.png"];
    const pHashAB = "aabbccddeeff0011";
    const pHashC = "1122334455667788";

    // Mock DB responses
    // Ensure mock data includes duration for Partial<FileInfo> compatibility
    // Use helper to create SharedArrayBuffer for hash
    const hashABResult = hexToSharedArrayBuffer(pHashAB);
    const hashCResult = hexToSharedArrayBuffer(pHashC);
    if (hashABResult.isErr() || hashCResult.isErr()) throw new Error("Failed to create mock hashes"); // Should not happen in test setup
    const hashAB = hashABResult.value;
    const hashC = hashCResult.value;

    mockedGetMultipleFileInfo.mockResolvedValue(ok(new Map<string, Partial<FileInfo>>([
      ["a.jpg", { media: { duration: 0, frames: [{ hash: hashAB, timestamp: 0 }] } }],
      ["b.jpg", { media: { duration: 0, frames: [{ hash: hashAB, timestamp: 0 }] } }],
      ["c.png", { media: { duration: 0, frames: [{ hash: hashC, timestamp: 0 }] } }],
    ])));
    // Mock processResults to reflect the exact duplicate cluster
    const exactCluster = new Set(["a.jpg", "b.jpg"]);
    mockedMergeClusters.mockReturnValue([exactCluster]); // Only exact cluster found
    mockedProcessResults.mockResolvedValue(ok({
        uniqueFiles: new Set(["c.png"]), // c is unique
        duplicateSets: [{ bestFile: "a.jpg", representatives: new Set(["a.jpg"]), duplicates: new Set(["b.jpg"]) }]
    }));
     mockedGetFileInfo.mockImplementation((file: string) => {
        if (file === 'a.jpg') return ok(mockFileInfoA as Partial<FileInfo>); // Cast for mock return
        if (file === 'b.jpg') return ok(mockFileInfoB as Partial<FileInfo>); // Cast for mock return
        if (file === 'c.png') return ok(mockFileInfoC as Partial<FileInfo>); // Cast for mock return
        return err(new DatabaseError("Not found"));
    });


    const result = await deduplicateFilesFn(files, mockComparator, mockDbService, mockSimilarityConfig, mockReporter);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.uniqueFiles).toEqual(new Set(["c.png"]));
      expect(result.value.duplicateSets.length).toBe(1);
      expect(result.value.duplicateSets[0].duplicates).toEqual(new Set(["b.jpg"]));
    }
    expect(mockedFindSimilarCandidates).not.toHaveBeenCalled(); // No similarity check needed
    expect(mockedMergeClusters).toHaveBeenCalledWith([exactCluster]);
    expect(mockedProcessResults).toHaveBeenCalledWith([exactCluster], expect.any(Function));
  });


  it("should handle only similarity duplicates", async () => {
    const files = ["simA1.jpg", "simA2.jpg", "uniqueB.png"];
    const pHashA1 = "aabbccddeeff0011";
    const pHashA2 = "aabbccddeeff0012"; // Slightly different
    const pHashB = "1122334455667788";

    const hashA1Result = hexToSharedArrayBuffer(pHashA1);
    const hashA2Result = hexToSharedArrayBuffer(pHashA2);
    const hashBResult = hexToSharedArrayBuffer(pHashB);
    if (hashA1Result.isErr() || hashA2Result.isErr() || hashBResult.isErr()) throw new Error("Failed to create mock hashes");
    const hashA1 = hashA1Result.value;
    const hashA2 = hashA2Result.value;
    const hashB = hashBResult.value;

    // Mock DB responses
    mockedGetMultipleFileInfo.mockResolvedValue(ok(new Map<string, Partial<FileInfo>>([
      ["simA1.jpg", { media: { duration: 0, frames: [{ hash: hashA1, timestamp: 0 }] } }],
      ["simA2.jpg", { media: { duration: 0, frames: [{ hash: hashA2, timestamp: 0 }] } }],
      ["uniqueB.png", { media: { duration: 0, frames: [{ hash: hashB, timestamp: 0 }] } }],
    ])));
    // Mock MediaInfo needed for LSH candidate check and similarity calc
     // Correct the mock implementation signature and return type
     mockedGetMediaInfoForFiles.mockImplementation((paths): AppResult<Map<string, Pick<FileInfoRow, "pHash" | "mediaDuration">>> => {
        const map = new Map<string, Pick<FileInfoRow, "pHash" | "mediaDuration">>();
        if (paths.includes("simA1.jpg")) map.set("simA1.jpg", { pHash: pHashA1, mediaDuration: 0 });
        if (paths.includes("simA2.jpg")) map.set("simA2.jpg", { pHash: pHashA2, mediaDuration: 0 });
        if (paths.includes("uniqueB.png")) map.set("uniqueB.png", { pHash: pHashB, mediaDuration: 0 });
        return ok(map);
    });
    // Mock LSH candidates: A1 finds A2
    mockedFindSimilarCandidates.mockImplementation((targetFile): AppResult<string[]> => { // Return AppResult directly
        if (targetFile === "simA1.jpg") return ok(["simA2.jpg"]);
        if (targetFile === "simA2.jpg") return ok(["simA1.jpg"]); // Assume symmetric for simplicity
        if (targetFile === "uniqueB.png") return ok([]);
        return ok([]);
    });
    // Mock similarity calculation: A1 and A2 are similar
    mockedCalculateSimilarity.mockImplementation((info1: MediaInfo, info2: MediaInfo) => {
        // Compare SharedArrayBuffers directly (assuming they are passed correctly)
        const hash1 = info1.frames[0]?.hash;
        const hash2 = info2.frames[0]?.hash;

        // Helper to compare SharedArrayBuffers (implement if needed, or use a library)
        const compareSAB = (sab1: SharedArrayBuffer | undefined, sab2: SharedArrayBuffer | undefined): boolean => {
            if (!sab1 || !sab2 || sab1.byteLength !== sab2.byteLength) return false;
            const view1 = new Uint8Array(sab1);
            const view2 = new Uint8Array(sab2);
            for (let i = 0; i < sab1.byteLength; i++) {
                if (view1[i] !== view2[i]) return false;
            }
            return true;
        };

        // Check if the hashes match the expected pairs (A1/A2)
        const hashA1SAB = hexToSharedArrayBuffer(pHashA1)._unsafeUnwrap(); // Convert hex to SAB for comparison
        const hashA2SAB = hexToSharedArrayBuffer(pHashA2)._unsafeUnwrap();

        if ((compareSAB(hash1, hashA1SAB) && compareSAB(hash2, hashA2SAB)) ||
            (compareSAB(hash1, hashA2SAB) && compareSAB(hash2, hashA1SAB))) {
            return 0.95; // High similarity for the expected pair
        }
        return 0.1; // Low similarity otherwise
    });
    // Mock merge to return the similarity cluster
    const simCluster = new Set(["simA1.jpg", "simA2.jpg"]);
    mockedMergeClusters.mockReturnValue([simCluster]);
    // Mock processResults
    mockedProcessResults.mockResolvedValue(ok({
        uniqueFiles: new Set(["uniqueB.png"]),
        duplicateSets: [{ bestFile: "simA1.jpg", representatives: new Set(["simA1.jpg"]), duplicates: new Set(["simA2.jpg"]) }]
    }));
    // Mock getFileInfo for scoring in processResults
    mockedGetFileInfo.mockImplementation((file: string) => {
        if (file === 'simA1.jpg') return ok(mockFileInfoA as Partial<FileInfo>); // Cast for mock return
        if (file === 'simA2.jpg') return ok(mockFileInfoB as Partial<FileInfo>); // Cast for mock return
        if (file === 'uniqueB.png') return ok(mockFileInfoC as Partial<FileInfo>); // Cast for mock return
        return err(new DatabaseError("Not found"));
    });

    const result = await deduplicateFilesFn(files, mockComparator, mockDbService, mockSimilarityConfig, mockReporter);

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
        expect(result.value.uniqueFiles).toEqual(new Set(["uniqueB.png"]));
        expect(result.value.duplicateSets.length).toBe(1);
        expect(result.value.duplicateSets[0].duplicates).toEqual(new Set(["simA2.jpg"]));
    }
    expect(mockedGetMultipleFileInfo).toHaveBeenCalledTimes(1);
    expect(mockedFindSimilarCandidates).toHaveBeenCalledTimes(2); // Called for A1 and B, A2 skipped
    expect(mockedCalculateSimilarity).toHaveBeenCalled(); // Check it was called
    expect(mockedMergeClusters).toHaveBeenCalledWith(expect.any(Array)); // Check if called with an array
    // Optionally, check the contents more loosely if needed
    const mergeArgs = mockedMergeClusters.mock.calls[0][0] as Set<string>[];
    expect(mergeArgs.length).toBe(1);
    expect(mergeArgs[0]).toEqual(simCluster);
    expect(mockedProcessResults).toHaveBeenCalledWith([simCluster], expect.any(Function));
  });

  // Add more tests for similarity, mixed cases, errors etc.

});