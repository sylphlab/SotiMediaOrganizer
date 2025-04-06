// Removed unused imports: FileProcessorConfig, SimilarityConfig, WasmExports, DBSCANWorkerData, MediaInfo
// Removed unused imports: VPNode, VPTree
// Removed unused imports: runDbscanCore, calculateImageSimilarity
// Removed unused imports: AppResult, ok, err, AppError (errors handled by throwing in computePerceptualHash)
// TODO: Need a way to get FileInfo for distance calculation in worker
// Option A: Pass DBService instance/config (complex)
// Option B: Pass relevant FileInfo subset via workerData (memory intensive?)
// Option C: Refactor distance to not need full FileInfo (ideal?)
import workerpool from "workerpool";
import { PerceptualHashWorker } from "./perceptualHashWorker";
// DBSCANWorkerData interface is now imported from types.ts

// Removed performDBSCAN function as DBSCAN now runs on main thread

const perceptualHashWorkerMapper: Map<number, PerceptualHashWorker> = new Map();
function computePerceptualHash(
  imageBuffer: Uint8Array,
  resolution: number
): Uint8Array {
  let worker = perceptualHashWorkerMapper.get(resolution);
  if (!worker) {
    worker = new PerceptualHashWorker(resolution);
    perceptualHashWorkerMapper.set(resolution, worker);
  }
  // Handle AppResult from computePerceptualHash
  const result = worker.computePerceptualHash(imageBuffer);
  if (result.isErr()) {
    // Decide how to handle worker errors - throw? log? return specific value?
    // Throwing for now, as this indicates a failure within the worker itself.
    console.error("Error computing perceptual hash in worker:", result.error);
    throw result.error; // Or convert to a standard Error
  }
  return result.value; // Return unwrapped value
}

// Define the worker object with all functions
const worker = {
  // performDBSCAN, // Removed from worker exports
  computePerceptualHash,
};

// Infer and export the worker type
export type CustomWorker = typeof worker;

// Expose the worker function
workerpool.worker(worker);
