# Payment modes for the pilot (D-18) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a host choose "Not tracked here" or "Pay the organizer" for each session, release unpaid spots by hand after the cutoff, let players say "I've sent it", and save a durable notice when payment instructions change after booking.

**Architecture:** Two new session detail fields (`paymentMode`, `releaseUnpaid`) are normalized in `packages/domain` and stored in the existing `sessions.details` JSON, so the existing booked-session trigger locks them after the first booking. New writes are Postgres `api.*` functions that follow the existing pattern: actor/key advisory lock, then group and session locks, an idempotency receipt, and server time after the locks. Hono routes in `apps/api/src/registrations.ts` call them. `app.registration_view` and `api.read_operation` get one more wrapper each, the same rename-and-wrap pattern earlier migrations use. Outbound email stays with P-06: this plan writes durable signals only.

**Tech Stack:** Postgres/Supabase migrations (plpgsql), Hono + Zod API, Next.js App Router web (React), TypeScript domain package, `node --test` integration tests against the local stack.

**Spec:** [PRD.md](../../../PRD.md) D-18, plus the D-18 paragraphs under RP-09, RP-10 and RP-11. Background: [Reclub analysis](../../research/2026-10-23-reclub-competitive-analysis.md), DQ-1, DQ-2 and DQ-5.

**Tracker:** no Linear task exists. This is a direct owner request in chat; creating a task needs separate authorization.

## Global Constraints

- Mode labels are exactly **Not tracked here** and **Pay the organizer**. A session with no tracked cost is never labelled "Free".
- "Pay in RallyPoint" is out of scope. Nothing here collects money, verifies a payment or names a country-specific payment service.
- Fixed and split fees exist only in "Pay the organizer". "Not tracked here" creates no fee obligation, split claim, Dues entry or payment instructions.
- Release switch copy: **Unpaid spots can go to the waitlist after the cutoff**. It needs "Pay the organizer", a fixed fee above zero, and no split.
- Join-step line, said once and only when release is on: **Pay by {cutoff} or your spot may go to the waitlist.**
- Release is manual: one party at a time, after a confirmation that repeats any "I've sent it" note. Nothing is released automatically.
- Release cancels the whole party (guest included), drops its unpaid fee, records actor and time, saves a signal for P-06 to email the primary, and promotes the waitlist in strict order.
- Parties confirmed at or after the cutoff can't be released this way. Release is open from the cutoff (inclusive) until start (exclusive).
- "I've sent it": only the party's own primary, while the party is confirmed or waitlisted, with an optional reference of up to 60 characters. It can be undone until the fee is marked paid. Only that player and the session's organizers/co-hosts can see it. It never counts as paid, never changes a spot, never appears on the confirmed-participant roster and never goes into an email. No image upload.
- Instructions change: when payment instructions are saved, changed or removed on a published session that has bookings, save one notice per saved revision. P-06 later sends confirmed and waitlisted primaries one email that links to the session, without the instructions.
- Sessions saved before this change have no `paymentMode` and behave as "Pay the organizer", so existing behavior and tests are unchanged.
- D-13 copy rules apply: no timezone, version, visibility or server wording in the interface, and each term is said once where people act.
- Every write uses the existing order of locks (actor/key advisory lock, group row, session row), an operation receipt, and `clock_timestamp()` read after the locks.

## Review Focus

1. **Release racing a paid mark.** An organizer marks a party paid in another tab and then taps Release with the old revision. Expected: 409 `stale_payment` and nothing changes. Pinned in Task 2.
2. **Two-seat party at the head of the waitlist.** Releasing a one-seat party frees one seat while a two-seat party waits first. Expected: nobody is promoted, and a later one-seat waiting party doesn't jump ahead. Pinned in Task 2.
3. **The cutoff and start instants.** Expected: release is accepted exactly at the cutoff and refused at start, and a party confirmed one second after the cutoff is never releasable. Pinned in Task 2.
4. **A replayed request after a lost response.** The same operation key for a release or note returns the first result without releasing or promoting twice, and a different body with that key is a 409 `idempotency_conflict`. Pinned in Tasks 2 and 3.
5. **A note on someone else's party or on an untracked session.** Expected: refused with no row written, and the note never shows up in a confirmed participant's roster view. Pinned in Task 3.

