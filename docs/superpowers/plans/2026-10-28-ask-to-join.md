# Ask to join (P-34) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers choose Join directly or Ask to join per session. People ask, and organizers/co-hosts accept or decline, without breaking the strict queue and with no email.

**Architecture:** A new `app.join_requests` table and six `api.*` SQL functions, all behind the session row lock that join already takes. Join and accept share one extracted admission function. Accept writes `registration_events` rows marked `silent`, so the email trigger skips them. `app.registration_view` gains `joinRequest` for the viewer and `requests` for managers, through the existing wrap-and-rename pattern. Hono routes call the functions, and the web app renders three new states.

**Tech Stack:** Postgres plpgsql (Supabase migrations), Hono API (`apps/api`), Next.js/React (`apps/web`), shared types (`packages/domain`), `node --test` integration tests via `pnpm test:api`.

**Spec:** `docs/superpowers/specs/2026-10-28-ask-to-join-design.md`

## Global Constraints

- **No email.** No new email kind. Request actions never enqueue email. Accept must not trigger `joined_confirmed` or `joined_waitlisted`.
- `joinMode` values are exactly `"direct" | "request"`. A missing value means `"direct"`. Changing it is not a material change and is allowed on booked sessions.
- Limits: one pending request per (session, person). Max **2** own cancels per (session, person). Max **10** pending requests per person across sessions that haven't started. A declined request is final for that session.
- Asking uses join's window: `opensAt ≤ now < startsAt`, and the session must be `published`. Accept and decline are refused at or after start. Expired = pending with `now ≥ startsAt` (derived, never stored).
- Organizers/co-hosts of the session join directly even in request mode.
- A material change (`app.session_changes.material` with version > request `consent_version`) blocks Accept until the requester taps Keep my request.
- Copy (exact):
  - Field "Who can join": options "Join directly" ("Anyone with the link can take a spot.") and "Ask to join" ("You accept or decline each person.").
  - Under the button: "The organizer accepts or declines each request."
  - Full session: "It's full. If the organizer accepts, you'll join the waitlist."
  - Pending: "Request sent. The organizer will accept or decline it."
  - Needs confirming: "The details changed since you asked."
  - Declined: "The organizer didn't accept your request for this session."
  - Expired: "This session has started."
  - Cancelled session: "This session was cancelled".
  - Signed-out button: "Sign in to ask to join".
  - Error, too many cancels: "You've cancelled two requests for this session, so you can't ask again."
  - Error, too many pending: "You have 10 requests waiting. Cancel one or wait for an answer."
  - Organizer side: "Waiting for them to confirm the new details", "Fits now", "Would join the waitlist at #N", "Decline the rest".
- Organizer card shows: name, title, activity level, played, hosted, "Played in this group's sessions: N", "+1: {guest name or 'Guest'}", and asked-at. It never shows email, no-shows, payments or waitlist history.
- D-13 copy rule: no internal terms (mode, state, version, pending) in the interface.

## Review Focus

1. **Accept racing the last seat or a direct join.** Exactly one party gets the seat, and the other lands on the waitlist (Task 2 test `accept races last seat`).
2. **A retry of accept after a timeout.** The same key returns the same result, with no second party (Task 2 test `accept is idempotent`).
3. **Switching request → direct with pending requests.** Pending requests stay pending and are still acceptable; new visitors join directly (Task 2 test `switching mode keeps pending`).
4. **A requester who is already booked** (they joined while the session was direct). Accept links the existing party and creates none (Task 2 test `accept links existing party`).
5. **A cancelled session with pending requests.** Accept and decline are refused, and the requester sees "This session was cancelled" (Task 3 test `cancelled session request view`).

---

### Task 1: Domain types and form field

**Files:**
- Modify: `packages/domain/src/session.ts` (SessionForm, blankSession, the raw-form parser near line 220)
- Modify: `packages/domain/src/registration.ts` (RegistrationView)
- Modify: `packages/domain/src/my-sessions.ts` (MySessionStatus, MySessionRow, statusLabel)
- Modify: `packages/domain/src/run-again.ts` (carry joinMode)
- Test: `tests/join-requests-domain.test.mjs`

