import { injectable } from "inversify"; // Removed unused 'inject'
import { mkdir, copyFile, rename, unlink } from "fs/promises";
import { join, basename, dirname, extname, parse, normalize } from "path"; // Added normalize
import { existsSync } from "fs";
import crypto from "crypto";
import chalk from "chalk";
import { MultiBar, Presets } from "cli-progress";
import { FileInfo, DeduplicationResult, GatherFileInfoResult } from "../types";
import { MediaProcessor } from "../MediaProcessor";

@injectable()
export class FileTransferService {
  constructor(private processor: MediaProcessor) {}

  async transferOrganizedFiles(
    gatherFileInfoResult: GatherFileInfoResult,
    deduplicationResult: DeduplicationResult,
    targetDir: string,
    duplicateDir: string | undefined,
    errorDir: string | undefined,
    format: string,
    shouldMove: boolean,
  ): Promise<void> {
    const multibar = new MultiBar(
      {
        clearOnComplete: false,
        hideCursor: true,
        format:
          "{phase} " +
          chalk.cyan("{bar}") +
          " {percentage}% || {value}/{total} Files",
      },
      Presets.shades_classic,
    );

    // --- Transfer unique files ---
    const uniqueBar = multibar.create(deduplicationResult.uniqueFiles.size, 0, {
      phase: "Unique  ",
    });
    for (const filePath of deduplicationResult.uniqueFiles) {
      const fileInfo = await this.processor.processFile(filePath); // Use injected processor
      if (!fileInfo) {
        // Consider logging a warning or skipping instead of throwing?
        console.warn(
          chalk.yellow(`Skipping unique file due to missing info: ${filePath}`),
        );
        uniqueBar.increment(); // Increment even if skipped to keep progress accurate
        continue;
        // throw new Error(`File info not found for file ${filePath}`);
      }
      const targetPath = this.generateTargetPath(
        format,
        targetDir,
        fileInfo,
        filePath,
      );
      await this.transferOrCopyFile(filePath, targetPath, !shouldMove);
      uniqueBar.increment();
    }

    // --- Handle duplicate files ---
    if (duplicateDir) {
      const duplicateCount = Array.from(
        deduplicationResult.duplicateSets.values(),
      ).reduce((sum, set) => sum + set.duplicates.size, 0);

      if (duplicateCount > 0) {
        const duplicateBar = multibar.create(duplicateCount, 0, {
          phase: "Duplicate",
        });

        for (const duplicateSet of deduplicationResult.duplicateSets) {
          const bestFile = duplicateSet.bestFile;
          // Create a subfolder named after the best file's base name
          const duplicateFolderName = basename(bestFile, extname(bestFile));
          const duplicateSetFolder = join(duplicateDir, duplicateFolderName);

          for (const duplicatePath of duplicateSet.duplicates) {
            await this.transferOrCopyFile(
              duplicatePath,
              join(duplicateSetFolder, basename(duplicatePath)),
              !shouldMove, // Always copy/move duplicates based on flag
            );
            duplicateBar.increment();
          }
        }
        console.log(
          chalk.yellow(
            `\nDuplicate files have been ${shouldMove ? "moved" : "copied"} to ${duplicateDir}`,
          ),
        );
      } else {
        console.log(chalk.yellow("\nNo duplicate files to process."));
      }
    } else {
      // If no duplicateDir, process representatives (best files)
      const representativeCount = Array.from(
        deduplicationResult.duplicateSets.values(),
      ).reduce((sum, set) => sum + set.representatives.size, 0);

      if (representativeCount > 0) {
        const bestFileBar = multibar.create(representativeCount, 0, {
          phase: "Best File",
        });
        for (const duplicateSet of deduplicationResult.duplicateSets) {
          for (const representativePath of duplicateSet.representatives) {
            const fileInfo =
              await this.processor.processFile(representativePath);
            if (!fileInfo) {
              console.warn(
                chalk.yellow(
                  `Skipping representative file due to missing info: ${representativePath}`,
                ),
              );
              bestFileBar.increment();
              continue;
              // throw new Error(
              //   `File info not found for file ${representativePath}`,
              // );
            }
            const targetPath = this.generateTargetPath(
              format,
              targetDir,
              fileInfo,
              representativePath,
            );
            await this.transferOrCopyFile(
              representativePath,
              targetPath,
              !shouldMove,
            );
            bestFileBar.increment();
          }
        }
      }
    }

    // --- Handle error files ---
    if (errorDir && gatherFileInfoResult.errorFiles.length > 0) {
      const errorBar = multibar.create(
        gatherFileInfoResult.errorFiles.length,
        0,
        { phase: "Error   " },
      );
      for (const errorFilePath of gatherFileInfoResult.errorFiles) {
        const targetPath = join(errorDir, basename(errorFilePath));
        // Use copy for error files regardless of move flag? Or follow flag? Following flag for now.
        await this.transferOrCopyFile(errorFilePath, targetPath, !shouldMove);
        errorBar.increment();
      }
      console.log(
        chalk.red(
          `\nError files have been ${shouldMove ? "moved" : "copied"} to ${errorDir}`,
        ),
      );
    }

    multibar.stop();
    console.log(chalk.green("\nFile transfer completed"));
  }

