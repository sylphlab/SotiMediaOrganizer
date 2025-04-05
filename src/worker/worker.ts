import "reflect-metadata";

import { MediaComparator } from "../../MediaComparator"; // Keep for now
import { WorkerData, FileProcessorConfig, FileInfo } from "../types"; // Add FileProcessorConfig, FileInfo
// import { Context } from "../contexts/Context"; // Remove DI context
// import { MediaProcessor } from "../MediaProcessor"; // Remove processor
import { LmdbCache } from "../caching/LmdbCache"; // Add dependencies
import { ExifTool } from "exiftool-vendored";
import { processSingleFile } from "../fileProcessor"; // Add processor function
import { VPTree, VPNode } from "../../VPTree"; // Add VPTree types
import workerpool from "workerpool";
import { PerceptualHashWorker } from "./perceptualHashWorker";

// Define a new WorkerData type specific to DBSCAN, including necessary dependencies
interface DBSCANWorkerData {
    root: VPNode<string>;
    options: any; // Keep options for now, refine later if specific parts needed
    config: FileProcessorConfig;
    // Note: Cannot pass LmdbCache or ExifTool instances directly to workers easily.
    // Need to rethink how FileInfo is accessed during distance calculation in worker.
    // Option A: Pre-fetch all needed FileInfo on main thread (potentially memory intensive).
    // Option B: Pass DB path/config and recreate Cache/ExifTool in worker (adds overhead).
    // Option C: Refactor distance calculation/VPTree search to not need full FileInfo in worker.

    // For now, let's assume Option C is the target, or that necessary info is embedded in VPTree/passed differently.
    // We will remove the direct dependencies for now and adjust MediaComparator.workerDBSCAN later.
    similarityConfig: any; // Pass necessary parts of SimilarityConfig
    wasmExports: any; // Pass WASM exports if needed by distance func in worker
}


async function performDBSCAN(
  workerData: DBSCANWorkerData, // Use new type
  chunk: string[],
): Promise<Set<string>[]> {
  const { root, options, config, similarityConfig, wasmExports } = workerData;

  // TODO: Recreate distance function without relying on MediaProcessor/processSingleFile directly here.
  // This likely requires refactoring how VPTree search and distance are handled in the worker context.
  // For now, placeholder distance function.
   const distanceFn = async (a: string, b: string): Promise<number> => {
       console.warn("Worker distance function needs proper implementation!");
       // Placeholder: return a constant or simple calculation not needing FileInfo
       return Math.abs(a.length - b.length) / Math.max(a.length, b.length); // Example placeholder
   };
   const vpTree = new VPTree<string>(root, distanceFn);


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
  return worker.computePerceptualHash(imageBuffer);
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
