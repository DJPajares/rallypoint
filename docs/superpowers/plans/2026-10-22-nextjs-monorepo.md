# Next.js monorepo implementation plan

> **For agentic workers:** Execute inline with superpowers:executing-plans; preserve the project's direct-request workflow.

**Goal:** Convert RallyPoint to a pnpm/Turborepo Next.js workspace while preserving its current product behavior.

**Architecture:** One Next.js app owns routes and runtime adaptation. Browser-safe domain code and server-only API code are workspace packages; authoritative data/migrations remain unchanged.

**Tech Stack:** pnpm 11.14.0, Turbo 2.11.10, Next.js 16.4.2, OpenNext Cloudflare 1.20.13, existing compatible React/TypeScript/Supabase versions.

**Spec:** `docs/architecture/nextjs-monorepo.md`

## Global constraints

Preserve all current public/private URLs, API payloads, financial/queue policy and local database identity. Secrets stay server-only; do not cache integration results or credential-bearing builds. No deployment, provider migration or new product scope.

## Review focus

- Browser-only globals during SSR: exercise valid auth return paths without a browser.
- Deep links and missing pages: exercise production HTTP statuses and native navigation.
- Private state across route/account changes: verify browser sign-out and another identity.
- Turbo stale results/environment: inspect task graph and uncached live tests.
- Cloudflare versus Node behavior: run API checks against both available local runtimes.

### Task 1: Native routes, workspace and runtime migration

**Files:** Create `apps/web/app/**`, app runtime/config, workspace manifests, `packages/domain`, `packages/api`; move existing UI/shared/API code; update root scripts, tests, README, AGENTS technical commands and PRD stack decision.

**Interfaces:** Preserve all `/api/**` contracts and public page URLs. App Route Handlers call `@rallypoint/api` with runtime-only environment; browser and API consume `@rallypoint/domain` source exports.

- [x] Add focused tests for SSR home HTML, deep-link/404 behavior, assets, and safe auth return paths without browser globals; observe the missing behavior.
- [x] Move source into workspace packages; replace Vite/React Router with native App Router pages, layout, links and Route Handlers; make SSR-sensitive reads safe.
- [x] Add pinned pnpm workspace/Turbo graph, local configuration/lifecycle commands and Cloudflare adapter; preserve root migrations and same-origin Auth callback.
- [x] Run package checks, existing API regression suite, new page/SSR tests, Next build/start and local adapter build/preview; inspect every failure before fixing.
- [x] Exercise production navigation, verified sign-in, publication, guest joining, withdrawal, lost-response recovery, mobile/keyboard and account isolation in a real browser.
- [x] Update setup/decision docs; verify clean frozen install, browser/source secret exclusion and full diff.

Delivery follows AGENTS.md: commit/push the isolated branch, create the authorized
review PR with evidence and limits, then stop for human review.

## Execution notes

Direct implementation is already authorized by the owner's request and AGENTS.md's direct-request rule; the skill's additional design/plan approval handoffs do not reopen that authorization. Implementation remains inline in the existing isolated worktree. The requesting-code-review skill requires one independent review; a read-only reviewer inspected the migration, and its shared-config cache finding was reproduced and fixed. No implementation work was delegated.
