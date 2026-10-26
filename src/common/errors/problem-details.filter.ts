import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { STATUS_CODES } from 'node:http';
import { AppError } from './app-error';
import { ErrorCode } from './error-codes';

type PgError = { code?: string; constraint?: string; detail?: string };

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger(ProblemDetailsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, request);

    if (problem.status >= 500) {
      this.logger.error(`${request.method} ${request.originalUrl} -> ${problem.status}`, (exception as Error)?.stack);
    }

    response
      .status(problem.status)
      .type('application/problem+json')
      .json({
        type: `https://api.playtogether.local/errors/${problem.code}`,
        title: STATUS_CODES[problem.status] ?? 'Error',
        status: problem.status,
        code: problem.code,
        detail: problem.detail,
        instance: request.originalUrl,
        traceId: (request.headers['x-request-id'] as string) ?? randomUUID(),
        ...(problem.details ? { details: problem.details } : {}),
      });
  }

  private toProblem(exception: unknown, request: Request) {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        detail: exception.message,
        details: exception.details,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const payloadObject = typeof payload === 'object' ? (payload as Record<string, unknown>) : undefined;
      const message = payloadObject?.message;
      const detail = Array.isArray(message)
        ? 'Request validation failed'
        : typeof message === 'string'
          ? message
          : exception.message;

      return {
        status,
        code: status === 400 ? ErrorCode.validationFailed : status === 404 ? ErrorCode.notFound : ErrorCode.unauthorized,
        detail,
        details: Array.isArray(message) ? { errors: message } : payloadObject?.details as Record<string, unknown> | undefined,
      };
    }

    const pgError = exception as PgError;

    if (pgError?.code === '23505') {
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.conflict,
        detail: 'The request conflicts with an existing record',
        details: pgError.constraint ? { constraint: pgError.constraint } : undefined,
      };
    }

    if (pgError?.code === '23503') {
      return {
        status: HttpStatus.CONFLICT,
        code: ErrorCode.referenceConflict,
        detail: 'The record is referenced by other data',
        details: pgError.constraint ? { constraint: pgError.constraint } : undefined,
      };
    }

    if (pgError?.code === '23514') {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ErrorCode.constraintViolation,
        detail: 'A database constraint rejected the change',
        details: pgError.constraint ? { constraint: pgError.constraint } : undefined,
      };
    }

    if (exception instanceof Error && exception.message.includes('JWT')) {
      return {
        status: HttpStatus.UNAUTHORIZED,
        code: ErrorCode.invalidToken,
        detail: 'Invalid or expired access token',
      };
    }

    this.logger.error(`Unhandled error on ${request.method} ${request.originalUrl}`, (exception as Error)?.stack);

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ErrorCode.internal,
      detail: 'An unexpected error occurred',
      details: undefined,
    };
  }
}
