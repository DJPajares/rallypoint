# Email and Password Auth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the emailed-code sign-in with Supabase email and password
sign-up, sign-in and password reset, using Supabase's own email links.

**Architecture:**

- A new `PASSWORD_AUTH_ENABLED` flag switches the forms on in `/api/config`.
- Pure helpers in `@rallypoint/domain/auth-links` classify link failures and
  keep auth pages out of return paths.
- The browser `AuthProvider` exposes `recovery` and `linkError`. Four auth pages
  plus the callback live in one new file, `apps/web/src/auth-pages.tsx`.
- The return path moves from `sessionStorage` to `localStorage`, so an email
  link opened in a new tab can still read it.

**Tech Stack:** Next.js App Router, React, TypeScript, `@supabase/supabase-js`
(auth-js 2.118, PKCE), Hono API, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-25-email-password-auth-design.md`

## Global Constraints

- Redirects are exactly `${window.location.origin}/auth/callback`. Never add a
  query string to the redirect.
- Return path key: `rallypoint.returnTo` in `localStorage`. It is always read
  through `safeReturnPath`, which falls back to `/workspace`.
- Password: at least 8 characters, with a show/hide toggle.
  - `autocomplete="new-password"` on sign-up and reset.
  - `autocomplete="current-password"` on sign-in.
- Name: required, at most 80 characters. It is sent as
  `options.data.full_name`.
- Never say whether an email has an account. The same result screen appears
  for new and existing emails on sign-up and on forgot password.
- Exact copy:
  - Wrong credentials: "That email and password don't match."
  - Unconfirmed email: "Confirm your email first. Check your inbox."
  - Forgot password result: "If there's an account for that email, we've sent
    a link."
  - Other-browser sign-up: "Your email is confirmed. Sign in to continue."
  - Other-browser reset: "Open the reset link on the device where you asked
    for it, or ask for a new one."
  - Expired or used link: "This link has expired or was already used."
- Resend cooldown: 30 seconds.
- No one-time code UI anywhere. No change to the shared wProject templates,
  SMTP or Site URL.
- Keep PKCE (`flowType: "pkce"`, `storageKey: "rallypoint.auth"`).

## Review Focus

- **An existing Trove or passwordless user tries to sign in** and gets the
  wrong-credentials message. That message must offer "Forgot password?" right
  there, because that's their path to a password. Pinned in Task 4.
- **Sign-up with an already-registered email** must show the same "Check your
  email" screen, and no error that reveals the account exists. Pinned in Task 4
  by treating any non-error `signUp` result as success.
- **Return path with a query and hash** (`/s/abc?x=1#people`) survives the
  round trip. An auth page or a foreign URL as `next` falls back to
  `/workspace`. Pinned in Task 2's tests.
- **`/reset-password` opened directly by an ordinary signed-in session** must
  not offer a password change. It goes to `/sign-in`. Pinned in Task 4.
- **Double submit or a slow network:** every submit button is disabled while
  busy, and a failure keeps the typed email, name and password. Pinned in
  Task 4.

---

### Task 1: Password flag in public config

**Files:**

- Modify: `apps/api/src/index.ts` (`/config` handler, ~lines 31-50)
- Modify: `apps/api/src/env.ts`: drop `EMAIL_AUTH_ENABLED` and
  `EMAIL_OTP_LENGTH`, add `PASSWORD_AUTH_ENABLED?: string`.
- Modify: `packages/domain/src/contracts.ts`: `PublicConfig.auth` becomes
  `{ url; publishableKey; google: boolean; password: boolean; localEmail: boolean }`.
- Modify config and scripts:
  - `apps/web/wrangler.staging.jsonc`: replace the two `EMAIL_*` vars with
    `"PASSWORD_AUTH_ENABLED": "true"`.
  - `apps/web/wrangler.jsonc`: add `"PASSWORD_AUTH_ENABLED": "false"`.
  - `apps/web/.env.example`: add `PASSWORD_AUTH_ENABLED=true`.
  - `scripts/local.mjs:37`: append `PASSWORD_AUTH_ENABLED=true\n` to the
    written env.
  - `scripts/build-staging.mjs:33`: replace `EMAIL_AUTH_|EMAIL_OTP_` with
    `PASSWORD_AUTH_` in the allow-list regex.
- Test: `tests/deployment-config.test.mjs` (the staging sign-in test, ~line
  132); `tests/api.test.mjs:50`.

**Interfaces:**

- Produces: `PublicConfig.auth.password: boolean`, true only when
  `PASSWORD_AUTH_ENABLED === "true"`. `localEmail` keeps its current loopback
  rule. `email` and `emailCodeLength` no longer exist.

