import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AppError } from '../errors/app-error';
import { ErrorCode } from '../errors/error-codes';
import type { AdminRole } from '../../db/schema';
import { SUPER_ADMIN_ROLE } from '../../db/schema';
import type { AuthUser, UserRole } from './auth-user';
import { ADMIN_ROLES_KEY, ROLES_KEY } from './decorators';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const scopes = [context.getHandler(), context.getClass()];
    const requiredRoles = this.reflector.getAllAndOverride<UserRole[]>(ROLES_KEY, scopes);
    const requiredAdminRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, scopes);

    if (!requiredRoles?.length && !requiredAdminRoles?.length) return true;

    const request = context.switchToHttp().getRequest<Request & { user?: AuthUser }>();

    if (requiredRoles?.length && (!request.user || !requiredRoles.includes(request.user.role))) {
      throw AppError.forbidden(ErrorCode.forbidden, 'You do not have permission to perform this action');
    }

    const adminRole = request.user?.adminRole ?? null;
    if (requiredAdminRoles?.length) {
      const allowed =
        adminRole === SUPER_ADMIN_ROLE || (adminRole !== null && requiredAdminRoles.includes(adminRole));
      if (!allowed) {
        throw AppError.forbidden(
          ErrorCode.adminRoleRequired,
          `This action needs one of: ${requiredAdminRoles.join(', ')}`,
        );
      }
    }

    return true;
  }
}
