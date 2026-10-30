export type ErrorClass =
  | 'VALIDATION'
  | 'AI_OUTPUT_INVALID'
  | 'AUTH'
  | 'RATE_LIMIT'
  | 'TRANSIENT_NETWORK'
  | 'EXTERNAL_5XX'
  | 'UI_CHANGED'
  | 'SECURITY_CHALLENGE'
  | 'AMBIGUOUS_RESULT'
  | 'DISK'
  | 'RESOURCE_BUSY'
  | 'CANCELLED'
  | 'UNKNOWN';

export interface AppErrorOptions {
  retryAfterMs?: number;
  cause?: unknown;
}

export class AppError extends Error {
  constructor(
    readonly errorClass: ErrorClass,
    message: string,
    readonly options: AppErrorOptions = {}
  ) {
    super(message);
    this.name = 'AppError';
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

export function appError(
  errorClass: ErrorClass,
  message: string,
  options?: AppErrorOptions
): AppError {
  return new AppError(errorClass, message, options);
}

export function errorClassOf(error: unknown): ErrorClass {
  return error instanceof AppError ? error.errorClass : 'UNKNOWN';
}