- [ ] **Step 1: Rewrite the staging config test.** Rename it to "staging
      password sign-in is explicit and never enables local-only authentication".
  - Env: `PASSWORD_AUTH_ENABLED: "true"` and `LOCAL_AUTH_ENABLED: "true"`.
  - Assert `enabled.auth.password === true`, `enabled.auth.localEmail ===
false`, and that the secret is not in the response.
  - Assert `!("email" in enabled.auth) && !("emailCodeLength" in
enabled.auth)`.
  - After `delete env.PASSWORD_AUTH_ENABLED`, assert `auth.password === false`.
- [ ] **Step 2: Watch it fail.** Run `node --test tests/deployment-config.test.mjs`.
      Expected: FAIL on `auth.password`.
- [ ] **Step 3: Implement the flag and the config edits** listed above. Also
      check any `wrangler*.jsonc` assertions in that test file still match.
- [ ] **Step 4: Watch it pass.** Run `node --test tests/deployment-config.test.mjs`
      and `pnpm typecheck`. Expected: PASS, but typecheck fails in `screens.tsx` on
      `config.auth.email` / `emailCodeLength`. Task 4 removes those uses; until
      then, change them to `config.auth?.password` and drop the length pattern, so
      this task builds on its own.
- [ ] **Step 5: Commit.** `git commit -m "feat: password sign-in flag replaces email codes"`.

### Task 2: Auth link helpers and return-path exclusions

**Files:**

- Create: `packages/domain/src/auth-links.ts`
- Modify: `packages/domain/package.json`: add the export
  `"./auth-links": "./src/auth-links.ts"`.
- Modify: `packages/domain/src/navigation.ts:7`: add `/sign-up`,
  `/forgot-password` and `/reset-password` to the excluded paths.
- Test: create `tests/auth-links-domain.test.mjs`.

**Interfaces:**

- Produces:
  - `type LinkError = "other_browser" | "expired" | "invalid"`.
  - `linkErrorCode(search: string, hash: string): string | null` returns the
    `error_code` (else `error`) from the query, or else from the `#fragment`.
  - `classifyLinkError(urlCode: string | null, errorCode: string | undefined): LinkError`.
    - `"expired"` when `urlCode` or `errorCode` is `otp_expired`,
      `flow_state_expired` or `flow_state_not_found`.
    - `"other_browser"` when `errorCode === "pkce_code_verifier_not_found"`.
    - Otherwise `"invalid"`.
  - `isRecoverySession(accessToken: string): boolean`. It decodes the JWT
    payload (base64url, no verification: this is for routing only, and the API
    never trusts it) and is true when `amr` has an entry with
    `method === "recovery"`. False on any malformed input. The
    `PASSWORD_RECOVERY` event fires after init on a timer, so the callback
    can't rely on it alone.

- [ ] **Step 1: Write the tests.**

```js
import {
  classifyLinkError,
  isRecoverySession,
  linkErrorCode,
} from "../packages/domain/src/auth-links.ts";
import { safeReturnPath } from "../packages/domain/src/navigation.ts";
test("link errors are told apart", () => {
  assert.equal(
    classifyLinkError(null, "pkce_code_verifier_not_found"),
    "other_browser",
  );
  assert.equal(classifyLinkError("otp_expired", undefined), "expired");
  assert.equal(classifyLinkError(null, "flow_state_not_found"), "expired");
  assert.equal(classifyLinkError(null, "bad_code_verifier"), "invalid");
  assert.equal(
    linkErrorCode("?error=access_denied&error_code=otp_expired", ""),
    "otp_expired",
  );
  assert.equal(
    linkErrorCode("", "#error=access_denied&error_code=otp_expired"),
    "otp_expired",
  );
  assert.equal(linkErrorCode("?code=abc", ""), null);
});
test("a recovery session is read from its amr claim", () => {
  const jwt = (payload) =>
    [
      "e30",
      Buffer.from(JSON.stringify(payload)).toString("base64url"),
      "sig",
    ].join(".");
  assert.equal(
    isRecoverySession(jwt({ amr: [{ method: "recovery", timestamp: 1 }] })),
    true,
  );
  assert.equal(
    isRecoverySession(jwt({ amr: [{ method: "password", timestamp: 1 }] })),
    false,
  );
  assert.equal(isRecoverySession("not-a-jwt"), false);
});
test("auth pages never become a return path", () => {
  for (const p of [
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/sign-in",
    "/auth/callback",
  ])
    assert.equal(safeReturnPath(p), "/workspace");
  assert.equal(safeReturnPath("/s/abc?x=1#people"), "/s/abc?x=1#people");
  assert.equal(safeReturnPath("https://evil.test/s/abc"), "/workspace");
});
```

