import { Result, ok as importedOk, err as importedErr } from "neverthrow";

// Re-export ok and err for consistent usage within the project
export const ok = importedOk;
export const err = importedErr;

// Base application error class
export class AppError extends Error {
  public readonly context?: unknown; // Optional context for richer error details

  constructor(message: string, context?: unknown) {
    super(message);
    this.name = this.constructor.name; // Set the name to the specific error class
    this.context = context;
    // Ensure the stack trace is captured correctly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Specific error types
export class FileSystemError extends AppError {
  constructor(
    message: string,
    context?: { path?: string; operation?: string; originalError?: Error },
  ) {
    super(message, context);
  }
}

export class ExternalToolError extends AppError {
  constructor(
    message: string,
    context?: {
      tool?: string;
      command?: string;
      exitCode?: number | null;
      stderr?: string;
      originalError?: Error;
    },
  ) {
    super(message, context);
  }
}

export class DatabaseError extends AppError {
  constructor(
    message: string,
    context?: { operation?: string; key?: string; originalError?: Error },
  ) {
    super(message, context);
  }
}

export class HashingError extends AppError {
  constructor(
    message: string,
    context?: { algorithm?: string; filePath?: string; originalError?: Error },
  ) {
    super(message, context);
  }
}

export class ConfigurationError extends AppError {
  constructor(
    message: string,
    context?: { setting?: string; value?: unknown },
  ) {
    super(message, context);
  }
}

export class ValidationError extends AppError {
  constructor(message: string, context?: { validationDetails?: unknown }) {
    super(message, context);
  }
}

export class UnknownError extends AppError {
  constructor(originalError: unknown) {
    const message =
      originalError instanceof Error
        ? originalError.message
        : "An unknown error occurred";
    super(message, { originalError });
  }
}

// Union type of all specific application errors
export type AnyAppError =
  | FileSystemError
  | ExternalToolError
  | DatabaseError
  | HashingError
  | ConfigurationError
  | ValidationError
  | UnknownError
  | AppError; // Include base AppError for general cases

// Standard Result type alias for the application
export type AppResult<T> = Result<T, AnyAppError>;

// Helper function to wrap potentially throwing operations
export function safeTry<T>(
  fn: () => T,
  errorContext?: string | ((err: unknown) => AnyAppError),
): AppResult<T> {
  try {
    return ok(fn());
  } catch (caughtError) { // Renamed variable
    let appError: AnyAppError;
    if (typeof errorContext === "function") {
      appError = errorContext(caughtError); // Use renamed variable
    } else {
      const message = errorContext
        ? `${errorContext}: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}` // Use renamed variable
        : `Operation failed: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`; // Use renamed variable
      appError = new AppError(message, { originalError: caughtError }); // Use renamed variable
    }
    return err(appError); // Use the imported err function
  }
}

// Helper for async operations
export async function safeTryAsync<T>(
  promise: Promise<T>,
  errorContext?: string | ((err: unknown) => AnyAppError),
): Promise<AppResult<T>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (caughtError) { // Rename the caught error variable
    let appError: AnyAppError;
    if (typeof errorContext === "function") {
      appError = errorContext(caughtError); // Use the renamed variable
    } else {
      const message = errorContext
        ? `${errorContext}: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}` // Use the renamed variable
        : `Async operation failed: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`; // Use the renamed variable
      // Attempt to create a more specific error if possible, otherwise use base AppError
      if (caughtError instanceof Error && caughtError.message.includes("ENOENT")) { // Use the renamed variable
        // Example: File not found
        appError = new FileSystemError(message, {
          originalError: caughtError, // Use the renamed variable
          operation: "async operation",
        });
      } else {
        appError = new AppError(message, { originalError: caughtError }); // Use the renamed variable
      }
    }
    return err(appError); // Use the exported err function (line 5)
  }
}
