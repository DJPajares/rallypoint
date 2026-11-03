# Ranked Booking and Match Session Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After everyone accepts a ranked match, one player claims and books the court. RallyPoint then creates the private, split-fee session they play in. Players check themselves in, and withdrawing either side of the cutoff is handled as the spec says ([WDL-424](https://linear.app/wwonderland/issue/WDL-424/ranked-booking-and-the-match-session)).

**Architecture:**
- **Claim:** "I'll book" is an atomic claim on `app.ranked_matches`. It holds for 48 hours and can be handed back.
- **Booking:** the booker enters court, time and total court cost. The API builds an ordinary session form with a pure domain function, checks it with the existing `normalizeSession`, and calls `api.book_match`. That function creates the session through the existing `api.save_new_session`, gives the matched players access, and registers each of them through `api.join_session`. All of it happens in one transaction, keyed for retries.
- **Check-in:** players check themselves in through a ranked function that writes the existing attendance records.
- **Withdrawal:** a wrapper on `api.withdraw_party` applies the ranked rules after the normal D-04 withdrawal.
- **Guards:** organizer attendance, removal and cancellation are blocked while the match is live.

**Tech Stack:** Supabase Postgres (plpgsql), Hono API, `@rallypoint/domain` (Temporal), Next.js client page, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-ranked-matchmaking-design.md` ("Booking", "Results" for self check-in and no-shows, "Calls made after the builder check").

## Global Constraints

- **Claim:** first tap wins, atomically. Everyone else sees "{name} is booking the court".
- **Booker's time:** 48 hours to enter court and time, or tap "I can't book". On hand-back or expiry, the button returns for everyone.
- **Unbooked:** a match not booked within 4 days of everyone accepting is cancelled with no penalty and everyone searches again (the WDL-422 sweep, now skipping booked matches).
- **Session:** private, for exactly the 2 or 4 players. The booker is organizer. Pay the organizer, with an equal split of the court cost. Cutoff 24 hours before start. D-04 fee rules apply.
- **Self check-in:** each player only, from 30 minutes before to 30 minutes after the start. Nobody checks in someone else.
- **Withdrawal before the cutoff:** the ranked match is cancelled with no penalty and the session stays as an ordinary unranked one. The leaver's side search ends (a doubles team searches together), and the other side searches again with its place kept.
- **Withdrawal after the cutoff:** recorded for Results as a no-show. No rating change happens here.
- Only the matched players can see the claim and the session.
- Synthetic data only. No emails.

## Builder's calls

- Pickleball's minimum session capacity drops from 4 to 2 (both plans), so a singles match fits in a 2-spot session. A normal pickleball session can then have 2 or 3 spots.
- **Session details:**
  - title "Ranked Singles" or "Ranked Doubles"; activity "Pickleball"
  - instructions "Ranked match. Check yourself in on the Ranked page from 30 minutes before the start."
  - capacity = player count, guests off, currency SGD
  - registration opens at once
  - cutoff = the later of now and start − 24 h (a same-day booking has its cutoff now)
  - time zone from the device, like the session form
- Players are registered for the session by the booking. Accepting the match counts as agreeing to play, and the cost is shown on the match card.
- Matched players get access rows directly, because they are strangers, not "known people".
- **While the match is live:** organizer attendance, party removal and session cancellation are refused (`ranked_match_session`). After a withdrawal before the cutoff turns it unranked, they work as normal. Editing the session stays allowed.
- `ranked_matches.end_reason` gains `withdrawn`, and `ended_by` records who withdrew. `ranked_match_players.no_show_at` records a withdrawal after the cutoff.

## Review Focus

1. A retried booking, with the same key, must return the same single session and never register anyone twice. *(Task 1 test.)*
2. A claim that lapsed must not let the old booker book. *(Task 1 test: `book_match` after `claim_until` → `not_booker`.)*
3. A withdrawal replayed by key must not apply the ranked rules twice. *(Task 2 test.)*
4. Check-in exactly at the window edges (start − 30 min passes; start + 30 min + 1 s is refused). *(Task 2 test, by moving the session's start.)*
5. A cancelled (unranked) match session must behave like any session again: organizer attendance works. *(Task 2 test.)*

---

### Task 1: Claim, hand back and book

**Files:**
- Create: `supabase/migrations/20261103130000_ranked_booking.sql`
- Create: `packages/domain/src/ranked-booking.ts` (export `./ranked-booking` in `packages/domain/package.json`)
- Modify: `packages/database/src/functions.ts`, `apps/api/src/ranked.ts`
- Test: `tests/ranked-booking-domain.test.mjs`, `tests/ranked-booking.test.mjs`

**Interfaces:**
- Produces, schema:
  - `ranked_matches` gains:
    - `booker_id uuid`, `claim_until timestamptz`
    - `session_id uuid references app.sessions on delete set null`, `booked_at timestamptz`
    - `ended_by uuid`
    - `end_reason` also allows `'withdrawn'`
  - `ranked_match_players` gains `no_show_at timestamptz`.
- Produces, SQL functions:
  - `api.claim_booking(p_actor_id, p_key, p_match) → jsonb` (read). Raises `booking_taken` while someone else's claim is live, `booking_closed` unless confirmed and unbooked, `match_not_found` for outsiders.
  - `api.release_booking(p_actor_id, p_key, p_match)` (booker only; `not_booker` otherwise).
  - `api.book_match(p_actor_id, p_key, p_match, p_details jsonb, p_host_name text) → jsonb`. Raises `not_booker` / `booking_closed`, and `invalid_input` when the capacity isn't the player count.
  - `run_matchmaking`'s unbooked sweep adds `and session_id is null`.
- Produces, domain:
  - `rankedSessionForm(input: { format: SearchFormat; players: number; location: string; mapsLink: string; startLocal: string; endLocal: string; cost: string; timeZone: string }, now: Date): SessionForm`
- Produces, API:
  - `POST /ranked/matches/:match/claim` and `/release`, both `{operationKey}`
  - `POST /ranked/matches/:match/book` with `{operationKey, location, mapsLink, startLocal, endLocal, cost, timeZone}`. It reads the match through `read_my_search` to learn the format and player count, builds the form, runs `normalizeSession(form, true)` (InputError → 422), then calls `book_match` with host name = the actor's name.

- [ ] **Step 1: Failing domain tests** (`tests/ranked-booking-domain.test.mjs`):
  - Start 3 days ahead: cutoff is start − 24 h, open is now (minute precision, in that time zone).
  - Start in 5 hours: cutoff is the same as open.
  - Field values: capacity is "2" or "4"; `feeMode` split; `paymentMode` organizer; `access` private; `guests` false; currency SGD; title "Ranked Doubles"; activity "Pickleball".
  - `normalizeSession(form, true)` accepts the result and gives `totalMinor` 2400 for cost "24".
- [ ] **Step 2: Failing SQL/API tests** (`tests/ranked-booking.test.mjs`; helpers copied from `tests/ranked-matchmaking.test.mjs`, plus `confirmed()`, which pairs two singles players and has both accept). Tests:
  - `two claims at once: exactly one booker` (`Promise.all` of two claim POSTs): one 200, one 409 `booking_taken`, and the loser's read names the booker.
  - `hand-back and a lapsed claim reopen booking`: release → the other can claim. Separately, set `claim_until` into the past → the other can claim, and the old booker's `book` gets 409 `not_booker`.
  - `booking creates one private split session for exactly the players`:
    - read the session row and parties: published; `details.access` private; `feeMode` split; `totalMinor` 2400; `paymentMode` organizer; capacity 2; cutoff = start − 24 h; organizer = booker (the booker manages the session's group)
    - two confirmed parties, one per player
    - a retry with the same key returns the same `session_id`, and there are still two parties
  - `only the players can see the session`: an outsider's `GET /api/sessions/:slug` (or the shared read) is refused or shows the private placeholder; both players can read it.
  - `a booked match isn't swept at 4 days`: book, backdate `confirmed_at` 5 days, run → still confirmed.
