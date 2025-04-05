import * as lmdb from 'lmdb';
import { RootDatabase, Database } from 'lmdb';
import { Mutex } from 'async-mutex';
import * as msgpack from '@msgpack/msgpack';
import { deepEqual } from 'fast-equals'; // Using fast-equals for deep comparison
import { bufferToSharedArrayBuffer, sharedArrayBufferToBuffer } from '../utils'; // Assuming these exist in utils

// Define interfaces for cache results
export interface CacheResult<T> {
    hit: boolean;
    data?: T;
}

export interface ConfigCheckResult {
    isValid: boolean;
    cachedConfig?: any; // Consider a more specific type if possible
}

// TODO: Make injectable or provide singleton instance via Context
export class LmdbCache {
    private rootDb: RootDatabase;
    private jobDbs: Map<string, { resultsDb: Database<any, string>, configDb: Database<any, string> }> = new Map();
    private mutexes: Map<string, Mutex> = new Map(); // Mutex per cache key (jobName + hashKey)

    constructor(dbPath: string = '.mediadb') {
        // Initialize root DB - Consider making async or adding robust error handling
        try {
            this.rootDb = lmdb.open({ path: dbPath, compression: true });
            console.log(`LMDB root database opened at: ${dbPath}`);
        } catch (error) {
            console.error(`Failed to open LMDB database at ${dbPath}:`, error);
            throw new Error(`Failed to initialize LMDB cache: ${error.message}`);
        }
    }

    private getJobDbs(jobName: string): { resultsDb: Database<any, string>, configDb: Database<any, string> } {
        if (!this.rootDb) { // Removed status check
            throw new Error("LMDB root database is not open or has been closed.");
        }
        if (!this.jobDbs.has(jobName)) {
            try {
                // Ensure keys are strings for LMDB
                const resultsDb = this.rootDb.openDB<any, string>(`${jobName}_results`, { keyEncoding: 'binary' }); // Changed encoding
                const configDb = this.rootDb.openDB<any, string>(`${jobName}_config`, { keyEncoding: 'binary' }); // Changed encoding
                this.jobDbs.set(jobName, { resultsDb, configDb });
            } catch (error) {
                console.error(`Failed to open sub-databases for job ${jobName}:`, error);
                throw error; // Rethrow after logging
            }
        }
        return this.jobDbs.get(jobName)!;
    }

    private getMutex(jobName: string, hashKey: string): Mutex {
        const mutexKey = `${jobName}:${hashKey}`;
        if (!this.mutexes.has(mutexKey)) {
            this.mutexes.set(mutexKey, new Mutex());
        }
        return this.mutexes.get(mutexKey)!;
    }

    // --- Serialization Helpers (Adapted from BaseFileInfoJob) ---
    // Using Buffer directly as LMDB Node supports it well.
    private serialize(data: any): Buffer {
        // Handle SharedArrayBuffer specifically
        if (data instanceof SharedArrayBuffer) {
            // Marker: 1 for SharedArrayBuffer
            return Buffer.concat([Buffer.from([1]), sharedArrayBufferToBuffer(data)]);
        }
        // Add handling for Date
        if (data instanceof Date) {
             // Marker: 2 for Date (store as ISO string)
            return Buffer.concat([Buffer.from([2]), Buffer.from(data.toISOString(), 'utf8')]);
        }
        // Add handling for other complex types if necessary (e.g., Map, Set)

        // Default: Use MessagePack (Marker: 0)
        try {
             return Buffer.concat([Buffer.from([0]), msgpack.encode(data)]);
        } catch (error) {
            console.error("Serialization error (msgpack fallback):", error, "Data:", data);
            throw new Error(`Failed to serialize data: ${error.message}`);
        }
    }

    private deserialize(buffer: Buffer): any {
        if (!buffer || buffer.length === 0) return undefined;

        try {
            const typeMarker = buffer[0];
            const dataBuffer = buffer.slice(1);

            if (typeMarker === 1) { // SharedArrayBuffer
                return bufferToSharedArrayBuffer(dataBuffer);
            }
            if (typeMarker === 2) { // Date
                const date = new Date(dataBuffer.toString('utf8'));
                return isNaN(date.getTime()) ? undefined : date; // Validate date parsing
            }
            // Add handling for other types based on markers if needed

            // Default: MessagePack (Marker: 0)
            if (typeMarker === 0) {
                return msgpack.decode(dataBuffer);
            }

            // Fallback for potentially old data without markers (treat as msgpack)
            console.warn("Cache data missing type marker, attempting msgpack decode.");
            return msgpack.decode(buffer);

        } catch (error) {
            console.error("Deserialization error:", error, "Buffer:", buffer.toString('hex'));
            throw new Error(`Failed to deserialize data: ${error.message}`);
        }
    }
    // --- End Serialization Helpers ---