---

### Task 1: Payment mode in session details

**Files:**
- Modify: `packages/domain/src/session.ts` (`SessionForm`, `blankSession`, `normalizeSession`)
- Create: `supabase/migrations/20261023120000_payment_modes.sql`
- Test: `tests/payment-modes-domain.test.mjs` (new), `tests/payment-modes.test.mjs` (new, integration)

**Interfaces:**
- Produces: `export type PaymentMode = "untracked" | "organizer";` in `session.ts`. `SessionForm` gains `paymentMode?: PaymentMode` and `releaseUnpaid?: boolean`, and `normalizeSession` always returns both. SQL reads the mode as `coalesce(details->>'paymentMode','organizer')` and the switch as `coalesce((details->>'releaseUnpaid')::boolean,false)`.
- Produces: SQL error message `payment_not_tracked`, raised as `sqlstate 'P0001'`.

- [ ] **Step 1: Write the failing domain tests** in `tests/payment-modes-domain.test.mjs`, reusing the `session(fee)` fixture shape from `tests/currency-domain.test.mjs`:
  - `"a missing paymentMode stays Pay the organizer"`: `normalizeSession(session("200.00"), true)` returns `paymentMode === "organizer"`, `releaseUnpaid === false` and `feeMinor === 20000`.
  - `"Not tracked here keeps no fee"`: `{...session("200.00"), paymentMode: "untracked", feeMode: "split"}` returns `paymentMode === "untracked"`, `feeMode === undefined`, `feeMinor === undefined`, `totalMinor === undefined` and `releaseUnpaid === false`.
  - `"release needs a fixed fee above zero"`: `releaseUnpaid: true` with fee `"0.00"`, with `feeMode: "split"`, or with `paymentMode: "untracked"` each throws `InputError`. With fee `"200.00"` and fixed mode it returns `releaseUnpaid === true`.
  - `"unknown payment modes are refused"`: `paymentMode: "in_app"` throws `InputError`.
  - `"new sessions start as Not tracked here"`: `blankSession().paymentMode === "untracked"`.
