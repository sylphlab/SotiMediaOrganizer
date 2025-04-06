import { FileType, Metadata } from "./types";
import { extname } from "path";
import { ExifDate, ExifDateTime, Tags } from "exiftool-vendored";
import { createHash } from "crypto";
import { createReadStream, Stats } from "fs";
import { stat } from "fs/promises";
import {
  AppResult,
  ok,
  err,
  FileSystemError,
  ValidationError,
  UnknownError,
  HashingError,
  safeTryAsync,
  safeTry,
  AppError,
} from "./errors"; // Removed unused AnyAppError

export function getFileType(filePath: string): AppResult<FileType> {
  const ext = extname(filePath).slice(1).toLowerCase();
  return getFileTypeByExt(ext);
}

export function getFileTypeByExt(ext: string): AppResult<FileType> {
  for (const fileType of [FileType.Image, FileType.Video]) {
    if (SUPPORTED_EXTENSIONS[fileType].has(ext)) {
      return ok(fileType);
    }
  }
  return err(
    new ValidationError(`Unsupported file extension: ${ext}`, {
      validationDetails: { extension: ext },
    }),
  );
}

export const SUPPORTED_EXTENSIONS = {
  [FileType.Image]: new Set([
    "jpg",
    "jpeg",
    "jpe",
    "jif",
    "jfif",
    "jfi",
    "jp2",
    "j2c",
    "jpf",
    "jpx",
    "jpm",
    "mj2",
    "png",
    "webp",
    "tif",
    "tiff",
    "bmp",
    "dib",
    "heic",
    "heif",
    "avif",
    "cr2",
    "cr3",
    "nef",
    "nrw",
    "arw",
    "srf",
    "sr2",
    "dng",
    "orf",
    "ptx",
    "pef",
    "rw2",
    "raf",
    "raw",
    "x3f",
    "srw",
  ]),
  [FileType.Video]: new Set([
    "mp4",
    "m4v",
    "mov",
    "3gp",
    "3g2",
    "avi",
    "mpg",
    "mpeg",
    "mpe",
    "mpv",
    "m2v",
    "m2p",
    "m2ts",
    "mts",
    "ts",
    "qt",
    "wmv",
    "asf",
    "flv",
    "f4v",
    "webm",
    "divx",
    "gif",
  ]),
};

export const ALL_SUPPORTED_EXTENSIONS = new Set([
  ...SUPPORTED_EXTENSIONS[FileType.Image],
  ...SUPPORTED_EXTENSIONS[FileType.Video],
]);

export function bufferToSharedArrayBuffer(buffer: Buffer): SharedArrayBuffer {
  const sharedArrayBuffer = new SharedArrayBuffer(buffer.length);
  const sharedArrayBufferView = new Uint8Array(sharedArrayBuffer);
  sharedArrayBufferView.set(new Uint8Array(buffer));
  return sharedArrayBuffer;
}

export function sharedArrayBufferToBuffer(
  sharedArrayBuffer: SharedArrayBuffer,
): Buffer {
  return Buffer.from(sharedArrayBuffer);
}

export async function filterAsync<T>(
  arr: T[],
  filter: (item: T) => Promise<AppResult<boolean>>,
): Promise<AppResult<T[]>> {
  const results = await Promise.all(
    arr.map((item) => safeTryAsync(filter(item))),
  );
  const filtered: T[] = [];
  for (let i = 0; i < results.length; i++) {
    const result = results[i];
    if (result.isErr()) {
      return err(result.error); // Propagate the first error encountered
    }
    if (result.value.isOk() && result.value.value) {
      // Check inner result is Ok and true
      filtered.push(arr[i]);
    } else if (result.value.isErr()) {
      // If the filter function itself returned an error, propagate it
      return err(result.value.error);
    }
  }
  return ok(filtered);
}

export async function mapAsync<T, U>( // Added async keyword
  arr: T[],
  mapFn: (item: T) => Promise<AppResult<U>>,
): Promise<AppResult<U[]>> {
  const results: U[] = [];
  for (const item of arr) {
    const result = await mapFn(item); // Await each result individually to handle errors sequentially
    if (result.isErr()) {
      return err(result.error); // Propagate the first error
    }
    results.push(result.value);
  }
  return ok(results);
}

// Convert SharedArrayBuffer to hex string
export function sharedArrayBufferToHex(buffer: SharedArrayBuffer): string {
  const uint8Array = new Uint8Array(buffer);
  let hexString = "";

  for (let i = 0; i < uint8Array.length; i++) {
    hexString += uint8Array[i].toString(16).padStart(2, "0");
  }

  return hexString;
}

