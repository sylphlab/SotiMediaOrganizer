import { discoverFilesFn } from "../src/discovery";
import { CliReporter } from "../src/reporting/CliReporter";
import * as fsPromises from "fs/promises";
import * as path from "path";
import * as utils from "../src/utils";
import { FileType } from "../src/types";
import { ok, err, FileSystemError } from "../src/errors";
import { jest, describe, it, expect, beforeEach, afterEach } from "@jest/globals"; // Import jest from @jest/globals
import { Dirent } from "fs";

// Mock dependencies
// Mock fs/promises using vi.mock and expose the mock function
// Mock fs/promises using vi.mock (mock function defined inside)
jest.mock("fs/promises", () => ({
    readdir: jest.fn(async () => [] as Dirent[]),
}));

// Mock reporting/CliReporter using vi.mock and expose mocks
// Mock reporting/CliReporter using vi.mock (mock functions defined inside)
jest.mock("../src/reporting/CliReporter", () => {
    const CliReporterMock = class {
        startSpinner = jest.fn(() => {});
        updateSpinnerText = jest.fn(() => {});
        stopSpinnerSuccess = jest.fn(() => {});
        logError = jest.fn(() => {});
        logInfo = jest.fn(() => {});
        logSuccess = jest.fn(() => {});
        constructor() {}
    };
    return { CliReporter: CliReporterMock };
});

// We will spy on utils.getFileTypeByExt in beforeEach instead of using vi.mock
import { ALL_SUPPORTED_EXTENSIONS as originalAllSupportedExtensions } from "../src/utils";

// Mock instances
const mockReporter = new CliReporter(false);

// Helper to create mock Dirent
const createDirent = (name: string, isDirectory: boolean, parentPath = "/mock"): Dirent => ({
    name,
    isDirectory: () => isDirectory,
    isFile: () => !isDirectory,
    isBlockDevice: () => false,
    isCharacterDevice: () => false,
    isFIFO: () => false,
    isSocket: () => false,
    isSymbolicLink: () => false,
    parentPath: parentPath, // Add parentPath
    path: path.join(parentPath, name), // Add path
});

