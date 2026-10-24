# Prisma Backend Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The direct implementation request and AGENTS.md authorize execution without another brainstorming approval cycle.

**Goal:** Replace Supabase REST database access with Prisma while preserving the current API and transactional rules.

**Architecture:** A shared server-only database workspace package owns Prisma and an allowlisted function adapter. Hono requests and scheduled email drains own and close their clients. Supabase continues to verify identities and serve private files.

**Tech Stack:** TypeScript, pnpm/Turbo, Prisma 7.10.1, PostgreSQL adapter, Hono, Next.js/OpenNext, Supabase.

**Spec:** `docs/superpowers/specs/2026-10-24-prisma-backend-design.md`

## Global Constraints

Preserve HTTP contracts and SQL history. Never log database URLs or raw errors. No deployment or remote changes. Retain service-role authorization and request-scoped sockets. SQL migrations remain authoritative.

## Review Focus

Bound JSON, arrays, nulls and exact bigint amounts; preserve SQLSTATE conflict handling; reject unknown identifiers; clean up failed clients; preserve deployment schema selection and private Storage access.

### Task 1: Prisma function adapter

**Files:** `packages/database/{package.json,prisma.config.ts,prisma/schema.prisma,src/index.ts,src/functions.ts}`, `tests/prisma.test.mjs`, root package/workspace/Turbo configuration.

**Interfaces:** `createDatabase(env)` produces `{ rpc(name,args), close() }`; `rpc` returns `{ data, error: {code,message}|null }` compatible with existing handlers.

- [x] Add failing real-database tests for the missing adapter and URL-option role override; verify JSON/null/array parameters, SQLSTATE errors, service-role enforcement, staging schema selection and identifier rejection.
- [x] Add pinned Prisma dependencies, generation and validation commands, and an explicitly bound SQL function adapter.
- [x] Run the new tests and type checks; inspect results.

### Task 2: Integrate API and email

**Files:** `apps/api/src/{identity,index,sessions,payments,env}.ts`, `packages/email/src/{client,drain}.ts`, `apps/web/{app/api/[[...path]]/route.ts,worker.ts}`, local/staging scripts, existing deployment and email configuration tests.

**Interfaces:** Consume Task 1's database client separately from the Supabase Auth/Storage client; close after each request/drain.

- [x] Update configuration regression tests to require Prisma database connectivity and preserve Auth/Storage behavior.
- [x] Wire DATABASE_URL into local setup, Next runtime and scheduled Workers. Replace every backend REST database call and close clients in finally blocks.
- [x] Run meaningful API integration tests, including permissions, concurrency, queue/fees, retries, QR and email dispatch. Record the identical pre-existing roster assertion failure without altering newer local schema work.

### Task 3: Documentation and verification

**Files:** `README.md`, `PRD.md`, `.env.example`, this plan and a validation record.

- [x] Document the accepted Prisma request, direct connection prerequisite, generated client setup, unchanged SQL migration authority and rollback by reverting the code/configuration change.
- [x] Run adopted lint/type/build/API/SQL checks and build the OpenNext artifact. Exercise the real API and isolated scheduled handler in Workers preview.
- [x] Review the full diff, fix the independent review's role-override finding with a failing-then-passing regression, record versions/environment/date/coverage/gaps, and leave the isolated change for human review without merging or deploying.

Validation and remaining limitations: [review record](../reviews/2026-10-24-prisma-backend-validation.md).
