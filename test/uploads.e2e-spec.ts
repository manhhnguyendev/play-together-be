import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import request from 'supertest';
import { createTestApp, TEST_DEMO_PASSWORD, type TestApp } from './app.helper';

const API = '/api/v2';
const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

/** A real 1x1 PNG — the storage layer checks magic bytes, so the fixture has to be honest about them. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
const JPEG_HEADER = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0x00, 0x01]);
/** test/env.ts caps uploads at 1 MB; this is just over it. */
const TOO_LARGE = Buffer.alloc(1024 * 1024 + 64, 0x7f);
const STORED_URL = /^\/uploads\/\d{4}-\d{2}\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.png$/;

describe('Image uploads (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  let accessToken = '';

  beforeAll(async () => {
    harness = await createTestApp();
    await harness.seed();
    http = request(harness.app.getHttpServer());

    const login = await http
      .post(`${API}/auth/login`)
      .send({ email: 'demo.hirer1@playtogether.local', password: TEST_DEMO_PASSWORD })
      .expect(200);
    accessToken = login.body.accessToken as string;
  });

  afterAll(async () => {
    await harness.app.close();
  });

  const upload = (file: Buffer, options: { filename?: string; contentType?: string } = {}) =>
    http
      .post(`${API}/uploads`)
      .set(bearer(accessToken))
      .attach('file', file, { filename: options.filename ?? 'photo.png', contentType: options.contentType ?? 'image/png' });

  it('rejects an anonymous upload', async () => {
    await http.post(`${API}/uploads`).attach('file', PNG, 'photo.png').expect(401);
  });

  it('writes the file to disk and serves the URL it returns', async () => {
    const response = await upload(PNG).expect(201);

    expect(response.body.url).toMatch(STORED_URL);
    expect(response.body).toMatchObject({ contentType: 'image/png', size: PNG.length });

    const served = await http.get(response.body.url).expect(200);
    expect(served.body).toBeInstanceOf(Buffer);
    expect(served.body.equals(PNG)).toBe(true);
    // Without this header helmet's default would stop the admin app and the web build from loading it.
    expect(served.headers['cross-origin-resource-policy']).toBe('cross-origin');

    const onDisk = resolve(process.cwd(), '.data/test-uploads', response.body.url.replace('/uploads/', ''));
    expect(existsSync(onDisk)).toBe(true);
  });

  it('accepts a JPEG by its bytes, not by the extension it was sent with', async () => {
    const response = await upload(JPEG_HEADER, { filename: 'avatar.jpg', contentType: 'image/jpeg' }).expect(201);
    expect(response.body.contentType).toBe('image/jpeg');
    expect(response.body.url.endsWith('.jpg')).toBe(true);
  });

  it('rejects a file that claims to be an image but is not one', async () => {
    const response = await upload(Buffer.from('this is a text file, not a picture')).expect(422);
    expect(response.body.code).toBe('unsupported_image_type');
  });

  it('rejects a non-image content type', async () => {
    const response = await upload(Buffer.from('echo off'), { filename: 'script.bat', contentType: 'application/x-msdownload' });
    expect(response.status).toBe(422);
    expect(response.body.code).toBe('unsupported_image_type');
  });

  it('rejects a file over the configured cap', async () => {
    const response = await upload(TOO_LARGE, { filename: 'huge.png' }).expect(422);
    expect(response.body.code).toBe('image_too_large');
  });

  it('rejects a request that carries no file part', async () => {
    const response = await http.post(`${API}/uploads`).set(bearer(accessToken)).field('note', 'no file here').expect(400);
    expect(response.body.code).toBe('no_file_uploaded');
  });

  it('stores the returned path as an avatar and as a gallery image', async () => {
    const { body } = await upload(PNG).expect(201);

    await http.patch(`${API}/users/me`).set(bearer(accessToken)).send({ avatarUrl: body.url }).expect(200);
    const profile = await http.get(`${API}/users/me`).set(bearer(accessToken)).expect(200);
    expect(profile.body.avatarUrl).toBe(body.url);

    const image = await http.post(`${API}/users/me/images`).set(bearer(accessToken)).send({ url: body.url }).expect(201);
    expect(image.body.url).toBe(body.url);
  });

  it('still rejects the base64 blob the app used to inline', async () => {
    // Control for the bug this endpoint exists to fix: a data URI is not a URL, and it used to be
    // what the mobile app sent, rejected by validation and reported to the user as a dead button.
    const dataUri = `data:image/png;base64,${PNG.toString('base64')}`;
    const response = await http
      .patch(`${API}/users/me`)
      .set(bearer(accessToken))
      .send({ avatarUrl: dataUri })
      .expect(400);
    expect(response.body.code).toBe('validation_failed');
  });
});
