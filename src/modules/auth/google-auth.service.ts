import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuth2Client } from 'google-auth-library';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';

export type GoogleProfile = {
  sub: string;
  email: string;
  name: string;
  picture: string | null;
  emailVerified: boolean;
};

@Injectable()
export class GoogleAuthService {
  private readonly logger = new Logger(GoogleAuthService.name);
  private readonly client: OAuth2Client | null;
  /**
   * Client IDs an ID token may have been issued to.
   *
   * A token carries the client ID of whoever asked Google for it, so accepting only the
   * web client rejects tokens minted by a native build that used its own Android or iOS
   * client. They all identify the same Google project, so they are all trustworthy.
   */
  private readonly audiences: string[];

  constructor(config: ConfigService) {
    this.audiences = [
      config.get<string>('GOOGLE_CLIENT_ID'),
      config.get<string>('GOOGLE_ANDROID_CLIENT_ID'),
      config.get<string>('GOOGLE_IOS_CLIENT_ID'),
    ].filter((id): id is string => Boolean(id));

    this.client = this.audiences.length ? new OAuth2Client() : null;
  }

  get configured(): boolean {
    return this.client !== null;
  }

  async verify(idToken: string): Promise<GoogleProfile> {
    if (!this.client) {
      throw AppError.unavailable(
        ErrorCode.googleNotConfigured,
        'Google sign-in is not configured on this deployment',
      );
    }

    try {
      const ticket = await this.client.verifyIdToken({ idToken, audience: this.audiences });
      const payload = ticket.getPayload();

      if (!payload?.sub || !payload.email) {
        throw AppError.unauthorized(ErrorCode.invalidGoogleToken, 'Google token is missing required claims');
      }

      return {
        sub: payload.sub,
        email: payload.email.toLowerCase(),
        name: payload.name ?? payload.email.split('@')[0],
        picture: payload.picture ?? null,
        emailVerified: payload.email_verified === true,
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      this.logger.warn(`Google token verification failed: ${(error as Error).message}`);
      throw AppError.unauthorized(ErrorCode.invalidGoogleToken, 'Google token could not be verified');
    }
  }
}
