# Play Together API v2

Node.js + NestJS rewrite of the **Play Together** capstone project (originally ASP.NET Core / EF Core).
It keeps the full domain — hiring gamers, escrow wallet, ratings, reports, behavior points, charities,
admin moderation, chat, notifications, search history and recommendations — behind a redesigned,
consistent REST API at `/api/v2`.

The original .NET source at `C:\Users\manhk\Downloads\RemakeCapstoneProject\PlayTogether-master`
is kept untouched as a reference. This repository is the new implementation.

---

## Highlights

- **NestJS 11 modular monolith** with one module per bounded context.
- **PostgreSQL** through Drizzle ORM, with an embedded **PGlite** driver for zero-install development.
- **Integer VND money**, basis-point fees, append-only ledger and escrow holds.
- **JWT access tokens + rotating refresh tokens** with reuse detection and hashed storage.
- **RFC 7807 problem+json errors** with stable `code` values.
- **Global validation**, rate limiting, helmet, CORS and Swagger.
- **Idempotent seed** with a realistic Vietnamese gaming catalog and demo accounts.
- **Unit + end-to-end tests** (Jest + Supertest) against a real in-memory PostgreSQL.

---

## Tech stack

| Concern | Choice |
| --- | --- |
| Runtime | Node.js >= 20, TypeScript 5 |
| Framework | NestJS 11 (Express adapter) |
| Database | PostgreSQL 17 (prod) or PGlite / WASM Postgres (dev, tests) |
| ORM | Drizzle ORM + drizzle-kit migrations |
| Auth | `@nestjs/jwt`, bcryptjs, refresh-token rotation |
| Validation | class-validator / class-transformer |
| Docs | Swagger UI at `/docs` |
| Tests | Jest, ts-jest, Supertest |

---

## Quick start (embedded database, no Docker)

```bash
npm install
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

npm run db:migrate            # create tables in .data/pgdata
npm run db:seed               # system configs, catalog, admin, charity and demo data

npm run start:dev
```

- API: <http://localhost:3000/api/v2>
- Swagger UI: <http://localhost:3000/docs>
- Health: <http://localhost:3000/api/v2/health>

`PGLITE_DIR=.data/pgdata` keeps everything local and git-ignored. No PostgreSQL server is required.

### Using a real PostgreSQL server

```bash
docker compose up -d postgres   # PostgreSQL 17 on localhost:5432

# .env
DATABASE_DRIVER=postgres
DATABASE_URL=postgres://postgres:postgres@localhost:5432/playtogether

npm run db:migrate && npm run db:seed && npm run start:dev
```

### Production build

```bash
npm run build
npm run start:prod            # runs dist/main.js
```

### Docker

The image is a two-stage build (compile, then a slim runtime) and runs as the unprivileged `node`
user. It enables migrations with `AUTO_MIGRATE=true` and ships a `HEALTHCHECK` on `/health`.

```bash
docker build -t play-together-be .

# Embedded PGlite, persisted in a named volume
docker run -d --name api -p 3000:3000 \
  -e NODE_ENV=production \
  -e AUTO_MIGRATE=true \
  -e JWT_ACCESS_SECRET=change-me-access-secret-at-least-32-chars \
  -e JWT_REFRESH_SECRET=change-me-refresh-secret-at-least-32-chars \
  -v pt-data:/app/.data \
  play-together-be

# Or the whole stack (API + PostgreSQL 17)
docker compose up --build
```

- Without `AUTO_MIGRATE=true`, apply migrations first: `docker compose exec api node dist/db/migrate-cli.js`.
- Seed demo data inside the container: `docker compose exec api node dist/db/seed-cli.js`.
- PGlite writes to `/app/.data/pgdata`; always mount a volume there or the database dies with the
  container. `docker compose up -d postgres` still starts only the database for local development.

### Continuous integration

`.github/workflows/ci.yml` runs on pushes to `main` and on every pull request:

1. `npm ci`, `npm run lint`, `npm run typecheck`, `npm run build`.
2. Unit tests (`npm test`) and end-to-end tests (`npm run test:e2e`, in-memory PGlite).
3. Docker image build, then boots the container and waits until `GET /api/v2/health` succeeds.

