# Deduplication Strategy

MediaCurator employs advanced techniques to identify and handle duplicate or visually similar media files, helping you reclaim storage space and reduce clutter in your library.

## How it Works: Beyond Simple Checks

MediaCurator's deduplication goes beyond basic filename or checksum comparisons. Here's the process:

1.  **Metadata Extraction & Hashing:** For each media file, MediaCurator extracts key metadata and calculates perceptual hashes. These hashes represent the visual content of the file (pHash for images, derived from frame analysis for videos).
2.  **Database Storage:** This extracted information, including file paths, metadata, and perceptual hashes, is stored efficiently in an SQLite database.
3.  **Efficient Candidate Search (LSH):** Comparing every file to every other file is infeasible for large collections. MediaCurator uses Locality-Sensitive Hashing (LSH), a technique that groups potentially similar items into 'buckets' based on their hashes. This allows for a rapid search for potential duplicate _candidates_ without comparing everything.
4.  **Candidate Retrieval:** For a given file, MediaCurator queries the database using LSH to quickly retrieve only the set of potential candidates that are likely to be similar.
5.  **Precise Comparison:** Only these retrieved candidates are then compared more precisely against the original file using appropriate similarity metrics (e.g., Hamming distance for image pHashes, specialized comparison logic for video hashes).
6.  **Duplicate Identification:** Files whose similarity score exceeds the configured threshold are identified as duplicates of the original file.

## Configuration Options

You have several command-line options to control the deduplication process:

- `-d, --duplicate <path>`: **Crucial for managing duplicates.** Specifies a directory where identified duplicate files should be moved. If this option is _not_ provided, duplicates are identified internally but are **not moved or deleted** – they are simply ignored during the transfer phase (unless `--move` is also used, see below).
- `--debug <path>`: **Highly recommended for review.** Saves detailed reports (usually text files) about the duplicate sets found to the specified directory. Each report lists the files considered duplicates of each other. Reviewing these reports _before_ using `-d` or `--move` is strongly advised.
- `-m, --move`: Changes the file transfer behavior from copying to moving.
  - **Without `-d`:** Unique files are moved to the destination, duplicates are left untouched in the source (effectively deleting the unique file from the source). **Use with caution.**
  - **With `-d`:** Unique files are moved to the destination, and _all_ identified duplicates are moved to the `--duplicate` directory. This is the common way to isolate duplicates while organizing the unique files.
- `-r, --resolution <number>`: Controls the resolution (granularity) of the image perceptual hash (default: 64). Higher values (e.g., 128) might increase sensitivity to subtle differences but also increase processing time.
- `--image-similarity-threshold <number>`: Sets the similarity threshold (0.0 to 1.0) for considering two images duplicates based on their pHash distance (default: 0.99). A lower value means _more_ sensitive (finds more potential duplicates, including visually similar ones).
- `--video-similarity-threshold <number>`: Sets the similarity threshold (0.0 to 1.0) for considering two videos duplicates (default: 0.93). Lower values mean _more_ sensitive.
- `--image-video-similarity-threshold <number>`: Sets the threshold for comparing images to videos (default: 0.93).

_(Note: Video-specific options like `--target-fps`, `--window-size`, etc., also influence the video hashing process and thus affect video deduplication.)_

## Choosing Thresholds & Workflow Recommendation

Selecting the right similarity threshold depends on your goal:

- **High Thresholds (e.g., 0.98-0.99 for images):** Less sensitive. Primarily finds exact or near-exact duplicates (e.g., same file saved twice). This is safer and has a lower risk of flagging files you consider distinct.
- **Lower Thresholds (e.g., 0.90-0.95 for images):** More sensitive. Can identify visually similar items like resized images, slightly different video encodes, or pictures taken in quick succession. More effective at finding variations but carries a higher risk of grouping files you might prefer to keep separate.

**Recommended Workflow:**

1.  **Initial Run with `--debug`:** Perform a run using your desired organization format and estimated thresholds, but **only use the `--debug <path>` option**. Do _not_ use `-d` or `--move` yet.
    ```bash
    smo <source...> <destination> --format "..." --image-similarity-threshold 0.95 --debug /path/to/debug/reports
    ```
2.  **Review Debug Reports:** Carefully examine the reports generated in the debug directory. Check if the grouped files are indeed duplicates according to your criteria. Adjust thresholds if necessary based on the results.
3.  **Execute with `-d` and/or `--move`:** Once you are confident with the settings and the potential duplicate groupings, perform the run again, this time adding the `-d <duplicate_path>` option (and potentially `--move` if desired) to actually separate the duplicates and organize the unique files.
    ```bash
    # Example: Move unique files, move duplicates to separate folder
    smo <source...> <destination> --format "..." --image-similarity-threshold 0.95 -d /path/to/duplicates --move
    ```

This cautious approach ensures you don't accidentally move or misclassify files before verifying the results.
