import Database, { Database as DB } from "better-sqlite3";
import { FileInfo } from "../types"; // Removed unused FileStats, Metadata, MediaInfo
import { AppResult, ok, DatabaseError, safeTry } from "../errors"; // Removed unused err
import { bufferToSharedArrayBuffer } from "../utils"; // Import buffer utility
import { join } from "path";
import { mkdirSync } from "fs";

// Define the structure of the data stored in the DB
// This might evolve as we refactor further
export interface FileInfoRow {
  // Add export
  filePath: string; // Primary Key
  contentHash: string | null; // From FileStats (hex)
  size: number | null; // From FileStats
  createdAt: number | null; // Store as Unix timestamp (milliseconds)
  modifiedAt: number | null; // Store as Unix timestamp (milliseconds)
  imageWidth: number | null; // From Metadata
  imageHeight: number | null; // From Metadata
  gpsLatitude: number | null; // From Metadata
  gpsLongitude: number | null; // From Metadata
  cameraModel: string | null; // From Metadata
  imageDate: number | null; // Store as Unix timestamp (milliseconds)
  mediaDuration: number | null; // From MediaInfo
  pHash: string | null; // Perceptual hash (hex) - Assuming single hash for now
  // Add other relevant fields as needed, e.g., specific frame hashes, features
}

export class MetadataDBService {
  private db: DB;
  private dbPath: string;

  constructor(
    dbDirectory: string = ".mediadb",
    dbFilename: string = "metadata.sqlite",
  ) {
    // Ensure the directory exists
    try {
      mkdirSync(dbDirectory, { recursive: true });
    } catch (e) {
      // Ignore error if directory already exists, throw otherwise
      if (e.code !== "EEXIST") {
        throw new DatabaseError(
          `Failed to create database directory: ${e.message}`,
          { originalError: e },
        );
      }
    }

    this.dbPath = join(dbDirectory, dbFilename);
    try {
      this.db = new Database(this.dbPath);
      this.initSchema();
      console.log(`SQLite metadata database opened at: ${this.dbPath}`);
    } catch (error) {
      console.error(
        `Failed to open or initialize SQLite database at ${this.dbPath}:`,
        error,
      );
      throw new DatabaseError(
        `Failed to initialize SQLite metadata DB: ${error.message}`,
        { originalError: error },
      );
    }
  }

