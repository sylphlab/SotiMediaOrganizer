import {
  createDCTConstants,
  computeFastDCT,
  computeHashFromDCT,
} from '../utils'; // Removed unused quickSelect
import { AppResult, ok, err } from '../errors'; // Import AppResult types

// Removed duplicate import
export class PerceptualHashWorker {
  private readonly HASH_SIZE = 8;
  // Removed scale property
  private readonly dctCoefficients: Float32Array;
  private readonly normFactors: Float32Array;

  constructor(private readonly resolution: number) {
    // Call createDCTConstants and assign results
    const { dctCoefficients, normFactors } = createDCTConstants(
      resolution,
      this.HASH_SIZE,
    );
    this.dctCoefficients = dctCoefficients;
    this.normFactors = normFactors;
  }

  // Removed initializeConstants method
  computePerceptualHash(imageBuffer: Uint8Array): AppResult<Uint8Array> {
    // Update return type
    const size = this.resolution;
    const hashSize = this.HASH_SIZE;

    // Compute DCT using the utility function
    // Compute DCT using the utility function, handle AppResult
    const dctResult = computeFastDCT(imageBuffer, size, hashSize, {
      dctCoefficients: this.dctCoefficients,
      normFactors: this.normFactors,
    });
    if (dctResult.isErr()) {
      return err(dctResult.error); // Propagate error
    }
    const dct = dctResult.value; // Unwrap

    // Compute hash from DCT using the utility function, handle AppResult
    const hashResult = computeHashFromDCT(dct, hashSize);
    if (hashResult.isErr()) {
      return err(hashResult.error); // Propagate error
    }
    const hash = hashResult.value; // Unwrap

    return ok(hash); // Return Ok result
  }
} // Removed fastDCT and computeMedianAC methods