// Convert hex string to SharedArrayBuffer
export function hexToSharedArrayBuffer(
  hex: string,
): AppResult<SharedArrayBuffer> {
  if (hex.length % 2 !== 0) {
    return err(
      new ValidationError("Hex string must have an even number of characters", {
        validationDetails: { length: hex.length },
      }),
    );
  }
  try {
    const buffer = new SharedArrayBuffer(hex.length / 2);
    const view = new Uint8Array(buffer);
    for (let i = 0; i < hex.length; i += 2) {
      const byte = parseInt(hex.substr(i, 2), 16);
      if (isNaN(byte)) {
        return err(
          new ValidationError("Hex string contains non-hex characters", {
            validationDetails: { substring: hex.substr(i, 2) },
          }),
        );
      }
      view[i / 2] = byte;
    }
    return ok(buffer);
  } catch (error) {
    // Catch potential errors during SharedArrayBuffer creation or parsing, though less likely with checks above
    return err(new UnknownError(error));
  }
}

// Imports moved to top
// Duplicate import removed

/**
 * Calculates the MD5 hash of a file, potentially using partial hashing for large files.
 * @param filePath The path to the file.
 * @param fileSize The size of the file in bytes.
 * @param maxChunkSize The threshold size above which partial hashing is used.
 *                     If partial hashing is used, (maxChunkSize / 2) bytes from the
 *                     beginning and end of the file are hashed.
 * @returns A Promise resolving to the MD5 hash as a SharedArrayBuffer.
 */
export async function calculateFileHash(
  filePath: string,
  fileSize: number,
  maxChunkSize: number,
): Promise<AppResult<SharedArrayBuffer>> {
  const hash = createHash("md5");

  const hashPart = (
    start: number = 0,
    size?: number,
  ): Promise<AppResult<void>> => {
    // Correct return type annotation
    return new Promise<AppResult<void>>((resolve) => {
      // Resolve with AppResult
      const stream = createReadStream(filePath, {
        start,
        end: size ? start + size - 1 : undefined,
      });
      stream.on("data", (chunk: Buffer) => hash.update(chunk));
      stream.on("end", () => resolve(ok(undefined))); // Resolve with ok result
      stream.on("error", (streamError) => {
        resolve(
          err(
            new FileSystemError(
              `Error reading file chunk: ${streamError.message}`,
              {
                path: filePath,
                operation: "readStream",
                originalError: streamError,
              },
            ),
          ),
        ); // Resolve with err result
      });
    });
  };

  if (fileSize > maxChunkSize) {
    const chunkSize = maxChunkSize / 2;
    // Ensure chunkSize is an integer and handle potential edge cases (e.g., fileSize < chunkSize)
    const safeChunkSize = Math.max(1, Math.floor(chunkSize));
    if (fileSize >= safeChunkSize * 2) {
      const part1Result = await hashPart(0, safeChunkSize);
      if (part1Result.isErr()) return err(part1Result.error); // Reconstruct Err with correct type
      const part2Result = await hashPart(
        fileSize - safeChunkSize,
        safeChunkSize,
      );
      if (part2Result.isErr()) return err(part2Result.error); // Reconstruct Err with correct type
    } else {
      // If the file is smaller than two chunks, hash the whole thing
      const fullResult = await hashPart();
      if (fullResult.isErr()) return err(fullResult.error); // Reconstruct Err with correct type
    }
  } else {
    const fullResult = await hashPart();
    if (fullResult.isErr()) return err(fullResult.error); // Reconstruct Err with correct type
  }

  // Wrap the final buffer conversion in case of errors (though less likely here)
  try {
    return ok(bufferToSharedArrayBuffer(hash.digest()));
  } catch (error) {
    return err(
      new HashingError("Failed to convert hash digest to SharedArrayBuffer", {
        originalError: error instanceof Error ? error : undefined,
      }),
    );
  }
}
// Duplicate import removed

// Helper function to parse various date formats from ExifTool
function parseExifDate(
  value: string | ExifDateTime | ExifDate | undefined,
): Date | undefined {
  if (!value) return undefined;
  if (typeof value === "string") {
    // Try parsing common string formats, adjust as needed
    const date = new Date(value.replace(/(\d{4}):(\d{2}):(\d{2})/, "$1-$2-$3")); // Handle YYYY:MM:DD
    if (!isNaN(date.getTime())) return date;
    return undefined;
  }
  // exiftool-vendored types already handle Date, ExifDateTime, ExifDate
  if (value instanceof Date) return value;
  // Duck typing: Check if it has a toDate method
  if (value && typeof (value as any).toDate === 'function') {
      // Attempt to call toDate and ensure it returns a Date
      try {
          const date = (value as any).toDate();
          if (date instanceof Date) {
              return date;
          }
      } catch (e) {
          // Ignore errors from toDate call, will return undefined below
      }
  }
  return undefined;
}

