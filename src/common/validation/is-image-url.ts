import { Matches, type ValidationOptions } from 'class-validator';

/**
 * Shapes the app is allowed to keep in an image column: an absolute http(s) URL (a Google photo, a
 * CDN object once a third-party driver is configured) or a root-relative path handed back by this
 * API's own storage (`/uploads/2026-11/<uuid>.jpg`).
 *
 * Relative is deliberately accepted because an absolute URL baked into the database stops working the
 * moment the API is reached through another host — the LAN IP of the dev machine drifts, and a phone
 * cannot resolve `localhost` at all. Clients resolve it against their own API origin instead.
 *
 * What this rules out is the previous behaviour: the app used to inline a picked photo as a
 * `data:image/...;base64` blob, which is not a URL, blows a text column up to megabytes, and was in
 * fact rejected here with a validation error the client swallowed as a generic "thất bại".
 */
const IMAGE_URL_PATTERN = /^(?:https?:\/\/\S+|\/[A-Za-z0-9._~%/-]+)$/;

export function isImageUrl(value: unknown): boolean {
  return typeof value === 'string' && value.length > 0 && value.length <= 2048 && IMAGE_URL_PATTERN.test(value);
}

export function IsImageUrl(options?: ValidationOptions): PropertyDecorator {
  return Matches(IMAGE_URL_PATTERN, {
    message: 'must be an http(s) URL or a root-relative path such as /uploads/2026-11/<file>.jpg',
    ...options,
  });
}