- [ ] **Step 3: Run both test files. Expected: FAIL** (missing module, missing routes).
- [ ] **Step 4: Implement** the migration, domain function, registry entries and routes.
- [ ] **Step 5: Run.** `pnpm db:migrate:local`, then both files. Expected: PASS. Commit `feat(ranked): claim, hand back and book the court (WDL-424)`.

### Task 2: Self check-in, withdrawal and guards

**Files:**
- Create: `supabase/migrations/20261103131000_ranked_match_session.sql`
- Modify: `packages/database/src/functions.ts`, `apps/api/src/ranked.ts` (`POST /ranked/matches/:match/check-in`), and the conflict messages
- Test: `tests/ranked-booking.test.mjs`

**Interfaces:**
- `api.ranked_check_in(p_actor_id, p_key, p_match) → jsonb`:
  - Only the actor's own confirmed party.
  - Window `startsAt − 30 min ≤ now ≤ startsAt + 30 min`, else `check_in_closed`.
  - Writes `seat_attendance` (seat 1, `checked_in`, `changed_by` = actor) and an `attendance_changes` row, so it's idempotent.
- `api.withdraw_party` is wrapped: the old one is renamed to `app.withdraw_party_before_ranked`. After it, if the party's session belongs to a `confirmed` match and the player's seat is open:
  - Withdrawn before `cutoffAt`: `end_side` for the leaver's side, `requeue_side` for the other side, and the match becomes `cancelled`/`withdrawn`, with `ended_by` set.
  - Otherwise: `no_show_at` = withdrawn_at.
- Guards: `api.record_attendance`, `api.remove_party` and `api.cancel_session` raise `ranked_match_session` while the session belongs to a `confirmed` match (wrap pattern).
- `search_view`'s endReason gains `withdrew_match` / `partner_withdrew_match`, and `returned` gains `withdrawn`.

