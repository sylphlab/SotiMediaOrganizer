<!-- Version: 2.3 | Last Updated: 2025-04-05 | Updated By: Cline -->

# Active Context

- **Current Focus:** Planning major architectural refactoring based on user request.
- **Recent Changes:**
  - Completed initial functional refactoring task.
  - Added Jest and configured it.
  - Created and successfully ran unit tests for `src/utils.ts` and most helper functions in `src/comparatorUtils.ts` (popcount, hammingDistance JS fallback, calculateImageSimilarity, calculateEntryScore, getAdaptiveThreshold, getQuality, sortEntriesByScore).
  - Testing paused based on user request for larger refactoring.
- **Next Steps:** Initiate a new task (likely in Architect mode) to:
    - Analyze the feasibility and plan the implementation of a major refactoring towards a more functional style.
    - Evaluate alternative DI approaches (e.g., Riverpod-like patterns) or removing DI.
    - Consider UI improvements, potentially including a Web UI.
    - Ensure the architecture supports scaling to millions of media files.
    - Re-evaluate testing strategy after refactoring.
- **Open Questions/Decisions:**
    - Optimal DI strategy (Inversify, Riverpod-like, none)?
    - Feasibility and approach for a Web UI?
    - Specific FP patterns to adopt?
    - Best way to ensure scalability for millions of files (data handling, processing, caching)?
    - How to address persistent mocking issues in `bun test`?