- [ ] **Step 2: Run** `node --test tests/payment-modes-domain.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Implement in `session.ts`.**
  - Validate `paymentMode` (absent becomes `"organizer"`) and `releaseUnpaid` (absent becomes `false`; otherwise it must be a boolean) before the `if (!publish) return form;` line, so drafts keep them too.
  - For `"untracked"` on publish, skip fee parsing, delete `feeMode`, and return no `feeMinor` or `totalMinor`.
  - Throw `InputError("Releasing unpaid spots needs a fixed fee per seat.")` for an invalid `releaseUnpaid` on publish.
  - Set `blankSession` to `paymentMode: "untracked", releaseUnpaid: false`.
- [ ] **Step 4: Run** `node --test tests/payment-modes-domain.test.mjs`. Expected: PASS.
- [ ] **Step 5: Write the failing integration test** `test("Not tracked here sessions carry no money records", …)` in `tests/payment-modes.test.mjs`, copying the `sql`, `login`, `request` and `details` helpers from `tests/payments.test.mjs`. Publish with `paymentMode: "untracked"`, join with a guest, and assert:
  - `own.fee === null`;
  - `select count(*) from app.fee_obligations where party_id=…` returns `0`;
  - `GET /api/dues` lists no item for that slug;
  - `POST /api/registrations/{slug}/payments` returns 409 `fee_not_found`;
  - `POST /api/sessions/{id}/payment-instructions` with `{operationKey, revision: 0, action: "save", text: "Pay at the door"}` returns 409 `payment_not_tracked`. Match the body field names used in `tests/payment-instructions.test.mjs`.
- [ ] **Step 6: Run** `pnpm db:start`, then start the app (`pnpm dev`), then `node --test tests/payment-modes.test.mjs`. Expected: FAIL (an obligation row exists).
- [ ] **Step 7: Write the migration.**
  - `create or replace function app.confirm_party_fee` returns early when the mode is `'untracked'`, before either the split or the fixed branch.
  - Rename `api.update_payment_instructions` to `app.update_payment_instructions_before_payment_modes`. The new `api.update_payment_instructions` (same signature) raises `payment_not_tracked` for an untracked session after the manager check, then delegates.
  - Copy the revoke/grant pattern from `20261022143000_payment_instructions.sql`.
  - In `apps/api/src/payments.ts`, add `payment_not_tracked: "This session doesn’t track payment, so it has no payment instructions."` to `conflicts`.
- [ ] **Step 8: Run** `pnpm db:start && node --test tests/payment-modes.test.mjs tests/payments.test.mjs tests/payment-instructions.test.mjs tests/split-claims.test.mjs`. Expected: PASS.
- [ ] **Step 9: Commit**: `git add packages/domain/src/session.ts supabase/migrations/20261023120000_payment_modes.sql apps/api/src/payments.ts tests/payment-modes-domain.test.mjs tests/payment-modes.test.mjs && git commit -m "Let hosts choose Not tracked here or Pay the organizer per session"`

### Task 2: Release an unpaid spot after the cutoff

**Files:**
- Create: `supabase/migrations/20261023121000_release_unpaid.sql`
- Modify: `apps/api/src/registrations.ts`, `packages/domain/src/registration.ts`
- Test: `tests/release-unpaid.test.mjs` (new), `tests/payment-modes-domain.test.mjs`

**Interfaces:**
- Consumes: `paymentMode` and `releaseUnpaid` from Task 1.
- Produces: `api.release_unpaid_party(p_actor_id uuid, p_actor_name text, p_key uuid, p_slug uuid, p_party_id uuid, p_revision integer) returns jsonb`, which returns `{registration, operationKey}` like `api.update_payment`. Receipt action `'release_party'`.
- Produces: fee `liability_state 'released_unpaid'`, `fee_changes.action 'released_unpaid'`, `registration_events.kind 'released'` (the P-06 signal), and party `state 'removed'`.
- Produces: each managed roster entry gains `releasable: boolean`, computed at read time.
- Produces: `POST /api/registrations/:slug/release` with body `{operationKey, partyId, revision}`.
- Produces: in `registration.ts`, `Fee["liabilityState"]` gains `"released_unpaid"`, `ManagedFee.history[].action` gains `"released_unpaid"`, the roster entry type gains `releasable?: boolean`, and `feeStanding` returns `"Released"` for it.

- [ ] **Step 1: Write the failing tests** in `tests/release-unpaid.test.mjs`. Use the helpers from Task 1's test. Add `shift(sessionId, field, interval)`, which disables `protect_booked_session`, sets `details.{field}` to `clock_timestamp() + interval`, and re-enables the trigger, as `tests/withdrawals.test.mjs:510` does. Publish with `paymentMode: "organizer"`, fee `"12.50"`, capacity `"2"` and `releaseUnpaid: true`, book while the cutoff is in the future, then `shift(id,'cutoffAt',"'-1 minute'")`. Each `t.test`:
  - `"only current organizers and co-hosts can release"`: returns 401 without a token, 403 `group_access_denied` for a member, an outsider or the party itself, and nothing changes.
  - `"release waits for the cutoff and closes at start"`:
    - before the shift, 409 `release_too_early`;
    - after `shift(id,'cutoffAt',"'0 seconds'")`, 200;
    - for another party, after `shift(id,'startsAt',"'-1 second'")`, 409 `release_closed`.
  - `"only unpaid parties booked before the cutoff are releasable"`:
    - a party marked paid returns 409 `release_not_eligible`;
    - a waived party returns 409 `release_not_eligible`;
    - a party that joined after the shifted cutoff shows `releasable === false` and returns 409 `release_not_eligible`.
  - `"a session without the switch refuses release"`: 409 `release_not_enabled`.
  - `"release cancels the party, drops the fee and promotes in order"`:
    - the released party's `state === "removed"`;
    - the fee shows `liabilityState === "released_unpaid"` with `markedPaid === false`;
    - `history[0]` is `{action:"released_unpaid", by:<organizer name>}`;
    - one `registration_events` row of kind `released` exists;
    - the next waiting one-seat party is confirmed with a new due fee;
    - the guest seat is freed along with the primary.
  - `"a two-seat head party is never bypassed"`: with a one-seat confirmed party released and a two-seat party first in the queue, nothing is promoted and a later one-seat waiter stays waitlisted.
  - `"a stale revision never releases a party marked paid meanwhile"`: mark paid, then release with the earlier revision. Expected: 409 `stale_payment`, and the party stays confirmed.
  - `"a replay returns the first result"`: the same key and body twice returns identical registrations, with exactly one `released` event and one promotion. The same key with another `partyId` returns 409 `idempotency_conflict`. `GET /api/operations/{key}` for the organizer returns the registration.
  - `"the released player can rejoin at the end of the line"`: a new join returns `waitlisted` (or `confirmed` if there's room), and the old party stays `removed`.
  - `"split sessions can't turn release on"`: publishing `feeMode:"split"` with `releaseUnpaid:true` returns 422.
- [ ] **Step 2: Add a domain test** `"feeStanding says Released for a released fee"` to `tests/payment-modes-domain.test.mjs`. Run both files. Expected: FAIL.
- [ ] **Step 3: Write the migration.**
  - Extend `fee_obligations_liability_state_check` with `'released_unpaid'`. The audit constraint already requires `removed_at`/`removed_by`.
  - Extend `fee_changes_action_check` with `'released_unpaid'` and `registration_events_kind_check` with `'released'`.
  - Create `app.party_confirmed_at(p_party uuid) returns timestamptz`: the latest `created_at` of that party's `confirmed` or `promoted` event.
  - Create `app.party_releasable(p_party uuid, p_at timestamptz) returns boolean`. It is true only when all of these hold:
    - the session is published and in "Pay the organizer" mode;
    - `releaseUnpaid` is on;
    - `cutoffAt <= p_at < startsAt`;
    - the party is confirmed;
    - its fee is due, not marked paid and above zero;
    - `party_confirmed_at < cutoffAt`.
  - Create `api.release_unpaid_party`, copying the lock, receipt and replay shape of `api.withdraw_party` plus the `require_manager` and revision check of `api.update_payment`. After `require_manager` and the replay check, raise errors in this order: `release_not_enabled`, `release_closed`, `release_too_early`, `fee_not_found`, `stale_payment`, `release_not_eligible`. Then:
    - set the party's `state='removed'`;
    - set the fee to `released_unpaid` and add a `fee_changes` row with `trim(p_actor_name)`;
    - insert a `released` event;
    - call `perform app.fill_waitlist(s.id)`;
    - write the receipt.
  - Wrap `api.read_operation` for `'release_party'`, as `20261022143000_payment_instructions.sql` does for its action.
  - Wrap `app.registration_view` (rename the current function to `app.registration_view_before_payment_modes`). For a manager, rebuild `roster` with `jsonb_agg(entry || jsonb_build_object('releasable', app.party_releasable((entry->>'id')::uuid, clock_timestamp())))`, keeping the array order.
  - Copy the revoke/grant lists.
- [ ] **Step 4: Add the route and copy.** In `registrations.ts`, add a `release` Zod schema `{operationKey: key, partyId: key, revision: z.number().int().min(1)}`. Add the route, passing `p_actor_name: displayName(c.var.user, "Participant")`, and treat `"release"` as a managing action, with the 403 message "Only this session’s organizers can release spots." Add these conflict messages:
  - `release_not_enabled`: "This session doesn’t give unpaid spots to the waitlist."
  - `release_too_early`: "Unpaid spots can go to the waitlist once the cutoff passes."
  - `release_closed`: "Spots can’t be given away once the session starts."
  - `release_not_eligible`: "Only spots booked before the cutoff and still unpaid can go to the waitlist. Refresh to see the latest record."

  Then update `registration.ts`.
- [ ] **Step 5: Run** `pnpm db:start && node --test tests/release-unpaid.test.mjs tests/payment-modes-domain.test.mjs tests/withdrawals.test.mjs tests/payments.test.mjs tests/cancellations.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**: `git add supabase/migrations/20261023121000_release_unpaid.sql apps/api/src/registrations.ts packages/domain/src/registration.ts tests/release-unpaid.test.mjs tests/payment-modes-domain.test.mjs && git commit -m "Let organizers give unpaid spots to the waitlist after the cutoff"`