- [ ] **Step 1: Failing tests:**
  - `players check themselves in only inside the window`:
    - session start moved by SQL to now + 31 min → `check_in_closed`
    - start moved to now + 29 min → 200, and seat_attendance is `checked_in` with `changed_by` = actor
    - a repeat call → 200 and still one row
    - start moved to now − 31 min → `check_in_closed`
  - `nobody checks in someone else`: the booker's `record_attendance` (POST the existing attendance route) on the other player's party → 409 `ranked_match_session`.
  - `withdrawing before the cutoff ends the ranked match and keeps the session`:
    - the session stays published, the leaver's party is withdrawn, and the match is cancelled/withdrawn
    - the leaver's search is cancelled with endReason `withdrew_match`; the other player is searching with `returned` `withdrawn`
    - organizer attendance now works (no `ranked_match_session`)
    - replaying the withdrawal with the same key changes nothing
  - `withdrawing after the cutoff is kept for Results as a no-show`: set `cutoffAt` in the past in `details` → withdraw → the match is still confirmed and the player's `no_show_at` is set.
  - `the booker can't cancel or remove players while the match is on` → 409 `ranked_match_session`.
- [ ] **Step 2: Run. Expected: FAIL.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run both test files and `tests/sessions*.test.mjs` / `tests/attendance*.test.mjs` (whichever exist). Expected: PASS.** Commit `feat(ranked): self check-in and withdrawal rules for match sessions (WDL-424)`.

### Task 3: Match card booking flow and alerts

**Files:**
- Modify: `supabase/migrations/20261103131000_ranked_match_session.sql`. Or, if Task 2 is committed, a new `20261103132000_ranked_booking_view.sql`: `app.match_view` adds `booking` and `checkIn`, and `players[].checkedIn`.
- Modify: `packages/domain/src/ranked-search.ts` (`MatchView`), `packages/domain/src/ranked-alerts.ts` (kind `book`), `apps/web/src/ranked-page.tsx`, `apps/web/src/ranked-alerts.tsx`
- Test: `tests/ranked-alerts-domain.test.mjs`, `tests/ranked-booking.test.mjs` (view shape), browser

**Interfaces:**
- `MatchView.booking: { state: "open" | "claimed" | "booked"; bookerName: string | null; you: boolean; claimUntil: string | null; bookBy: string; session: { slug: string; startsAt: string; location: string } | null }`. `bookBy` = `confirmed_at + 4 days`.
- `MatchView.checkIn: { opensAt: string; closesAt: string; you: boolean } | null`.
- `players[].checkedIn: boolean`.
- `RankedAlert` gains `{ kind: "book"; key: "book:<matchId>"; matchId; claimed: boolean; deadline }`. It appears when booking is open (deadline `bookBy`) or claimed by you (deadline `claimUntil`).

- [ ] **Step 1: Failing tests:**
  - Domain alert tests for `book`: open → an item with `bookBy`; claimed by you → an item with `claimUntil`; claimed by someone else or booked → nothing.
  - A view-shape test: after a claim, the other player's read has `booking.state` "claimed", the booker's name and `you: false`. After booking, `booking.session.slug` is set and `checkIn` has opens/closes 30 min either side of the start.
- [ ] **Step 2: Implement the view and alert kind.**
- [ ] **Step 3: MatchCard, confirmed states:**
  - **Open:** "Everyone's in. One of you books the court by {bookBy}." with a primary **I'll book the court** button.
  - **Claimed by someone else:** "{name} is booking the court."
  - **Claimed by you:** a form with:
    - Court (text, prefilled from the proposed court or area)
    - Maps link (optional, prefilled)
    - Date and start time (`datetime-local`)
    - End time (`datetime-local`, prefilled with start + 1 h)
    - Total court cost in SGD (the hint says it's split equally)

    It has **Create the session** and **I can't book** buttons, plus "Book by {claimUntil}". Field errors appear inline with `role="alert"`.
  - **Booked:** "{location} · {local start}" with an **Open the session** link to `/s/{slug}`. A **Check in** button appears inside the window; otherwise the card says "Check-in opens at {time}" (or that it has closed). Each player shows "Checked in" or "Not yet" with an icon plus text.
- [ ] **Step 4: Alerts list:** a "Book the court for your {format} match · by {deadline}" item with a **Book the court** link to /ranked.
- [ ] **Step 5: Verify.** Run `pnpm typecheck && pnpm lint`. Browser at 375px with synthetic accounts: claim, book (form), open the session and see the split fee, and check-in visibility. Commit `feat(ranked): book the court and check in from the match card (WDL-424)`.

### Task 4: Record

- [ ] Add the PRD D-26 "Implemented for review (WDL-424)" note with the Builder's calls, including the pickleball capacity change. Run the full suite. Commit.
