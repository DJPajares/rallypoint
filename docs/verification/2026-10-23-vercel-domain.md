# Vercel project and custom domain — 2026-10-23

The owner requested renaming the existing Vercel project to `rallypoint` and using their new `https://rallypoint.wndrhive.com` domain while retaining Cloudflare.

## Changes

- Renamed the existing Vercel project from `rallypoint-staging` to `rallypoint`. Project ID remains `prj_c01PwcRq12aFKOp27xsShGDFhHNf`, team `wonderBots` / `djpajares-projects`.
- Confirmed the owner-configured `rallypoint.wndrhive.com` custom domain is attached and verified. HTTPS serves the configured app. The current READY deployment is `dpl_AgnxBH3T19XgmfPhhyJwpWVNQkdX`; its historical generated deployment URL still includes the old project name. The deployed application source is the staging implementation at `ad911aca6d3c40d29aa3bf026d1f91800e281bff`.
- Added `https://rallypoint.wndrhive.com/auth/callback` to wProject's Auth redirect list. The reviewed CLI diff contained one declared update; all eleven existing redirects, including Cloudflare's, were retained. After pushing, no declared drift remained. Sixteen undeclared remote properties, including Trove Site URL, SMTP, OTP length and other shared settings, were left unchanged.
- Updated README, PRD and the deployment guide to name the current Vercel project, host, environment-variable dashboard, build/recovery path and callback. The owner manages credentials in the dashboard; no credential values were copied into these files or transferred by this rename.
- Kept the existing Cloudflare Worker `rallypoint-staging` and its configuration. Namespaced schemas and the bucket keep their original identities. No database migration, application-code change, cloud redeployment or plan upgrade was needed for this rename.

## Observed checks

- Vercel API: renamed project ID/name confirmed; custom domain attached and verified.
- Custom-domain `/`, `/sign-in`, `/auth/callback` and `/manifest.webmanifest`: HTTP 200. Manifest remains RallyPoint with relative `/home` start URL and `/` scope.
- `/api/health`: HTTP 200, `{ "status": "ok" }`, no-store. Postman assertion passed, exit 0.
- `/api/config`: HTTP 200, configured wProject connection, email enabled, eight-digit codes, Google and localhost auth disabled. No server key serialized; no-store.
- Signed-out `/api/workspace`: HTTP 401 `sign_in_required`, no-store.
- Browser on the custom domain: hydrated **Email address** field and **Send code** button; no email sent.
- Existing Cloudflare `/api/health`: HTTP 200, `{ "status": "ok" }`, no-store.
- Code inspection: auth callback and share URLs use the current browser origin; manifest paths are relative. No hardcoded old Vercel host needed changing in application code.
- Documentation validation: relative links and `git diff --check`; application tests/build were not repeated for documentation and remote naming/allow-list changes. Original implementation verification remains in [phone staging evidence](2026-10-23-phone-staging.md).

## Limits

Real inbox delivery, authenticated phone actions and PWA installation on the new origin remain manual checks. Existing sessions and installations belong to their original origin; sign in and install again from the custom domain. No production launch, notification-scheduler implementation, merge or full new regression run is claimed.
