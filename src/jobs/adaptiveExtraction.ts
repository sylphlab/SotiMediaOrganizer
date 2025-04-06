import {
  AdaptiveExtractionConfig,
  MediaInfo,
  FileType,
  FrameInfo,
  FileStatsConfig,
} from '../types';
import { LmdbCache } from '../caching/LmdbCache';
import { getFileType } from '../utils'; // getFileType needs AppResult handling
import { getFileStatsHashKey } from './fileStats';
import {
  createSharpInstance,
  resizeImage,
  grayscaleImage,
  imageToBuffer,
} from '../external/SharpServiceWrapper'; // TODO: Refactor these
import {
  createFFmpegCommand,
  probeFile,
  applyVideoFilters,
  addOutputOptions,
} from '../external/FFmpegServiceWrapper'; // TODO: Refactor these
import { WorkerPool } from '../contexts/types';
import {
  AppResult,
  ok,
  err,
  ExternalToolError,
  DatabaseError,
  FileSystemError,
  UnknownError,
  AppError,
  safeTry,
  safeTryAsync,
} from '../errors'; // Added AppError

const JOB_NAME = 'adaptiveExtraction'; // Define job name constant

// --- Helper: reduceFrames (pure function) ---
function reduceFrames(frames: FrameInfo[], targetCount: number): FrameInfo[] {
  if (frames.length <= targetCount) return frames;
  const step = frames.length / targetCount;
  const reducedFrames: FrameInfo[] = [];
  for (let i = 0; i < frames.length; i += step) {
    reducedFrames.push(frames[Math.floor(i)]);
  }
  return reducedFrames;
}

// --- Helper: computePerceptualHash via Worker (side effect: worker communication) ---
async function computePerceptualHashWorker(
  imageBuffer: Uint8Array,
  resolution: number,
  workerPool: WorkerPool,
): Promise<AppResult<SharedArrayBuffer>> {
  // Update return type
  // Wrap worker pool call - Await the non-standard promise first
  try {
    // Await the potentially non-standard promise from the worker pool
    const buffer = await workerPool.computePerceptualHash(
      imageBuffer,
      resolution,
    );

    // Now perform the conversion within a standard try/catch or safeTry
    return safeTry(
      () => {
        const sharedBuffer = new SharedArrayBuffer(buffer.byteLength);
        new Uint8Array(sharedBuffer).set(new Uint8Array(buffer));
        return sharedBuffer;
      },
      (convError) =>
        new AppError(
          `Failed to convert worker buffer to SharedArrayBuffer: ${convError instanceof Error ? convError.message : String(convError)}`,
          { cause: convError },
        ),
    );
  } catch (error) {
    // Catch errors from awaiting the worker pool promise
    return err(
      new ExternalToolError(
        `Perceptual hash worker execution failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { tool: 'workerpool-pHash' },
        },
      ),
    ); // Added closing parenthesis for err()
  }
}

// --- Helper: extractFramesWithFilter (complex side effects: ffmpeg stream) ---
// This function remains complex due to stream handling. Further refactoring might be needed.
function extractFramesWithFilter(
  videoPath: string,
  selectFilter: string,
  config: AdaptiveExtractionConfig,
  workerPool: WorkerPool, // Pass workerPool for hashing
): Promise<AppResult<FrameInfo[]>> {
  // Update return type
  // Wrap the entire promise logic to handle synchronous errors during setup
  return safeTryAsync<FrameInfo[]>(
    new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const frameSize = config.resolution * config.resolution;
      const pendingTimestamps: number[] = [];
      // Store promises that resolve to AppResult<FrameInfo>
      const frameProcessingPromises: Promise<AppResult<FrameInfo>>[] = [];

      const processFrames = () => {
        while (pendingTimestamps.length > 0 && buffer.length >= frameSize) {
          const timestamp = pendingTimestamps.shift()!;
          const frameBuffer = buffer.subarray(0, frameSize);
          buffer = buffer.subarray(frameSize);

          // Call the refactored worker function
          const framePromise = computePerceptualHashWorker(
            Uint8Array.from(frameBuffer),
            config.resolution,
            workerPool,
          ).then((hashResult): AppResult<FrameInfo> => {
            // Ensure the .then callback returns AppResult
            if (hashResult.isErr()) {
              // If hashing failed, return the error wrapped in AppResult<FrameInfo>
              return err(hashResult.error);
            }
            // If hashing succeeded, return the FrameInfo wrapped in ok()
            return ok({ hash: hashResult.value, timestamp });
          });
          frameProcessingPromises.push(framePromise);
        }
      };

      const command = createFFmpegCommand(videoPath);
      applyVideoFilters(command, [
        selectFilter,
        `showinfo`,
        `scale=${config.resolution}:${config.resolution}:force_original_aspect_ratio=disable:flags=lanczos`,
        'format=gray',
      ]);
      addOutputOptions(command, ['-vsync', 'vfr', '-f', 'rawvideo']);

      command
        .on('error', (error) => {
          // Reject with a specific error type
          reject(
            new ExternalToolError(`FFmpeg error: ${error.message}`, {
              cause: error,
              context: { tool: 'ffmpeg' },
            }),
          );
        })
        .on('end', async () => {
          processFrames(); // Process remaining buffer
          try {
            // Wait for all frame processing promises (which resolve to AppResult<FrameInfo>)
            const frameResults = await Promise.all(frameProcessingPromises);

            // Check if any frame processing resulted in an error
            const firstError = frameResults.find((r) => r.isErr());
            if (firstError && firstError.isErr()) {
              // Check isErr() again for type safety
              // Reject the main promise if any frame failed
              reject(firstError.error);
              return; // Stop further processing
            }

            // If all frames processed successfully, extract the FrameInfo values
            const successfulFrames = frameResults
              .filter((r) => r.isOk()) // Filter out errors (though we already checked)
              .map((r) => (r as AppResult<FrameInfo>)._unsafeUnwrap()); // Unwrap the Ok values

            resolve(successfulFrames);
          } catch (error) {
            // Catch any unexpected errors during Promise.all or processing
            reject(new UnknownError(error));
          }
        })
        .on('stderr', (stderrLine: string) => {
          const timeMatch = stderrLine.match(/pts_time:([0-9.]+)/);
          if (timeMatch) {
            const timestamp = parseFloat(timeMatch[1]);
            pendingTimestamps.push(timestamp);
            processFrames();
          }
        })
        .pipe()
        .on('data', (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          processFrames();
        })
        .on('error', (streamError) => {
          // Add error handling for the stream itself
          // Reject with a specific error type
          reject(
            new ExternalToolError(
              `FFmpeg pipe stream error: ${streamError.message}`,
              { cause: streamError, context: { tool: 'ffmpeg-stream' } },
            ),
          );
        });
    }),
    // Add error handler for safeTryAsync itself
    (error) =>
      new ExternalToolError(
        `Failed to set up frame extraction promise: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { tool: 'ffmpeg-setup' },
        },
      ),
  );
}

