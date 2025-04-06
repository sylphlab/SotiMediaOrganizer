import { transferFilesFn } from '../src/transfer';
import { DebugReporter } from '../src/reporting/DebugReporter';
import { FileTransferService } from '../src/services/FileTransferService';
import { CliReporter } from '../src/reporting/CliReporter';
import * as fsPromises from 'fs/promises';
import { join } from 'path'; // Import join
import {
  GatherFileInfoResult,
  DeduplicationResult,
  DuplicateSet,
} from '../src/types';
import { ok, err, AppError, FileSystemError, AppResult } from '../src/errors'; // Add AppResult import
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'; // Import from vitest
import { Dirent } from 'fs'; // Import Dirent for readdir mock

// Mocks will be defined inside vi.mock factories below

// Use vi.mock() for module mocking (mocks defined inside)
vi.mock('../src/reporting/DebugReporter', () => ({
  DebugReporter: class {
    generateHtmlReports = vi.fn(async () => {});
    constructor() {}
  },
}));

vi.mock('../src/services/FileTransferService', () => ({
  FileTransferService: class {
    transferOrganizedFiles = vi.fn(async () => {});
    constructor() {}
  },
}));

vi.mock('../src/reporting/CliReporter', () => {
  const CliReporterMock = class {
    logError = vi.fn();
    logWarning = vi.fn();
    startSpinner = vi.fn();
    stopSpinnerSuccess = vi.fn();
    stopSpinnerFailure = vi.fn();
    constructor() {}
  };
  return { CliReporter: CliReporterMock };
});

// Mock fs/promises at the top level for this unit test file
vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  readdir: vi.fn(async () => [] as Dirent[]),
  unlink: vi.fn(async () => undefined),
}));

// Mock instances (Use top-level mocks directly in tests)
const mockDebugReporter = {
  generateHtmlReports: vi.fn(async () => {}),
} as unknown as DebugReporter;
const mockFileTransferService = {
  transferOrganizedFiles: vi.fn(async () => {}),
} as unknown as FileTransferService;
// We will instantiate MockCliReporter in beforeEach

// Mock input data
const mockGatherResult: GatherFileInfoResult = {
  validFiles: ['valid1.txt'],
  errorFiles: ['error1.txt'],
};
const mockDupResult: DeduplicationResult = {
  uniqueFiles: new Set(['valid1.txt']),
  duplicateSets: [
    {
      bestFile: 'dupA1.txt',
      representatives: new Set(['dupA1.txt']),
      duplicates: new Set(['dupA2.txt']),
    },
  ],
};
const mockEmptyDupResult: DeduplicationResult = {
  uniqueFiles: new Set(['valid1.txt']),
  duplicateSets: [],
};
const mockTargetDir = '/target';
const mockDuplicateDir = '/duplicates';
const mockErrorDir = '/errors';
const mockDebugDir = '/debug';
const mockFormat = '{YYYY}/{MM}/{filename}';
const mockShouldMove = false;

