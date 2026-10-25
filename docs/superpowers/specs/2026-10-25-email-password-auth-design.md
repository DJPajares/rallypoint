# Email and password sign-up and sign-in — design

Date: 2026-10-25. Status: draft for owner review. Decision home once accepted:
PRD D-22.

## Why

A new player who taps a shared session link today has no way in. The sign-in
page asks for an emailed one-time code, but:

- The live site uses the shared wProject Supabase project (accepted
  2026-10-23). Its email is a Supabase link
  (`/auth/v1/verify?token=…&type=magiclink&redirect_to=…/auth/callback`), not a
  code. Only the local project prints a code, through a custom template
  (`supabase/templates/code.html`). The page tells people to type a code that
  never arrives.
- Email sign-in is called with `shouldCreateUser: false`, and Google is off, so
  nobody new can create an account.

The owner wants Supabase Authentication's own email and password flow.

## Goals

1. **Sign up** at `/sign-up`: email, password and name. Supabase sends a
   confirmation link. Tapping it opens RallyPoint signed in.
2. **Sign in** at `/sign-in`: email and password.
3. **Forgot password**: request a Supabase reset link. It opens a page to set a
   new password, which leaves them signed in.
4. **No one-time codes anywhere.** Email links are used only to confirm a new
   account and to reset a password.
5. **Return to where they started.** Someone who began from a session link
   (`/sign-in?next=/s/…`) lands back on that session after signing in,
   confirming or resetting, even when the email link opens in a new tab.

## Non-goals

- Google sign-in. It stays off (`GOOGLE_AUTH_ENABLED=false`); the button code
  stays.
- Magic-link or code sign-in.
- Account settings: changing the email, changing the password while signed in,
  or deleting the account.
- Invitations or group membership on sign-up. D-01 is unchanged: signing up
  creates an identity, not a membership.
- Any change to the shared wProject email templates, SMTP or Site URL.

## Anti-goals (a failure even if it works)

- Saying whether an email already has an account, on any screen or in any
  error.
- Treating an unconfirmed account as verified. The API's existing check
  (`email_confirmed_at` is required) stays the authority.
- Breaking Trove. The Auth project is shared, so any project-wide setting change
  is the owner's call.
- Passwords in logs, URLs, analytics or storage. Only Supabase's own session
  storage is used.

## Constraints and facts

- **Live email setup, from Trove's own records.** Source:
  `~/dev/github/trove/docs/auth/email-auth-rollout.md` and
  `supabase/templates/en/*.html`, read 2026-10-25. This is Trove's documented
  setup, not an inspection of the dashboard.
  - **Templates.** wProject's "Confirm signup" and "Reset password" templates
    send a `token_hash` link only when the redirect starts with a Trove address.
    Every other app, RallyPoint included, gets the default
    `{{ .ConfirmationURL }}` link (Supabase's `/auth/v1/verify` →
    `redirect_to`). RallyPoint needs no template change, and none is made.
  - **Sending.** Custom SMTP through Resend, sender
    `wndrhive <no-reply@auth.wndrhive.com>`. So real players do receive email.
    Send limits are shared with Trove.
  - **Sign-up.** Trove turns its own sign-up off in its app (`SIGN_UP_DISABLED`)
    rather than in the project, which suggests project-wide sign-up is on. The
    owner confirms this in the pre-merge check.
  - **Password length.** Trove accepts 6 or more characters, so the project
    minimum is probably 6. RallyPoint asks for 8, which is stricter and still
    valid.
  - **Later option.** Trove's `token_hash` branch is what lets its links work
    in a fresh browser. Adding a RallyPoint branch to the shared templates would
    remove our same-browser limit. That changes shared templates, so it is the
    owner's call and stays out of this work.

- **Shared Auth.** Users of the shared wProject Auth also exist for Trove. A
  Trove user already has an account here and signs in with that same password.
  If they never set a password (passwordless or OAuth), "Forgot password" is
  how they get one.
