// import { injectable } from "inversify"; // Removed unused 'inject' - REMOVED INVERSIFY
import { writeFile } from "fs/promises";
import { join, relative } from "path";
import { FileInfo, DuplicateSet, FileProcessorConfig } from "../types"; // Added FileProcessorConfig
// import { MediaProcessor } from "../MediaProcessor"; // Removed old import
import { MediaComparator } from "../../MediaComparator";
import { LmdbCache } from "../caching/LmdbCache"; // Added cache import
import { ExifTool } from "exiftool-vendored"; // Added exiftool import
import { WorkerPool } from "../contexts/types"; // Removed unused Types import
import { processSingleFile } from "../fileProcessor"; // Added file processor function import
// import { inject } from "inversify"; // Added inject - REMOVED INVERSIFY
import { calculateEntryScore } from "../comparatorUtils"; // Import the utility function

// @injectable() // REMOVED INVERSIFY
export class DebugReporter {
  constructor(
    // Manually injected dependencies
    private readonly comparator: MediaComparator,
    private readonly cache: LmdbCache,
    private readonly fileProcessorConfig: FileProcessorConfig,
    private readonly exifTool: ExifTool,
    private readonly workerPool: WorkerPool,
  ) {}

  async generateHtmlReports(
    duplicateSets: DuplicateSet[],
    debugDir: string,
  ): Promise<string[]> {
    const reports = [];
    const batchSize = 1000; // Keep batching logic

    for (let i = 0; i < duplicateSets.length; i += batchSize) {
      const batch = duplicateSets.slice(i, i + batchSize);
      const reportFileName = await this.generateSingleReport(
        batch,
        i,
        debugDir,
        batchSize,
      ); // Pass batchSize
      reports.push(reportFileName);
    }
    await this.generateIndex(reports, debugDir);
    return reports;
  }

