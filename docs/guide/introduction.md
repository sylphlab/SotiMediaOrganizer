# What is MediaCurator?

MediaCurator (`@sotilab/smo`) is a powerful, modern command-line tool designed to bring order and efficiency to your ever-growing digital photo and video collections. If you find yourself overwhelmed by scattered files, duplicate images, and the daunting task of manually organizing thousands of media items, MediaCurator is built for you.

## The Challenge: Digital Media Chaos

In today's digital age, capturing photos and videos is easier than ever. However, managing these collections often leads to:

- **Disorganization:** Files scattered across various folders, drives, and devices with inconsistent naming conventions.
- **Redundancy:** Multiple copies of the same photo or video, perhaps slightly edited or resized, consuming valuable storage space.
- **Difficulty Finding Media:** Locating specific photos or videos becomes a time-consuming chore.
- **Scalability Issues:** Traditional manual methods simply don't scale well as collections grow into the tens or hundreds of thousands (or even millions) of files.

## The Solution: Intelligent Curation

MediaCurator tackles these challenges head-on by providing an intelligent, automated approach:

- **Automated Organization:** Instead of manual sorting, MediaCurator analyzes metadata (like the date a photo was taken, GPS coordinates, or the camera model used) and file information. It then organizes your files into a clean, logical directory structure that _you_ define using flexible format strings. Imagine all your photos automatically sorted by year, month, and location!
- **Advanced Deduplication:** MediaCurator goes far beyond simple duplicate detection. It uses sophisticated perceptual hashing (for images) and content analysis (for videos) combined with efficient Locality-Sensitive Hashing (LSH) database lookups. This allows it to identify not only exact duplicates but also visually similar images and videos, even if they have different resolutions, formats, or minor edits. You can configure the sensitivity and choose how to handle these duplicates (e.g., move them to a separate folder).
- **Performance and Scalability:** Built with modern tools like TypeScript, Bun, Sharp (libvips), FFmpeg, SQLite, and WebAssembly, MediaCurator is engineered for speed and efficiency. It leverages concurrency and optimized algorithms to process large collections much faster than manual methods. Its database-centric approach ensures it can handle millions of files without overwhelming your system's memory.
- **Flexibility and Control:** You remain in control. Customize the organization format, adjust deduplication sensitivity thresholds, choose whether to copy or move files, and utilize various other options to tailor the process to your exact needs.

## Key Benefits

- **Save Time:** Automate the tedious process of organizing and finding duplicates.
- **Reclaim Storage:** Free up significant disk space by identifying and managing redundant files.
- **Create Order:** Build a logically structured and easily navigable media library.
- **Gain Peace of Mind:** Know your precious memories are organized and duplicates are under control.

Ready to take control of your media library? Let's get started with the [Installation](./installation.md).
