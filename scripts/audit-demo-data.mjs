import 'dotenv/config';
import { cpSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Money-and-history audit for the seeded demo cluster.
 *
 * `SEED_DEMO_HISTORY` writes ten weeks of sessions straight into the tables instead of driving the
 * HTTP endpoints, so nothing checks the result against the rules the services enforce. This reads a
 * snapshot of the cluster and re-derives every number the app shows: wallet balances from the
 * ledger, payouts from the escrow, profile counters from the ratings and orders, and the timestamps
 * of each status hop.
 *
 * The live cluster is copied, never opened for writing, so the API can keep running.
 *
 * Usage: npm run db:audit
 */

const source = resolve(process.cwd(), process.env.PGLITE_DIR ?? '.data/pgdata');
const snapshot = resolve(process.cwd(), '.data/pgdata-audit');

if (!source.includes('.data')) throw new Error(`Refusing to read ${source}: expected a local .data folder.`);

rmSync(snapshot, { recursive: true, force: true });
cpSync(source, snapshot, { recursive: true });
console.log(`Auditing a snapshot of ${source}`);

const db = new PGlite(snapshot);
await db.waitReady;

let failures = 0;
async function expect(label, sql, hint) {
  const { rows } = await db.query(sql);
  const count = Number(rows[0]?.n ?? 0);
  const ok = count === 0;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}${ok ? '' : ` — ${count} row(s): ${hint}`}`);
  if (!ok) failures += 1;
}

// The wallet is a projection of the ledger: everything credited minus everything debited, less the
// earnings whose release is not due yet. See `WalletService.releaseDuePendingCredits`.
await expect(
  'every wallet equals its own ledger minus pending earnings',
  `select count(*)::int as n from wallets w
   left join lateral (
     select coalesce(sum(case when le.direction = 'CREDIT' then le.amount else -le.amount end), 0) as net
     from ledger_entries le where le.wallet_id = w.id and le.account_type = 'USER'
   ) l on true
   left join lateral (
     select coalesce(sum(pc.amount), 0) as held from pending_credits pc
     where pc.wallet_id = w.id and pc.released_at is null
   ) p on true
   where w.available_balance <> l.net - p.held`,
  'wallet row disagrees',
);

// `Math.max(0, …)` in the seeder would hide a negative net, so prove none exists.
await expect(
  'no wallet balance comes out of the ledger negative',
  `select count(*)::int as n from wallets w
   left join lateral (
     select coalesce(sum(case when le.direction = 'CREDIT' then le.amount else -le.amount end), 0) as net
     from ledger_entries le where le.wallet_id = w.id and le.account_type = 'USER'
   ) l on true
   left join lateral (
     select coalesce(sum(pc.amount), 0) as held from pending_credits pc
     where pc.wallet_id = w.id and pc.released_at is null
   ) p on true
   where l.net - p.held < 0`,
  'ledger says the wallet owes money',
);

await expect(
  'every ledger transaction balances to zero',
  `select count(*)::int as n from (
     select transaction_id from ledger_entries
     group by transaction_id
     having sum(case when direction = 'CREDIT' then amount else -amount end) <> 0
   ) t`,
  'unbalanced transaction group',
);

// An escrow that produced a finished session must be drained exactly once.
await expect(
  'finished sessions drained their escrow completely',
  `select count(*)::int as n from orders o
   left join escrow_holds h on h.order_id = o.id
   where o.status in ('SETTLED','ENDED_EARLY')
     and (h.id is null or h.status not in ('SETTLED','PARTIALLY_SETTLED')
          or h.settled_amount is null or h.settled_amount + h.refunded_amount <> h.amount)`,
  'escrow row missing or not drained',
);

await expect(
  'the payout on the order is the settled amount minus the platform fee',
  `select count(*)::int as n from orders o
   join escrow_holds h on h.order_id = o.id
   where o.status in ('SETTLED','ENDED_EARLY')
     and o.player_payout is distinct from
         (h.settled_amount - round(h.settled_amount * o.fee_bps / 10000))`,
  'payout disagrees with money.ts',
);

await expect(
  'the platform fee in the ledger equals the fee on the order',
  `select count(*)::int as n from orders o
   join escrow_holds h on h.order_id = o.id
   join ledger_entries le on le.order_id = o.id and le.account_type = 'PLATFORM'
   where o.status in ('SETTLED','ENDED_EARLY')
     and le.amount <> h.settled_amount - o.player_payout`,
  'fee row disagrees with the order',
);

// Nothing that already happened may be stamped with a time the clock has not reached.
await expect(
  'no recorded event is dated in the future',
  `select count(*)::int as n from (
     select created_at as at, 'order' as what, id from orders where created_at > now() or updated_at > now()
     union all select ended_at, 'ended order', id from orders where ended_at > now()
     union all select created_at, 'status hop', id from order_status_history where created_at > now()
     union all select created_at, 'ledger row', id from ledger_entries where created_at > now()
     union all select completed_at, 'deposit', id from deposits where completed_at > now()
     union all select updated_at, 'escrow', id from escrow_holds where updated_at > now()
     union all select released_at, 'pending credit', id from pending_credits where released_at > now()
     union all select created_at, 'rating', id from ratings where created_at > now()
   ) future where at is not null`,
  'future-dated row',
);

// Money may sit in `pending_credits` past its release time while the API is stopped, but it can
// never be stamped released before it comes due.
await expect(
  'no earning is released before it comes due',
  `select count(*)::int as n from pending_credits
   where released_at is not null and released_at < available_at`,
  'released ahead of available_at',
);

await expect(
  'every earning belongs to a session that actually finished',
  `select count(*)::int as n from pending_credits pc
   join orders o on o.id = pc.order_id
   where o.status not in ('SETTLED','ENDED_EARLY') or o.ended_at is null`,
  'earning on an unfinished session',
);

// A session that ran to its booked end went through the objection window first.
await expect(
  'a settled session records the window it passed through',
  `select count(*)::int as n from orders o
   where o.status = 'SETTLED'
     and (o.disputed_at is null
          or not exists (select 1 from order_status_history h
                         where h.order_id = o.id and h.to_status = 'DISPUTED'))`,
  'settled without a dispute hop',
);

await expect(
  'a session never ends after its booked slot unless it was cut short',
  `select count(*)::int as n from orders
   where status in ('SETTLED','ENDED_EARLY')
     and scheduled_end_at is not null and ended_at > scheduled_end_at`,
  'ended after the slot',
);

await expect(
  'an open request still has time to be answered',
  `select count(*)::int as n from orders where status = 'PROPOSED' and respond_by <= now()`,
  'the scheduler would close it',
);

// Money must not be able to leave the platform twice for one session.
await expect(
  'one escrow hold per session',
  `select count(*)::int as n from (
     select order_id from escrow_holds group by order_id having count(*) > 1
   ) t`,
  'duplicated hold',
);

await expect(
  'money sits in escrow only while its session is still ahead or running',
  `select count(*)::int as n from escrow_holds h
   join orders o on o.id = h.order_id
   where (h.status = 'HELD' and o.status not in ('SCHEDULED','LIVE'))
      or (h.status <> 'HELD' and o.status in ('SCHEDULED','LIVE','PROPOSED'))`,
  'escrow state out of step with the order',
);

await expect(
  'ratings only ever go between the two parties of their session',
  `select count(*)::int as n from ratings r
   join orders o on o.id = r.order_id
   where r.ratee_id = r.rater_id
      or (r.rater_id <> o.hirer_id and r.rater_id <> o.player_id)
      or (r.ratee_id <> o.hirer_id and r.ratee_id <> o.player_id)
      or r.rate < 1 or r.rate > 5`,
  'rating out of contract',
);

await expect(
  'nobody rates the same session twice',
  `select count(*)::int as n from (
     select order_id, rater_id from ratings group by order_id, rater_id having count(*) > 1
   ) t`,
  'duplicate rating',
);

await expect(
  'player counters on the profile match the tables behind them',
  `select count(*)::int as n from users u
   where exists (select 1 from user_skills s where s.user_id = u.id)
     and (u.rating_sum, u.rating_count, u.orders_count, u.completed_orders_count, u.on_time_count) <> (
       select coalesce(sum(case when r.is_active then r.rate else 0 end), 0)::int,
              count(r.id) filter (where r.is_active)::int,
              (select count(*)::int from orders o2 where o2.player_id = u.id),
              (select count(*)::int from orders o3 where o3.player_id = u.id and o3.status in ('SETTLED','ENDED_EARLY')),
              (select count(*)::int from orders o4 where o4.player_id = u.id and o4.status = 'SETTLED'
                 and o4.ended_at is not null and o4.scheduled_end_at is not null and o4.ended_at <= o4.scheduled_end_at)
       from ratings r where r.ratee_id = u.id
     )`,
  'stored counter is stale',
);

await expect(
  'every notice points at a session that exists',
  `select count(*)::int as n from notifications nt
   where nt.reference_url is null
      or not exists (select 1 from orders o where '/orders/' || o.id = nt.reference_url)`,
  'dangling notification',
);

await expect(
  'a read notice was read between arriving and now',
  `select count(*)::int as n from notifications
   where (status = 'READ' and (read_at is null or read_at < created_at or read_at > now()))
      or (status = 'UNREAD' and read_at is not null)`,
  'read state disagrees with read_at',
);

// A booked slot is the one moment the platform promises, so the demo must not hand the tester a
// calendar that already ran out: any session still in SCHEDULED starts after the clock.
await expect(
  'a booked session is still in the future',
  `select count(*)::int as n from orders
   where status = 'SCHEDULED'
     and (starts_at is null or scheduled_end_at is null or starts_at <= now())`,
  'the calendar has nothing coming up',
);

await expect(
  'the session chart has a bar for every day of the last fortnight',
  `select count(*)::int as n from generate_series(current_date - 13, current_date, interval '1 day') d(day)
   left join (
     select date_trunc('day', created_at) as day, count(*) as n from orders group by 1
   ) o on o.day = date_trunc('day', d.day)
   where coalesce(o.n, 0) = 0`,
  'a day with no sessions',
);

const summary = await db.query(`
  select
    (select count(*) from orders) as orders,
    (select count(*) from ratings) as ratings,
    (select coalesce(sum(amount), 0) from ledger_entries
      where account_type = 'USER' and direction = 'CREDIT' and type = 'ORDER_EARNING') as earnings,
    (select coalesce(sum(amount), 0) from ledger_entries
      where account_type = 'PLATFORM') as fees,
    (select coalesce(sum(amount), 0) from escrow_holds where status = 'HELD') as held,
    (select coalesce(sum(amount), 0) from pending_credits where released_at is null) as pending,
    (select count(*) from notifications) as notices,
    (select count(*) from notifications where status = 'UNREAD') as unread
`);
console.log('   summary:', JSON.stringify(summary.rows[0]));

const statuses = await db.query('select status, count(*)::int as n from orders group by status order by status');
console.log('   orders:', statuses.rows.map((r) => `${r.status}=${r.n}`).join(' '));

await db.close();
rmSync(snapshot, { recursive: true, force: true });

if (failures > 0) {
  console.error(`\n${failures} check(s) failed.`);
  process.exit(1);
}
console.log('\nAll checks passed.');