// --- Main Processing Function ---
/**
 * Processes a media file to extract adaptive frames and hashes.
 * Uses LMDB cache keyed by content hash.
 * @param filePath Path to the file.
 * @param config Configuration for adaptive extraction.
 * @param fileStatsConfig Config needed for hash key generation.
 * @param cache LmdbCache instance.
 * @param workerPool WorkerPool instance for parallel hashing.
 * @returns Promise resolving to MediaInfo.
 */
export async function processAdaptiveExtraction( // Added export keyword
  filePath: string,
  config: AdaptiveExtractionConfig,
  fileStatsConfig: FileStatsConfig,
  cache: LmdbCache,
  workerPool: WorkerPool,
): Promise<AppResult<MediaInfo>> {
  // Update return type
  // Handle AppResult from getFileType
  const mediaTypeResult = getFileType(filePath);
  if (mediaTypeResult.isErr()) {
    // If we can't determine file type, we can't proceed
    return err(
      new FileSystemError(
        `Could not determine file type for ${filePath}: ${mediaTypeResult.error.message}`,
        { cause: mediaTypeResult.error, context: { path: filePath } },
      ),
    );
  }
  const mediaType = mediaTypeResult.value; // Unwrap

  // Handle AppResult from getFileStatsHashKey
  const cacheKeyResult = await getFileStatsHashKey(
    filePath,
    fileStatsConfig,
    cache,
  );
  if (cacheKeyResult.isErr()) {
    // If we can't get the hash key, we can't use the cache or store results effectively
    return err(
      new DatabaseError(
        `Could not get cache key for ${filePath}: ${cacheKeyResult.error.message}`,
        { cause: cacheKeyResult.error, context: { key: filePath } },
      ),
    );
  }
  const cacheKey = cacheKeyResult.value; // Unwrap

  // Removed duplicate comment
  // --- Cache Check ---
  const configCheckResult = await cache.checkConfig(JOB_NAME, cacheKey, config);
  let cacheIsValid = false;

  if (configCheckResult.isErr()) {
    // Log or handle config check error, but proceed to calculate
    console.warn(
      `Cache config check failed for ${filePath} (key: ${cacheKey}), proceeding with calculation:`,
      configCheckResult.error,
    );
  } else {
    // Config check succeeded, now check the value
    const configCheckValue = configCheckResult.value;
    if (mediaType === FileType.Image) {
      // Image-specific config check (resolution only)
      if (configCheckValue.isValid && configCheckValue.cachedConfig) {
        cacheIsValid =
          (configCheckValue.cachedConfig as AdaptiveExtractionConfig)
            .resolution === config.resolution;
      }
    } else {
      cacheIsValid = configCheckValue.isValid;
    }

    if (cacheIsValid) {
      const cacheGetResult = await cache.getCache<MediaInfo>(
        JOB_NAME,
        cacheKey,
      );
      if (cacheGetResult.isErr()) {
        // Log or handle cache get error, but proceed to calculate
        console.warn(
          `Cache get failed for ${filePath} (key: ${cacheKey}), proceeding with calculation:`,
          cacheGetResult.error,
        );
      } else if (cacheGetResult.value.hit) {
        // Cache hit and data is valid
        return ok(cacheGetResult.value.data!); // Return cached data wrapped in ok
      }
    }
  }
  // --- End Cache Check ---

  // Removed duplicate comment
  // Removed unused 'result' variable declaration

  // --- Process File (Cache Miss or Invalid Config) ---
  let mediaInfoResult: AppResult<MediaInfo>; // Store result here

  if (mediaType === FileType.Image) {
    // Process Image - Wrap sharp operations by creating the promise first using an IIFE
    const sharpProcessingPromise = (async (): Promise<Buffer> => {
      // Ensure IIFE returns Promise<Buffer>
      // TODO: Refactor createSharpInstance, grayscaleImage, resizeImage if they can fail meaningfully
      const sharpInstance = createSharpInstance(filePath);
      const processedInstance = grayscaleImage(
        resizeImage(sharpInstance, config.resolution, config.resolution),
      );
      // Await the result of imageToBuffer, which returns AppResult<Buffer>
      const bufferResult = await imageToBuffer(processedInstance.raw());
      if (bufferResult.isErr()) {
        // If imageToBuffer failed, throw its error to be caught by the outer safeTryAsync
        throw bufferResult.error;
      }
      // If successful, return the unwrapped buffer
      return bufferResult.value;
    })(); // Immediately invoke

    // Pass the created promise to safeTryAsync
    const imageProcessingResult = await safeTryAsync<Buffer>(
      sharpProcessingPromise,
      // Error handler for safeTryAsync (catches errors from Sharp or the thrown AppError)
      (error) =>
        new ExternalToolError(
          `Sharp image processing failed for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
          {
            cause: error instanceof Error ? error : undefined,
            context: { tool: 'sharp' },
          },
        ),
    );

    if (imageProcessingResult.isErr()) {
      mediaInfoResult = err(imageProcessingResult.error);
    } else {
      // imageProcessingResult.value is Buffer
      const hashResult = await computePerceptualHashWorker(
        imageProcessingResult.value,
        config.resolution,
        workerPool,
      );
      if (hashResult.isErr()) {
        mediaInfoResult = err(hashResult.error);
      } else {
        mediaInfoResult = ok({
          frames: [{ hash: hashResult.value, timestamp: 0 }],
          duration: 0,
        });
      }
    }
  } else {
    // Process Video
    // Process Video - Wrap probe and frame extraction
    // Call the refactored probeFile which now returns Promise<AppResult<FfprobeData>>
    const probeResult = await probeFile(filePath);
    // No need for safeTryAsync here as probeFile handles its own errors internally

    if (probeResult.isErr()) {
      mediaInfoResult = err(probeResult.error);
    } else {
      // probeResult is AppResult<FfprobeData>, access value safely
      const duration = probeResult.value.format.duration || 0;

      if (duration <= 0) {
        console.warn(
          `Video ${filePath} has zero or negative duration. Returning empty frames.`,
        );
        mediaInfoResult = ok({ frames: [], duration: 0 });
      } else {
        // This is the correct start of the 'else' block for duration > 0
        const targetFrameCount = Math.ceil(duration * config.targetFps);
        const frameInterval =
          duration / Math.min(targetFrameCount, config.minFrames);
        const minInterval = 1 / config.targetFps;
        const selectFilter = `select='eq(n,0)+gt(scene,${config.sceneChangeThreshold})*gte(t-prev_selected_t\\,${minInterval})+gte(t-prev_selected_t\\,${frameInterval})'`;

        // Extract frames, handling AppResult
        const framesResult = await extractFramesWithFilter(
          filePath,
          selectFilter,
          config,
          workerPool,
        );

        if (framesResult.isErr()) {
          mediaInfoResult = err(framesResult.error);
        } else {
          let frames = framesResult.value; // Unwrap frames array

          if (frames.length < 1) {
            console.warn(
              `No frames extracted from ${filePath} despite positive duration. Returning empty frames.`,
            );
            // No error, just empty frames
            mediaInfoResult = ok({ frames: [], duration });
          } else {
            if (
              frames.length > targetFrameCount &&
              frames.length > config.maxSceneFrames
            ) {
              // reduceFrames is pure, no AppResult needed unless it could fail
              frames = reduceFrames(
                frames,
                Math.max(targetFrameCount, config.maxSceneFrames),
              );
            }
            mediaInfoResult = ok({ frames, duration });
          }
        }
      }
    }
  }
  // Removed leftover comments

  // --- End Process File ---

  // If processing failed, return the error
  if (mediaInfoResult.isErr()) {
    return err(mediaInfoResult.error);
  }

  // Store successful result in cache
  const setResult = await cache.setCache(
    JOB_NAME,
    cacheKey,
    mediaInfoResult.value,
    config,
  );
  if (setResult.isErr()) {
    // Log cache set error but return the successful result anyway
    console.warn(
      `Cache set failed for ${filePath} (key: ${cacheKey}), but returning calculated result:`,
      setResult.error,
    );
  }

  // Return the successful result
  return mediaInfoResult; // Already ok()
}

// End of file
