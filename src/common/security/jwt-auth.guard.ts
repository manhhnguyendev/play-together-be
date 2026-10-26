import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { AuthUser } from './auth-user';
import { IS_PUBLIC_KEY } from './decorators';

type AccessTokenPayload = {
  sub: string;
  email: string;
  role: AuthUser['role'];
};

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();
    const header = request.headers.authorization;

    if (!header?.startsWith('Bearer ')) {
      throw AppError.unauthorized(ErrorCode.missingToken, 'Authentication required');
    }

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(header.slice(7));
      request.user = { id: payload.sub, email: payload.email, role: payload.role };
      return true;
    } catch {
      throw AppError.unauthorized(ErrorCode.invalidToken, 'Invalid or expired access token');
    }
  }
}