### Task 3: "I've sent it" note

**Files:**
- Create: `supabase/migrations/20261023122000_payment_notes.sql`
- Modify: `apps/api/src/registrations.ts`, `packages/domain/src/registration.ts`
- Test: `tests/payment-notes.test.mjs` (new)

**Interfaces:**
- Consumes: the Task 2 `registration_view` wrapper. This migration wraps it again (rename to `app.registration_view_before_payment_notes`).
- Produces: table `app.payment_notes(party_id uuid primary key references app.parties(id), reference text check(reference is null or length(reference) between 1 and 60), sent_at timestamptz not null)`, with RLS enabled, access revoked from public/anon/authenticated, and select/insert/delete for `service_role`.
- Produces: `api.update_payment_note(p_actor_id uuid, p_key uuid, p_slug uuid, p_party_id uuid, p_action text, p_reference text) returns jsonb`, where `p_action` is `'mark'` or `'undo'`. Receipt action `'payment_note'`.
- Produces: `own.paymentNote` and each managed roster entry's `paymentNote`, both `{reference: string | null, sentAt: string} | null`. The domain type is `export interface PaymentNote { reference: string | null; sentAt: string }`.
- Produces: `POST /api/registrations/:slug/payment-note` with body `{operationKey, partyId, action: "mark" | "undo", reference: string}`. The API trims the reference, and an empty one becomes `null`.

