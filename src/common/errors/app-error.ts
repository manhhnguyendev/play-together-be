import type { ErrorCode } from './error-codes';

export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: ErrorCode,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(code: ErrorCode, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(400, code, message, details);
  }

  static unauthorized(code: ErrorCode, message: string): AppError {
    return new AppError(401, code, message);
  }

  static forbidden(code: ErrorCode, message: string): AppError {
    return new AppError(403, code, message);
  }

  static notFound(code: ErrorCode, message: string): AppError {
    return new AppError(404, code, message);
  }

  static conflict(code: ErrorCode, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(409, code, message, details);
  }

  static unprocessable(code: ErrorCode, message: string, details?: Record<string, unknown>): AppError {
    return new AppError(422, code, message, details);
  }

  static tooManyRequests(code: ErrorCode, message: string): AppError {
    return new AppError(429, code, message);
  }

  static unavailable(code: ErrorCode, message: string): AppError {
    return new AppError(503, code, message);
  }
}