  private async transferOrCopyFile(
    sourcePath: string,
    targetPath: string,
    isCopy: boolean,
  ): Promise<void> {
    try {
      await mkdir(dirname(targetPath), { recursive: true });
      if (isCopy) {
        await copyFile(sourcePath, targetPath);
      } else {
        try {
          await rename(sourcePath, targetPath);
        } catch (error) {
          if (
            error instanceof Error &&
            "code" in error &&
            error.code === "EXDEV"
          ) {
            // Cross-device move, fallback to copy-then-delete
            await copyFile(sourcePath, targetPath);
            await unlink(sourcePath);
          } else {
            // Rethrow other rename errors
            throw error;
          }
        }
      }
    } catch (error) {
      console.error(
        chalk.red(
          `\nError ${isCopy ? "copying" : "moving"} file ${sourcePath} to ${targetPath}:`,
        ),
        error,
      );
      // Decide if we should throw or just log and continue
      // For now, log and continue
    }
  }

  private generateTargetPath(
    format: string,
    targetDir: string,
    fileInfo: FileInfo,
    sourcePath: string,
  ): string {
    const mixedDate =
      fileInfo.metadata.imageDate || fileInfo.fileStats.createdAt;
    const { name, ext } = parse(sourcePath);

    // Moved generateRandomId to be a private method of the class

    const data: { [key: string]: string } = {
      "I.YYYY": this.formatDate(fileInfo.metadata.imageDate, "YYYY"),
      "I.YY": this.formatDate(fileInfo.metadata.imageDate, "YY"),
      "I.MMMM": this.formatDate(fileInfo.metadata.imageDate, "MMMM"),
      "I.MMM": this.formatDate(fileInfo.metadata.imageDate, "MMM"),
      "I.MM": this.formatDate(fileInfo.metadata.imageDate, "MM"),
      "I.M": this.formatDate(fileInfo.metadata.imageDate, "M"),
      "I.DD": this.formatDate(fileInfo.metadata.imageDate, "DD"),
      "I.D": this.formatDate(fileInfo.metadata.imageDate, "D"),
      "I.DDDD": this.formatDate(fileInfo.metadata.imageDate, "DDDD"),
      "I.DDD": this.formatDate(fileInfo.metadata.imageDate, "DDD"),
      "I.HH": this.formatDate(fileInfo.metadata.imageDate, "HH"),
      "I.H": this.formatDate(fileInfo.metadata.imageDate, "H"),
      "I.hh": this.formatDate(fileInfo.metadata.imageDate, "hh"),
      "I.h": this.formatDate(fileInfo.metadata.imageDate, "h"),
      "I.mm": this.formatDate(fileInfo.metadata.imageDate, "mm"),
      "I.m": this.formatDate(fileInfo.metadata.imageDate, "m"),
      "I.ss": this.formatDate(fileInfo.metadata.imageDate, "ss"),
      "I.s": this.formatDate(fileInfo.metadata.imageDate, "s"),
      "I.a": this.formatDate(fileInfo.metadata.imageDate, "a"),
      "I.A": this.formatDate(fileInfo.metadata.imageDate, "A"),
      "I.WW": this.formatDate(fileInfo.metadata.imageDate, "WW"),

      "F.YYYY": this.formatDate(fileInfo.fileStats.createdAt, "YYYY"),
      "F.YY": this.formatDate(fileInfo.fileStats.createdAt, "YY"),
      "F.MMMM": this.formatDate(fileInfo.fileStats.createdAt, "MMMM"),
      "F.MMM": this.formatDate(fileInfo.fileStats.createdAt, "MMM"),
      "F.MM": this.formatDate(fileInfo.fileStats.createdAt, "MM"),
      "F.M": this.formatDate(fileInfo.fileStats.createdAt, "M"),
      "F.DD": this.formatDate(fileInfo.fileStats.createdAt, "DD"),
      "F.D": this.formatDate(fileInfo.fileStats.createdAt, "D"),
      "F.DDDD": this.formatDate(fileInfo.fileStats.createdAt, "DDDD"),
      "F.DDD": this.formatDate(fileInfo.fileStats.createdAt, "DDD"),
      "F.HH": this.formatDate(fileInfo.fileStats.createdAt, "HH"),
      "F.H": this.formatDate(fileInfo.fileStats.createdAt, "H"),
      "F.hh": this.formatDate(fileInfo.fileStats.createdAt, "hh"),
      "F.h": this.formatDate(fileInfo.fileStats.createdAt, "h"),
      "F.mm": this.formatDate(fileInfo.fileStats.createdAt, "mm"),
      "F.m": this.formatDate(fileInfo.fileStats.createdAt, "m"),
      "F.ss": this.formatDate(fileInfo.fileStats.createdAt, "ss"),
      "F.s": this.formatDate(fileInfo.fileStats.createdAt, "s"),
      "F.a": this.formatDate(fileInfo.fileStats.createdAt, "a"),
      "F.A": this.formatDate(fileInfo.fileStats.createdAt, "A"),
      "F.WW": this.formatDate(fileInfo.fileStats.createdAt, "WW"),

      "D.YYYY": this.formatDate(mixedDate, "YYYY"),
      "D.YY": this.formatDate(mixedDate, "YY"),
      "D.MMMM": this.formatDate(mixedDate, "MMMM"),
      "D.MMM": this.formatDate(mixedDate, "MMM"),
      "D.MM": this.formatDate(mixedDate, "MM"),
      "D.M": this.formatDate(mixedDate, "M"),
      "D.DD": this.formatDate(mixedDate, "DD"),
      "D.D": this.formatDate(mixedDate, "D"),
      "D.DDDD": this.formatDate(mixedDate, "DDDD"),
      "D.DDD": this.formatDate(mixedDate, "DDD"),
      "D.HH": this.formatDate(mixedDate, "HH"),
      "D.H": this.formatDate(mixedDate, "H"),
      "D.hh": this.formatDate(mixedDate, "hh"),
      "D.h": this.formatDate(mixedDate, "h"),
      "D.mm": this.formatDate(mixedDate, "mm"),
      "D.m": this.formatDate(mixedDate, "m"),
      "D.ss": this.formatDate(mixedDate, "ss"),
      "D.s": this.formatDate(mixedDate, "s"),
      "D.a": this.formatDate(mixedDate, "a"),
      "D.A": this.formatDate(mixedDate, "A"),
      "D.WW": this.formatDate(mixedDate, "WW"),

      NAME: name,
      "NAME.L": name.toLowerCase(),
      "NAME.U": name.toUpperCase(),
      EXT: ext.slice(1).toLowerCase(), // Put EXT back in data
      RND: this.generateRandomId(), // Call as a method
      GEO:
        fileInfo.metadata.gpsLatitude && fileInfo.metadata.gpsLongitude
          ? `${fileInfo.metadata.gpsLatitude.toFixed(2)}_${fileInfo.metadata.gpsLongitude.toFixed(2)}`
          : "",
      CAM: fileInfo.metadata.cameraModel || "",
      TYPE: fileInfo.media.duration > 0 ? "Video" : "Image",
      "HAS.GEO":
        fileInfo.metadata.gpsLatitude && fileInfo.metadata.gpsLongitude
          ? "GeoTagged"
          : "NoGeo",
      "HAS.CAM": fileInfo.metadata.cameraModel ? "WithCamera" : "NoCamera",
      "HAS.DATE":
        fileInfo.metadata.imageDate &&
        !isNaN(fileInfo.metadata.imageDate.getTime())
          ? "Dated"
          : "NoDate",
    };

    // Build a regex that specifically matches the known format keys from the 'data' object
    const knownKeys = Object.keys(data).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Escape regex special chars in keys
    // Sort keys by length descending to match longer keys first (e.g., NAME.L before NAME) - might not be strictly necessary here but good practice
    knownKeys.sort((a, b) => b.length - a.length);
    // Regex to match {KEY}
    const formatRegex = new RegExp(`\\{(${knownKeys.join('|')})\\}`, 'g');

    const originalExt = parse(sourcePath).ext; // Get original extension with dot (e.g., ".jpg")

    let formattedPath = format.replace(formatRegex, (match, key) => {
        let replacement = "";
        if (key === "EXT") {
            // Use the original extension *with* the dot if the key is EXT
            replacement = originalExt;
        } else {
            replacement = (data[key] || ""); // Get value from data object for other keys
        }
        // Sanitize the replacement value (important for NAME, CAM etc.)
        // Don't sanitize the extension itself here.
        if (key !== "EXT") {
             replacement = replacement.replace(/[<>:"|?*]/g, "_");
        }
        return replacement;
    });

    // Removed the redundant originalExt definition and the separate replace call for EXT


    // Remove leading/trailing slashes and ensure single slashes
    formattedPath = formattedPath
      .split(/[/\\]+/)
      .filter(Boolean)
      .join("/"); // Removed unnecessary escape for /

    if (!formattedPath) {
      formattedPath = "NoDate"; // Default folder if format string results in empty path
    }

    // Determine if the format string likely intended to specify a filename
    const formatSpecifiesFilename = /\{NAME/.test(format) || /\{EXT\}/.test(format); // Simple check

    let directory: string;
    let finalFilenameBase: string;
    let finalFilenameExt: string;

    if (formatSpecifiesFilename) {
        // Assume formattedPath contains the intended directory and base filename (potentially without ext)
        const parsedFormatted = parse(formattedPath.replace(/\\/g, '/'));
        directory = parsedFormatted.dir;
        finalFilenameBase = parsedFormatted.name; // Name part from format
        // Use extension from format if present, otherwise use original
        finalFilenameExt = parsedFormatted.ext || originalExt;
    } else {
        // Format string only specified directory structure
        directory = formattedPath; // The whole thing is the directory
        finalFilenameBase = name; // Use original base name
        finalFilenameExt = ext; // Use original extension
    }

    // Combine base and extension
    let finalFilename = `${finalFilenameBase}${finalFilenameExt}`;

    // Sanitize filename part as well
    finalFilename = finalFilename.replace(/[<>:"/\\|?*]/g, "_");

    let fullPath = join(targetDir, directory, finalFilename); // Already correct here, but included for context

    // Handle potential filename conflicts
    let counter = 1;
    // Parse the *sanitized* filename to get parts for conflict resolution
    const parsedSanitizedFilename = parse(finalFilename);
    const baseNameForConflict = parsedSanitizedFilename.name;
    const extensionForConflict = parsedSanitizedFilename.ext;

    // Normalize the path *before* checking existence in the loop
    while (existsSync(normalize(fullPath))) {
      // Option 1: Append counter
      // filename = `${parsedFilename.name}_${counter++}${parsedFilename.ext}`;

      // Option 2: Append random ID (as was done before, but maybe only on conflict)
      finalFilename = `${baseNameForConflict}_${this.generateRandomId()}${extensionForConflict}`; // Call as a method

      fullPath = join(targetDir, directory, finalFilename); // Already correct here, but included for context
      // Safety break to prevent infinite loops in weird edge cases
      if (counter > 100) {
        console.error(
          chalk.red(
            `Could not resolve filename conflict for ${sourcePath} after 100 attempts.`,
          ),
        );
        throw new Error(
          `Filename conflict resolution failed for ${sourcePath}`,
        );
      }
      counter++;
    }

    return fullPath;
  }

  private formatDate(date: Date | undefined, format: string): string {
    if (!date || isNaN(date.getTime())) {
      return "";
    }

    const pad = (num: number) => num.toString().padStart(2, "0");

    const formatters: { [key: string]: () => string } = {
      YYYY: () => date.getFullYear().toString(),
      YY: () => date.getFullYear().toString().slice(-2),
      MMMM: () => date.toLocaleString("default", { month: "long" }),
      MMM: () => date.toLocaleString("default", { month: "short" }),
      MM: () => pad(date.getMonth() + 1),
      M: () => (date.getMonth() + 1).toString(),
      DD: () => pad(date.getDate()),
      D: () => date.getDate().toString(),
      DDDD: () => date.toLocaleString("default", { weekday: "long" }),
      DDD: () => date.toLocaleString("default", { weekday: "short" }),
      HH: () => pad(date.getHours()),
      H: () => date.getHours().toString(),
      hh: () => pad(date.getHours() % 12 || 12),
      h: () => (date.getHours() % 12 || 12).toString(),
      mm: () => pad(date.getMinutes()),
      m: () => date.getMinutes().toString(),
      ss: () => pad(date.getSeconds()),
      s: () => date.getSeconds().toString(),
      a: () => (date.getHours() < 12 ? "am" : "pm"),
      A: () => (date.getHours() < 12 ? "AM" : "PM"),
      WW: () => pad(this.getWeekNumber(date)),
    };

    // Build a regex that specifically matches the known format keys
    const knownKeys = Object.keys(formatters).map(key => key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')); // Escape regex special chars in keys
    // Sort keys by length descending to match longer keys first (e.g., DDDD before DD)
    knownKeys.sort((a, b) => b.length - a.length);
    const formatRegex = new RegExp(`(${knownKeys.join('|')})`, 'g');

    // Replace only the known keys
    return format.replace(formatRegex, (match) => {
        // The matched key is the first capturing group (the whole match in this case)
        const formatter = formatters[match];
        // If a formatter exists for the key, call it, otherwise return the original match (shouldn't happen with this regex)
        return formatter ? formatter() : match;
    });
  }

  private getWeekNumber(date: Date): number {
    const d = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()),
    );
    // Set to nearest Thursday: current date + 4 - current day number
    // Make Sunday's day number 7
    d.setUTCDate(d.getUTCDate() + 4 - (d.getUTCDay() || 7));
    // Get first day of year
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    // Calculate full weeks to nearest Thursday
    const weekNo = Math.ceil(
      ((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
    );
    // Return week number
    return weekNo;
  }


  private generateRandomId(): string {
    return crypto.randomBytes(4).toString("hex");
  }
}