- [ ] **Step 1: Write the failing tests**, one `t.test` each:
  - `"a player can say they sent it, with or without a reference"`: `own.paymentNote.reference === "ABC 123"`; marking again replaces it; with an empty reference, `reference === null`.
  - `"undo works until the organizer marks paid"`: after undo, `own.paymentNote === null`. After the organizer marks paid, both mark and undo return 409 `note_already_paid`.
  - `"a waiting player can say they sent it"`: a waitlisted party gets 200.
  - `"only the party's own primary, in Pay the organizer, while booked"`:
    - another account's party returns 403 `session_unavailable`;
    - an untracked session, a withdrawn party, a removed party or a cancelled session returns 409 `note_not_allowed`;
    - no `payment_notes` row is written.
  - `"organizers see the note and confirmed participants don't"`: the organizer's roster entry has `paymentNote.reference === "ABC 123"`. Another confirmed participant's roster has no `paymentNote` key anywhere (`JSON.stringify(view.roster).includes("ABC 123") === false`).
  - `"the note never changes the spot or the paid mark"`: before and after mark/undo, the party's `state`, `queuePosition`, `fee.markedPaid` and `fee.revision` are equal.
  - `"references over 60 characters are refused"`: 422 `invalid_payment_note`.
  - `"a replay returns the first result"`: same key and body return 200 with one row; same key with another reference returns 409 `idempotency_conflict`.
