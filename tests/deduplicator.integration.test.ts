import { deduplicateFilesFn } from '../src/deduplicator';
import { MediaComparator } from '../MediaComparator';
import {
  MetadataDBService,
  FileInfoRow,
} from '../src/services/MetadataDBService';
import { CliReporter } from '../src/reporting/CliReporter';
// Consolidate imports from ../src/types
import {
  // Removed unused DeduplicationResult, FileType
  ProgramOptions,
  FileProcessorConfig,
  FileInfo,
  SimilarityConfig,
} from '../src/types';
import { LmdbCache } from '../src/caching/LmdbCache';
import { ExifTool } from 'exiftool-vendored';
import { WorkerPool } from '../src/contexts/types';

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

import { err, DatabaseError } from '../src/errors'; // Removed unused AppResult, ok
import { rmSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { bufferToSharedArrayBuffer } from '../src/utils'; // Import buffer utility

// --- Mocking Dependencies ---
// Mock CliReporter
class MockCliReporter extends CliReporter {
  startSpinner = vi.fn(); // Use vi.fn()
  updateSpinnerText = vi.fn(); // Use vi.fn()
  stopSpinnerSuccess = vi.fn(); // Use vi.fn()
  stopSpinnerFailure = vi.fn(); // Use vi.fn()
  logError = vi.fn(); // Use vi.fn()
  logWarning = vi.fn(); // Use vi.fn()
  logInfo = vi.fn(); // Use vi.fn()
  logSuccess = vi.fn(); // Use vi.fn()
  constructor() {
    super(false);
  }
}

// --- Test Setup ---
const TEST_DEDUP_DB_DIR = '.test-dedup-db';
const TEST_DEDUP_SQLITE_PATH = join(TEST_DEDUP_DB_DIR, 'dedup-meta.sqlite');

// Helper to create sample FileInfoRow data
function createSampleRow(
  filePath: string,
  pHashHex: string | null,
  size: number = 1024,
  duration: number | null = null, // null for images
  width: number = 800,
  height: number = 600,
): FileInfoRow {
  const lshKeys = generateLshKeysHelper(pHashHex); // Use helper defined below
  return {
    filePath,
    pHash: pHashHex,
    lshKey1: lshKeys[0],
    lshKey2: lshKeys[1],
    lshKey3: lshKeys[2],
    lshKey4: lshKeys[3],
    size,
    mediaDuration: duration,
    imageWidth: width,
    imageHeight: height,
    // Add other fields as needed, keep null/undefined if not relevant for scoring/matching
    contentHash: null,
    createdAt: null,
    modifiedAt: null,
    gpsLatitude: null,
    gpsLongitude: null,
    cameraModel: null,
    imageDate: null,
  };
}

// Helper to generate LSH keys (mirrors the logic in MetadataDBService)
function generateLshKeysHelper(pHashHex: string | null): (string | null)[] {
  const keys: (string | null)[] = [null, null, null, null];
  if (pHashHex && pHashHex.length === 16) {
    // 64-bit hash
    keys[0] = pHashHex.substring(0, 4);
    keys[1] = pHashHex.substring(4, 8);
    keys[2] = pHashHex.substring(8, 12);
    keys[3] = pHashHex.substring(12, 16);
  }
  return keys;
}

// Helper to insert rows into the test DB
async function populateDb(dbService: MetadataDBService, rows: FileInfoRow[]) {
  // Need to convert FileInfoRow back to a simplified FileInfo for upsertFileInfo
  // This is a bit awkward, ideally dbService would have an upsertRow method
  for (const row of rows) {
    const pHashBuffer = row.pHash
      ? bufferToSharedArrayBuffer(Buffer.from(row.pHash, 'hex'))
      : undefined;
    const fileInfo: Partial<FileInfo> = {
      // Construct just enough FileInfo
      fileStats: {
        hash: bufferToSharedArrayBuffer(Buffer.from(row.filePath)), // Use filePath as dummy hash
        size: row.size ?? 0,
        createdAt: new Date(),
        modifiedAt: new Date(),
      },
      metadata: {
        width: row.imageWidth ?? 0,
        height: row.imageHeight ?? 0,
      },
      media: {
        duration: row.mediaDuration ?? 0,
        frames: pHashBuffer ? [{ hash: pHashBuffer, timestamp: 0 }] : [],
      },
    };
    // We cast to FileInfo because upsert expects it, but we only provide partial data
    const result = dbService.upsertFileInfo(row.filePath, fileInfo as FileInfo);
    if (result.isErr()) {
      throw new Error(
        `Failed to populate DB for ${row.filePath}: ${result.error.message}`,
      );
    }
  }
}

// Skip this entire suite when running in Bun due to better-sqlite3 native module issues
describe.skip('deduplicateFilesFn Integration Tests (Skipped in Bun)', () => {
  let dbService: MetadataDBService;
  let reporter: MockCliReporter;
  let comparator: MediaComparator;
  let similarityConfig: SimilarityConfig;
  let programOptions: ProgramOptions; // Add ProgramOptions

  beforeAll(() => {
    // Create test directory
    if (!existsSync(TEST_DEDUP_DB_DIR)) {
      mkdirSync(TEST_DEDUP_DB_DIR);
    }
    // Instantiate mocks needed for MediaComparator constructor
    // Removed unused mock variables defined here: mockCache, mockFileProcessorConfig, mockExifToolInstance, mockWorkerPoolInstance, mockSimilarityConfig
    // These were likely intended for the MediaComparator instantiation below, which uses different mocks.
    // Create a minimal mock ProgramOptions
    programOptions = {
      // Assign to the variable declared above
      concurrency: 1,
      move: false,
      resolution: 64,
      format: '',
      windowSize: 5,
      stepSize: 1,
      maxChunkSize: 1,
      minFrames: 1,
      maxSceneFrames: 1,
      targetFps: 1,
      sceneChangeThreshold: 0.1,
      imageSimilarityThreshold: 0.9,
      imageVideoSimilarityThreshold: 0.9,
      videoSimilarityThreshold: 0.9,
    };

    // Instantiate MediaComparator with mocks and configs
    // Note: We'll use the actual dbService created in beforeEach for the real tests,
    // but MediaComparator itself might be instantiated once here if its state is static.
    // Let's instantiate it in beforeEach instead for consistency with dbService.
  });

  afterAll(() => {
    // Clean up the base test directory
    if (existsSync(TEST_DEDUP_DB_DIR)) {
      rmSync(TEST_DEDUP_DB_DIR, { recursive: true, force: true });
    }
  });

  beforeEach(async () => {
    // Clean up previous DB file and create new instance
    if (existsSync(TEST_DEDUP_SQLITE_PATH)) {
      rmSync(TEST_DEDUP_SQLITE_PATH);
    }
    dbService = new MetadataDBService(TEST_DEDUP_DB_DIR, 'dedup-meta.sqlite');

    reporter = new MockCliReporter();
    similarityConfig = {
      // Define default similarity config
      windowSize: 5,
      stepSize: 1,
      imageSimilarityThreshold: 0.98, // High threshold for easier testing
      imageVideoSimilarityThreshold: 0.95,
      videoSimilarityThreshold: 0.95,
    };
    // Instantiate MediaComparator here, using the real dbService for this test run
    // We need mocks for Cache, ExifTool, WorkerPool for the constructor
    const mockCacheInstance = {
      /* mock methods if needed by comparator */
    } as LmdbCache;
    const mockExifToolInstance = { end: vi.fn() } as unknown as ExifTool; // Use vi.fn()
    const mockWorkerPoolInstance = {
      terminate: vi.fn(), // Use vi.fn()
    } as unknown as WorkerPool; // Use simple mock
    const mockFileProcessorConfig = {
      /* mock if needed */
    } as FileProcessorConfig; // Config passed to deduplicateFilesFn is likely more relevant

    comparator = new MediaComparator(
      mockCacheInstance, // Use mock cache for comparator internal needs if any
      mockFileProcessorConfig, // Use mock config
      mockExifToolInstance, // Use mock exiftool
      similarityConfig, // Use the test's similarity config
      programOptions, // Use the mock program options
      mockWorkerPoolInstance, // Use mock worker pool
    );

    vi.clearAllMocks(); // Use vi.clearAllMocks()
  });

  afterEach(async () => {
    await dbService.close();
  });

  it('should identify exact duplicates based on pHash', async () => {
    const pHashExact = '1111111111111111';
    const rows = [
      createSampleRow('exact1.jpg', pHashExact, 1000), // Keep this one (smaller size)
      createSampleRow('exact2.jpg', pHashExact, 2000),
      createSampleRow('unique1.jpg', '2222222222222222'),
    ];
    await populateDb(dbService, rows);
    const validFiles = rows.map((r) => r.filePath);

    const result = await deduplicateFilesFn(
      validFiles,
      comparator,
      dbService,
      similarityConfig,
      reporter,
    );

    expect(result.isOk()).toBe(true);
    const dedupResult = result._unsafeUnwrap();
    expect(dedupResult.uniqueFiles.size).toBe(2);
    expect(dedupResult.uniqueFiles).toContain('exact1.jpg'); // Best file kept
    expect(dedupResult.uniqueFiles).toContain('unique1.jpg');
    expect(dedupResult.duplicateSets).toHaveLength(1);
    expect(dedupResult.duplicateSets[0].bestFile).toBe('exact1.jpg');
    expect(dedupResult.duplicateSets[0].duplicates.size).toBe(1);
    expect(dedupResult.duplicateSets[0].duplicates).toContain('exact2.jpg');

    expect(reporter.startSpinner).toHaveBeenCalledWith(
      'Deduplicating files...',
    );
    expect(reporter.updateSpinnerText).toHaveBeenCalledWith(
      expect.stringContaining('Finding exact duplicates'),
    );
    expect(reporter.updateSpinnerText).toHaveBeenCalledWith(
      expect.stringContaining('1 exact duplicate sets'),
    );
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled();
  });

  it('should identify similar files using LSH and similarity check', async () => {
    // pHash1 and pHash2 differ slightly but should match via LSH and similarity
    const pHashSimilar1 = 'abcdef1234567890'; // LSH keys: abcd, ef12, 3456, 7890
    const pHashSimilar2 = 'abcdef1234567891'; // LSH keys: abcd, ef12, 3456, 7891 (3/4 match)
    const rows = [
      createSampleRow('similar1.jpg', pHashSimilar1, 1500, null, 1000, 800), // Keep this (higher res)
      createSampleRow('similar2.jpg', pHashSimilar2, 1000, null, 800, 600),
      createSampleRow('unique2.png', '3333333333333333'),
    ];
    await populateDb(dbService, rows);
    const validFiles = rows.map((r) => r.filePath);

    // Mock similarity calculation to ensure they are considered similar
    const calculateSimilaritySpy = vi // Use vi.spyOn()
      .spyOn(comparator, 'calculateSimilarity')
      .mockReturnValue(0.99); // Force high similarity

    const result = await deduplicateFilesFn(
      validFiles,
      comparator,
      dbService,
      similarityConfig,
      reporter,
    );

    expect(result.isOk()).toBe(true);
    const dedupResult = result._unsafeUnwrap();

    expect(dedupResult.uniqueFiles.size).toBe(2);
    expect(dedupResult.uniqueFiles).toContain('similar1.jpg'); // Best file kept
    expect(dedupResult.uniqueFiles).toContain('unique2.png');
    expect(dedupResult.duplicateSets).toHaveLength(1);
    expect(dedupResult.duplicateSets[0].bestFile).toBe('similar1.jpg');
    expect(dedupResult.duplicateSets[0].duplicates.size).toBe(1);
    expect(dedupResult.duplicateSets[0].duplicates).toContain('similar2.jpg');

    expect(reporter.updateSpinnerText).toHaveBeenCalledWith(
      expect.stringContaining('Finding similar files using LSH'),
    );
    expect(calculateSimilaritySpy).toHaveBeenCalled(); // Check that similarity was calculated

    it('should treat file as unique if LSH candidates do not meet similarity threshold', async () => {
      // pHash1 and pHash2 differ slightly but should match via LSH
      const pHashSimilar1 = 'abcdef1234567890'; // LSH keys: abcd, ef12, 3456, 7890
      const pHashSimilar2 = 'abcdef1234567891'; // LSH keys: abcd, ef12, 3456, 7891 (3/4 match)
      const rows = [
        createSampleRow('target.jpg', pHashSimilar1),
        createSampleRow('candidate_low_similarity.jpg', pHashSimilar2),
        createSampleRow('unique_other.png', '5555555555555555'),
      ];
      await populateDb(dbService, rows);
      const validFiles = rows.map((r) => r.filePath);

      // Mock similarity calculation to return a value BELOW the threshold
      const calculateSimilaritySpy = vi // Use vi.spyOn()
        .spyOn(comparator, 'calculateSimilarity')
        .mockReturnValue(0.9); // Below threshold (e.g., 0.98)

      const result = await deduplicateFilesFn(
        validFiles,
        comparator,
        dbService,
        similarityConfig,
        reporter,
      );

      expect(result.isOk()).toBe(true);
      const dedupResult = result._unsafeUnwrap();

      // All files should be unique in this case
      expect(dedupResult.uniqueFiles.size).toBe(3);
      expect(dedupResult.uniqueFiles).toContain('target.jpg');
      expect(dedupResult.uniqueFiles).toContain('candidate_low_similarity.jpg');
      expect(dedupResult.uniqueFiles).toContain('unique_other.png');
      expect(dedupResult.duplicateSets).toHaveLength(0); // No duplicate sets formed

      expect(reporter.updateSpinnerText).toHaveBeenCalledWith(
        expect.stringContaining('Finding similar files using LSH'),
      );
      expect(calculateSimilaritySpy).toHaveBeenCalled(); // Similarity should still be calculated
      expect(reporter.stopSpinnerSuccess).toHaveBeenCalled();

      calculateSimilaritySpy.mockRestore(); // Clean up spy
    });

    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled();

    calculateSimilaritySpy.mockRestore(); // Clean up spy
  });

  it('should handle files with no pHash found in DB', async () => {
    const rows = [
      createSampleRow('no_phash.jpg', null), // No pHash
      createSampleRow('unique3.tif', '4444444444444444'),
    ];
    await populateDb(dbService, rows);
    const validFiles = rows.map((r) => r.filePath);

    const result = await deduplicateFilesFn(
      validFiles,
      comparator,
      dbService,
      similarityConfig,
      reporter,
    );

    expect(result.isOk()).toBe(true);
    const dedupResult = result._unsafeUnwrap();
    expect(dedupResult.uniqueFiles.size).toBe(2); // Both should be unique
    expect(dedupResult.uniqueFiles).toContain('no_phash.jpg');
    expect(dedupResult.uniqueFiles).toContain('unique3.tif');
    expect(dedupResult.duplicateSets).toHaveLength(0);

    expect(reporter.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('missing pHash'),
    );
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled();
  });

  it('should return error if initial DB query fails', async () => {
    const dbError = new DatabaseError('Mock DB read failed');
    // Mock the specific method expected to be called first
    const getMultipleSpy = vi // Use vi.spyOn()
      .spyOn(dbService, 'getMultipleFileInfo')
      .mockImplementation(() => err(dbError)); // Make mock synchronous

    const validFiles = ['file1.jpg'];
    const result = await deduplicateFilesFn(
      validFiles,
      comparator,
      dbService,
      similarityConfig,
      reporter,
    );

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      // Type guard
      expect(result.error).toBe(dbError);
    }
    expect(reporter.stopSpinnerFailure).toHaveBeenCalledWith(
      expect.stringContaining(dbError.message),
    );

    getMultipleSpy.mockRestore();
  });

  // Add more tests:
  // - Mixed exact and similar clusters
  // - Files that are LSH candidates but fail similarity check
  // - Error during LSH candidate search
  // - Error during similarity calculation (mock comparator.calculateSimilarity to throw)
  // - Error during processResults (mock comparator.processResults to return Err)
  // - Empty validFiles input
});
