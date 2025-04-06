import * as lmdb from 'lmdb';
import { RootDatabase, Database } from 'lmdb';
import { Mutex } from 'async-mutex';
import * as msgpack from '@msgpack/msgpack';
import { deepEqual } from 'fast-equals'; // Using fast-equals for deep comparison
import { bufferToSharedArrayBuffer, sharedArrayBufferToBuffer } from '../utils'; // Assuming these exist in utils
import {
  AppResult,
  ok,
  err,
  DatabaseError,
  safeTry,
  safeTryAsync,
} from '../errors'; // Removed unused UnknownError

// Define interfaces for cache results
export interface CacheResult<T> {
  hit: boolean;
  data?: T;
}

export interface ConfigCheckResult {
  isValid: boolean;
  cachedConfig?: unknown; // Use unknown instead of any
}

// TODO: Make injectable or provide singleton instance via Context
export class LmdbCache {
  private rootDb: RootDatabase;
  // Store databases with specific types using generics later in getJobDbs
  private jobDbs: Map<
    string,
    { resultsDb: Database<Buffer, string>; configDb: Database<Buffer, string> }
  > = new Map(); // Store raw Buffers
  private mutexes: Map<string, Mutex> = new Map(); // Mutex per cache key (jobName + hashKey)

  // Private constructor to enforce singleton or controlled instantiation if needed later
  private constructor(rootDb: RootDatabase) {
    this.rootDb = rootDb;
  }

  // Static factory method for asynchronous initialization
  static async create(
    dbPath: string = '.mediadb',
  ): Promise<AppResult<LmdbCache>> {
    try {
      const rootDb = lmdb.open({ path: dbPath, compression: true });
      console.log(`LMDB root database opened at: ${dbPath}`);
      return ok(new LmdbCache(rootDb));
    } catch (error) {
      const message = `Failed to open LMDB database at ${dbPath}: ${error instanceof Error ? error.message : String(error)}`;
      console.error(message);
      return err(
        new DatabaseError(message, {
          cause: error instanceof Error ? error : undefined,
          context: { operation: 'open' },
        }),
      );
    }
  }