- [ ] **Step 2: Run** `node --test tests/payment-notes.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the migration.** Follow `api.withdraw_party` for locks, the receipt and the own-party lookup (`user_id=p_actor_id`).
  - Raise `note_not_allowed` unless the session is published in "Pay the organizer" mode and the party is confirmed or waitlisted.
  - Raise `note_already_paid` when the party's fee exists and `marked_paid`.
  - `mark` upserts the row. `undo` deletes it; undo with no note is a no-op that still returns 200.
  - Add the view wrapper.
  - Wrap `read_operation` for `'payment_note'`, reading as the party's owner.
- [ ] **Step 4: Add the route and copy** in `registrations.ts`:
  - `note_not_allowed`: "You can only say you’ve paid for your own booking in a session paid to the organizer."
  - `note_already_paid`: "The organizer has already marked this paid."
  - 422 `invalid_payment_note`: "Use a payment reference of up to 60 characters."

  Then update `registration.ts`.
- [ ] **Step 5: Run** `pnpm db:start && node --test tests/payment-notes.test.mjs tests/release-unpaid.test.mjs tests/registrations.test.mjs`. Expected: PASS.
- [ ] **Step 6: Commit**: `git add supabase/migrations/20261023122000_payment_notes.sql apps/api/src/registrations.ts packages/domain/src/registration.ts tests/payment-notes.test.mjs && git commit -m "Let players say they've sent payment without changing their spot"`

### Task 4: Notice when payment instructions change after booking

**Files:**
- Create: `supabase/migrations/20261023123000_payment_instruction_notices.sql`
- Test: `tests/payment-instructions.test.mjs` (add a test)

**Interfaces:**
- Consumes: the Task 1 wrapper `api.update_payment_instructions`. This migration replaces it with `create or replace`, keeping the same signature.
- Produces: table `app.payment_instruction_notices(session_id uuid references app.sessions(id) on delete cascade, revision integer not null, created_at timestamptz not null, primary key(session_id, revision))`, service-role only. It holds no instruction text. P-06 reads it to email confirmed and waitlisted primaries one link to the session.

- [ ] **Step 1: Write the failing test** `test("changes after booking leave one private notice per saved revision", …)`:
  - Saving instructions before anyone books leaves no notice.
  - After one join, `save`, `set_image` and `remove` each add exactly one row, with revisions matching the instructions' revisions.
  - A replayed request adds nothing.
  - A draft and a cancelled session add nothing.
  - `select count(*) from information_schema.columns where table_name='payment_instruction_notices' and column_name in ('body','text')` returns `0`.
- [ ] **Step 2: Run** `node --test tests/payment-instructions.test.mjs`. Expected: FAIL.
- [ ] **Step 3: Write the migration.** The wrapper first takes the same `pg_advisory_xact_lock(hashtextextended(p_actor_id::text||p_key::text,0))` (it's re-entrant within the transaction) and checks whether a receipt for `(p_actor_id, p_key)` already exists. It then calls the inner function and inserts `(session_id, (result->>'revision')::integer, clock_timestamp())` only when all of these hold:
  - the call wasn't a replay (no receipt existed before the call);
  - the session is `published`;
  - `bookings_started_at is not null`.

  Use `on conflict do nothing`.
- [ ] **Step 4: Run** `pnpm db:start && node --test tests/payment-instructions.test.mjs tests/payment-modes.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit**: `git add supabase/migrations/20261023123000_payment_instruction_notices.sql tests/payment-instructions.test.mjs && git commit -m "Record a private notice when payment instructions change after booking"`

### Task 5: Session form and session page

**Files:**
- Modify: `apps/web/src/session-pages.tsx` (pricing fields near line 445, facts near line 704), `apps/web/src/registration-panel.tsx` (join consent near line 360, fee rows), `apps/web/src/payment-instructions.tsx` (`PaymentInstructionsEditor`)
- Test: `tests/pages.test.mjs` (deep link still renders), plus the manual browser check below

**Interfaces:**
- Consumes: `PaymentMode`, `paymentMode` and `releaseUnpaid` from Task 1.

- [ ] **Step 1: Form.**
  - Add a **Payment** `SelectField` with options `untracked` "Not tracked here" and `organizer` "Pay the organizer".
  - Show Currency, Pricing, the fee field and **Cancellation fee cutoff** only for `organizer`. For `untracked`, set `cutoffLocal` to `startLocal` when saving, so validation passes without asking.
  - For `organizer` with "Fee per seat", show a `SwitchField` labelled "Unpaid spots can go to the waitlist after the cutoff", with no description.
  - All of these follow the existing `disabledFields` rule, so they lock once booked.
- [ ] **Step 2: Session page.**
  - For `untracked`, hide the Fee and "Free cancellation until" facts, the fee lines in the join and withdraw steps, the payment instructions, and the payment instructions editor.
  - For `organizer` with `releaseUnpaid`, add the single line "Pay by {time(cutoffAt)} or your spot may go to the waitlist." to the join step, next to the fee consent. Don't repeat it elsewhere.
  - For a `removed` own party, show "Your spot went to the waitlist because it wasn’t marked paid by {time(cutoffAt)}." and keep the normal Join action, so the player can rejoin at the end of the line.
- [ ] **Step 3: Run** `pnpm check && node --test tests/pages.test.mjs`. Expected: PASS.
- [ ] **Step 4: Manual check in the browser** at a phone width of 375 px and on desktop, with the synthetic organizer and member accounts from README:
  - create one session of each mode;
  - confirm "Free" appears nowhere;
  - confirm the release switch appears only for a fixed fee;
  - confirm the pay-by line appears once;
  - confirm fields lock after the first booking.
- [ ] **Step 5: Commit**: `git add apps/web/src/session-pages.tsx apps/web/src/registration-panel.tsx apps/web/src/payment-instructions.tsx && git commit -m "Show payment modes and the pay-by line on the session form and page"`

