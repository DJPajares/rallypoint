# Prisma runtime configuration diagnosis

Date: 2026-10-24 (Asia/Singapore). Live baseline: Vercel deployment
`dpl_8HV295wc1ZeAZW19XQ16Jhq4n8c2`, source `55b8c36d6a78`, serving
`rallypoint.wndrhive.com` after the owner merged Prisma PR #34.

Observed read-only checks:

- `/api/health`: 200, `status: ok`.
- `/api/config`: 200, Auth configured. This checks Auth configuration, not SQL.
- Public session and profile reads using a nonexistent synthetic UUID: 503.
- Vercel environment metadata, read without decrypting values: Supabase Auth/API
  configuration exists for Production; `DATABASE_URL` is absent.
- Scoped Vercel error/fatal logs had no records. The adapter returns a sanitized
  unavailable result when the connection string is missing, so this diagnosis
  used configuration metadata and API boundaries instead of raw driver errors.

Cause: Prisma's required direct Postgres connection was never configured on the
live Vercel target. Supabase API keys cannot replace a PostgreSQL password/URL.
No database schema, role, shared password or infrastructure settings were changed.

Required recovery: the owner enters the existing connection string as Sensitive
`DATABASE_URL` for Production using Vercel's dashboard, followed by a redeployment
and public/authenticated API verification. The credential must stay out of chat,
source, logs and review artifacts. See the [deployment guide](../deployment/staging.md).

Status at diagnosis: unresolved pending secure credential entry. This record does
not claim restored API behavior, a new deployment, or live authenticated testing.

## Local failure and recovery

The owner's running local checkout used local Supabase Auth/Storage and the
default `api` schema, but its newly entered `DATABASE_URL` selected a hosted
Supabase Session pooler. A read-only metadata query connected successfully and
confirmed that database has `rallypoint_api`, not `api`. This was a configuration
mismatch, independent of the missing Vercel variable above.

Only `DATABASE_URL` was restored to the matching local synthetic database in
the running checkout's `.env.local` and `.dev.vars`. Original files were retained
in ignored mode-600 backups; no credential value was logged or committed. The
running app reloaded without a restart. Both public synthetic missing-record reads
now return 404; synthetic authenticated reads of `/api/me`, `/api/workspace`,
`/api/dues`, `/api/me/sessions`, `/api/me/profile` and `/api/me/badges` returned 200.

## Pooled-role correction

The hosted metadata check also showed `current_user=postgres`: the Session pooler
ignored the startup role option. The adapter now starts a Prisma transaction,
executes fixed `SET LOCAL ROLE service_role` and `SET LOCAL statement_timeout='5s'`
commands, then runs the allowlisted function on the same connection. The settings
end with the transaction. Existing SQL locks, receipts and function definitions
remain unchanged.

A local real-Postgres regression models a pooler returning a connection as its
login role with timeout zero. Old code returned `postgres`/`0`; fixed code returned
`service_role`/`5s`. All six focused adapter tests passed. A read-only review found
no actionable issue in the transaction/cleanup/error behavior. A separate attempt
to use certificate-verified TLS with the hosted URL failed certificate validation;
no TLS bypass was introduced. Hosted rollout still needs its trusted CA/connection
configuration and the owner-managed Vercel secret. Local recovery above is observed
and does not claim those hosted prerequisites are complete.

Local branch validation: the complete adopted API suite passed 315/315 on loopback
port 3197 after the transaction change. Lint, type checks and the Next production
build passed. This includes role denial/revocation, simultaneous joins, queue and
withdrawal races, retries, fees, attendance, profiles and email dispatch behavior.
The OpenNext Workers build and environment-isolation guard passed, followed by
23/23 local Workers authorization and withdrawal/queue checks. No hosted data,
credential, schema or deployment changes were made during these checks.

## Continued failure: deployed application ahead of the database

Follow-up on 2026-10-24: the owner has now supplied Production `DATABASE_URL`.
The active Vercel deployment is `dpl_4DWheLhrwP9FarjAuMPkrPsUNUnB`, from
`main` at `55b8c36d6a78`. Read-only stable-host probes returned health/config 200,
correct signed-out 401 responses for me/profile/sessions, a missing synthetic
session 404, and a missing synthetic public profile 503. This establishes a
working database connection, but not a complete application database contract.

