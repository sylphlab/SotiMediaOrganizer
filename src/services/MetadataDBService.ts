import Database, { Database as DB } from "better-sqlite3";
import { FileInfo } from "../types"; // Removed unused FileStats, Metadata, MediaInfo
import { AppResult, ok, DatabaseError, safeTry } from "../errors"; // Removed unused err
import { bufferToSharedArrayBuffer } from "../utils"; // Import buffer utility
import { join } from "path";
import { mkdirSync } from "fs";

// Define the structure of the data stored in the DB
// This might evolve as we refactor further
export interface FileInfoRow {
  filePath: string; // Primary Key
  contentHash?: string | null; // From FileStats (hex)
  size?: number | null; // From FileStats
  createdAt?: number | null; // Store as Unix timestamp (milliseconds)
  modifiedAt?: number | null; // Store as Unix timestamp (milliseconds)
  imageWidth?: number | null; // From Metadata
  imageHeight?: number | null; // From Metadata
  gpsLatitude?: number | null; // From Metadata
  gpsLongitude?: number | null; // From Metadata
  cameraModel?: string | null; // From Metadata
  imageDate?: number | null; // Store as Unix timestamp (milliseconds)
  mediaDuration?: number | null; // From MediaInfo
  pHash?: string | null; // Perceptual hash (hex) - Assuming single hash for now
  // LSH Keys (4 bands of 16 bits from pHash)
  lshKey1?: string | null;
  lshKey2?: string | null;
  lshKey3?: string | null;
  lshKey4?: string | null;
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
                pHash TEXT,
                lshKey1 TEXT,
                lshKey2 TEXT,
                lshKey3 TEXT,
                lshKey4 TEXT
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
    // Add indexes for LSH keys
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_files_lshKey1 ON files (lshKey1);`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_files_lshKey2 ON files (lshKey2);`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_files_lshKey3 ON files (lshKey3);`,
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_files_lshKey4 ON files (lshKey4);`,
    );
  }

  // Helper to generate LSH keys from pHash hex string
  private generateLshKeys(pHashHex: string | null): (string | null)[] {
    const keys: (string | null)[] = [null, null, null, null];
    if (pHashHex && pHashHex.length === 16) {
      // Expect 64-bit hash (16 hex chars)
      keys[0] = pHashHex.substring(0, 4);
      keys[1] = pHashHex.substring(4, 8);
      keys[2] = pHashHex.substring(8, 12);
      keys[3] = pHashHex.substring(12, 16);
    } else if (pHashHex) {
      console.warn(
        `Invalid pHash length (${pHashHex.length}) for LSH key generation: ${pHashHex}`,
      );
    }
    return keys;
  }

  // Helper to convert FileInfo to DB row format
  private fileInfoToRow(filePath: string, fileInfo: FileInfo): FileInfoRow {
    const pHashBuffer = fileInfo.media?.frames?.[0]?.hash;
    const pHashHex = pHashBuffer
      ? Buffer.from(pHashBuffer).toString("hex")
      : null;
    const lshKeys = this.generateLshKeys(pHashHex);

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
      pHash: pHashHex,
      lshKey1: lshKeys[0],
      lshKey2: lshKeys[1],
      lshKey3: lshKeys[2],
      lshKey4: lshKeys[3],
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
                cameraModel, imageDate, mediaDuration, pHash,
                lshKey1, lshKey2, lshKey3, lshKey4
            ) VALUES (
                @filePath, @contentHash, @size, @createdAt, @modifiedAt,
                @imageWidth, @imageHeight, @gpsLatitude, @gpsLongitude,
                @cameraModel, @imageDate, @mediaDuration, @pHash,
                @lshKey1, @lshKey2, @lshKey3, @lshKey4
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
                pHash = excluded.pHash,
                lshKey1 = excluded.lshKey1,
                lshKey2 = excluded.lshKey2,
                lshKey3 = excluded.lshKey3,
                lshKey4 = excluded.lshKey4;
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

  /**
   * Finds potential similar files based on matching LSH keys.
   * @param filePath The path of the file to exclude from results.
   * @param lshKeys The LSH keys generated for the file's pHash.
   * @returns An AppResult containing an array of file paths for potential neighbors.
   */
  public findSimilarCandidates(
    filePath: string,
    lshKeys: (string | null)[],
  ): AppResult<string[]> {
    const validKeys = lshKeys.filter((key) => key !== null) as string[];
    if (validKeys.length === 0) {
      return ok([]); // No valid keys to search with
    }

    const placeholders = validKeys.map(() => "?").join(", ");
    const whereClauses = [
      validKeys.length > 0 ? `lshKey1 IN (${placeholders})` : null,
      validKeys.length > 0 ? `lshKey2 IN (${placeholders})` : null,
      validKeys.length > 0 ? `lshKey3 IN (${placeholders})` : null,
      validKeys.length > 0 ? `lshKey4 IN (${placeholders})` : null,
    ].filter((clause) => clause !== null); // Filter out null clauses if a key is null

    if (whereClauses.length === 0) {
      return ok([]); // Should not happen if validKeys check passed, but safety check
    }

    const sql = `
          SELECT filePath
          FROM files
          WHERE (${whereClauses.join(" OR ")})
            AND filePath != ?
      `;

    const params = [
      ...validKeys,
      ...validKeys,
      ...validKeys,
      ...validKeys,
      filePath,
    ]; // Repeat keys for each IN clause, add filePath exclusion

    const stmt = this.db.prepare(sql);
    return safeTry(
      () => {
        const rows = stmt.all(...params) as { filePath: string }[];
        return rows.map((row) => row.filePath);
      },
      (e) =>
        new DatabaseError(
          `Failed to find similar candidates for ${filePath}: ${e instanceof Error ? e.message : String(e)}`,
          {
            originalError: e instanceof Error ? e : undefined,
            operation: "findSimilar",
          },
        ),
    );
  }

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
