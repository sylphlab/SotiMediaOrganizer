import { gatherFileInfoFn } from '../src/gatherer';
import { processSingleFile } from '../src/fileProcessor';
import { MetadataDBService } from '../src/services/MetadataDBService';
import { CliReporter } from '../src/reporting/CliReporter';
import * as utils from '../src/utils'; // Import all utils for mocking getFileTypeByExt
import {
  GatherFileInfoResult,
  FileProcessorConfig,
  FileInfo,
  FileStatsConfig,
  AdaptiveExtractionConfig,
  FileType,
  MediaInfo,
  Metadata,
  FileStats,
} from '../src/types';
import { LmdbCache } from '../src/caching/LmdbCache';
import { ExifTool } from 'exiftool-vendored';
import { WorkerPool } from '../src/contexts/types';
import { ok, err, AppError, AppResult } from '../src/errors'; // Add AppResult import
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// Mocks will be defined inside vi.mock factories below

// Use vi.mock() for module mocking (mocks defined inside)
vi.mock('../src/fileProcessor', () => ({
  processSingleFile: vi.fn<typeof processSingleFile>(),
}));

vi.mock('../src/services/MetadataDBService', () => ({
  MetadataDBService: class {
    upsertFileInfo =
      vi.fn<(filePath: string, fileInfo: FileInfo) => AppResult<void>>();
    constructor() {}
    close() {}
  },
}));

vi.mock('../src/reporting/CliReporter', () => {
  const CliReporterMock = class {
    initializeMultiBar = vi.fn();
    updateProgress = vi.fn();
    stopMultiBar = vi.fn();
    logWarning = vi.fn();
    logError = vi.fn();
    logInfo = vi.fn();
    logSuccess = vi.fn();
    startSpinner = vi.fn();
    updateSpinnerText = vi.fn();
    stopSpinnerSuccess = vi.fn();
    stopSpinnerFailure = vi.fn();
    constructor() {}
  };
  return { CliReporter: CliReporterMock };
});

// We will spy on utils.getFileTypeByExt in beforeEach instead of using vi.mock

// Mock instances
const mockCache = {} as LmdbCache;
const mockExifTool = {} as ExifTool;
const mockWorkerPool = {
  exec: vi.fn(),
  terminate: vi.fn(),
  stats: vi.fn(),
} as unknown as WorkerPool;
// Create instances of the original classes (they will use mocked methods due to mock.module)
// No need for Jest casting here
const mockDbService = new MetadataDBService(':memory:');
const mockReporter = new CliReporter(false);

// Mock config
const mockFileStatsConfig: FileStatsConfig = {
  maxChunkSize: 1024 * 1024 * 100,
};
const mockAdaptiveExtractionConfig: AdaptiveExtractionConfig = {
  resolution: 720,
  sceneChangeThreshold: 0.3,
  minFrames: 5,
  maxSceneFrames: 50,
  targetFps: 1,
};
const mockConfig: FileProcessorConfig = {
  fileStats: mockFileStatsConfig,
  adaptiveExtraction: mockAdaptiveExtractionConfig,
};

// Mock FileInfo for successful processSingleFile
const mockFileInfo: FileInfo = {
  fileStats: {
    size: 100,
    createdAt: new Date(),
    modifiedAt: new Date(),
    hash: new SharedArrayBuffer(4),
  },
  metadata: { width: 100, height: 100 },
  media: { duration: 0, frames: [] },
};

// Mock error
const mockProcError = new AppError('Processing Error');
const mockDbError = new AppError('DB Error');

