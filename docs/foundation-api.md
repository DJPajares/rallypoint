# Foundation API

The browser authenticates with Supabase Auth. The Next.js API route mounts the Hono app in `apps/api` (`app.fetch(request, env)`), which verifies the access
token with `getUser`, requires a verified managed email, and derives the actor
from that response. Editable metadata is display-only. All responses use
`Cache-Control: no-store`. Rejected unread bodies are discarded without parsing,
bounded to 16 KiB and one second, so small authorization/method errors remain
visible through the local proxy.

Request bodies and path parameters are validated with Zod schemas. Every
validation failure for one request maps to that request's single `422` code and
message, so clients see the same wording whichever field was wrong. An unknown
`GET` path returns `404 not_found`; any other method on an unknown path, a
known path's unsupported method, and every `HEAD` request return
`405 method_not_allowed`.

| GET path                | Result                                                        | Access                                        |
| ----------------------- | ------------------------------------------------------------- | --------------------------------------------- |
| `/api/health`           | `{ status: "ok" }`, Worker liveness only                      | Public                                        |
| `/api/config`           | Public Auth URL/key and enabled methods, never the server key | Public                                        |
| `/api/me`               | Own `{ id, email, displayName }`                              | Verified identity                             |
| `/api/workspace`        | `{ groups: [{ id, name, role }] }`, current memberships only  | Verified identity                             |
| `/api/groups/:id/setup` | `{ group: { id, name, role } }`                               | Current owner/organizer/co-host in that group |

Failures use `{ error: { code, message } }`: 401 missing/invalid session, 403
unverified identity or denied role, 404 unknown operation, 405 unsupported method,
and 503 configuration/upstream failure. Unknown API paths never get SPA HTML.
Provider errors and keys are not serialized.

Internal tables live in unexposed `app`; only `api` is exposed. Browser roles
have no table or backend-RPC grants. The server-only service principal calls
security-invoker functions with explicit actor/target filters. RLS is enabled as
defense in depth. Role checks read current data rather than cached JWT metadata.

## Co-host management (P-15)

Only the group's current **owner** can read or change co-host assignments.
The bearer identity supplies the actor; caller actor/role fields are refused.

| Method and path | Input / result |
| --- | --- |
| GET `/api/groups/:id/cohosts?after=<profileId>` | `{ cohosts: { group, revision, assigned, candidates, nextCursor } }` |
| POST `/api/groups/:id/cohosts` | `{ operationKey, profileId, action: "add" or "remove", revision }`; `{ operationKey, cohosts }` |
| GET `/api/operations/:key` | Same actor's committed operation with the **current** co-host state; current owner access required |

`group` includes the acting role. Each person is only `{ profileId, name }`,
using the current profile name and its public handle, never contact details or
the account ID. Candidates are distinct account holders who have registered
for a session in this group, including waiting or historical registrations;
guests are not separate accounts. Owners, organizers and existing co-hosts are
excluded from candidates. `assigned` lists current co-hosts, including legacy
ones without registration history. Candidates are ordered by profile handle,
50 per page; pass `nextCursor` as `after` to continue. A null cursor ends the list.
Reload after a change to obtain a coherent new revision and candidate list.

The opaque `revision` string identifies the latest co-host change in this
group (`"0"` initially); submit it unchanged. A grant accepts only a nonmember
or ordinary member who has registered for this group's sessions. Removal
accepts only a current co-host. It restores the ordinary membership recorded
before that grant, or removes the role entirely if there was no membership.
Legacy co-hosts without a recorded grant return to no role; membership is not
inferred. Owners and organizers cannot be changed through these operations.
Registrations, seats, fees, attendance and notification state remain unchanged.

Writes lock the actor/key and then the group, check current owner authority,
and commit the role, append-only actor/target/before/after/time audit and
operation receipt together. The group lock serializes revocation with existing
manager mutations. The next request checks the role again even when the browser
has a cached page or earlier receipt. Same-key/same-payload replay and recovery
return current state without reapplying an old grant. Different payloads return
409 `idempotency_conflict`; an old revision returns 409 `stale_cohosts`; an
ineligible target/action returns 409 `cohost_not_eligible`. No-ops do not create
another audit record. Missing sign-in is 401, non-owner access is 403
`group_owner_required`, malformed input is 422 `invalid_input`, infrastructure
failure is 503, and unsupported methods are 405. All responses are `no-store`.
Invitations, general membership entry and ownership transfer remain excluded.

An owner can still use this owner-only operation for a removed group: removal
keeps past sessions and their manager permissions, so co-host access to that
retained history must remain revocable. It does not restore the group to lists
or allow new sessions.

