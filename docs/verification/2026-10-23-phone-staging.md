# Phone staging verification — 2026-10-23

Task: [WDL-387](https://linear.app/wwonderland/issue/WDL-387). Source baseline: main `a43e33fcea0107141d570a8e32a82e7a03360fdd` plus this PR's staging changes. Cloudflare version: `f40b4da9-63e8-4883-89f7-d5deb19489af`.

## Deployed artifact

- Host: https://rallypoint-staging.dj-pajares.workers.dev
- Worker: `rallypoint-staging`, account `b9505be067db4a127cf88a24f3c83de1`.
- Supabase: selected existing wProject, `zqidfkofbzusvpikftdf`, region ap-southeast-1; no project pause/new project/organization/plan upgrade.
- Logical namespaces: `rallypoint`, `rallypoint_api`; private `rallypoint-payment-qr` bucket. Shared project Auth remains shared, as explained before setup.
- Uploaded bundle: 8,476.88 KiB uncompressed, 1,785.61 KiB gzip; reported Worker startup 19 ms. This is upload/startup evidence, not a phone-performance benchmark.
- Next 16.4.2; OpenNext 1.20.13; Wrangler 4.151.3; pnpm 11.14.0; Node 24.16.0.

## Checks observed

- `pnpm check`: lint/type/Next production build passed. Final Cloudflare build also compiles the reviewed QR and hosted email fixes.
- `pnpm db:lint`: no schema errors, including the namespaced clone on local synthetic Postgres.
- Full `pnpm test:api` on `http://127.0.0.1:3001`: **124 passed, 0 failed**, final duration 107.692 seconds. Includes request-level configured RPC schema, shared-session read, namespaced QR download and explicit cloud email-mode checks.
- `pnpm build:staging`: passed. OpenNext's compiled production/development/test environment maps contain no embedded values. Local env files were restored. Runtime credentials were uploaded using the supported secrets-file mechanism and the temporary file/log were removed afterward.
- Exact bootstrap SQL (16 source migrations, 186,905 bytes) applied successfully in one transaction to local synthetic Postgres, then installed through a namespaced cloud migration. No Trove/watchlist schema migration was applied.
- Cloud database: 19 RallyPoint tables, all RLS enabled; zero browser-callable RallyPoint RPCs. Backend key RPC succeeded; publishable-key direct RPC was denied. Existing storage buckets remain alongside the new private bucket.
- Auth callback update: exactly one declared setting changed, appending the exact staging callback to ten existing redirects. Sixteen undeclared remote settings, including site URL, SMTP, OTP length and providers, were left unchanged.
- Live Postman health request: HTTP 200, body status ok, assertion passed.
- Live HTTP: home, sign-in and manifest 200; public config configured, email enabled/eight digits, Google/local-only auth disabled, correct Supabase project, no secret serialized. Config/private APIs are no-store. Signed-out workspace returns 401 sign_in_required.
- Browser: deployed sign-in hydrates to an email-address form and Send code; no disabled Google prompt or local-only mail instructions in the hosted initial view.
- Live synthetic Auth probe: generated an eight-digit code without sending mail, verified it against Supabase, then called `/api/me`, `/api/workspace`, `/api/dues` and `/api/me/badges` through the deployed Worker: all 200, no-store. Revoked and deleted only the temporary synthetic identity. Final Auth count is the original two, with zero cloud RallyPoint groups/sessions left by verification.
- Read-only code review found a staging QR download bucket mismatch and hosted local-mail wording; both fixed. QR regression failed before the fix and passed afterward. Initial review reported no other deployment blockers. A requested final reviewer follow-up was unavailable due to reviewer usage limits; the final fixes were verified directly and by the full suite.
- Formatting and `git diff --check` passed. The primary checkout's pre-existing document deletions remain untouched.

## Findings and limits

The shared project advisor reports informational RLS-without-policy entries for RallyPoint's 19 private, service-only tables. This is the intended deny-by-default design, confirmed by grants and direct-request denial, not a reason to add browser policies. The shared Auth advisor also reports [leaked-password protection disabled](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); shared Auth settings were preserved and no password login was added.

Actual inbox delivery was not tested by sending mail from this task. The user should use their existing wProject/Trove email and enter the eight-digit code. A code verified through the provider API is not evidence of email delivery. Actual phone installation, cross-device sign-in, live session creation/joining on the phone and device performance remain manual checks. There is no new email notification implementation; P-06 remains separate. Paid processing, Maps venue links and badge tiers remain their own backlog tasks.

No production launch, paid upgrade, real group import, merge or notification send is claimed.
