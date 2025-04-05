#!/usr/bin/env node
// Removed import "reflect-metadata";

import { Command } from "commander";
import chalk from "chalk";
import {
  type ProgramOptions,
  type DeduplicationResult,
  type GatherFileInfoResult,
} from "./src/types";
// import { MediaOrganizer } from "./MediaOrganizer"; // Removed old class import
import os from "os";
// Removed import { Context } from "./src/contexts/Context";
// Removed duplicate import for discoverFilesFn
import { gatherFileInfoFn } from "./src/gatherer";
import { deduplicateFilesFn } from "./src/deduplicator"; // Import the new function
import { LmdbCache } from "./src/caching/LmdbCache"; // Import dependencies
import { FileProcessorConfig } from "./src/types";
import { ExifTool } from "exiftool-vendored";
import { WorkerPool, Types } from "./src/contexts/types";
import { MediaComparator } from "./MediaComparator";
import { transferFilesFn } from "./src/transfer"; // Import the new function
import { DebugReporter } from "./src/reporting/DebugReporter"; // Import dependencies
import { FileTransferService } from "./src/services/FileTransferService";
import { discoverFilesFn } from "./src/discovery"; // Import the new function

function exitHandler() {
  console.log(chalk.red("\nMediaCurator was interrupted"));
  process.stdout.write("\u001B[?25h"); // Show cursor
  process.exit();
}