describe('gatherFileInfoFn', () => {
  // Variables to hold imported mocks
  let fileProcessorMock: typeof import('../src/fileProcessor');
  let dbServiceMockModule: typeof import('../src/services/MetadataDBService'); // Rename to avoid conflict
  let reporterMockModule: typeof import('../src/reporting/CliReporter'); // Rename to avoid conflict
  // No need for utilsMock variable
  let reporterInstance: CliReporter; // Instance of the mocked reporter
  let dbInstance: MetadataDBService; // Instance of the mocked DB service

  beforeEach(async () => {
    // Make beforeEach async
    // Reset mocks
    vi.resetAllMocks();

    // Import mocks
    fileProcessorMock = await vi.importMock('../src/fileProcessor');
    dbServiceMockModule = await vi.importMock(
      '../src/services/MetadataDBService',
    ); // Use renamed variable
    reporterMockModule = await vi.importMock('../src/reporting/CliReporter'); // Use renamed variable
    // No need to import utils mock

    // Instantiate mocked classes
    reporterInstance = new reporterMockModule.CliReporter(false); // Use renamed variable
    dbInstance = new dbServiceMockModule.MetadataDBService(':memory:'); // Use renamed variable

    // Apply default implementations
    (
      fileProcessorMock.processSingleFile as import('vitest').Mock
    ).mockResolvedValue(ok(mockFileInfo));
    (dbInstance.upsertFileInfo as import('vitest').Mock).mockImplementation(
      () => ok(undefined),
    );
    // Spy on and set default implementation for utils.getFileTypeByExt
    vi.spyOn(utils, 'getFileTypeByExt').mockReturnValue(ok(FileType.Image));
  });

  it('should process all files successfully and store in DB', async () => {
    const files = new Map<string, string[]>([
      ['.jpg', ['a.jpg', 'b.jpg']],
      ['.png', ['c.png']],
    ]);
    const concurrency = 2;

    const result = await gatherFileInfoFn(
      files,
      concurrency,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
      dbInstance,
      reporterInstance, // Use instances
    );

    expect(result.validFiles).toEqual(['a.jpg', 'b.jpg', 'c.png']);
    expect(result.errorFiles).toEqual([]);
    expect(fileProcessorMock.processSingleFile).toHaveBeenCalledTimes(3);
    expect(dbInstance.upsertFileInfo).toHaveBeenCalledTimes(3);
    expect(dbInstance.upsertFileInfo).toHaveBeenCalledWith(
      'a.jpg',
      mockFileInfo,
    );
    expect(dbInstance.upsertFileInfo).toHaveBeenCalledWith(
      'b.jpg',
      mockFileInfo,
    );
    expect(dbInstance.upsertFileInfo).toHaveBeenCalledWith(
      'c.png',
      mockFileInfo,
    );
    expect(reporterInstance.initializeMultiBar).toHaveBeenCalledTimes(1);
    expect(reporterInstance.updateProgress).toHaveBeenCalledTimes(3);
    expect(reporterInstance.stopMultiBar).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logError).not.toHaveBeenCalled();
    expect(reporterInstance.logWarning).not.toHaveBeenCalled();
  });

  it('should handle file processing errors', async () => {
    const files = new Map<string, string[]>([
      ['.jpg', ['a.jpg', 'error.jpg', 'b.jpg']],
    ]);
    const concurrency = 1;
    (
      fileProcessorMock.processSingleFile as import('vitest').Mock
    ).mockImplementation(async (filePath) => {
      // Use import('vitest').Mock
      if (filePath === 'error.jpg') {
        return err(mockProcError);
      }
      return ok(mockFileInfo);
    });

    const result = await gatherFileInfoFn(
      files,
      concurrency,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
      dbInstance,
      reporterInstance, // Use instances
    );

    expect(result.validFiles).toEqual(['a.jpg', 'b.jpg']);
    expect(result.errorFiles).toEqual(['error.jpg']);
    expect(fileProcessorMock.processSingleFile).toHaveBeenCalledTimes(3);
    expect(dbInstance.upsertFileInfo).toHaveBeenCalledTimes(2); // Only called for successful files
    expect(reporterInstance.logError).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logError).toHaveBeenCalledWith(
      expect.stringContaining('Error processing error.jpg'),
      mockProcError,
    );
    expect(reporterInstance.logWarning).not.toHaveBeenCalled();
    expect(reporterInstance.updateProgress).toHaveBeenCalledTimes(3); // Still updates progress for errors
  });

  it('should handle DB upsert errors', async () => {
    const files = new Map<string, string[]>([
      ['.jpg', ['a.jpg', 'db_error.jpg']],
    ]);
    const concurrency = 1;
    (dbInstance.upsertFileInfo as import('vitest').Mock).mockImplementation(
      (filePath: string, fileInfo: FileInfo) => {
        // Use import('vitest').Mock
        if (filePath === 'db_error.jpg') {
          // Return err directly inside implementation
          return err(new AppError('DB Error for test'));
        }
        // Return ok directly inside implementation
        return ok(undefined);
      },
    );

    const result = await gatherFileInfoFn(
      files,
      concurrency,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
      dbInstance,
      reporterInstance, // Use instances
    );

    // File is still considered valid even if DB upsert fails, but warning is logged
    expect(result.validFiles).toEqual(['a.jpg', 'db_error.jpg']);
    expect(result.errorFiles).toEqual([]);
    expect(fileProcessorMock.processSingleFile).toHaveBeenCalledTimes(2);
    expect(dbInstance.upsertFileInfo).toHaveBeenCalledTimes(2);
    expect(reporterInstance.logError).not.toHaveBeenCalled();
    expect(reporterInstance.logWarning).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('DB upsert failed for db_error.jpg'),
    ); // Warning logged
    expect(reporterInstance.updateProgress).toHaveBeenCalledTimes(2);
  });

  it('should handle empty file list', async () => {
    const files = new Map<string, string[]>();
    const concurrency = 2;

    const result = await gatherFileInfoFn(
      files,
      concurrency,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
      dbInstance,
      reporterInstance, // Use instances
    );

    expect(result.validFiles).toEqual([]);
    expect(result.errorFiles).toEqual([]);
    expect(fileProcessorMock.processSingleFile).not.toHaveBeenCalled();
    expect(dbInstance.upsertFileInfo).not.toHaveBeenCalled();
    expect(reporterInstance.initializeMultiBar).toHaveBeenCalledTimes(1); // Still initializes
    expect(reporterInstance.updateProgress).not.toHaveBeenCalled();
    expect(reporterInstance.stopMultiBar).toHaveBeenCalledTimes(1); // Still stops
  });

  it('should sort processing by file type and count', async () => {
    // Mock getFileTypeByExt for sorting log using the spy
    vi.spyOn(utils, 'getFileTypeByExt')
      .mockReturnValueOnce(ok(FileType.Video)) // .mp4
      .mockReturnValueOnce(ok(FileType.Image)); // .jpg
    const files = new Map<string, string[]>([
      ['.jpg', ['a.jpg', 'b.jpg', 'c.jpg']], // Image, 3 files
      ['.mp4', ['d.mp4', 'e.mp4']], // Video, 2 files
    ]);
    const concurrency = 1;

    await gatherFileInfoFn(
      files,
      concurrency,
      mockConfig,
      mockCache,
      mockExifTool,
      mockWorkerPool,
      dbInstance,
      reporterInstance, // Use instances
    );

    // Expect initialization order based on sorting: Video first (d.mp4, e.mp4), then Image (a.jpg, b.jpg, c.jpg)
    expect(reporterInstance.initializeMultiBar).toHaveBeenCalledWith(
      expect.arrayContaining(['.mp4', '.jpg']), // Check keys exist
      expect.any(Map), // Check totals map exists
    );
    // Check the order of keys passed to initializeMultiBar reflects sorting (Video first)
    const initArgs = (
      reporterInstance.initializeMultiBar as import('vitest').Mock
    ).mock.calls[0]; // Use import('vitest').Mock
    // Add check and cast to any[] to bypass TS tuple error
    if (initArgs) {
      const argsArray = initArgs; // Cast to any[]
      const sortedKeys = argsArray[0] as string[];
      const totalsMap = argsArray[1] as Map<string, number>;
      expect(sortedKeys).toEqual(['.mp4', '.jpg']);
      expect(sortedKeys).toEqual(['.mp4', '.jpg']);
      expect(totalsMap.get('.mp4')).toBe(2);
      expect(totalsMap.get('.jpg')).toBe(3);
    } else {
      // Fail the test explicitly if the mock wasn't called
      expect(reporterInstance.initializeMultiBar).toHaveBeenCalled();
    }

    // Check processing calls order (difficult to assert precisely due to concurrency, but check counts)
    expect(fileProcessorMock.processSingleFile).toHaveBeenCalledTimes(5);
    expect(reporterInstance.updateProgress).toHaveBeenCalledTimes(5);
  });
});
