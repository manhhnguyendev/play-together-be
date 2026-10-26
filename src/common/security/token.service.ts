import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { User } from '../../db/schema';
import { refreshTokens, users } from '../../db/schema';
import { SystemConfigService } from '../../modules/system-config/system-config.service';
import { DB, type AppDatabase } from '../database/database.module';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthUser } from './auth-user';

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
};

type TokenUser = Pick<User, 'id' | 'email' | 'role'>;

export function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

@Injectable()
export class TokenService {
  private readonly refreshTtl: number;
  private readonly accessTtl: number;

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly jwt: JwtService,
    private readonly configs: SystemConfigService,
    config: ConfigService,
  ) {
    this.refreshTtl = config.get<number>('JWT_REFRESH_TTL') ?? 2_592_000;
    this.accessTtl = config.get<number>('JWT_ACCESS_TTL') ?? 900;
  }

  async issuePair(user: TokenUser, userAgent?: string): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({ sub: user.id, email: user.email, role: user.role });
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtl * 1000);

    await this.db.insert(refreshTokens).values({
      userId: user.id,
      tokenHash: hashToken(refreshToken),
      expiresAt,
      userAgent: userAgent?.slice(0, 255),
    });

    return {
      accessToken,
      refreshToken,
      accessTokenExpiresIn: this.accessTtl,
      refreshTokenExpiresAt: expiresAt.toISOString(),
    };
  }

  async rotate(rawRefreshToken: string, userAgent?: string): Promise<TokenPair> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.tokenHash, hashToken(rawRefreshToken)))
      .limit(1);

    if (!row) {
      throw AppError.unauthorized(ErrorCode.invalidRefreshToken, 'Invalid refresh token');
    }

    if (row.revokedAt) {
      await this.revokeAll(row.userId);
      throw AppError.unauthorized(ErrorCode.invalidRefreshToken, 'Refresh token was already used');
    }

    if (row.expiresAt.getTime() <= Date.now()) {
      throw AppError.unauthorized(ErrorCode.invalidRefreshToken, 'Refresh token expired');
    }

    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.id, row.id), isNull(refreshTokens.revokedAt)));

    const [user] = await this.db.select().from(users).where(eq(users.id, row.userId)).limit(1);
    if (!user || !user.isActive) {
      throw AppError.unauthorized(ErrorCode.accountDisabled, 'Account is not active');
    }
    if (
      user.role !== 'ADMIN' &&
      (user.status === 'MAINTAIN' || (await this.configs.isMaintenance()))
    ) {
      throw AppError.unavailable(ErrorCode.maintenanceMode, 'The system is under maintenance');
    }

    return this.issuePair(user, userAgent);
  }

  async revoke(rawRefreshToken: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(eq(refreshTokens.tokenHash, hashToken(rawRefreshToken)));
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  }

  async purgeExpired(): Promise<void> {
    await this.db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date()));
  }

  toAuthUser(user: TokenUser): AuthUser {
    return { id: user.id, email: user.email, role: user.role };
  }
}