Draft-deletion POST replays and operation lookups also recheck current manager
access using the group retained in the deletion receipt. Revocation denies
those responses even though the draft itself is already gone. This guard is
added by `20261024135449_cohost_recovery.sql`; historical migrations are unchanged.

The screen compares a recovered result's current assigned list with the submitted
profile handle/action. If another change reversed it, feedback asks the owner to
review current access rather than announcing the old action as the current state.

## Session operations

The owner accepted creator-as-owner bootstrap and the pre-booking edit boundary
on 2026-10-22. Every mutation requires a UUID `operationKey` in its JSON body.

| Method and path                 | Input / result                                             | Access                                                   |
| ------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------- |
| POST `/api/groups`              | `name, operationKey`; actual owner group                   | Verified creator                                         |
| GET `/api/groups/:id/sessions`  | Current drafts/published sessions                          | Current group manager                                    |
| POST `/api/groups/:id/sessions` | `groupId, intent: draft or publish, details, operationKey` | Current group manager                                    |
| POST `/api/sessions/:id/cancel` | `operationKey`; `{ session, operationKey }` in cancelled state | Current group manager |
| GET `/api/sessions/:id`         | Management projection/version                              | Current group manager                                    |
| POST `/api/sessions/:id`        | Same fields plus expected `version`; draft/publish/update  | Current group manager                                    |
| GET `/api/shared/:slug`         | Shareable details, counts and lifecycle                    | Public                                                   |
| GET `/api/operations/:key`      | Actor-owned reference and current resource state           | Same actor; current group role for management operations |

`SessionForm` in `packages/domain/src/session.ts` defines the fields. Local times use the
named timezone; invalid and ambiguous DST times are rejected. Publication requires
positive integer capacity, end after start, opening before start, cutoff between
opening and start, and exact currency precision. Supported minor units:
SGD/USD/EUR/GBP (2), JPY (0), KWD (3). Integer amounts must fit JS safe precision.
Instructions/location are intentionally shareable. Contact, organizer identity,
private financial/payment and attendance records are excluded. Incomplete drafts
remain private.

An actor-scoped key and normalized payload are serialized transactionally.
Same-key/same-payload replay returns one resource and its current state;
different payloads conflict. Current roles are checked on replay. Interrupted
requests remain unconfirmed until a result lookup or identical retry succeeds.
A missing receipt does not prove that an in-flight request cannot still commit.
The UI keeps the exact submitted request/key in memory and locks changes until
resolution; keep the page open during recovery. No form data is persisted offline.

Updates lock group then session and require the expected version. Every published
detail edit increments the version and writes a durable `app.session_changes`
signal with actor and changed fields. P-06 owns delivery; no notification is
claimed here. There is no unpublish operation.

Registration sets `bookings_started_at` under the same session lock on the first
booking, including waiting parties; withdrawals must not clear it. D-14 now permits
title/activity/instructions, capacity and time/venue edits until the old start.
Capacity cannot fall below confirmed seats; an increase fills the strict queue in
the same save. Fee/currency/payment mode, guest allowance, opening and saved
timezone remain locked. Cutoff may change only with an actual start change;
a new start must still be future. Fresh saves, including no-ops, check server time
after locks; exact receipt replay remains recoverable after start and rechecks roles.

Actual start/end instant or venue changes mark `app.session_changes.material`
and commit one private `app.session_change_signals` row per session/version.
It snapshots old/new changed fields and active party IDs for P-06; the session ID
resolves its slug/link. No delivery worker or reminder scheduling is added.
Authenticated/anonymous database clients cannot read the history or signals.
An own-party projection adds `freeWithdrawalAfterChange`, true only for an active,
affected party before current start. Withdrawal compares original consent with
material history, including parties promoted later. Unpaid fees/split claims are
released as `removed_after_change` with actor/time and distinct history; paid
markers and already-withdrawn late fees stay. New joiners keep normal cutoff rules.
General assignment/invitation UI and membership entry remain outside this increment.

Session errors add 413 oversized body, 415 non-JSON input, 422 invalid fields and
409 idempotency/version/booked-event conflict. Failed validation never partially
publishes. Unlisted links are shareable, not private access control.

## Session cancellation

`POST /api/sessions/:id/cancel` consumes a UUID `operationKey`. Identity and
current owner/organizer/co-host role are required, including on replay/recovery.
It returns `{session, operationKey}` and uses the existing operation lookup.
The transaction locks group then session, sets `cancelled`, increments its version,
removes every due unpaid fee with actor/time/revision history, ends unpaid split
claims and writes one private `app.session_cancellations` row per session. Party
states, paid rows and immutable split allocations remain historical records.
The signal captures the prior draft/published state for visibility and later
notification selection. No outbound delivery or refund is performed.