async function main() {
  process.on("SIGINT", exitHandler); // Handle Ctrl+C
  process.on("SIGTERM", exitHandler); // Handle kill commands

  const program = new Command();

  program
    .name("mediacurator")
    .description(
      "Intelligently curate, organize, and deduplicate your digital photo and video collection.",
    )
    .version("1.0.0")
    .argument("<source>", "Source directories to process")
    .argument("<destination>", "Destination directory for organized media")
    .option(
      "-e, --error <path>",
      "Directory for files that couldn't be processed",
    )
    .option("-d, --duplicate <path>", "Directory for duplicate files")
    .option(
      "--debug <path>",
      "Debug directory for storing all files in duplicate sets",
    )
    .option(
      "-c, --concurrency <number>",
      "Number of workers to use (default: CPU cores - 1)",
      parseInt,
      Math.max(1, Math.floor(os.cpus().length - 1)),
    )
    .option("-m, --move", "Move files instead of copying them", false)
    .option(
      "-r, --resolution <number>",
      "Resolution for perceptual hashing",
      parseInt,
      64,
    )

    .option(
      "--min-frames <number>",
      "Minimum number of frames to extract from videos",
      parseInt,
      5,
    )
    .option(
      "--max-scene-frames <number>",
      "Maximum number of frames to extract from scene changes",
      parseInt,
      100,
    )
    .option(
      "--target-fps <number>",
      "Target frames per second for video extraction",
      parseFloat,
      2,
    )

    .option(
      "-w, --window-size <number>",
      "Window size for frame clustering",
      parseInt,
      5,
    )
    .option(
      "-p, --step-size <number>",
      "Step size for frame clustering",
      parseInt,
      1,
    )
    .option(
      "-F, --format <string>",
      "Format for destination directory",
      "{D.YYYY}/{D.MM}/{D.DD}/{NAME}.{EXT}",
    )
    .option(
      "--scene-change-threshold <number>",
      "Threshold for scene change detection",
      parseFloat,
      0.05,
    )
    .option(
      "--image-similarity-threshold <number>",
      "Threshold for image similarity (default: 0.99)",
      parseFloat,
      0.99,
    )
    .option(
      "--image-video-similarity-threshold <number>",
      "Threshold for image-video similarity. For image-video, we use a lower threshold because the frames are not always the same (default: 0.98)",
      parseFloat,
      0.93,
    )
    .option(
      "--video-similarity-threshold <number>",
      "Threshold for video similarity. For video similarity, we use an even lower threshold because the frames are not always the same (default: 0.97)",
      parseFloat,
      0.93,
    )
    .option(
      "--max-chunk-size <number>",
      "Maximum chunk size for file processing (default: 2MB)",
      parseInt,
      2 * 1024 * 1024,
    )
    .addHelpText(
      "after",
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
  try {
    // TODO: Manually instantiate dependencies or use a simple factory
    const cache = new LmdbCache(); // Example instantiation
    const exifTool = new ExifTool({ maxProcs: options.concurrency }); // Example instantiation
    // TODO: Instantiate WorkerPool (requires workerpool library setup)
    const workerPool: WorkerPool = null as any; // Placeholder
    // TODO: Construct config objects from options
    const fileProcessorConfig: FileProcessorConfig = {
        fileStats: { maxChunkSize: options.maxChunkSize },
        adaptiveExtraction: {
            resolution: options.resolution,
            sceneChangeThreshold: options.sceneChangeThreshold,
            minFrames: options.minFrames,
            maxSceneFrames: options.maxSceneFrames,
            targetFps: options.targetFps
        }
    };
    const similarityConfig = { // Construct SimilarityConfig
        windowSize: options.windowSize,
        stepSize: options.stepSize,
        imageSimilarityThreshold: options.imageSimilarityThreshold,
        imageVideoSimilarityThreshold: options.imageVideoSimilarityThreshold,
        videoSimilarityThreshold: options.videoSimilarityThreshold
    };
    // Instantiate MediaComparator with dependencies
    const comparator = new MediaComparator(cache, fileProcessorConfig, exifTool, similarityConfig, options, workerPool);
    // Instantiate DebugReporter with dependencies
    const debugReporter = new DebugReporter(comparator, cache, fileProcessorConfig, exifTool, workerPool);
    // Instantiate FileTransferService - Needs refactoring as MediaProcessor is removed
    // For now, let's pass the dependencies needed by processSingleFile, assuming the service will be refactored later
    // TODO: Refactor FileTransferService constructor and internal logic
    const fileTransferService = new FileTransferService({ // Pass dependencies as an object for now
        config: fileProcessorConfig,
        cache: cache,
        exifTool: exifTool,
        workerPool: workerPool
    } as any); // Use 'as any' temporarily until constructor is refactored

    // Removed Context.injector.get calls
    // Stage 1: File Discovery
    console.log(chalk.blue("Stage 1: Discovering files..."));
    // Use the standalone discovery function
    const discoveredFiles = await discoverFilesFn([source], options.concurrency);

    // Stage 2: Gathering Information
    console.log(chalk.blue("\nStage 2: Gathering file information..."));
    // Use the standalone gatherer function
    const gatherFileInfoResult = await gatherFileInfoFn(
        discoveredFiles,
        options.concurrency,
        fileProcessorConfig,
        cache,
        exifTool,
        workerPool
    );

    // Stage 3: Deduplication
    console.log(chalk.blue("\nStage 3: Deduplicating files..."));
    // Use the standalone deduplicator function
    const deduplicationResult = await deduplicateFilesFn(
        gatherFileInfoResult.validFiles,
        comparator, // Pass comparator instance
        fileProcessorConfig,
        cache,
        exifTool,
        workerPool
    );

    // Stage 4: File Transfer
    console.log(chalk.blue("\nStage 4: Transferring files..."));
    // Use the standalone transfer function
    await transferFilesFn(
        gatherFileInfoResult,
        deduplicationResult,
        destination,
        options.duplicate,
        options.error,
        options.debug,
        options.format,
        options.move,
        debugReporter, // Pass dependencies
        fileTransferService
    );

    console.log(chalk.green("\nMedia organization completed"));
    printResults(
      gatherFileInfoResult,
      deduplicationResult,
      [...discoveredFiles.values()].reduce(
        (sum, files) => sum + files.length,
        0,
      ),
    );
  } catch (error) {
    console.error(chalk.red("An unexpected error occurred:"), error);
  }
}

function printResults(
  gatherFileInfoResult: GatherFileInfoResult,
  deduplicationResult: DeduplicationResult,
  totalFiles: number,
) {
  console.log(chalk.cyan(`Total files discovered: ${totalFiles}`));
  console.log(
    chalk.cyan(`Unique files: ${deduplicationResult.uniqueFiles.size}`),
  );
  console.log(
    chalk.yellow(`Duplicate sets: ${deduplicationResult.duplicateSets.length}`),
  );
  console.log(
    chalk.yellow(
      `Total duplicates: ${Array.from(
        deduplicationResult.duplicateSets.values(),
      ).reduce((sum, set) => sum + set.duplicates.size, 0)}`,
    ),
  );
  console.log(
    chalk.red(`Files with errors: ${gatherFileInfoResult.errorFiles.length}`),
  );
}

try {
  await main();
} catch (error) {
  console.error(chalk.red("An unexpected error occurred:"), error);
  process.exit(1);
}
