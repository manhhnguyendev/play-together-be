import type { User } from '../../db/schema';

export type UserRole = User['role'];

export type AuthUser = {
  id: string;
  email: string;
  role: UserRole;
};
