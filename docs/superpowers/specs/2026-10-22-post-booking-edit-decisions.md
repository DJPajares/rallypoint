# Editing a session after people book (D-14)

Date: 2026-10-22. Task: [WDL-386](https://linear.app/wwonderland/issue/WDL-386). Baseline: `26b1127`.

**Decision status: accepted, 2026-10-22.** The owner skipped the discovery questions, so the rules started as the builder's recommendation. The owner then replied: “Approved: accept D-14 as written in PR #20 and record it. Also approved: create the drafted P-16 implementation task in Linear.” The rules below are accepted as written; alternatives are kept for context and are not selected. This approves the policy and the creation of the P-16 task. Implementation, merge and deployment keep their own authorization boundaries.

## Why

Today the first booking, including a waiting party, locks every session detail (`booked_event_locked`, RP-02). In a real pilot an organizer can't fix a typo, correct a wrong venue, move the start time or add seats without cancelling. Payment instructions already live outside the lock (WDL-383).

## The principle

A booking is consent to specific terms: when and where, the fee, the free-cancellation cutoff, the guest rule and automatic promotion from the waitlist (D-03/D-04). So the recommendation sorts every change into one of three groups:

- **Changes that don't touch what people agreed to** are simply allowed.
- **Changes to when or where** are allowed. Bookings stay, but everyone who booked under the old terms gets an email and a free way out.
- **Changes to money or booking rules** are not edits. The organizer cancels (WDL-384) and publishes a new session.

## Accepted rules

| Change after bookings | Allowed? | Seats and queue | Fees | Notification | Consent |
| --- | --- | --- | --- | --- | --- |
| Title, activity, notes (the optional instructions text) | Yes, until start | Unchanged | Unchanged | None; the page shows the new text | Not affected |
| Capacity increase | Yes, until start | The waitlist fills at once, in strict order, in the same save | Promoted parties owe the published fee, as for any promotion (RP-08) | Promotion email only (D-05) | Promotion was already agreed when joining the waitlist |
| Capacity decrease | Yes, down to the confirmed seats, until start | Nobody is moved back to the waitlist; below confirmed seats is refused (RP-02) | Unchanged | None | Not affected |
| Start time, end time or venue | Yes, until start; a new start must still be in the future | Unchanged | **Affected parties** may withdraw before start with any unpaid fee or split share released, even after the cutoff. Paid markers stay; refunds stay external | One change email to the primary account of each confirmed and waitlisted party (P-06). The reminder moves under D-05's rule | Earlier agreement no longer binds: free way out |
| Cancellation cutoff | Only in the same save as a start-time change, and still between opening and the new start | Unchanged | Applies to people who join afterwards; affected parties already withdraw free | Part of the same change email | New joiners agree to the new cutoff |
| Opening time, fee amount, currency, fixed/split choice, guest allowance | No | — | — | — | Would need fresh agreement from every party |
| Anything at or after start | No (server time after locks, like joins) | — | — | — | — |

The refusal message for locked fields: "People have booked, so the fee and booking rules can't change. Cancel this session and publish a new one."

**Affected party:** a party whose consent to join came before the latest start/end/venue change. This includes a waiting party that is promoted after the change, because its consent to automatic promotion was given under the old terms. It excludes:

- parties that joined after the change; they agreed to the new terms, so the normal cutoff applies
- parties that had already withdrawn; a retained late fee stays until the organizer waives it

## What people see

- **Organizer:** saving a start/end/venue change asks once: "Everyone booked will get an email and can withdraw without a fee until the start." Locked fields stay visibly disabled with the refusal message as help text.
- **Participant:** the session page shows only the current details. When the participant is affected, the withdraw step says "The time or place changed after you booked, so withdrawing now is free." D-13 applies: no change log or version numbers on screen.

## Integrity notes for the builder

- Edits run under the existing group → session lock. A capacity increase promotes inside the same transaction through the existing `app.fill_waitlist`. The `stale_version` check already prevents silent overwrites.
- A join submitted against an older version already gets `stale_terms` and must review the current terms. That stays as is.
- The free-withdrawal check compares the party's `consent_version` with the version of the latest start/end/venue change. The `session_changes` row records which fields changed, so a "material" flag can be derived and stored.
- The released fee needs its own liability state (for example `removed_after_change`), with actor/time, so history can tell it apart from a before-cutoff release. Split shares are released the same way as in a before-cutoff withdrawal.
- The change email is a durable signal committed with the edit, as cancellation does. It names what changed (time, venue or both) and links to the session. P-06 owns delivery, superseding and ambiguity rules under D-05.
- Builder's call: an edit keeps the session's saved timezone. Opening the editor on a device in another zone must not shift stored times. Only a real change of instant or venue text counts as material.

## Alternatives not selected

- **Keep everything locked (today):** safe, but a typo forces cancel and republish, which loses every booking.
- **Allow fee changes with re-consent from each party:** touches paid markers and split allocations, and adds a consent flow the MVP doesn't have.
- **Treat an end-only change as minor (no email, no free withdrawal):** fewer emails, but one more rule for organizers to learn. It can be adopted by changing one table row.
- **Allow switching guests on after booking:** harmless to existing parties, but it changes queue dynamics for people already waiting. Left locked for simplicity.
- **Drop bookings automatically on a time or venue change:** people lose places they may still want.

## Walk-through

Setup: capacity 2. Party P1 (primary plus guest, two seats) is confirmed; solo W is waiting; the cutoff has passed.

1. **Fix the title.** The version goes up and nobody gets an email. P1 and W are unchanged.
2. **Raise the fee.** Refused; nothing changes.
3. **Move the venue.** P1's and W's primary accounts each get one change email.
   - P1 withdraws before start. Both seats are released and P1's unpaid fee is released, because P1 is affected.
   - W is promoted in the same transaction and owes the published fee. W is affected too, so W can still withdraw free before start.
4. **New joiner X**, after the venue change and after the cutoff. X agreed to the new terms, so withdrawing keeps X's fee.
5. **Raise capacity from 2 to 3** (in a fresh session with P1 confirmed and W waiting). W is promoted at once and owes the fee. Lowering back to 2 is then refused, because 3 seats are confirmed.
6. **Edit after start.** Refused.

## Effects on other work

- RP-02 records the accepted rules next to its current boundary; P-16 replaces the lock.
- [WDL-379](https://linear.app/wwonderland/issue/WDL-379) (P-06) gains exactly one change email: start/end/venue saves. Its reminder rescheduling follows D-05 once implemented here.
- D-03's separate "post-registration edits" (a participant changing their own party) stay proposed.
- Series edits (D-02) stay out of scope.

## Choices the owner accepted

Accepted as written on 2026-10-22, including the three choices flagged for review:

1. A change to the **end time alone** counts as a "when" change: email plus free withdrawal.
2. Affected parties withdraw **free even after the cutoff**.
3. **Fee, guest and opening changes** require cancelling and republishing.

## Implementation task (P-16)

The owner approved creating this task on 2026-10-22. Linear holds its status and relationships; the text below is the approved draft.

### Description

Let organizers/co-hosts edit a booked session under D-14 instead of the blanket `booked_event_locked`. Title, activity and notes edit freely. Capacity can rise, which promotes the queue, or fall to the confirmed seats. Start/end/venue changes keep bookings, record a change signal for P-06 and give affected parties a free withdrawal until start. References: RP-02, RP-08, RP-09, D-03, D-04, D-05, D-13, D-14.

### Scope

**Included:**
- the field-level edit rules and refusal message
- capacity-driven promotion in the same transaction
- the material-change flag and a durable change signal
- the affected-party release of unpaid fees and split shares, with its own liability state and history
- the organizer confirmation, the participant withdraw copy, and tests

**Excluded:**
- sending email (P-06)
- fee/currency/guest/opening edits
- participant party edits (D-03)
- series edits (D-02)
- moving reminders before P-06 exists

### Suggested Models & Reasoning

- **Platform/model:** Claude Code with Claude Opus 5.5 (available in this workspace on 2026-10-22).
- **Reasoning:** high.
- **Reason:** consent, fee liability and queue integrity change together under concurrency.

### Acceptance Criteria

1. After bookings, title/activity/notes and capacity edits save before start. A save with fee, currency, fee mode, guest or opening changes is refused with the D-14 message and changes nothing.
2. A capacity increase promotes the waitlist in strict order in the same transaction. A two-seat head that doesn't fit is not bypassed. A decrease below confirmed seats is refused.
3. A start/end/venue save increments the version, records a material change and one durable change signal, and leaves parties, fees and paid markers unchanged. A new start in the past is refused. A cutoff change is accepted only together with a start change, within opening and the new start. Editing from a device in another timezone does not change stored instants.
4. An affected party withdrawing before start, including after the cutoff, has its unpaid fee or split share released with actor/time and a distinct history action. A paid marker stays. Parties that joined after the change keep the normal cutoff rule. A waiting party promoted after the change counts as affected.
5. Edits at or after start, from non-managers, or from revoked co-hosts are refused. Concurrent edit/join/withdraw/promotion races leave one consistent result.
6. The organizer sees one confirmation before a start/end/venue save. An affected participant sees the free-withdrawal line in the withdraw step. No version numbers or change logs are shown.

### Dependencies

- **Blocked by:** WDL-386, until its PR recording D-14 is integrated.
- **Blocking:** P-06's change email ([WDL-379](https://linear.app/wwonderland/issue/WDL-379)) for start/end/venue updates.
- **Related:** WDL-384 (cancellation), WDL-383 (payment instructions outside the lock).

### Execution Context and Verification

- **Read/reuse:**
  - `api.save_session`, `app.guard_booked_session` and `app.fill_waitlist` (`supabase/migrations/20261021175108_registration_queue.sql`)
  - `app.release_withdrawal_fee` (`20261022004241_withdrawal_promotion.sql`)
  - split claim release, `session_changes` and `apps/api/src/sessions.ts`
  - `apps/web/src/session-pages.tsx` and `registration-panel.tsx`
- **Checks:**
  - `pnpm check`, `pnpm db:lint` and `pnpm test:api`
  - focused tests for each acceptance criterion, including the walk-through above and simultaneous edit/withdraw/join
  - browser check at phone width

### Manual Test

Future verification: publish a two-seat session, book a party of two and waitlist a solo, and move the cutoff into the past.

1. Fix the title; no confirmation appears.
2. Try changing the fee; it's refused with the D-14 message.
3. Change the venue and confirm the prompt.
4. As the party of two, withdraw: the withdraw step says it's free, the fee is released, and the solo is promoted.
5. As the solo, see the same free-withdrawal line.
6. Join as a new account; its withdraw step shows the normal late-fee terms.
