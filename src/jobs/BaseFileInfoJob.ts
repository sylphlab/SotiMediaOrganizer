// Removed Mutex, DatabaseContext, Database, eql, buffer/sharedBuffer utils, MemoryCache, postConstruct
import { LmdbCache, CacheResult, ConfigCheckResult } from "../caching/LmdbCache"; // Import LmdbCache
import { inject, injectable } from "inversify";

@injectable()
export abstract class BaseFileInfoJob<TResult, TConfig = void> {
  // Removed locks, db, configDb, dbContext properties

  @inject(LmdbCache) // Inject LmdbCache instead
  protected readonly cache: LmdbCache; // Changed from private to protected

  protected abstract readonly jobName: string;

  protected readonly config: TConfig = null;

  // Removed @postConstruct init method

  async process(filePath: string): Promise<TResult> {
    const cacheKey = await this.getHashKey(filePath);

    // Use LmdbCache for checking config and getting/setting data
    const configCheck: ConfigCheckResult = await this.cache.checkConfig(this.jobName, cacheKey, this.config);

    if (configCheck.isValid) {
        const cacheResult: CacheResult<TResult> = await this.cache.getCache(this.jobName, cacheKey);
        if (cacheResult.hit) {
            // console.log(`Cache HIT for ${this.jobName}:${cacheKey}`); // Optional debug log
            return cacheResult.data!;
        }
        // console.log(`Cache config valid but data MISS for ${this.jobName}:${cacheKey}`); // Optional debug log
    } else {
        // console.log(`Cache config INVALID for ${this.jobName}:${cacheKey}`); // Optional debug log
    }

    // Cache miss or invalid config, process the file
    const result = await this.processFile(filePath);

    // Store the new result and config in the cache
    await this.cache.setCache(this.jobName, cacheKey, result, this.config);

    return result;
  }

  protected abstract processFile(filePath: string): Promise<TResult>;

  // Removed isConfigValid and isEquivalentConfig methods (using LmdbCache's deepEqual)

  protected async getHashKey(filePath: string): Promise<string> {
    return filePath;
  }

  // Removed convertToStorageFormat, convertFromStorageFormat, isPlainObject methods (handled by LmdbCache)
}
