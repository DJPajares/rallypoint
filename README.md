# RallyPoint

**Fill the spots, not the chat.**

Phone test: [RallyPoint](https://rallypoint.wndrhive.com). Vercel project: `rallypoint`; the existing Cloudflare deployment remains available.

A mobile-first app for getting a recurring group together. The app
provides the public shell, managed sessions, creator-owned groups, saved session
drafts, unlisted publication, verified participant/+1 registration and a strict
party waitlist, whole-party withdrawal and immediate promotion, and manual
paid/unpaid markers, fee waivers, per-seat check-in and organizer payment
instructions with an optional QR image. Email remains with subsequent tasks. Session cancellation preserves registration and paid history while ending unpaid liability.

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

Open [the app](http://127.0.0.1:3000) and
[the local mail inbox](http://127.0.0.1:54324).

`db:start` starts only the local RallyPoint Postgres/Auth/REST/Storage/mail services,
applies pending local migrations, writes local credentials to ignored `apps/web/.env.local` and
`apps/web/.dev.vars`
without logging them, and seeds
four synthetic Auth identities and two groups. The Docker network binds published
ports to loopback. Existing unrelated containers and Supabase projects are not used.
Next.js uses port 3000 on loopback. Free that port before starting the app.

If you set up before the app moved from port 5173 to 3000, restart the local
services once so sign-in accepts the new address (your data is kept):
`pnpm db:stop && pnpm db:start`. Supabase Auth reads its allowed addresses only
when it starts.

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
| `pnpm dev`              | Turbo runs Next.js development at 127.0.0.1:3000                                 |
| `pnpm check`            | Workspace lint/type checks and Next production build                             |
| `pnpm build`            | Build the Next.js app through Turbo                                              |
| `pnpm start`            | Serve the built Next.js app on Node at port 3000                                 |
| `pnpm build:cloudflare` | Build the local OpenNext Cloudflare Worker artifact                              |
| `pnpm preview`          | Serve that artifact locally on Workers at port 3000                              |
| `pnpm db:lint`          | Check local SQL/function typing                                                  |
| `pnpm test:api`         | Real local Auth/API and page/navigation regression tests; app/DB must be running |
| `pnpm db:start`         | Start/reuse local services, apply pending migrations and refresh synthetic setup |
| `pnpm db:reset`         | Recreate only the local synthetic DB and seed identities/roles                   |
| `pnpm db:stop`          | Stop the local containers while preserving data                                  |

Choose one server at a time on port 3000. Run `pnpm build` before `pnpm start`,
or `pnpm build:cloudflare` before `pnpm preview`. To test another loopback port,
set `RALLYPOINT_TEST_URL` when running the suite. No command deploys the app. If this checkout previously ran Vite, remove its
obsolete generated `.wrangler/deploy/config.json` before the first OpenNext
preview; it points Wrangler at the old build directory.

## Workspace

- `apps/web`: Next.js App Router pages, client Auth/UI and dynamic API routes.
- `packages/domain`: browser-safe contracts, session validation, exact money formatting and auth return-path validation.
- `apps/api`: the API as a Hono app with Zod-validated requests: verified identity
  and explicit Supabase RPC calls. The web app mounts it at `/api` on the same
  port, so there is one deployment and one URL. It must stay free of Next.js and
  host-specific code (`tests/api-boundary.test.mjs` enforces this) so it can run
  on its own later without a rewrite.
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

Times are wall-clock times in the timezone of the organizer's device, saved with
the session and never shown. Missing/ambiguous daylight-saving times are rejected. Fixed fees support SGD/USD/EUR/GBP (two decimal places), JPY
(zero) and KWD (three). No money is collected by RallyPoint.

Failed validation keeps entered fields. If a response is interrupted, keep the
page open and use **Check result** or **Retry same request**. The exact payload
and request key stay in page memory until confirmed; do not submit a different
request or close the page during recovery. Saved drafts survive navigation.
Version conflicts require reloading the session before reconciling changes.

Organizers/co-hosts may edit before bookings. Published detail edits have a new
version and durable changed-field signal. P-03 must set `bookings_started_at`
under its booking transaction's session lock before enabling registration; after
that all detail changes are locked. The accepted post-booking edit rules (PRD
D-14) replace that lock once P-16 implements them.
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
the page shows the cutoff (in the session's local time) and the fee implications. The
server checks its own clock after lock waits. Withdrawal closes exactly at start;
existing records stay visible.

Before cutoff an unpaid obligation stops being due, with its original allocation
and removal actor/time retained. At or after cutoff the original obligation
remains until an explicit organizer waiver, even when someone fills the vacancy.
A replacement owes its own published fee independently. Manual paid declarations
are preserved on either side of cutoff; any refund is handled externally.
Organizers mark payments and waive fees as described below.

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

## Track payments

Organizers and co-hosts see each party's fee in the session's roster as
**Unpaid**, **Paid**, **Waived** or **Removed**, with the last change and who made
it. **Mark paid** and **Mark unpaid** record a manual declaration after the
organizer checks their own payment account; RallyPoint never collects or verifies
money. **Waive fee** ends an unpaid obligation, such as a fee retained after a
late withdrawal; **Undo waiver** corrects a mistaken waiver. A paid fee cannot be
waived (mark it unpaid first), and a waived or removed fee cannot be marked paid,
so a payment record is never rewritten into a waiver or refund. None of these
change seats or the queue.

Every change records its actor and time. Each write names the fee revision the
organizer saw; if someone else changed the fee first, the request is refused and
the page asks for a refresh instead of overwriting the newer record. Participants
see only their own fee on the session page and under **Dues**, which lists their
unpaid fees first and settled ones below.

`pnpm test:api` checks organizer/co-host-only access (including a revoked
co-host), the paid/unpaid/waive/undo transitions, retained late-withdrawal
waivers, stale and simultaneous corrections, request-key replay and Dues privacy.

For a manual check, publish a session with the cutoff in the past. Join as one
participant with a guest, join and withdraw as another. As organizer, mark the
first paid and waive the second; then, from a second browser, mark the first
unpaid and retry **Mark unpaid** in the first browser. It must be refused. Open
**Dues** as each participant and confirm each sees only their own fee.

## Payment instructions

In **Manage session**, use **Payment instructions** to say how people pay you,
for example a PayNow number and reference, and optionally add one QR image
(PNG, JPEG or WebP, up to 1 MB). You can save, correct or remove them at any
time, including after people book. They are kept apart from the locked session
details and never change seats, fees or paid markers.

Only organizers/co-hosts and people with a confirmed or waitlisted place see
them, under **How to pay** on the session page. Link visitors, other accounts,
people who withdrew and cancelled sessions don't. If the image is missing or
doesn't load, the written instructions remain. The page says payment happens
outside RallyPoint; nothing here collects or confirms money.

The image is stored in a private local Storage bucket and is only served
through the app after a fresh access check. If you set up before this change,
restart once so Storage starts and the migration creates the bucket:
`pnpm db:stop && pnpm db:start`.

`tests/payment-instructions.test.mjs` checks organizer/co-host-only writes
(including a revoked co-host), reads for confirmed, waitlisted, withdrawn,
unrelated and visitor identities, share-response privacy, unsafe and oversized
uploads, stale revisions, same-key replays leaving one stored image,
cancellation and unchanged seats/fees/paid markers.

For a manual check, publish a session and join it from a second account. As
organizer, save instructions and add a PNG QR; confirm the details stay locked.
As the participant, see both, then block the image request (or remove the
stored file) and confirm the text remains. Open the link signed out and as
another account; neither shows payment details. Try an SVG and a file over
1 MB; both are refused.

## Cancel a session

In **Manage session**, choose **Cancel session** and confirm once. Current
organizers/co-hosts can cancel a draft or published session. Cancellation is
terminal: joining, waitlisting, promotion, self-service withdrawal and session
editing stop. Registrations stay as historical records. Unpaid fees, including
retained late-withdrawal fees and pending split claims, stop being due; each
removal records the cancelling actor/time. Paid records remain unchanged. Arrange
any refund outside RallyPoint; the app never says a refund happened.

Previously published links show **Cancelled**. Cancelled drafts remain private.
A private durable cancellation signal is saved in the same transaction for P-06;
this action sends no email. Interrupted requests use **Check result** or
**Retry same request** without a second cancellation. Current roles are rechecked
on replay and recovery.

`tests/cancellations.test.mjs` exercises role/replay denial, fee and party
preservation, split claims/allocations, join races, signal deduplication, rollback
and draft privacy using local synthetic Auth/Postgres. Apply the migration with
`pnpm db:start`. For disposable local data, `pnpm db:reset` recreates the test DB;
a real cancellation has no undo. Before any eventual production migration, take
a verified backup and use a forward repair for defects; reverting the application
must not restore cancelled sessions or unpaid liabilities.

## Check in

The organizer roster lists each confirmed place separately: the primary
registrant and, for a party of two, their guest. Each starts **Not recorded**.
Organizers and co-hosts choose **Check in**, **Clear** or, once the session's end
time has passed, **Mark no-show**; the server checks the end time with its own
clock. Nothing becomes a no-show automatically. Waitlisted, withdrawn and
cancelled places cannot be checked in. Attendance never changes seats, fees or
payment markers, and participants never see attendance, their own or anyone
else's. The roster shows how many places are checked in.

Like payments, each change records who made it and when, and names the revision
the organizer saw; a stale or simultaneous change is refused rather than
overwriting a newer one.

`pnpm test:api` checks organizer/co-host-only access (including a revoked
co-host), independent primary/guest seats and corrections, waitlisted/withdrawn/
cancelled refusal, the end-time no-show boundary, stale and simultaneous changes,
request-key replay and that participants receive no attendance data. A synthetic
fixture moves a booked session's end into the past for the no-show cases.

For a manual check, publish a session, join with a guest, and as organizer check
in the primary but not the guest. Clear and restore the primary. After the end
time, mark the guest a no-show. Confirm the participant's page shows no attendance.

Local development is not linked to the shared cloud Supabase project. Phone-test
hosting is configured separately on Vercel and Cloudflare; see [deployment setup](docs/deployment/staging.md).
Next production and local OpenNext build/preview are separate checks; neither
provisions a cloud resource. The adapter uses no R2/ISR cache in this app. PWA manifest and
192/512-pixel icons are present. Chromium installability diagnostics pass in a
normal local browser profile; actual device installation and safe shell caching
remain part of later PWA verification. There is no offline mutation queue or identity-data cache.

## Total session costs

Choose **Total to split** in session pricing and enter the full cost. Confirmed
seats and unwaived late cancellations share that total, including guests and
replacement seats. Estimates change with the paying headcount; waiting is free.
The organizer finalizes exact amounts once the session starts. Dues separates
estimated shares from amounts to pay; a zero share says **Nothing due**.

For a local walkthrough, publish a synthetic split session, join with a guest
and a solo participant, and inspect the estimates and join consent. Before
finalization, waive/undo a contingent share from the roster; no payment control
is available. After start, review the exact party amounts and finalize. Mark a
positive amount paid, then try lowering the total: the affected paid allocation
blocks confirmation. Explicitly mark it unpaid after resolving the payment,
review the correction with a reason, and confirm. Check own history and Dues.
Ordinary waivers leave other bills fixed. Restoring a share omitted from the
current split requires a reviewed correction. Corrections can keep or lower
the effective total; they preserve past amounts and never process refunds.

Use isolated synthetic fixtures for time-boundary and interruption checks,
never reset shared data or change real-session clocks. The API suites exercise
post-lock server time, retries, stale previews, privacy and exact rounding.
Interrupted writes keep **Check result** and **Retry same request** until the
outcome is confirmed. See the [split contract](docs/foundation-api.md#split-cost-claims)
and [accepted design](docs/superpowers/specs/2026-10-22-split-session-cost-design.md).

## Badges and titles

Badges come from records RallyPoint already keeps (PRD D-16):

- Playing: your first session, five sessions with one group, 10/25/50/100 sessions, and moving up from the waitlist and showing up.
- People: a guest you brought showing up, and playing alongside 10/25/50 different people.
- Hosting: running check-in at a session, ten sessions, a session where every seat was taken, and owning a group.

They're worked out on every read, so correcting a check-in or cancelling the session removes a badge that depended on it. Payments, no-shows and waitlist position are never used. Only the "seen" markers and your chosen title are stored.

A new badge appears once, as a sheet on Home or on a session page. **Done** or **Show as my title** marks it seen. Home shows one progress row toward your closest badge. **Profile** in the floating menu shows your numbers, your shelf and **Choose title**. A title shows as a small pill next to your name on rosters, only while you still have that badge. Nobody else can open your profile.

For a local walkthrough:

1. As the organizer fixture, publish a session.
2. Join it as `member@rallypoint.test` with a guest, and as `outsider@rallypoint.test`.
3. Check everyone in.
4. Sign in as the member. Home shows the new badge once. Choose a title, then open the session to see the pill on the roster.
5. Mark the member's seat unrecorded again. The badge and the pill disappear.

`tests/badges.test.mjs` covers these rules, refused titles, forged seen markers, no-shows, waiting and cancelled sessions. `tests/badges-domain.test.mjs` covers the catalog wording and ordering. See the [design brief](docs/superpowers/specs/2026-10-22-reclub-competitive-analysis-design.md).

The migration `20261022170000_badges.sql` adds two small tables (`app.badge_views`, `app.user_titles`), read-only badge functions and an index. It also replaces `app.registration_view_before_split` with the same roster plus `title`. To recover:

1. Drop the new functions and tables.
2. Re-create `app.registration_view_before_split` from `20261022090743_split_cost_claims.sql`.

Nothing else changes, and no existing record is rewritten.

## Where to work next

- `apps/web/`: native Next routes, app shell, Auth and identity-scoped request state.
- `apps/api/`: verified identity boundary and trusted API operations (Hono + Zod).
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
and package-manager choice under D-11. The owner added Vercel hosting on
2026-10-23, retaining Cloudflare through OpenNext alongside it; Supabase and
accepted product policies remain in place. The remaining D-01
membership and D-03/D-04 policies retain their own gates; the accepted D-05 delivery choices are recorded in the email decision brief below. On 2026-10-22
the owner accepted creator-as-owner bootstrap and the pre-booking edit boundary
for P-02. General membership and invitation policies remain separate.

Session publishing reuses this shell, Auth/data boundary and migration history.
Registration adds party/queue records, separate initial fee obligations and durable
registration signals. Withdrawal adds auditable liability removal and preserves manual paid declarations.
Payment tracking adds revisioned paid/unpaid markers, waivers and a per-fee
change history. Attendance adds revisioned per-seat records with their own change
history. Payment instructions add a separate revisioned record and a private
QR image read only through the API. Outbound delivery remains later work.

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

## Email decision work

The [D-05 email delivery brief](docs/superpowers/specs/2026-10-22-email-delivery-decisions.md)
records the owner's accepted Trove sender reuse, recipient/timing rules,
scheduler, retry/quota ceilings and failure statuses (approved 2026-10-22).
P-06 owns implementation; P-12 owns live sender/key/shared-quota/runtime verification.
Delivery is not implemented or enabled. Trove's shared SMTP/Auth configuration is unchanged.


## Phone staging

The owner selected shared wProject with RallyPoint-specific schemas and verified email codes for staging on 2026-10-23. The current test address is [rallypoint.wndrhive.com](https://rallypoint.wndrhive.com), hosted in the Vercel project `rallypoint`. The original Cloudflare Worker `rallypoint-staging` remains running. See [staging deployment and recovery](docs/deployment/staging.md) for the exact boundaries, clean-build commands and runtime configuration. Local development stays isolated.
