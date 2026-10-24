# RallyPoint phone staging

Owner-authorized 2026-10-23. Primary test host: https://rallypoint.wndrhive.com on Vercel, project `rallypoint`. The existing Cloudflare host remains available at https://rallypoint-staging.dj-pajares.workers.dev. These hosts use the same staging data; neither is a production-launch claim.

## Boundaries

- Vercel project: `rallypoint` (`prj_c01PwcRq12aFKOp27xsShGDFhHNf`), team `wonderBots` (`djpajares-projects`), Node 24 / Next.js, function region `sin1`. Renaming the existing project preserves its ID, environment variables and deployed application.
- Cloudflare Worker: `rallypoint-staging`, separate from other applications and retained at the owner's request. Keep its existing name and configuration so deployment commands continue targeting the running Worker.
- Existing Supabase **wProject** (`zqidfkofbzusvpikftdf`) in `wndrhive`, selected by the owner because both free project slots are occupied.
- App tables/functions: `rallypoint`; backend RPCs: `rallypoint_api`; private QR bucket: `rallypoint-payment-qr`.
- Auth is shared at the Supabase-project level. It cannot have an independent RallyPoint user directory in this project. Use an existing wProject account for phone testing. Application groups, roles, sessions and badges remain in RallyPoint's schemas.
- Existing Trove/watchlist schemas, users, storage buckets, provider settings, SMTP, templates and Trove site URL are preserved. Only the exact RallyPoint callbacks are appended to the existing redirect list.
- The owner approved verified email codes for this staging environment. wProject uses eight digits; local synthetic Auth uses six. Google remains disabled here.
- This is test deployment work, not a production launch. Session notification delivery remains P-06; no new Resend key or notification sender is enabled here.

## Cloudflare runtime configuration

Use `apps/web/wrangler.staging.jsonc`. Put `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY` in Cloudflare's runtime secret storage; never commit them or pass them as command-line values. The server key is project-wide: schema separation is application isolation, not independent project credentials.

The tracked config sets `SUPABASE_API_SCHEMA=rallypoint_api`, `PAYMENT_QR_BUCKET=rallypoint-payment-qr`, `EMAIL_AUTH_ENABLED=true`, `EMAIL_OTP_LENGTH=8`, `GOOGLE_AUTH_ENABLED=false` and `LOCAL_AUTH_ENABLED=false`.

The existing email form does not create new shared-project users. Enter the email of an existing wProject account and verify the code. Provider rate limits and shared email templates still apply. Real inbox delivery and phone installation must be checked on the user's device; API verification alone does not establish either.

## Vercel configuration and deployment

