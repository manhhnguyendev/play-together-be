/**
 * The piece of a multipart upload this app reads. Declared here instead of pulling `@types/multer`
 * in: the runtime object already comes from the multer bundled with `@nestjs/platform-express`, and
 * only these four fields are ever touched — `originalname` deliberately is not one of them, since a
 * client-supplied filename is the classic path-traversal carrier.
 */
export interface UploadedImage {
  buffer: Buffer;
  size: number;
  mimetype: string;
}
