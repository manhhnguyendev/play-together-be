import { ratingAverage } from '../../common/money/money';
import type { User } from '../../db/schema';
import type { UserSummary } from './users.dto';

export function toUserSummary(user: User, options: { includeEmail?: boolean } = {}): UserSummary {
  return {
    id: user.id,
    name: user.name,
    ...(options.includeEmail ? { email: user.email } : {}),
    avatarUrl: user.avatarUrl,
    city: user.city,
    gender: user.gender,
    bio: user.bio,
    status: user.status,
    role: user.role,
    isActive: user.isActive,
    isPlayer: user.isPlayer,
    pricePerHour: user.pricePerHour,
    maxHoursPerHire: user.maxHoursPerHire,
    rating: ratingAverage(user.ratingSum, user.ratingCount),
    ratingCount: user.ratingCount,
    ordersCount: user.ordersCount,
    completedOrdersCount: user.completedOrdersCount,
    totalHours: user.totalHours,
    rankingPoints: user.rankingPoints,
    createdAt: user.createdAt.toISOString(),
  };
}
