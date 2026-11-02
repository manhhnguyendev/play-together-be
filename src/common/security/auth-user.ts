import type { AdminRole, User } from '../../db/schema';

export type UserRole = User['role'];

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
  /** Which part of the back office this account may use; null for everyone else. */
  adminRole: AdminRole | null;
};
