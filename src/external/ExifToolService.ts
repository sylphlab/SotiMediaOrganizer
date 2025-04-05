import { ExifTool, Tags } from "exiftool-vendored";
import { AppResult, ExternalToolError, safeTryAsync } from "../errors"; // Removed unused ok, err

/**
 * Reads Exif tags from a file using the provided ExifTool instance.
 * This function isolates the direct interaction with the exiftool-vendored library.
 *
 * @param filePath The path to the media file.
 * @param exifTool An instance of the ExifTool class.
 * @returns A Promise resolving to an AppResult containing the Tags object or an ExternalToolError.
 */
export async function readExifTags(
  filePath: string,
  exifTool: ExifTool,
): Promise<AppResult<Tags>> {
  // Use safeTryAsync to wrap the potentially throwing exifTool.read call
  return safeTryAsync(
    exifTool.read(filePath), // TODO: Add specific tags to read for optimization? e.g., ['-File:all']
    (error) =>
      new ExternalToolError(
        `Failed to read Exif tags for ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        {
          tool: "exiftool",
          originalError: error instanceof Error ? error : undefined,
        },
      ),
  );
}

/**
 * Creates an ExifTool instance with specified concurrency.
 *
 * @param concurrency The maximum number of ExifTool processes to run concurrently.
 * @returns A new ExifTool instance.
 */
export function createExifTool(concurrency: number): ExifTool {
  return new ExifTool({ maxProcs: concurrency });
}

// Consider adding a function to gracefully end the ExifTool process if needed,
// although exiftool-vendored often handles this automatically.
// export async function endExifTool(exifTool: ExifTool): Promise<void> {
//     await exifTool.end();
// }