    /**
     * Checks if the cached configuration for a given job and key matches the current configuration.
     * @param jobName The name of the job (used for DB namespacing).
     * @param hashKey The unique key for the cached item (e.g., file path or content hash).
     * @param currentConfig The current configuration object to compare against.
     * @returns Promise resolving to a ConfigCheckResult.
     */
    async checkConfig<C>(jobName: string, hashKey: string, currentConfig: C): Promise<ConfigCheckResult> {
        const { configDb } = this.getJobDbs(jobName);
        const mutex = this.getMutex(jobName, hashKey); // Use mutex for config check too

        return mutex.runExclusive(async () => {
            const cachedConfigBuffer = await configDb.get(hashKey);

            if (!cachedConfigBuffer) {
                return { isValid: false };
            }

            try {
                const cachedConfig = this.deserialize(cachedConfigBuffer);
                const isValid = deepEqual(currentConfig, cachedConfig);
                // console.log(`Config check for ${jobName}:${hashKey} - Valid: ${isValid}`); // Debug log
                return { isValid, cachedConfig: isValid ? cachedConfig : undefined };
            } catch (error) {
                console.error(`Error deserializing/comparing config for ${jobName}:${hashKey}`, error);
                return { isValid: false }; // Treat errors as cache invalidation
            }
        });
    }

    /**
     * Retrieves cached data for a given job and key.
     * @param jobName The name of the job (used for DB namespacing).
     * @param hashKey The unique key for the cached item (e.g., file path or content hash).
     * @returns Promise resolving to a CacheResult containing the data if found and valid.
     */
    async getCache<T>(jobName: string, hashKey: string): Promise<CacheResult<T>> {
        const { resultsDb } = this.getJobDbs(jobName);
        const mutex = this.getMutex(jobName, hashKey);

        return mutex.runExclusive(async () => {
            const dataBuffer = await resultsDb.get(hashKey);
            if (dataBuffer) {
                try {
                    const data = this.deserialize(dataBuffer);
                    // console.log(`Cache hit for ${jobName}:${hashKey}`); // Debug log
                    return { hit: true, data: data as T };
                } catch (error) {
                    console.error(`Error deserializing cache for ${jobName}:${hashKey}`, error);
                    // Optionally remove corrupted cache entry here
                    // await resultsDb.remove(hashKey);
                    return { hit: false };
                }
            }
            // console.log(`Cache miss for ${jobName}:${hashKey}`); // Debug log
            return { hit: false };
        });
    }

    /**
     * Stores data and its corresponding configuration in the cache.
     * @param jobName The name of the job (used for DB namespacing).
     * @param hashKey The unique key for the cached item (e.g., file path or content hash).
     * @param data The data to cache.
     * @param config The configuration used to generate the data.
     */
    async setCache<T, C>(jobName: string, hashKey: string, data: T, config: C): Promise<void> {
        const { resultsDb, configDb } = this.getJobDbs(jobName);
        const mutex = this.getMutex(jobName, hashKey);

        return mutex.runExclusive(async () => {
            try {
                const dataBuffer = this.serialize(data);
                const configBuffer = this.serialize(config);
                // Use transaction for atomicity
                await this.rootDb.transaction(async () => {
                    await resultsDb.put(hashKey, dataBuffer);
                    await configDb.put(hashKey, configBuffer);
                });
                // console.log(`Cache set for ${jobName}:${hashKey}`); // Debug log
            } catch (error) {
                console.error(`Error setting cache for ${jobName}:${hashKey}`, error);
                // Decide how to handle write errors - potentially rethrow?
                throw error; // Rethrow for now
            }
        });
    }

    /**
     * Closes the LMDB database connection gracefully.
     */
    async close(): Promise<void> {
       if (this.rootDb) { // Removed status check
           await this.rootDb.close();
           console.log("LMDB cache database closed.");
       }
       // Clear maps
       this.jobDbs.clear();
       this.mutexes.clear();
    }
}