import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NestExpressApplication } from '@nestjs/platform-express';
import type { ServerResponse } from 'node:http';

/** Prefix the file URLs are published under, and the value stored in the database. */
export const UPLOAD_SERVE_PREFIX = '/uploads';

export function uploadRoot(configured: string | undefined): string {
  return resolve(configured ?? 'uploads');
}

/**
 * Publishes the upload directory as static files.
 *
 * This has to run before the application is initialised, so that the middleware sits in front of the
 * Nest router: registered afterwards, requests to `/uploads/...` fall into the router's own 404 and
 * never reach the file — which is exactly how the e2e harness caught the first version of this.
 */
export function serveUploadsFrom(app: NestExpressApplication, rootPath: string): void {
  mkdirSync(rootPath, { recursive: true });
  app.useStaticAssets(rootPath, {
    prefix: `${UPLOAD_SERVE_PREFIX}/`,
    index: false,
    dotfiles: 'deny',
    setHeaders: (res: ServerResponse) => {
      // helmet() defaults to same-origin, which would stop the admin app and the web build from
      // loading a picture served by the API origin. Avatars are public by design, so they opt out.
      res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
      res.setHeader('Cache-Control', 'public, max-age=86400');
    },
  });
}