describe("discoverFilesFn", () => {
    // Variables to hold imported mocks for use in tests
    let fsPromisesMock: typeof fsPromises;
    // No need for utilsMock variable
    let reporterInstance: CliReporter; // Use the actual class type

    beforeEach(async () => { // Make beforeEach async
        // Reset most mocks, but handle async mock separately
        // Reset all mocks
        jest.resetAllMocks(); // Use resetAllMocks

        // Access mocked modules directly (jest.mock hoists)
        fsPromisesMock = fsPromises as jest.Mocked<typeof fsPromises>;
        // Need to import the mocked class to instantiate it
        const { CliReporter: MockedCliReporter } = await import("../src/reporting/CliReporter");
        reporterInstance = new MockedCliReporter(false) as jest.Mocked<CliReporter>; // Cast instance

        // Apply default implementations for this test run
        (fsPromisesMock.readdir as jest.Mock).mockImplementation(async () => []); // Use mockImplementation

        // Spy on and set default implementation for utils.getFileTypeByExt
        jest.spyOn(utils, 'getFileTypeByExt').mockReturnValue(ok(FileType.Image));
    });

    it("should return an empty map for empty source directories", async () => {
        const result = await discoverFilesFn([], 1, mockReporter);
        expect(result.size).toBe(0);
        expect(fsPromisesMock.readdir).not.toHaveBeenCalled();
        expect(reporterInstance.startSpinner).toHaveBeenCalledTimes(1);
        expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledTimes(1);
    });

    it("should find supported files in a single directory", async () => {
        const sourceDirs = ["/testDir"];
        const mockEntries = [
            createDirent("a.jpg", false),
            createDirent("b.png", false),
            createDirent("c.txt", false), // Unsupported
            createDirent("d.MP4", false), // Supported (case-insensitive check)
        ];
        (fsPromisesMock.readdir as jest.Mock).mockImplementation(async () => mockEntries); // Use mockImplementation

        const result = await discoverFilesFn(sourceDirs, 1, mockReporter);

        expect(result.size).toBe(3); // jpg, png, mp4
        expect(result.get("jpg")).toEqual([path.join("/testDir", "a.jpg")]);
        expect(result.get("png")).toEqual([path.join("/testDir", "b.png")]);
        expect(result.get("mp4")).toEqual([path.join("/testDir", "d.MP4")]);
        expect(result.has("txt")).toBe(false);
        expect(fsPromisesMock.readdir).toHaveBeenCalledWith("/testDir", { withFileTypes: true });
        expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(expect.stringContaining("Found 3 files"));
        expect(reporterInstance.logInfo).toHaveBeenCalledTimes(4); // Header + 3 formats
        expect(reporterInstance.logSuccess).toHaveBeenCalledTimes(1); // Total
    });

    it("should find files recursively in subdirectories", async () => {
        const sourceDirs = ["/root"];
        const rootEntries = [
            createDirent("file1.jpeg", false),
            createDirent("subdir", true),
            createDirent("ignored.log", false),
        ];
        const subdirEntries = [
            createDirent("file2.mov", false),
            createDirent("emptySubdir", true),
        ];
        const emptySubdirEntries: Dirent[] = [];

        (fsPromisesMock.readdir as jest.Mock) // Use jest.Mock
            .mockImplementationOnce(async () => rootEntries) // Use mockImplementationOnce
            .mockImplementationOnce(async () => subdirEntries) // Use mockImplementationOnce
            .mockImplementationOnce(async () => emptySubdirEntries); // Use mockImplementationOnce

        // Mock getFileTypeByExt for sorting log
        // Mock getFileTypeByExt for sorting log using the spy
        jest.spyOn(utils, 'getFileTypeByExt')
            .mockReturnValueOnce(ok(FileType.Image)) // jpeg
            .mockReturnValueOnce(ok(FileType.Video)); // mov

        // Set concurrency to 1 for this test to simplify async flow
        const result = await discoverFilesFn(sourceDirs, 1, mockReporter);

        expect(result.size).toBe(2);
        expect(result.get("jpeg")).toEqual([path.join("/root", "file1.jpeg")]);
        expect(result.get("mov")).toEqual([path.join("/root", "subdir", "file2.mov")]);
        expect(fsPromisesMock.readdir).toHaveBeenCalledTimes(3);
        expect(fsPromisesMock.readdir).toHaveBeenCalledWith("/root", { withFileTypes: true });
        expect(fsPromisesMock.readdir).toHaveBeenCalledWith(path.join("/root", "subdir"), { withFileTypes: true });
        expect(fsPromisesMock.readdir).toHaveBeenCalledWith(path.join("/root", "subdir", "emptySubdir"), { withFileTypes: true });
        expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(expect.stringContaining("Found 2 files"));
         // Check log sorting (Video first due to mock)
        expect(reporterInstance.logInfo).toHaveBeenNthCalledWith(2, expect.stringContaining("mov"));
        expect(reporterInstance.logInfo).toHaveBeenNthCalledWith(3, expect.stringContaining("jpeg"));
    });

    it("should handle readdir errors gracefully", async () => {
        const sourceDirs = ["/root"];
        const error = new Error("Permission denied");
        (fsPromisesMock.readdir as jest.Mock).mockImplementation(async () => { throw error; }); // Use mockImplementation

        const result = await discoverFilesFn(sourceDirs, 1, mockReporter);

        expect(result.size).toBe(0); // No files found due to error
        expect(fsPromisesMock.readdir).toHaveBeenCalledTimes(1);
        expect(reporterInstance.logError).toHaveBeenCalledTimes(1);
        expect(reporterInstance.logError).toHaveBeenCalledWith(expect.stringContaining("Error scanning directory /root"));
        expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(expect.stringContaining("Found 0 files")); // Still finishes
    });

     it("should handle readdir errors in subdirectories gracefully", async () => {
        const sourceDirs = ["/root"];
         const rootEntries = [
            createDirent("file1.jpeg", false),
            createDirent("badSubdir", true),
        ];
        const error = new Error("Cannot read");

         (fsPromisesMock.readdir as jest.Mock) // Use jest.Mock
            .mockImplementationOnce(async () => rootEntries) // Use mockImplementationOnce
            .mockImplementationOnce(async () => { throw error; }); // Use mockImplementationOnce

        const result = await discoverFilesFn(sourceDirs, 1, mockReporter);

        expect(result.size).toBe(1); // Only file1.jpeg found
        expect(result.get("jpeg")).toEqual([path.join("/root", "file1.jpeg")]);
        expect(fsPromisesMock.readdir).toHaveBeenCalledTimes(2); // Use fsPromisesMock
        expect(reporterInstance.logError).toHaveBeenCalledTimes(1); // Use reporterInstance
        expect(reporterInstance.logError).toHaveBeenCalledWith(expect.stringContaining("Error scanning directory " + path.join("/root", "badSubdir"))); // Use reporterInstance
        expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(expect.stringContaining("Found 1 files")); // Use reporterInstance
    });

});