<!-- Version: 0.3 | Last Updated: 2025-06-04 | Updated By: Cline -->

# Product Context

- **Problem Solved:** Addresses the challenge of managing large, cluttered digital photo and video libraries by providing automated organization and deduplication.
- **Target Users:** Individuals with growing digital media collections, from casual users to photographers/videographers needing efficient organization.
- **Core Functionality:** A command-line tool (`media-curator`) that takes source directories and a destination path. It processes media files, extracts metadata, calculates perceptual hashes, compares files for similarity using VP Trees and DTW, and organizes unique files into the destination directory based on a customizable format string. Duplicates can be optionally moved to a separate directory.
- **User Experience Goals:** Provide a powerful, flexible, and efficient command-line experience. Offer clear feedback during processing and comprehensive configuration options.
