import { VPNode } from "../VPTree";
import { AppResult } from "./errors"; // Import AppResult

// Removed redundant error interface definitions (using classes from src/errors.ts instead)

export enum FileType {
  Video,
  Image,
}

export interface ProcessingConfig {
  resolution: number;
  framesPerSecond: number;
  maxFrames: number;
}

export class FileStatsConfig {
  maxChunkSize: number;
}

export interface FileInfo {
  media: MediaInfo;
  // features: Buffer[];
  fileStats: FileStats;
  metadata: Metadata;
}

export interface PathEntry {
  hash: string;
  fileDate: Date;
}

export interface GatherFileInfoResult {
  validFiles: string[];
  errorFiles: string[];
}

export interface DeduplicationResult<T = string> {
  uniqueFiles: Set<T>;
  duplicateSets: DuplicateSet<T>[];
}

export interface DuplicateSet<T = string> {
  bestFile: T;
  representatives: Set<T>;
  duplicates: Set<T>;
}

export interface Stats {
  withGeoCount: number;
  withImageDateCount: number;
  withCameraCount: number;
  errorCount: number;
}

export class ProgramOptions {
  error?: string;
  duplicate?: string;
  debug?: string;
  concurrency: number;
  move: boolean;
  resolution: number;
  format: string;
  windowSize: number;
  stepSize: number;
  maxChunkSize: number;

  // extraction
  minFrames: number;
  maxSceneFrames: number;
  targetFps: number;
  sceneChangeThreshold: number;

  // similarity
  imageSimilarityThreshold: number;
  imageVideoSimilarityThreshold: number;
  videoSimilarityThreshold: number;
}

export class AdaptiveExtractionConfig {
  resolution: number;
  sceneChangeThreshold: number;
  minFrames: number;
  maxSceneFrames: number;
  targetFps: number;
}

export class FeatureExtractionConfig {
  colorHistogramBins: number;
  edgeDetectionThreshold: number;
}

export class SimilarityConfig {
  windowSize: number;
  stepSize: number;
  imageSimilarityThreshold: number;
  imageVideoSimilarityThreshold: number;
  videoSimilarityThreshold: number;
}

export class JobConfig {
  adaptiveExtraction: AdaptiveExtractionConfig;
  featureExtraction: FeatureExtractionConfig;
  similarity: SimilarityConfig;
}

// Combine necessary configs for processSingleFile function
export interface FileProcessorConfig {
  fileStats: FileStatsConfig;
  adaptiveExtraction: AdaptiveExtractionConfig;
  // Metadata has no specific config other than FileStatsConfig for hash key
}

export class MediaInfo {
  frames: FrameInfo[];
  duration: number;
}

export class FrameInfo {
  hash: SharedArrayBuffer;
  // data: Buffer;
  // features: Buffer;
  timestamp: number;
}

export class Metadata {
  width: number;
  height: number;
  gpsLatitude?: number;
  gpsLongitude?: number;
  cameraModel?: string;
  imageDate?: Date;
}

export class FileStats {
  hash: SharedArrayBuffer;
  size: number;
  createdAt: Date;
  modifiedAt: Date;
}

export interface WorkerData {
  root: VPNode<string>;
  fileInfoCache: Map<string, FileInfo>;
  options: ProgramOptions;
}

export type MaybePromise<T> = T | Promise<T>;

export type FileProcessor = (file: string) => Promise<AppResult<FileInfo>>; // Updated return type

// Define the expected exports from the WASM module
export interface WasmExports {
  hammingDistanceSIMD(a: Uint8Array, b: Uint8Array): number;
  // Add other exports if needed, ensure memory is exported if using complex types
  memory: WebAssembly.Memory;
}

// Data passed to DBSCAN worker
export interface DBSCANWorkerData {
  chunk: string[];
  eps: number;
  minPts: number;
  // Option: Pass VPTree root (if using reduced tree) - Requires VPTree reconstruction in worker
  vpTreeRoot: VPNode<string> | null; // Root of the VPTree for this batch/subset
  // Pass necessary configs for distance calculation
  fileProcessorConfig: FileProcessorConfig; // Needed if processSingleFile is called indirectly
  similarityConfig: SimilarityConfig; // Needed for calculateSimilarity
  wasmExports: WasmExports | null; // Needed for hammingDistance
  // TODO: Revisit how FileInfo/distance is handled in worker context
}
