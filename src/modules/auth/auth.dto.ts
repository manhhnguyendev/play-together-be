import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsEmail, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import type { OtpPurpose } from '../../common/mail/mail.service';
import { UserSummary } from '../users/users.dto';
const PASSWORD_RULE = /^(?=.*[A-Za-z])(?=.*\d).+$/;

export class RegisterDto {
  @ApiProperty({ example: 'gamer@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Secret123', minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: 'password must contain at least one letter and one digit' })
  password: string;

  @ApiProperty({ example: 'Nguyen Van A' })
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @ApiPropertyOptional({ example: '2001-08-20' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  dateOfBirth?: string;

  @ApiPropertyOptional({ example: 'Ha Noi' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @ApiPropertyOptional({ enum: ['MALE', 'FEMALE', 'OTHER'] })
  @IsOptional()
  @IsIn(['MALE', 'FEMALE', 'OTHER'])
  gender?: 'MALE' | 'FEMALE' | 'OTHER';
}

export class LoginDto {
  @ApiProperty({ example: 'gamer@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ example: 'Secret123' })
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  password: string;
}

export class RefreshTokenDto {
  @ApiProperty()
  @IsString()
  @MinLength(20)
  refreshToken: string;
}

export class ChangePasswordDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(72)
  currentPassword: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: 'newPassword must contain at least one letter and one digit' })
  newPassword: string;
}

export class RequestOtpDto {
  @ApiProperty({ example: 'gamer@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ enum: ['REGISTER', 'PASSWORD_RESET'] })
  @IsIn(['REGISTER', 'PASSWORD_RESET'])
  purpose: OtpPurpose;
}

export class RequestOtpResponseDto {
  @ApiProperty()
  message: string;

  @ApiProperty({ description: 'OTP lifetime in seconds', example: 600 })
  expiresInSeconds: number;

  @ApiPropertyOptional({ description: 'Only present when SMTP is unconfigured and EXPOSE_OTP is enabled' })
  devCode?: string;
}

export class VerifyOtpDto {
  @ApiProperty({ example: 'gamer@example.com' })
  @IsEmail()
  @MaxLength(255)
  email: string;

  @ApiProperty({ enum: ['REGISTER', 'PASSWORD_RESET'] })
  @IsIn(['REGISTER', 'PASSWORD_RESET'])
  purpose: OtpPurpose;

  @ApiProperty({ example: '123456', minLength: 6, maxLength: 6 })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code: string;
}

export class VerifyOtpResponseDto {
  @ApiProperty()
  verified: boolean;

  @ApiPropertyOptional({ description: 'Token accepted by /auth/password/reset; only returned for PASSWORD_RESET' })
  resetToken?: string;
}

export class ResetPasswordDto {
  @ApiProperty({ description: 'Token delivered by email (or returned directly in development)' })
  @IsString()
  @MinLength(20)
  token: string;

  @ApiProperty({ minLength: 8, maxLength: 72 })
  @IsString()
  @MinLength(8)
  @MaxLength(72)
  @Matches(PASSWORD_RULE, { message: 'newPassword must contain at least one letter and one digit' })
  newPassword: string;
}

export class GoogleLoginDto {
  @ApiProperty({ description: 'Google ID token from the client SDK' })
  @IsString()
  @MinLength(20)
  idToken: string;
}

export class TokenPairDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  refreshToken: string;

  @ApiProperty({ description: 'Access token lifetime in seconds', example: 900 })
  accessTokenExpiresIn: number;

  @ApiProperty({ format: 'date-time' })
  refreshTokenExpiresAt: string;
}

export class AuthResponseDto extends TokenPairDto {
  @ApiProperty({ type: UserSummary })
  user: UserSummary;
}