**Interfaces — Produces:**
- `export type JoinMode = "direct" | "request"`, plus `SessionForm.joinMode?: JoinMode`. `blankSession()` sets `"direct"`. The parser rejects other values with `InputError("Choose who can join.")` and defaults a missing value to `"direct"`.
- `export interface OwnJoinRequest { id: string; state: "pending" | "declined" | "cancelled" | "expired" | "session_cancelled"; seats: 1 | 2; guestName: string; needsConfirm: boolean; askedAt: string; cancelsLeft: number }`
- `export interface ManagedJoinRequest { id: string; profileId: string | null; name: string; title: RosterTitle | null; level: SkillLevel | null; played: number; hosted: number; playedInGroup: number; seats: 1 | 2; guestName: string; askedAt: string; needsConfirm: boolean; fitsNow: boolean; waitlistPosition: number | null }`
- `RegistrationView` gains `joinRequest?: OwnJoinRequest | null` and `requests?: ManagedJoinRequest[]` (managers only; pending, non-expired).
- `MySessionStatus` adds `"requested"`, and `MySessionRow` adds `requestCount?: number`. `statusLabel` for `requested` returns "Request sent".

- [ ] **Step 1: Write failing tests** in `tests/join-requests-domain.test.mjs`, in the style of `tests/my-sessions-domain.test.mjs`:
  - `parses joinMode`: the parser yields `joinMode: "request"` for `"request"`, `"direct"` when missing, and throws `"Choose who can join."` for `"open"`.
  - `blank session is direct`: `blankSession().joinMode === "direct"`.
  - `requested label`: `statusLabel({status:"requested",waitPosition:null}, false) === "Request sent"`.
  - `run again keeps joinMode`.
