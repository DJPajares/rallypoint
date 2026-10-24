# Prisma database access

The owner's direct request authorizes converting the backend to Prisma. The implementation uses Prisma ORM 7.10.1 (stable; the latest tag currently selects an 8.0 release candidate), its PostgreSQL adapter and the existing Supabase Postgres database. Supabase Auth and private Storage retain their roles.

## Approaches

Use Prisma to call the existing transactional SQL functions (recommended implementation choice), or rewrite those functions as Prisma/TypeScript transactions. The first preserves the existing authorization, lock ordering, server-clock checks, party queue, exact fee arithmetic, operation receipts and bounded email dispatch. A rewrite would be a separate, substantially larger behavioral migration. The owner selected “Prisma access; keep transactional SQL (Recommended)” in chat on 2026-10-24.

## Contract

- All application and email database calls use a shared server-only Prisma package, with no REST database fallback.
- Existing HTTP payloads, status codes, URLs, SQL migrations, roles and business rules stay intact.
- Database function/schema identifiers come from an explicit allowlist; values are bound parameters with explicit PostgreSQL casts, including nullable UUIDs, JSON, arrays and bigint money.
- Each request or scheduled drain owns its database client and closes it after its work; no cross-request sockets in Workers.
- Direct database credentials remain server-only. The connection executes as `service_role`, preserving the current permission boundary even when local development uses the postgres login. Hosted setup must use a dedicated server database login permitted to assume that role, or the service-role equivalent; no live setup is included.
- Supabase SQL migrations remain authoritative for functions, grants, RLS, triggers and schema recovery. Prisma must not reset, push or migrate an existing database as part of this conversion.
- The local schema may be ahead of this checkout; validation must disclose that fact and preserve existing data.

This is internal infrastructure work; no product UI or new user-facing feature is intended. Cloud provisioning, deployment, spending, integration and external publication remain outside this request.