/**
 * Parses raw ExifTool tags into a structured Metadata object.
 * @param tags The Tags object obtained from exifTool.read().
 * @returns A Metadata object.
 */
export function parseExifTagsToMetadata(tags: Tags): AppResult<Metadata> {
  // Use safeTry to wrap the parsing logic, catching unexpected errors
  return safeTry(
    () => {
      const metadata: Metadata = {
        imageDate:
          parseExifDate(tags.DateTimeOriginal) ??
          parseExifDate(tags.CreateDate) ??
          parseExifDate(tags.MediaCreateDate),
        width: tags.ImageWidth || tags.ExifImageWidth || 0,
        height: tags.ImageHeight || tags.ExifImageHeight || 0,
        gpsLatitude: tags.GPSLatitude,
        gpsLongitude: tags.GPSLongitude,
        cameraModel: tags.Model,
      };
      // Add validation if needed - e.g., check if width/height are valid
      // if (metadata.width <= 0 || metadata.height <= 0) {
      //     // Decide how to handle - return error or default?
      //     // For now, allowing 0 as per original logic
      // }
      return metadata;
    },
    (error) =>
      new AppError(
        `Failed to parse EXIF tags object: ${error instanceof Error ? error.message : String(error)}`,
        { originalError: error },
      ),
  );
}

/**
 * Finds the k-th smallest element in an array using the Quickselect algorithm.
 * Note: This implementation creates intermediate arrays, which might not be the most memory-efficient
 * for extremely large arrays in performance-critical scenarios.
 * @param arr The array to search within.
 * @param k The 0-based index of the element to find (e.g., k=0 for minimum, k=floor(n/2) for median).
 * @returns The k-th smallest element.
 */
export function quickSelect(
  arr: Float32Array | number[],
  k: number,
): AppResult<number> {
  // Ensure k is within bounds
  if (k < 0 || k >= arr.length) {
    return err(
      new ValidationError(
        `Index k (${k}) out of bounds for array length ${arr.length}`,
        { validationDetails: { k, length: arr.length } },
      ),
    );
  }

  // Base case for recursion
  if (arr.length === 1) {
    return ok(arr[0]);
  }

  // Choose a pivot (simple middle element strategy)
  const pivotIndex = Math.floor(arr.length / 2);
  const pivot = arr[pivotIndex];

  // Partition the array (excluding the pivot itself initially)
  const left: number[] = [];
  const right: number[] = [];
  const pivots: number[] = []; // To handle duplicate pivot values

  for (let i = 0; i < arr.length; i++) {
    const element = arr[i];
    if (element < pivot) {
      left.push(element);
    } else if (element > pivot) {
      right.push(element);
    } else {
      pivots.push(element);
    }
  }

  // Determine which partition contains the k-th element
  if (k < left.length) {
    // k-th element is in the left partition
    return quickSelect(left, k);
  } else if (k < left.length + pivots.length) {
    // k-th element is one of the pivots
    return ok(pivot);
  } else {
    // k-th element is in the right partition
    // Adjust k to be relative to the right partition's start
    return quickSelect(right, k - left.length - pivots.length);
  }
}

/**
 * Pre-computes constants needed for DCT-based perceptual hashing.
 * @param resolution The size (width/height) of the input image data (e.g., 32 for 32x32).
 * @param hashSize The size of the hash dimension (e.g., 8 for 8x8 hash). Default is 8.
 * @returns An object containing pre-computed dctCoefficients and normFactors.
 */
export function createDCTConstants(
  resolution: number,
  hashSize: number = 8,
): { dctCoefficients: Float32Array; normFactors: Float32Array } {
  const size = resolution;
  const scale = Math.sqrt(2 / size);

  // Pre-compute DCT coefficients
  const dctCoefficients = new Float32Array(size * hashSize);
  for (let u = 0; u < hashSize; u++) {
    for (let x = 0; x < size; x++) {
      dctCoefficients[u * size + x] = Math.cos(
        ((2 * x + 1) * u * Math.PI) / (2 * size),
      );
    }
  }

  // Pre-compute normalization factors
  const normFactors = new Float32Array(hashSize);
  for (let i = 0; i < hashSize; i++) {
    normFactors[i] = i === 0 ? scale / Math.SQRT2 : scale;
  }

  return { dctCoefficients, normFactors };
}

/**
 * Computes the 2D DCT-II for the top-left corner of an image data array.
 * Assumes input is grayscale image data.
 * @param input Grayscale image data buffer (Uint8Array).
 * @param size The width/height of the square input data block.
 * @param hashSize The dimension of the DCT output (e.g., 8 for 8x8).
 * @param dctConstants Pre-computed DCT coefficients and normalization factors.
 * @returns The top-left hashSize x hashSize DCT coefficients.
 */