- [ ] **Step 2:** Run `node --test tests/join-requests-domain.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement the interfaces above.
- [ ] **Step 4:** Run the test (PASS), then `pnpm check` (PASS).
- [ ] **Step 5:** Commit `feat(domain): join mode and join request types (P-34)`.

### Task 2: Database — requests, shared admission, silent events, API routes

**Files:**
- Create: `supabase/migrations/20261028090000_join_requests.sql`
- Modify: `packages/database/src/functions.ts` (register the new functions)
- Modify: `apps/api/src/registrations.ts` (routes and error copy)
- Test: `tests/join-requests.test.mjs` (copy the harness top of `tests/withdrawals.test.mjs`: `sql`, `row`, `login`, `request`, `details`)

**Interfaces — Consumes:** latest `api.join_session` (`20261022090743_split_cost_claims.sql`), latest `app.assert_booked_edit` (`20261024150000_session_maps_link.sql`) and `app.queue_registration_email` (`20261023140000_email_outbox.sql`).

**Interfaces — Produces:**
- Table `app.join_requests(id uuid pk, session_id, user_id, primary_name text, guest_name text, seats smallint 1|2, consent_version int, consent_at, state text check in ('pending','accepted','declined','cancelled'), asked_at, decided_at, decided_by uuid, decided_by_name text, party_id uuid null)`. Partial unique index on `(session_id,user_id) where state='pending'`. Index on `(user_id) where state='pending'`. RLS on, revoked like `app.parties`.
- `alter table app.registration_events add column silent boolean not null default false`. `app.queue_registration_email` returns early when `new.silent`.
- Session check constraint: `details->>'joinMode'` is absent or in `('direct','request')`. `app.assert_booked_edit` is redefined from its latest body, with `'joinMode'` added to the allowed key list.
- `app.admit_party(p_session app.sessions, p_user uuid, p_primary_name text, p_guest_name text, p_seats int, p_consent_version int, p_silent boolean) returns app.parties`. This is the extracted body of `join_session` from `perform app.fill_waitlist` through the event insert. The caller holds the session lock and has checked window, version, guests and size.
- `api.join_session` (same signature) raises `P0001 'request_required'` when `joinMode='request'` and the actor is not a manager of the session's group. Managers are identified by the helper `app.require_manager` already uses. It then calls `app.admit_party(..., false)`.
- Each function below takes `p_actor_id, p_key, p_slug` and stores an `operation_receipts` row like join does. Each returns `{registration: app.registration_view(...), operationKey}`. Errors are `P0001` messages:
  - `api.ask_to_join(+p_version int, p_seats int, p_guest_name text, p_primary_name text, p_consent boolean)`. Errors: `request_not_needed` (direct mode), `registration_closed`, `registration_not_open`, `stale_terms`, `guest_disabled`, `party_too_large`, `request_declined`, `request_cancel_limit`, `request_limit`. If already booked, it returns the view without creating a request. If a pending request exists, it returns it.
  - `api.cancel_join_request(+p_request_id uuid)`: own pending request only. Error `request_not_pending`.
  - `api.keep_join_request(+p_request_id uuid, p_version int)`: sets `consent_version` and `consent_at` and keeps `asked_at`. Errors `stale_terms`, `request_not_pending`.
  - `api.accept_join_request(+p_actor_name text, p_request_id uuid)`: managers only (`42501`). Errors `request_not_pending`, `request_needs_confirm`, `registration_closed` (at/after start or session not published). It calls `app.admit_party(..., true)`, or links an existing confirmed/waitlisted party.
  - `api.decline_join_request(+p_actor_name text, p_request_id uuid)`: managers only. Errors `request_not_pending`, `registration_closed`.
  - `api.decline_pending_requests(+p_actor_name text)`: managers only. Declines every pending, non-expired request and returns `{declined: n, registration, operationKey}`.
- Routes under `/registrations/:slug`: `POST /requests` (ask), `POST /requests/cancel`, `POST /requests/keep`, `POST /requests/accept`, `POST /requests/decline`, `POST /requests/decline-rest`. Each has an `.all(...)` → `notAvailable(action)`, as existing routes do. Zod bodies mirror `join` and `withdraw`, with `requestId: key` where needed. Each new error code is added to `conflicts`, with the Global Constraints copy for the two limits and plain copy for the others.

- [ ] **Step 1: Write failing integration tests** in `tests/join-requests.test.mjs` (synthetic users `organizer@`, `member@`, `outsider@`, `newcomer@`; sessions created through the API as in `withdrawals.test.mjs`, with `joinMode:"request"`):
  - `direct join refused in request mode`: member POST `/api/registrations/{slug}` → 409 `request_required`; organizer → 200.
  - `ask holds no seat`: after member asks, the shared session's `counts` are unchanged, `registration.joinRequest.state==="pending"`, and a repeat ask with a new key returns the same `joinRequest.id`.
  - `accept places party and sends no email`: organizer accepts → member `own.state==="confirmed"`. `select count(*) from app.email_jobs where party_id=...` (use the outbox table name from `20261023140000_email_outbox.sql`) is `0`.
  - `accept when full waitlists at back`: capacity 1, outsider joins directly first → accepting member gives `own.state==="waitlisted"`, `queuePosition===1`.
  - `accept races last seat`: capacity 1, two pending requests (member, newcomer). `Promise.all` of the organizer accepting member and a co-host (fixture from `helpers/cohost-fixtures.mjs`) accepting newcomer → exactly one `confirmed`, one `waitlisted`, and confirmed seats `=== 1`.
  - `accept is idempotent`: the same key twice → same party id; `select count(*) from app.parties where session_id=... and user_id=member` is `1`.
  - `two managers accept same request`: `Promise.all` with different keys → one 200, the other 409 `request_not_pending`; parties count `1`.
  - `accept links existing party`: session starts direct, member joins, organizer switches to request mode, a stale pending request inserted by SQL is accepted → no new party, and the request's `party_id` equals the existing party.
  - `switching mode keeps pending`: ask, switch to direct via update → request still pending and acceptable; newcomer joins directly → 200.
  - `role denial`: member, outsider and signed-out each POST accept/decline/decline-rest → 403/403/401.
  - `decline is final`: decline → member asks again → 409 `request_declined`.
  - `cancel limit`: ask → cancel → ask → cancel → ask → 409 `request_cancel_limit`.
  - `pending limit`: insert 10 pending rows for newcomer by SQL on 10 future sessions, then ask → 409 `request_limit`.
  - `material change needs keep`: ask, then organizer changes location → accept 409 `request_needs_confirm`; member keep with the new version → accept 200.
  - `start boundary`: set `startsAt` in the past by SQL → ask 409 `registration_closed`, accept 409 `registration_closed`.
  - `decline the rest`: three pending → `decline-rest` returns `declined===3`; a request accepted first is untouched.
  - `booked edit allows joinMode`: a session with a confirmed party switches `joinMode` → 200, with no `session_changes.material` row.
- [ ] **Step 2:** Run `pnpm db:start && pnpm dev` (background), then `node --test tests/join-requests.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Write the migration and register the functions in `functions.ts`. Use `{ ...write, ... }` for actor-named calls and `{ ...slug, p_key:"uuid", ... }` otherwise, with types `p_request_id:"uuid"`, `p_version:"integer"`, `p_seats:"integer"`, `p_guest_name:"text"`, `p_primary_name:"text"`, `p_consent:"boolean"`. Add the routes. Re-run `pnpm db:start` to apply.
- [ ] **Step 4:** Run `node --test tests/join-requests.test.mjs tests/registrations.test.mjs tests/withdrawals.test.mjs tests/email-outbox.test.mjs tests/booked-edits.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: ask to join requests with shared admission and no email (P-34)`.