Same-key replay and fresh-key repeats preserve the single transition. Reusing a
key for another session/action returns `409 idempotency_conflict`. Completed
sessions return `409 session_closed`; new saves to cancelled/completed sessions
also return `session_closed`. Committed earlier operations retain result recovery.
A failed transition rolls back state, fees, signal and receipt together. New joins,
waitlist entries, withdrawals and promotions share the session lock and cannot
bypass cancellation. Financial corrections cannot recreate unpaid debt afterward.

Published cancelled links keep the public projection and a closed registration
window. A cancelled draft still returns `404 not_found` publicly. Cancellations,
rosters, actor data and fee records are never added to the public share response.
All responses remain `no-store`; direct browser roles have no RPC/table grants.

## Payment instructions (P-05b contract)

| Method and path                                                          | Input / result                                                             | Access                                                            |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| GET `/api/sessions/:id/payment-instructions`                             | `{revision, paymentInstructions}`; `revision` is 0 before the first save   | Current group manager                                             |
| POST `/api/sessions/:id/payment-instructions`                            | `operationKey, revision, action: save (with text) / remove_image / remove` | Current group manager                                             |
| POST `/api/sessions/:id/payment-instructions/qr?operationKey=&revision=` | Raw PNG/JPEG/WebP body with its `Content-Type`; same result                | Current group manager                                             |
| GET `/api/registrations/:slug/payment-qr`                                | Image bytes, `no-store`, `nosniff`, `sandbox` CSP                          | Manager, or own confirmed/waitlisted party on a published session |

Instructions are stored in `app.payment_instructions`, apart from the
booked-locked session details, so they can be saved after bookings start
without changing the session version, parties, fees or paid markers. Text is
trimmed and has 1–1000 characters. A session has at most one image: 1 MiB at
most, declared type matching its file signature (SVG and other types are
refused). An image needs saved text so it always has a fallback. Every write
names the revision it read: `409 stale_payment_instructions` instead of an
overwrite. It records actor/time and uses an operation receipt (`GET
/api/operations/:key` recovers it). An image replay is matched by its SHA-256.
Cancelled sessions return `409 session_closed`. Errors: `422 invalid_image`,
`413 image_too_large`, `409 instructions_required`,
`422 invalid_payment_instructions`.

The image lives in the private `payment-qr` Storage bucket (created by the
migration) at `<sessionId>/<random id>`. Browsers never receive the path, a
public URL or a signed URL. Every read rechecks entitlement and streams the
bytes uncached. The API removes replaced, replayed and rejected objects after
the write settles, and sweeps unreferenced objects older than 10 minutes on the
next write.

Entitled readers (organizers/co-hosts, or the actor's own confirmed or
waitlisted party on a published session) get `paymentInstructions: {text,
hasImage, imageRevision}` in `GET /api/registrations/:slug`. Everyone else gets
no such key. That includes link visitors, unrelated accounts, withdrawn parties
and cancelled sessions. The public share response never includes it.

## Registration contract

- GET `/api/registrations/:slug` returns `{ registration }` for the verified actor.
- POST to the same path accepts `{ operationKey, version, seats: 1|2,
guestName: string, consent: true }` and returns `{ registration, operationKey }`.
  The verified server identity supplies the primary; caller actor/role fields
  never supply authority. Display names are display-only snapshots.
- Public session projection adds `state`, `registrationWindow` and `counts`
  (`confirmedSeats`, `waitingParties`); no party identity/fee rows are public.

Registration returns own party/state/seat count/current waiting-party position and
own fee, plus `canManage`, `rosterAllowed`, permitted roster and counts. Waiting
parties have no obligation. Confirmed fixed fees use seat count × integer unit
minor amount, rejecting totals beyond safe integer precision. Manual paid
declarations are distinct from liability and never verify a transfer. Confirmed
participants get display names,
guest labels and seat counts only; managers get the wider state/obligation view.
Other verified nonparticipants/waiting participants get no roster.

Transactions serialize the actor/key, lock group then session, and recheck current
server time. Open is inclusive; start is exclusive for both new joins and waiting
entries. Inactive/draft sessions refuse joins. Same-key payload mismatch conflicts;
different-key retries with an existing active party return that party without
changing its seats or consuming another fee. Replays/result lookups return current
state, including after closure/removal, never restore an earlier confirmation.

