import {
  getFileType,
  getFileTypeByExt,
  bufferToSharedArrayBuffer,
  sharedArrayBufferToBuffer,
  sharedArrayBufferToHex,
  hexToSharedArrayBuffer,
  filterAsync,
  mapAsync,
  SUPPORTED_EXTENSIONS,
} from "../src/utils";
import { FileType } from "../src/types";
import { Buffer } from "buffer"; // Ensure Buffer is imported

describe("Utility Functions", () => {
  describe("getFileType / getFileTypeByExt", () => {
    it("should return correct FileType for image extensions", () => {
      expect(getFileType("image.jpg")).toBe(FileType.Image);
      expect(getFileType("photo.PNG")).toBe(FileType.Image);
      expect(getFileTypeByExt("webp")).toBe(FileType.Image);
      expect(getFileTypeByExt("cr2")).toBe(FileType.Image); // Changed CR2 to cr2
    });

    it("should return correct FileType for video extensions", () => {
      expect(getFileType("video.mp4")).toBe(FileType.Video);
      expect(getFileType("clip.MOV")).toBe(FileType.Video);
      expect(getFileTypeByExt("avi")).toBe(FileType.Video);
      expect(getFileTypeByExt("webm")).toBe(FileType.Video); // Changed WEBM to webm
    });

    it("should throw error for unsupported extensions", () => {
      expect(() => getFileType("document.txt")).toThrow(
        "Unsupported file type for file txt",
      );
      expect(() => getFileTypeByExt("exe")).toThrow(
        "Unsupported file type for file exe",
      );
    });

    it("should handle paths with multiple dots", () => {
      // Wrap the function call in another function for toThrow
      expect(() => getFileType("archive.tar.gz")).toThrow("Unsupported file type for file gz");
      expect(() => getFileType("image.jpeg.backup")).toThrow("Unsupported file type for file backup");
      expect(getFileType("video.final.mp4")).toBe(FileType.Video);
    });

    it("should handle filenames without extensions", () => {
       expect(() => getFileType("myfile")).toThrow("Unsupported file type for file ");
       expect(() => getFileTypeByExt("")).toThrow("Unsupported file type for file ");
    });
  });

  describe("Buffer <-> SharedArrayBuffer Conversions", () => {
    it("should convert Buffer to SharedArrayBuffer and back", () => {
      const originalBuffer = Buffer.from("Hello World");
      const sharedBuffer = bufferToSharedArrayBuffer(originalBuffer);
      expect(sharedBuffer).toBeInstanceOf(SharedArrayBuffer);
      expect(sharedBuffer.byteLength).toBe(originalBuffer.length);

      const convertedBuffer = sharedArrayBufferToBuffer(sharedBuffer);
      expect(convertedBuffer).toBeInstanceOf(Buffer);
      expect(convertedBuffer).toEqual(originalBuffer);
      expect(convertedBuffer.toString()).toBe("Hello World");
    });
  });

  describe("SharedArrayBuffer <-> Hex Conversions", () => {
     it("should convert SharedArrayBuffer to hex string", () => {
       const buffer = Buffer.from([0xDE, 0xAD, 0xBE, 0xEF]);
       const sharedBuffer = bufferToSharedArrayBuffer(buffer);
       expect(sharedArrayBufferToHex(sharedBuffer)).toBe("deadbeef");
     });

     it("should convert hex string to SharedArrayBuffer", () => {
       const hex = "cafebabe";
       const expectedBuffer = Buffer.from([0xCA, 0xFE, 0xBA, 0xBE]);
       const sharedBuffer = hexToSharedArrayBuffer(hex);
       expect(sharedBuffer).toBeInstanceOf(SharedArrayBuffer);
       expect(sharedBuffer.byteLength).toBe(4);
       expect(sharedArrayBufferToBuffer(sharedBuffer)).toEqual(expectedBuffer);
     });

     it("should throw error for odd length hex string", () => {
       expect(() => hexToSharedArrayBuffer("abc")).toThrow(
         "Hex string must have an even number of characters",
       );
     });
  });

  describe("Async Helpers", () => {
    it("filterAsync should filter elements based on async predicate", async () => {
      const numbers = [1, 2, 3, 4, 5];
      const isEven = async (n: number) => {
        await new Promise(resolve => setTimeout(resolve, 1)); // Simulate async work
        return n % 2 === 0;
      };
      const result = await filterAsync(numbers, isEven);
      expect(result).toEqual([2, 4]);
    });

    it("mapAsync should map elements using async function", async () => {
      const numbers = [1, 2, 3];
      const doubleAsync = async (n: number) => {
        await new Promise(resolve => setTimeout(resolve, 1)); // Simulate async work
        return n * 2;
      };
      const result = await mapAsync(numbers, doubleAsync);
      expect(result).toEqual([2, 4, 6]);
    });
  });
});