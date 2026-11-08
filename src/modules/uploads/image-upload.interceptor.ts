import { CallHandler, ExecutionContext, NestInterceptor, type Type } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { from, Observable } from 'rxjs';
import { catchError, switchMap } from 'rxjs/operators';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

/**
 * `FileInterceptor` options are fixed when the class is defined, so they cannot read the
 * `MAX_UPLOAD_MB` the config service resolves later. This keeps the two-layer guard honest: the
 * interceptor is the memory ceiling that protects the process, the storage service applies the
 * configured per-image limit. Without it, a file over the ceiling would end as a bare multer error
 * instead of the RFC 7807 body every other failure in this API produces.
 */
export function ImageUploadInterceptor(field: string, maxBytes: number): Type<NestInterceptor> {
  const multerInterceptor = FileInterceptor(field, { limits: { fileSize: maxBytes, files: 1 } });

  return class ImageUploadCeiling implements NestInterceptor {
    private readonly inner: NestInterceptor = new (
      multerInterceptor as unknown as new () => NestInterceptor
    )();

    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      const started = this.inner.intercept(context, next);
      const stream = started instanceof Promise ? from(started).pipe(switchMap((nested) => nested)) : started;
      return stream.pipe(
        catchError((error: unknown) => {
          const code = (error as { code?: string })?.code;
          if (code === 'LIMIT_FILE_SIZE') {
            throw AppError.unprocessable(
              ErrorCode.imageTooLarge,
              `Image is larger than ${Math.round(maxBytes / (1024 * 1024))} MB`,
              { maxBytes },
            );
          }
          throw error;
        }),
      );
    }
  };
}