- **PKCE flow.** The client uses `flowType: "pkce"` with
  `storageKey: "rallypoint.auth"`. A link finishes signing in only on the
  browser that requested it, because the code verifier lives in that browser's
  `localStorage`. Confirming or resetting on a different device is a known
  limit. The page must say so plainly when it happens: "Open the link on the
  device where you signed up, or sign in."
- **One redirect address.** Supabase only redirects to allow-listed addresses.
  Keep `emailRedirectTo` / `redirectTo` exactly
  `${origin}/auth/callback`, because that is what the allow-list holds. Carry
  intent (the return path, and whether this is a reset) in app storage, never in
  query strings added to the redirect.
- **Return path storage.** It is in `sessionStorage` today, which an email link
  opened in a new tab can't see. Move it to `localStorage` under the same key
  (`rallypoint.returnTo`), still validated with `safeReturnPath`, and cleared
  after use and on sign-out.
- **Names.** The API already names a person from `user_metadata.full_name`,
  falling back to the email's local part (`displayName` in
  `apps/api/src/identity.ts`). Sign-up passes the name as
  `options.data.full_name`. No API or schema change is needed.
- **D-13.** Ask only what's needed: email, password, name. No marketing copy, no
  internal terms.

## Behaviour

### Sign up (`/sign-up`)

- **Fields:**
  - Name: required, at most 80 characters.
  - Email.
  - Password: at least 8 characters, with a show/hide toggle and
    `autocomplete="new-password"`.
- **Submit:** `signUp({ email, password, options: { emailRedirectTo:
origin + "/auth/callback", data: { full_name } } })`.
- **Result:** "Check your email" with the address shown, a "Resend email"
  button (`auth.resend({ type: "signup", email, options: { emailRedirectTo }
})`) that waits a short cooldown, and "Use a different email". The same
  screen shows whether the email was new or already registered: Supabase hides
  that, and so do we.
- **If the project returns a session at once** (email confirmation turned off
  in the project), continue straight to the return path.
- **Footer:** "Already have an account? Sign in", keeping `next`.

### Sign in (`/sign-in`)

- **Fields:** email and password (`autocomplete="current-password"`).
- **Submit:** `signInWithPassword`, then the return path.
- **Errors:**
  - Wrong email or password: "That email and password don't match."
    One message, never which part was wrong.
  - Email not confirmed: "Confirm your email first. Check your inbox." with a
    resend action.
  - Rate limit or network: plain retry wording. Keep what they typed.
- **Links:** "Forgot password?" and "New here? Create an account", keeping
  `next`.
- **Local development:** the "Local development" note stays. The seeded
  accounts get a known local password (see Local development), so local sign-in
  uses the same form.

### Forgot password (`/forgot-password`)

- **Fields:** email.
- **Submit:** `resetPasswordForEmail(email, { redirectTo: origin +
"/auth/callback" })`.
- **Result:** "If there's an account for that email, we've sent a link." The
  same result either way.

### Callback (`/auth/callback`)

- **Finish the link:** exchange the code (supabase-js already does this from
  the URL in PKCE mode). Then:
  - **A password reset** (supabase-js fires `PASSWORD_RECOVERY`, or a recovery
    intent the app stored when the reset was requested): go to
    `/reset-password`.
  - **Otherwise:** go to the stored return path, or `/home`.
