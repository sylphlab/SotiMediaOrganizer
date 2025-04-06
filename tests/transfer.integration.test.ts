import {
  jest,
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from "@jest/globals"; // Add afterEach
import { join } from "path"; // Import join
import * as fsPromises from "fs/promises"; // Import the original module

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
  startSpinner = jest.fn();
  stopSpinnerSuccess = jest.fn();
  stopSpinnerFailure = jest.fn();
  logError = jest.fn();
  logWarning = jest.fn();
  logInfo = jest.fn();
  logSuccess = jest.fn();
  constructor() {
    super(false);
  } // Pass verbose=false
}

// Mock DebugReporter
const mockDebugReporter = {
  generateHtmlReports: jest.fn().mockImplementation(async () => {}),
} as unknown as DebugReporter;

// Mock FileTransferService
const mockFileTransferService = {
  transferOrganizedFiles: jest.fn().mockImplementation(async () => {}),
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

  beforeEach(() => {
    // Clear mocks before each test
    // We will use spyOn, so no need to clear mkdirMock etc. here
    // Clear other mocks used across tests (ensure they are jest.fn())
    (mockDebugReporter.generateHtmlReports as jest.Mock).mockClear();
    (mockFileTransferService.transferOrganizedFiles as jest.Mock).mockClear();
    reporter = new MockCliReporter();
    // Restore any spies created in tests
    jest.restoreAllMocks();
  });

  // Add afterEach to ensure spies are always restored
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("should call transfer service with correct arguments (copy)", async () => {
    const targetDir = "output/target";
    const duplicateDir = "output/duplicates";
    const errorDir = "output/errors";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;

    // Spy on fsPromises.mkdir for this test
    const mkdirSpy = jest.spyOn(fsPromises, "mkdir");

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
      reporter,
    );

    expect(reporter.startSpinner).toHaveBeenCalledWith("Transferring files...");
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
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining("File transfer completed"),
    );
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled();
    // Use the spy for assertion
    expect(mkdirSpy).not.toHaveBeenCalled(); // No debug dir creation
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
      reporter,
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
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled();
  });

  it("should handle debug directory creation and report generation", async () => {
    const targetDir = "output/target_debug";
    const debugDir = "output/debug_report";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;

    // Mock fs functions for this test case using jest.spyOn
    const mkdirSpy = jest
      .spyOn(fsPromises, "mkdir")
      .mockResolvedValue(undefined);
    const readdirSpy = jest
      .spyOn(fsPromises, "readdir")
      .mockImplementationOnce(async () => [
        // Mock Dirent object with all required methods and properties
        {
          name: "old_report.html",
          isDirectory: () => false,
          isFile: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          path: "",
          parentPath: "",
        },
        {
          name: "temp.txt",
          isDirectory: () => false,
          isFile: () => true,
          isBlockDevice: () => false,
          isCharacterDevice: () => false,
          isSymbolicLink: () => false,
          isFIFO: () => false,
          isSocket: () => false,
          path: "",
          parentPath: "",
        },
      ]);
    const unlinkSpy = jest
      .spyOn(fsPromises, "unlink")
      .mockResolvedValue(undefined);

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
      reporter,
    );

    // Use the specific mock functions for expectations
    expect(mkdirSpy).toHaveBeenCalledWith(debugDir, { recursive: true });
    expect(readdirSpy).toHaveBeenCalledWith(debugDir, { withFileTypes: true }); // Check the mocked function call with options
    expect(unlinkSpy).toHaveBeenCalledWith(join(debugDir, "old_report.html"));
    expect(unlinkSpy).toHaveBeenCalledWith(join(debugDir, "temp.txt"));
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledTimes(1);
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledWith(
      mockDedupResult.duplicateSets,
      debugDir,
    );
    expect(reporter.logWarning).toHaveBeenCalledWith(
      expect.stringContaining("Debug mode: Duplicate set reports"),
    );
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1); // Still transfers files
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled();

    // Spies are restored in afterEach
  });

  it("should handle debug directory creation failure", async () => {
    const targetDir = "output/target_debug_fail";
    const debugDir = "output/debug_fail";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;
    const mkdirError = new Error("Permission denied");
    (mkdirError as NodeJS.ErrnoException).code = "EACCES"; // Use NodeJS.ErrnoException type

    // Mock fs.mkdir to reject for this test case
    const mkdirSpy = jest
      .spyOn(fsPromises, "mkdir")
      .mockImplementationOnce(async () => {
        throw mkdirError;
      });
    // Spy on readdir and unlink to ensure they are not called
    const readdirSpy = jest.spyOn(fsPromises, "readdir");
    const unlinkSpy = jest.spyOn(fsPromises, "unlink");

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
      reporter,
    );

    expect(mkdirSpy).toHaveBeenCalledWith(debugDir, { recursive: true });
    expect(reporter.logError).toHaveBeenCalledWith(
      expect.stringContaining(`Failed to create debug directory ${debugDir}`),
      expect.any(Error), // Check that the error object is passed
    );
    // Check that readdir/unlink were not called
    expect(readdirSpy).not.toHaveBeenCalled();
    expect(unlinkSpy).not.toHaveBeenCalled();
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled(); // Should not generate reports
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1); // Should still transfer files
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled(); // Transfer should still succeed

    // Spies are restored in afterEach
  });

  it("should handle debug report generation failure", async () => {
    const targetDir = "output/target_report_fail";
    const debugDir = "output/report_fail";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;
    const reportError = new Error("HTML generation failed");

    // Spy on mkdir to check it was called
    const mkdirSpy = jest
      .spyOn(fsPromises, "mkdir")
      .mockResolvedValue(undefined);
    // Mock the reporter method to throw
    (mockDebugReporter.generateHtmlReports as jest.Mock).mockImplementationOnce(
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
      reporter,
    );

    // Check if mkdir was called
    expect(mkdirSpy).toHaveBeenCalledWith(debugDir, { recursive: true });
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledTimes(1);
    expect(reporter.logError).toHaveBeenCalledWith(
      expect.stringContaining(
        `Failed to generate debug reports in ${debugDir}`,
      ),
      reportError,
    );
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1); // Should still transfer files
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled(); // Transfer should still succeed

    // Spies are restored in afterEach
  });

  it("should handle file transfer service failure", async () => {
    const targetDir = "output/target_transfer_fail";
    const format = "{NAME}.{EXT}";
    const shouldMove = false;
    const transferError = new Error("Disk full");

    (
      mockFileTransferService.transferOrganizedFiles as jest.Mock
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
        reporter,
      ),
    ).rejects.toThrow(transferError);

    expect(reporter.startSpinner).toHaveBeenCalledWith("Transferring files...");
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).toHaveBeenCalledTimes(1);
    expect(reporter.stopSpinnerFailure).toHaveBeenCalledWith(
      expect.stringContaining(`File transfer failed: ${transferError.message}`),
    );
    expect(reporter.stopSpinnerSuccess).not.toHaveBeenCalled();
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
      reporter,
    );

    expect(reporter.startSpinner).toHaveBeenCalledWith("Transferring files...");
    // Crucially, the transfer service should NOT be called if there's nothing to transfer
    expect(
      mockFileTransferService.transferOrganizedFiles,
    ).not.toHaveBeenCalled();
    // Check for a specific message or just success
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining("File transfer completed"),
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
      reporter,
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
    expect(reporter.stopSpinnerSuccess).toHaveBeenCalled();
  });
});