### Task 6: Game day, the player's note and Dues

**Files:**
- Modify: `packages/domain/src/game-day.ts` (`paymentWords`), `apps/web/src/game-day.tsx` (`Payment`, `PartyDetails`), `apps/web/src/registration-panel.tsx` (below `HowToPay`), `apps/web/src/screens.tsx` (Dues rows), `README.md`, `PRD.md` (RP-11 and RP-10 D-18 paragraphs)
- Test: `tests/game-day-domain.test.mjs`

**Interfaces:**
- Consumes: `releasable` and `paymentNote` (Tasks 2 and 3), `POST …/release` and `POST …/payment-note`, and `feeStanding` "Released".
- Produces: `export function noteWords(note: PaymentNote | null | undefined): string` in `game-day.ts`. It returns `""` for no note, `"Says sent"` with no reference, and `"Says sent · ref {reference}"` otherwise.

- [ ] **Step 1: Write the failing tests** in `tests/game-day-domain.test.mjs`:
  - `noteWords(null) === ""`;
  - `noteWords({reference:null,sentAt:"…"}) === "Says sent"`;
  - `noteWords({reference:"ABC 123",sentAt:"…"}) === "Says sent · ref ABC 123"`;
  - `paymentWords` of a `released_unpaid` fee is `"Released"`.

  Run them. Expected: FAIL.
- [ ] **Step 2: Implement** `noteWords` and the `paymentWords` branch. Run the tests. Expected: PASS.
- [ ] **Step 3: Game day.**
  - Under each unpaid party's payment words, show `noteWords` as quiet text.
  - When `releasable`, add a **Give spot to waitlist** action in `PartyDetails`. Its confirmation sheet reads:
    - "Give {primaryName}’s spot to the waitlist?"
    - "Their unpaid {amount} is dropped and the next person in line gets the spot."
    - When a note exists, an extra line: "{primaryName} says they sent it{ · ref …}."
    - Buttons: **Give spot away** and **Keep**.
  - Use the existing `use-mutation` recovery flow for an interrupted request.
- [ ] **Step 4: Player note.** Below `HowToPay`, for an own confirmed or waitlisted party in "Pay the organizer" whose fee isn't marked paid:
  - show an **I've sent it** button with an optional "Payment reference" input (`maxLength={60}`);
  - once it's saved, show "You said you sent it{ · ref …}" with **Undo**;
  - hide both once the fee is marked paid.
- [ ] **Step 5: Dues.** A released fee shows "Released" through `feeStanding`, with no amount owed.
- [ ] **Step 6: Docs.** Add a short "Payment modes" section to README: what each mode does, the release and note rules, that notices and `released` events wait for P-06 to send email, and the manual checks from Task 5 Step 4 plus this task's flow. In PRD RP-11, add "Implemented for review, {date}" with the commit range. That records implementation, not acceptance.
- [ ] **Step 7: Run** `pnpm check && pnpm test:api`. Expected: PASS. Then repeat the manual flow at 375 px:
  - book before the cutoff, move the cutoff with SQL as in the tests, mark a note, release from game day;
  - check the next person is promoted;
  - check the released player sees the message and can rejoin;
  - check keyboard focus moves into the sheet and back to the row, that every status word has an icon and words, and that it works with reduced motion.
- [ ] **Step 8: Commit**: `git add packages/domain/src/game-day.ts apps/web/src/game-day.tsx apps/web/src/registration-panel.tsx apps/web/src/screens.tsx tests/game-day-domain.test.mjs README.md PRD.md && git commit -m "Show sent notes and let organizers give unpaid spots away on game day"`

## Builder's calls (owner: please check)

- New sessions start as **Not tracked here**, because D-13 says to ask only what the organizer must decide. Existing sessions keep behaving as "Pay the organizer".
- "Not tracked here" hides the cutoff and stores it as the start time.
- The organizer's button says **Give spot to waitlist**, not "Release". The release confirmation says the person will see it on their page, not that they'll get an email, because email delivery (P-06) isn't live.
- Undoing "I've sent it" deletes the note rather than keeping a history. It's a hint, not a record.
- Notices are saved one per saved revision. When P-06 is built, it should combine unsent notices for the same session into one email.