- **Failure, told apart by kind** (builder's call, 2026-10-25). On phones,
  opening the email in a different browser is common: a chat app's browser, the
  mail app's browser, or an installed iPhone app with its own storage.
  - **The code verifier is missing** (the link opened on another browser or
    device). That browser can't tell a sign-up link from a reset link, so the
    page shows both lines. For sign-up, Supabase has already confirmed the
    email before redirecting: "Your email is confirmed. Sign in to continue."
    For a reset: "Open the reset link on the device where you asked for it, or
    ask for a new one." Actions: Sign in, and Send a new link.
  - **The link expired or was already used** (the redirect carries an error
    such as `otp_expired`): "This link has expired or was already used." with
    Sign in and Send a new link.
  - Nothing technical is shown. The return path is lost when the link opens in
    another browser, so after signing in there they land on `/workspace`. That
    is accepted for now.
- Keep PKCE for these links. An implicit-flow client would put tokens in the
  URL and is not used.

### Set a new password (`/reset-password`)

- **Access:** only with the signed-in session that came from a reset link.
  Otherwise send them to sign in.
- **Fields:** new password (at least 8 characters, show/hide).
- **Submit:** `updateUser({ password })`, then the return path or `/home`, with
  a brief "Password updated" status.

## Configuration

- **`/api/config` auth flags:**
  - Replace `email` and `emailCodeLength` with `password: boolean` from a new
    `PASSWORD_AUTH_ENABLED`.
  - Keep `google`.
  - Keep `localEmail` only as the switch for the local note.
  - Remove `EMAIL_AUTH_ENABLED` and `EMAIL_OTP_LENGTH` from `env.ts`,
    `.env.example`, `wrangler*.jsonc` and the docs.
- **Local Supabase (`supabase/config.toml`):**
  - Allow sign-ups: `[auth] enable_signup = true`. The email provider already
    allows them.
  - Keep email confirmation on.
  - Set `minimum_password_length = 8`.
  - Remove the custom `magic_link` code template, so local emails are
    Supabase's default confirmation and reset links, opened from the local mail
    inbox.
- **Local accounts:** `scripts/local.mjs` already creates the four synthetic
  accounts with a fixed local-only password from `scripts/local-env.mjs`
  (longer than 8 characters). Reuse it, and point to it from README instead of
  repeating it.
- **Local limits:** raise the local `[auth.rate_limit] email_sent` limit (it is
  2 per hour) so the browser checks aren't blocked. This is local only.
- **Local flag:** local setup turns on `PASSWORD_AUTH_ENABLED`.
- **Return path:** `safeReturnPath` falls back to `/workspace`. Add the three
  new auth pages to its exclusion list.
- **Tests:** `tests/deployment-config.test.mjs` and `tests/api.test.mjs` check
  the old `email`, `emailCodeLength` and `localEmail` flags. Update them to the
  new ones.
- **Live wProject (owner action, not code):**
  - The project-wide "Allow new users to sign up" setting must be on for
    sign-up to work. Trove's records suggest it is; confirm it.
  - "Confirm email" should stay on.
  - Both are shared with Trove, so the owner checks and decides. The existing
    `/auth/callback` allow-list entries already cover the new links.
  - Set `PASSWORD_AUTH_ENABLED=true` in Vercel and in
    `wrangler.staging.jsonc` **before** merging. Otherwise live sign-in shows
    no usable form, because Google is off.

## Records

- **PRD D-22:** email and password sign-up and sign-in through Supabase Auth,
  with confirmation and reset links. It supersedes the staging "verified email
  codes" exception and the Google-first assumption for now. Google remains
  possible later. Note the new-user path in D-01's open items without changing
  membership.
- **`docs/deployment/staging.md`:** remove the eight-digit code note, set the
  new environment variable, and add the owner's live Auth settings checklist.
- **README:** update the local sign-in steps and the seed password.

## Verification

- **Local, in a browser:**
  - Sign up a new synthetic email, confirm from the local inbox, and land
    signed in with the name shown.
  - Sign up from a session link and come back to that session.
  - Sign in with the seed accounts.
  - A wrong password gives the single neutral message.
  - Signing in before confirming shows the confirm message.
  - Forgot password, open the reset link, set a new password, then sign in with
    it.
  - Open an expired or used link and see the failure screen.
  - Check light and dark mode and phone width.
- **Automated:** an API test confirming that an unconfirmed account is still
  denied (`verified_identity_required`). A test for the return-path helper if
  it gains logic. The existing suites keep passing.
- **Live:** can only be checked after the owner sets the wProject settings and
  merges. Not claimed from local results.

## Left to the builder

- Exact component structure and whether the three auth forms share a layout
  component.
- Resend cooldown length. The owner's call if it matters; 30 seconds is a fine
  default.
- How the reset intent is stored as a fallback to the supabase-js event.
- Copy polish within the rules above.
