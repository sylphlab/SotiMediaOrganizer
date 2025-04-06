// Removed Mutex, DatabaseContext, Database, eql, buffer/sharedBuffer utils, MemoryCache, postConstruct
import { LmdbCache } from '../caching/LmdbCache'; // Removed unused CacheResult, ConfigCheckResult
import { AppResult, ok, err } from '../errors'; // Removed unused AnyAppError
// import { inject, injectable } from "inversify"; // REMOVED INVERSIFY
// import { LmdbCache } from "../caching/LmdbCache"; // Ensure LmdbCache is imported for constructor - REMOVED DUPLICATE

// @injectable() // REMOVED INVERSIFY
export abstract class BaseFileInfoJob<TResult, TConfig = void> {
  // Removed locks, db, configDb, dbContext properties

  // @inject(LmdbCache) // REMOVED INVERSIFY
  protected readonly cache: LmdbCache; // Changed from private to protected

  protected abstract readonly jobName: string;

  protected readonly config: TConfig = null;

  // Removed @postConstruct init method

  constructor(cache: LmdbCache) {
    this.cache = cache;
  }

  async process(filePath: string): Promise<AppResult<TResult>> {
    // Update return type
    // TODO: Refactor getHashKey to return AppResult if it can fail
    const cacheKey = await this.getHashKey(filePath);

    // Use LmdbCache for checking config and getting/setting data
    const configCheckResult = await this.cache.checkConfig(
      this.jobName,
      cacheKey,
      this.config,
    );
    if (configCheckResult.isErr()) {
      // Log or handle config check error, but proceed to calculate
      console.warn(
        `Cache config check failed for ${this.jobName}:${cacheKey}, proceeding with calculation:`,
        configCheckResult.error,
      );
    } else if (configCheckResult.value.isValid) {
      // Config is valid, try getting data
      const cacheGetResult = await this.cache.getCache<TResult>(
        this.jobName,
        cacheKey,
      );
      if (cacheGetResult.isErr()) {
        // Log or handle cache get error, but proceed to calculate
        console.warn(
          `Cache get failed for ${this.jobName}:${cacheKey}, proceeding with calculation:`,
          cacheGetResult.error,
        );
      } else if (cacheGetResult.value.hit) {
        // Cache hit and data is valid
        return ok(cacheGetResult.value.data!); // Return cached data wrapped in ok
      }
      // console.log(`Cache config valid but data MISS for ${this.jobName}:${cacheKey}`);
    }

    // Cache miss or invalid config, process the file
    // Cache miss or invalid config, or error during cache check/get: process the file
    // Assuming processFile will be refactored to return AppResult<TResult>
    const processResult = await this.processFile(filePath);
    // TODO: Remove the 'as any' when processFile is refactored
    // TODO: Remove this cast when all subclasses correctly implement processFile returning AppResult<TResult>
    const resultCheck = processResult;

    if (resultCheck.isErr()) {
      return err(resultCheck.error); // Propagate error from processFile
    }
    const result = resultCheck.value; // Unwrap successful result

    // Store the new result and config in the cache, handle potential error
    const setResult = await this.cache.setCache(
      this.jobName,
      cacheKey,
      result,
      this.config,
    );
    if (setResult.isErr()) {
      // Log cache set error but return the calculated result
      console.warn(
        `Cache set failed for ${this.jobName}:${cacheKey}, but returning calculated result:`,
        setResult.error,
      );
    }

    return ok(result); // Return calculated result wrapped in ok
  }

  // Subclasses should implement this to return Promise<AppResult<TResult>>
  protected abstract processFile(filePath: string): Promise<AppResult<TResult>>;

  // Removed isConfigValid and isEquivalentConfig methods (using LmdbCache's deepEqual)

  protected async getHashKey(filePath: string): Promise<string> {
    return filePath;
  }

  // Removed convertToStorageFormat, convertFromStorageFormat, isPlainObject methods (handled by LmdbCache)
}
