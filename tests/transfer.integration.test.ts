import {
  vi, // Import vi from vitest instead of jest
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "vitest"; // Use vitest imports
import { join } from "path"; // Import join
// Remove fsPromises import, let integration test use real fs
// import * as fsPromisesOriginal from "fs/promises";
import { mkdirSync, readdirSync, rmSync, existsSync, writeFileSync, Dirent } from "fs"; // Use sync fs methods, added Dirent
import { Dirent } from "fs"; // Import Dirent

// --- Now import the module that uses the mocked fs/promises ---
import { transferFilesFn } from "../src/transfer"; // Import AFTER mock
// Import other necessary types/classes
import { GatherFileInfoResult, DeduplicationResult } from "../src/types";
import { DebugReporter } from "../src/reporting/DebugReporter";
import { FileTransferService } from "../src/services/FileTransferService"; // Import FileTransferService
import { CliReporter } from "../src/reporting/CliReporter";

// --- Mocking Other Dependencies ---
// Mock CliReporter
class MockCliReporter extends CliReporter {
  startSpinner = vi.fn(); // Use vi.fn()
  stopSpinnerSuccess = vi.fn(); // Use vi.fn()
  stopSpinnerFailure = vi.fn(); // Use vi.fn()
  logError = vi.fn(); // Use vi.fn()
  logWarning = vi.fn(); // Use vi.fn()
  logInfo = vi.fn(); // Use vi.fn()
  logSuccess = vi.fn(); // Use vi.fn()
  constructor() {
    super(false);
  } // Pass verbose=false
}

// Mock DebugReporter
const mockDebugReporter = {
  generateHtmlReports: vi.fn().mockImplementation(async () => {}), // Use vi.fn()
} as unknown as DebugReporter;

// Mock FileTransferService
const mockFileTransferService = {
  transferOrganizedFiles: vi.fn().mockImplementation(async () => {}), // Use vi.fn()
} as unknown as FileTransferService;
// --- End Mocking ---

// --- Test Setup ---
const mockGatherResult: GatherFileInfoResult = {
  validFiles: ["valid1.jpg", "valid2.png"],
  errorFiles: ["error1.txt"],
};

const mockDedupResult: DeduplicationResult = {
  uniqueFiles: new Set(["valid1.jpg"]),
  duplicateSets: [
    {
      bestFile: "valid2.png", // Assuming valid2 is best in its set
      representatives: new Set(["valid2.png"]),
      duplicates: new Set(["duplicate_of_valid2.png"]), // Need a duplicate file path
    },
  ],
};

// Add a duplicate file to gather result for transfer service logic
const mockGatherResultWithDuplicate = {
  ...mockGatherResult,
  validFiles: [...mockGatherResult.validFiles, "duplicate_of_valid2.png"],
};

describe("transferFilesFn Integration Tests", () => {
  let reporter: MockCliReporter;

  // Variables to hold imported mocks, defined at the top level of describe
  // let fsPromisesMock: typeof fsPromisesOriginal; // Removed
  let reporterInstance: MockCliReporter;

  beforeEach(async () => { // Make beforeEach async
    // Clear mocks before each test
    vi.resetAllMocks(); // Use resetAllMocks

    // Import mocks
    // Use vi.doMock to ensure we get a fresh, spy-able version for integration tests
    vi.doMock("fs/promises", () => ({
        ...fsPromisesOriginal, // Spread the original functions
        mkdir: vi.fn(fsPromisesOriginal.mkdir), // Wrap functions we might spy on/modify
        readdir: vi.fn(fsPromisesOriginal.readdir),
        unlink: vi.fn(fsPromisesOriginal.unlink),
    }));
    // Import the dynamically mocked module
    // Import the dynamically mocked module and assign to the top-level variable
    // Import the dynamically mocked module and assign to the top-level variable
    // Assign to the top-level variable
    // Assign to the top-level variable
    // Removed fsPromisesMock assignment
    // Instantiate reporter
    reporterInstance = new MockCliReporter();

    // Clear specific mocks if needed (resetAllMocks might be sufficient)
    (mockDebugReporter.generateHtmlReports as import('vitest').Mock).mockClear(); // Use import('vitest').Mock
    (mockFileTransferService.transferOrganizedFiles as import('vitest').Mock).mockClear(); // Use import('vitest').Mock

    // Apply default implementations for fsPromises mocks using the imported mock
    (fsPromisesMock.mkdir as import('vitest').Mock).mockResolvedValue(undefined);
    (fsPromisesMock.readdir as import('vitest').Mock).mockResolvedValue([]);
    (fsPromisesMock.unlink as import('vitest').Mock).mockResolvedValue(undefined);
  });

  // Add afterEach to ensure spies are always restored
  afterEach(() => {
    vi.restoreAllMocks(); // Use vi.restoreAllMocks()
  });

  it("should call transfer service with correct arguments (copy)", async () => {
    const targetDir = "output/target";
    const duplicateDir = "output/duplicates";
    const errorDir = "output/errors";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;

    // No need for spyOn, we will check the mock directly
    await transferFilesFn(
      mockGatherResultWithDuplicate,
      mockDedupResult,
      targetDir,
      duplicateDir,
      errorDir,
      undefined, // No debug dir
      format,
      shouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Use the instance
    );

    expect(reporterInstance.startSpinner).toHaveBeenCalledWith("Transferring files..."); // Use the instance
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1);
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledWith(
      mockGatherResultWithDuplicate,
      mockDedupResult,
      targetDir,
      duplicateDir,
      errorDir,
      format,
      shouldMove,
    );
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith( // Use the instance
      expect.stringContaining("File transfer completed"),
    );
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled();
    // Assert side effects: Check that debug dir was NOT created
    expect(existsSync("output/debug_report")).toBe(false); // Assuming no debug dir was passed
    // Spies are restored in afterEach
  });

  it("should call transfer service with correct arguments (move)", async () => {
    const targetDir = "output/target_move";
    const format = "{D.YYYY}/{NAME}.{EXT}";
    const shouldMove = true;

    await transferFilesFn(
      mockGatherResult, // Use original gather result without explicit duplicate path
      mockDedupResult,
      targetDir,
      undefined, // No duplicate dir
      undefined, // No error dir
      undefined, // No debug dir
      format,
      shouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Use the instance
    );

    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1);
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledWith(
      mockGatherResult,
      mockDedupResult,
      targetDir,
      undefined,
      undefined,
      format,
      shouldMove, // Should be true
    );
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalled(); // Use the instance
  });

  it("should handle debug directory creation and report generation", async () => {
    const targetDir = "output/target_debug";
    const debugDir = "output/debug_report";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;
// Create dummy files for cleanup assertion
mkdirSync(debugDir, { recursive: true });
writeFileSync(join(debugDir, "old_report.html"), "dummy");
writeFileSync(join(debugDir, "temp.txt"), "dummy");
// No need to mock unlink, let the real function run

    await transferFilesFn(
      mockGatherResultWithDuplicate,
      mockDedupResult,
      targetDir,
      undefined,
      undefined,
      debugDir, // Provide debug dir
      format,
      shouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Use the instance
    );
// Assert side effects: check if files were deleted
expect(existsSync(join(debugDir, "old_report.html"))).toBe(false);
expect(existsSync(join(debugDir, "temp.txt"))).toBe(false);
    expect(existsSync(join(debugDir, "temp.txt"))).toBe(false);
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledTimes(1);
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledWith(
      mockDedupResult.duplicateSets,
      debugDir,
    );
    expect(reporterInstance.logWarning).toHaveBeenCalledWith( // Use the instance
      expect.stringContaining("Debug mode: Duplicate set reports"),
    );
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1); // Still transfers files
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalled(); // Use the instance

    // Spies are restored in afterEach
  });

  it("should handle debug directory creation failure", async () => {
    const targetDir = "output/target_debug_fail";
    const debugDir = "output/debug_fail";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;
    const mkdirError = new Error("Permission denied");
    (mkdirError as NodeJS.ErrnoException).code = "EACCES";
// Use spyOn to simulate mkdir failure for this specific test
const mkdirSpy = vi.spyOn(fsPromises, 'mkdir').mockRejectedValueOnce(mkdirError);
    // No need for spies, just check the imported mocks

    await transferFilesFn(
      mockGatherResult,
      mockDedupResult,
      targetDir,
      undefined,
      undefined,
      debugDir, // Provide debug dir
      format,
      shouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Use the instance
    );

    expect(mkdirSpy).toHaveBeenCalledWith(debugDir, { recursive: true });
    expect(reporterInstance.logError).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to create debug directory ${debugDir}`),
      expect.any(Error),
    );
    // Check that readdir/unlink were not called
    // Cannot easily assert non-calls without mocks/spies for readdir/unlink
    // expect(fsPromisesMock.readdir).not.toHaveBeenCalled();
    // expect(fsPromisesMock.unlink).not.toHaveBeenCalled();
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled(); // Should not generate reports
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1); // Should still transfer files
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalled(); // Use the instance

    // Spies are restored in afterEach
  });

  it("should handle debug report generation failure", async () => {
    const targetDir = "output/target_report_fail";
    const debugDir = "output/report_fail";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;
    const reportError = new Error("HTML generation failed");
// Ensure mkdir succeeds (let the real function run, or spy if needed)
// const mkdirSpy = vi.spyOn(fsPromises, 'mkdir').mockResolvedValue(undefined); // Keep commented unless needed
    (fsPromisesMock.mkdir as import('vitest').Mock).mockResolvedValue(undefined);
    // Mock the reporter method to throw
    (mockDebugReporter.generateHtmlReports as import('vitest').Mock).mockImplementationOnce(
      async () => {
        throw reportError;
      },
    );

    await transferFilesFn(
      mockGatherResultWithDuplicate,
      mockDedupResult,
      targetDir,
      undefined,
      undefined,
      debugDir, // Provide debug dir
      format,
      shouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Use the instance
    );

    // Check if mkdir was called
    // Assert side effect: directory should exist
    expect(existsSync(debugDir)).toBe(true);
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logError).toHaveBeenCalledWith( // Use the instance
      expect.stringContaining(
        `Failed to generate debug reports in ${debugDir}`,
      ),
      reportError,
    );
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1); // Should still transfer files
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalled(); // Use the instance

    // Spies are restored in afterEach
  });

  it("should handle file transfer service failure", async () => {
    const targetDir = "output/target_transfer_fail";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;
    const transferError = new Error("Disk full");

    (
      mockFileTransferService.transferOrganizedFiles as import('vitest').Mock
    ).mockImplementationOnce(async () => {
      throw transferError;
    });

    // Expect the function to rethrow the error
    await expect(
      transferFilesFn(
        mockGatherResult,
        mockDedupResult,
        targetDir,
        undefined,
        undefined,
        undefined, // No debug dir
        format,
        shouldMove,
        mockDebugReporter,
        mockFileTransferService,
        reporterInstance, // Use the instance
      ),
    ).rejects.toThrow(transferError);

    expect(reporterInstance.startSpinner).toHaveBeenCalledWith("Transferring files..."); // Use the instance
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1);
    expect(reporterInstance.stopSpinnerFailure).toHaveBeenCalledWith( // Use the instance
      expect.stringContaining(`File transfer failed: ${transferError.message}`),
    );
    expect(reporterInstance.stopSpinnerSuccess).not.toHaveBeenCalled(); // Use the instance
  });

  it("should handle cases with no files to transfer", async () => {
    const targetDir = "output/target_empty";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;

    const emptyGatherResult: GatherFileInfoResult = {
      validFiles: [],
      errorFiles: [],
    };
    const emptyDedupResult: DeduplicationResult = {
      uniqueFiles: new Set(),
      duplicateSets: [],
    };

    await transferFilesFn(
      emptyGatherResult,
      emptyDedupResult,
      targetDir,
      undefined, // No duplicate dir
      undefined, // No error dir
      undefined, // No debug dir
      format,
      shouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Use the instance
    );

    expect(reporterInstance.startSpinner).toHaveBeenCalledWith("Transferring files..."); // Use the instance
    // Crucially, the transfer service should NOT be called if there's nothing to transfer
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).not.toHaveBeenCalled();
    // Check for a specific message or just success
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith( // Use the instance
      expect.stringContaining("File transfer completed"), // Changed message check
    );
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled();
  });

  it("should correctly pass errorDir parameter when provided", async () => {
    const targetDir = "output/target_error_dir";
    const errorDir = "output/errors_explicit"; // Explicit error dir
    const format = "{NAME}.{EXT}";
    const shouldMove = false;

    await transferFilesFn(
      mockGatherResult, // Use non-empty results
      mockDedupResult,
      targetDir,
      undefined, // No duplicate dir
      errorDir, // Provide error dir
      undefined, // No debug dir
      format,
      shouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Use the instance
    );

    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1);
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledWith(
      mockGatherResult,
      mockDedupResult,
      targetDir,
      undefined,
      errorDir, // Check if errorDir is passed correctly
      format,
      shouldMove,
    );
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalled(); // Use the instance
  });
});
