import { check, index, integer, pgTable, text, timestamp, uniqueIndex, uuid, varchar } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const systemConfigs = pgTable(
  'system_configs',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    key: varchar('key', { length: 100 }).notNull(),
    no: integer('no').notNull(),
    title: varchar('title', { length: 150 }).notNull(),
    value: integer('value').notNull(),
    description: text('description'),
    updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('system_configs_key_key').on(t.key),
    uniqueIndex('system_configs_no_key').on(t.no),
    index('system_configs_no_idx').on(t.no),
    check('system_configs_value_check', sql`${t.value} >= 0`),
  ],
);

export const CONFIG_KEYS = {
  orderResponseMinutes: 'order.response_window_minutes',
  pendingReleaseHours: 'wallet.pending_release_hours',
  feedbackWindowHours: 'order.feedback_window_hours',
  disputeWindowHours: 'order.dispute_window_hours',
  platformFeeBps: 'order.platform_fee_bps',
  maintenanceMode: 'system.maintenance_mode',
} as const;

export type ConfigPreset = {
  no: number;
  title: string;
  value: number;
  description: string;
  /**
   * Inclusive bounds an admin may set. `value` itself is only validated as
   * `>= 0`, so these are the single guard between the admin UI and a stored
   * number the rest of the system cannot honour — `orders.fee_bps` has a
   * `between 0 and 5000` CHECK, so an out-of-range fee turns every later order
   * insert into a raw constraint failure.
   */
  min: number;
  max: number;
};

/**
 * `title` and `description` are what the back-office console shows an operator,
 * so they are written in Vietnamese. `key` stays the stable English identifier
 * the code reads — the two are deliberately different languages.
 */
export const CONFIG_DEFAULTS: Record<string, ConfigPreset> = {
  [CONFIG_KEYS.orderResponseMinutes]: {
    no: 1,
    title: 'Thời gian phản hồi yêu cầu thuê (phút)',
    value: 5,
    description: 'Người chơi có bao lâu để chấp nhận hoặc từ chối một yêu cầu thuê trước khi yêu cầu hết hạn.',
    min: 1,
    max: 120,
  },
  [CONFIG_KEYS.pendingReleaseHours]: {
    no: 2,
    title: 'Thời gian chờ cho phép rút doanh thu (giờ)',
    value: 6,
    description: 'Thu nhập của người chơi nằm trong trạng thái chờ bao lâu trước khi rút được.',
    min: 0,
    max: 720,
  },
  [CONFIG_KEYS.feedbackWindowHours]: {
    no: 3,
    title: 'Thời gian đánh giá và tố cáo (giờ)',
    value: 72,
    description: 'Sau khi một đơn kết thúc, hai bên còn bao lâu để đánh giá hoặc tố cáo nhau.',
    min: 1,
    max: 720,
  },
  [CONFIG_KEYS.platformFeeBps]: {
    no: 4,
    title: 'Phí nền tảng (điểm cơ bản, 1000 = 10%)',
    value: 1000,
    description: 'Phần nền tảng giữ lại trên mỗi đơn đã thanh toán, tính theo điểm cơ bản (1000 = 10%).',
    min: 0,
    max: 3000,
  },
  [CONFIG_KEYS.maintenanceMode]: {
    no: 5,
    title: 'Chế độ bảo trì',
    value: 0,
    description: 'Khi đang bật (= 1), tài khoản không phải quản trị viên không thể đăng nhập hoặc tạo đơn.',
    min: 0,
    max: 1,
  },
  [CONFIG_KEYS.disputeWindowHours]: {
    no: 6,
    title: 'Thời gian khiếu nại trước khi trả tiền (giờ)',
    value: 24,
    description:
      'Một phiên đã kết thúc chờ bao lâu thì tiền được tự động trả cho người chơi. Trong khoảng đó, bên nào cũng có thể tố cáo để giữ tiền chờ kiểm duyệt. Giá trị 0 nghĩa là trả ngay ở lần chạy job kế tiếp.',
    min: 0,
    max: 168,
  },
};

export type SystemConfig = typeof systemConfigs.$inferSelect;
