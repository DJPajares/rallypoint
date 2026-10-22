# RallyPoint

**Fill the spots, not the chat.**

A mobile-first app for getting a recurring group together. The app
provides the public shell, managed sessions, creator-owned groups, saved session
drafts, unlisted publication, verified participant/+1 registration and a strict
party waitlist, whole-party withdrawal and immediate promotion. Payment controls
and attendance remain with subsequent tasks.

## Run locally

Requirements: Node 24+ (verified with 24.16.0), pnpm 11.14.0 (pinned in
`packageManager`), and a running Docker-compatible
daemon. The first database start downloads local images. No cloud account, paid
resource or real participant data is needed for this setup.

```sh
pnpm install --frozen-lockfile
pnpm db:start
pnpm dev
```

Open [the app](http://127.0.0.1:5173) and
[the local mail inbox](http://127.0.0.1:54324).

`db:start` starts only the local RallyPoint Postgres/Auth/REST/mail services,
applies pending local migrations, writes local credentials to ignored `apps/web/.env.local` and
`apps/web/.dev.vars`
without logging them, and seeds
four synthetic Auth identities and two groups. The Docker network binds published
ports to loopback. Existing unrelated containers and Supabase projects are not used.
Next.js uses port 5173 on loopback. Free that port before starting the app.

In the local sign-in form, request a code for one of these fixtures and read the
message in the local inbox. No message is sent outside the local mail sink.

| Synthetic account         | Expected view                                    |
| ------------------------- | ------------------------------------------------ |
| organizer@rallypoint.test | Sunday Social Club; organizer group view allowed |
| member@rallypoint.test    | Sunday Social Club; organizer group view denied  |
| outsider@rallypoint.test  | Eastside Rallies; Sunday Social Club denied      |
| newcomer@rallypoint.test  | Empty group list                                 |

The fixed password in `scripts/local-env.mjs` is for these local-only test users.
Never reuse it for a real account. Global public signup is disabled; the local
email provider is enabled only to exercise existing synthetic identities.

## Commands

| Command                 | Purpose                                                                          |
| ----------------------- | -------------------------------------------------------------------------------- |
| `pnpm dev`              | Turbo runs Next.js development at 127.0.0.1:5173                                 |
| `pnpm check`            | Workspace lint/type checks and Next production build                             |
| `pnpm build`            | Build the Next.js app through Turbo                                              |
| `pnpm start`            | Serve the built Next.js app on Node at port 5173                                 |
| `pnpm build:cloudflare` | Build the local OpenNext Cloudflare Worker artifact                              |
| `pnpm preview`          | Serve that artifact locally on Workers at port 5173                              |
| `pnpm db:lint`          | Check local SQL/function typing                                                  |
| `pnpm test:api`         | Real local Auth/API and page/navigation regression tests; app/DB must be running |
| `pnpm db:start`         | Start/reuse local services, apply pending migrations and refresh synthetic setup |
| `pnpm db:reset`         | Recreate only the local synthetic DB and seed identities/roles                   |
| `pnpm db:stop`          | Stop the local containers while preserving data                                  |

Choose one server at a time on port 5173. Run `pnpm build` before `pnpm start`,
or `pnpm build:cloudflare` before `pnpm preview`. To test another loopback port,
set `RALLYPOINT_TEST_URL` when running the suite. No command deploys the app. If this checkout previously ran Vite, remove its
obsolete generated `.wrangler/deploy/config.json` before the first OpenNext
preview; it points Wrangler at the old build directory.

## Workspace

- `apps/web`: Next.js App Router pages, client Auth/UI and dynamic API routes.
- `packages/domain`: browser-safe contracts, session validation, exact money formatting and auth return-path validation.
- `packages/api`: server-only verified-identity operations and explicit Supabase RPC calls.
- `supabase`: unchanged local project identity and migration history.
- `scripts` / `tests`: root local lifecycle and meaningful integration checks.

Workspace dependencies use `workspace:*`. Turbo orders package checks and caches
lint/type results inside this checkout's `.turbo/cache` (including in Git worktrees). Builds, dev servers and database/integration commands are not
cached; build artifacts may contain server environment values and must be treated
as credential-bearing. Remote caching is disabled.
The six new page/navigation checks cover server-rendered home HTML, native deep
links/404s, manifest/icons and safe auth return paths without browser globals.

After reset, sign out of old browser sessions and sign in again: recreated fixture
users have new IDs. Reset is a development recovery procedure, not a production
migration/backup plan. The helper always targets local services; it has no linked
or remote reset path. Do not place real data in this development database.

`pnpm test:api` uses the synthetic passwords without logging tokens. It checks
missing/forged sessions, group isolation, metadata role spoofing, immediate role
revocation, backend-RPC denial, internal-table exposure and truthful empty results.
It temporarily removes and restores the synthetic organizer role.

## Configuration

Copy `apps/web/.env.example` to `apps/web/.env.local` only for manual configuration. `db:start` normally
creates the real local file for you. Keep the Supabase secret/service key in that
ignored server-only file or supported runtime secret storage. `db:start` also
writes app-local `.dev.vars` for Workers preview. The app's public
configuration contains only the Auth URL/publishable key and enabled methods.
Never expose the server key through `NEXT_PUBLIC_*`, Next config `env`, source,
logs or client caches. API configuration is read at runtime; private responses
and mutation result lookups stay `no-store`. Production runtime secrets are a
separate setup step.

The shell works without configuration; sign-in explains the missing setup rather
than claiming a connection succeeded. All private API responses are uncached.

Google OAuth is the accepted live identity method. Its Supabase provider,
Google client, allowed audience/origins and callback URL still need separate
configuration and verification. The callback is `/auth/callback`; the app resumes
only validated same-origin destinations. Set `GOOGLE_AUTH_ENABLED=true` only when
the provider is configured. The local email-code exercise is enabled only for a
loopback request with a loopback Auth service and `LOCAL_AUTH_ENABLED=true`.
It does not prove live Google OAuth.

## Publish a session

Sign in, select **Start a group**, and enter a name. You become its owner.
Open the group and select **Create session**. Save an incomplete draft or fill
all session details and publish; copy the stable link and open it unsigned.
Only published details are shared. Drafts are stored in the database, not offline
browser storage. No reservation is created by opening the link.

All four times use the explicit IANA timezone. Missing/ambiguous daylight-saving
times are rejected. Fixed fees support SGD/USD/EUR/GBP (two decimal places), JPY
(zero) and KWD (three). No money is collected by RallyPoint.

Failed validation keeps entered fields. If a response is interrupted, keep the
page open and use **Check result** or **Retry same request**. The exact payload
and request key stay in page memory until confirmed; do not submit a different
request or close the page during recovery. Saved drafts survive navigation.
Version conflicts require reloading the session before reconciling changes.

Organizers/co-hosts may edit before bookings. Published detail edits have a new
version and durable changed-field signal. P-03 must set `bookings_started_at`
under its booking transaction's session lock before enabling registration; after
that all detail changes are locked pending the booked-event edit contract.
P-06 owns outbound change notifications; no email is sent here.

`pnpm test:api` also checks owner bootstrap, private drafts, invalid
publication, simultaneous retry/version conflicts, share projections, booked-edit
denial and operation-result recovery. Tests run serially and clean up their
synthetic sessions/groups. For an existing local installation, rerun
`pnpm db:start` to apply pending local migrations. The reset command remains
the synthetic-only recovery option.

## Join or waitlist

Open a published link. Visitors see confirmed seat totals and waiting-party counts.
Sign in to join; optionally include one guest when enabled. **Agree & join** (or
**Agree & waitlist** when full) accepts
the displayed fixed fee and automatic pre-start confirmation if waitlisted, including
after cutoff. Waiting is free. A whole party waits when it cannot fit; a later solo
cannot bypass it. Joining never grants group membership or organizer rights.

Your confirmed/waitlisted result comes from the database. A party's queue position
is current information, not a guarantee. **Refresh status and availability** rechecks
it. Confirmed participants see display names only; organizers/co-hosts see the full
roster and initial obligations. Participants see only their own fee information.
No payment marker or transfer verification is implied.

New joins and waiting entries close exactly at start; opening/start are checked
using the server clock after lock waits. Existing registrations remain visible.
Interrupted requests reuse the existing result-check/same-request recovery flow;
there is no offline queue. Guest changes remain outside this increment.

## Withdraw and fill vacancies

Use **Withdraw my place**, **Withdraw both seats**, or **Withdraw from waitlist**
on your own registration. The primary withdraws the whole party; an organizer
cannot use this self-service operation for another participant. Before submitting,
the page shows the cutoff in the event timezone and the fee implications. The
server checks its own clock after lock waits. Withdrawal closes exactly at start;
existing records stay visible.

Before cutoff an unpaid obligation stops being due, with its original allocation
and removal actor/time retained. At or after cutoff the original obligation
remains until an explicit organizer waiver, even when someone fills the vacancy.
A replacement owes its own published fee independently. Manual paid declarations
are preserved on either side of cutoff; any refund is handled externally.
Payment correction/waiver controls belong to P-05 and are not enabled here.

Withdrawal releases seats and reconciles the strict whole-party queue in the same
transaction. A two-seat head waits until both seats are free; later solos cannot
bypass it. Removing a waiting head also reconciles the remaining queue. Promotion
creates one fee and one durable signal before start. Email delivery is independent
and belongs to P-06. If a response is interrupted, keep the page open and use
**Check result** or **Retry same request** before taking another action.

`pnpm test:api` checks simultaneous last-seat joins, duplicate joining and
withdrawal, guest/consent denial, strict ordering, withdrawal/promotion/new-join
races, fee preservation, privacy, no automatic membership, terminal-event denial,
and opening/cutoff/start lock waits. Independent HTTP clients use real local Auth
and Postgres. Synthetic SQL fixtures temporarily change an event deadline under a
held group/session lock; public requests must wait and then use server time.
The exact-cutoff financial transition is also exercised with explicit internal
instants immediately before, equal to and after cutoff; public callers cannot
supply that clock. Temporary synthetic identities and sessions are cleaned up.

For a manual check, publish a two-seat event and fill it with two solo parties.
Waitlist a party of two, then a solo. Withdraw one confirmed solo: neither waiting
party should confirm. Withdraw the second: the party of two confirms once with
its two-seat fee, and the solo remains first in line. Repeat with a cutoff in the
past and inspect the departing parties' retained fees. Refresh as each actor;
public and other participant views must not expose financial records.

No cloud Supabase project is linked and no Cloudflare/Resend service is provisioned.
The configuration contains no deploy script. Next production and local OpenNext
build/preview are separate checks; neither provisions a cloud resource. The
adapter uses no R2/ISR cache in this app. PWA manifest and
192/512-pixel icons are present. Chromium installability diagnostics pass in a
normal local browser profile; actual device installation and safe shell caching
remain part of later PWA verification. There is no offline mutation queue or identity-data cache.

## Where to work next

- `apps/web/`: native Next routes, app shell, Auth and identity-scoped request state.
- `packages/api/`: verified identity boundary and trusted API operations.
- `packages/domain/`: shared browser-safe types and validation.
- `supabase/migrations/`: versioned schema; `app` tables are unexposed and
  backend RPCs in `api` deny browser roles.
- [Foundation API contract](docs/foundation-api.md): reusable operations and errors.
- `scripts/local.mjs`: isolated local lifecycle and synthetic fixtures.
- `tests/api.test.mjs`: focused API authorization regression checks.
- [PRD](PRD.md): product requirements and accepted/open decisions.
- [Agent rules](AGENTS.md), [Claude bridge](CLAUDE.md).

D-10 was approved in chat on 2026-10-22. The approved stack is
React/TypeScript/Vite/npm, Cloudflare Workers, Supabase Postgres/Auth,
Google OAuth and Resend. The [P-01 decision brief](https://linear.app/wwonderland/document/p-01-technical-decision-recommended-stack-and-session-loop-contract-eba7e99b792c)
contains the original research and proposed future contracts. On 2026-10-22,
the owner requested Next.js, Turborepo and pnpm, replacing the original frontend
and package-manager choice under D-11. Cloudflare remains the hosting target
through OpenNext; Supabase and accepted product policies remain in place. The remaining D-01
membership and D-03/D-04/D-05 policies retain their own gates. On 2026-10-22
the owner accepted creator-as-owner bootstrap and the pre-booking edit boundary
for P-02. General membership and invitation policies remain separate.

Session publishing reuses this shell, Auth/data boundary and migration history.
Registration adds party/queue records, separate initial fee obligations and durable
registration signals. Withdrawal adds auditable liability removal and preserves manual paid declarations.
Payment controls and outbound delivery remain later work.

## Project destinations

- [GitHub repository](https://github.com/DJPajares/rallypoint), integration through
  reviewed PRs to `main`; the owner controls merging.
- [RallyPoint in Linear](https://linear.app/wwonderland/project/rallypoint-a26d48cd9e2d)
  owns approved task status and real dependencies.
- [WDL-382](https://linear.app/wwonderland/issue/WDL-382) owns this scaffold.
- [Reviewed original task batch](FIRST_SESSION_TASK_PROPOSAL.md) records publication
  provenance. WDL-382 was added later at the owner's request; archived TP tasks stay history.

Earlier documentation/planning provenance remains in Git history, including the
[bootstrap source](https://github.com/DJPajares/project-bootstrap-template/blob/ffc643068690548995a67d4bb85c3785894f9ec6/PROJECT_BOOTSTRAP.md).
Past provider research is not live integration evidence. Each change's PR/issue
report records its actual checks, environment and limitations.