No external database service is needed: both the e2e suite and the image smoke test use PGlite.

---

## Seeded accounts

`npm run db:seed` is idempotent: running it again creates nothing and reports `existing` for the
admin and charity accounts.

| Role | Email | Password | Notes |
| --- | --- | --- | --- |
| Admin | `admin@playtogether.local` | `Admin@12345` | Full moderation access |
| Charity | `charity@playtogether.local` | `Charity@12345` | Charity account with wallet |
| 6 demo players | `demo.player1..6@playtogether.local` | `Demo@12345` | Skills, ranks, availability, prices |
| 2 demo hirers | `demo.hirer1..2@playtogether.local` | `Demo@12345` | Pre-funded wallets |

Seed also inserts 26 games, 32 game types, 42 game-type links, ranks for Arena of Valor and
League of Legends, plus one demo donation. Credentials can be overridden with `SEED_*` variables.

> These credentials are for local development only. Change every secret before deploying.

---

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Watch-mode development server |
| `npm run build` / `npm run start:prod` | Compile to `dist/` and run the build |
| `npm run db:generate` | Generate a Drizzle migration from schema changes |
| `npm run db:migrate` | Apply pending migrations |
| `npm run db:seed` | Seed configs, catalog and demo data (idempotent) |
| `npm run db:reset` | Delete only the local `.data` database directory |
| `npm run openapi:export` | Write `openapi.json` from a running server (`OPENAPI_URL` overrides the source) |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (in-memory PGlite) |
| `npm run lint` / `npm run lint:fix` | ESLint (type-aware) |
| `npm run typecheck` | Strict TypeScript check |

`scripts/reset-db.mjs` refuses to delete any path that does not contain `.data`.

---

## API conventions

- **Base path:** `/api/v2` (configurable via `API_PREFIX`).
- **Auth:** `Authorization: Bearer <accessToken>`.
- **Access tokens** live 15 minutes (`JWT_ACCESS_TTL`), **refresh tokens** 30 days by default.
- **Refresh rotation:** every `POST /auth/refresh` returns a new pair and revokes the old token.
  Reusing a revoked token revokes the whole token family.
- **Pagination:** query `page` (default 1) and `pageSize` (default 20, max 100). Responses look like:

  ```json
  {
    "items": [],
    "meta": { "page": 1, "pageSize": 20, "total": 0, "totalPages": 0 }
  }
  ```

- **Errors** use `application/problem+json`:

  ```json
  {
    "type": "https://api.playtogether.local/errors/validation_failed",
    "title": "Bad Request",
    "status": 400,
    "code": "validation_failed",
    "detail": "Request validation failed",
    "instance": "/api/v2/orders",
    "traceId": "3f2c...",
    "details": { "errors": ["gameIds must be an array"] }
  }
  ```

- **Unknown fields are rejected** (`forbidNonWhitelisted`), and all bodies/queries are validated.
- All timestamps are ISO-8601 UTC strings. Business-day logic uses `APP_TIMEZONE`
  (`Asia/Ho_Chi_Minh` by default).

