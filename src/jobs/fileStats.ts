import { FileStats, FileStatsConfig } from "../types";
import { LmdbCache } from "../caching/LmdbCache";
import { getFileStats, calculateFileHash, sharedArrayBufferToHex } from "../utils";
import { AppResult, ok, err, DatabaseError, AnyAppError } from "../errors"; // Added AppResult imports

const JOB_NAME = "fileStats"; // Define job name constant

/**
 * Processes a file to get its stats (size, dates, hash).
 * Uses LMDB cache to avoid redundant processing.
 * @param filePath Path to the file.
 * @param config Configuration for file stats job.
 * @param cache LmdbCache instance.
 * @returns Promise resolving to FileStats.
 */
export async function processFileStats(
    filePath: string,
    config: FileStatsConfig,
    cache: LmdbCache
): Promise<AppResult<FileStats>> { // Update return type
    // Use filePath as cache key for stats (as in original BaseFileInfoJob)
    const cacheKey = filePath;

    // Check cache
    // Wrap cache operations in try/catch until LmdbCache is refactored
    try {
        const configCheck = await cache.checkConfig(JOB_NAME, cacheKey, config);
        if (configCheck.isValid) {
            const cacheResult = await cache.getCache<FileStats>(JOB_NAME, cacheKey);
            if (cacheResult.hit && cacheResult.data) { // Ensure data exists
                return ok(cacheResult.data); // Return cached data wrapped in ok
            }
        }
    } catch (cacheError) {
        return err(new DatabaseError(`Cache check/get failed for ${filePath}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`, { operation: 'check/get', key: cacheKey, originalError: cacheError instanceof Error ? cacheError : undefined }));
    }

    // Cache miss or invalid config: calculate stats
    // Handle AppResult from getFileStats
    const statsResult = await getFileStats(filePath);
    if (statsResult.isErr()) {
        return err(statsResult.error); // Propagate error
    }
    const stats = statsResult.value; // Unwrap

    // Handle AppResult from calculateFileHash
    const hashResult = await calculateFileHash(filePath, stats.size, config.maxChunkSize);
    if (hashResult.isErr()) {
        return err(hashResult.error); // Propagate error
    }
    const hash = hashResult.value; // Unwrap

    const result: FileStats = {
        hash,
        size: stats.size,
        createdAt: stats.birthtime,
        modifiedAt: stats.mtime,
    };

    // Store in cache
    // Wrap cache set operation
    try {
        await cache.setCache(JOB_NAME, cacheKey, result, config);
    } catch (cacheError) {
         // Log error but potentially still return the calculated result? Or return error?
         // For now, let's return an error if caching fails, as it might indicate a persistent issue.
         console.error(`Cache set failed for ${filePath}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`);
         return err(new DatabaseError(`Cache set failed for ${filePath}: ${cacheError instanceof Error ? cacheError.message : String(cacheError)}`, { operation: 'set', key: cacheKey, originalError: cacheError instanceof Error ? cacheError : undefined }));
    }

    return ok(result); // Return calculated result wrapped in ok
}

/**
 * Gets the cache key (content hash) for jobs that depend on FileStats.
 * @param filePath Path to the file.
 * @param config Configuration for file stats job.
 * @param cache LmdbCache instance.
 * @returns Promise resolving to the hex representation of the content hash.
 */
export async function getFileStatsHashKey(
    filePath: string,
    config: FileStatsConfig,
    cache: LmdbCache
): Promise<AppResult<string>> { // Update return type
    // This function essentially runs processFileStats but only returns the hash key
    // It leverages the caching within processFileStats
    const statsResult = await processFileStats(filePath, config, cache);
    if (statsResult.isErr()) {
        return err(statsResult.error); // Propagate error
    }
    const stats = statsResult.value; // Unwrap

    // Assuming sharedArrayBufferToHex is safe or will be refactored later
    try {
        const hexKey = sharedArrayBufferToHex(stats.hash);
        return ok(hexKey); // Wrap result in ok
    } catch (error) {
         // Handle potential errors from hex conversion if any
         return err(new DatabaseError(`Failed to convert hash to hex key for ${filePath}: ${error instanceof Error ? error.message : String(error)}`, { operation: 'hexConvert', originalError: error instanceof Error ? error : undefined }));
    }
}