### Task 3: Read views — own request, manager queue, Sessions tab

**Files:**
- Create: `supabase/migrations/20261028091000_join_request_views.sql`
- Test: `tests/join-requests.test.mjs` (add cases)

**Interfaces — Consumes:** Task 1 types (JSON keys must match exactly), and Task 2 tables. Stats come from the same expressions `api.read_profile` uses (latest `20261025100000_level_titles.sql`). Title comes from `app.visible_title`.

**Interfaces — Produces:**
- `app.registration_view` is wrapped (rename the current one to `registration_view_before_requests`):
  - `joinRequest`: the viewer's latest request for the session, or null. State is mapped as `expired` when pending and now ≥ start, `session_cancelled` when pending and the session is cancelled, and otherwise as stored (`accepted` maps to null, since the booking shows instead). `needsConfirm` follows the material-change rule. `cancelsLeft = greatest(0, 2 - own cancelled count)`.
  - For managers, `requests`: pending, not expired, not session-cancelled, ordered by `asked_at`. `fitsNow` = no waitlisted parties and confirmed seats + seats ≤ capacity. `waitlistPosition` = count of waitlisted parties + 1 when not fitting, else null. `level` = the profile activity level whose activity key matches the session's activity key (`app.activity_key_for`), else null. `playedInGroup` = count of distinct completed sessions in `s.group_id` where the person's party has `seat_attendance` seat 1 `checked_in`.
- `api.list_my_sessions` is redefined from the latest (`20261024110000_group_edit.sql`). It adds rows with `status:"requested"` for the viewer's pending, non-expired requests on published sessions where they have no booking, and `requestCount` on `organizing` rows.

- [ ] **Step 1: Write failing tests** (append):
  - `request view for requester`: after ask, `joinRequest` is `{state:"pending", seats:1, needsConfirm:false, cancelsLeft:2}`.
  - `manager sees request card`: organizer's view `requests[0]` has `name`, `played`, `hosted`, `playedInGroup`, `fitsNow:true`, `waitlistPosition:null`, and **no** keys `email`, `noShows` or `fee`.
  - `full session card`: capacity 1 filled → `fitsNow:false`, `waitlistPosition:1`.
  - `member sees no requests`: the member's view has no `requests` key.
  - `cancelled session request view`: cancel the session → requester `joinRequest.state==="session_cancelled"`; accept → 409.
  - `expired view`: startsAt moved into the past by SQL → requester `state==="expired"`; organizer `requests` is empty.
  - `sessions tab`: requester's `/api/me/sessions` (use the existing route name from `apps/api/src/sessions.ts`) has a row `status:"requested"`; the organizer's row has `requestCount:1`.
- [ ] **Step 2:** Run the tests. Expected: FAIL.
- [ ] **Step 3:** Write the migration and apply it with `pnpm db:start`.
- [ ] **Step 4:** Run `node --test tests/join-requests.test.mjs tests/my-sessions.test.mjs tests/registrations.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: request views for requesters, organizers and the Sessions tab (P-34)`.

### Task 4: Session form — "Who can join"

**Files:**
- Modify: `apps/web/src/session-pages.tsx` (`Editor`, next to the guests control ~line 752)
- Test: `tests/pages.test.mjs` (add a case if it renders the editor; otherwise rely on browser check)

**Interfaces — Consumes:** `JoinMode` and `SessionForm.joinMode` (Task 1).

- [ ] **Step 1:** Add a two-option radio group labelled "Who can join", using the existing segmented/radio component the editor uses for payment mode, with the exact option labels and hints from Global Constraints. It's bound to `form.joinMode ?? "direct"`. It's shown on create, edit and booked edit.
- [ ] **Step 2:** Run `pnpm check`. Expected: PASS.
- [ ] **Step 3:** Commit `feat(web): choose who can join a session (P-34)`.

