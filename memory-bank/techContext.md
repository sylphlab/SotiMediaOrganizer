<!-- Version: 0.2 | Last Updated: 2025-04-05 | Updated By: Cline -->

# Technical Context

*   **Primary Language(s):** TypeScript, AssemblyScript (for WASM components)
*   **Frameworks/Libraries:** 
    *   Runtime: Node.js, Bun
    *   Core Processing: Sharp (image manipulation), Fluent-FFmpeg (video processing), exiftool-vendored (metadata)
    *   Data Storage: LMDB (caching/state)
    *   Architecture: Inversify (DI), Workerpool (concurrency)
    *   CLI: Commander (argument parsing), cli-progress, @topcli/spinner, chalk (UI)
    *   Utilities: @msgpack/msgpack, deep-eql, async-mutex
*   **Databases:** LMDB (embedded key-value store for caching)
*   **External Services/APIs:** Relies on external tools FFmpeg and ExifTool (via `exiftool-vendored`). Requires libvips (via `sharp`).
*   **Development Environment:** Node.js (>=14), Bun (>=0.5), TypeScript (>=5). Uses Prettier for formatting and ESLint for linting. Husky for pre-commit hooks.
*   **Build/Deployment:** Built using `bun build`. Compiles TypeScript to JavaScript (`dist/`) and AssemblyScript to WASM (`dist/index.wasm`). Published as an npm package (`@sotilab/smo`) intended for global installation (`bun install --global`).
*   **Technical Constraints:** Performance is critical, requiring optimization techniques like WASM and concurrency. Cross-platform compatibility (Windows/Ubuntu mentioned) is a goal. Format support depends on underlying libraries (FFmpeg, libvips) which might need custom compilation for specialized formats.