### Withdrawal (P-04 contract)

POST `/api/registrations/:slug/withdraw` accepts `{ operationKey, partyId }`.
Only the verified primary can withdraw their own whole party. The target ID
prevents an old request from withdrawing a later registration. There is no
guest-only withdrawal or organizer removal action in this increment.

The operation locks actor/key, group, then session, just like joining. It checks
server time after lock waits: withdrawal is allowed only in published sessions
strictly before start. The current party state determines the result if a
waitlist promotion wins a race. A successful response/result lookup returns
`{ operationKey, registration }` with the actual current record. Same-key replay
and repeat withdrawal do not release seats or promote twice. Replays of an
already successful action remain readable after start; new actions then close.

Seat release, withdrawal signal and strict-order reconciliation commit together.
Email delivery is separate. Before cutoff an unpaid obligation is removed from
the amount due while its original allocation remains auditable; at/after cutoff
it remains. Paid declarations remain manual records and withdrawal never claims
an external refund. The owner accepted independent fixed fees on 2026-10-22:
a promoted replacement
owes its own published allocation; filling the vacancy never automatically
waives the departing party's retained obligation.

The queue has a monotonic party sequence. Allocation never splits a party or
bypasses the first waiting party. `app.fill_waitlist` acquires the same locks and
confirms whole heads before start, creating each obligation and durable
`app.registration_events` signal once. Withdrawal reconciles within its
seat-release transaction. Guest edits remain out of scope. Signals are not sent emails. P-06 owns actual delivery.

The accepted D-03 start deadline is recorded in the PRD. Errors include 422 missing
consent/disabled guest/impossible party and 409 stale terms/not-open/closed/key
conflict. Raw application tables and all backend RPCs remain denied to browser
roles. No raw mutation passthrough, client authority or offline registration exists.

Google OAuth uses Supabase PKCE and a same-origin callback; live client/audience/
redirect configuration is still required. Local email-code sign-in exercises
managed sessions only: request and Auth URLs must both be loopback and the local
flag must be enabled. It does not establish live Google integration. No Resend
delivery, offline writes or hosted deployment is implemented here.

P-04 extends each private fee projection with `liabilityState` (`due` or
`removed_before_cutoff`), `removedAt` and `markedPaid`. The original exact
`totalMinor` remains unchanged. `app.release_withdrawal_fee` records the removal
actor/time only when the authoritative withdrawal instant is strictly before
cutoff and the allocation is not marked paid. Tests pass explicit instants to
this internal financial transition for the exact-cutoff case; public calls
always supply server time after the session lock. Browser roles cannot call it.

For the P-05 handoff, `app.fee_obligations` also holds a separate manual paid flag
and marker actor/time. P-04 cannot write those marker columns; synthetic fixtures
verify their preservation. P-05 owns protected paid/unpaid correction and explicit
waiver operations, their history/conflict handling and UI. No waiver or payment
mutation endpoint is supplied here. Withdrawal records `parties.withdrawn_at` and
one durable `registration_events(kind='withdrawn')`; promotion keeps its existing
unique signal. No email provider participates in either transaction.

### Payment markers and waivers (P-05a contract)

POST `/api/registrations/:slug/payments` accepts
`{ operationKey, partyId, action, revision }`, where `action` is `mark_paid`,
`mark_unpaid`, `waive` or `undo_waiver`. Only a current owner/organizer/co-host of
the session's group may call it (`403 group_access_denied` otherwise, checked under
the group lock on every call and replay). It returns `{ registration, operationKey }`
with the manager roster.

`liabilityState` gains `waived`. Allowed transitions: unpaid `due` → paid or
`waived`; paid → unpaid; `waived` → `due`. A paid, waived or removed fee refuses the
other actions with `409 payment_transition_invalid`. `revision` must equal the fee's
current revision or the call fails with `409 stale_payment`; every recorded change
increments it, including a before-cutoff withdrawal removal. Each change writes one
`app.fee_changes` row with the action, actor, actor display name and time. Manager
roster fees include `revision` and `history` (newest first); participant fees never
do. Seats, party state and the queue are not read or written.

GET `/api/dues` returns `{ dues }`: the verified actor's own fee obligations across
sessions (at most 200), unpaid first, each with its session's slug, title, start,
time zone and state. It never contains another party's data.

### Split cost claims

Session details optionally select `feeMode: "split"`; `fee` is the entered total,
normalized to `totalMinor` instead of a fixed `feeMinor`. Omitted mode retains
the legacy fixed contract and payload. Booked material edits remain locked.
Confirmation or promotion creates a pending claim, with no payable fee. Shared
session/registration projections add aggregate `split` estimates; own party
reads add `splitClaim` (`eligible`, `waived`, `estimateMinor`), while managers
also receive its write `revision`. No other participant's claim/history is exposed.