The interactive Swagger UI at `/docs` is the authoritative, always-up-to-date route reference.
Every operation documents a typed success schema, so `openapi.json` is the input for the
[Orval](https://orval.dev) clients generated in `play-together-fe` and `play-together-admin`
(`npm run api:generate` in either app).

---

## Endpoint map

Access: **Public** = no token, **Auth** = any signed-in user, **Admin** = `ADMIN` role.

### Auth

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register` | Public | Create an account after verifying the email (returns a token pair) |
| POST | `/auth/login` | Public | Email + password login |
| POST | `/auth/refresh` | Public | Rotate a refresh token |
| POST | `/auth/logout` | Auth | Revoke a refresh token |
| POST | `/auth/google` | Public | Sign in with a Google ID token (when configured) |
| POST | `/auth/otp/request` | Public | Email a 6-digit one-time code (`REGISTER` or `PASSWORD_RESET`) |
| POST | `/auth/otp/verify` | Public | Verify a code; issues the password-reset token for `PASSWORD_RESET` |
| POST | `/auth/password/change` | Auth | Change the current password |
| POST | `/auth/password/reset` | Public | Consume a reset token |

Registration requires a verified email: request a code with `purpose=REGISTER`, verify it, then
call `/auth/register`. Password reset uses the same pair with `purpose=PASSWORD_RESET`; a successful
verify returns the `resetToken` consumed by `/auth/password/reset` (valid 30 minutes). Codes are
6 digits, valid 10 minutes, allow 5 attempts and at most 5 requests per 15 minutes per email.
Without `SMTP_HOST` the API logs codes instead of sending them and, outside production, returns
them as `devCode`.

### Users and profiles

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/users` | Public | Search players (`q`, `gameId`/`hobbyId`, `genders`, `initial`, city, price, status, `minRating`, `sort`) |
| GET | `/users/me` | Auth | Full profile |
| PATCH | `/users/me` | Auth | Update name, bio, city, avatar, etc. |
| PATCH | `/users/me/status` | Auth | Set presence `ONLINE` / `OFFLINE` |
| PATCH | `/users/me/player-mode` | Auth | Enable/disable accepting hires; price and max hours save either way |
| POST/PATCH/DELETE | `/users/me/skills...` | Auth | Manage offered games, price and rank |
| POST/DELETE | `/users/me/hobbies...` | Auth | Manage hobbies (recommendation signals) |
| GET/POST/DELETE | `/users/me/favorites...` | Auth | Favorite games (idempotent add, remove by game id) |
| POST/DELETE | `/users/me/images...` | Auth | Manage gallery image URLs |
| GET/POST/DELETE | `/users/me/availability...` | Auth | Weekly availability windows |
| GET/POST/DELETE | `/users/me/blocks...` | Auth | Blocked users |
| GET | `/users/:id` | Public | Public profile |
| GET | `/users/:id/availability` | Public | Weekly availability |
| GET | `/users/:id/availability/now` | Public | Is the player available right now? |
| GET | `/users/me/behavior` | Auth | My behavior points and history |
| GET | `/users/:id/behavior` | Public | Public behavior summary |

### Catalog

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/games`, `/games/:id`, `/games/:id/ranks` | Public | Games and ranks |
| GET | `/games/most-favorited` | Public | Games ranked by favorite count |
| GET | `/game-types`, `/game-types/:id` | Public | Genres |
| GET/POST/PATCH/DELETE | `/admin/games...`, `/admin/games/:id/ranks`, `/admin/ranks/:id`, `/admin/game-types...` | Admin | Catalog management |

### Orders

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/orders` | Auth | Hire a player (status `PROCESSING`) |
| GET | `/orders` | Auth | Orders I placed |
| GET | `/orders/requests` | Auth | Orders I received |
| GET | `/orders/:id` | Participant / Admin | Order details |
| GET | `/orders/:id/history` | Participant / Admin | Status timeline |
| POST | `/orders/:id/accept` | Player | Accept, start the session and hold escrow |
| POST | `/orders/:id/reject` | Player | Reject a pending request |
| POST | `/orders/:id/cancel` | Hirer | Cancel a pending request |
| POST | `/orders/:id/complete` | Participant | Settle a session that reached its scheduled end |
| POST | `/orders/:id/end-early` | Participant | Stop early (minimum 10% elapsed) |
| GET | `/orders/:id/ratings` | Participant | Ratings attached to one order |

### Wallet and payments

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/wallet` | Auth | Available / pending balances and upcoming releases |
| GET | `/wallet/transactions` | Auth | Ledger entries |
| GET | `/wallet/earnings/summary` | Auth | Earnings today / this month / total |
| POST | `/wallet/pending-credits/release` | Auth | Release matured pending credits now |
| GET/POST | `/wallet/deposits` | Auth | List top-ups / start a MoMo top-up |
| POST | `/wallet/deposits/:id/confirm` | Auth | Confirm a top-up in mock mode |
| GET/POST | `/wallet/withdrawals` | Auth | List / request withdrawals |
| POST | `/wallet/withdrawals/:id/cancel` | Auth | Cancel a pending withdrawal |
| POST | `/webhooks/momo/ipn` | Public + signature | MoMo IPN callback |

### Ratings and reports

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| POST | `/orders/:id/ratings` | Participant | Rate the other party once per order |
| POST | `/orders/:id/reports` | Participant | Report the other party once per order |
| GET | `/users/:id/ratings`, `/users/:id/ratings/summary` | Public | Reviews and aggregates |
| POST | `/ratings/:id/flag` | Auth | Flag a review |
| GET | `/reports/mine`, `/reports/:id` | Auth | My reports (`scope=submitted\|received`, optional `orderId`) / one report |
| GET/PATCH | `/admin/reports...` | Admin | Queue and decisions |
| GET/PATCH | `/admin/ratings...` | Admin | Flagged reviews and violations |

### Charity

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/charities`, `/charities/:id` | Public | Directory and detail |
| GET | `/charities/:id/donations` | Auth | Donation history for a charity |
| POST | `/charities/:id/donations` | Auth | Donate from wallet balance |
| GET | `/me/donations` | Auth | My donations |
| GET/PATCH | `/me/charity` | Charity | Own charity profile |
| GET | `/me/charity/donations` | Charity | Donations received |
| GET/POST | `/me/charity/withdrawals` | Charity | Charity payouts |
| POST | `/me/charity/withdrawals/:id/cancel` | Charity | Cancel a pending payout |
| GET/POST/PATCH | `/admin/charities...`, `/admin/charity-withdrawals...` | Admin | Charity moderation and payouts |

### Social and platform

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| GET | `/chats` | Auth | Conversations |
| GET | `/chats/:userId` | Auth | Messages with a user |
| POST | `/chats/:userId/messages` | Auth | Send a message |
| POST | `/chats/messages/:id/recall` | Auth | Recall a recent message |
| GET | `/notifications`, `/notifications/unread-count` | Auth | Notifications |
| PATCH | `/notifications/:id/read`, `POST /notifications/read-all`, `DELETE /notifications/read` | Auth | Read state |
| POST/GET | `/feedback`, `/feedback/mine` | Auth | Send and track feedback |
| GET | `/feedback/:id` | Owner | One feedback item (404 for anyone else) |
| GET/POST/DELETE | `/search-history...` | Auth | Search history |
| GET | `/search-history/hot` | Public | Trending searches, aggregated per distinct user |
| GET | `/recommendations/players` | Auth | Content-based player suggestions |
| GET | `/configs` | Public | Public runtime configuration |
| GET/POST/PATCH/DELETE | `/admin/configs...` | Admin | System configuration |
| GET | `/admin/stats` | Admin | Dashboard counters |
| GET/PATCH | `/admin/users`, `/admin/users/:id` | Admin | User moderation |
| POST | `/admin/users/:id/behavior` | Admin | Adjust behavior points |
| GET/PATCH | `/admin/feedback...` | Admin | Feedback triage |
| POST | `/admin/notifications/broadcast` | Admin | Broadcast to all users |
| POST | `/admin/maintenance` | Admin | Toggle maintenance mode |
| GET/PATCH | `/admin/withdrawals...` | Admin | Approve / reject payouts |
| GET | `/health` | Public | Liveness + database round-trip |

---

## Domain rules

### Order lifecycle

```text
PROCESSING ──accept──▶ ACCEPTED ──scheduled end / complete──▶ COMPLETED
     │                    │
     ├─reject────────▶ REJECTED
     ├─cancel────────▶ CANCELLED
     ├─timeout───────▶ EXPIRED
     │                    ├─end early (hirer)──▶ ENDED_EARLY_BY_HIRER
     │                    ├─end early (player)─▶ ENDED_EARLY_BY_PLAYER
     │                    └─admin lock─────────▶ INTERRUPTED (escrow refunded)
```

- A hirer must be `USER`, not in player mode, and `ONLINE`; the player must accept hires and be
  `ONLINE` or `OFFLINE` (not `BUSY`).
- The hirer cannot hire themselves, cannot re-hire while an order is active, and both parties must
  not have blocked each other.
- The selected games must all be offered by the player; duplicates are rejected.
- A hire request expires after `order.response_window_minutes` (5 minutes by default).
- Accepting holds the full price in escrow from the hirer's available balance, marks the player
  `BUSY` and starts the session immediately for `hours` hours.
- Completion splits the escrowed amount: platform fee in basis points (10% default), the rest is
  credited to the player's **pending** balance.
- Ending early requires at least 10% of the booked time. The earned amount grows in real time and
  the unused remainder is refunded to the hirer.
- Pending earnings are released to available balance after `wallet.pending_release_hours`
  (6 hours by default). Background jobs also expire stale requests and auto-complete sessions.

### Money and ledger

- All amounts are **integer VND**, never floats. Fees use basis points (`1000 = 10%`).
- Every balance change writes balanced, append-only `ledger_entries` grouped by a transaction id.
  Accounts are `USER`, `ESCROW`, `CHARITY`, `PLATFORM`, `EXTERNAL`; only user rows carry a UUID
  `account_id` — platform/external rows use `NULL`.
- Withdrawals debit available balance immediately and stay `PENDING` until an admin approves them.

### Ratings, reports and behavior

- Only the two order participants can rate or report each other, only after the order finished,
  and only within `order.feedback_window_hours` (72 hours).
- One rating and one report per participant per order.
- Rating and reporting are mutually exclusive for the same order: a participant either rates the
  other party or reports them, not both.
- Violations approved by an admin adjust behavior points and satisfaction, may refund the hirer,
  and may lock the account immediately.

### Maintenance mode

When `system.maintenance_mode = 1`, non-admin accounts cannot log in, refresh tokens, or create
orders. Admins are exempt.

---

## Database

The schema is created by the Drizzle migrations in `src/db/migrations` (`0000_init` plus the
incremental migrations after it).

| Group | Tables |
| --- | --- |
| Identity | `users`, `refresh_tokens`, `password_reset_tokens`, `email_otps` |
| Profiles | `user_skills`, `user_hobbies`, `user_images`, `user_blocks`, `availability_windows` |
| Catalog | `games`, `game_types`, `game_ranks`, `game_type_links` |
| Orders | `orders`, `order_games`, `order_status_history` |
| Money | `wallets`, `ledger_entries`, `escrow_holds`, `pending_credits`, `deposits`, `withdrawals` |
| Trust | `ratings`, `reports`, `behavior_points`, `behavior_history` |
| Charity | `charities`, `donations`, `charity_withdrawals` |
| Social | `chats`, `notifications`, `feedback`, `search_history`, `system_configs` |

Schema definitions live in `src/db/schema/`. Generate a migration after changing them:

```bash
npm run db:generate
npm run db:migrate
```

---

## Project layout

```text
src/
  main.ts                 Bootstrap: helmet, CORS, validation, Swagger, prefix
  app.module.ts           Root module + global guards/filter
  common/                 Config, DB provider, errors, money, time, pagination, security
  db/
    schema/               Drizzle table definitions and enums
    migrations/           SQL migrations
    client.ts             PGlite / node-postgres connection factory
    seed.ts, seed-cli.ts  Idempotent seed and CLI
    migrate-cli.ts        Migration CLI
  modules/
    auth users catalog orders wallet ratings reports behavior charity
    chat notifications feedback search-history recommendations
    system-config admin jobs health
test/
  env.ts, app.helper.ts   Test environment and app factory
  auth.e2e-spec.ts        Auth, rotation, reset, guards
  marketplace.e2e-spec.ts Full hire → escrow → settle → review → report → moderation flow
  v2-gaps.e2e-spec.ts     Search filters, favorites, wallet, ratings, reports, feedback
```

---

## Testing

```bash
npm test          # unit tests: money, time zones, pagination
npm run test:e2e  # end-to-end: boots the real app against in-memory PGlite
npm run lint      # type-aware ESLint (flat config)
npm run typecheck
npm run build
```

The e2e suites need `--experimental-vm-modules` because PGlite loads its WASM module dynamically;
the npm script already passes the flag. Each suite gets a fresh in-memory database and seeds it
through the same `seed()` function used in development.

Covered end-to-end:

1. Email verification, registration, login, duplicate email, validation, refresh rotation and
   reuse detection, password reset through OTP, protected routes and role guards.
2. Create order → accept → escrow hold → complete → 10% fee → pending credit → rating aggregates.
3. A busy player cannot take a second order.
4. Report → admin approval → refund → behavior penalty → account lock → refresh token revoked.

---

## Configuration

All variables are validated at boot (`src/common/config/env.ts`). See `.env.example` for the full
list; the important ones:

| Variable | Default | Meaning |
| --- | --- | --- |
| `PORT` | `3000` | HTTP port |
| `API_PREFIX` | `api/v2` | Route prefix |
| `APP_TIMEZONE` | `Asia/Ho_Chi_Minh` | Availability and daily boundaries |
| `DATABASE_DRIVER` | `pglite` | `pglite` or `postgres` |
| `PGLITE_DIR` | `.data/pgdata` | Embedded database directory (`memory://` for tests) |
| `DATABASE_URL` | — | PostgreSQL connection string when `postgres` |
| `AUTO_MIGRATE` | dev: `true`, prod: `false` | Apply migrations on boot |
| `JWT_ACCESS_TTL` / `JWT_REFRESH_TTL` | `900` / `2592000` | Token lifetimes (seconds) |
| `BCRYPT_ROUNDS` | `12` | Password hashing cost |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | `60` / `120` | Rate limit window (seconds) and requests |
| `JOBS_ENABLED` / `JOBS_INTERVAL_MS` | `true` / `30000` | Background scheduler |
| `CORS_ORIGINS` | `*` | Comma-separated origins, or `*` |
| `GOOGLE_CLIENT_ID` | empty | Enables Google sign-in when set |
| `MOMO_*` | empty | Enables the live MoMo gateway; empty = mock adapter |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_SECURE` | empty / `587` / `false` | Outgoing mail server; empty = log OTP codes |
| `SMTP_USER` / `SMTP_PASS` | empty | SMTP credentials (omit for unauthenticated relays) |
| `MAIL_FROM` | `Play Together <no-reply@playtogether.local>` | Sender address for OTP emails |
| `EXPOSE_OTP` | dev: `true`, prod: `false` | Return `devCode` when SMTP is not configured |

With no MoMo credentials the payment adapter runs in mock mode: `POST /wallet/deposits` returns a
fake payment URL, and `POST /wallet/deposits/:id/confirm` credits the wallet so the whole top-up
flow works offline.

---

## Porting notes: .NET → Node.js

| Original (.NET) | v2 (Node.js) |
| --- | --- |
| ASP.NET Core 5 controllers + services | NestJS modules, controllers, services and DTOs |
| EF Core + SQL Server | Drizzle ORM + PostgreSQL (PGlite in dev/test) |
| AutoMapper profiles | Explicit mappers such as `toUserSummary()` |
| Hangfire recurring jobs | `BackgroundJobs` idempotent tick, guarded by `JOBS_ENABLED` |
| ML.NET recommendation | SQL content-based recommender (hobbies + recent searches + ranking) |
| Azure Blob image upload | Gallery image URLs managed by the profile API |
| MoMo integration | Adapter with HMAC signing plus an offline mock fallback |
| Default API responses | Redesigned `/api/v2` contract with pagination and problem+json |

Notable fixes and hardening made during the port:

- **Ledger account ids:** platform and external ledger rows originally wrote string labels into a
  `uuid` column, which made settlement, deposits and withdrawals fail. They now store `NULL`, and
  only user accounts carry a UUID.
- **Refresh-token reuse** revokes the entire token family instead of silently issuing new tokens.
- **Money math** uses integer VND and basis points, removing floating-point drift.
- **Concurrency:** order transitions run in transactions with `SELECT ... FOR UPDATE`, and partial
  unique indexes enforce at most one active order per hirer and per player.
- **Time zones:** availability and "today" boundaries are computed with `Intl` in
  `APP_TIMEZONE` instead of server-local time.
- **Input safety:** strict DTO validation with unknown-field rejection, UUID pipes, bounded page
  sizes and global rate limiting.
- **Operational:** health endpoint with a database probe, graceful shutdown, and an idempotent
  seed that is safe to re-run.

---

## License

MIT. The project is a student capstone reimplementation; verify third-party assets and game names
before any commercial use.
