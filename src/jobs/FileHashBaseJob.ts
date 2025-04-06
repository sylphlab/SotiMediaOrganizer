// import { injectable, inject } from "inversify"; // REMOVED INVERSIFY
import { LmdbCache } from "../caching/LmdbCache"; // Import LmdbCache for constructor
// Removed unused import: sharedArrayBufferToHex
import { BaseFileInfoJob } from "./BaseFileInfoJob";
// import { FileStatsJob } from "./FileStatsJob"; // Removed old class import
import { getFileStatsHashKey } from "./fileStats"; // Import new function (returns AppResult)
// Removed unused import: AppResult
import { FileStatsConfig } from "../types"; // Need config type
// Removed unused import: LmdbCache

// @injectable() // REMOVED INVERSIFY
export abstract class FileHashBaseJob<
  TResult,
  TConfig = void,
> extends BaseFileInfoJob<TResult, TConfig> {
  // @inject(FileStatsConfig) // REMOVED INVERSIFY
  private readonly fileStatsConfig: FileStatsConfig;
  // Removed LmdbCache injection (use protected 'this.cache' from BaseFileInfoJob)

  constructor(cache: LmdbCache, fileStatsConfig: FileStatsConfig) {
    super(cache); // Pass cache to parent constructor
    this.fileStatsConfig = fileStatsConfig;
  }

  protected async getHashKey(filePath: string): Promise<string> {
    // Keep return type as string for now
    // Call the imported function, passing required dependencies
    const hashKeyResult = await getFileStatsHashKey(
      filePath,
      this.fileStatsConfig,
      this.cache
    );
    if (hashKeyResult.isErr()) {
      // Throw an error to maintain previous behavior if hash key fails
      throw new Error(
        `Failed to get hash key for ${filePath}: ${hashKeyResult.error.message}`
      );
    }
    return hashKeyResult.value; // Return unwrapped value
  }
}
