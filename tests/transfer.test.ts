import { transferFilesFn } from "../src/transfer";
import { DebugReporter } from "../src/reporting/DebugReporter";
import { FileTransferService } from "../src/services/FileTransferService";
import { CliReporter } from "../src/reporting/CliReporter";
import * as fsPromises from "fs/promises";
import { join } from "path"; // Import join
import { GatherFileInfoResult, DeduplicationResult, DuplicateSet } from "../src/types";
import { ok, err, AppError, FileSystemError, AppResult } from "../src/errors"; // Add AppResult import
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals"; // Import from @jest/globals
import { Dirent } from "fs"; // Import Dirent for readdir mock

// Mocks will be defined inside vi.mock factories below

// Use vi.mock() for module mocking (mocks defined inside)
jest.mock("../src/reporting/DebugReporter", () => ({
    DebugReporter: class {
        generateHtmlReports = jest.fn(async () => {});
        constructor() {}
    },
}));

jest.mock("../src/services/FileTransferService", () => ({
    FileTransferService: class {
        transferOrganizedFiles = jest.fn(async () => {});
        constructor() {}
    },
}));

jest.mock("../src/reporting/CliReporter", () => {
     const CliReporterMock = class {
        logError = jest.fn();
        logWarning = jest.fn();
        startSpinner = jest.fn();
        stopSpinnerSuccess = jest.fn();
        stopSpinnerFailure = jest.fn();
        constructor() {}
    };
    return { CliReporter: CliReporterMock };
});

// Mock fs/promises at the top level for this unit test file
jest.mock("fs/promises", () => ({
    mkdir: jest.fn(async () => undefined),
    readdir: jest.fn(async () => [] as Dirent[]),
    unlink: jest.fn(async () => undefined),
}));


// Mock instances
// Provide correct number of args (using {} as any for simplicity as methods are mocked)
const mockDebugReporter = new DebugReporter({} as any, {} as any, {} as any, {} as any, {} as any);
const mockFileTransferService = new FileTransferService({} as any, {} as any, {} as any, {} as any);
const mockReporter = new CliReporter(false);

// Mock input data
const mockGatherResult: GatherFileInfoResult = { validFiles: ["valid1.txt"], errorFiles: ["error1.txt"] };
const mockDupResult: DeduplicationResult = {
  uniqueFiles: new Set(["valid1.txt"]),
  duplicateSets: [{ bestFile: "dupA1.txt", representatives: new Set(["dupA1.txt"]), duplicates: new Set(["dupA2.txt"]) }]
};
const mockEmptyDupResult: DeduplicationResult = { uniqueFiles: new Set(["valid1.txt"]), duplicateSets: [] };
const mockTargetDir = "/target";
const mockDuplicateDir = "/duplicates";
const mockErrorDir = "/errors";
const mockDebugDir = "/debug";
const mockFormat = "{YYYY}/{MM}/{filename}";
const mockShouldMove = false;

