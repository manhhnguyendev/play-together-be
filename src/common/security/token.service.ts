import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { and, eq, isNull, lt } from 'drizzle-orm';
import { createHash, randomBytes } from 'node:crypto';
import type { User } from '../../db/schema';
import { refreshTokens, users } from '../../db/schema';
import { SystemConfigService } from '../../modules/system-config/system-config.service';
import { DB, type AppDatabase, type DbExecutor } from '../database/database.module';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthUser } from './auth-user';

export type TokenPair = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresIn: number;
  refreshTokenExpiresAt: string;
};

type TokenUser = Pick<User, 'id' | 'email' | 'role' | 'adminRole'>;

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

  async issuePair(user: TokenUser, userAgent?: string, executor: DbExecutor = this.db): Promise<TokenPair> {
    const accessToken = await this.jwt.signAsync({
      sub: user.id,
      email: user.email,
      role: user.role,
      adminRole: user.adminRole ?? null,
    });
    const refreshToken = randomBytes(48).toString('base64url');
    const expiresAt = new Date(Date.now() + this.refreshTtl * 1000);

    await executor.insert(refreshTokens).values({
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

  /**
   * Exchanges a refresh token for a new pair.
   *
   * Reading the row, deciding it is still fresh and revoking it used to be three
   * unguarded statements, so two concurrent calls carrying the same token both
   * minted a pair. The `FOR UPDATE` below serialises them and the loser falls
   * into the replay branch, which is the intended outcome: a token presented
   * twice is either a stolen value or a broken client, and both warrant
   * revoking the family.
   *
   * The revocation itself is returned rather than performed in place, because a
   * throw inside the transaction would roll it back.
   */
  async rotate(rawRefreshToken: string, userAgent?: string): Promise<TokenPair> {
    const hash = hashToken(rawRefreshToken);

    const outcome = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(refreshTokens)
        .where(eq(refreshTokens.tokenHash, hash))
        .limit(1)
        .for('update');

      if (!row) return { kind: 'invalid' } as const;

      const now = new Date();
      if (row.revokedAt) return { kind: 'replayed', userId: row.userId } as const;
      if (row.expiresAt.getTime() <= now.getTime()) return { kind: 'expired' } as const;

      await tx.update(refreshTokens).set({ revokedAt: now }).where(eq(refreshTokens.id, row.id));

      const [user] = await tx.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!user || !user.isActive) return { kind: 'disabled' } as const;
      if (
        user.role !== 'ADMIN' &&
        (user.status === 'MAINTAIN' || (await this.configs.isMaintenance(tx)))
      ) {
        return { kind: 'maintenance' } as const;
      }

      return { kind: 'issued', pair: await this.issuePair(user, userAgent, tx) } as const;
    });

    switch (outcome.kind) {
      case 'issued':
        return outcome.pair;
      case 'replayed':
        await this.revokeAll(outcome.userId);
        throw AppError.unauthorized(ErrorCode.invalidRefreshToken, 'Refresh token was already used');
      case 'expired':
        throw AppError.unauthorized(ErrorCode.invalidRefreshToken, 'Refresh token expired');
      case 'disabled':
        throw AppError.unauthorized(ErrorCode.accountDisabled, 'Account is not active');
      case 'maintenance':
        throw AppError.unavailable(ErrorCode.maintenanceMode, 'The system is under maintenance');
      default:
        throw AppError.unauthorized(ErrorCode.invalidRefreshToken, 'Invalid refresh token');
    }
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
    return { id: user.id, email: user.email, role: user.role, adminRole: user.adminRole ?? null };
  }
}
