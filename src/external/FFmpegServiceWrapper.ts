import ffmpeg, { FfprobeData } from "fluent-ffmpeg";
import { AppResult, ok, err, ExternalToolError } from "../errors"; // Added AppResult imports

// Optional: Set FFmpeg path if not in system PATH
// import { setFfmpegPath } from 'fluent-ffmpeg';
// setFfmpegPath('/path/to/ffmpeg');

/**
 * Probes a media file for metadata using ffprobe.
 * @param filePath The path to the media file.
 * @returns A Promise resolving to an AppResult containing the FfprobeData or an ExternalToolError.
 */
export function probeFile(filePath: string): Promise<AppResult<FfprobeData>> {
  return new Promise((resolve) => {
    // Resolve with AppResult, no reject needed
    ffmpeg.ffprobe(filePath, (probeErr, metadata) => {
      if (probeErr) {
        // Resolve with an Err result
        resolve(
          err(
            new ExternalToolError(
              `Failed to probe file ${filePath}: ${probeErr.message}`,
              { tool: "ffprobe", originalError: probeErr }
            )
          )
        );
      } else {
        // Resolve with an Ok result
        resolve(ok(metadata));
      }
    });
  });
}

/**
 * Creates a fluent-ffmpeg command instance for a given input file.
 * @param filePath The path to the input media file.
 * @returns A fluent-ffmpeg command instance.
 */
export function createFFmpegCommand(filePath: string): ffmpeg.FfmpegCommand {
  return ffmpeg(filePath);
}

// Add wrappers for specific command operations (filters, output options, run, pipe) as needed.
// Example:
/**
 * Applies video filters to an FFmpeg command.
 * @param command The FFmpeg command instance.
 * @param filters An array of filter strings or filter objects.
 * @returns The FFmpeg command instance for chaining.
 */
export function applyVideoFilters(
  command: ffmpeg.FfmpegCommand,
  filters: (string | ffmpeg.AudioVideoFilter)[]
): ffmpeg.FfmpegCommand {
  // Convert all filters to the AudioVideoFilter object format
  const processedFilters: ffmpeg.AudioVideoFilter[] = filters.map(
    (
      f
    ): ffmpeg.AudioVideoFilter =>  // Add explicit return type for clarity
      typeof f === "string" ? { filter: f, options: {} } : f // Add empty options object
  );
  return command.videoFilters(processedFilters); // Pass the processed array
}

/**
 * Adds output options to an FFmpeg command.
 * @param command The FFmpeg command instance.
 * @param options An array of output option strings.
 * @returns The FFmpeg command instance for chaining.
 */
export function addOutputOptions(
  command: ffmpeg.FfmpegCommand,
  options: string[]
): ffmpeg.FfmpegCommand {
  return command.outputOptions(options);
}

// Note: Handling events (.on('error'), .on('end'), .on('stderr')) and piping (.pipe())
// might be more complex to wrap purely functionally, as they deal with streams and side effects.
// These might need careful consideration during the refactoring of AdaptiveExtractionJob.
// For now, we provide the basic command creation and option setting.