describe("transferFilesFn", () => {
  // Variables to hold imported mocks
  let debugReporterMock: typeof import("../src/reporting/DebugReporter");
  let transferServiceMock: typeof import("../src/services/FileTransferService");
  let reporterInstance: CliReporter; // Instance of mocked reporter
  // No need for fsPromisesMock variable

  beforeEach(async () => { // Make beforeEach async
    // Reset mocks
    jest.resetAllMocks();

    // Access mocked modules directly (jest.mock hoists)
    debugReporterMock = await import("../src/reporting/DebugReporter");
    transferServiceMock = await import("../src/services/FileTransferService");
    const { CliReporter: MockedCliReporter } = await import("../src/reporting/CliReporter");
    reporterInstance = new MockedCliReporter(false) as jest.Mocked<CliReporter>; // Cast instance


    // No need to spy on fsPromises here, it's mocked globally for this file

    // Apply default implementations for other mocks (using the imported mock objects directly)
    (mockDebugReporter.generateHtmlReports as jest.Mock).mockImplementation(async () => undefined); // Use mockImplementation
    (mockFileTransferService.transferOrganizedFiles as jest.Mock).mockImplementation(async () => undefined); // Use mockImplementation
  });

  it("should transfer files and generate debug report when all paths provided", async () => {
    await transferFilesFn(
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockDebugDir,
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    // Check the globally mocked functions
    expect(fsPromises.mkdir).toHaveBeenCalledWith(mockDebugDir, { recursive: true });
    expect(fsPromises.readdir).toHaveBeenCalledWith(mockDebugDir, { withFileTypes: true });
    expect(fsPromises.unlink).not.toHaveBeenCalled();
    // Access mocked methods via instantiated mocked classes or directly if static
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledWith(mockDupResult.duplicateSets, mockDebugDir); // Use mock object
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(expect.stringContaining("Debug mode: Duplicate set reports"));
    expect(reporterInstance.startSpinner).toHaveBeenCalledWith("Transferring files...");
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledWith( // Use mock object
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockFormat, mockShouldMove
    );
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(expect.stringContaining("File transfer completed"));
    expect(reporterInstance.logError).not.toHaveBeenCalled();
  });

  it("should skip debug report if debugDir is undefined", async () => {
     await transferFilesFn(
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, undefined, // No debugDir
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    // Check the globally mocked functions
    expect(fsPromises.mkdir).not.toHaveBeenCalled();
    expect(fsPromises.readdir).not.toHaveBeenCalled();
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled(); // Use mock object
    // const transferServiceInstance = new transferServiceMock.FileTransferService({} as any, {} as any, {} as any, {} as any); // Remove redundant instantiation
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledTimes(1); // Use mock object
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledTimes(1);
  });

   it("should skip debug report generation if no duplicate sets exist", async () => {
     await transferFilesFn(
      mockGatherResult, mockEmptyDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockDebugDir, // Use empty dup result
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    // Check the globally mocked function
    expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
    // const debugReporterInstance = new debugReporterMock.DebugReporter({} as any, {} as any, {} as any, {} as any, {} as any); // Remove redundant instantiation
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled(); // Use mock object
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(expect.stringContaining("Debug mode: No duplicate sets found"));
    const transferServiceInstance = new transferServiceMock.FileTransferService({} as any, {} as any, {} as any, {} as any);
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledTimes(1); // Use mock object
  });

  it("should handle mkdir failure for debugDir", async () => {
    const mkdirError = new Error("Mkdir failed");
    // Need to spy to mock rejection
    // Mock the globally mocked function for this test
    (fsPromises.mkdir as jest.Mock).mockImplementationOnce(async () => { throw mkdirError; }); // Use mockImplementationOnce

    await transferFilesFn(
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockDebugDir,
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    // Check the globally mocked function
    expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logError).toHaveBeenCalledWith(expect.stringContaining("Failed to create debug directory"), expect.any(FileSystemError));
    expect(mockDebugReporter.generateHtmlReports).not.toHaveBeenCalled(); // Use mock object
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledTimes(1); // Use mock object
  });

   it("should handle readdir failure for debugDir", async () => {
    const readdirError = new Error("Readdir failed");
    // Need to spy to mock rejection
    // Mock the globally mocked function for this test
    (fsPromises.readdir as jest.Mock).mockImplementationOnce(async () => { throw readdirError; }); // Use mockImplementationOnce

    await transferFilesFn(
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockDebugDir,
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    // Check the globally mocked functions
    expect(fsPromises.mkdir).toHaveBeenCalledTimes(1);
    expect(fsPromises.readdir).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(expect.stringContaining("Could not read debug directory"), );
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledTimes(1); // Use mock object
    const transferServiceInstance = new transferServiceMock.FileTransferService({} as any, {} as any, {} as any, {} as any);
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledTimes(1); // Use mock object
  });

   it("should handle unlink failure during debugDir cleanup", async () => {
    const unlinkError = new Error("Unlink failed");
    // Mock readdir to return a file
    // Need to spy to mock return value and rejection
    // Mock the globally mocked functions for this test
    (fsPromises.readdir as jest.Mock).mockImplementationOnce(async () => [{ name: "old_report.html", isDirectory: () => false, isFile: () => true } as Dirent]); // Use mockImplementationOnce
    (fsPromises.unlink as jest.Mock).mockImplementationOnce(async () => { throw unlinkError; }); // Use mockImplementationOnce

    await transferFilesFn(
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockDebugDir,
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    // Check the globally mocked function
    expect(fsPromises.unlink).toHaveBeenCalledWith(join(mockDebugDir, "old_report.html"));
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(expect.stringContaining("Could not clear file in debug directory"), );
    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledTimes(1); // Use mock object
    const transferServiceInstance = new transferServiceMock.FileTransferService({} as any, {} as any, {} as any, {} as any);
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledTimes(1); // Use mock object
  });

  it("should handle debug report generation failure", async () => {
    const reportError = new Error("Report generation failed");
    (mockDebugReporter.generateHtmlReports as jest.Mock).mockImplementation(async () => { throw reportError; }); // Use mockImplementation

     await transferFilesFn(
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockDebugDir,
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    expect(mockDebugReporter.generateHtmlReports).toHaveBeenCalledTimes(1); // Use mock object
    expect(reporterInstance.logError).toHaveBeenCalledWith(expect.stringContaining("Failed to generate debug reports"), reportError);
    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledTimes(1); // Use mock object
  });

  it("should handle file transfer failure", async () => {
    const transferError = new Error("Transfer failed");
    (mockFileTransferService.transferOrganizedFiles as jest.Mock).mockImplementation(async () => { throw transferError; }); // Use mockImplementation

    // Expect the function to rethrow the error
    await expect(transferFilesFn(
      mockGatherResult, mockDupResult, mockTargetDir, mockDuplicateDir, mockErrorDir, mockDebugDir,
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    )).rejects.toThrow(transferError);

    expect(mockFileTransferService.transferOrganizedFiles).toHaveBeenCalledTimes(1); // Use mock object
    expect(reporterInstance.stopSpinnerFailure).toHaveBeenCalledWith(expect.stringContaining("File transfer failed"));
    expect(reporterInstance.stopSpinnerSuccess).not.toHaveBeenCalled();
  });

  it("should skip transfer if no files need transferring", async () => {
     const emptyGatherResult: GatherFileInfoResult = { validFiles: [], errorFiles: [] };
     const emptyDupResultNoUnique: DeduplicationResult = { uniqueFiles: new Set(), duplicateSets: [] };

     await transferFilesFn(
      emptyGatherResult, emptyDupResultNoUnique, mockTargetDir, undefined, undefined, undefined, // No duplicate/error/debug dirs
      mockFormat, mockShouldMove, mockDebugReporter, mockFileTransferService, mockReporter
    );

    expect(mockFileTransferService.transferOrganizedFiles).not.toHaveBeenCalled(); // Use mock object
    expect(reporterInstance.startSpinner).toHaveBeenCalledWith("Transferring files..."); // Spinner starts
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(expect.stringContaining("No files needed transferring")); // Spinner stops with specific message
  });

});