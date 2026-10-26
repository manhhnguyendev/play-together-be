import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, sql } from 'drizzle-orm';
import { randomBytes } from 'node:crypto';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { PasswordService } from '../../common/security/password.service';
import { hashToken, TokenService, type TokenPair } from '../../common/security/token.service';
import { addMinutes, Clock } from '../../common/time/time';
import { behaviorPoints, passwordResetTokens, refreshTokens, users, wallets, type User } from '../../db/schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { toUserSummary } from '../users/user.mapper';
import type { UserSummary } from '../users/users.dto';
import type { GoogleProfile } from './google-auth.service';
import { GoogleAuthService } from './google-auth.service';
import type {
  ChangePasswordDto,
  ForgotPasswordResponseDto,
  LoginDto,
  RegisterDto,
  ResetPasswordDto,
} from './auth.dto';

const RESET_TOKEN_TTL_MINUTES = 30;

type AuthPayload = TokenPair & { user: UserSummary };

@Injectable()
export class AuthService {
  private readonly exposeResetToken: boolean;

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly configs: SystemConfigService,
    private readonly google: GoogleAuthService,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.exposeResetToken = config.get<boolean>('EXPOSE_RESET_TOKEN') === true;
  }

  async register(dto: RegisterDto, userAgent?: string): Promise<AuthPayload> {
    const email = normalizeEmail(dto.email);
    await this.assertEmailAvailable(email);

    const passwordHash = await this.passwords.hash(dto.password);

    let user: User;
    try {
      user = await this.db.transaction(async (tx) => {
        const [created] = await tx
          .insert(users)
          .values({
            email,
            passwordHash,
            name: dto.name,
            dateOfBirth: dto.dateOfBirth ?? null,
            city: dto.city ?? null,
            gender: dto.gender ?? 'OTHER',
            status: 'ONLINE',
          })
          .returning();

        await tx.insert(wallets).values({ userId: created.id });
        await tx.insert(behaviorPoints).values({ userId: created.id });
        return created;
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw AppError.conflict(ErrorCode.emailTaken, 'This email is already registered');
      }
      throw error;
    }

    return this.respond(user, userAgent);
  }

  async login(dto: LoginDto, userAgent?: string): Promise<AuthPayload> {
    const email = normalizeEmail(dto.email);
    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (!user || !(await this.passwords.verify(dto.password, user.passwordHash))) {
      throw AppError.unauthorized(ErrorCode.invalidCredentials, 'Email or password is incorrect');
    }

    await this.assertLoginAllowed(user);

    const refreshed =
      user.status === 'OFFLINE'
        ? (
            await this.db
              .update(users)
              .set({ status: 'ONLINE', updatedAt: this.clock.now() })
              .where(eq(users.id, user.id))
              .returning()
          )[0]
        : user;

    return this.respond(refreshed, userAgent);
  }

  async loginWithGoogle(profile: GoogleProfile, userAgent?: string): Promise<AuthPayload> {
    const [byGoogleId] = await this.db
      .select()
      .from(users)
      .where(eq(users.googleId, profile.sub))
      .limit(1);

    if (byGoogleId) {
      await this.assertLoginAllowed(byGoogleId);
      return this.respond(byGoogleId, userAgent);
    }

    const [byEmail] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${profile.email}`)
      .limit(1);

    if (byEmail) {
      if (byEmail.googleId && byEmail.googleId !== profile.sub) {
        throw AppError.conflict(ErrorCode.conflict, 'This email is already linked to another Google account');
      }
      const [linked] = await this.db
        .update(users)
        .set({
          googleId: profile.sub,
          avatarUrl: byEmail.avatarUrl ?? profile.picture,
          updatedAt: this.clock.now(),
        })
        .where(eq(users.id, byEmail.id))
        .returning();

      await this.assertLoginAllowed(linked);
      return this.respond(linked, userAgent);
    }

    const user = await this.db.transaction(async (tx) => {
      const [created] = await tx
        .insert(users)
        .values({
          email: profile.email,
          googleId: profile.sub,
          name: profile.name,
          avatarUrl: profile.picture,
          status: 'ONLINE',
        })
        .returning();

      await tx.insert(wallets).values({ userId: created.id });
      await tx.insert(behaviorPoints).values({ userId: created.id });
      return created;
    });

    return this.respond(user, userAgent);
  }

  async refresh(rawRefreshToken: string, userAgent?: string): Promise<TokenPair> {
    return this.tokens.rotate(rawRefreshToken, userAgent);
  }

  async logout(rawRefreshToken: string): Promise<void> {
    await this.tokens.revoke(rawRefreshToken);
  }

  async changePassword(userId: string, dto: ChangePasswordDto, userAgent?: string): Promise<AuthPayload> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId)).limit(1);
    if (!user) throw AppError.notFound(ErrorCode.userNotFound, 'User not found');

    if (!user.passwordHash) {
      throw AppError.badRequest(
        ErrorCode.passwordMismatch,
        'This account signs in with Google; use the password reset flow to add a password',
      );
    }

    if (!(await this.passwords.verify(dto.currentPassword, user.passwordHash))) {
      throw AppError.badRequest(ErrorCode.passwordMismatch, 'Current password is incorrect');
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);
    const [updated] = await this.db
      .update(users)
      .set({ passwordHash, updatedAt: this.clock.now() })
      .where(eq(users.id, user.id))
      .returning();

    await this.tokens.revokeAll(user.id);
    return this.respond(updated, userAgent);
  }

  async forgotPassword(emailInput: string): Promise<ForgotPasswordResponseDto> {
    const email = normalizeEmail(emailInput);
    const generic: ForgotPasswordResponseDto = {
      message: 'If that email exists, a password reset link has been sent',
    };

    const [user] = await this.db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (!user) return generic;

    const now = this.clock.now();
    await this.db
      .update(passwordResetTokens)
      .set({ usedAt: now })
      .where(and(eq(passwordResetTokens.userId, user.id), sql`${passwordResetTokens.usedAt} is null`));

    const raw = randomBytes(32).toString('base64url');
    await this.db.insert(passwordResetTokens).values({
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: addMinutes(now, RESET_TOKEN_TTL_MINUTES),
    });

    if (this.exposeResetToken) {
      return { ...generic, resetToken: raw };
    }
    return generic;
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const now = this.clock.now();
    const [row] = await this.db
      .select()
      .from(passwordResetTokens)
      .where(eq(passwordResetTokens.tokenHash, hashToken(dto.token)))
      .limit(1);

    if (!row || row.usedAt || row.expiresAt.getTime() <= now.getTime()) {
      throw AppError.badRequest(ErrorCode.invalidResetToken, 'Reset token is invalid or has expired');
    }

    const passwordHash = await this.passwords.hash(dto.newPassword);

    await this.db.transaction(async (tx) => {
      await tx
        .update(users)
        .set({ passwordHash, updatedAt: now })
        .where(eq(users.id, row.userId));

      await tx
        .update(passwordResetTokens)
        .set({ usedAt: now })
        .where(eq(passwordResetTokens.id, row.id));

      await tx
        .update(refreshTokens)
        .set({ revokedAt: now })
        .where(and(eq(refreshTokens.userId, row.userId), sql`${refreshTokens.revokedAt} is null`));
    });
  }

  private async assertEmailAvailable(email: string): Promise<void> {
    const [existing] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existing) {
      throw AppError.conflict(ErrorCode.emailTaken, 'This email is already registered');
    }
  }

  private async assertLoginAllowed(user: User): Promise<void> {
    if (!user.isActive) {
      throw AppError.forbidden(ErrorCode.accountDisabled, 'This account has been locked');
    }
    if (user.status === 'MAINTAIN' && user.role !== 'ADMIN') {
      throw AppError.unavailable(ErrorCode.accountMaintained, 'The system is under maintenance');
    }
    if (user.role !== 'ADMIN' && (await this.configs.isMaintenance())) {
      throw AppError.unavailable(ErrorCode.maintenanceMode, 'The system is under maintenance');
    }
  }

  private async respond(user: User, userAgent?: string): Promise<AuthPayload> {
    const pair = await this.tokens.issuePair(user, userAgent);
    return { ...pair, user: toUserSummary(user, { includeEmail: true }) };
  }

  get googleConfigured(): boolean {
    return this.google.configured;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function isUniqueViolation(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as { code?: string }).code === '23505';
}
