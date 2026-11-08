import { Controller, HttpCode, HttpStatus, Inject, Post, UploadedFile, UseInterceptors } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IMAGE_STORAGE, type ImageStorage, type StoredImage } from '../../common/storage/image-storage';
import type { UploadedImage } from '../../common/storage/uploaded-image';
import { ImageUploadInterceptor } from './image-upload.interceptor';
import { UploadView } from './uploads.dto';

/**
 * The ceiling the parser accepts before the configured limit is consulted. It only exists to keep a
 * hostile request from buffering gigabytes into memory on a small server.
 */
const MEMORY_CEILING_BYTES = 20 * 1024 * 1024;

@ApiTags('uploads')
@Controller('uploads')
export class UploadsController {
  constructor(@Inject(IMAGE_STORAGE) private readonly storage: ImageStorage) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @UseInterceptors(ImageUploadInterceptor('file', MEMORY_CEILING_BYTES))
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Upload one image file',
    description:
      'Writes the file through the active image storage driver and returns the URL to persist. ' +
      'Nothing is stored by this endpoint itself: the caller still decides where the URL goes ' +
      '(profile avatar, gallery image, charity logo).',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: { file: { type: 'string', format: 'binary' } },
    },
  })
  @ApiCreatedResponse({ type: UploadView })
  upload(@UploadedFile() file?: UploadedImage): Promise<StoredImage> {
    return this.storage.saveImage(file);
  }
}