- [ ] **Step 2: Watch it fail.** Run `node --test tests/auth-links-domain.test.mjs`.
      Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `auth-links.ts` and the navigation exclusions.
- [ ] **Step 4: Watch it pass.** Run `node --test tests/auth-links-domain.test.mjs`.
      Expected: PASS.
- [ ] **Step 5: Commit.** `git commit -m "feat: classify auth link failures"`.

### Task 3: Auth state and return-path storage

**Files:**

- Modify: `apps/web/src/auth-context.ts`: `AuthState` gains
  `recovery: boolean` and `linkError: LinkError | null`. Both default to
  false / null in `initial`.
- Modify: `apps/web/src/auth.tsx`:
  - Capture `linkErrorCode(location.search, location.hash)` before
    `createClient`.
  - After creating it, `const { error } = await client.auth.initialize()`.
    Set `linkError` to `classifyLinkError(urlCode, error?.code)` when either
    one is present.
  - Set `recovery: true` when `onAuthStateChange` fires `"PASSWORD_RECOVERY"`.
  - Keep `recovery` and `linkError` across later state updates (spread the
    previous state).
- Create: `apps/web/src/return-path.ts`.
- Modify: `apps/web/src/sign-out.ts`: call `forgetReturnPath()` instead of the
  `sessionStorage` removal.

**Interfaces:**

- Consumes: `LinkError`, `linkErrorCode` and `classifyLinkError` from Task 2.
- Produces:
  - `useAuth()` now also returns `recovery` and `linkError`.
  - `rememberReturnPath(next: string): void`
  - `takeReturnPath(): string`. It reads, removes and returns the stored path
    through `safeReturnPath` (`/workspace` when empty).
  - `forgetReturnPath(): void`
  - All three wrap storage access in try/catch.
  - `redirectUrl(): string` returns `${window.location.origin}/auth/callback`.

- [ ] **Step 1: Implement** the files above. Client-only code has no unit
      harness here, so it is verified in the browser in Task 5.
- [ ] **Step 2: Typecheck.** Run `pnpm typecheck`. Expected: PASS.
- [ ] **Step 3: Commit.** `git commit -m "feat: auth state carries recovery and link errors"`.

### Task 4: Sign-up, sign-in, forgot, reset and callback pages

**Files:**

- Create: `apps/web/src/auth-pages.tsx`, exporting `SignIn`, `SignUp`,
  `ForgotPassword`, `ResetPassword` and `AuthCallback`. They share one private
  `AuthLayout({ title, lede, children })`, using the existing `signin-page`,
  `signin-intro` and `signin-card` classes.
- Modify: `apps/web/src/screens.tsx`: delete `SignIn` and `AuthCallback`, and
  their now-unused imports.
- Modify: `apps/web/app/sign-in/page.tsx` and
  `apps/web/app/auth/callback/page.tsx`: import from `@/auth-pages`.
- Create routes:
  - `apps/web/app/sign-up/page.tsx`
  - `apps/web/app/forgot-password/page.tsx`
  - `apps/web/app/reset-password/page.tsx`
    Each wraps its page in `<Suspense fallback={<Pending />}>`, like the
    sign-in route.
- Modify: `apps/web/src/styles/pages.css` only if a new class is needed. Any
  value must be a token.

**Interfaces:**

- Consumes: `useAuth()` (`client`, `config`, `session`, `recovery`,
  `linkError`) from Task 3; `rememberReturnPath`, `takeReturnPath` and
  `redirectUrl` from Task 3; `safeReturnPath`; `config.auth.password` and
  `config.auth.google` from Task 1.
- Produces: the routes `/sign-in?next=`, `/sign-up?next=`, `/forgot-password`,
  `/reset-password` and `/auth/callback`.

Behaviour, all per the spec:

- **`SignIn`:**
  - On mount, `rememberReturnPath(next)`. Signed in already → redirect to
    `next`.
  - Email and password form → `signInWithPassword`, then
    `router.replace(takeReturnPath())`.
  - Error `invalid_credentials`: the wrong-credentials copy plus a "Forgot
    password?" link.
  - Error `email_not_confirmed`: the confirm copy plus a "Resend email" button
    (`auth.resend({ type: "signup", email, options: { emailRedirectTo:
redirectUrl() } })`, then a 30-second cooldown).
  - Other errors: "Sign-in didn't finish. Please try again."
  - Links: "Forgot password?" → `/forgot-password`, and "New here? Create an
    account" → `/sign-up?next=…`.
  - The Google button stays behind `config.auth.google`.
  - Keep the "Local development" note when `localEmail`, now saying: "Use a
    synthetic account. Confirmation and reset emails go to the local mail
    inbox." with the inbox link.
