import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { ImageStorage, StoredImage } from './image-storage';
import type { UploadedImage } from './uploaded-image';

/**
 * Signature of each image type we accept, checked against the bytes rather than the declared MIME
 * type: a file is served back to browsers from this origin, so what it is must match what it says.
 */
const SIGNATURES: Record<string, (bytes: Buffer) => boolean> = {
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/gif': (b) => b.length > 6 && ['GIF87a', 'GIF89a'].includes(b.subarray(0, 6).toString('latin1')),
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

const EXTENSIONS: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const UPLOAD_PATH_PREFIX = '/uploads/';

/**
 * Images on the local disk, served by this same process under `/uploads`.
 *
 * This is the only driver today; swapping in a third-party bucket later means providing another
 * `ImageStorage` under the same token, because the stored value in the database is whatever
 * `saveImage` returns — a root-relative path here, an absolute CDN URL there — and both shapes are
 * already accepted by the DTO validators.
 */
@Injectable()
export class LocalImageStorage implements ImageStorage {
  private readonly rootDir: string;
  private readonly maxBytes: number;

  constructor(config: ConfigService) {
    this.rootDir = resolve(config.get<string>('UPLOAD_DIR') ?? 'uploads');
    this.maxBytes = (config.get<number>('MAX_UPLOAD_MB') ?? 5) * 1024 * 1024;
  }

  /** Absolute directory the HTTP layer must expose at `UPLOAD_PATH_PREFIX`. */
  get absoluteRoot(): string {
    return this.rootDir;
  }

  async saveImage(file: UploadedImage | undefined): Promise<StoredImage> {
    if (!file || !file.buffer || file.buffer.length === 0) {
      throw AppError.badRequest(ErrorCode.noFileUploaded, 'No image file was uploaded');
    }
    if (file.size > this.maxBytes || file.buffer.length > this.maxBytes) {
      throw AppError.unprocessable(
        ErrorCode.imageTooLarge,
        `Image is larger than ${Math.round(this.maxBytes / (1024 * 1024))} MB`,
        { maxBytes: this.maxBytes },
      );
    }

    const contentType = (file.mimetype ?? '').toLowerCase();
    const matches = SIGNATURES[contentType];
    if (!matches || !EXTENSIONS[contentType]) {
      throw AppError.unprocessable(ErrorCode.unsupportedImageType, 'Only JPEG, PNG, GIF and WebP images can be uploaded', {
        received: file.mimetype,
      });
    }
    if (!matches(file.buffer)) {
      throw AppError.unprocessable(
        ErrorCode.unsupportedImageType,
        'The file content does not match the image type it claims to be',
        { received: file.mimetype },
      );
    }

    const month = new Date().toISOString().slice(0, 7);
    const key = `${month}/${randomUUID()}.${EXTENSIONS[contentType]}`;
    const target = join(this.rootDir, key);

    await mkdir(this.dirnameOf(target), { recursive: true });
    await writeFile(target, file.buffer);

    return {
      url: `${UPLOAD_PATH_PREFIX}${key}`,
      key,
      contentType,
      size: file.buffer.length,
    };
  }

  private dirnameOf(path: string): string {
    const index = path.lastIndexOf('/');
    const backslash = path.lastIndexOf('\\');
    return path.slice(0, Math.max(index, backslash));
  }
}