Pending claims use the existing payment route for `waive`/`undo_waiver`, against
the claim revision. Paid/unpaid actions refuse with `409 split_not_finalized`.
Before-cutoff withdrawal permanently removes eligibility, even if waived;
undo never revives that eligibility. Late withdrawal retains its seats in the
split unless explicitly waived; replacing or rejoining creates another claim.
Waiting parties have no claim. Queue, attendance and fixed-fee contracts remain
independent.

GET `/api/splits/:slug` and POST `/api/splits/:slug/preview` are current-manager
operations. The preview accepts `{intent:"finalize"}` and returns exact seat and
party allocations with an opaque `basis` concurrency token. POST
`/api/splits/:slug/finalize` accepts `{operationKey,basis}`. Apply checks current
roles, the trusted financial basis and server time after lock waits; it is allowed
at or after start for published/completed sessions. A stale preview, cancelled
session, early request or second finalization is refused atomically.

Finalization persists an immutable run and per-seat allocations, creates exact
party fees, and returns `{operationKey,committedRunId,registration,split}`. Receipt
recovery preserves the committed run identity even if current projections later
change. Guest party totals sum their exact seat allocations; split `unitMinor`
is null and `totalMinor` is explicit. Zero shares cannot be marked paid. Empty
paying headcounts record unallocated cost and no participant bill. Financial
snapshots are independent of check-in/no-show status.

GET `/api/dues` retains `dues` and adds own `splitClaims`: claim-only records with
their session, aggregate split and own pending/waived/removed state. They have no
fee and never duplicate a party already in `dues`; both lists are bounded to 200.
After finalization, estimates become null and aggregate headcount is the frozen
run basis. Only managers receive full split/history/actor data; participants
receive their own amounts and safe generated `own.splitHistory` entries
(`previousMinor`, `currentMinor`, `at`, `kind`). These exclude manager reasons,
actor identifiers and other parties’ details.

POST `/api/splits/:slug/preview` also accepts
`{intent:"correct",totalMinor,undoWaiverPartyId?}`. It returns exact proposed
amounts, prior amounts, paid states and `blockedPaidPartyIds`. POST
`/api/splits/:slug/correct` accepts
`{operationKey,basis,totalMinor,reason,undoWaiverPartyId?}` with a nonempty reason
of at most 300 characters. A correction can keep or lower the current effective
total; it cannot change currency, invent eligibility or change a paid amount.
A stale financial basis returns `409 stale_split`; affected paid allocations
return `409 split_paid_allocation`; increases return `409 split_total_increase`.
Each successful correction creates an immutable run, exact seat allocations,
changed fee revisions and attributable before/after history. Unchanged paid fees
keep their amount, marker and earlier payment basis. No money is moved.

A finalized waiver changes liability and the matching claim, leaving everyone
else’s amount fixed. Uncovered cost uses only current-run allocations. Ordinary
undo restores an amount only if that party still belongs to the current run.
Otherwise `409 split_undo_requires_review` requires a correction naming the
originally eligible waived claim. This includes pre-finalization waivers and
waivers excluded by a later redistribution. Early-withdrawn and waiting parties
cannot be introduced. Reviewed undo and repricing commit together; payment and
attendance history remain separate. Manager history includes reasons and all
previous/current allocation changes, including excluded parties.

### Attendance (P-07 contract)

POST `/api/registrations/:slug/attendance` accepts
`{ operationKey, partyId, seat, state, revision }`: `seat` 1 is the primary and 2
the guest; `state` is `unrecorded`, `checked_in` or `no_show`. Only a current
owner/organizer/co-host may call it (`403 group_access_denied`). It returns
`{ registration, operationKey }` with the manager roster.

Only confirmed parties in published or completed sessions are eligible
(`409 attendance_not_eligible`); a seat beyond the party's size is
`409 seat_not_found`. `no_show` is refused before the session's `endsAt` by server
time (`409 no_show_too_early`). Writing the current state is
`409 attendance_unchanged`. `revision` is 0 for a never-recorded seat and must match
the current revision (`409 stale_attendance`). Each change writes
`app.seat_attendance` and one `app.attendance_changes` row with actor, display name
and time. Manager roster parties carry `attendance` (one entry per confirmed seat
with `seat`, `state`, `revision`, `by`, `at`); participant views never do. Seats,
fees and payment markers are not read or written.
