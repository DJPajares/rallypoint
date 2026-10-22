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

| Variable | Value |
| --- | --- |
| `SUPABASE_URL` | `https://zqidfkofbzusvpikftdf.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Existing wProject publishable key; owner enters through the dashboard |
| `SUPABASE_SECRET_KEY` | Existing wProject server key; owner enters as Secret/Sensitive |
| `SUPABASE_API_SCHEMA` | `rallypoint_api` |
| `PAYMENT_QR_BUCKET` | `rallypoint-payment-qr` |
| `EMAIL_AUTH_ENABLED` | `true` |
| `EMAIL_OTP_LENGTH` | `8` |
| `GOOGLE_AUTH_ENABLED` | `false` |
| `LOCAL_AUTH_ENABLED` | `false` |
| `ENABLE_EXPERIMENTAL_COREPACK` | `1` |

Use the names shown; never add `NEXT_PUBLIC_` to the server key. Credentials are dashboard-managed and must not be copied into source, chat, local upload files or review artifacts. The owner elected to enter Vercel credentials themselves. Existing preview deployments are not configured with staging database credentials.

Project build settings: Root Directory `apps/web`, include workspace source outside that directory, Node `24.x`, install `corepack pnpm install --frozen-lockfile`, build `pnpm build` (normal Next.js build), framework `nextjs`, Functions region `sin1`. This path does not use OpenNext or the Cloudflare deploy script. Supabase credentials are server environment variables; the public `/api/config` exposes only the publishable sign-in configuration.

Redeploy the current reviewed source after environment-variable changes. Git linking was unavailable during initial setup, so source was uploaded from a clean `git archive` of the reviewed staging commit, with no local env files, caches or generated output. Do not assume automatic Git deployments are configured. Use the stable project ID when linking or deploying with the Vercel CLI; the human-facing project name is `rallypoint`.

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

Do not link this local development project to wProject and run `db push`, `db reset` or seed commands. Those operations target different migration namespaces and could affect shared services. Future cloud changes need reviewed, namespaced incremental migrations with the `rallypoint_` prefix. Do not re-render/reapply the bootstrap as an upgrade.

## Recovery

For Vercel, inspect deployments in the [project dashboard](https://vercel.com/djpajares-projects/rallypoint/deployments) and restore the intended tested build. Preserve `rallypoint.wndrhive.com` and the existing environment-variable names. A hostname/project rename does not require database migrations.

Use `wrangler deployments list --config apps/web/wrangler.staging.jsonc` to identify versions; inspect `wrangler rollback --help` and roll back only this Worker to a known good version. A code rollback does not undo persisted sessions or fees.

Use forward fixes for database defects. Do not drop/recreate shared schemas or restore the whole project. To retire staging, separately review Worker removal, removal of only its callback, and cleanup of its schemas/bucket after preserving needed test data. Do not pause wProject or change its shared Auth configuration as a cleanup shortcut.

## Cost and verification boundary

No organization, Supabase project, paid upgrade, purchased domain or subscription is created. The separate Vercel project uses the existing team and an owner-configured subdomain; Vercel production here denotes its deployment target, not commercial launch approval. wProject is on the existing Free plan. Supabase allows two active free projects across organizations, so a new free organization would not have added a slot. Cloudflare hosting uses the existing account and a workers.dev hostname, with no automatic paid-plan fallback.

Checked 2026-10-23: [Supabase billing](https://supabase.com/docs/guides/platform/billing-on-supabase), [Cloudflare Workers limits](https://developers.cloudflare.com/workers/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/). Published free limits include 100,000 Worker requests/day, a 10 ms CPU budget/request and 128 MB memory. Existing apps share provider quotas; these limits are not a dedicated capacity reservation or a guarantee of zero incremental usage on an already-paid account.

Observed test results and the actual deployed version belong in the linked PR/Linear verification record. Do not substitute this setup guide for live evidence.
