import { MetadataDBService } from "../../src/services/MetadataDBService";
// Removed unused imports: FileInfoRow, FileInfo, FileStats, Metadata, MediaInfo
// Removed unused imports: bufferToSharedArrayBuffer
// Removed unused imports: ok, err
import { rmSync, existsSync } from "fs";
// import { join } from 'path'; // Removed unused import

const TEST_DB_DIR = ".test-db";
// const TEST_DB_PATH = join(TEST_DB_DIR, 'test-metadata.sqlite'); // Removed unused constant

// Conditionally describe the suite based on the runtime
const describeIf = (condition: boolean) =>
  condition ? describe : describe.skip;

describeIf(!process.isBun)(
  "MetadataDBService Integration Tests (Skipped in Bun)",
  () => {
    let dbService: MetadataDBService;

    beforeAll(() => {
      // Ensure clean state before tests
      if (existsSync(TEST_DB_DIR)) {
        rmSync(TEST_DB_DIR, { recursive: true, force: true });
      }
      // Initialize service with test path
      dbService = new MetadataDBService(TEST_DB_DIR, "test-metadata.sqlite");
    });

    afterAll(async () => {
      // Close DB connection and clean up test file/directory
      const closeResult = await dbService.close();
      if (closeResult.isErr()) {
        console.error("Error closing test DB:", closeResult.error);
      }
      if (existsSync(TEST_DB_DIR)) {
        rmSync(TEST_DB_DIR, { recursive: true, force: true });
      }
    });

    it("should initialize the database schema correctly", () => {
      // Check if the table exists (basic check)
      // Cast the result type
      const result = dbService["db"]
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='files'",
        )
        .get() as { name: string } | undefined;
      expect(result).toBeDefined();
      expect(result.name).toBe("files");
    });

    // Add more tests here for upsertFileInfo, getFileInfo, etc.
    // Example test structure:
    /*
  it('should upsert and retrieve FileInfo', () => {
    const filePath = '/test/image.jpg';
    const fileInfo: FileInfo = {
        // ... create mock FileInfo data ...
    };

    // Act: Upsert
    const upsertResult = dbService.upsertFileInfo(filePath, fileInfo);
    expect(upsertResult.isOk()).toBe(true);

    // Act: Retrieve
    const getResult = dbService.getFileInfo(filePath);
    expect(getResult.isOk()).toBe(true);
    const retrievedInfo = getResult._unsafeUnwrap();

    // Assert: Check retrieved data (note: only partial info is reconstructed)
    expect(retrievedInfo).not.toBeNull();
    expect(retrievedInfo?.metadata?.width).toEqual(fileInfo.metadata.width);
    // ... add more assertions ...
  });
  */
  },
);