### Task 5: Requester panel

**Files:**
- Modify: `apps/web/src/registration-panel.tsx` (join form ~lines 227–300 and 668–690)
- Modify: `apps/web/src/session-pages.tsx` (the signed-out action label)

**Interfaces — Consumes:** `RegistrationView.joinRequest`, `OwnJoinRequest`, and the Task 2 routes.

- [ ] **Step 1:** When `event.details.joinMode === "request"`, `!view.canManage` and `!view.own` active, render by `joinRequest?.state`:
  - **null / cancelled:** the existing join fieldset with the button "Ask to join" (POST `/requests`) and the hint line. When `counts` shows the session full, add the full-session line.
  - **pending:** the pending line, the party summary, and a "Cancel request" button with a confirm dialog (POST `/requests/cancel`). When `needsConfirm`, add the changed line and a "Keep my request" button (POST `/requests/keep` with `event.version`).
  - **declined / expired / session_cancelled:** the matching line only.
  Reuse `useMutation`, operation keys and the ambiguous-result recheck exactly as join does. Map `request_cancel_limit` and `request_limit` to their server messages.
- [ ] **Step 2:** On the shared page, signed-out visitors to a request-mode session see the sign-in action labelled "Sign in to ask to join".
- [ ] **Step 3:** Run `pnpm check`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(web): ask to join, cancel and keep a request (P-34)`.

### Task 6: Organizer requests section and Sessions tab

**Files:**
- Create: `apps/web/src/join-requests.tsx` (`export function JoinRequests({ slug, requests, onChanged }: { slug: string; requests: ManagedJoinRequest[]; onChanged: (view: RegistrationView) => void })`)
- Modify: `apps/web/src/registration-panel.tsx` (render `JoinRequests` above the roster when `view.canManage && view.requests?.length`), `apps/web/src/game-day.tsx` (same placement on game day), and the Sessions tab row component (find the `statusLabel` caller) to show "N requests".

**Interfaces — Consumes:** `ManagedJoinRequest` and the Task 2 accept/decline/decline-rest routes. `PersonLink`-style name link to `/people/{profileId}` (see `apps/web/src/badges.tsx:251`).

- [ ] **Step 1:** Build `JoinRequests`:
  - A heading "Requests (N)" and one card per request with the Global Constraints fields.
  - "+1: …" only when `seats===2`.
  - Asked-at as relative time, using the existing date helper in `apps/web/src/dates.ts`.
  - A placement line: "Fits now" or "Would join the waitlist at #N".
  - Accept and Decline buttons (Decline confirms). When `needsConfirm`, the card shows the waiting line and no Accept.
  - "Decline the rest" when there are ≥ 2 requests, with a confirm that names the count.
  - After an action, move focus to the next card or the heading, and announce the result ("{name} is in" / "{name} is #N on the waitlist" / "Declined") through the existing live-region pattern in `use-mutation.tsx`.
- [ ] **Step 2:** On the Sessions tab, `requested` rows use the label from Task 1, and organizing rows with `requestCount > 0` show "N requests" as text.
- [ ] **Step 3:** Run `pnpm check`. Expected: PASS.
- [ ] **Step 4:** Commit `feat(web): organizers accept or decline join requests (P-34)`.

### Task 7: PRD, full checks, browser verification

**Files:**
- Modify: `PRD.md`:
  - **D-19 row:** replace "One email on accept or decline under D-05" with no email, and add the spam limits, the request-card contents and the "full sessions can still ask" rule. Cite the owner, 2026-10-28.
  - **D-13:** add a note that Public/Private is planned as a future asked field (piece 3), not built here.

- [ ] **Step 1:** Edit the PRD as above.
- [ ] **Step 2:** Run `pnpm check && pnpm db:lint && pnpm test:api`. Expected: all PASS. Record any pre-existing failures with their output.
- [ ] **Step 3:** Browser at 375px and desktop, light and dark, using the synthetic accounts:
  - organizer creates an Ask to join session
  - member asks; the counts stay unchanged
  - organizer accepts; member is in
  - fill the session, outsider asks, accept → waitlist
  - decline; it's final
  - signed-out view
  - member sees no requests
  - keyboard-only accept and decline
- [ ] **Step 4:** Commit `docs: record Ask to join decisions (P-34)`.
