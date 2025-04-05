import "reflect-metadata";

// Removed unused imports: MediaComparator, WorkerData, FileInfo, LmdbCache, ExifTool, processSingleFile
// Removed unused import: FileProcessorConfig
// Removed unused import: VPNode
import workerpool from "workerpool";
import { PerceptualHashWorker } from "./perceptualHashWorker";

// Define a new WorkerData type specific to DBSCAN, including necessary dependencies
// Removed unused interface DBSCANWorkerData


async function performDBSCAN(
  // Removed unused parameter placeholder
  // chunk: string[], // Removed unused variable
): Promise<Set<string>[]> {
  // const { root } = workerData; // Removed unused variable
  // TODO: Recreate distance function without relying on MediaProcessor/processSingleFile directly here.
  // This likely requires refactoring how VPTree search and distance are handled in the worker context.
  // For now, placeholder distance function.
   // Removed unused variable: distanceFn
   // const distanceFn = async (a: string, b: string): Promise<number> => {
   //     console.warn("Worker distance function needs proper implementation!");
   //     // Placeholder: return a constant or simple calculation not needing FileInfo
   //     return Math.abs(a.length - b.length) / Math.max(a.length, b.length); // Example placeholder
   // };


  // TODO: Refactor MediaComparator.workerDBSCAN to accept dependencies instead of using 'this'.
  // We need to instantiate or call a functional equivalent here.
  // Placeholder call - this will fail until MediaComparator is refactored.
  console.warn("Calling placeholder for workerDBSCAN - MediaComparator needs refactoring.");
  // Example placeholder structure:
  // const comparatorLogic = new MediaComparatorWorkerLogic(similarityConfig, wasmExports); // Hypothetical refactored logic class/functions
  // return await comparatorLogic.runDbscan(chunk, vpTree);
  return []; // Return empty array as placeholder
}

const perceptualHashWorkerMapper: Map<number, PerceptualHashWorker> = new Map();
function computePerceptualHash(
  imageBuffer: Uint8Array,
  resolution: number,
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
  performDBSCAN,
  computePerceptualHash,
};

// Infer and export the worker type
export type CustomWorker = typeof worker;

// Expose the worker function
workerpool.worker(worker);
