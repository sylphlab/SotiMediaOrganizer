import { discoverFilesFn } from '../src/discovery';
import { CliReporter } from '../src/reporting/CliReporter';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import * as utils from '../src/utils';
import { FileType } from '../src/types';
import { ok, err, FileSystemError } from '../src/errors';
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'; // Import vi from vitest
import { Dirent } from 'fs';

// Mock dependencies
// Mock fs/promises using vi.mock and expose the mock function
// Mock fs/promises using vi.mock (mock function defined inside)
vi.mock('fs/promises', () => ({
  readdir: vi.fn(async () => [] as Dirent[]),
}));

// Mock reporting/CliReporter using vi.mock and expose mocks
// Mock reporting/CliReporter using vi.mock (mock functions defined inside)
vi.mock('../src/reporting/CliReporter', () => {
  const CliReporterMock = class {
    startSpinner = vi.fn(() => {});
    updateSpinnerText = vi.fn(() => {});
    stopSpinnerSuccess = vi.fn(() => {});
    logError = vi.fn(() => {});
    logInfo = vi.fn(() => {});
    logSuccess = vi.fn(() => {});
    constructor() {}
  };
  return { CliReporter: CliReporterMock };
});

// We will spy on utils.getFileTypeByExt in beforeEach instead of using vi.mock
import { ALL_SUPPORTED_EXTENSIONS as originalAllSupportedExtensions } from '../src/utils';

// Mock instances
const mockReporter = new CliReporter(false);

