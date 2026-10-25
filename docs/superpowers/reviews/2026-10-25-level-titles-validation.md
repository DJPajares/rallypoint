# WDL-405 level titles — review evidence

- **Date:** 2026-10-25, Asia/Singapore.
- **Task:** [WDL-405](https://linear.app/wwonderland/issue/WDL-405), In Review.
- **Branch:** `djpajares/wdl-405-unlock-distinct-personal-profile-titles-from-earned-badge`, cut from `main` at `29600b3` (P-19 merged).
- **Verified code:** `31a3663` (after the review fixes); documentation follows it.
- **Status:** no release version. This is implementation and local validation, not acceptance, merge or live verification.
- **Review:** [PR #40](https://github.com/DJPajares/rallypoint/pull/40), open against `main` and linked to WDL-405. Auto-merge is disabled.
- **Design and plan:** [design](../specs/2026-10-25-level-titles-design.md) and [plan](../plans/2026-10-25-level-titles.md).

## User note

Your title now comes from a badge you've earned and grows with it. Pick a badge on your profile, and your title reads its current level. Rally, for example, goes Rookie → Regular → Mainstay → Veteran → Rally Master. Titles you chose before were moved to the matching badge.

## Result and scope

### Titles
- **30 owner-approved level titles,** five per badge. A test checks that none is a badge name and that all 30 are different.
- **What you pick is a badge,** or none. The server accepts only a catalog badge you have started right now.
- **The shown title is `{key, level}`.** It follows the level up and down, and hides at level 0 while the choice stays saved. Rosters, the profile head and the public profile all show it.
  - The old roster title carried a group name (Regular, Founder); titles no longer do.

### Screens
- **Picker:** lists "No title" and each started badge as its pill, with "Rally · level 1" underneath.
- **Badge sheet:** each level row reads, for example, "25 sessions · “Mainstay”".
- **New-level popup:**
  - It leads with the badge you show and says "Your title is now …".
  - Any other badge offers "Show “…” as my title".
  - There is no second interruption.

### Rollout and migration
- **Rollout tolerance:** the app reads any title that isn't a badge at level 1–5 as no title, so pages don't break between the app and the database shipping.
- **Release order:** as in P-19, ship the app first, then the migrations.
- **One-way migration** (owner: the app isn't launched, "we can change anything"):
  - old Rally-type ids, Regular and Off the Bench → `rally`;
  - New Faces / Mixer / Connector → `new-faces`;
  - Host / Seasoned Host → `host`;
  - Plus One and Full House → their own badges;
  - Founder → `host` only when Host is started, otherwise removed.
- **Removed:** `app.earned_badges` and the old-title domain code.

## Environment

- **Tools:** macOS worktree; Node 24.16.0, pnpm 12.15.0, Next.js 16.4.2, Prisma 7.10.1, Supabase CLI 2.121.0. No dependency changes.
- **Database:** the shared loopback synthetic Supabase services. Migrations `20261025100000_level_titles` and `20261025101000_level_title_fixes` were applied to it only.
- **App server:** this branch's Next dev server on `127.0.0.1:3002` (`RALLYPOINT_TEST_URL`).

## Migration rehearsal (shared local DB)

| | Before | After |
| --- | --- | --- |
| `app.user_titles` rows | 59: 54 Rally-type, 1 Host, 4 Founder | 55: 54 `rally`, 1 `host` |
| Founder rows with Host started | 0 | Founder rows removed |
| `app.earned_badges` | present | dropped (the separate `rallypoint` staging-schema copy is untouched) |

Sam (`member@`) had the old "Regular" title; after the migration their public profile shows "Rookie".

## Checks

| Check | Result |
| --- | --- |
| `node --test tests/badges-domain.test.mjs` (RED first, then GREEN) | 13/13. Covers the exact title table, no badge-name reuse, uniqueness, `rosterTitle` rejecting the old shape and bad levels, `isBadgeKey`, and the popup leading with the shown badge. |
| `tests/badges.test.mjs`, `tests/profiles.test.mjs` (RED first, then GREEN) | Pass. Covers refused before earning; refused for unknown, old and level ids; rosters for co-player and organizer; the public `{key, level}`; the title following level 9 → 10 and back; hiding at level 0 while the row stays; returning on re-earn; two simultaneous saves → 1 row; clear → no row; group creation giving no title. |
| Badge, profile, registration and domain suites after the review fixes | 55/55 |
| `pnpm db:lint` | No schema errors |
| `pnpm check` (lint, typecheck, build) | Pass |
| `pnpm test:api` (whole suite) | First run 361/363; final run 336/363. **Every failure is an email test**, in `email-outbox`, `email-dispatch`, `email-drain` and one email step in `profiles` ("a rename shows on the next email"). |

**Cause of the email failures:**
- The shared local outbox holds 500 live queued jobs from today's repeated runs, and nothing sends them locally.
- That is its ceiling, so new joins' emails are withheld and nothing can be claimed.
- This branch changes no email code or SQL.
- The outbox was not cleared, because the database is shared with other sessions.

### Browser
Viewport 375×812, `:3002`, synthetic "runner" account. The pane was hidden, so this was read from the DOM and text rather than screenshots:

- **New-level popup (shown badge):** "Host · Level 1 … Your title is now Organizer. +1 more", with no title button. It is gone after a reload.
- **Profile head:** "Organizer".
- **Picker, by keyboard:**
  - Enter opens it; ArrowUp and Enter save "Rookie".
  - Focus returns to "Choose title".
  - The options are No title, Rookie (Rally · level 1), Organizer (Host · level 1) and Crowd Puller (Full House · level 1).
- **Rally badge sheet:** the rows show Rookie through Rally Master.
- **Roster pill:** "Rookie".
- **Public profile:** shows the migrated title.
- **New-level popup (other badge):** Full House offers "Show “Crowd Puller” as my title", and it saves.

## Fresh review

A fresh reviewer read `29600b3..a1357d6` against the spec, the plan and the review focus.

- **Critical findings:** none.
- **All five focus behaviours** pass.
- **Grep:** no remaining use of `earned_badges` or the old-title code.
- **Email:** confirmed this branch changes no email code.

Fixed in `31a3663`, a follow-up migration, since the runner rejects edits to applied migrations:

- **Roster slowdown.** `visible_title` evaluated every badge even for people with no title, and rosters call it once per person. It now returns at once without a choice.
  - The behaviour is pinned by the existing title tests (55/55).
  - Measured: 300 lookups for people without a title went from 430 ms to 3–5 ms.
- **Recovery note.** The header note in `20261025100000` was cut off and named a stale restore file. The complete one-way recovery steps are now in `20261025101000`.

Deferred minor findings:
- Opening the picker while your chosen badge is at level 0 preselects "No title". Saving without a change then removes the hidden choice.
- Between the app shipping and the migration, choosing a badge gets the old "earn it first" 422. That's harmless and fits the release order.

## Gaps

- **Email tests:** the suite can't pass locally until the shared outbox is emptied. `pnpm db:reset` would do it, but it resets the database other sessions use.
- **Dark mode:** not visually re-checked this round (the pane was hidden). The pill styles are unchanged from P-19; the picker's second line uses the muted text token.
- **Not done:** no screen-reader run, no staging or production verification, nothing pushed or deployed.
