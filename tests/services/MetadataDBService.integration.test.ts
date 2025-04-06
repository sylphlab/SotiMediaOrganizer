import { MetadataDBService } from '../../src/services/MetadataDBService';
import { FileInfo } from '../../src/types'; // Added import
import { bufferToSharedArrayBuffer } from '../../src/utils'; // Added import
// Removed unused imports: ok, err
import { rmSync, existsSync } from 'fs';
// import { join } from 'path'; // Removed unused import

const TEST_DB_DIR = '.test-db';
// const TEST_DB_PATH = join(TEST_DB_DIR, 'test-metadata.sqlite'); // Removed unused constant

// Conditionally describe the suite based on the runtime
const describeIf = (condition: boolean) =>
  condition ? describe : describe.skip;

describeIf(!process.isBun)(
  'MetadataDBService Integration Tests (Skipped in Bun)',
  () => {
    let dbService: MetadataDBService;

    beforeAll(() => {
      // Ensure clean state before tests
      if (existsSync(TEST_DB_DIR)) {
        rmSync(TEST_DB_DIR, { recursive: true, force: true });
      }
      // Initialize service with test path
      dbService = new MetadataDBService(TEST_DB_DIR, 'test-metadata.sqlite');
    });

    afterAll(async () => {
      // Close DB connection and clean up test file/directory
      const closeResult = await dbService.close();
      if (closeResult.isErr()) {
        console.error('Error closing test DB:', closeResult.error);
      }
      if (existsSync(TEST_DB_DIR)) {
        rmSync(TEST_DB_DIR, { recursive: true, force: true });
      }
    });

    it('should initialize the database schema correctly', () => {
      // Check if the table exists (basic check)
      // Cast the result type
      const result = dbService['db']
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='files'",
        )
        .get() as { name: string } | undefined;
      expect(result).toBeDefined();
      expect(result.name).toBe('files');
    });

    it('should upsert and retrieve FileInfo correctly', () => {
      const filePath = '/test/image1.jpg';
      const pHashBuffer = Buffer.from('a1b2c3d4e5f6a7b8', 'hex'); // Example 64-bit pHash
      const contentHashBuffer = Buffer.from(
        '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // Example SHA-256
        'hex',
      );
      const now = new Date();
      const fileInfo: FileInfo = {
        fileStats: {
          hash: bufferToSharedArrayBuffer(contentHashBuffer),
          size: 1024,
          createdAt: new Date(now.getTime() - 10000),
          modifiedAt: now,
        },
        metadata: {
          width: 1920,
          height: 1080,
          gpsLatitude: 51.5074,
          gpsLongitude: 0.1278,
          cameraModel: 'TestCam',
          imageDate: new Date(now.getTime() - 5000),
        },
        media: {
          duration: 0, // Image
          frames: [
            { hash: bufferToSharedArrayBuffer(pHashBuffer), timestamp: 0 },
          ],
        },
      };

      // Act: Upsert
      const upsertResult = dbService.upsertFileInfo(filePath, fileInfo);
      expect(upsertResult.isOk()).toBe(true);

      // Act: Retrieve
      const getResult = dbService.getFileInfo(filePath);
      expect(getResult.isOk()).toBe(true);
      const retrievedInfo = getResult._unsafeUnwrap(); // Use unsafe unwrap in tests for simplicity

      // Assert: Check retrieved data (partial reconstruction)
      expect(retrievedInfo).not.toBeNull();
      expect(retrievedInfo.fileStats).toBeDefined();
      expect(Buffer.from(retrievedInfo.fileStats.hash).toString('hex')).toEqual(
        contentHashBuffer.toString('hex'),
      );
      expect(retrievedInfo.fileStats.size).toBe(1024);
      expect(retrievedInfo.fileStats.createdAt.getTime()).toBe(
        now.getTime() - 10000,
      );
      expect(retrievedInfo.fileStats.modifiedAt.getTime()).toBe(now.getTime());

      expect(retrievedInfo.metadata).toBeDefined();
      expect(retrievedInfo.metadata.width).toBe(1920);
      expect(retrievedInfo.metadata.height).toBe(1080);
      expect(retrievedInfo.metadata.gpsLatitude).toBeCloseTo(51.5074);
      expect(retrievedInfo.metadata.gpsLongitude).toBeCloseTo(0.1278);
      expect(retrievedInfo.metadata.cameraModel).toBe('TestCam');
      expect(retrievedInfo.metadata.imageDate.getTime()).toBe(
        now.getTime() - 5000,
      );

      expect(retrievedInfo.media).toBeDefined();
      expect(retrievedInfo.media.duration).toBe(0);
      expect(retrievedInfo.media.frames).toHaveLength(1);
      expect(
        Buffer.from(retrievedInfo.media.frames[0].hash).toString('hex'),
      ).toEqual(pHashBuffer.toString('hex'));
    });

    it('should return null when getting non-existent FileInfo', () => {
      const getResult = dbService.getFileInfo('/non/existent/path.jpg');
      expect(getResult.isOk()).toBe(true);
      expect(getResult._unsafeUnwrap()).toBeNull();
    });

    it('should update existing FileInfo on upsert', () => {
      const filePath = '/test/image1.jpg'; // Same path as previous test
      const updatedPHashBuffer = Buffer.from('ffffffffffffffff', 'hex');
      const updatedFileInfo: FileInfo = {
        fileStats: {
          hash: bufferToSharedArrayBuffer(Buffer.from('newhash', 'hex')),
          size: 2048,
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
        metadata: { width: 800, height: 600 },
        media: {
          duration: 0,
          frames: [
            {
              hash: bufferToSharedArrayBuffer(updatedPHashBuffer),
              timestamp: 0,
            },
          ],
        },
      };

      // Act: Upsert again
      const upsertResult = dbService.upsertFileInfo(filePath, updatedFileInfo);
      expect(upsertResult.isOk()).toBe(true);

      // Act: Retrieve again
      const getResult = dbService.getFileInfo(filePath);
      expect(getResult.isOk()).toBe(true);
      const retrievedInfo = getResult._unsafeUnwrap();

      // Assert: Check updated values
      expect(retrievedInfo).not.toBeNull();
      expect(retrievedInfo.fileStats.size).toBe(2048);
      expect(retrievedInfo.metadata.width).toBe(800);
      expect(
        Buffer.from(retrievedInfo.media.frames[0].hash).toString('hex'),
      ).toEqual('ffffffffffffffff');
    });

    it('should retrieve multiple FileInfo entries correctly', async () => {
      // Arrange: Ensure some data exists (using data from previous tests)
      const filePath1 = '/test/image1.jpg'; // Exists from previous tests
      const filePath2 = '/test/image2.png';
      const filePath3 = '/test/nonexistent.gif';
      const pHash2 = Buffer.from('1122334455667788', 'hex');
      const fileInfo2: FileInfo = {
        fileStats: {
          size: 512,
          hash: bufferToSharedArrayBuffer(Buffer.from('hash2', 'hex')),
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
        metadata: { width: 100, height: 100 },
        media: {
          duration: 0,
          frames: [{ hash: bufferToSharedArrayBuffer(pHash2), timestamp: 0 }],
        },
      };
      const upsertResult = dbService.upsertFileInfo(filePath2, fileInfo2);
      expect(upsertResult.isOk()).toBe(true);

      // Act
      const getMultipleResult = dbService.getMultipleFileInfo([
        filePath1,
        filePath2,
        filePath3,
      ]);
      expect(getMultipleResult.isOk()).toBe(true);
      const resultMap = getMultipleResult._unsafeUnwrap();

      // Assert
      expect(resultMap.size).toBe(2); // Only existing files should be returned
      expect(resultMap.has(filePath1)).toBe(true);
      expect(resultMap.has(filePath2)).toBe(true);
      expect(resultMap.has(filePath3)).toBe(false);

      const retrievedInfo1 = resultMap.get(filePath1);
      const retrievedInfo2 = resultMap.get(filePath2);

      expect(retrievedInfo1?.fileStats?.size).toBe(2048); // From the update test
      expect(retrievedInfo2?.metadata?.width).toBe(100);
      expect(
        Buffer.from(retrievedInfo2.media.frames[0].hash).toString('hex'),
      ).toEqual('1122334455667788');
    });

    it('should retrieve media info (pHash, duration) for multiple files', () => {
      // Arrange: Use data from previous tests
      const filePath1 = '/test/image1.jpg'; // pHash: ffffffffffffffff, duration: 0
      const filePath2 = '/test/image2.png'; // pHash: 1122334455667788, duration: 0
      const filePath3 = '/test/nonexistent.gif';

      // Act
      const getMediaResult = dbService.getMediaInfoForFiles([
        filePath1,
        filePath2,
        filePath3,
      ]);
      expect(getMediaResult.isOk()).toBe(true);
      const mediaMap = getMediaResult._unsafeUnwrap();

      // Assert
      expect(mediaMap.size).toBe(2);
      expect(mediaMap.has(filePath1)).toBe(true);
      expect(mediaMap.has(filePath2)).toBe(true);
      expect(mediaMap.has(filePath3)).toBe(false);

      const mediaInfo1 = mediaMap.get(filePath1);
      const mediaInfo2 = mediaMap.get(filePath2);

      expect(mediaInfo1?.pHash).toBe('ffffffffffffffff');
      expect(mediaInfo1?.mediaDuration).toBe(0);
      expect(mediaInfo2?.pHash).toBe('1122334455667788');
      expect(mediaInfo2?.mediaDuration).toBe(0);
    });

    it('should find files by exact pHash', () => {
      // Arrange: Use pHashes from previous tests
      const pHash1 = 'ffffffffffffffff'; // From /test/image1.jpg (updated)
      const pHash2 = '1122334455667788'; // From /test/image2.png
      const nonExistentPHash = '0000000000000000';

      // Act: Find existing pHashes
      const findResult1 = dbService.findByExactPHash(pHash1);
      const findResult2 = dbService.findByExactPHash(pHash2);
      const findResult3 = dbService.findByExactPHash(nonExistentPHash);

      // Assert: Check results
      expect(findResult1.isOk()).toBe(true);
      const rows1 = findResult1._unsafeUnwrap();
      expect(rows1).toHaveLength(1);
      expect(rows1[0].filePath).toBe('/test/image1.jpg');
      expect(rows1[0].pHash).toBe(pHash1);

      expect(findResult2.isOk()).toBe(true);
      const rows2 = findResult2._unsafeUnwrap();
      expect(rows2).toHaveLength(1);
      expect(rows2[0].filePath).toBe('/test/image2.png');
      expect(rows2[0].pHash).toBe(pHash2);

      expect(findResult3.isOk()).toBe(true);
      expect(findResult3._unsafeUnwrap()).toHaveLength(0);
    });

    it('should find similar candidates based on LSH keys', () => {
      // Arrange: Add more files with potentially overlapping LSH keys
      const filePath3 = '/test/image3.tiff';
      const pHash3 = 'ffff1111aaaaaaaa'; // Shares LSH keys 1 & 3 with pHash1, key 2 with pHash2
      const fileInfo3: FileInfo = {
        fileStats: {
          size: 300,
          hash: bufferToSharedArrayBuffer(Buffer.from('hash3', 'hex')),
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
        metadata: { width: 50, height: 50 },
        media: {
          duration: 0,
          frames: [
            {
              hash: bufferToSharedArrayBuffer(Buffer.from(pHash3, 'hex')),
              timestamp: 0,
            },
          ],
        },
      };
      dbService.upsertFileInfo(filePath3, fileInfo3); // Assume success based on previous tests

      const filePath4 = '/test/image4.bmp';
      const pHash4 = 'bbbb2222ccccdddd'; // No shared keys with others
      const fileInfo4: FileInfo = {
        fileStats: {
          size: 400,
          hash: bufferToSharedArrayBuffer(Buffer.from('hash4', 'hex')),
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
        metadata: { width: 60, height: 60 },
        media: {
          duration: 0,
          frames: [
            {
              hash: bufferToSharedArrayBuffer(Buffer.from(pHash4, 'hex')),
              timestamp: 0,
            },
          ],
        },
      };
      dbService.upsertFileInfo(filePath4, fileInfo4);

      // LSH Keys for pHash3: ['ffff', '1111', 'aaaa', 'aaaa']
      const lshKeys3 = ['ffff', '1111', 'aaaa', 'aaaa'];
      // LSH Keys for pHash4: ['bbbb', '2222', 'cccc', 'dddd']
      const lshKeys4 = ['bbbb', '2222', 'cccc', 'dddd'];

      // Act: Find candidates for image3
      const candidatesResult3 = dbService.findSimilarCandidates(
        filePath3,
        lshKeys3,
      );
      expect(candidatesResult3.isOk()).toBe(true);
      const candidates3 = candidatesResult3._unsafeUnwrap();

      // Act: Find candidates for image4
      const candidatesResult4 = dbService.findSimilarCandidates(
        filePath4,
        lshKeys4,
      );
      expect(candidatesResult4.isOk()).toBe(true);
      const candidates4 = candidatesResult4._unsafeUnwrap();

      // Assert: Check candidates for image3
      // Should find image1 (shares 'ffff') and image2 (shares '1111')
      expect(candidates3).toHaveLength(2);
      expect(candidates3).toContain('/test/image1.jpg');
      expect(candidates3).toContain('/test/image2.png');
      expect(candidates3).not.toContain(filePath3); // Should not include itself
      expect(candidates3).not.toContain(filePath4);

      // Assert: Check candidates for image4 (should find none)
      expect(candidates4).toHaveLength(0);
    });

    // Example test structure:
    /*
it('should upsert and retrieve FileInfo', () => {
  // ... test implementation ...
});
*/
  },
);
