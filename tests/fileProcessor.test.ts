import { processSingleFile } from "../src/fileProcessor";
import { processFileStats } from "../src/jobs/fileStats";
import { processMetadata } from "../src/jobs/metadataExtraction";
import { processAdaptiveExtraction } from "../src/jobs/adaptiveExtraction";
import {
  FileInfo,
  FileProcessorConfig,
  FileStats,
  Metadata,
  MediaInfo,
  FileStatsConfig,
  AdaptiveExtractionConfig,
} from "../src/types";
import { LmdbCache } from "../src/caching/LmdbCache";
import { ExifTool } from "exiftool-vendored";
import { WorkerPool } from "../src/contexts/types";
import { ok, err, AppError, AppResult } from "../src/errors";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals"; // Import from @jest/globals

// Use vi.mock() for module mocking
jest.mock("../src/jobs/fileStats", () => {
    // Define mock inside the factory
    const mockProcessFileStatsFn = jest.fn();
    return {
        processFileStats: mockProcessFileStatsFn,
        // Expose mock if needed (optional)
        // __mocks: { mockProcessFileStatsFn }
    };
});
jest.mock("../src/jobs/metadataExtraction", () => {
    // Define mock inside the factory
    const mockProcessMetadataFn = jest.fn();
    return {
        processMetadata: mockProcessMetadataFn,
        // Expose mock if needed (optional)
        // __mocks: { mockProcessMetadataFn }
    };
});
jest.mock("../src/jobs/adaptiveExtraction", () => {
    // Define mock inside the factory
    const mockProcessAdaptiveExtractionFn = jest.fn();
    return {
        processAdaptiveExtraction: mockProcessAdaptiveExtractionFn,
        // Expose mock if needed (optional)
        // __mocks: { mockProcessAdaptiveExtractionFn }
    };
});

// Create mock instances/values for dependencies
const mockCache = {} as LmdbCache; // Simple mock, actual methods not called by processSingleFile
const mockExifTool = {} as ExifTool; // Simple mock
const mockWorkerPool = {
  exec: jest.fn(),
  terminate: jest.fn(), // Use jest.fn()
  stats: jest.fn(), // Use jest.fn()
} as unknown as WorkerPool; // Mock the interface

// Helper function for hexToSharedArrayBuffer (moved outside describe)
// Note: In a real test setup, this might come from a shared test utility
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

// Update mock configs based on actual definitions in src/types.ts
const mockFileStatsConfig: FileStatsConfig = { maxChunkSize: 1024 * 1024 * 100 }; // Example value
const mockAdaptiveExtractionConfig: AdaptiveExtractionConfig = {
  resolution: 720, // Example value
  sceneChangeThreshold: 0.3, // Example value
  minFrames: 5, // Example value
  maxSceneFrames: 50, // Example value
  targetFps: 1, // Example value
};
const mockConfig: FileProcessorConfig = {
  fileStats: mockFileStatsConfig,
  adaptiveExtraction: mockAdaptiveExtractionConfig,
};

const mockFilePath = "/path/to/media.jpg";

// Mock data for successful results
const mockStats: FileStats = {
  size: 1024,
  createdAt: new Date(),
  modifiedAt: new Date(),
  hash: hexToSharedArrayBuffer("aabb")._unsafeUnwrap(), // Helper needed or use Buffer
};
const mockMeta: Metadata = { width: 1920, height: 1080 };
const mockMedia: MediaInfo = { duration: 0, frames: [] };

// Mock error
const mockError = new AppError("Test Error");

