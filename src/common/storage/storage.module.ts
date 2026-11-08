import { Global, Module } from '@nestjs/common';
import { IMAGE_STORAGE } from './image-storage';
import { LocalImageStorage } from './local-image.storage';

/**
 * Global because both the uploads endpoint and the seed/backfill scripts reach for the same driver,
 * and the whole point of the token is that a third-party bucket can replace it in one place.
 */
@Global()
@Module({
  providers: [{ provide: IMAGE_STORAGE, useClass: LocalImageStorage }],
  exports: [IMAGE_STORAGE],
})
export class StorageModule {}
