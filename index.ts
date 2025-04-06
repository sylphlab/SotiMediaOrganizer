#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import {
  type ProgramOptions,
  type DeduplicationResult,
  type GatherFileInfoResult,
  FileProcessorConfig, // Added FileProcessorConfig
  SimilarityConfig, // Added SimilarityConfig
} from './src/types';
// import { MediaOrganizer } from "./MediaOrganizer"; // Removed old class import
import os from 'os';
// Removed import { Context } from "./src/contexts/Context";
// Removed duplicate import for discoverFilesFn
import { gatherFileInfoFn } from './src/gatherer';
import { deduplicateFilesFn } from './src/deduplicator'; // Import the new function
import { LmdbCache } from './src/caching/LmdbCache'; // Import dependencies
import { ExifTool } from 'exiftool-vendored';
import { WorkerPool } from './src/contexts/types'; // Removed unused Types import
import workerpool, { Pool } from 'workerpool'; // Import the Pool type
import sharp from 'sharp'; // Add sharp import
import type { CustomWorker } from './src/worker/worker'; // Import worker type for pool proxy
import { MediaComparator } from './MediaComparator';
import { transferFilesFn } from './src/transfer'; // Import the new function
import { DebugReporter } from './src/reporting/DebugReporter'; // Import dependencies
import { FileTransferService } from './src/services/FileTransferService';
import { discoverFilesFn } from './src/discovery';
import { MetadataDBService } from './src/services/MetadataDBService'; // Import DB service
import { CliReporter } from './src/reporting/CliReporter'; // Import the new reporter

function exitHandler() {
  console.log(chalk.red('\nmedia-curator was interrupted'));
  process.stdout.write('\u001B[?25h'); // Show cursor
  process.exit();
}

