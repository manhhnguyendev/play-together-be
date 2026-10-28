import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, gte, sql } from 'drizzle-orm';
import { randomBytes, randomInt } from 'node:crypto';
import { DB, type AppDatabase } from '../../common/database/database.module';
import { AppError } from '../../common/errors/app-error';
import { ErrorCode } from '../../common/errors/error-codes';
import { isUniqueViolation } from '../../common/errors/pg-errors';
import { MailService } from '../../common/mail/mail.service';
import { PasswordService } from '../../common/security/password.service';
import { hashToken, TokenService, type TokenPair } from '../../common/security/token.service';
import { addMinutes, Clock } from '../../common/time/time';
import {
  behaviorPoints,
  emailOtps,
  passwordResetTokens,
  refreshTokens,
  users,
  wallets,
  type User,
} from '../../db/schema';
import { SystemConfigService } from '../system-config/system-config.service';
import { toUserSummary } from '../users/user.mapper';
import type { UserSummary } from '../users/users.dto';
import type { GoogleProfile } from './google-auth.service';
import { GoogleAuthService } from './google-auth.service';
import type {
  ChangePasswordDto,
  LoginDto,
  RegisterDto,
  RequestOtpDto,
  RequestOtpResponseDto,
  ResetPasswordDto,
  VerifyOtpDto,
  VerifyOtpResponseDto,
} from './auth.dto';

const RESET_TOKEN_TTL_MINUTES = 30;
const OTP_TTL_MINUTES = 10;
const VERIFIED_EMAIL_WINDOW_MINUTES = 30;
const MAX_OTP_ATTEMPTS = 5;
const OTP_REQUEST_WINDOW_MINUTES = 15;
const MAX_OTP_REQUESTS = 5;