export function computeFastDCT(
  input: Uint8Array,
  size: number,
  hashSize: number,
  dctConstants: { dctCoefficients: Float32Array; normFactors: Float32Array },
): AppResult<Float32Array> {
  const output = new Float32Array(hashSize * hashSize);
  const temp = new Float32Array(hashSize);
  const { dctCoefficients, normFactors } = dctConstants;

  for (let y = 0; y < size; y++) {
    // DCT row transform
    for (let u = 0; u < hashSize; u++) {
      let sum = 0;
      const coeffOffset = u * size;
      for (let x = 0; x < size; x++) {
        sum += input[y * size + x] * dctCoefficients[coeffOffset + x];
      }
      temp[u] = normFactors[u] * sum; // Apply row normalization factor
    }

    // DCT column transform and normalization
    for (let v = 0; v < hashSize; v++) {
      const normFactor = normFactors[v];
      // Ensure vCoeff index is within bounds of dctCoefficients
      const vCoeffIndex = v * size + y;
      if (vCoeffIndex >= dctCoefficients.length) {
        // Return an error instead of logging and continuing
        return err(
          new ValidationError(
            `DCT coefficient index out of bounds during column transform`,
            {
              validationDetails: {
                v,
                size,
                y,
                index: vCoeffIndex,
                length: dctCoefficients.length,
              },
            },
          ),
        );
      }
      const vCoeff = dctCoefficients[vCoeffIndex];
      const outputOffset = v * hashSize;
      for (let u = 0; u < hashSize; u++) {
        output[outputOffset + u] += normFactor * temp[u] * vCoeff;
      }
    }
  }
  return ok(output);
}

// Removed incorrect import line

/**
 * Gets file statistics using fs.promises.stat.
 * @param filePath The path to the file.
 * @returns A Promise resolving to the Stats object.
 */
export async function getFileStats(
  filePath: string,
): Promise<AppResult<Stats>> {
  return safeTryAsync(
    stat(filePath),
    (e) =>
      new FileSystemError(
        `Failed to get stats for file: ${e instanceof Error ? e.message : String(e)}`,
        {
          path: filePath,
          operation: "stat",
          originalError: e instanceof Error ? e : undefined,
        },
      ),
  );
}

// Removed duplicated code block

/**
 * Computes the final perceptual hash bits from the DCT coefficients.
 * @param dct The DCT coefficients (typically 8x8 = 64 values).
 * @param hashSize The dimension of the hash (e.g., 8 for 8x8).
 * @returns The perceptual hash as a Uint8Array.
 */
export function computeHashFromDCT(
  dct: Float32Array,
  hashSize: number,
): AppResult<Uint8Array> {
  if (dct.length === 0) {
    return err(new ValidationError("DCT array cannot be empty"));
  }
  // Compute median of AC components (excluding DC component at index 0)
  const acValues = new Float32Array(Math.max(0, dct.length - 1)); // Ensure non-negative length
  for (let i = 1; i < dct.length; i++) {
    acValues[i - 1] = Math.abs(dct[i]);
  }

  if (acValues.length === 0) {
    // Handle case where DCT only had DC component (e.g., 1x1 input)
    // Decide on appropriate behavior - maybe return zero hash or error?
    // For now, let's return an error as median is undefined.
    return err(
      new ValidationError(
        "Cannot compute median AC value from DCT with only DC component",
      ),
    );
  }

  const medianResult = quickSelect(acValues, Math.floor(acValues.length / 2));
  if (medianResult.isErr()) {
    // Propagate error from quickSelect (e.g., index out of bounds, though unlikely here)
    return err(medianResult.error);
  }
  const medianAC = medianResult.value;

  // Compute hash bits
  const hash = new Uint8Array(hashSize); // Assuming hashSize is 8 for byte packing
  const numHashBits = hashSize * hashSize; // Total number of bits in the hash

  if (hashSize !== 8) {
    console.warn(
      "computeHashFromDCT currently assumes hashSize=8 for byte packing. Results may be incorrect for other sizes.",
    );
  }

  for (let i = 0; i < numHashBits; i++) {
    // Map linear index i to 2D indices (row, col) if needed, or process linearly
    // Example for 8x8 packed into bytes:
    const byteIndex = Math.floor(i / 8);
    const bitIndex = i % 8;

    if (dct[i] > medianAC) {
      if (byteIndex < hash.length) {
        // Ensure byteIndex is within bounds
        hash[byteIndex] |= 1 << bitIndex;
      }
    }
  }

  // If hashSize is not 8, the packing logic needs adjustment.
  // For simplicity, this example assumes hashSize=8.

  return ok(hash);
}

// Removed leftover comment

// Removed leftover comment