async function main() {
  process.on('SIGINT', exitHandler); // Handle Ctrl+C
  process.on('SIGTERM', exitHandler); // Handle kill commands

  const program = new Command();

  program
    .name('MediaCurator')
    .description(
      'Intelligently curate, organize, and deduplicate your digital photo and video collection.',
    )
    .version('1.0.0')
    .argument('<source>', 'Source directories to process')
    .argument('<destination>', 'Destination directory for organized media')
    .option(
      '-e, --error <path>',
      "Directory for files that couldn't be processed",
    )
    .option('-d, --duplicate <path>', 'Directory for duplicate files')
    .option(
      '--debug <path>',
      'Debug directory for storing all files in duplicate sets',
    )
    .option(
      '-c, --concurrency <number>',
      'Number of workers to use (default: CPU cores - 1)',
      parseInt,
      Math.max(1, Math.floor(os.cpus().length - 1)),
    )
    .option('-m, --move', 'Move files instead of copying them', false)
    .option(
      '-r, --resolution <number>',
      'Resolution for perceptual hashing',
      parseInt,
      64,
    )

    .option(
      '--min-frames <number>',
      'Minimum number of frames to extract from videos',
      parseInt,
      5,
    )
    .option(
      '--max-scene-frames <number>',
      'Maximum number of frames to extract from scene changes',
      parseInt,
      100,
    )
    .option(
      '--target-fps <number>',
      'Target frames per second for video extraction',
      parseFloat,
      2,
    )

    .option(
      '-w, --window-size <number>',
      'Window size for frame clustering',
      parseInt,
      5,
    )
    .option(
      '-p, --step-size <number>',
      'Step size for frame clustering',
      parseInt,
      1,
    )
    .option(
      '-F, --format <string>',
      'Format for destination directory',
      '{D.YYYY}/{D.MM}/{D.DD}/{NAME}.{EXT}',
    )
    .option(
      '--scene-change-threshold <number>',
      'Threshold for scene change detection',
      parseFloat,
      0.05,
    )
    .option(
      '--image-similarity-threshold <number>',
      'Threshold for image similarity (default: 0.99)',
      parseFloat,
      0.99,
    )
    .option(
      '--image-video-similarity-threshold <number>',
      'Threshold for image-video similarity. For image-video, we use a lower threshold because the frames are not always the same (default: 0.98)',
      parseFloat,
      0.93,
    )
    .option(
      '--video-similarity-threshold <number>',
      'Threshold for video similarity. For video similarity, we use an even lower threshold because the frames are not always the same (default: 0.97)',
      parseFloat,
      0.93,
    )
    .option(
      '--max-chunk-size <number>',
      'Maximum chunk size for file processing (default: 2MB)',
      parseInt,
      2 * 1024 * 1024,
    )
    .option('--verbose', 'Enable verbose logging', false) // Add verbose option
    .addHelpText(
      'after',
      `
  Format string placeholders:
    Image date (I.), File date (F.), Mixed date (D.):
      {*.YYYY} - Year (4 digits)       {*.YY} - Year (2 digits)
      {*.MMMM} - Month (full name)     {*.MMM} - Month (short name)
      {*.MM} - Month (2 digits)        {*.M} - Month (1-2 digits)
      {*.DD} - Day (2 digits)          {*.D} - Day (1-2 digits)
      {*.DDDD} - Day (full name)       {*.DDD} - Day (short name)
      {*.HH} - Hour, 24h (2 digits)    {*.H} - Hour, 24h (1-2 digits)
      {*.hh} - Hour, 12h (2 digits)    {*.h} - Hour, 12h (1-2 digits)
      {*.mm} - Minute (2 digits)       {*.m} - Minute (1-2 digits)
      {*.ss} - Second (2 digits)       {*.s} - Second (1-2 digits)
      {*.a} - am/pm                    {*.A} - AM/PM
      {*.WW} - Week of year (2 digits)

    Filename:
      {NAME} - Original filename (without extension)
      {NAME.L} - Lowercase filename
      {NAME.U} - Uppercase filename
      {EXT} - File extension (without dot)
      {RND} - Random 8-character hexadecimal string (for unique filenames)

    Other:
      {GEO} - Geolocation              {CAM} - Camera model
      {TYPE} - 'Image' or 'Other'
      {HAS.GEO} - 'GeoTagged' or 'NoGeo'
      {HAS.CAM} - 'WithCamera' or 'NoCamera'
      {HAS.DATE} - 'Dated' or 'NoDate'

  Example format strings:
    "{D.YYYY}/{D.MM}/{D.DD}/{NAME}.{EXT}"
    "{HAS.GEO}/{HAS.CAM}/{D.YYYY}/{D.MM}/{NAME}_{D.HH}{D.mm}.{EXT}"
    "{TYPE}/{D.YYYY}/{D.WW}/{CAM}/{D.YYYY}{D.MM}{D.DD}_{NAME.L}.{EXT}"
    "{HAS.DATE}/{D.YYYY}/{D.MMMM}/{D.D}-{D.DDDD}/{D.h}{D.mm}{D.a}_{NAME}.{EXT}"
    "{TYPE}/{CAM}/{D.YYYY}/{D.MM}/{D.DD}_{D.HH}{D.mm}_{NAME.U}.{EXT}"
      `,
    )
    .parse(process.argv);

  const [source, destination] = program.args as [string, string];
  const options = program.opts<ProgramOptions>();

  // Removed DI initialization: await Context.ensureInitialized(options);

  // const organizer = await Context.injector.getAsync(MediaOrganizer)!; // Removed instance retrieval
  let exifTool: ExifTool | null = null; // Declare outside try
  let pool: Pool | null = null; // Use the imported Pool type
  let cache: LmdbCache | null = null; // Declare cache outside try
  let reporter: CliReporter | null = null; // Declare reporter outside try
  // Removed duplicate cache declaration
  try {
    // Set sharp concurrency based on options
    sharp.concurrency(options.concurrency);

    // Manually instantiate dependencies
    reporter = new CliReporter(options.verbose); // Instantiate reporter
    const cacheResult = await LmdbCache.create(); // Use async factory method
    if (cacheResult.isErr()) {
      // Handle error during cache creation (e.g., log and exit)
      console.error(
        chalk.red('Failed to initialize cache database:'),
        cacheResult.error,
      );
      process.exit(1);
    }
    cache = cacheResult.value; // Assign inside try
    exifTool = new ExifTool({ maxProcs: options.concurrency }); // Assign inside try
    const dbService = new MetadataDBService(); // Instantiate DB Service
    // Instantiate WorkerPool
    pool = workerpool.pool(__dirname + '/src/worker/worker.js', {
      // Assign inside try
      workerType: 'thread', // Use 'thread' for Node.js environment
      maxWorkers: options.concurrency,
    });
    const workerPool: WorkerPool = await pool.proxy<CustomWorker>();
    // Construct config objects from options
    const fileProcessorConfig: FileProcessorConfig = {
      fileStats: { maxChunkSize: options.maxChunkSize },
      adaptiveExtraction: {
        resolution: options.resolution,
        sceneChangeThreshold: options.sceneChangeThreshold,
        minFrames: options.minFrames,
        maxSceneFrames: options.maxSceneFrames,
        targetFps: options.targetFps,
      },
    };
    const similarityConfig: SimilarityConfig = {
      // Construct SimilarityConfig
      windowSize: options.windowSize,
      stepSize: options.stepSize,
      imageSimilarityThreshold: options.imageSimilarityThreshold,
      imageVideoSimilarityThreshold: options.imageVideoSimilarityThreshold,
      videoSimilarityThreshold: options.videoSimilarityThreshold,
    };
    // Instantiate MediaComparator with dependencies
    const comparator = new MediaComparator(
      cache,
      fileProcessorConfig,
      exifTool,
      similarityConfig,
      options,
      workerPool,
    );
    // Instantiate DebugReporter with dependencies
    const debugReporter = new DebugReporter(
      comparator,
      cache,
      fileProcessorConfig,
      exifTool,
      workerPool,
    );
    // Instantiate FileTransferService - Needs refactoring as MediaProcessor is removed
    // For now, let's pass the dependencies needed by processSingleFile, assuming the service will be refactored later
    // TODO: Refactor FileTransferService constructor and internal logic
    const fileTransferService = new FileTransferService(
      fileProcessorConfig, // Pass config directly
      cache, // Pass cache directly
      exifTool, // Pass exifTool directly
      workerPool, // Pass workerPool directly
    );

    // Removed Context.injector.get calls
    // Stage 1: File Discovery
    reporter.logInfo('Stage 1: Discovering files...'); // Use reporter
    // Use the standalone discovery function
    const discoveredFiles = await discoverFilesFn(
      [source],
      options.concurrency,
      reporter, // Pass reporter
    );

    // Stage 2: Gathering Information
    reporter.logInfo('\nStage 2: Gathering file information...'); // Use reporter
    // Use the standalone gatherer function
    const gatherFileInfoResult = await gatherFileInfoFn(
      discoveredFiles,
      options.concurrency,
      fileProcessorConfig,
      cache,
      exifTool,
      workerPool,
      dbService, // Pass dbService
      reporter, // Pass reporter
    );

    // Stage 3: Deduplication
    reporter.logInfo('\nStage 3: Deduplicating files...'); // Use reporter
    // Use the standalone deduplicator function
    const deduplicationResult = await deduplicateFilesFn(
      gatherFileInfoResult.validFiles,
      comparator, // Pass comparator instance
      dbService, // Pass dbService
      similarityConfig, // Pass similarityConfig
      reporter, // Pass reporter
    );

    // Handle potential error from deduplication
    if (deduplicationResult.isErr()) {
      reporter.logError(
        `\nDeduplication failed: ${deduplicationResult.error.message}`,
        deduplicationResult.error,
      ); // Use reporter
      // Decide how to proceed - exit? continue without transfer?
      // For now, let's exit.
      throw deduplicationResult.error; // Rethrow to be caught by main try/catch
    }
    const deduplicationData = deduplicationResult.value; // Unwrap successful result
    // Stage 4: File Transfer
    reporter.logInfo('\nStage 4: Transferring files...'); // Use reporter
    // Use the standalone transfer function
    await transferFilesFn(
      gatherFileInfoResult,
      deduplicationData, // Pass unwrapped data
      destination,
      options.duplicate,
      options.error,
      options.debug,
      options.format,
      options.move,
      debugReporter, // Pass dependencies
      fileTransferService,
      // TODO: Pass dbService here? Transfer might need it if FileTransferService is refactored.
      reporter, // Pass reporter
    );

    reporter.logSuccess('\nMedia organization completed'); // Use reporter
    printResults(
      gatherFileInfoResult,
      deduplicationData, // Pass unwrapped data
      [...discoveredFiles.values()].reduce(
        (sum, files) => sum + files.length,
        0,
      ),
      reporter, // Pass reporter to printResults
    );
  } catch (error) {
    reporter?.logError('An unexpected error occurred:', error as Error); // Use reporter, ensure error is Error type
  } finally {
    // Ensure DB connection is closed
    // Need to access dbService instance created in try block
    // This requires moving dbService instantiation outside or handling closure differently
    // For now, assuming dbService might not be initialized if an early error occurred.
    await cache?.close(); // Close the cache DB
    // await dbService?.close(); // Optional chaining - dbService is separate now
    // Ensure exifTool is ended gracefully
    await exifTool?.end();
    // Ensure workerPool is terminated
    await pool?.terminate(); // Terminate the pool, not the proxy
  }
}

function printResults(
  gatherFileInfoResult: GatherFileInfoResult,
  deduplicationResult: DeduplicationResult,
  totalFiles: number,
  reporter: CliReporter, // Add reporter parameter
) {
  reporter.logInfo(`Total files discovered: ${totalFiles}`);
  reporter.logInfo(`Unique files: ${deduplicationResult.uniqueFiles.size}`);
  reporter.logWarning(
    `Duplicate sets: ${deduplicationResult.duplicateSets.length}`,
  );
  reporter.logWarning(
    `Total duplicates: ${Array.from(
      deduplicationResult.duplicateSets.values(),
    ).reduce((sum, set) => sum + set.duplicates.size, 0)}`,
  );
  reporter.logError(
    `Files with errors: ${gatherFileInfoResult.errorFiles.length}`,
  );
}

// Wrap main execution in a try/catch block
(async () => {
  try {
    await main();
    // Explicitly exit after successful completion? Optional.
    // process.exit(0);
  } catch (error) {
    // Use console.error directly here as reporter might not be initialized
    console.error(chalk.red('Critical error during execution:'), error);
    process.exit(1);
  }
})();