// Helper to create mock Dirent
const createDirent = (
  name: string,
  isDirectory: boolean,
  parentPath = '/mock',
): Dirent => ({
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

describe('discoverFilesFn', () => {
  // Variables to hold imported mocks for use in tests
  let fsPromisesMock: typeof fsPromises;
  // No need for utilsMock variable
  let reporterInstance: CliReporter; // Use the actual class type

  beforeEach(async () => {
    // Make beforeEach async
    // Reset most mocks, but handle async mock separately
    // Reset all mocks
    vi.resetAllMocks(); // Use resetAllMocks to clear state but keep mocks

    // Import the mocked modules
    const fsPromisesMocked =
      await vi.importMock<typeof import('fs/promises')>('fs/promises');
    const { CliReporter: MockedCliReporter } = await vi.importMock<
      typeof import('../src/reporting/CliReporter')
    >('../src/reporting/CliReporter');
    // Assign to variables accessible in tests
    fsPromisesMock = fsPromisesMocked; // Assign to the variable declared outside
    reporterInstance = new MockedCliReporter(false);

    // Apply default implementations for this test run
    vi.mocked(fsPromisesMock.readdir).mockResolvedValue([]); // Use vi.mocked

    // Spy on and set default implementation for utils.getFileTypeByExt
    vi.spyOn(utils, 'getFileTypeByExt').mockReturnValue(ok(FileType.Image));
  });

  it('should return an empty map for empty source directories', async () => {
    const result = await discoverFilesFn([], 1, reporterInstance); // Use reporterInstance
    expect(result.size).toBe(0);
    expect(vi.mocked(fsPromisesMock.readdir)).not.toHaveBeenCalled(); // Use vi.mocked
    expect(reporterInstance.startSpinner).toHaveBeenCalledTimes(1);
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledTimes(1);
  });

  it('should find supported files in a single directory', async () => {
    const sourceDirs = ['/testDir'];
    const mockEntries = [
      createDirent('a.jpg', false),
      createDirent('b.png', false),
      createDirent('c.txt', false), // Unsupported
      createDirent('d.MP4', false), // Supported (case-insensitive check)
    ];
    vi.mocked(fsPromisesMock.readdir).mockResolvedValue(mockEntries); // Use vi.mocked

    const result = await discoverFilesFn(sourceDirs, 1, reporterInstance); // Use reporterInstance

    expect(result.size).toBe(3); // jpg, png, mp4
    expect(result.get('jpg')).toEqual([path.join('/testDir', 'a.jpg')]);
    expect(result.get('png')).toEqual([path.join('/testDir', 'b.png')]);
    expect(result.get('mp4')).toEqual([path.join('/testDir', 'd.MP4')]);
    expect(result.has('txt')).toBe(false);
    expect(vi.mocked(fsPromisesMock.readdir)).toHaveBeenCalledWith('/testDir', {
      withFileTypes: true,
    }); // Use vi.mocked
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Found 3 files'),
    );
    expect(reporterInstance.logInfo).toHaveBeenCalledTimes(4); // Header + 3 formats
    expect(reporterInstance.logSuccess).toHaveBeenCalledTimes(1); // Total
  });

  it('should find files recursively in subdirectories', async () => {
    const sourceDirs = ['/root'];
    const rootEntries = [
      createDirent('file1.jpeg', false),
      createDirent('subdir', true),
      createDirent('ignored.log', false),
    ];
    const subdirEntries = [
      createDirent('file2.mov', false),
      createDirent('emptySubdir', true),
    ];
    const emptySubdirEntries: Dirent[] = [];

    vi.mocked(fsPromisesMock.readdir) // Use vi.mocked
      .mockResolvedValueOnce(rootEntries)
      .mockResolvedValueOnce(subdirEntries)
      .mockResolvedValueOnce(emptySubdirEntries);

    // Mock getFileTypeByExt for sorting log
    // Mock getFileTypeByExt for sorting log using the spy
    vi.spyOn(utils, 'getFileTypeByExt')
      .mockReturnValueOnce(ok(FileType.Image)) // jpeg
      .mockReturnValueOnce(ok(FileType.Video)); // mov

    // Set concurrency to 1 for this test to simplify async flow
    const result = await discoverFilesFn(sourceDirs, 1, reporterInstance); // Use reporterInstance

    expect(result.size).toBe(2);
    expect(result.get('jpeg')).toEqual([path.join('/root', 'file1.jpeg')]);
    expect(result.get('mov')).toEqual([
      path.join('/root', 'subdir', 'file2.mov'),
    ]);
    expect(vi.mocked(fsPromisesMock.readdir)).toHaveBeenCalledTimes(3); // Use vi.mocked
    expect(vi.mocked(fsPromisesMock.readdir)).toHaveBeenCalledWith('/root', {
      withFileTypes: true,
    }); // Use vi.mocked
    expect(vi.mocked(fsPromisesMock.readdir)).toHaveBeenCalledWith(
      path.join('/root', 'subdir'),
      { withFileTypes: true },
    ); // Use vi.mocked
    expect(vi.mocked(fsPromisesMock.readdir)).toHaveBeenCalledWith(
      path.join('/root', 'subdir', 'emptySubdir'),
      { withFileTypes: true },
    ); // Use vi.mocked
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Found 2 files'),
    );
    // Check log sorting (Video first due to mock)
    expect(reporterInstance.logInfo).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining('mov'),
    );
    expect(reporterInstance.logInfo).toHaveBeenNthCalledWith(
      3,
      expect.stringContaining('jpeg'),
    );
  });

  it('should handle readdir errors gracefully', async () => {
    const sourceDirs = ['/root'];
    const error = new Error('Permission denied');
    vi.mocked(fsPromisesMock.readdir).mockRejectedValue(error); // Use vi.mocked

    const result = await discoverFilesFn(sourceDirs, 1, reporterInstance); // Use reporterInstance

    expect(result.size).toBe(0); // No files found due to error
    expect(vi.mocked(fsPromisesMock.readdir)).toHaveBeenCalledTimes(1); // Use vi.mocked
    expect(reporterInstance.logError).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logError).toHaveBeenCalledWith(
      expect.stringContaining('Error scanning directory /root'),
    );
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Found 0 files'),
    ); // Still finishes
  });

  it('should handle readdir errors in subdirectories gracefully', async () => {
    const sourceDirs = ['/root'];
    const rootEntries = [
      createDirent('file1.jpeg', false),
      createDirent('badSubdir', true),
    ];
    const error = new Error('Cannot read');

    vi.mocked(fsPromisesMock.readdir) // Use vi.mocked
      .mockResolvedValueOnce(rootEntries)
      .mockRejectedValueOnce(error); // Error in badSubdir

    const result = await discoverFilesFn(sourceDirs, 1, reporterInstance); // Use reporterInstance

    expect(result.size).toBe(1); // Only file1.jpeg found
    expect(result.get('jpeg')).toEqual([path.join('/root', 'file1.jpeg')]);
    expect(vi.mocked(fsPromisesMock.readdir)).toHaveBeenCalledTimes(2); // Use vi.mocked
    expect(reporterInstance.logError).toHaveBeenCalledTimes(1); // Use reporterInstance
    expect(reporterInstance.logError).toHaveBeenCalledWith(
      expect.stringContaining(
        'Error scanning directory ' + path.join('/root', 'badSubdir'),
      ),
    ); // Use reporterInstance
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining('Found 1 files'),
    ); // Use reporterInstance
  });
});
