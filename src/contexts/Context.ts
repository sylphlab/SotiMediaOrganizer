import { Container } from "inversify";
import { ExifTool } from "exiftool-vendored";
import { createExifTool } from "../external/ExifToolService"; // Import createExifTool
import {
  AdaptiveExtractionConfig,
  FeatureExtractionConfig,
  SimilarityConfig,
  FileStatsConfig,
  ProgramOptions,
  FileProcessorConfig, // Import the interface type
} from "../types";
import { MediaComparator } from "../../MediaComparator";
// import { MediaOrganizer } from "../../MediaOrganizer"; // Removed old class import
// import { MediaProcessor } from "../MediaProcessor"; // Removed old class import
// import { AdaptiveExtractionJob } from "../jobs/AdaptiveExtractionJob"; // Removed old class import
// import { MetadataExtractionJob } from "../jobs/MetadataExtractionJob"; // Removed old class import
// import { FileStatsJob } from "../jobs/FileStatsJob"; // Removed old class import
// import { DatabaseContext } from "./DatabaseService"; // Removed
import { LmdbCache } from "../caching/LmdbCache"; // Added LmdbCache import
import { SharpService } from "./SharpService";
// import { FFmpegService } from "./FFmpegService"; // Removed
import workerpool from "workerpool";
import type { CustomWorker } from "../worker/worker";
import { Types, WorkerPool } from "./types";
import { DebugReporter } from "../reporting/DebugReporter"; // Import DebugReporter
import { FileTransferService } from "../services/FileTransferService"; // Import FileTransferService

export class Context {
  private static _container: Container | null;
  private static _isInitialized = false;

  static get injector() {
    if (!Context._container) {
      throw new Error("Context not initialized");
    }
    return Context._container;
  }

  static async ensureInitialized(options?: ProgramOptions) {
    if (Context._isInitialized) {
      return;
    }
    Context._isInitialized = true;
    this._container = this.createContainer(options);
    // await this._container.loadAsync();
  }

  static createContainer(options?: ProgramOptions) {
    const container = new Container();

    // services
    container.bind(SharpService).toSelf().inSingletonScope();
    container.bind(MediaComparator).toSelf().inSingletonScope();
    // container.bind(MediaOrganizer).toSelf().inSingletonScope(); // Removed binding for old class
    // container.bind(MediaProcessor).toSelf().inSingletonScope(); // Removed binding for old class
    // container.bind(DatabaseContext).toSelf().inSingletonScope(); // Removed DatabaseContext binding
    container.bind(LmdbCache).toSelf().inSingletonScope(); // Added LmdbCache binding
    // container.bind(FFmpegService).toSelf().inSingletonScope(); // Removed FFmpegService binding

    container.bind(FileTransferService).toSelf().inSingletonScope(); // Bind FileTransferService
    container.bind(DebugReporter).toSelf().inSingletonScope(); // Bind DebugReporter
    // jobs
    // container.bind(AdaptiveExtractionJob).toSelf().inSingletonScope(); // Removed binding for old class
    // container.bind(MetadataExtractionJob).toSelf().inSingletonScope(); // Removed binding for old class
    // container.bind(FileStatsJob).toSelf().inSingletonScope(); // Removed binding for old class

    container.bind(ProgramOptions).toConstantValue(options);
    container.bind(FileStatsConfig).toConstantValue({
      maxChunkSize: options?.maxChunkSize || 2 * 1024 * 1024,
    });
    container.bind(AdaptiveExtractionConfig).toConstantValue({
      resolution: options?.resolution || 64,
      sceneChangeThreshold: options?.sceneChangeThreshold || 0.01,
      minFrames: options?.minFrames || 15,
      maxSceneFrames: options?.maxSceneFrames || 200,
      targetFps: options?.targetFps || 0.5,
    });
    container.bind(FeatureExtractionConfig).toConstantValue({
      colorHistogramBins: 16,
      edgeDetectionThreshold: 50,
    });
    container.bind(SimilarityConfig).toConstantValue({
      windowSize: options?.windowSize || 5,
      stepSize: options?.stepSize || 1,
      imageSimilarityThreshold: options?.imageSimilarityThreshold || 0.98,
      imageVideoSimilarityThreshold:
        options?.imageVideoSimilarityThreshold || 0.93,
      videoSimilarityThreshold: options?.videoSimilarityThreshold || 0.93,
    });
    container
      .bind(ExifTool)
      .toDynamicValue(
        () =>
          // Use the factory function from the service
          createExifTool(options?.concurrency || 1),
      )
      .inSingletonScope();

    // Assemble and bind the combined FileProcessorConfig
    container
      .bind<FileProcessorConfig>(Types.FileProcessorConfig)
      .toDynamicValue((context) => {
        return {
          fileStats: context.container.get(FileStatsConfig),
          adaptiveExtraction: context.container.get(AdaptiveExtractionConfig),
        };
      })
      .inSingletonScope();

    container
      .bind<WorkerPool>(Types.WorkerPool)
      .toDynamicValue(async () => {
        const pool = workerpool.pool("src/worker/worker.ts", {
          workerType: "web",
          maxWorkers: options.concurrency,
        });

        const worker = await pool.proxy<CustomWorker>();
        return worker;
      })
      .inSingletonScope();

    return container;
  }
}
