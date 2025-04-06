import { gatherFileInfoFn } from '../src/gatherer';
import { LmdbCache } from '../src/caching/LmdbCache';
import { MetadataDBService } from '../src/services/MetadataDBService';
import { CliReporter } from '../src/reporting/CliReporter';
import { processSingleFile } from '../src/fileProcessor'; // Import to mock
import { ExifTool } from 'exiftool-vendored';
import { WorkerPool } from '../src/contexts/types';
import { FileProcessorConfig, FileInfo } from '../src/types'; // Removed unused FileType
import { ok, err, FileSystemError, DatabaseError } from '../src/errors'; // Removed unused AppResult, AppError
import { bufferToSharedArrayBuffer } from '../src/utils'; // Import buffer utility

import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
  afterEach,
  vi, // Import vi from vitest instead of jest
} from 'vitest'; // Use vitest imports

// --- Mocking Dependencies ---
// Mock processSingleFile using vi.mock
vi.mock('../src/fileProcessor');
const mockProcessSingleFile = processSingleFile as MockedFunction<
  typeof processSingleFile
>; // Use MockedFunction directly

// Mock CliReporter
class MockCliReporter extends CliReporter {
  initializeMultiBar = vi.fn(); // Use vi.fn()
  updateProgress = vi.fn(); // Use vi.fn()
  stopMultiBar = vi.fn(); // Use vi.fn()
  logError = vi.fn(); // Use vi.fn()
  logWarning = vi.fn(); // Use vi.fn()
  logInfo = vi.fn(); // Use vi.fn()
  logSuccess = vi.fn(); // Use vi.fn()
  // Add any other methods used by gatherFileInfoFn if necessary
  constructor() {
    super(false);
  } // Call super with verbose=false
}

// Mock ExifTool (basic mock, methods might need specific implementations if used)
const mockExifTool = {
  read: vi.fn(), // Use vi.fn()
  write: vi.fn(), // Use vi.fn()
  end: vi.fn(), // Use vi.fn()
} as unknown as ExifTool;

// Mock WorkerPool (basic mock)
const mockWorkerPool = {
  exec: vi.fn(), // Use vi.fn()
  terminate: vi.fn(), // Use vi.fn()
} as unknown as WorkerPool;
// --- End Mocking ---

// --- Test Setup ---
const TEST_GATHERER_DB_DIR = '.test-gatherer-db';
const TEST_GATHERER_CACHE_PATH = join(
  TEST_GATHERER_DB_DIR,
  'gatherer-cache.lmdb',
);
const TEST_GATHERER_SQLITE_PATH = join(
  TEST_GATHERER_DB_DIR,
  'gatherer-meta.sqlite',
);

// Sample FileInfo for mocking success - Structure based on src/types.ts
const sampleContentHash = Buffer.from('contenthash12345').toString('hex');
const samplePHash = Buffer.from('phas1234phas5678').toString('hex'); // 64-bit / 16 hex chars
const sampleFileInfo: FileInfo = {
  fileStats: {
    hash: bufferToSharedArrayBuffer(Buffer.from(sampleContentHash, 'hex')),
    size: 1024,
    createdAt: new Date(),
    modifiedAt: new Date(),
  },
  metadata: {
    width: 800,
    height: 600,
    imageDate: new Date(),
    cameraModel: 'TestCam',
    gpsLatitude: 10.0,
    gpsLongitude: 20.0,
  },
  media: {
    duration: 0, // 0 for images
    frames: [
      {
        hash: bufferToSharedArrayBuffer(Buffer.from(samplePHash, 'hex')),
        timestamp: 0,
      },
    ],
  },
  // fileType is not part of FileInfo, it's derived
  // dimensions are part of metadata
};

