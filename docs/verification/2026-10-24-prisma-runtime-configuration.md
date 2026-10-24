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
