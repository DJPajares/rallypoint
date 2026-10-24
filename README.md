# RallyPoint

**Fill the spots, not the chat.**

Phone test: [RallyPoint](https://rallypoint.wndrhive.com). Vercel project: `rallypoint`; the existing Cloudflare deployment remains available.

A mobile-first app for getting a recurring group together. The app
provides the public shell, managed sessions, creator-owned groups, saved session
drafts, unlisted publication, verified participant/+1 registration and a strict
party waitlist, whole-party withdrawal and immediate promotion, and manual
paid/unpaid markers, fee waivers, per-seat check-in and organizer payment
instructions with an optional QR image. Session emails are described under [Session emails](#session-emails). Session cancellation preserves registration and paid history while ending unpaid liability.

## Run locally

Requirements: Node 24+ (verified with 24.16.0), pnpm 11.14.0 (pinned in
`packageManager`), and a running Docker-compatible
daemon. The first database start downloads local images. No cloud account, paid
resource or real participant data is needed for this setup.

Installation generates the Prisma 7.10.1 client locally; generated files are
ignored. Application and email database calls use Prisma's PostgreSQL adapter.
Supabase continues to supply Postgres, Auth and private file Storage.

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
| `pnpm db:generate`      | Generate the Prisma client for Node development/start and direct tests           |
| `pnpm db:validate`      | Validate the Prisma schema without database credentials                           |
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
  and explicit transactional SQL function calls through Prisma. The web app mounts it at `/api` on the same
  port, so there is one deployment and one URL. It must stay free of Next.js and
  host-specific code (`tests/api-boundary.test.mjs` enforces this) so it can run
  on its own later without a rewrite.
- `supabase`: unchanged local project identity and migration history.
- `packages/database`: server-only Prisma client and allowlisted, parameter-bound
  PostgreSQL function access shared by the API and scheduled email sender.
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

Prisma additionally requires a server-only `DATABASE_URL` pointing to the same
database as Supabase Auth/Storage. `db:start` writes the local connection into both
ignored runtime files. Existing setups must refresh those files before using
this backend. The API has no REST database fallback. Auth/configuration can still
be read without a database connection; data operations report an unavailable
service when the direct connection is missing or fails.

Hosted deployments need a reviewed direct PostgreSQL connection (or a compatible
session pooler) with verified TLS and a dedicated login allowed to assume
`service_role`. Each connection explicitly assumes that role, preserving the
existing SQL grants rather than running operations as the login's broader role.
Use supported secret storage for this URL; never put it in `NEXT_PUBLIC_*`, logs,
client code, or committed config. Hosted credential provisioning and direct
connectivity remain unverified and require their own authorized setup.

Prisma calls the existing SQL functions; it does not expose model writes. SQL
migrations under `supabase/migrations` remain the sole schema/function/grant/RLS
authority. Do not run Prisma `db push`, `migrate dev`, reset or baselining against
this database. This conversion changes no persistent schema, so recovery is a
code/configuration rollback to the earlier REST adapter, retaining all database
history. Future persistent changes still require SQL migrations and recovery plans.

The Node and Workers clients have different WASM loaders. `pnpm dev`, `pnpm build`,
`pnpm start` and `pnpm test:api` generate for Node; `pnpm build:cloudflare` and
`pnpm preview` generate for Workers. After building for Workers, run
`pnpm db:generate` before direct `node --test` invocations. Do not build for both
targets concurrently. Each request or scheduled drain closes its own Prisma
connection; no database sockets are shared across Workers requests.

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
the session and never shown. Missing/ambiguous daylight-saving times are rejected. Fixed fees support PHP/SGD/USD/EUR/GBP (two decimal places), JPY
(zero) and KWD (three). A new session starts in the currency of the device's
location (pesos in Manila, for example); the organizer can change it. No money is collected by RallyPoint.

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
Material-change emails wait for P-16 with the post-booking edit rules; see [Session emails](#session-emails).

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
creates one fee and one durable signal before start. The promotion email is
independent of the promotion (see [Session emails](#session-emails)). If a response is interrupted, keep the page open and use
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

## Payment modes

Each session's host picks how payment is handled. A session saved before this
setting existed behaves as **Pay the organizer**, so nothing about it changes.

- **Not tracked here** is the default for a new session. The session asks for no
  fee, currency or cancellation cutoff (the cutoff is stored as the start time),
  and it shows no fee, payment instructions, Dues entry or payment words on game
  day, and no "to pay" count or filter. It is never labelled "Free".
- **Pay the organizer** has a fee per seat or a split total, a cancellation fee
  cutoff and optional payment instructions. The organizer still marks payments
  by hand (see **Track payments**). Nothing collects or verifies money.

**Pay in RallyPoint** is not built. Nothing here names a country-specific
payment service.

**Unpaid spots can go to the waitlist.** For a fixed fee above zero (not a
split), the host may turn on **Unpaid spots can go to the waitlist after the
cutoff**. It locks once people book, like the fee, and the join step says
"Pay by {cutoff} or your spot may go to the waitlist." once. From the cutoff
(inclusive) until the start (exclusive), an organizer or co-host sees **Give
spot to waitlist** in the details of a confirmed party that is still unpaid.
Its confirmation repeats any "I've sent it" note. Giving the spot away is
manual and one party at a time: the whole party (guest included) leaves, its
unpaid fee is dropped with who did it and when, and the waitlist is promoted in
strict order. A party confirmed at or after the cutoff can't be released this
way, and neither can a party with anyone checked in: they showed up, so the
organizer collects at the court (correcting the check-in makes the spot
releasable again). Release needs a cutoff before the start. The player sees on
their session page that their spot went to the waitlist and may join again at
the end of the line; **Dues** shows **Released** with no amount. On game day
the released party stays under **Left** with who gave the spot away and when.

**I've sent it.** In **Pay the organizer**, a confirmed or waitlisted player
who still owes a fee can say they sent payment, with an optional reference of up
to 60 characters, and undo it until the organizer marks the fee paid. Only that
player and the session's organizers/co-hosts see it, as "Says sent" under the
party's amount on game day. It is a hint: it never counts as paid, never changes
a spot or fee, never appears on the confirmed-participant roster, and never goes
into an email. Undoing removes the note from every view, and there is no image
upload.

**Emails.** Releasing a spot saves a `released` registration event, and saving,
changing or removing payment instructions on a published session that has
bookings saves one private notice per saved revision (it holds no instruction
text). Each leaves a queued email: one to the released player, and one to each
confirmed and waitlisted primary linking to the session, with several unsent
notices for the same person combined. See [Session emails](#session-emails).

`tests/payment-modes-domain.test.mjs`, `tests/payment-modes.test.mjs`,
`tests/release-unpaid.test.mjs`, `tests/payment-notes.test.mjs`,
`tests/payment-instructions.test.mjs` and `tests/game-day-domain.test.mjs`
check the modes, release rules (role denial, cutoff and start boundaries,
stale revisions, strict promotion, two-seat parties, replay), notes and notices.
Run them with `pnpm test:api`; this is local synthetic evidence only.

For a manual check at 375 px and on desktop, sign in with the synthetic
organizer and member accounts above:

1. Create one session of each mode. "Free" must appear nowhere, the release
   switch must appear only for a fixed fee, the pay-by line must appear once in
   the join step, and the fields must lock after the first booking.
2. Publish a **Pay the organizer** session with a fixed fee and the switch on,
   a cutoff a few hours ahead and capacity 1. Book as the member before the
   cutoff, and as a second account to wait in line.
3. The cutoff can't be edited after booking, so move it as the tests do: in the
   local database, switch off the `protect_booked_session` trigger on
   `app.sessions`, set `details.cutoffAt` to now, and switch it back on.
4. As the member, choose **I've sent it** with a reference. The organizer's game
   day shows "Says sent · ref …" under the amount. **Undo** removes it; mark it
   again.
5. As the organizer, open the member's row and choose **Give spot to waitlist**.
   The confirmation names the unpaid amount and repeats the note. Choose
   **Keep** (focus returns to the row), then repeat and choose **Give spot
   away**.
6. The waiting account is now confirmed. The member sees that their spot went
   to the waitlist, can join again and lands at the end of the line, and
   **Dues** shows **Released** with no amount. On game day the member stays under
   **Left** with "Spot given to the waitlist by {organizer} · {time}". Check in a
   second unpaid member and confirm their details offer no **Give spot to
   waitlist**.
7. Check keyboard focus moves into each sheet and back to the row or button,
   every status is in words (not colour alone), and the sheets work with
   reduced motion.

## Cancel a session

In **Manage session**, choose **Cancel session** and confirm once. Current
organizers/co-hosts can cancel a draft or published session. Cancellation is
terminal: joining, waitlisting, promotion, self-service withdrawal and session
editing stop. Registrations stay as historical records. Unpaid fees, including
retained late-withdrawal fees and pending split claims, stop being due; each
removal records the cancelling actor/time. Paid records remain unchanged. Arrange
any refund outside RallyPoint; the app never says a refund happened.

Previously published links show **Cancelled**. Cancelled drafts remain private.
A private durable cancellation signal is saved in the same transaction and queues
the cancellation emails described under [Session emails](#session-emails). Interrupted requests use **Check result** or
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

Organizers and co-hosts see the session as **game day** (PRD D-17):

- Three numbers at the top: **here** (checked-in seats out of confirmed seats), **to pay**, and **waiting**.
- Filters for **Everyone**, **Not here** and **To pay**.
- One row per party. A round button checks the primary in, or undoes it.
- Tapping a row opens that party's sheet: every seat, starting **Not recorded**, with **Check in**, **Clear** or, once the end time has passed, **Mark no-show**, plus the payment controls described above. The server checks the end time with its own clock.
- **Waiting** and **Left** sections list waitlisted parties and parties that withdrew but still have a fee to settle.
- A cancelled session keeps the plain records list.

Nothing becomes a no-show automatically. Waitlisted, withdrawn and cancelled
places cannot be checked in. Attendance never changes seats, fees or payment
markers, and participants never see attendance, their own or anyone else's.

Like payments, each change records who made it and when, and names the revision
the organizer saw; a stale or simultaneous change is refused rather than
overwriting a newer one.

`pnpm test:api` checks organizer/co-host-only access (including a revoked
co-host), independent primary/guest seats and corrections, waitlisted/withdrawn/
cancelled refusal, the end-time no-show boundary, stale and simultaneous changes,
request-key replay and that participants receive no attendance data. A synthetic
fixture moves a booked session's end into the past for the no-show cases.

For a manual check:

1. Publish a session and join it with a guest.
2. As organizer, tap the primary's round button. **here** goes up by one.
3. Tap it again to undo, then check them in once more.
4. Open the row and check the guest in from the sheet.
5. After the end time, mark a seat as a no-show from the sheet.
6. Try **Not here** and **To pay**.
7. Confirm the participant's page shows no attendance.

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

A new badge appears once, as a sheet on Home or on a session page. **Done** or **Show as my title** marks it seen. Home shows one progress row toward your closest badge. **Profile** in the floating menu (your initials in a gradient ring) shows your numbers, your shelf and **Choose title**, and ends with your sign-in email and **Sign out**. A title shows as a small pill next to your name on rosters, only while you still have that badge. Nobody else can open your profile.

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
QR image read only through the API. Session emails are described under
[Session emails](#session-emails).

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

## Session emails

P-06 sends short account emails about a person's own place. A failed or missing
email never changes a spot, a promotion, a release, a cancellation or a fee; the
session page stays the authority.

**What is sent, and to whom.** Only the primary account receives anything; guests,
other participants and organizers (as organizers) do not.

| Email           | Sent to                                                                                 |
| --------------- | --------------------------------------------------------------------------------------- |
| Booking         | The primary who joined with a confirmed place                                           |
| Waitlist        | The primary who joined the waitlist                                                     |
| Moved up        | The primary promoted from the waitlist                                                  |
| Spot released   | The primary whose unpaid spot an organizer gave to the waitlist                         |
| Cancellation    | Primaries confirmed or waitlisted at cancellation, and those whose unpaid fee it ended  |
| Payment details | Confirmed and waitlisted primaries, when published payment instructions change         |
| Reminder        | The primary of a party confirmed at least 24 hours before the start, still confirmed    |

Subjects are generic. A body holds only the person's own status, the session
title, its local date and time, and a link. It never names other participants,
payment details or notes, and it has no open or click tracking. There is
one reminder per session and person, attempted during the 15 minutes after it's due, and never late; a
confirmation or promotion after that time gets no catch-up reminder. Booked
details stay locked until P-16, so there are no material-change emails.

**What organizers see.** In a person's details on game day, an **Emails** list
shows the latest email of each kind for that person. A cancelled session shows
one line of cancellation counts. Addresses are never shown. The only words are:

| Words                                   | Meaning                                                                      |
| --------------------------------------- | ---------------------------------------------------------------------------- |
| Queued                                  | Waiting, or being sent. "Queued · daily email limit" (or monthly) when held for a sending limit |
| Sent to email service                   | The email service accepted it. Not "delivered": RallyPoint cannot know       |
| Not confirmed                           | An attempt's outcome is unknown (for example a timeout), so RallyPoint will not say it was or wasn’t sent |
| Not sent · {reason}                     | It will not be sent: no longer applies, too late, email service refused it, couldn’t be prepared, email service didn’t accept it, email is off, too many emails waiting, no verified email, or email address changed |

Bounces and later delivery problems are visible only in the Resend dashboard;
RallyPoint does not receive them.

**Ceilings.** A scheduled run handles at most 5 emails, one request at a time and
at least a second apart. At most 50 attempts per UTC day and 1,500 per UTC month
are made; each attempt counts, retries and unknown outcomes included. Each email
is tried up to 3 times (now, after 1 minute, after 5 more) with a 10-second
timeout and a stable idempotency key. A cancellation or payment-details update
that would reach more than 50 people is withheld entirely (never sent to "the
first 50"). Organizers see "Cancellation emails weren’t sent: more than 50
people." on the cancelled session, and "Payment-details emails weren’t sent:
more than 50 people." beside the payment instructions editor (once, for the
latest withheld update). At most 500 emails wait at once; the 501st is marked not sent. An
email is never attempted after it expires.

**Switching it on.** Delivery is off unless `EMAIL_DELIVERY_ENABLED=true` and
`APP_ORIGIN` (the address the links point at) is set. While it is off, due
emails are marked **Not sent · email is off** rather than held. `EMAIL_PROVIDER`
is `mailpit` (local only) or `resend`; `MAILPIT_URL` is the local inbox's address.
`apps/web/.env.example` documents these for Next. The Worker that sends reads
them, with the Supabase settings, from `apps/web/.dev.vars` or `--var`; `db:start`
does not add the email variables. A live Resend key would be read only from the
`RESEND_API_KEY` server secret, and none is set or needed here.

**Locally.** The sender is the every-minute `scheduled` handler in the Cloudflare
Worker (`apps/web/worker.ts`); `pnpm dev` queues emails but does not send them.
Mailpit is the local inbox at `http://127.0.0.1:54324`. The Worker-runtime check
that passed on 2026-10-23, with local synthetic data (run `pnpm db:start` first):

1. `pnpm --filter @rallypoint/web build:cloudflare`
2. `pnpm --filter @rallypoint/web exec wrangler dev --test-scheduled --ip 127.0.0.1 --port 8788 --var EMAIL_DELIVERY_ENABLED:true --var EMAIL_PROVIDER:mailpit --var MAILPIT_URL:http://127.0.0.1:54324 --var APP_ORIGIN:http://127.0.0.1:8788`
3. Join a synthetic published session through that Worker, then call
   `GET http://127.0.0.1:8788/__scheduled?cron=*+*+*+*+*`.
4. The job moves from queued to sent and one message reaches the account in Mailpit.

Integration tests cover the queue and organizer status
(`tests/email-outbox.test.mjs`), dispatch rules (`tests/email-dispatch.test.mjs`),
the drain (`tests/email-drain.test.mjs`), rendering
(`tests/email-render-domain.test.mjs`) and the status words
(`tests/game-day-domain.test.mjs`).

**Not live yet.** Staging has no cron and sends no email until P-12, which owns
the live sender, its domain-restricted key, the shared-quota acceptance and
runtime verification. This section is local synthetic evidence only.
The [D-05 email delivery brief](docs/superpowers/specs/2026-10-22-email-delivery-decisions.md)
records the accepted recipient and timing rules, scheduler, ceilings and
failure statuses.

## Phone staging

The owner selected shared wProject with RallyPoint-specific schemas and verified email codes for staging on 2026-10-23. The current test address is [rallypoint.wndrhive.com](https://rallypoint.wndrhive.com), hosted in the Vercel project `rallypoint`. The original Cloudflare Worker `rallypoint-staging` remains running. See [staging deployment and recovery](docs/deployment/staging.md) for the exact boundaries, clean-build commands and runtime configuration. Local development stays isolated.
