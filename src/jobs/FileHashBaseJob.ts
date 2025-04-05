import { injectable, inject } from "inversify";
import { sharedArrayBufferToHex } from "../utils";
import { BaseFileInfoJob } from "./BaseFileInfoJob";
// import { FileStatsJob } from "./FileStatsJob"; // Removed old class import
import { getFileStatsHashKey } from "./fileStats"; // Import new function
import { FileStatsConfig } from "../types"; // Need config type
import { LmdbCache } from "../caching/LmdbCache"; // Need cache service

@injectable()
export abstract class FileHashBaseJob<
  TResult,
  TConfig = void,
> extends BaseFileInfoJob<TResult, TConfig> {
  // Inject dependencies needed by getFileStatsHashKey
  @inject(FileStatsConfig) private readonly fileStatsConfig: FileStatsConfig;
  // Removed LmdbCache injection (use protected 'this.cache' from BaseFileInfoJob)

  protected async getHashKey(filePath: string): Promise<string> {
    // Call the imported function, passing required dependencies
    return await getFileStatsHashKey(filePath, this.fileStatsConfig, this.cache);
  }
}
