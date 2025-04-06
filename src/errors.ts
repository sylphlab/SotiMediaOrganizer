import { Result, ok as importedOk, err as importedErr } from "neverthrow";

// Re-export ok and err for consistent usage within the project
export const ok = importedOk;
export const err = importedErr;

// Base application error class
export class AppError extends Error {
  public readonly context?: Record<string, unknown>; // Context for additional details, excluding 'cause'
  public readonly cause?: unknown; // Standard error cause property

  constructor(
    message: string,
    options?: { cause?: unknown; context?: Record<string, unknown> }
  ) {
    // Pass cause to the super constructor if provided
    super(message, options?.cause ? { cause: options.cause } : undefined);
    this.name = this.constructor.name; // Set the name to the specific error class
    this.context = options?.context; // Store additional context separately
    // this.cause = options?.cause; // Remove redundant assignment, rely on super()
    // Ensure the stack trace is captured correctly
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// Specific error types
export class FileSystemError extends AppError {
  // Modify constructors of subclasses to pass options correctly
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      context?: { path?: string; operation?: string };
    }
  ) {
    super(message, options);
  }
}

export class ExternalToolError extends AppError {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      context?: {
        tool?: string;
        command?: string;
        exitCode?: number | null;
        stderr?: string;
      };
    }
  ) {
    super(message, options);
  }
}

export class DatabaseError extends AppError {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      context?: { operation?: string; key?: string };
    }
  ) {
    super(message, options);
  }
}

export class HashingError extends AppError {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      context?: { algorithm?: string; filePath?: string };
    }
  ) {
    super(message, options);
  }
}

export class ConfigurationError extends AppError {
  constructor(
    message: string,
    options?: {
      cause?: unknown;
      context?: { setting?: string; value?: unknown };
    }
  ) {
    super(message, options);
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    options?: { cause?: unknown; context?: { validationDetails?: unknown } }
  ) {
    super(message, options);
  }
}

export class UnknownError extends AppError {
  constructor(cause: unknown) {
    // Accept cause directly
    const message =
      cause instanceof Error ? cause.message : "An unknown error occurred";
    // Pass cause to super constructor
    super(message, { cause });
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
  errorContext?: string | ((err: unknown) => AnyAppError)
): AppResult<T> {
  try {
    return ok(fn());
  } catch (caughtError) {
    // Renamed variable
    let appError: AnyAppError;
    if (typeof errorContext === "function") {
      appError = errorContext(caughtError); // Use renamed variable
    } else {
      const message = errorContext
        ? `${errorContext}: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}` // Use renamed variable
        : `Operation failed: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`; // Use renamed variable
      appError = new AppError(message, { cause: caughtError }); // Pass caughtError as cause
    }
    return err(appError); // Use the imported err function
  }
}

// Helper for async operations
export async function safeTryAsync<T>(
  promise: Promise<T>,
  errorContext?: string | ((err: unknown) => AnyAppError)
): Promise<AppResult<T>> {
  try {
    const value = await promise;
    return ok(value);
  } catch (caughtError) {
    // Rename the caught error variable
    let appError: AnyAppError;
    if (typeof errorContext === "function") {
      appError = errorContext(caughtError); // Use the renamed variable
    } else {
      const message = errorContext
        ? `${errorContext}: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}` // Use the renamed variable
        : `Async operation failed: ${caughtError instanceof Error ? caughtError.message : String(caughtError)}`; // Use the renamed variable
      // Attempt to create a more specific error if possible, otherwise use base AppError
      if (
        caughtError instanceof Error &&
        caughtError.message.includes("ENOENT")
      ) {
        // Use the renamed variable
        // Example: File not found
        // Pass caughtError as cause to FileSystemError
        appError = new FileSystemError(message, {
          cause: caughtError,
          context: { operation: "async operation" },
        });
      } else {
        appError = new AppError(message, { cause: caughtError }); // Pass caughtError as cause
      }
    }
    return err(appError); // Use the exported err function (line 5)
  }
}