- **`SignUp`:**
  - Name, email and password → `signUp({ email, password, options: {
emailRedirectTo: redirectUrl(), data: { full_name: name.trim() } } })`.
  - A returned session → go to `takeReturnPath()`.
  - Otherwise, any non-error result → "Check your email" screen. Show the
    address, "Resend email" (30-second cooldown) and "Use a different email".
  - Footer: "Already have an account? Sign in".
- **`ForgotPassword`:** email → `resetPasswordForEmail(email, { redirectTo:
redirectUrl() })`. Then show the forgot-password result copy, whatever the
  outcome except a network failure.
- **`AuthCallback`:**
  - While `loading`: `Pending` "Finishing sign-in…".
  - "Recovery" below means `recovery || isRecoverySession(session.access_token)`.
  - `linkError`:
    - `other_browser`: this browser can't tell whether the link was a sign-up
      or a reset, so show both lines: the other-browser sign-up copy, then the
      other-browser reset copy. Actions: "Sign in" and "Send a new link"
      (→ `/forgot-password`).
    - `expired`: the expired copy, with "Sign in" and "Send a new link"
      (→ `/forgot-password`).
    - `invalid`: same as `expired`.
  - Session and recovery → `/reset-password`.
  - Session → `takeReturnPath()`.
  - No session → the `invalid` screen.
- **`ResetPassword`:**
  - Requires a session and recovery (as defined above). Otherwise
    `router.replace("/sign-in")`.
  - New password field → `updateUser({ password })`, then
    `takeReturnPath()` with a "Password updated" status.
  - Errors: `same_password` → "Choose a password you haven't used here.",
    `weak_password` → "Choose a longer password."
- **All forms:**
  - Submit is disabled while busy.
  - Field values are kept on error.
  - Errors use `Notice`.
  - Headings and labels follow D-13: no internal terms.

- [ ] **Step 1: Build `auth-pages.tsx` and the three routes.** Remove the old
      `SignIn` / `AuthCallback` from `screens.tsx`.
- [ ] **Step 2: Lint and typecheck.** Run `pnpm lint && pnpm typecheck`.
      Expected: PASS (only the existing `session-pages.tsx` `Date.now` warning).
- [ ] **Step 3: Commit.** `git commit -m "feat: email and password sign-up, sign-in and reset"`.

### Task 5: Local Supabase, docs and end-to-end check

**Files:**

- Modify: `supabase/config.toml`:
  - `[auth] enable_signup = true`
  - `minimum_password_length = 8`
  - `[auth.rate_limit] email_sent = 30`
  - Delete the `[auth.email.template.magic_link]` block.
- Delete: `supabase/templates/code.html`.
- Modify docs:
  - `README.md`: local sign-in steps. Seed accounts sign in with the password
    in `scripts/local-env.mjs` (`fixturePassword`); new accounts confirm from
    the local inbox.
  - `docs/deployment/staging.md`:
    - Drop the eight-digit code lines and the `EMAIL_*` vars, and add
      `PASSWORD_AUTH_ENABLED=true`.
    - Add the owner pre-merge checklist: Vercel env var, "Allow new users to
      sign up" on, "Confirm email" on.
    - Note that RallyPoint links use the default `{{ .ConfirmationURL }}`
      branch.
  - `PRD.md`: add the D-22 row after D-21, and amend the staging paragraph
    "verified email codes" to point to D-22.

- [ ] **Step 1: Apply the config and docs edits.**
- [ ] **Step 2: Restart local Auth** so the config applies: `pnpm db:stop &&
pnpm db:start`. Expected: services healthy, env rewritten with
      `PASSWORD_AUTH_ENABLED=true`.
- [ ] **Step 3: Run the suites.** `pnpm check`, `node --test
tests/design-tokens.test.mjs tests/auth-links-domain.test.mjs
tests/deployment-config.test.mjs`, then `pnpm test:api` with the app running.
      Expected: all PASS. The `api.test.mjs` `localEmail` assertion still holds.
- [ ] **Step 4: Check in the browser, against the local server, at phone width
      in both themes.** Use a separate origin, so the owner's local session is
      untouched.
  - Sign up a new synthetic email from `/sign-in?next=/s/<slug>`.
  - Confirm from the local inbox and land on `/s/<slug>`, signed in, with the
    name shown.
  - Sign up the same email again: the same "Check your email" screen.
  - Sign in with a seed account; a wrong password shows the neutral copy and
    the Forgot link.
  - Sign in before confirming shows the confirm copy and resend.
  - Forgot password → reset link → `/reset-password` → new password → sign in
    with it.
  - Reopen a used link shows the expired copy.
  - Open `/reset-password` directly while signed in normally redirects to
    `/sign-in`.
- [ ] **Step 5: Commit.** `git commit -m "chore: local password auth and docs for D-22"`.