type AuthPayload = TokenPair & { user: UserSummary };

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly exposeOtp: boolean;

  constructor(
    @Inject(DB) private readonly db: AppDatabase,
    private readonly passwords: PasswordService,
    private readonly tokens: TokenService,
    private readonly configs: SystemConfigService,
    private readonly google: GoogleAuthService,
    private readonly mail: MailService,
    private readonly clock: Clock,
    config: ConfigService,
  ) {
    this.exposeOtp = config.get<boolean>('EXPOSE_OTP') === true;
  }

  async register(dto: RegisterDto, userAgent?: string): Promise<AuthPayload> {
    const email = normalizeEmail(dto.email);
    await this.assertEmailAvailable(email);

    const now = this.clock.now();
    const [verification] = await this.db
      .select({ id: emailOtps.id })
      .from(emailOtps)
      .where(
        and(
          eq(emailOtps.email, email),
          eq(emailOtps.purpose, 'REGISTER'),
          sql`${emailOtps.verifiedAt} is not null`,
          sql`${emailOtps.usedAt} is null`,
          gte(emailOtps.expiresAt, now),
        ),
      )
      .orderBy(desc(emailOtps.createdAt))
      .limit(1);

    if (!verification) {
      throw AppError.badRequest(
        ErrorCode.emailNotVerified,
        'Verify this email address with a one-time code before registering',
      );
    }

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
        await tx
          .update(emailOtps)
          .set({ usedAt: now })
          .where(eq(emailOtps.id, verification.id));
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

  async requestOtp(dto: RequestOtpDto): Promise<RequestOtpResponseDto> {
    const email = normalizeEmail(dto.email);
    const purpose = dto.purpose;
    const now = this.clock.now();

    if (purpose === 'REGISTER') {
      await this.assertEmailAvailable(email);
    } else if (!(await this.findUser(email))) {
      return this.otpResponse(purpose);
    }

    await this.assertOtpRequestAllowed(email, purpose, now);

    await this.db
      .update(emailOtps)
      .set({ usedAt: now })
      .where(
        and(
          eq(emailOtps.email, email),
          eq(emailOtps.purpose, purpose),
          sql`${emailOtps.usedAt} is null`,
        ),
      );

    const code = randomInt(0, 1_000_000).toString().padStart(6, '0');
    const [row] = await this.db
      .insert(emailOtps)
      .values({
        email,
        purpose,
        codeHash: hashToken(code),
        expiresAt: addMinutes(now, OTP_TTL_MINUTES),
      })
      .returning({ id: emailOtps.id });

    try {
      await this.mail.sendOtp({ email, code, purpose, ttlMinutes: OTP_TTL_MINUTES });
    } catch (error) {
      this.logger.error(`Could not deliver an OTP to ${email}: ${String(error)}`);
      await this.db.update(emailOtps).set({ usedAt: now }).where(eq(emailOtps.id, row.id));
      throw AppError.unavailable(ErrorCode.emailDeliveryFailed, 'Could not send the verification email');
    }

    const response = this.otpResponse(purpose);
    return this.exposeOtp && !this.mail.configured ? { ...response, devCode: code } : response;
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<VerifyOtpResponseDto> {
    const email = normalizeEmail(dto.email);
    const now = this.clock.now();

    const [otp] = await this.db
      .select()
      .from(emailOtps)
      .where(
        and(
          eq(emailOtps.email, email),
          eq(emailOtps.purpose, dto.purpose),
          sql`${emailOtps.usedAt} is null`,
        ),
      )
      .orderBy(desc(emailOtps.createdAt))
      .limit(1);

    if (!otp) {
      throw AppError.badRequest(ErrorCode.invalidOtp, 'Request a new verification code');
    }
    if (otp.expiresAt.getTime() <= now.getTime()) {
      throw AppError.badRequest(ErrorCode.otpExpired, 'The verification code has expired');
    }
    if (otp.attempts >= MAX_OTP_ATTEMPTS) {
      throw AppError.tooManyRequests(
        ErrorCode.tooManyOtpRequests,
        'Too many incorrect attempts; request a new verification code',
      );
    }
    if (otp.codeHash !== hashToken(dto.code)) {
      await this.db
        .update(emailOtps)
        .set({ attempts: otp.attempts + 1 })
        .where(eq(emailOtps.id, otp.id));
      throw AppError.badRequest(ErrorCode.invalidOtp, 'The verification code is incorrect');
    }

    if (dto.purpose === 'PASSWORD_RESET') {
      const user = await this.findUser(email);
      if (!user) {
        throw AppError.badRequest(ErrorCode.invalidOtp, 'Request a new verification code');
      }

      const raw = randomBytes(32).toString('base64url');
      await this.db.transaction(async (tx) => {
        await tx
          .update(emailOtps)
          .set({ verifiedAt: now, usedAt: now })
          .where(eq(emailOtps.id, otp.id));

        await tx
          .update(passwordResetTokens)
          .set({ usedAt: now })
          .where(and(eq(passwordResetTokens.userId, user.id), sql`${passwordResetTokens.usedAt} is null`));

        await tx.insert(passwordResetTokens).values({
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: addMinutes(now, RESET_TOKEN_TTL_MINUTES),
        });
      });

      return { verified: true, resetToken: raw };
    }

    await this.db
      .update(emailOtps)
      .set({ verifiedAt: now, expiresAt: addMinutes(now, VERIFIED_EMAIL_WINDOW_MINUTES) })
      .where(eq(emailOtps.id, otp.id));

    return { verified: true };
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

  private async findUser(email: string): Promise<{ id: string } | undefined> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);
    return user;
  }

  private async assertOtpRequestAllowed(
    email: string,
    purpose: RequestOtpDto['purpose'],
    now: Date,
  ): Promise<void> {
    const [{ count }] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(emailOtps)
      .where(
        and(
          eq(emailOtps.email, email),
          eq(emailOtps.purpose, purpose),
          gte(emailOtps.createdAt, addMinutes(now, -OTP_REQUEST_WINDOW_MINUTES)),
        ),
      );

    if (count >= MAX_OTP_REQUESTS) {
      throw AppError.tooManyRequests(
        ErrorCode.tooManyOtpRequests,
        'Too many verification codes requested; try again later',
      );
    }
  }

  private otpResponse(purpose: RequestOtpDto['purpose']): RequestOtpResponseDto {
    return {
      message:
        purpose === 'REGISTER'
          ? 'A verification code has been sent to this email address'
          : 'If that email exists, a verification code has been sent',
      expiresInSeconds: OTP_TTL_MINUTES * 60,
    };
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