describe("processSingleFile", () => {
  // Access mocks through vi.importMock or directly if exposed via __mocks
  // We'll use vi.importMock for better type safety and clarity
  let mockedProcessFileStats: jest.Mock; // Use jest.Mock type
  let mockedProcessMetadata: jest.Mock; // Use jest.Mock type
  let mockedProcessAdaptiveExtraction: jest.Mock; // Use jest.Mock type

  // Define variables for console spy outside hooks
  let consoleErrorSpy: jest.Mock; // Use jest.Mock type
  let originalConsoleError: typeof console.error;

  beforeEach(async () => { // Make beforeEach async
    // Reset mocks using vi.clearAllMocks()
    jest.clearAllMocks();

    // Re-import mocks to get fresh instances for the test
    // With jest.mock at the top, the imported functions are already mocks
    // We need to cast them correctly or access the mock property if needed
    // Re-importing is not standard Jest practice here, access the already mocked import
    mockedProcessFileStats = processFileStats as jest.Mock;
    mockedProcessMetadata = processMetadata as jest.Mock;
    mockedProcessAdaptiveExtraction = processAdaptiveExtraction as jest.Mock;


    // Reset console spy if used
    // Assign spy in beforeEach
    consoleErrorSpy = jest.fn(() => {}); // Use jest.fn()
    originalConsoleError = console.error; // Store original
    console.error = consoleErrorSpy;
  });

   afterEach(() => {
    // Restore console spy
    // Restore original console.error
    // Restore original console.error if it was stored
    if (originalConsoleError) {
        console.error = originalConsoleError;
    }
  });


  it("should return ok(FileInfo) when all jobs succeed", async () => {
    // Arrange: Mock all jobs to return success
    mockedProcessFileStats.mockResolvedValue(ok(mockStats));
    mockedProcessMetadata.mockResolvedValue(ok(mockMeta));
    mockedProcessAdaptiveExtraction.mockResolvedValue(ok(mockMedia));

    // Act
    const result = await processSingleFile(
      mockFilePath,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
    );

    // Assert
    expect(result.isOk()).toBe(true);
    if (result.isOk()) { // Type guard
      expect(result.value).toEqual({
        fileStats: mockStats,
        metadata: mockMeta,
        media: mockMedia,
      });
    }
    expect(mockedProcessFileStats).toHaveBeenCalledWith(mockFilePath, mockConfig.fileStats, mockCache);
    expect(mockedProcessMetadata).toHaveBeenCalledWith(mockFilePath, mockExifTool, mockConfig.fileStats, mockCache);
    expect(mockedProcessAdaptiveExtraction).toHaveBeenCalledWith(mockFilePath, mockConfig.adaptiveExtraction, mockConfig.fileStats, mockCache, mockWorkerPool);
  });

  it("should return err when processFileStats fails", async () => {
    // Arrange: Mock fileStats to fail, others succeed
    mockedProcessFileStats.mockResolvedValue(err(mockError));
    mockedProcessMetadata.mockResolvedValue(ok(mockMeta));
    mockedProcessAdaptiveExtraction.mockResolvedValue(ok(mockMedia));

    // Act
    const result = await processSingleFile(
      mockFilePath,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
    );

    // Assert
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe(mockError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to get file stats"), mockError);
  });

  it("should return err when processMetadata fails", async () => {
    // Arrange: Mock metadata to fail, others succeed
    mockedProcessFileStats.mockResolvedValue(ok(mockStats));
    mockedProcessMetadata.mockResolvedValue(err(mockError));
    mockedProcessAdaptiveExtraction.mockResolvedValue(ok(mockMedia));

    // Act
    const result = await processSingleFile(
      mockFilePath,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
    );

    // Assert
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe(mockError);
     expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed to get metadata"), mockError);
  });

  it("should return err when processAdaptiveExtraction fails", async () => {
    // Arrange: Mock adaptiveExtraction to fail, others succeed
    mockedProcessFileStats.mockResolvedValue(ok(mockStats));
    mockedProcessMetadata.mockResolvedValue(ok(mockMeta));
    mockedProcessAdaptiveExtraction.mockResolvedValue(err(mockError));

    // Act
    const result = await processSingleFile(
      mockFilePath,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
    );

    // Assert
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toBe(mockError);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Failed adaptive extraction"), mockError);
  });

});