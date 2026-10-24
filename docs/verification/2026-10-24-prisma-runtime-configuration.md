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
