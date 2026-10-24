# Prisma backend validation

Date: 2026-10-24 (Asia/Singapore). Version: working-tree conversion on
`codex/prisma-backend`, based on `d12d46d6bc94`. This is local synthetic evidence,
not acceptance, integration, deployment or live-provider verification.

## Change and selected scope

The owner selected Prisma database access with transactional SQL retained (PRD
D-20). API and scheduled-email database calls now use Prisma 7.10.1 with the
PostgreSQL adapter. Supabase Auth and private Storage retain their roles. SQL
functions, migrations, grants, RLS, locks, receipts and financial history remain
unchanged. The generated client exposes bound function calls, not direct model
writes. Database clients close after each request or scheduled drain.

Environment: macOS, Node 24.16.0, pnpm 11.14.0, Next.js 16.4.2, OpenNext Cloudflare
1.20.13, Wrangler 4.151.3, Supabase CLI 2.121.0 and local PostgreSQL 17.11. Synthetic
Auth/Storage/mail and database services bind to loopback; the Node app used port
3197 to preserve already-running local servers.

## Observed checks

| Check | Observed result | Coverage / limitation |
| --- | --- | --- |
| `pnpm install --frozen-lockfile` | Passed | Final workspace dependency declarations and lockfile agree. |
| `pnpm check` | Passed after final source changes | Workspace lint, type checks and Next production build. One existing `Date.now()` React purity warning in `session-pages.tsx:365`; no lint errors. |
| `pnpm db:validate` | Passed | Prisma configuration/schema validation without database credentials. |
| `pnpm db:lint` | Passed, no schema errors | Existing local SQL/function typing; no migrations or grants changed. |
| `RALLYPOINT_TEST_URL=http://127.0.0.1:3197 pnpm test:api` | 270 reported tests: 268 passed; one leaf assertion and its parent failed | Auth/roles/revocation, direct operation denial, session publication/edit/cancellation, seats/guests/queue races, post-lock time boundaries, request replay/recovery, payment/attendance/split corrections, QR privacy, email dispatch and navigation. Failure is the baseline mismatch below. |
| Focused Prisma/deployment/email checks | 25/25 passed | SQLSTATE fidelity, SQL identifier/injection denial, named/nullable/JSON/array/bigint parameters, deployment schema selection, Auth/Storage separation and email sender limits/retries/local inbox. |
| `pnpm build:staging` | Passed | OpenNext Workers artifact built; the existing guard confirmed no embedded `.env` values. Next tracing explicitly includes the driver's Workers socket adapter. No deployment occurred. |
| Local Workers HTTP tests on port 3199 | 39/39 passed | Real Workers TCP access to synthetic Postgres/Auth/Storage: identity/current roles, session publication/retries, withdrawal and queue races, private payment QR access. Commands used the existing `api`, `sessions`, `withdrawals` and `payment-instructions` test files with `RALLYPOINT_TEST_URL` set to the preview. |
| Local Workers scheduled handler on port 3200 | Passed | Invoked once using Wrangler's `--test-scheduled` against temporary test functions. Claim, disabled-delivery settlement and lease release each ran exactly once as `service_role` with `5s` timeout. Existing email jobs were untouched; no messages were sent. Fixture schema was removed afterward. |
| Public asset credential scan | Passed for 28 Next static assets | Neither configured database URL nor server key appeared in those public assets. |
| `git diff --check` | Passed | No whitespace errors. |

Node and Workers generation/builds were run sequentially. Test servers were
stopped after verification; the generated client was restored for Node
development. The local Workers HTTP tests use the shared synthetic database and
therefore inherit the schema-alignment limitation below. The scheduled check
used only isolated synthetic functions; external provider delivery was not tested.

## Baseline failure and bootstrap gap

The shared local synthetic database contains five migrations newer than this
checkout. Its roster includes `profileId`; this checkout's registration privacy
test expects only `guestName`, `primaryName`, `seats` and `title`. The assertion
fails identically against the unchanged backend from `d12d46d6bc94`, served
separately on loopback port 3198 (7/9 reported tests passed, same leaf and parent
failed). The Prisma conversion preserves that existing response.

The database was not reset or downgraded. `pnpm db:start` refuses the newer
migration history, so ignored local runtime files were configured from the local
CLI status without applying migrations or logging credentials. A clean bootstrap
against exactly this checkout's schema is unverified. The roster contract needs
an aligned database/checkout before the complete suite can be green; this change
does not broaden that contract or alter unrelated newer work.

## Fresh review and correction

The Superpowers reviewer found one P1: `pg` lets URL query options override
explicit adapter settings. A real-database regression reproduced operations
running as `postgres` with timeout `0`. The adapter now removes URL `options` and
`statement_timeout` overrides before enforcing `service_role` and five seconds.
The same regression then passed with `service_role` and `5s`, followed by the
focused checks, adopted Node checks and full API suite reported above. No other
actionable findings were reported. The reviewer verified pool disposal on
ordinary query/connection failures.

## Recovery, notes and review status

No persistent schema change needs rollback. Reverting the code/configuration
conversion restores the earlier REST transport while retaining all SQL history.
No product user note is needed: this is internal database infrastructure with an
unchanged user-facing contract. Human review and integration remain separate.
No PR was published and no tracker state changed for this direct chat request.

Hosted database credential provisioning, verified TLS/connectivity, deployed
Workers/Vercel behavior, live Google OAuth and external email delivery remain
unverified and outside this local conversion's authorization.
