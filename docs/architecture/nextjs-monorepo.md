# Next.js workspace migration

The owner requested Turborepo, Next.js and pnpm on 2026-10-22. This replaces the
Vite/npm portion of D-10; PRD owns the accepted decision. Existing visual design,
URLs, Auth, permissions, registration/withdrawal policies and database migrations
must continue to work. No new product feature or cloud provisioning is included.

Use one full-stack Next.js App Router application in `apps/web`, with real page
routes and dynamic no-store API Route Handlers. Put reusable, browser-safe types,
validation, money formatting and return-path validation in `packages/domain`.
Put verified-identity API orchestration in `packages/api`; it remains server-only
and keeps the existing explicit Postgres RPC contracts. Supabase migrations and
local lifecycle scripts stay at the repository root so the local project/data
identity is preserved. No database reset is required by a source-layout change.

Keep Cloudflare as the existing hosting target through OpenNext's Cloudflare
adapter. Normal development and a Node production start use Next.js; a separate
local adapter build/preview verifies the Workers artifact. Do not provision R2,
change provider accounts or deploy. Do not introduce ISR/private data caching.

pnpm is pinned to the installed 11.14.0. Next.js 16.4.2, Turborepo 2.11.10 and
OpenNext Cloudflare 1.20.13 were checked against current registry metadata and
adapter peer requirements. Preserve existing compatible React/TypeScript pins.
The workspace uses `workspace:*` dependencies and source exports transpiled by
Next.js. Turbo orders type/lint/build dependencies and keeps cache data inside the active
worktree; dev/database/integration tests
are uncached, and credential-bearing build outputs are not remotely cached.

Private credentials stay server-only. Local setup writes an ignored mode-0600
`apps/web/.env.local` consumed by Next.js and an ignored app `.dev.vars` for local
Cloudflare preview. Root test helpers read the same configuration without printing
it. No secret uses a `NEXT_PUBLIC_` name. Public Auth configuration continues to
come from the trusted `/api/config` response. Every API response stays no-store.
OpenNext can incorporate local environment files into its server artifact; treat
those ignored, uncached outputs as credential-bearing and rebuild for each environment.

Native Next links/router replace React Router. A persistent client Auth provider
and identity-keyed private trees keep account isolation and recovery behavior.
Browser-only reads run after mount or in event handlers. Public home HTML is
renderable without JavaScript; protected pages render only a loading shell until
managed identity is established. Unknown pages have HTTP 404, and unknown API
paths retain JSON errors. Manifest/icons and existing mobile/keyboard behavior
remain usable.

Verification: first expose server-rendering/return-path gaps with focused tests;
then run the existing real-local API suite, new page/SSR checks, package type/lint
checks, Next production build/start, Cloudflare adapter build/preview, and actual
browser join/withdrawal/recovery/account-isolation checks. Check a clean frozen
pnpm install, Turbo package graph, cache behavior, secrets/artifact exclusion and
README commands. Evidence and limits belong in the PR, not this design document.
