-- Copy localisation for the money trail (§21). `ledger_entries.note` and the
-- `system_configs` title/description were written in English while every other
-- user-facing string in the product is Vietnamese, and both consoles print
-- these values verbatim. New rows are fixed at the source; this rewrites rows
-- that already exist.
--
-- Nothing in the code reads a note back — the mobile app titles a transaction
-- from the ledger `type`, the admin tables show `note` as text — so this is
-- copy-only and touches no amount, no balance, no ledger pairing. Every
-- statement matches only its own former string, so re-running it is a no-op.

UPDATE "ledger_entries" SET "note" = 'Nạp tiền qua MoMo' WHERE "note" = 'Top-up via MoMo';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Yêu cầu rút tiền' WHERE "note" = 'Withdrawal request';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Rút tiền bị từ chối, đã hoàn về ví' WHERE "note" = 'Withdrawal rejected';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Rút tiền bị huỷ, đã hoàn về ví' WHERE "note" = 'Withdrawal cancelled';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Tạm giữ tiền cho đơn thuê' WHERE "note" = 'Funds held for order';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Hoàn phần tiền thuê chưa dùng cho người thuê' WHERE "note" = 'Unused escrow refunded to hirer';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Giải ngân tiền đơn thuê' WHERE "note" = 'Escrow released';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Doanh thu đơn thuê (chờ về ví)' WHERE "note" = 'Order earnings (pending release)';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Phí nền tảng' WHERE "note" = 'Platform commission';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Hoàn tiền cho người thuê vì tố cáo đúng' WHERE "note" = 'Refund to hirer after upheld report';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Thu hồi tiền từ người chơi' WHERE "note" = 'Claw-back from player';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Bồi hoàn cho người thuê vì tố cáo đúng' WHERE "note" = 'Report compensation to hirer';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Ủng hộ cho ' || substring("note" from 'Donation to (.*)$') WHERE "note" LIKE 'Donation to %';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Từ thiện: quỹ yêu cầu rút tiền' WHERE "note" = 'Charity withdrawal requested';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Từ thiện: chuyển tiền cho ' || substring("note" from 'Withdrawal payout for (.*)$') WHERE "note" LIKE 'Withdrawal payout for %';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Từ thiện: quỹ đã huỷ yêu cầu rút' WHERE "note" = 'Withdrawal cancelled by charity';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Từ thiện: yêu cầu rút bị từ chối, tiền đã hoàn về quỹ' WHERE "note" = 'Withdrawal rejected; funds returned';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Quyên góp dữ liệu mẫu' WHERE "note" = 'Seed demo donation';--> statement-breakpoint
UPDATE "ledger_entries" SET "note" = 'Số dư ban đầu (dữ liệu mẫu)' WHERE "note" = 'Seed demo opening balance';--> statement-breakpoint

UPDATE "withdrawals" SET "note" = 'Người dùng tự huỷ yêu cầu' WHERE "note" = 'Cancelled by user';--> statement-breakpoint

UPDATE "system_configs" SET
  "title" = 'Thời gian phản hồi yêu cầu thuê (phút)',
  "description" = 'Người chơi có bao lâu để chấp nhận hoặc từ chối một yêu cầu thuê trước khi yêu cầu hết hạn.'
WHERE "key" = 'order.response_window_minutes';--> statement-breakpoint
UPDATE "system_configs" SET
  "title" = 'Thời gian chờ cho phép rút doanh thu (giờ)',
  "description" = 'Thu nhập của người chơi nằm trong trạng thái chờ bao lâu trước khi rút được.'
WHERE "key" = 'wallet.pending_release_hours';--> statement-breakpoint
UPDATE "system_configs" SET
  "title" = 'Thời gian đánh giá và tố cáo (giờ)',
  "description" = 'Sau khi một đơn kết thúc, hai bên còn bao lâu để đánh giá hoặc tố cáo nhau.'
WHERE "key" = 'order.feedback_window_hours';--> statement-breakpoint
UPDATE "system_configs" SET
  "title" = 'Phí nền tảng (điểm cơ bản, 1000 = 10%)',
  "description" = 'Phần nền tảng giữ lại trên mỗi đơn đã thanh toán, tính theo điểm cơ bản (1000 = 10%).'
WHERE "key" = 'order.platform_fee_bps';--> statement-breakpoint
UPDATE "system_configs" SET
  "title" = 'Chế độ bảo trì',
  "description" = 'Khi đang bật (= 1), tài khoản không phải quản trị viên không thể đăng nhập hoặc tạo đơn.'
WHERE "key" = 'system.maintenance_mode';--> statement-breakpoint
UPDATE "system_configs" SET
  "title" = 'Thời gian khiếu nại trước khi trả tiền (giờ)',
  "description" = 'Một phiên đã kết thúc chờ bao lâu thì tiền được tự động trả cho người chơi. Trong khoảng đó, bên nào cũng có thể tố cáo để giữ tiền chờ kiểm duyệt. Giá trị 0 nghĩa là trả ngay ở lần chạy job kế tiếp.'
WHERE "key" = 'order.dispute_window_hours';