Use the [RallyPoint Vercel project](https://vercel.com/djpajares-projects/rallypoint). Its custom domain is `rallypoint.wndrhive.com`; use this address for phone tests and the exact Supabase redirect `https://rallypoint.wndrhive.com/auth/callback`. Preserve all existing redirects, including Cloudflare's callback, and the shared Trove Site URL. Renaming this Vercel project does not rename the Supabase project, schemas, bucket or Cloudflare Worker.

In [Environment Variables](https://vercel.com/djpajares-projects/rallypoint/settings/environment-variables), use **Production** for this staging project's stable deployment:

| Variable                       | Value                                                                 |
| ------------------------------ | --------------------------------------------------------------------- |
| `SUPABASE_URL`                 | `https://zqidfkofbzusvpikftdf.supabase.co`                            |
| `SUPABASE_PUBLISHABLE_KEY`     | Existing wProject publishable key; owner enters through the dashboard |
| `SUPABASE_SECRET_KEY`          | Existing wProject server key; owner enters as Secret/Sensitive        |
| `DATABASE_URL`                 | Existing wProject Postgres connection string; owner enters as Secret/Sensitive, with the existing database password |
| `SUPABASE_API_SCHEMA`          | `rallypoint_api`                                                      |
| `PAYMENT_QR_BUCKET`            | `rallypoint-payment-qr`                                               |
| `EMAIL_AUTH_ENABLED`           | `true`                                                                |
| `EMAIL_OTP_LENGTH`             | `8`                                                                   |
| `GOOGLE_AUTH_ENABLED`          | `false`                                                               |
| `LOCAL_AUTH_ENABLED`           | `false`                                                               |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1`                                                                   |

Use the names shown; never add `NEXT_PUBLIC_` to the server key. Credentials are dashboard-managed and must not be copied into source, chat, local upload files or review artifacts. The owner elected to enter Vercel credentials themselves. Existing preview deployments are not configured with staging database credentials.

Prisma requires `DATABASE_URL` in addition to the Supabase API keys. Obtain the
existing project's connection string from [wProject Connect](https://supabase.com/dashboard/project/zqidfkofbzusvpikftdf?showConnect=true&method=session),
use its Session pooler endpoint for IPv4 connectivity, and fill the password
placeholder only inside secure credential storage. Preserve the shared database
password and all other apps' configuration. This adapter sets `service_role`
inside each operation's transaction; the login must be allowed to assume that role.
After saving the variable, redeploy: existing deployments retain their original
environment. A READY build and `/api/health` do not prove database connectivity.
With the configured `rallypoint_api` schema, a public session/profile read using
a nonexistent synthetic UUID must return the expected not-found response, not
503, before proceeding to authenticated participant actions. Preview credentials
remain a separate owner-managed setup.

For local development, keep the generated local configuration together:
`DATABASE_URL` points to local Postgres on 54322, while Supabase Auth/Storage use
54321 and the default API schema is `api`. A hosted database URL cannot be added
to that configuration by itself: local Auth identities and the local schema do
not belong to the hosted `rallypoint_api` database. `pnpm db:start` writes the
matching local values. Preserve custom ignored environment files before replacing
them, and keep any hosted credentials only in supported secret storage.

Project build settings: Root Directory `apps/web`, include workspace source outside that directory, Node `24.x`, install `corepack pnpm install --frozen-lockfile`, build `pnpm build` (Prisma Node-client generation followed by the normal Next.js build), framework `nextjs`, Functions region `sin1`. Generation is part of the app build because a cached install can skip `postinstall`. This path does not use OpenNext or the Cloudflare deploy script. Supabase credentials are server environment variables; the public `/api/config` exposes only the publishable sign-in configuration.

Redeploy the current reviewed source after environment-variable changes. Initial setup used a clean `git archive` because Git linking was unavailable. The owner subsequently connected GitHub; inspection on 2026-10-24 confirmed the stable deployment came from Git `main` at d12d46d. Git deployments build application code only; they do not apply database migrations. Follow the database-before-application release check below before merging database-dependent code. Use the stable project ID when linking or deploying with the Vercel CLI; the human-facing project name is `rallypoint`.

Sign-in callbacks and generated share links derive from `window.location.origin`; the PWA manifest uses relative URLs. No host-specific code or extra site-URL environment variable is needed for this rename. Existing browser sessions and PWA installations are origin-specific, so sign in again and install from the new domain when testing it.

The planned P-06 notification scheduler remains separate work. This hosting addition does not enable reminders or change the accepted Cloudflare Cron design.

## Cloudflare build and deploy

1. Use the reviewed staging branch and run `pnpm check`, `pnpm db:lint` and the local synthetic `pnpm test:api` suite.
2. Run `pnpm build:staging`. OpenNext embeds `.env*` values in its server bundle, so the script temporarily removes supported root/app environment files, builds, verifies all compiled environment maps are empty, and restores files after normal completion or build errors. It never deploys. If the process is interrupted, check for recovery files in its private temporary `rallypoint-env-*` directory and restore them before using local development again.
3. Populate runtime secrets using the provider's supported secret entry or a mode-0600 temporary `--secrets-file`. Delete the temporary credential file afterward.
4. From `apps/web`, run `pnpm exec wrangler deploy --config wrangler.staging.jsonc --upload-source-maps=false`. For initial provisioning, add the private `--secrets-file` argument. With existing runtime secrets, `pnpm deploy:staging` rebuilds cleanly and deploys.
5. Check the public page, `/api/health`, `/api/config`, signed-out denial, email-code sign-in and an isolated synthetic session before using real groups.

Local credentials and development mail settings never belong in the uploaded artifact. Build outputs and caches remain ignored.

## Database setup and future migrations

`node scripts/render-staging-schema.mjs` renders the current reviewed migration history into the two RallyPoint schemas and the private RallyPoint bucket. It is an **initial install only**: guards refuse an existing namespace/bucket. The exact rendered SQL was checked in a transaction on local synthetic Postgres before cloud installation.

Cloud migration names are `rallypoint_staging_bootstrap` and `rallypoint_staging_api_exposure`. The second preserves `public, graphql_public` and adds `rallypoint_api` to the authenticator's PostgREST schema list. Browser roles have no schema/function grants; all app tables have RLS.

Do not link this local development project to wProject and run `db push`, `db reset` or seed commands. Those operations target different migration namespaces and could affect shared services. Future changes use reviewed incremental SQL and the isolated `rallypoint_migrations` Prisma history; preserve older `rallypoint_`-prefixed Supabase entries. Do not re-render/reapply the bootstrap as an upgrade.

## Upgrade the existing 2026-10-23 bootstrap

The zero-argument renderer remains initial-install-only. For the known bootstrap through `20261022170000_badges.sql`, render its reviewed 16-source-migration transition through `20261023144000_email_attempting_is_ambiguous.sql` with:

```sh
node scripts/render-staging-schema.mjs --upgrade > /private/tmp/rallypoint-staging-upgrade.sql
```

This is one specific transition, not a general migration runner. For this prepared artifact, verify SHA-256 `281c7a3d1ae420bec74ca5000d64f19da14399d478e575e4bce827ab70b863da`; re-review a mismatch. Check the actual installed definitions first; P-08 compared all 63 existing cloud function definitions with the old baseline. The generated SQL requires the existing RallyPoint schema/bucket, refuses known partial/repeated upgrades, limits lock waits to five seconds and statements to 90 seconds, and retains service-only grants/RLS. The source SQL is reused unchanged apart from the established namespace/bucket mapping. It does not enable email delivery, backfill old emails or edit Auth/provider settings.

For this one-time transition, require a verified recovery copy and apply using one transaction through Supabase `apply_migration` named `rallypoint_staging_upgrade_20261023`, or an explicit `BEGIN`/`COMMIT` wrapper through authenticated CLI `db query --linked --project-ref <project-ref> --file <reviewed-file>` (with its RallyPoint migration-history entry inside the same transaction), or `psql --single-transaction -v ON_ERROR_STOP=1`. The wrapper must preserve the reviewed rendered SQL unchanged. Do not split it into per-statement autocommit calls. After applying, verify preserved record counts, all 95 mapped function definitions, schema grants/RLS and authenticated app reads; then test a synthetic session. Retry after an error only after confirming rollback and the installed state. Keep schemas/history on an application rollback and use a reviewed forward repair.

**Applied 2026-10-24 (Asia/Singapore):** migration `20261023212741_rallypoint_staging_upgrade_20261023` brought staging through source `20261023144000_email_attempting_is_ambiguous.sql`. The owner explicitly authorized the scoped fix. The Supabase connector twice returned an expired-request error without applying SQL; authenticated CLI execution then committed the reviewed SQL and its single migration-history entry atomically. The original bootstrap/exposure and unrelated migration entries remain present. Do not rerun `--upgrade` against this database.

The scoped recovery copy was verified and restored locally before application. Immediately after application, data hashes/counts across all 19 pre-existing RallyPoint tables were unchanged (excluding only the intended new `material=false` field from the comparison). All 95 function definitions matched the rehearsal individually. A fingerprint of 3,009 unrelated schema objects, function definitions, constraints, indexes, triggers, policies, permissions and role settings was unchanged before and after. All 26 RallyPoint tables retain RLS and no RallyPoint function is executable by browser roles. See the [live verification evidence](../verification/2026-10-23-p08-session-loop.md#2026-10-24-live-deployment-gap-resolved).

## Sessions/Profile repair (applied 2026-10-24)

**Applied through Prisma Migrate after the owner's explicit local/production
request.** The baseline `0_rallypoint_baseline_20261023144000` was marked applied,
then `20261024100000_sessions_profiles` committed the five source migrations in
one transaction. Prisma history is in `rallypoint_migrations`; old Supabase and
other apps' histories were preserved. Do not reapply this repair via Supabase.
Use `pnpm db:migrate:local` or, with a securely supplied
`RALLYPOINT_MIGRATION_DATABASE_URL`, `pnpm db:migrate:production` for later runs.
The runner validates the known target and applied SQL checksums, and deploys
pending SQL with Prisma. No participant-data export was performed. See the
[actual application evidence](../verification/2026-10-24-prisma-runtime-configuration.md#prisma-migrate-applied-locally-and-to-production).

The transition included exactly the five source migrations after
`20261023144000` through `20261024100000_profile_fixes.sql`. Production now has
101 functions (fingerprint `151b1745055dd6be3f5c4336ff60f503`) and 27 application
tables with RLS. Existing seat/payment/attendance/notification states and
unrelated schema metadata were preserved. The Profile migration intentionally
refreshes seven stored-name fields.

The earlier renderer artifact and scoped-export proposal are retained as
historical evidence; they are not the current deployment command. Do not edit
applied migration SQL or replay the old bootstrap/upgrade. A recovery approach
must match the change: explicit transactions handle migration failure, while a
committed backfill needs a reviewed forward repair or an existing authorized
recovery source to recover old values. Prisma migration history does not store
old row values. Routine migrations do not require exporting participant data.

Reproduce the actual Prisma rollback/deploy/repeat/checksum checks locally with
`node scripts/rehearse-prisma-migrations.mjs`. It creates and removes disposable
synthetic databases and never contacts production.

### Database-before-application release check

For changes with database migrations, apply and verify the reviewed RallyPoint-only database migration **before merging the dependent application code to main**. Vercel's Git deployment remains enabled; database migration is an explicit owner/reviewer release step, not part of the Vercel build or preview deployment.

1. Record the deployed application commit, installed RallyPoint migration checkpoint and exact pending source files in the change's review. Compare the installed definitions with that baseline; stop on drift. Exclude other apps' migration history from the pending set.
2. Reuse the pending source SQL with the established RallyPoint namespace/bucket mapping, review its exact targets, and rehearse it against the installed baseline with existing synthetic records. Do not replay the bootstrap or this completed one-time upgrade. Choose a recovery approach appropriate to the actual writes and rehearse transactional rollback. For changes that overwrite/delete data, identify an existing recovery source or an explicitly accepted forward-repair approach; do not assume a participant-data export is required for every migration.
3. Apply only the reviewed incremental SQL with Prisma Migrate, using explicit transactions and its isolated `rallypoint_migrations` history. Preserve existing history, shared Auth/settings and other apps' schemas/buckets. Verify record preservation, expected definitions, grants/RLS and the affected RPCs.
4. Once the database supports the new code and the current deployed code, complete human review/merge, let Vercel deploy main, then verify the stable host. If a future migration is incompatible with the current code, split it into compatible add/change/remove releases rather than applying a breaking migration to a running app.

This makes the release dependency explicit; each later database-dependent release still needs its own migration verification. It does not introduce automatic cloud migrations, rename schemas or replace the current migration tooling. Full phone/email evidence and the broader P-13 pilot recovery prerequisites remain separate.

## Recovery

For Vercel, inspect deployments in the [project dashboard](https://vercel.com/djpajares-projects/rallypoint/deployments) and restore the intended tested build. Preserve `rallypoint.wndrhive.com` and the existing environment-variable names. A hostname/project rename does not require database migrations.

Use `wrangler deployments list --config apps/web/wrangler.staging.jsonc` to identify versions; inspect `wrangler rollback --help` and roll back only this Worker to a known good version. A code rollback does not undo persisted sessions or fees.

Use forward fixes for database defects. Do not drop/recreate shared schemas or restore the whole project. To retire staging, separately review Worker removal, removal of only its callback, and cleanup of its schemas/bucket after preserving needed test data. Do not pause wProject or change its shared Auth configuration as a cleanup shortcut.

## Cost and verification boundary

No organization, Supabase project, paid upgrade, purchased domain or subscription is created. The separate Vercel project uses the existing team and an owner-configured subdomain; Vercel production here denotes its deployment target, not commercial launch approval. wProject is on the existing Free plan. Supabase allows two active free projects across organizations, so a new free organization would not have added a slot. Cloudflare hosting uses the existing account and a workers.dev hostname, with no automatic paid-plan fallback.

Checked 2026-10-23: [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). Published free limits include 100,000 Worker requests/day, a 10 ms CPU budget/request and 128 MB memory. Existing apps share provider quotas; these limits are not a dedicated capacity reservation or a guarantee of zero incremental usage on an already-paid account.

Observed test results and the actual deployed version belong in the linked PR/Linear verification record. Do not substitute this setup guide for live evidence.
