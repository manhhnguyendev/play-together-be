import { SetMetadata } from '@nestjs/common';
import type { AdminRole } from '../../db/schema';
import type { UserRole } from './auth-user';

export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const ROLES_KEY = 'roles';
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);

export const ADMIN_ROLES_KEY = 'adminRoles';

/**
 * Narrow an admin route to specific back-office tiers. `SUPER_ADMIN` always
 * passes, so routes list the specialists they are aimed at.
 */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);
