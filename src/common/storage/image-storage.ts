import type { UploadedImage } from './uploaded-image';

export const IMAGE_STORAGE = Symbol('IMAGE_STORAGE');

export interface StoredImage {
  /**
   * What gets persisted in the database. Root-relative for local files, so the value survives a host
   * or port change; clients prefix it with their API origin and treat anything absolute as final.
   */
  url: string;
  key: string;
  contentType: string;
  size: number;
}

export interface ImageStorage {
  /** Rejects with a typed AppError when the part is missing, oversized, or not really an image. */
  saveImage(file: UploadedImage | undefined): Promise<StoredImage>;
}
