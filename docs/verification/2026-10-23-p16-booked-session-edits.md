# P-16 verification

Date: 2026-10-23. Task: [WDL-391](https://linear.app/wwonderland/issue/WDL-391/p-16-let-organizers-edit-a-booked-session-under-d-14). Integration baseline: `88f2b0e`. Node 24.16.0, pnpm 11.14.0, Supabase CLI 2.121.0, local Postgres 17, Next.js 16.4.2.

## User note

Organizers can correct booked sessions, add seats or change the time/place before start. People booked before a time/place change can withdraw with their unpaid fee or share removed, including after the cutoff. Paid records stay intact. Fee and booking-rule controls remain locked.

## Observed checks

- New policy tests failed against the previous blanket lock, then passed (11 API integration cases and 4 domain cases after review). Legacy payment-default compatibility was reproduced separately before its fix.
- `pnpm check`: lint, TypeScript and production build passed.
- `pnpm db:lint`: no schema errors.
- `RALLYPOINT_TEST_URL=http://127.0.0.1:3002 pnpm test:api`: 192 tests passed, zero failed. Two historical tests were updated from refusing a title edit to refusing a fee edit; their former 409 expectation conflicts with D-14.
- `pnpm build:staging`: OpenNext build passed; generated environment module verified free of embedded environment values. No deployment performed.
- A fresh rebuild of the P-16-only database applied the complete migration chain before the focused tests passed.

The dedicated synthetic Supabase project was `rallypoint_p16`, API 54331 / database 54332 / local mail 54334. The test checkout copied the feature branch's product sources byte for byte; only test harness container names, local-only port guards and local project configuration were substituted in that private checkout. No shared/live schema migration was run. P-06's worktree, code and tracker status were not changed.

## Phone browser walkthrough

Playwright Chromium at 390 × 844 against the isolated app on 127.0.0.1:3002, using synthetic local email-code identities:

1. Loaded a booked two-seat session. Title/activity/time/location/capacity were enabled; payment, currency, pricing, fee, opening, guest and unpaid-release controls were disabled. Cutoff was disabled while the start stayed unchanged.
2. A title-only edit saved without confirmation. A venue edit opened one native modal. Focus entered the modal; Keep editing preserved the entered venue. Confirming saved once.
3. The affected primary opened the whole-party withdraw sheet after cutoff. It showed: “The time or place changed after you booked, so withdrawing now is free.” Withdrawing removed the unpaid two-seat fee with an audit actor and promoted the waiting solo, whose fee remained due.
4. A session-specific test trigger forced signal insertion to fail. The API returned an unconfirmed action; version, venue and signal count stayed unchanged. Removing the test trigger and choosing Retry same request committed one edit/signal with no second confirmation. The trigger/function were removed.
5. The participant opening the editor received the organizer-access denial with a retry control.

The confirmation and withdrawal sheets were visually inspected at phone width. No horizontal clipping was observed. The local sign-in screen emitted an existing hydration warning for a heading's focus-added `tabindex`; this is outside the changed editor/withdrawal flow. This was browser simulation, not a physical-device or deployed test.

## Fresh review and regressions

A read-only gpt-6-astra review of `88f2b0e..e6c078d` found two Important issues and no Critical issues. Both were reproduced before fixes:

- First booking after editor load could skip confirmation because joining does not bump the session version. The browser reproduced a direct venue save without a modal. The fixed editor confirms every published time/place edit; repeating load-unbooked → first join → venue edit showed one modal and one material history/signal after confirmation. A domain regression covers the stale no-booking snapshot.
- Direct booked database writes could change venue without history or delete required timestamps. A new integration regression failed on the missing refusal, then passed after the guard required the complete save path and its version increment. The save sets/restores a transaction-local marker only around its guarded update; validation, history/signals and promotion remain in one transaction.

Both regressions passed RED→GREEN, followed by a fresh full migration rebuild and 192/192 complete-suite pass. No second review was dispatched; regression and complete-suite results verify the fixes. One Minor documentation finding is deferred: the later split section of `docs/foundation-api.md` retains superseded blanket-lock/cutoff wording despite the updated session contract above. P-06 delivery/reminder behavior was explicitly excluded from review scope under the user's pause.

## Scope and recovery

No email was sent by P-16, no reminder was moved and no cloud service was changed. Local Auth codes went only to the synthetic mail sink. Private `app.session_change_signals` rows snapshot active party IDs and changed time/venue values; P-06 owns delivery. Confirmation copy therefore promises free withdrawal and omits the prospective email promise until delivery exists.

The migration is additive to stored data and history. Keep the schema when rolling back application code; restoring the old blanket-lock behavior after actual material edits needs a reviewed follow-up migration that preserves consent-based withdrawal and audit data. Cloud application requires the existing mapped-schema migration/release process after human review.