// Skip this entire suite when running in Bun due to better-sqlite3 native module issues
describe.skip('gatherFileInfoFn Integration Tests (Skipped in Bun)', () => {
  let cache: LmdbCache;
  let dbService: MetadataDBService;
  let reporter: MockCliReporter;
  let config: FileProcessorConfig;

  beforeAll(async () => {
    // Create test directory
    if (!existsSync(TEST_GATHERER_DB_DIR)) {
      mkdirSync(TEST_GATHERER_DB_DIR);
    }
    // Create real cache and DB instances for testing
    const cacheResult = await LmdbCache.create(TEST_GATHERER_CACHE_PATH);
    if (cacheResult.isErr()) throw new Error('Failed to create test cache');
    cache = cacheResult.value;
    // DB is created in beforeEach now
  });

  afterAll(async () => {
    // Keep afterAll for cache cleanup
    // Close connections and clean up
    await cache.close(); // Close cache here
    // DB cleanup happens in beforeEach/afterEach
    // Add delay before removing directory
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (existsSync(TEST_GATHERER_DB_DIR)) {
      // Only remove the directory if it still exists (might be cleaned by afterEach)
      rmSync(TEST_GATHERER_DB_DIR, { recursive: true, force: true });
    }
  });

  afterEach(async () => {
    // Ensure DB connection is closed after each test
    await dbService.close();
    // Clean up the specific test DB file after each test
    if (existsSync(TEST_GATHERER_SQLITE_PATH)) {
      rmSync(TEST_GATHERER_SQLITE_PATH);
    }
  });

  beforeEach(async () => {
    // Renamed from previous beforeEach
    // Reset mocks
    vi.clearAllMocks(); // Use vi.clearAllMocks()

    // Clean up previous DB file if exists and create new DB instance
    if (existsSync(TEST_GATHERER_SQLITE_PATH)) {
      rmSync(TEST_GATHERER_SQLITE_PATH);
    }
    // Use constructor directly
    dbService = new MetadataDBService(
      TEST_GATHERER_DB_DIR,
      'gatherer-meta.sqlite',
    );
    // LMDB cache is reused across tests in this suite, assuming keys are unique enough or overwrite is ok.

    reporter = new MockCliReporter();
    // Define a valid FileProcessorConfig based on src/types.ts
    config = {
      fileStats: {
        maxChunkSize: 2 * 1024 * 1024,
      },
      adaptiveExtraction: {
        resolution: 64,
        sceneChangeThreshold: 0.01,
        minFrames: 5,
        maxSceneFrames: 100,
        targetFps: 2,
      },
      // featureExtraction and similarity are not part of FileProcessorConfig
    };
  });

  it('should process files successfully and store results in DB', async () => {
    const files = new Map<string, string[]>([
      ['jpg', ['path/image1.jpg', 'path/image2.jpg']],
      ['mp4', ['path/video1.mp4']],
    ]);
    const totalFiles = 3;

    // Mock processSingleFile to always succeed
    mockProcessSingleFile.mockImplementation(
      async (filePath) => ok({ ...sampleFileInfo, path: filePath }), // Return unique path in FileInfo
    );

    const result = await gatherFileInfoFn(
      files,
      2, // concurrency
      config,
      cache,
      mockExifTool,
      mockWorkerPool,
      dbService,
      reporter,
    );

    // Assertions
    expect(result.validFiles).toHaveLength(totalFiles);
    expect(result.errorFiles).toHaveLength(0);
    expect(result.validFiles).toContain('path/image1.jpg');
    expect(result.validFiles).toContain('path/image2.jpg');
    expect(result.validFiles).toContain('path/video1.mp4');

    // Check DB content using correct structure and optional chaining
    const dbCheck1Result = await dbService.getFileInfo('path/image1.jpg');
    expect(dbCheck1Result.isOk()).toBe(true);
    const dbData1 = dbCheck1Result._unsafeUnwrap();
    expect(dbData1).toBeDefined();
    // Check reconstructed pHash (first frame hash)
    const pHash1 = dbData1?.media?.frames[0]?.hash;
    expect(pHash1).toBeDefined();
    expect(Buffer.from(pHash1!).toString('hex')).toBe(samplePHash);
    // Check another field like width
    expect(dbData1?.metadata?.width).toBe(sampleFileInfo.metadata.width);

    const dbCheck2Result = await dbService.getFileInfo('path/video1.mp4');
    expect(dbCheck2Result.isOk()).toBe(true);
    const dbData2 = dbCheck2Result._unsafeUnwrap();
    expect(dbData2).toBeDefined();
    // Check reconstructed content hash
    const contentHash2 = dbData2?.fileStats?.hash;
    expect(contentHash2).toBeDefined();
    expect(Buffer.from(contentHash2!).toString('hex')).toBe(sampleContentHash);

    // Check reporter calls
    expect(reporter.initializeMultiBar).toHaveBeenCalledTimes(1);
    expect(reporter.updateProgress).toHaveBeenCalledTimes(totalFiles);
    expect(reporter.stopMultiBar).toHaveBeenCalledTimes(1);
    expect(reporter.logError).not.toHaveBeenCalled();
    expect(reporter.logWarning).not.toHaveBeenCalled();
  });

  it('should handle partial failures during file processing', async () => {
    const files = new Map<string, string[]>([['png', ['ok.png', 'fail.png']]]);
    const errorFilePath = 'fail.png';
    const successFilePath = 'ok.png';

    // Mock processSingleFile: succeed for one, fail for the other
    mockProcessSingleFile.mockImplementation(async (filePath) => {
      if (filePath === errorFilePath) {
        return err(
          new FileSystemError('Mock processing error', {
            context: { path: filePath },
          }), // Use context
        );
      }
      return ok({ ...sampleFileInfo, path: filePath });
    });

    const result = await gatherFileInfoFn(
      files,
      1,
      config,
      cache,
      mockExifTool,
      mockWorkerPool,
      dbService,
      reporter,
    );

    // Assertions
    expect(result.validFiles).toHaveLength(1);
    expect(result.validFiles).toContain(successFilePath);
    expect(result.errorFiles).toHaveLength(1);
    expect(result.errorFiles).toContain(errorFilePath);

    // Check DB content (only success should be there)
    const dbCheckOkResult = await dbService.getFileInfo(successFilePath);
    expect(dbCheckOkResult.isOk()).toBe(true);
    expect(dbCheckOkResult._unsafeUnwrap()).toBeDefined(); // Should exist
    expect(dbCheckOkResult._unsafeUnwrap()?.metadata?.width).toBe(
      sampleFileInfo.metadata.width,
    );

    const dbCheckFailResult = await dbService.getFileInfo(errorFilePath);
    expect(dbCheckFailResult.isOk()).toBe(true); // getFileInfo returns Ok(null) for not found
    expect(dbCheckFailResult._unsafeUnwrap()).toBeNull();

    // Check reporter calls
    expect(reporter.initializeMultiBar).toHaveBeenCalledTimes(1);
    expect(reporter.updateProgress).toHaveBeenCalledTimes(2);
    expect(reporter.stopMultiBar).toHaveBeenCalledTimes(1);
    expect(reporter.logError).toHaveBeenCalledTimes(1);
    expect(reporter.logError).toHaveBeenCalledWith(
      expect.stringContaining(`Error processing ${errorFilePath}`), // Check message contains file path
      expect.any(FileSystemError), // Check error object is passed
    );
    expect(reporter.logWarning).not.toHaveBeenCalled();
  });

  it('should handle DB upsert failures gracefully', async () => {
    const files = new Map<string, string[]>([['mov', ['db_fail.mov']]]);
    const filePath = 'db_fail.mov';

    // Mock processSingleFile to succeed
    mockProcessSingleFile.mockResolvedValue(
      ok({ ...sampleFileInfo, path: filePath }),
    );

    // Mock dbService.upsertFileInfo to fail
    const dbError = new DatabaseError('Mock DB upsert failed');
    const upsertSpy = vi // Use vi.spyOn()
      .spyOn(dbService, 'upsertFileInfo')
      .mockReturnValue(err(dbError));

    const result = await gatherFileInfoFn(
      files,
      1,
      config,
      cache,
      mockExifTool,
      mockWorkerPool,
      dbService,
      reporter,
    );

    // Assertions
    expect(result.validFiles).toHaveLength(1); // Still considered valid processing-wise
    expect(result.validFiles).toContain(filePath);
    expect(result.errorFiles).toHaveLength(0); // DB error doesn't make it an errorFile

    // Check DB content (should not be there because upsert was mocked to fail)
    // Need to re-fetch using the original method after spy restore, or check before restore
    upsertSpy.mockRestore(); // Restore original implementation first
    const dbCheckResult = await dbService.getFileInfo(filePath);
    expect(dbCheckResult.isOk()).toBe(true);
    expect(dbCheckResult._unsafeUnwrap()).toBeNull(); // Should be null as it wasn't inserted

    // Check reporter calls
    expect(reporter.initializeMultiBar).toHaveBeenCalledTimes(1);
    expect(reporter.updateProgress).toHaveBeenCalledTimes(1);
    expect(reporter.stopMultiBar).toHaveBeenCalledTimes(1);
    expect(reporter.logError).not.toHaveBeenCalled();
    expect(reporter.logWarning).toHaveBeenCalledTimes(1);
    expect(reporter.logWarning).toHaveBeenCalledWith(
      expect.stringContaining(
        `DB upsert failed for ${filePath}: ${dbError.message}`,
      ),
    );

    // upsertSpy already restored above
  });

  it('should handle empty input map', async () => {
    const files = new Map<string, string[]>();

    const result = await gatherFileInfoFn(
      files,
      2,
      config,
      cache,
      mockExifTool,
      mockWorkerPool,
      dbService,
      reporter,
    );

    expect(result.validFiles).toHaveLength(0);
    expect(result.errorFiles).toHaveLength(0);
    expect(reporter.initializeMultiBar).toHaveBeenCalledTimes(1); // Still initializes
    expect(reporter.updateProgress).not.toHaveBeenCalled();
    expect(reporter.stopMultiBar).toHaveBeenCalledTimes(1); // Still stops
    expect(reporter.logError).not.toHaveBeenCalled();
    expect(reporter.logWarning).not.toHaveBeenCalled();
  });
});
