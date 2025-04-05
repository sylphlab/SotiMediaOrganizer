import { quickSelect, createDCTConstants, computeFastDCT, computeHashFromDCT } from "../utils"; // Import utility functions

// Removed duplicate import
export class PerceptualHashWorker {
  private readonly HASH_SIZE = 8;
  // Removed scale property
  private readonly dctCoefficients: Float32Array;
  private readonly normFactors: Float32Array;

  constructor(private readonly resolution: number) {
    // Call createDCTConstants and assign results
    const { dctCoefficients, normFactors } = createDCTConstants(resolution, this.HASH_SIZE);
    this.dctCoefficients = dctCoefficients;
    this.normFactors = normFactors;
  }

  // Removed initializeConstants method
  computePerceptualHash(imageBuffer: Uint8Array): Uint8Array {
    const size = this.resolution;
    const hashSize = this.HASH_SIZE;

    // Compute DCT using the utility function
    const dct = computeFastDCT(imageBuffer, size, hashSize, { dctCoefficients: this.dctCoefficients, normFactors: this.normFactors });

    // Compute hash from DCT using the utility function
    const hash = computeHashFromDCT(dct, hashSize);

    return hash;
  }

} // Removed fastDCT and computeMedianAC methods