  private initSchema(): void {
    // Use PRAGMA journal_mode=WAL for better concurrency
    this.db.pragma("journal_mode = WAL");

    // Create the main table for file information
    this.db.exec(`
            CREATE TABLE IF NOT EXISTS files (
                filePath TEXT PRIMARY KEY NOT NULL,
                contentHash TEXT,
                size INTEGER,
                createdAt INTEGER,
                modifiedAt INTEGER,
                imageWidth INTEGER,
                imageHeight INTEGER,
                gpsLatitude REAL,
                gpsLongitude REAL,
                cameraModel TEXT,
                imageDate INTEGER,
                mediaDuration REAL,
                pHash TEXT
            );
        `);

    // Create indexes for potentially queried columns
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_files_contentHash ON files (contentHash);`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_files_pHash ON files (pHash);`,
    );
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_files_size ON files (size);`);
    // Add more indexes as needed based on query patterns
  }

  // Helper to convert FileInfo to DB row format
  private fileInfoToRow(filePath: string, fileInfo: FileInfo): FileInfoRow {
    // TODO: Handle potential missing pHash if MediaInfo structure changes
    const pHashBuffer = fileInfo.media?.frames?.[0]?.hash; // Assuming pHash is the first frame's hash for now
    return {
      filePath: filePath,
      contentHash: fileInfo.fileStats?.hash
        ? Buffer.from(fileInfo.fileStats.hash).toString("hex")
        : null,
      size: fileInfo.fileStats?.size ?? null,
      createdAt: fileInfo.fileStats?.createdAt?.getTime() ?? null,
      modifiedAt: fileInfo.fileStats?.modifiedAt?.getTime() ?? null,
      imageWidth: fileInfo.metadata?.width ?? null,
      imageHeight: fileInfo.metadata?.height ?? null,
      gpsLatitude: fileInfo.metadata?.gpsLatitude ?? null,
      gpsLongitude: fileInfo.metadata?.gpsLongitude ?? null,
      cameraModel: fileInfo.metadata?.cameraModel ?? null,
      imageDate: fileInfo.metadata?.imageDate?.getTime() ?? null,
      mediaDuration: fileInfo.media?.duration ?? null,
      pHash: pHashBuffer ? Buffer.from(pHashBuffer).toString("hex") : null,
    };
  }

  // Helper to convert DB row format back to FileInfo (partial reconstruction)
  // Note: Reconstructing full MediaInfo (all frames) might require a separate table or different storage strategy
  private rowToFileInfo(row: FileInfoRow): Partial<FileInfo> {
    const pHashBuffer = row.pHash ? Buffer.from(row.pHash, "hex") : undefined;
    // Basic reconstruction - MediaInfo is simplified
    const partialFileInfo: Partial<FileInfo> = {
      fileStats: row.contentHash
        ? {
            hash: bufferToSharedArrayBuffer(
              Buffer.from(row.contentHash, "hex"),
            ), // Convert hex -> Buffer -> SharedArrayBuffer
            size: row.size ?? 0,
            createdAt: row.createdAt ? new Date(row.createdAt) : new Date(0),
            modifiedAt: row.modifiedAt ? new Date(row.modifiedAt) : new Date(0),
          }
        : undefined,
      metadata: {
        width: row.imageWidth ?? 0,
        height: row.imageHeight ?? 0,
        gpsLatitude: row.gpsLatitude ?? undefined,
        gpsLongitude: row.gpsLongitude ?? undefined,
        cameraModel: row.cameraModel ?? undefined,
        imageDate: row.imageDate ? new Date(row.imageDate) : undefined,
      },
      media: {
        duration: row.mediaDuration ?? 0,
        // Only reconstructing the primary pHash for now
        frames: pHashBuffer
          ? [{ hash: bufferToSharedArrayBuffer(pHashBuffer), timestamp: 0 }]
          : [], // Convert Buffer -> SharedArrayBuffer
      },
    };
    return partialFileInfo;
  }

  // --- Public API Methods ---

  /**
   * Inserts or updates file information in the database.
   */
  public upsertFileInfo(filePath: string, fileInfo: FileInfo): AppResult<void> {
    const row = this.fileInfoToRow(filePath, fileInfo);
    const stmt = this.db.prepare(`
            INSERT INTO files (
                filePath, contentHash, size, createdAt, modifiedAt,
                imageWidth, imageHeight, gpsLatitude, gpsLongitude,
                cameraModel, imageDate, mediaDuration, pHash
            ) VALUES (
                @filePath, @contentHash, @size, @createdAt, @modifiedAt,
                @imageWidth, @imageHeight, @gpsLatitude, @gpsLongitude,
                @cameraModel, @imageDate, @mediaDuration, @pHash
            )
            ON CONFLICT(filePath) DO UPDATE SET
                contentHash = excluded.contentHash,
                size = excluded.size,
                createdAt = excluded.createdAt,
                modifiedAt = excluded.modifiedAt,
                imageWidth = excluded.imageWidth,
                imageHeight = excluded.imageHeight,
                gpsLatitude = excluded.gpsLatitude,
                gpsLongitude = excluded.gpsLongitude,
                cameraModel = excluded.cameraModel,
                imageDate = excluded.imageDate,
                mediaDuration = excluded.mediaDuration,
                pHash = excluded.pHash;
        `);

    return safeTry(
      () => {
        stmt.run(row);
      },
      (e) =>
        new DatabaseError(
          `Failed to upsert FileInfo for ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
          {
            originalError: e instanceof Error ? e : undefined,
            operation: "upsert",
          },
        ),
    );
  }

  /**
   * Retrieves partial FileInfo from the database.
   * Note: Full MediaInfo (all frames) is not reconstructed here.
   */
  public getFileInfo(filePath: string): AppResult<Partial<FileInfo> | null> {
    const stmt = this.db.prepare("SELECT * FROM files WHERE filePath = ?");
    return safeTry(
      () => {
        const row = stmt.get(filePath) as FileInfoRow | undefined;
        return row ? this.rowToFileInfo(row) : null;
      },
      (e) =>
        new DatabaseError(
          `Failed to get FileInfo for ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
          {
            originalError: e instanceof Error ? e : undefined,
            operation: "get",
          },
        ),
    );
  }

  /**
   * Retrieves multiple FileInfo entries by file paths.
   */
  public getMultipleFileInfo(
    filePaths: string[],
  ): AppResult<Map<string, Partial<FileInfo>>> {
    if (filePaths.length === 0) {
      return ok(new Map());
    }
    const placeholders = filePaths.map(() => "?").join(",");
    const stmt = this.db.prepare(
      `SELECT * FROM files WHERE filePath IN (${placeholders})`,
    );

    return safeTry(
      () => {
        const rows = stmt.all(...filePaths) as FileInfoRow[];
        const resultMap = new Map<string, Partial<FileInfo>>();
        for (const row of rows) {
          resultMap.set(row.filePath, this.rowToFileInfo(row));
        }
        return resultMap;
      },
      (e) =>
        new DatabaseError(
          `Failed to get multiple FileInfo entries: ${e instanceof Error ? e.message : String(e)}`,
          {
            originalError: e instanceof Error ? e : undefined,
            operation: "getMultiple",
          },
        ),
    );
  }

  // TODO: Add methods for querying based on hashes (contentHash, pHash) for deduplication
  // Example:
  // public findByPHash(pHash: string): AppResult<FileInfoRow[]> { ... }
  // public findByContentHash(contentHash: string): AppResult<FileInfoRow[]> { ... }

  /**
   * Finds file entries with an exact matching perceptual hash.
   */
  public findByExactPHash(pHashHex: string): AppResult<FileInfoRow[]> {
    const stmt = this.db.prepare("SELECT * FROM files WHERE pHash = ?");
    return safeTry(
      () => {
        return stmt.all(pHashHex) as FileInfoRow[];
      },
      (e) =>
        new DatabaseError(
          `Failed to find by pHash ${pHashHex}: ${e instanceof Error ? e.message : String(e)}`,
          {
            originalError: e instanceof Error ? e : undefined,
            operation: "findByPHash",
          },
        ),
    );
  }

  // TODO: Implement efficient *similar* pHash searching (Hamming distance <= d).
  // This might require schema changes (e.g., storing hash components) or LSH.
  // For now, neighbor finding logic outside the DB will need to handle similarity checks.

  /**
   * Closes the database connection.
   */
  public close(): AppResult<void> {
    return safeTry(
      () => {
        if (this.db && this.db.open) {
          this.db.close();
          console.log(`SQLite metadata database closed: ${this.dbPath}`);
        }
      },
      (e) =>
        new DatabaseError(
          `Failed to close SQLite DB: ${e instanceof Error ? e.message : String(e)}`,
          {
            originalError: e instanceof Error ? e : undefined,
            operation: "close",
          },
        ),
    );
  }
}
