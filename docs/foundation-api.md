# Foundation API

The browser authenticates with Supabase Auth. The Worker verifies the access
token with `getUser`, requires a verified managed email, and derives the actor
from that response. Editable metadata is display-only. All responses use
`Cache-Control: no-store`.

| GET path | Result | Access |
| --- | --- | --- |
| `/api/health` | `{ status: "ok" }`, Worker liveness only | Public |
| `/api/config` | Public Auth URL/key and enabled methods, never the server key | Public |
| `/api/me` | Own `{ id, email, displayName }` | Verified identity |
| `/api/workspace` | `{ groups: [{ id, name, role }] }`, current memberships only | Verified identity |
| `/api/groups/:id/setup` | `{ group: { id, name, role } }` | Current owner/organizer/co-host in that group |

Failures use `{ error: { code, message } }`: 401 missing/invalid session, 403
unverified identity or denied role, 404 unknown operation, 405 unsupported method,
and 503 configuration/upstream failure. Unknown API paths never get SPA HTML.
Provider errors and keys are not serialized.

Internal tables live in unexposed `app`; only `api` is exposed. Browser roles
have no table or backend-RPC grants. The server-only service principal calls
security-invoker functions with explicit actor/target filters. RLS is enabled as
defense in depth. Role checks read current data rather than cached JWT metadata.

## Session operations

The owner accepted creator-as-owner bootstrap and the pre-booking edit boundary
on 2026-10-22. Every mutation requires a UUID `operationKey` in its JSON body.

| Method and path | Input / result | Access |
| --- | --- | --- |
| POST `/api/groups` | `name, operationKey`; actual owner group | Verified creator |
| GET `/api/groups/:id/sessions` | Current drafts/published sessions | Current group manager |
| POST `/api/groups/:id/sessions` | `groupId, intent: draft or publish, details, operationKey` | Current group manager |
| GET `/api/sessions/:id` | Management projection/version | Current group manager |
| POST `/api/sessions/:id` | Same fields plus expected `version`; draft/publish/update | Current group manager |
| GET `/api/shared/:slug` | Shareable details, counts and lifecycle | Public |
| GET `/api/operations/:key` | Actor-owned reference and current resource state | Same actor; current group role for management operations |

`SessionForm` in `src/shared/session.ts` defines the fields. Local times use the
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
booking, including waiting parties. Once set, all
detail changes are refused until the booked-event policy is accepted; withdrawals
must not clear it. General assignment/
invitation UI and membership entry remain outside this increment.

Session errors add 413 oversized body, 415 non-JSON input, 422 invalid fields and
409 idempotency/version/booked-event conflict. Failed validation never partially
publishes. Unlisted links are shareable, not private access control.

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
minor amount, rejecting totals beyond safe integer precision. There is no payment
status or claim of a verified transfer. Confirmed participants get display names,
guest labels and seat counts only; managers get the wider state/obligation view.
Other verified nonparticipants/waiting participants get no roster.

Transactions serialize the actor/key, lock group then session, and recheck current
server time. Open is inclusive; start is exclusive for both new joins and waiting
entries. Inactive/draft sessions refuse joins. Same-key payload mismatch conflicts;
different-key retries with an existing active party return that party without
changing its seats or consuming another fee. Replays/result lookups return current
state, including after closure/removal, never restore an earlier confirmation.

The queue has a monotonic party sequence. Allocation never splits a party or
bypasses the first waiting party. `app.fill_waitlist` acquires the same locks and
confirms whole heads before start, creating each obligation and durable
`app.registration_events` signal once. P-04 must reconcile in its seat-release
transaction; no public withdrawal or guest-edit operation is introduced here.
Signals are not sent emails. P-06 owns actual delivery.

The accepted D-03 start deadline is recorded in the PRD. Errors include 422 missing
consent/disabled guest/impossible party and 409 stale terms/not-open/closed/key
conflict. Raw application tables and all backend RPCs remain denied to browser
roles. No raw mutation passthrough, client authority or offline registration exists.

Google OAuth uses Supabase PKCE and a same-origin callback; live client/audience/
redirect configuration is still required. Local email-code sign-in exercises
managed sessions only: request and Auth URLs must both be loopback and the local
flag must be enabled. It does not establish live Google integration. No Resend
delivery, offline writes or hosted deployment is implemented here.
