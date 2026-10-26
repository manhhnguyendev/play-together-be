import request from 'supertest';
import { createTestApp, type TestApp } from './app.helper';

describe('Auth (e2e)', () => {
  let harness: TestApp;
  let http: ReturnType<typeof request>;
  const email = 'auth.user@example.com';
  const password = 'Secret123';

  beforeAll(async () => {
    harness = await createTestApp();
    http = request(harness.app.getHttpServer());
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('registers a user and issues an access/refresh pair', async () => {
    const response = await http
      .post('/api/v2/auth/register')
      .send({ email, password, name: 'Auth User', city: 'Đà Nẵng', gender: 'OTHER' })
      .expect(201);

    expect(response.body.accessToken).toEqual(expect.any(String));
    expect(response.body.refreshToken).toEqual(expect.any(String));
    expect(response.body.user).toMatchObject({ email, name: 'Auth User', isPlayer: false });
    expect(response.body.user).not.toHaveProperty('passwordHash');
  });

  it('rejects a duplicate email with a problem+json 409', async () => {
    const response = await http
      .post('/api/v2/auth/register')
      .send({ email: email.toUpperCase(), password, name: 'Someone Else' })
      .expect(409);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body).toMatchObject({ status: 409, code: 'email_taken' });
  });

  it('rejects a wrong password without leaking which field failed', async () => {
    const response = await http
      .post('/api/v2/auth/login')
      .send({ email, password: 'Wrong123' })
      .expect(401);

    expect(response.body.code).toBe('invalid_credentials');
  });

  it('rejects unknown fields through the global validation pipe', async () => {
    const response = await http
      .post('/api/v2/auth/register')
      .send({ email: 'validation@example.com', password, name: 'Valid Name', isAdmin: true })
      .expect(400);

    expect(response.headers['content-type']).toContain('application/problem+json');
    expect(response.body.code).toBe('validation_failed');
    expect(response.body.details.errors.join(' ')).toContain('isAdmin');
  });

  it('rotates refresh tokens and revokes the family on reuse', async () => {
    const login = await http.post('/api/v2/auth/login').send({ email, password }).expect(200);
    expect(login.body.accessToken).toEqual(expect.any(String));

    const rotated = await http
      .post('/api/v2/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(200);
    expect(rotated.body.refreshToken).not.toBe(login.body.refreshToken);

    await http
      .post('/api/v2/auth/refresh')
      .send({ refreshToken: login.body.refreshToken })
      .expect(401)
      .expect((response) => expect(response.body.code).toBe('invalid_refresh_token'));

    await http
      .post('/api/v2/auth/refresh')
      .send({ refreshToken: rotated.body.refreshToken })
      .expect(401)
      .expect((response) => expect(response.body.code).toBe('invalid_refresh_token'));
  });

  it('supports the development password reset flow', async () => {
    const forgot = await http.post('/api/v2/auth/password/forgot').send({ email }).expect(202);
    expect(forgot.body.resetToken).toEqual(expect.any(String));

    await http
      .post('/api/v2/auth/password/reset')
      .send({ token: forgot.body.resetToken, newPassword: 'NewSecret123' })
      .expect(204);

    await http.post('/api/v2/auth/login').send({ email, password }).expect(401);
    await http.post('/api/v2/auth/login').send({ email, password: 'NewSecret123' }).expect(200);
  });

  it('requires a bearer token on protected routes', async () => {
    await http
      .get('/api/v2/users/me')
      .expect(401)
      .expect((response) => expect(response.body.code).toBe('missing_token'));

    await http
      .get('/api/v2/users/me')
      .set('Authorization', 'Bearer not-a-real-token')
      .expect(401)
      .expect((response) => expect(response.body.code).toBe('invalid_token'));
  });

  it('blocks non-admin users from the admin area', async () => {
    const login = await http
      .post('/api/v2/auth/login')
      .send({ email, password: 'NewSecret123' })
      .expect(200);

    await http
      .get('/api/v2/admin/stats')
      .set('Authorization', `Bearer ${login.body.accessToken}`)
      .expect(403)
      .expect((response) => expect(response.body.code).toBe('forbidden'));
  });
});
