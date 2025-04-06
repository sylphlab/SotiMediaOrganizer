import sharp, {
  Sharp,
  Metadata as SharpMetadata,
  Stats as SharpStats,
} from 'sharp';
import { AppResult, ExternalToolError, safeTryAsync } from '../errors'; // Removed unused ok, err

/**
 * Sets the concurrency for sharp.
 * @param concurrency The maximum number of threads sharp should use.
 */
export function setSharpConcurrency(concurrency: number): void {
  sharp.concurrency(concurrency);
}

/**
 * Creates a sharp instance for a given input (Buffer, file path, etc.).
 * @param input The input image data or path.
 * @returns A sharp instance.
 */
export function createSharpInstance(input?: Buffer | string): Sharp {
  // Sharp can be called with or without input
  return input ? sharp(input) : sharp();
}

/**
 * Reads image metadata using sharp.
 * @param instance A sharp instance.
 * @returns A Promise resolving to the image metadata.
 */
export async function readSharpMetadata(
  instance: Sharp,
): Promise<AppResult<SharpMetadata>> {
  return safeTryAsync(
    instance.metadata(),
    (error) =>
      new ExternalToolError(
        `Failed to read sharp metadata: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { tool: 'sharp' },
        },
      ),
  );
}

/**
 * Reads image stats using sharp.
 * @param instance A sharp instance.
 * @returns A Promise resolving to the image stats.
 */
export async function readSharpStats(
  instance: Sharp,
): Promise<AppResult<SharpStats>> {
  return safeTryAsync(
    instance.stats(),
    (error) =>
      new ExternalToolError(
        `Failed to read sharp stats: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { tool: 'sharp' },
        },
      ),
  );
}

// Add wrappers for specific sharp operations as needed, e.g., resize, grayscale, toBuffer
// These wrappers will isolate the direct sharp API calls.

/**
 * Resizes an image using sharp.
 * @param instance The sharp instance.
 * @param width The target width.
 * @param height The target height.
 * @returns The sharp instance for chaining.
 */
export function resizeImage(
  instance: Sharp,
  width: number,
  height: number,
): Sharp {
  return instance.resize(width, height);
}

/**
 * Converts an image to grayscale using sharp.
 * @param instance The sharp instance.
 * @returns The sharp instance for chaining.
 */
export function grayscaleImage(instance: Sharp): Sharp {
  return instance.grayscale();
}

/**
 * Outputs the processed image to a Buffer using sharp.
 * @param instance The sharp instance.
 * @returns A Promise resolving to the image Buffer.
 */
export async function imageToBuffer(
  instance: Sharp,
): Promise<AppResult<Buffer>> {
  return safeTryAsync(
    instance.toBuffer(),
    (error) =>
      new ExternalToolError(
        `Failed to convert image to buffer: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error instanceof Error ? error : undefined,
          context: { tool: 'sharp' },
        },
      ),
  );
}