  private async generateSingleReport(
    batch: DuplicateSet[],
    startIndex: number,
    debugDir: string,
    batchSize: number, // Add batchSize parameter
  ): Promise<string> {
    const totalSets = batch.length;
    let totalRepresentatives = 0;
    let totalDuplicates = 0;

    batch.forEach((set) => {
      totalRepresentatives += set.representatives.size;
      totalDuplicates += set.duplicates.size;
    });

    const setsHtml = await Promise.all(
      Array.from(batch).map((set, index) =>
        this.generateSetSection(
          startIndex + index,
          set.representatives,
          set.duplicates,
          debugDir,
        ),
      ),
    );

    const reportContent = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>Deduplication Debug Report</title>
                <style>
                    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background-color: #f9f9f9; color: #333; }
                    h1 { color: #444; font-size: 24px; margin-bottom: 20px; text-align: center; }
                    h2 { color: #555; font-size: 20px; margin-top: 30px; }
                    .summary { text-align: center; margin-bottom: 30px; }
                    .summary p { font-size: 18px; margin: 5px 0; }
                    .set { background-color: #fff; padding: 15px; border-radius: 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1); margin-bottom: 20px; }
                    .media-row { display: flex; flex-wrap: wrap; justify-content: space-around; }
                    .media-container { text-align: center; margin-bottom: 20px; max-width: 220px; }
                    img, video { max-width: 200px; max-height: 200px; border-width: 3px; border-style: solid; border-radius: 8px; }
                    img.representative, video.representative { border-color: #007bff; } /* Blue border for representatives */
                    img.duplicate, video.duplicate { border-color: #ccc; } /* Light grey border for duplicates */
                    p { font-size: 14px; margin: 5px 0; }
                </style>
                <script>
                    document.addEventListener("DOMContentLoaded", function() {
                        let lazyVideos = [].slice.call(document.querySelectorAll("video[data-src]"));
                        if ("IntersectionObserver" in window) {
                            let lazyVideoObserver = new IntersectionObserver(function(entries, observer) {
                                entries.forEach(function(video) {
                                    if (video.isIntersecting) {
                                        let lazyVideo = video.target;
                                        lazyVideo.src = lazyVideo.dataset.src;
                                        lazyVideoObserver.unobserve(lazyVideo);
                                    }
                                });
                            });

                            lazyVideos.forEach(function(lazyVideo) {
                                lazyVideoObserver.observe(lazyVideo);
                            });
                        }
                    });
                </script>
            </head>
            <body>
                <h1>Deduplication Debug Report</h1>
                <div class="summary">
                    <p><strong>Total Duplicate Sets in this file:</strong> ${totalSets}</p>
                    <p><strong>Total Representatives in this file:</strong> ${totalRepresentatives}</p>
                    <p><strong>Total Duplicates in this file:</strong> ${totalDuplicates}</p>
                </div>
                ${setsHtml.join("\n")}
            </body>
            </html>
        `;

    const reportFileName = `debug-report-${startIndex / batchSize + 1}.html`;
    const reportPath = join(debugDir, reportFileName);
    await writeFile(reportPath, reportContent, "utf8");
    return reportFileName;
  }

  private async generateSetSection(
    setIndex: number,
    representatives: Set<string>,
    duplicates: Set<string>,
    debugDir: string,
  ) {
    const allMedia = await Promise.all([
      ...Array.from(representatives).map(async (sourcePath) => {
        // Use processSingleFile instead of processor.processFile - already done
        const infoResult = await processSingleFile(
          sourcePath,
          this.fileProcessorConfig,
          this.cache,
          this.exifTool,
          this.workerPool,
        );
        // TODO: Handle potential error from infoResult using Result type
        const info = infoResult.unwrapOr(null); // Temporary unwrap, needs proper error handling
        const score = calculateEntryScore(info!); // Use imported function
        const relativePath = this.convertToRelativePath(sourcePath, debugDir);
        return { isRepresentative: true, relativePath, info, score };
      }),
      ...Array.from(duplicates).map(async (sourcePath) => {
        // Use processSingleFile instead of processor.processFile - already done
        const infoResult = await processSingleFile(
          sourcePath,
          this.fileProcessorConfig,
          this.cache,
          this.exifTool,
          this.workerPool,
        );
        // TODO: Handle potential error from infoResult using Result type
        const info = infoResult.unwrapOr(null); // Temporary unwrap, needs proper error handling
        const score = calculateEntryScore(info!); // Use imported function
        const relativePath = this.convertToRelativePath(sourcePath, debugDir);
        return { isRepresentative: false, relativePath, info, score };
      }),
    ]);

    allMedia.sort((a, b) => b.score - a.score);

    const mediaTags = allMedia
      .map(
        ({ isRepresentative, relativePath, info, score }) => `
                <div class="media-container">
                    <a href="${relativePath}" target="_blank" title="Click to view full size">
                        ${this.generateMediaElement(relativePath, isRepresentative)}
                    </a>
                    ${info ? this.generateFileDetails(info, score) : "<p>Error processing file details</p>"}
                </div>`,
      )
      .join("\n");

    return `
            <div class="set">
                <h2>Duplicate Set ${setIndex + 1}</h2>
                <div class="media-row">
                    ${mediaTags}
                </div>
            </div>`;
  }

  private generateFileDetails(fileInfo: FileInfo, score: number): string {
    const resolution =
      fileInfo.metadata.width && fileInfo.metadata.height
        ? `${fileInfo.metadata.width}x${fileInfo.metadata.height}`
        : "Unknown";
    return `
            <p><strong style="font-size: 16px; color: #ff5722;">Score:</strong> <span style="font-size: 16px; color: #ff5722;">${score.toFixed(2)}</span></p>
            <p><strong>Size:</strong> ${this.formatFileSize(fileInfo.fileStats.size)}</p>
            ${fileInfo.metadata.width && fileInfo.metadata.height ? `<p><strong>Resolution:</strong> ${resolution}</p>` : ""}
            ${fileInfo.media.duration ? `<p><strong>Duration:</strong> ${this.formatDuration(fileInfo.media.duration)}</p>` : ""}
            ${fileInfo.metadata.imageDate ? `<p><strong>Date:</strong> ${this.formatDate(fileInfo.metadata.imageDate)}</p>` : ""}
            ${fileInfo.metadata.gpsLatitude && fileInfo.metadata.gpsLongitude ? `<p><strong>Geo-location:</strong> ${fileInfo.metadata.gpsLatitude.toFixed(2)}, ${fileInfo.metadata.gpsLongitude.toFixed(2)}</p>` : ""}
            ${fileInfo.metadata.cameraModel ? `<p><strong>Camera:</strong> ${fileInfo.metadata.cameraModel}</p>` : ""}
        `;
  }

  private convertToRelativePath(sourcePath: string, debugDir: string): string {
    const relativePath = relative(debugDir, sourcePath);
    return relativePath.replace(/\\/g, "/"); // Convert backslashes to forward slashes for web compatibility
  }

  private isVideoFile(filePath: string): boolean {
    return /\.(mp4|mov|avi|wmv|flv|mkv)$/i.test(filePath);
  }

  private generateMediaElement(
    relativePath: string,
    isRepresentative: boolean,
  ): string {
    const className = isRepresentative ? "representative" : "duplicate";
    if (this.isVideoFile(relativePath)) {
      const placeholder =
        "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
      return `
                <video class="${className}" src="${placeholder}" data-src="${relativePath}" controls muted playsinline preload="none">
                    Your browser does not support the video tag.
                </video>`;
    } else {
      return `<img src="${relativePath}" alt="${relativePath}" loading="lazy" class="${className}"/>`;
    }
  }

  private formatFileSize(size: number): string {
    return `${(size / (1024 * 1024)).toFixed(2)} MB`;
  }

  private formatDate(date?: Date): string {
    if (!date) return "Unknown";
    if (isNaN(date.getTime())) {
      console.log("Invalid Date", date);
      return "Invalid Date";
    }
    return date.toDateString();
  }

  private formatDuration(duration: number): string {
    const seconds = Math.floor(duration % 60);
    const minutes = Math.floor((duration / 60) % 60);
    const hours = Math.floor((duration / (60 * 60)) % 24);
    return `${hours ? `${hours}:` : ""}${minutes ? `${minutes}:` : ""}${seconds}s`;
  }

  private async generateIndex(reportFiles: string[], debugDir: string) {
    const indexContent = `
      <!DOCTYPE html>
      <html lang="en">
      <head>
          <meta charset="UTF-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Deduplication Report Index</title>
          <style>
              body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; background-color: #f9f9f9; color: #333; }
              h1 { color: #444; font-size: 24px; margin-bottom: 20px; text-align: center; }
              ul { list-style-type: none; padding: 0; }
              li { margin-bottom: 15px; }
              a { color: #007bff; text-decoration: none; font-size: 18px; font-weight: bold; }
              a:hover { text-decoration: underline; }
              .report-link { padding: 10px; background-color: #e0f7fa; border-radius: 5px; box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1); display: block; text-align: center; }
              .report-link:hover { background-color: #b2ebf2; }
          </style>
      </head>
      <body>
          <h1>Deduplication Report Index</h1>
          <ul>
              ${reportFiles.map((file, index) => `<li><a class="report-link" href="${file}" target="_blank">Report ${index + 1}</a></li>`).join("\n")}
          </ul>
      </body>
      </html>
  `;

    const indexPath = join(debugDir, "index.html");
    await writeFile(indexPath, indexContent, "utf8");
    // Logging moved back to MediaOrganizer or handled differently
  }
}