describe('transferFilesFn', () => {
  // Variables to hold imported mocks
  let reporterInstance: CliReporter; // Instance of mocked reporter

  beforeEach(async () => {
    // Make beforeEach async
    // Reset mocks
    vi.resetAllMocks();

    // Import mocked modules
    const fsPromises = await import('fs/promises'); // Import mocked fs/promises
    const { CliReporter: MockedCliReporter } = await vi.importMock<
      typeof import('../src/reporting/CliReporter')
    >('../src/reporting/CliReporter');

    // Instantiate reporter instance for assertions
    reporterInstance = new MockedCliReporter(false);

    // Clear specific mocks if needed (resetAllMocks might be sufficient)
    // Use the top-level mock objects directly
    vi.mocked(mockDebugReporter.generateHtmlReports).mockClear();
    vi.mocked(mockFileTransferService.transferOrganizedFiles).mockClear();

    // Apply default implementations using vi.mocked
    vi.mocked(fsPromises.mkdir).mockResolvedValue(undefined);
    vi.mocked(fsPromises.readdir).mockResolvedValue([]);
    vi.mocked(fsPromises.unlink).mockResolvedValue(undefined);
    vi.mocked(mockDebugReporter.generateHtmlReports).mockResolvedValue(
      undefined,
    );
    vi.mocked(mockFileTransferService.transferOrganizedFiles).mockResolvedValue(
      undefined,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should transfer files and generate debug report when all paths provided', async () => {
    await transferFilesFn(
      mockGatherResult,
      mockDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      mockDebugDir,
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    // Check the globally mocked functions
    const fsPromises = await import('fs/promises'); // Import mock inside test if needed for assertion
    expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledWith(mockDebugDir, {
      recursive: true,
    });
    expect(vi.mocked(fsPromises.readdir)).toHaveBeenCalledWith(mockDebugDir, {
      withFileTypes: true,
    });
    expect(vi.mocked(fsPromises.unlink)).not.toHaveBeenCalled();
    // Access mocked methods via top-level mock objects
    expect(
      vi.mocked(mockDebugReporter.generateHtmlReports),
    ).toHaveBeenCalledWith(mockDupResult.duplicateSets, mockDebugDir);
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('Debug mode: Duplicate set reports'),
    );
    expect(reporterInstance.startSpinner).toHaveBeenCalledWith(
      'Transferring files...',
    );
    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledWith(
      mockGatherResult,
      mockDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      mockFormat,
      mockShouldMove,
    );
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining('File transfer completed'),
    );
    expect(reporterInstance.logError).not.toHaveBeenCalled();
  });

  it('should skip debug report if debugDir is undefined', async () => {
    await transferFilesFn(
      mockGatherResult,
      mockDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      undefined, // No debugDir
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    // Check the globally mocked functions
    const fsPromises = await import('fs/promises'); // Import mock inside test if needed for assertion
    expect(vi.mocked(fsPromises.mkdir)).not.toHaveBeenCalled();
    expect(vi.mocked(fsPromises.readdir)).not.toHaveBeenCalled();
    expect(
      vi.mocked(mockDebugReporter.generateHtmlReports),
    ).not.toHaveBeenCalled();
    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledTimes(1);
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledTimes(1);
  });

  it('should skip debug report generation if no duplicate sets exist', async () => {
    await transferFilesFn(
      mockGatherResult,
      mockEmptyDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      mockDebugDir, // Use empty dup result
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    // Check the globally mocked function
    const fsPromises = await import('fs/promises'); // Import mock inside test if needed for assertion
    expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(mockDebugReporter.generateHtmlReports),
    ).not.toHaveBeenCalled();
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('Debug mode: No duplicate sets found'),
    );
    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledTimes(1);
  });

  it('should handle mkdir failure for debugDir', async () => {
    const mkdirError = new Error('Mkdir failed');
    // Mock the globally mocked function for this test
    const fsPromises = await import('fs/promises'); // Import mock inside test
    vi.mocked(fsPromises.mkdir).mockRejectedValueOnce(mkdirError);

    await transferFilesFn(
      mockGatherResult,
      mockDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      mockDebugDir,
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    // Check the globally mocked function
    expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to create debug directory'),
      expect.any(FileSystemError),
    );
    expect(
      vi.mocked(mockDebugReporter.generateHtmlReports),
    ).not.toHaveBeenCalled();
    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledTimes(1);
  });

  it('should handle readdir failure for debugDir', async () => {
    const readdirError = new Error('Readdir failed');
    // Mock the globally mocked function for this test
    const fsPromises = await import('fs/promises'); // Import mock inside test
    vi.mocked(fsPromises.readdir).mockRejectedValueOnce(readdirError);

    await transferFilesFn(
      mockGatherResult,
      mockDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      mockDebugDir,
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    // Check the globally mocked functions
    expect(vi.mocked(fsPromises.mkdir)).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fsPromises.readdir)).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('Could not read debug directory'),
    );
    expect(
      vi.mocked(mockDebugReporter.generateHtmlReports),
    ).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledTimes(1);
  });

  it('should handle unlink failure during debugDir cleanup', async () => {
    const unlinkError = new Error('Unlink failed');
    // Mock the globally mocked functions for this test
    const fsPromises = await import('fs/promises'); // Import mock inside test
    vi.mocked(fsPromises.readdir).mockResolvedValueOnce([
      {
        name: 'old_report.html',
        isDirectory: () => false,
        isFile: () => true,
      } as Dirent,
    ]);
    vi.mocked(fsPromises.unlink).mockRejectedValueOnce(unlinkError);

    await transferFilesFn(
      mockGatherResult,
      mockDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      mockDebugDir,
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    // Check the globally mocked function
    expect(vi.mocked(fsPromises.unlink)).toHaveBeenCalledWith(
      join(mockDebugDir, 'old_report.html'),
    );
    expect(reporterInstance.logWarning).toHaveBeenCalledWith(
      expect.stringContaining('Could not clear file in debug directory'),
    );
    expect(
      vi.mocked(mockDebugReporter.generateHtmlReports),
    ).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledTimes(1);
  });

  it('should handle debug report generation failure', async () => {
    const reportError = new Error('Report generation failed');
    vi.mocked(mockDebugReporter.generateHtmlReports).mockRejectedValue(
      reportError,
    );

    await transferFilesFn(
      mockGatherResult,
      mockDupResult,
      mockTargetDir,
      mockDuplicateDir,
      mockErrorDir,
      mockDebugDir,
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    expect(
      vi.mocked(mockDebugReporter.generateHtmlReports),
    ).toHaveBeenCalledTimes(1);
    expect(reporterInstance.logError).toHaveBeenCalledWith(
      expect.stringContaining('Failed to generate debug reports'),
      reportError,
    );
    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledTimes(1);
  });

  it('should handle file transfer failure', async () => {
    const transferError = new Error('Transfer failed');
    vi.mocked(mockFileTransferService.transferOrganizedFiles).mockRejectedValue(
      transferError,
    );

    // Expect the function to rethrow the error
    await expect(
      transferFilesFn(
        mockGatherResult,
        mockDupResult,
        mockTargetDir,
        mockDuplicateDir,
        mockErrorDir,
        mockDebugDir,
        mockFormat,
        mockShouldMove,
        mockDebugReporter,
        mockFileTransferService,
        reporterInstance, // Pass reporterInstance
      ),
    ).rejects.toThrow(transferError);

    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).toHaveBeenCalledTimes(1);
    expect(reporterInstance.stopSpinnerFailure).toHaveBeenCalledWith(
      expect.stringContaining('File transfer failed'),
    );
    expect(reporterInstance.stopSpinnerSuccess).not.toHaveBeenCalled();
  });

  it('should skip transfer if no files need transferring', async () => {
    const emptyGatherResult: GatherFileInfoResult = {
      validFiles: [],
      errorFiles: [],
    };
    const emptyDupResultNoUnique: DeduplicationResult = {
      uniqueFiles: new Set(),
      duplicateSets: [],
    };

    await transferFilesFn(
      emptyGatherResult,
      emptyDupResultNoUnique,
      mockTargetDir,
      undefined,
      undefined,
      undefined, // No duplicate/error/debug dirs
      mockFormat,
      mockShouldMove,
      mockDebugReporter,
      mockFileTransferService,
      reporterInstance, // Pass reporterInstance
    );

    expect(
      vi.mocked(mockFileTransferService.transferOrganizedFiles),
    ).not.toHaveBeenCalled();
    expect(reporterInstance.startSpinner).toHaveBeenCalledWith(
      'Transferring files...',
    ); // Spinner starts
    expect(reporterInstance.stopSpinnerSuccess).toHaveBeenCalledWith(
      expect.stringContaining('No files needed transferring'),
    ); // Spinner stops with specific message
  });
});