Catalog inspection found only 33 of the 38 allowlisted API functions. All 33
existing functions have the expected named arguments/types and service-role
execute permission. The missing functions are `list_my_sessions`,
`ensure_my_profile`, `read_my_profile`, `save_my_profile`, and `read_profile`;
`rallypoint.profiles` is also absent. `/api/me` calls `ensure_my_profile` to resolve
the displayed name. Joining and organizer actions that resolve an actor name
(payment, attendance, split finalization/correction, cancellation and payment
instructions) are affected by the same missing dependency. Auth success and a
healthy `/api/health` response cannot establish those paths work.

The hosted migration history stops at `rallypoint_staging_upgrade_20261023`.
Its 95 function definitions exactly match the local source baseline through
`20261023144000` (MD5 `53b0a936b162b0555bf193e879cd1761`). Its columns,
constraints, indexes, triggers and policies also match that baseline (MD5
`bd23e4157e2c634a18be9ea48d7ed772`). All 26 existing application tables retain
RLS; no application table or function is accessible to browser roles. No
additional signature/grant mismatch was found in the broader function audit.

### Prepared repair and observed rehearsal

`node scripts/render-staging-schema.mjs --upgrade-sessions-profiles` emits only
these pending source migrations, with the established namespace mapping:

- `20261023150000_my_sessions.sql`
- `20261023151000_my_sessions_cancelled_drafts.sql`
- `20261024090000_profiles.sql`
- `20261024091000_one_name.sql`
- `20261024100000_profile_fixes.sql`

Rendered SQL SHA-256:
`35e4f03d4b336a2ee99c913473fc6ec2b92c2a8db8bc9944c4824c5f971cbd0e`.
It requires an atomic transaction and refuses function/table/security drift,
partial installations and repeats. The historical `--upgrade` artifact's hash
is unchanged. This adds profiles and the five missing API functions, updates one
existing roster function, and carries the accepted current account name onto
seven stored-name columns. It does not change seat, fee, payment, attendance or
notification states. The name backfill is an intentional persistent change.

Reproduce with `node scripts/rehearse-sessions-profiles.mjs` against the local
Docker Supabase database. It creates and removes isolated synthetic databases;
it never reads a hosted URL or existing application records. Observed:

- All 26 existing tables' records preserved byte-for-byte after omitting only
  the seven intended stored-name columns; all seven populated columns refreshed.
- 101 resulting function definitions (MD5 `151b1745055dd6be3f5c4336ff60f503`);
  all 38 API functions match named arguments/types and allow service-role use.
- All 27 application tables have RLS; zero browser-executable functions.
- Profile creation/read, public profile and Sessions functions execute under
  `service_role`; the public profile has no account ID.
- Failure injected after the final migration rolls back functions, profiles and
  existing name writes together. Function, table, column, RLS and permission
  drift are rejected, as is a second application.
- A synthetic baseline backup restores into a separate database with identical
  existing records and function definitions. An unrelated schema sentinel survives.

A reviewer identified the initial function-only drift guard as incomplete; the
repair now checks table shape, RLS and browser/service function privileges too,
with negative rehearsal cases. No hosted migration or deployment was performed.
The shared-database application requires separate owner authorization under
AGENTS.md, then a verified private recovery copy of affected names/keys and the
replaced function definition, atomic application with one RallyPoint migration
entry, and post-application checks. Retain successful database changes on a code
rollback; any data restoration or schema reversal requires a reviewed scoped
repair. Live authenticated browser verification remains outstanding.

Final prepared-repair checks on 2026-10-24: `pnpm test:api` passed 316/316
against local synthetic Auth/Postgres and loopback app port 3000; migration
renderer tests passed 3/3; the isolated migration/rollback/recovery rehearsal
passed. `pnpm lint`, `pnpm typecheck`, `pnpm build`, direct lint of the changed
scripts/tests, and `git diff --check` passed. Workspace lint retains the existing
React render-time `Date.now()` warning in `session-pages.tsx`; zero lint errors.
No application UI behavior was changed by this migration-preparation addition.

The reviewer's security-drift finding was addressed and exercised locally.
A second subagent review could not run because its account usage limit was
reached; the final guard was self-reviewed and tested with the negative cases
above. The earlier transaction-runtime review remains separate evidence.

Automatic approval review rejected preparation of a hosted recovery copy because
exporting real participant names/IDs into a persistent encrypted local file had
not been explicitly authorized. No export or hosted write was performed, and
no alternative export was attempted. Owner approval must cover that narrow
seven-table field/key backup and its private recovery verification as well as
the shared-database migration. This is still a prepared repair, not restored
hosted API evidence. User note: once the missing migration is applied, account,
Profile and Sessions reads regain their required database functions; current
names are refreshed consistently across existing RallyPoint records.

