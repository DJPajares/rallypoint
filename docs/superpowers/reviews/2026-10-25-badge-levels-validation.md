# P-19 badges with shared levels — review evidence

- **Date:** 2026-10-25, Asia/Singapore.
- **Task:** [WDL-394](https://linear.app/wwonderland/issue/WDL-394), In Progress.
- **Branch:** `djpajares/wdl-394-p-19-build-a-distinctive-achievement-badge-system-with`, cut from `main` at `1b741f7`.
- **Verified code:** `419958f` (after review fixes); documentation follows it.
- **Status:** no release version is assigned. This is implementation and local validation, not human acceptance, merge or live-flow verification.
- **Review:** no pull request yet; pushing and opening one waits for the owner.
- **Design and plan:** the owner-approved [design](../specs/2026-10-25-badge-levels-design.md) and the [implementation plan](../plans/2026-10-25-badge-levels.md).

## User note

Badges now grow with you. There are six badges, each with five levels:
- **Rally:** sessions you played.
- **Steady:** months you played.
- **New Faces:** people you played with.
- **Plus One:** guests you brought.
- **Host:** sessions you ran.
- **Full House:** full sessions you ran.

Each level has its own colour and number, the same on every badge. Your profile shows each badge once, and tapping it shows every level and what's next. Titles you already chose stay as they are.

## Result and scope

### Catalog
- **Six badges** (`rally`, `steady`, `new-faces`, `plus-one`, `host`, `full-house`) with the owner-approved thresholds. They are derived on every read from the existing trusted records:
  - your own checked-in seat at non-cancelled sessions;
  - your checked-in guests;
  - the check-ins you recorded;
  - the other accounts checked in with you.
- **Corrections and cancellations** recalculate levels both ways. Inactivity changes nothing.
- **Steady months** use the session's start in its own time zone. An unknown zone counts in UTC.
- **Retired:** Regular, Off the Bench and Founder leave the shelf. Their check-ins still count in Rally and Steady.

### Look and behaviour
- **One colour per level** (sky, teal, violet, coral, gold), shared by every badge.
- **Non-colour marker:** a numeral chip at 32px and above.
- **Rim:** heavier at level 3, doubled at level 5.
- **Contrast:** the white icon is at least 3:1 against each disc, and the numeral at least 4.5:1. Both are checked by a test.
- **Owner shelf:** all six badges as buttons, with "Level n", "Complete" or "Not started". Each opens a sheet listing the five levels, the owner-only earned dates, and the next step.
- **Public profile:** started badges only, as `{key, level}`, not tappable. The stat row is unchanged.
- **New-level sheet:** shows "Rally · Level 3" for the highest unseen level, plus "+N more". Closing marks every unseen level seen. "Show as my title" appears only when the level has an old-badge equivalent you have earned.
- **Home nudge:** points at the closest next level.

### Compatibility and storage
- **Titles are unchanged until WDL-405.** `app.earned_badges`, `app.visible_title` and `api.set_my_title` are untouched. `read_my_badges` returns the old badges you may pick as `titles`.
- **Title pills** show the old name with the mapped level's medallion. Retired titles show no medallion.
- **Release-day backfill:** every level each account already had is marked seen, so there is no cascade of popups.
- **Seen markers** are `key:level` and are never deleted, so a level that is re-earned doesn't celebrate twice.
- **Authorization is unchanged.** All badge functions are `service_role`-only. Seen markers accept only levels reached right now.

## Environment

- **Tools:** macOS local worktree; Node 24.16.0, pnpm 12.15.0, Next.js 16.4.2, Prisma 7.10.1, Supabase CLI 2.121.0. No dependency changes.
- **Database:** the loopback synthetic Supabase Postgres/Auth/mail services, shared with the main checkout. Migration `20261025090000_badge_levels` was applied to that local database only.
  - The first apply failed on a syntax error (`month` needs `as`). Nothing was applied, since it runs in one transaction.
  - The failed history row was marked rolled back, then the corrected migration applied.
  - Until this merges, the `main` checkout's badge UI and badge tests won't match that DB. A note for sibling sessions records this.
- **App server:** API and browser checks used this branch's Next dev server on `127.0.0.1:3002` (`RALLYPOINT_TEST_URL`).
- **Data:** synthetic accounts only.

## Migration rehearsal (shared local DB, synthetic history)

| | Before | After |
| --- | --- | --- |
| Accounts with badges / levels | 629 | 644 (the RED test run added fresh accounts) |
| Old seen markers (md5 of rows) | `f201b254…` | unchanged `f201b254…` |
| Visible titles (md5) | `7a55b932…` | unchanged `7a55b932…` |
| Levels not marked seen | — | 0 |
| New `key:level` seen markers | 0 | 804 |

Recovery is written at the top of the migration: restore the three replaced functions and `app.badge_progress`, drop the new ones, and delete the `key:level` seen rows.

## Checks

| Check | Result |
| --- | --- |
| `node --test tests/badges-domain.test.mjs` (RED first, then GREEN) | 12/12 pass. Covers the catalog and thresholds, level and title id parsing, the popup and nudge choice, every copy line, the old-title mapping, contrast at a quarter and half of the disc, a response of another shape reading as empty, and SQL thresholds equal to the catalog. |
| `node --test tests/badges.test.mjs tests/profiles.test.mjs` (RED first, then GREEN) | Pass. Covers level 1 and the boundary at 9 and 10; correction and re-earn staying seen; guest → Plus One only; 5 accounts → New Faces level 1 with the guest not counted; a self-hosting runner getting Rally + Host + Full House; Steady across the Manila midnight, in UTC, and with an unknown zone; no-show, waiting and cancelled earning nothing; seen ids (unearned ignored, two simultaneous posts → 1 row, bad ids 422); anon and signed-in direct RPC refused; old titles, rosters, correction and the retired Founder title; public `{key, level}` in catalog order. |
| `pnpm db:lint` | No schema errors |
| `pnpm check` (lint, typecheck, build) | Pass |
| `pnpm test:api` (whole suite) | 361/361 pass, 0 fail, 0 skipped (after the review fixes; 360/360 before them) |

### Browser

Viewport 375×812, light and dark, on `:3002`, signed in as a synthetic account:

- **New-level sheet:** "Rally · Level 1", "Your first session, checked in.", "+2 more on your profile" and "Show as my title". After Done and a reload it does not return.
- **Home nudge:** "Steady · 1 more month".
- **Shelf:** six badges, three per row, with level text and numeral chips, in both themes.
- **Host details sheet:**
  - It opens with the keyboard, and focus moves to Close.
  - Escape returns focus to the Host shelf button.
  - It shows the earned date and "3 more sessions to run for level 2".
- **Five-level ladder:** a temporary DOM preview, removed afterwards, of Rally, Host and Full House. The same level is the same colour on every badge, and the icons stay distinct.
- **Titles:** the picker set "Host", and the pill shows the Host level-1 medallion on the profile and on the session roster.
- **Public profile:** an account with the retired "Regular" title shows a plain pill, and only its started badges, not tappable.
- **Reduced motion:** the `prefers-reduced-motion` rule disabling the pop-in is present in the shipped CSS.
- **After the review fixes:** the darker level-1 blue was checked on the shelf. Shelf buttons have no separate label, so they are named by their visible text ("Rally Level 1", "Steady Not started").

## Fresh review

A fresh reviewer read `1b741f7..d773f75` against the spec, the plan and the review focus.

- **Critical findings:** none.
- **Confirmed correct:** the derivation (one row per reached level), privacy, grants, and all five review-focus behaviours.

The fixes are in `419958f`, each one test-first where a test runner exists:

- **Contrast.** The white icon fell below 3:1 near the light corner of the level 1 (sky) and level 5 (gold) discs. The contrast test now also checks a quarter of the way along the gradient. Both colours were darkened: sky `#3FA2F2→#1E4FD6`, gold `#D3962C→#984606`.
- **Release order.** The badge response changes shape, so a page running the old or new app against the other database shape would throw.
  - The app now reads a response of the other shape as no badges (`badgeStates` and `titleOptions`, with a domain test).
  - **Rollout order:** ship the app first, then apply the migration. Badges then appear empty for at most the minutes in between, and no page breaks.
- **Accessible names.** At level 5 the shelf button's name ("level 5 of 5") did not contain its visible "Complete" (WCAG 2.5.3). The reviewer graded this Minor; I graded it Important for its effect on voice-control users. Buttons are now named by their visible name and level, which was checked in the browser.

Deferred minor findings:
- Steady's earned dates are numbered by month, so a late-recorded month can show out-of-order dates.
- `badge_zone(null)` returns null rather than UTC. No live session lacks a zone.
- One badge read recomputes the same records several times. It took 27 ms for 10 sessions locally.
- The details sheet with a count of 0 says "1 more session for level 1" rather than "Your first session earns level 1".
- The details sheet announces the level twice.
- No test covers a retired title on a roster.

Left as before, per the spec ("as now"):
- Host credit stays after a reversed check-in.
- Full House can drop after later cancellations.

## Gaps

- No screen-reader run (VoiceOver/TalkBack). The labels were read from the DOM only.
- Reduced motion was checked in the CSS, not with real OS emulation.
- No real account at level 5. Levels above 2 were seen only in the temporary colour preview.
- `main`'s badge UI and badge tests won't match the shared local DB until this merges.
- The rollout order (app first, then migration) is recorded here and must be followed at release. The production migration needs its own authorization.
- No staging or production verification. Nothing is pushed, merged or deployed.
