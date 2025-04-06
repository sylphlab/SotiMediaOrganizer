import { Metadata, FileStatsConfig } from "../types"; // Combined imports
import { LmdbCache } from "../caching/LmdbCache";
import { ExifTool } from "exiftool-vendored"; // Removed unused Tags
import { readExifTags } from "../external/ExifToolService"; // TODO: Refactor this to return AppResult
import { parseExifTagsToMetadata } from "../utils"; // TODO: Refactor this to return AppResult
import { getFileStatsHashKey } from "./fileStats";
import { AppResult, ok, err } from "../errors"; // Removed unused DatabaseError, ExternalToolError, AnyAppError

const JOB_NAME = "metadataExtraction"; // Define job name constant

/**
 * Processes a file to extract key metadata (date, dimensions, GPS, camera).
 * Uses LMDB cache keyed by content hash to avoid redundant processing.
 * @param filePath Path to the file.
 * @param exifTool An instance of the ExifTool class.
 * @param fileStatsConfig Config needed for hash key generation.
 * @param cache LmdbCache instance.
 * @returns Promise resolving to Metadata.
 */
export async function processMetadata(
  filePath: string,
  exifTool: ExifTool,
  fileStatsConfig: FileStatsConfig, // Pass FileStatsConfig
  cache: LmdbCache
): Promise<AppResult<Metadata>> {
  // Update return type
  // Use content hash as cache key (requires FileStatsJob logic/config)
  // Get cache key, handling potential errors
  const cacheKeyResult = await getFileStatsHashKey(
    filePath,
    fileStatsConfig,
    cache
  );
  if (cacheKeyResult.isErr()) {
    return err(cacheKeyResult.error); // Propagate error
  }
  const cacheKey = cacheKeyResult.value; // Unwrap

  // Check cache - Note: MetadataExtractionJob didn't have its own config,
  // so we check against a null config or an empty object marker.
  // Using null for simplicity here.
  // Check cache, handling potential errors
  const configCheckResult = await cache.checkConfig(JOB_NAME, cacheKey, null); // Using null as config marker
  if (configCheckResult.isErr()) {
    // Log or handle config check error, but proceed to calculate
    console.warn(
      `Cache config check failed for metadata ${filePath} (key: ${cacheKey}), proceeding with calculation:`,
      configCheckResult.error
    );
  } else if (configCheckResult.value.isValid) {
    // Config is valid, try getting data
    const cacheGetResult = await cache.getCache<Metadata>(JOB_NAME, cacheKey);
    if (cacheGetResult.isErr()) {
      // Log or handle cache get error, but proceed to calculate
      console.warn(
        `Cache get failed for metadata ${filePath} (key: ${cacheKey}), proceeding with calculation:`,
        cacheGetResult.error
      );
    } else if (cacheGetResult.value.hit) {
      // Cache hit and data is valid
      return ok(cacheGetResult.value.data!); // Return cached data wrapped in ok
    }
  }

  // Cache miss or invalid config: read tags and parse
  // Read tags, handling the AppResult
  const tagsResult = await readExifTags(filePath, exifTool);
  if (tagsResult.isErr()) {
    // Propagate the error from readExifTags
    return err(tagsResult.error);
  }
  const tags = tagsResult.value; // Unwrap the Tags object

  // Parse tags, handling the AppResult
  const parseResult = parseExifTagsToMetadata(tags);
  if (parseResult.isErr()) {
    // Propagate the error from parsing
    return err(parseResult.error);
  }
  const result = parseResult.value; // Unwrap the Metadata object

  // Store in cache with null config marker
  // Store in cache, handling potential errors
  const setResult = await cache.setCache(JOB_NAME, cacheKey, result, null); // Using null as config marker
  if (setResult.isErr()) {
    // Log cache set error but return the calculated result anyway
    console.warn(
      `Cache set failed for metadata ${filePath} (key: ${cacheKey}), but returning calculated result:`,
      setResult.error
    );
  }

  return ok(result); // Return calculated result wrapped in ok
}