## Prisma Migrate applied locally and to production

The owner subsequently requested: “Apply this prisma migration script. For both
local and prod.” This explicitly authorized the database application. The owner
preferred applying migrations rather than the proposed participant-data export;
no real names, account IDs or credentials were exported into a recovery file.

Prisma 7.10.1 now deploys deterministic SQL migrations rendered from the existing
`supabase/migrations` sources. Source SQL/functions remain authoritative; the
runner maps `app`/`api` to `rallypoint`/`rallypoint_api` for production and isolates
its ledger in `rallypoint_migrations._prisma_migrations`. Other applications'
history and the original Supabase ledger are untouched. Every migration has
explicit `BEGIN`/`COMMIT`. Applied checksums are verified before deployment.
Connection query parameters cannot override the validated host/port/credentials.
Commands regenerate the Node client before Node-side migration work.

Observed 2026-10-24 (Asia/Singapore):

- **Local:** all 37 source migrations were already present. Prisma adopted
  `0_rallypoint_baseline_20261023144000` and
  `20261024100000_sessions_profiles` without replaying SQL. A newer local
  `group_edit` migration from another branch was preserved, including its extra
  functions; it was not copied to production or undone.
- **Production:** Prisma marked the verified existing 95-function baseline
  applied, then `prisma migrate deploy` successfully committed the five pending
  Sessions/Profile source changes as `20261024100000_sessions_profiles`.
  Baseline checksum:
  `4dcbc5ee5868b17b5a5a1d03107d1fed97efee28b2bf5be197c8c2f478a31297`.
  Repair checksum:
  `9fc8fb238d5d0b3331a8703e74499d9044b20cdeb37025917f07d6bf8f661d80`.
  Both Prisma rows are finished, with no failed migration.
- The resulting 101 function definitions match expected fingerprint
  `151b1745055dd6be3f5c4336ff60f503`; all 38 API signatures and service-role
  execute permissions match. All 27 application tables retain RLS, no browser
  role can execute an application function, and browser roles cannot access the
  migration-history schema.
- Counts and hashes across all 26 pre-existing RallyPoint tables are unchanged
  after excluding only the seven intended current-name fields. A fingerprint of
  1,357 unrelated schema/relation/function/constraint/index/trigger/policy metadata
  records is unchanged (`5ea879bdb8102ddf6a7b7f8a04bf969f`). This is aggregate
  preservation evidence, not a row-data backup.
- Production my-profile, Sessions and public-profile SQL reads succeeded under
  `service_role` for existing profile records. An existing public profile
  returned HTTP 200. Synthetic missing profile and shared-session reads return
  HTTP 404 / `not_found` instead of database-unavailable errors. Health/config
  return 200; signed-out private endpoints correctly return 401.
- Synthetic authenticated local reads of me, my profile, Sessions, workspace,
  dues and badges all return 200. The full adopted API suite passed **318/318**
  against the local running app on port 3000. `pnpm check` passed lint, types and
  Next production build; lint retains the existing render-time `Date.now()`
  warning, zero errors.
- `node scripts/rehearse-prisma-migrations.mjs` passed actual Prisma deployment,
  injected-failure rollback, explicit failed-migration resolution, successful
  retry and repeat/no-op for both namespace mappings in disposable synthetic
  databases. It also covers a fresh Prisma-only database without legacy history
  and rejects an altered applied checksum. The earlier data-preservation
  rehearsal remains applicable because the same source SQL was reused.
- Review found URL query-override and Node/Workers-client lifecycle problems.
  Both were fixed and checked; final read-only review found no remaining
  material finding. New target-validation cases failed before the guard and
  passed after it. Focused renderer/migration tests passed 5/5.

Local and production repeat runs are safe no-ops for application SQL. The
production app was not redeployed or merged during this database operation;
Vercel remains on its existing application build. The pooled-runtime code in
PR #35 still requires human review/merge. A signed-in production browser session
was unavailable, so authenticated production HTTP checks of me/profile/Sessions
remain a gap; successful service-role function reads and public HTTP reads are
separate evidence. No email/OTP was sent and no shared Auth user was created.

User note: the live database now supports account names, Profile and Sessions.
Existing records use the accepted current-name backfill; seat, fee, payment,
attendance and notification states were preserved. Successful data backfills
cannot be reversed from Prisma migration history alone; use a reviewed forward
repair or an existing authorized recovery source rather than dropping schemas.