  // Make generic to handle specific value types, though DBs store Buffers
  // Return AppResult to handle potential errors during DB opening
  private getJobDbs(jobName: string): AppResult<{
    resultsDb: Database<Buffer, string>;
    configDb: Database<Buffer, string>;
  }> {
    if (!this.rootDb) {
      return err(
        new DatabaseError(
          'LMDB root database is not open or has been closed.',
          { context: { operation: 'getJobDbs' } },
        ),
      );
    }
    if (!this.jobDbs.has(jobName)) {
      try {
        const resultsDb = this.rootDb.openDB<Buffer, string>(
          `${jobName}_results`,
          { keyEncoding: 'binary' },
        );
        const configDb = this.rootDb.openDB<Buffer, string>(
          `${jobName}_config`,
          { keyEncoding: 'binary' },
        );
        this.jobDbs.set(jobName, { resultsDb, configDb });
      } catch (error) {
        const message = `Failed to open sub-databases for job ${jobName}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        return err(
          new DatabaseError(message, {
            cause: error instanceof Error ? error : undefined,
            context: { operation: 'openSubDb' },
          }),
        );
      }
    }
    // Use ok() to wrap the successful result
    return ok(this.jobDbs.get(jobName)!);
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
  private serialize(data: unknown): Buffer {
    // Use unknown instead of any
    // Handle SharedArrayBuffer specifically
    if (data instanceof SharedArrayBuffer) {
      // Marker: 1 for SharedArrayBuffer
      return Buffer.concat([Buffer.from([1]), sharedArrayBufferToBuffer(data)]);
    }
    // Add handling for Date
    if (data instanceof Date) {
      // Marker: 2 for Date (store as ISO string)
      return Buffer.concat([
        Buffer.from([2]),
        Buffer.from(data.toISOString(), 'utf8'),
      ]);
    }
    // Add handling for other complex types if necessary (e.g., Map, Set)

    // Default: Use MessagePack (Marker: 0)
    // Default: Use MessagePack (Marker: 0)
    // Wrap msgpack.encode in safeTry
    const encodeResult = safeTry(
      () => msgpack.encode(data),
      (error) =>
        new DatabaseError(
          `Failed to serialize data with msgpack: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error instanceof Error ? error : undefined,
            context: { operation: 'serialize' },
          },
        ),
    );
    if (encodeResult.isErr()) {
      console.error(
        'Serialization error (msgpack fallback):',
        encodeResult.error,
        'Data:',
        data,
      );
      throw encodeResult.error; // Rethrow the specific CacheError
    }
    return Buffer.concat([Buffer.from([0]), encodeResult.value]);
  }

  private deserialize(buffer: Buffer): unknown {
    // Use unknown instead of any
    if (!buffer || buffer.length === 0) return undefined;

    // Wrap deserialization logic in safeTry
    return safeTry(
      () => {
        const typeMarker = buffer[0];
        const dataBuffer = buffer.slice(1);

        if (typeMarker === 1) {
          // SharedArrayBuffer
          return bufferToSharedArrayBuffer(dataBuffer);
        }
        if (typeMarker === 2) {
          // Date
          const date = new Date(dataBuffer.toString('utf8'));
          return isNaN(date.getTime()) ? undefined : date; // Validate date parsing
        }
        // Add handling for other types based on markers if needed

        // Default: MessagePack (Marker: 0)
        if (typeMarker === 0) {
          return msgpack.decode(dataBuffer);
        }

        // Fallback for potentially old data without markers (treat as msgpack)
        console.warn(
          'Cache data missing type marker, attempting msgpack decode.',
        );
        return msgpack.decode(buffer); // This might still throw if buffer is not valid msgpack
      },
      (error) => {
        console.error(
          'Deserialization error:',
          error,
          'Buffer:',
          buffer.toString('hex'),
        );
        return new DatabaseError(
          `Failed to deserialize data: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error instanceof Error ? error : undefined,
            context: { operation: 'deserialize' },
          },
        );
      },
    )._unsafeUnwrap(); // Unwrap here, errors during get/check will handle AppResult propagation
    // Note: Rethinking this - throwing here might be okay if get/check handle it. Let's keep throwing for now.
    // Let's revert the unwrap and throw the CacheError directly if safeTry fails.
    // Reverting the unwrap:
    // }, (error) => new CacheError(`Failed to deserialize data: ${error instanceof Error ? error.message : String(error)}`, { operation: 'deserialize', originalError: error instanceof Error ? error : undefined })).match(
    //     (value) => value, // Return the value if ok
    //     (cacheError) => { throw cacheError; } // Throw the CacheError if err
    // );
    // Simpler: just let safeTry throw the error if it occurs.
    // Reverting safeTry usage here, keep original try/catch but throw CacheError
    // --- Reverting to original try/catch with CacheError ---
    try {
      const typeMarker = buffer[0];
      const dataBuffer = buffer.slice(1);

      if (typeMarker === 1) {
        // SharedArrayBuffer
        return bufferToSharedArrayBuffer(dataBuffer);
      }
      if (typeMarker === 2) {
        // Date
        const date = new Date(dataBuffer.toString('utf8'));
        return isNaN(date.getTime()) ? undefined : date; // Validate date parsing
      }
      // Add handling for other types based on markers if needed

      // Default: MessagePack (Marker: 0)
      if (typeMarker === 0) {
        return msgpack.decode(dataBuffer);
      }

      // Fallback for potentially old data without markers (treat as msgpack)
      console.warn(
        'Cache data missing type marker, attempting msgpack decode.',
      );
      return msgpack.decode(buffer);
    } catch (error) {
      console.error(
        'Deserialization error:',
        error,
        'Buffer:',
        buffer.toString('hex'),
      );
      // Throw specific CacheError
      throw new DatabaseError(
        `Failed to deserialize data: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { operation: 'deserialize' },
        },
      );
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
  async checkConfig<C>(
    jobName: string,
    hashKey: string,
    currentConfig: C,
  ): Promise<AppResult<ConfigCheckResult>> {
    const dbsResult = this.getJobDbs(jobName);
    if (dbsResult.isErr()) {
      return err(dbsResult.error);
    }
    const { configDb } = dbsResult.value;
    const mutex = this.getMutex(jobName, hashKey);

    // Wrap mutex execution in safeTryAsync
    return safeTryAsync(
      mutex.runExclusive(async () => {
        const cachedConfigBuffer = await configDb.get(hashKey);

        if (!cachedConfigBuffer) {
          return { isValid: false }; // Not an error, just invalid config
        }

        // Deserialization can throw CacheError, which will be caught by safeTryAsync
        const cachedConfig = this.deserialize(cachedConfigBuffer);
        const isValid = deepEqual(currentConfig, cachedConfig);
        return { isValid, cachedConfig: isValid ? cachedConfig : undefined };
      }),
      (error) => {
        // Handle errors from DB get or deserialization/comparison
        const message = `Error during config check for ${jobName}:${hashKey}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        // If it's already a CacheError from deserialize, re-use it, otherwise create new
        return error instanceof DatabaseError
          ? error
          : new DatabaseError(message, {
              cause: error instanceof Error ? error : undefined,
              context: { operation: 'config_check', key: hashKey },
            });
      },
    );
  }

  /**
   * Retrieves cached data for a given job and key.
   * @param jobName The name of the job (used for DB namespacing).
   * @param hashKey The unique key for the cached item (e.g., file path or content hash).
   * @returns Promise resolving to a CacheResult containing the data if found and valid.
   */
  async getCache<T>(
    jobName: string,
    hashKey: string,
  ): Promise<AppResult<CacheResult<T>>> {
    const dbsResult = this.getJobDbs(jobName);
    if (dbsResult.isErr()) {
      return err(dbsResult.error);
    }
    const { resultsDb } = dbsResult.value;
    const mutex = this.getMutex(jobName, hashKey);

    // Wrap mutex execution in safeTryAsync
    return safeTryAsync(
      mutex.runExclusive(async () => {
        const dataBuffer = await resultsDb.get(hashKey);
        if (dataBuffer) {
          // Deserialization can throw CacheError, caught by safeTryAsync
          const data = this.deserialize(dataBuffer);
          return { hit: true, data: data as T };
        }
        return { hit: false }; // Cache miss
      }),
      (error) => {
        // Handle errors from DB get or deserialization
        const message = `Error getting cache for ${jobName}:${hashKey}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        // If it's already a CacheError from deserialize, re-use it, otherwise create new
        return error instanceof DatabaseError
          ? error
          : new DatabaseError(message, {
              cause: error instanceof Error ? error : undefined,
              context: { operation: 'read', key: hashKey },
            });
      },
    );
  }

  /**
   * Stores data and its corresponding configuration in the cache.
   * @param jobName The name of the job (used for DB namespacing).
   * @param hashKey The unique key for the cached item (e.g., file path or content hash).
   * @param data The data to cache.
   * @param config The configuration used to generate the data.
   */
  async setCache<T, C>(
    jobName: string,
    hashKey: string,
    data: T,
    config: C,
  ): Promise<AppResult<void>> {
    const dbsResult = this.getJobDbs(jobName);
    if (dbsResult.isErr()) {
      return err(dbsResult.error);
    }
    const { resultsDb, configDb } = dbsResult.value;
    const mutex = this.getMutex(jobName, hashKey);

    // Wrap mutex execution in safeTryAsync
    return safeTryAsync(
      mutex.runExclusive(async () => {
        // Serialization can throw CacheError, caught by safeTryAsync
        const dataBuffer = this.serialize(data);
        const configBuffer = this.serialize(config);

        // Use transaction for atomicity
        await this.rootDb.transaction(async () => {
          await resultsDb.put(hashKey, dataBuffer);
          await configDb.put(hashKey, configBuffer);
        });
      }),
      (error) => {
        // Handle errors from serialization or DB put/transaction
        const message = `Error setting cache for ${jobName}:${hashKey}: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        // If it's already a CacheError from serialize, re-use it, otherwise create new
        return error instanceof DatabaseError
          ? error
          : new DatabaseError(message, {
              cause: error instanceof Error ? error : undefined,
              context: { operation: 'write', key: hashKey },
            });
      },
    );
  }

  /**
   * Closes the LMDB database connection gracefully.
   */
  async close(): Promise<AppResult<void>> {
    if (this.rootDb) {
      try {
        await this.rootDb.close();
        console.log('LMDB cache database closed.');
      } catch (error) {
        const message = `Error closing LMDB database: ${error instanceof Error ? error.message : String(error)}`;
        console.error(message);
        return err(
          new DatabaseError(message, {
            cause: error instanceof Error ? error : undefined,
            context: { operation: 'close' },
          }),
        );
      }
    }
    // Clear maps
    this.jobDbs.clear();
    this.mutexes.clear();
    return ok(undefined); // Return ok on success
  }
}
