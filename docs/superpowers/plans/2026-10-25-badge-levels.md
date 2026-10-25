# Badges With Shared Levels Implementation Plan (P-19 / WDL-394)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the 15 one-off badges with six badges of five shared levels each, while keeping today's titles working exactly as they are.

**Architecture:**
- **Database.** Levels are derived on read in SQL from the same trusted check-in, guest and hosting records as today. One function lists every counted item with its ordinal. A thresholds function turns ordinals into earned levels, and `badge_views` stores `key:level` seen markers.
- **Titles.** The old `app.earned_badges` stays, used only for titles: picker, roster and public title.
- **Web.** The web app draws one medallion per badge, coloured by level, with a numeral chip.

**Tech Stack:** TypeScript domain package, Hono API, Supabase Postgres migrations (applied by Prisma `pnpm db:start`), Next.js App Router web app, `node --test`.

**Spec:** [docs/superpowers/specs/2026-10-25-badge-levels-design.md](../specs/2026-10-25-badge-levels-design.md) (owner-approved 2026-10-25).

## Global Constraints

**Catalog and IDs**
- Catalog order and IDs: `rally`, `steady`, `new-faces`, `plus-one`, `host`, `full-house`.
- Thresholds (levels 1–5):
  - rally 1, 10, 25, 50, 100
  - steady 2, 3, 6, 12, 24
  - new-faces 5, 10, 25, 50, 100
  - plus-one 1, 3, 5, 10, 20
  - host 1, 5, 10, 25, 50
  - full-house 1, 3, 10, 25, 50
- New seen IDs are `key:level`, for example `rally:3`. Old IDs (`first-rally`, `founder:<uuid>` …) stay valid only for titles.

**Medallion and level display**
- Level colours: 1 sky, 2 teal, 3 violet, 4 coral, 5 gold. The same level is the same colour on every badge.
- Level marker: a numeral chip at size ≥ 32px, and no chip below 32px.
- Rim: heavier at level ≥ 3, doubled at level 5. No crowns, wings, flames or stars.
- Contrast: the white glyph is ≥ 3:1 against the gradient's midpoint, and the chip numeral is ≥ 4.5:1 against the chip.
- Screen-reader labels: "Rally, level 3 of 5" and "Rally, not started".
- Shelf labels: "Level n", "Complete" at level 5, "Not started" below level 1.
- "Started" means level ≥ 1.
- Copy is fixed by the spec's "Per-level wording" table.

**Old-badge mapping (titles and the sheet's title button)**
- rally levels 1–5 map to `first-rally`, `sessions-10`, `sessions-25`, `sessions-50`, `sessions-100`.
- new-faces levels 2–4 map to `new-faces-10`, `new-faces-25`, `new-faces-50`.
- host level 1 maps to `host`, and level 3 to `hosted-10`.
- plus-one level 1 maps to `plus-one`.
- full-house level 1 maps to `full-house`.
- `regular`, `off-the-bench` and `founder` are retired: a title pill shows their name with no medallion.

**Data rules**
- Public profile badges are `{ key, level }` only, for started badges, in catalog order. The stat row is unchanged.
- No new tables. Migration `supabase/migrations/20261025090000_badge_levels.sql`. Every function stays `service_role`-only.
- Release-day backfill: every level each user already has is inserted into `app.badge_views`.

## Review Focus

1. A Steady month crossing midnight in the session's zone: `startsAt` `2026-01-31T16:30:00Z` with `Asia/Manila` counts as February. An unknown zone counts in UTC and doesn't fail the read. Test in Task 2.
2. A level lost to a correction and earned again comes back already seen (no second sheet). Test in Task 2.
3. Two simultaneous "mark seen" posts for the same IDs both succeed and store one row. Test in Task 2.
4. A host who checks themselves in gets Rally and Host credit. A guest adds Plus One but no Rally. Test in Task 2.
5. An old title of a retired badge (`founder:<group>`) still saves, shows on rosters and on the public profile, and doesn't appear as a shelf badge. Tests in Task 2 (API) and Task 3 (pill without medallion).

---

### Task 1: Domain catalog, levels and old-title mapping

**Files:**
- Modify (rewrite): `packages/domain/src/badges.ts`
- Modify: `packages/domain/src/profile.ts` (`PublicProfile.badges: Array<{ key: string; level: number }>`)
- Modify (rewrite): `tests/badges-domain.test.mjs`
- Modify: `apps/api/src/badges.ts` (seen IDs via `parseLevelId`, titles via `parseTitleId`)

**Interfaces (Produces):**
- **Types**
  - `BadgeKey = "rally" | "steady" | "new-faces" | "plus-one" | "host" | "full-house"`
  - `Level = 1 | 2 | 3 | 4 | 5`
  - `BadgeGlyph = "rally" | "calendar" | "faces" | "plus" | "host" | "full"`
  - `BadgeDefinition { key; name; family: "playing" | "people" | "hosting"; glyph; thresholds: readonly [number, number, number, number, number] }`
- **Catalog and colours:** `badgeCatalog: readonly BadgeDefinition[]` (6, in catalog order); `badgeDefinition(key)`; `levelColors: readonly (readonly [string, string])[]` (index 0 = level 1, light stop first).
- **Response shape**
  - `BadgeState { key: BadgeKey; current: number; levels: { level: Level; earnedAt: string; seen: boolean }[] }`
  - `BadgesView { badges: BadgeState[]; titles: TitleOption[]; title: (RosterTitle & { id: string }) | null; stats: { played; hosted; groups } }`
- **Level helpers**
  - `levelOf(state: BadgeState): 0 | Level`: the highest earned level.
  - `nextTarget(key, current): number | null`
  - `levelId(key, level): string`
  - `parseLevelId(id): { key; level } | null`: accepts only `^<catalog key>:[1-5]$`.
- **Popup and nudge**
  - `newestUnseen(badges): { key; level; earnedAt; more } | null`: the highest unseen level per badge; the newest `earnedAt` wins, ties go to catalog order; `more` = other badges with unseen levels.
  - `unseenIds(badges): string[]`
  - `nextBadge(badges): { key; level: 0 | Level; current; target } | null`: `current > 0` and a next target exists; sorted by `current/target` descending, then fewest left, then catalog order.
- **Copy**
  - `levelSentence(key, level): string`
  - `progressLabel(key, left): string`
  - `levelLabel(level: 0 | Level): string`: "Not started" / "Level n" / "Complete".
  - `medallionLabel(key, level): string`
- **Old titles**
  - `LegacyBadgeKey`: the 15 old keys.
  - `RosterTitle { key: LegacyBadgeKey; groupName: string | null }`
  - `TitleOption = RosterTitle & { id: string; groupId: string | null }`
  - `legacyTitles: Record<LegacyBadgeKey, { name: string; perGroup: boolean; shows: { key: BadgeKey; level: Level } | null }>`
  - `parseTitleId(id)`: today's `parseBadgeId` behaviour, renamed.
  - `titleLabel(title: RosterTitle)`: the old name, plus ` · group` when there is one.
  - `titleForLevel(key, level): LegacyBadgeKey | null`

- [ ] **Step 1: Write the failing domain tests** in `tests/badges-domain.test.mjs`:
  - **Catalog:** 6 unique keys and unique glyphs in catalog order; each thresholds array has 5 strictly ascending values equal to the Global Constraints values.
  - **Level IDs:** `parseLevelId("rally:3")` → `{key:"rally",level:3}`. Each of these → `null`: `rally:0`, `rally:6`, `rally`, `Rally:1`, `first-rally`, `regular:<uuid>`, `rally:1:x`, `""`.
  - **Title IDs:** `parseTitleId` keeps the old cases (move today's `parseBadgeId` assertions over unchanged).
  - **Levels:** `levelOf` gives 0 with no levels and 3 with levels 1–3. `nextTarget("rally", 9)` → 10, `("rally", 10)` → 25, `("rally", 100)` → null, `("steady", 0)` → 2.
  - **Popup:** with rally levels 1–3 unseen at the same time and host level 1 unseen earlier, `newestUnseen` → `{key:"rally",level:3,more:1}`; all seen → `null`. `unseenIds` → `["rally:1","rally:2","rally:3","host:1"]`.
  - **Nudge:** rally 9/10 beats new-faces 3/5. A badge at 100 (complete) or 0 is never returned.
  - **Copy:**
    - `levelSentence("rally",1)` = "Your first session, checked in."
    - `levelSentence("rally",3)` = "25 sessions, checked in."
    - `levelSentence("steady",4)` = "Played in 12 different months."
    - `progressLabel("new-faces",1)` = "1 more new person"
    - `progressLabel("full-house",2)` = "2 more full sessions to run"
    - `levelLabel(5)` = "Complete"
    - `medallionLabel("rally",3)` = "Rally, level 3 of 5"
    - `medallionLabel("rally",0)` = "Rally, not started"
  - **Old titles:**
    - `titleLabel({key:"regular",groupName:"Sunday Dink"})` = "Regular · Sunday Dink"
    - `titleForLevel("rally",3)` = "sessions-25"; `titleForLevel("steady",1)` = null
    - `legacyTitles.founder.shows` = null; `legacyTitles["hosted-10"].shows` = `{key:"host",level:3}`
  - **Contrast:** using a small WCAG relative-luminance helper in the test, for each `levelColors` entry the white text against the midpoint mix of the two stops is ≥ 3, and the dark stop against white is ≥ 4.5.
- [ ] **Step 2: Run** `node --test tests/badges-domain.test.mjs`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** `packages/domain/src/badges.ts` to the interfaces above. Start `levelColors` from sky `#5CCBFF→#2459E6`, teal `#4FE0C8→#0E8F8A`, violet `#C08BFF→#7A2BD6`, coral `#FF9A7A→#E2483A` and gold `#FFD15A→#D96A0C`, then darken the stops until the contrast test passes. Keep the file header comment's D-16 sentence about what is never read. In `apps/api/src/badges.ts`, validate seen IDs with `parseLevelId` and titles with `parseTitleId`, and keep the error codes and messages.
- [ ] **Step 4: Run** `node --test tests/badges-domain.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit** `feat: badge catalog with shared levels and old-title mapping`.

### Task 2: SQL levels, seen markers, public badges and backfill

**Files:**
- Create: `supabase/migrations/20261025090000_badge_levels.sql`
- Modify (rewrite): `tests/badges.test.mjs` (keep its helpers: `fresh`, `cohost`, `event`, `join`, `mark`, `unlocked`, `sql`)
- Modify: `tests/profiles.test.mjs:220-226` (public badges are `{key, level}` in catalog order; `founder` is not among them; the title stays `{key:"founder"}`)
- Modify: `tests/badges-domain.test.mjs`: one test reads the migration text and checks that the `badge_thresholds` values equal `badgeCatalog` thresholds.

**Interfaces:**
- **Consumes:** Task 1's IDs and thresholds.
- **SQL helpers**
  - `app.badge_zone(text) returns text`: plpgsql; returns the zone if `now() at time zone z` succeeds, otherwise `'UTC'`.
  - `app.badge_thresholds() returns table(badge text, level integer, target integer)`: immutable `values` rows.
  - `app.badge_items(p_user uuid) returns table(badge text, n bigint, at timestamptz)`: one row per counted item with its ordinal:
    - **rally:** `app.badge_sessions`.
    - **steady:** distinct `to_char(startsAt at time zone app.badge_zone(timeZone),'YYYY-MM')`, ordered by month; `at` = the month's earliest check-in.
    - **new-faces:** `app.badge_met`.
    - **plus-one:** distinct sessions where seat 2 of the user's confirmed party is checked in at a non-cancelled session.
    - **host:** `app.badge_hosted`.
    - **full-house:** `app.badge_hosted` where `full_house`.
  - `app.badge_levels(p_user) returns table(badge text, level integer, earned_at timestamptz)`: `badge_items` joined to `badge_thresholds` on `n = target`.
- **API functions (replaced)**
  - `api.read_my_badges(p_actor_id)` returns `{badges:[{key,current,levels:[{level,earnedAt,seen}]}] (all 6, catalog order), titles:[{id,key,groupId,groupName}] (from app.earned_badges), title, stats}`.
  - `api.mark_badges_seen` inserts only `badge||':'||level` from `app.badge_levels`.
  - `api.read_profile`: `badges` = `[{key, level: max}]` from `app.badge_levels`, catalog order.
- **Unchanged and dropped:** `app.earned_badges`, `app.visible_title` and `api.set_my_title` stay unchanged; `app.badge_progress` is dropped.

- [ ] **Step 1: Rehearsal snapshot (before the migration exists).** Record into the scratchpad, from the shared local DB:
  - the number of users with any `app.earned_badges` rows;
  - three sample users with their old earned IDs and seen IDs.
- [ ] **Step 2: Write the failing API tests** in `tests/badges.test.mjs`. Keep today's sign-in/405 test and the input-refusal cases for `/seen` and `/title`; add `rally:0`, `"first-rally"` and an ID over 80 characters to the refused seen IDs. Then:
  - **First check-in:** rally `current` 1, levels `[{level:1,seen:false}]`; every other badge `current` 0 with no levels; posting `["rally:1"]` makes it seen.
  - **Level boundary:** 9 check-ins → rally level 1, `current` 9. The 10th → level 2 unseen. Unchecking the 10th → level 1. Checking it again → level 2 with `seen` as it was before the uncheck, so after marking it seen, it is still seen.
  - **Guest:** seat 2 checked in gives plus-one level 1, with rally `current` 0 and `stats.played` 0.
  - **People met:** 5 other accounts plus 1 guest checked in at one session give new-faces level 1 for each account, with `current` 5. The guest doesn't count.
  - **Self-hosting:** a co-host checks in themselves and one other person at capacity 2: host level 1, full-house level 1 and rally level 1 for the co-host.
  - **Steady:** two sessions, `startsAt` `2026-01-15T10:00:00Z` and `2026-01-31T16:30:00Z`, both `Asia/Manila`, give steady `current` 2 and level 1 (January and February). Changing the second to `UTC` gives `current` 1. A zone `Nowhere/Bogus` still returns 200 and counts in UTC.
  - **No-shows, waiting and cancelled:** no-shows and waiting players get all `current` 0. Cancelling the session removes the level.
  - **Seen markers:** posting `["host:5"]` (not earned) stores nothing. Two simultaneous posts of `["rally:1"]` both return 200, with exactly 1 `badge_views` row.
  - **Titles:**
    - `"first-rally"` saves while earned and shows on the roster as `{key:"first-rally",groupName:null}`.
    - `"host"` is refused with `title_not_earned` before hosting.
    - `founder:<group>` saves after creating a group. `titles` lists it, and no shelf badge is named founder.
    - A correction clears `first-rally` from the title and the roster.
  - **Denied writes:** an `anon`-key `rpc("mark_badges_seen")` and `rpc("read_my_badges")` are refused.
- [ ] **Step 3: Run** `RALLYPOINT_TEST_URL=http://127.0.0.1:3002 node --test tests/badges.test.mjs` with this branch's app on port 3002. Expected: FAIL (old response shape).
- [ ] **Step 4: Write the migration.**
  - Create the five functions and replace the three API functions, following the existing `stable security invoker set search_path=''` pattern and the revoke/grant lines.
  - `drop function app.badge_progress(uuid)`.
  - Backfill: `insert into app.badge_views(user_id,badge_id) select u.id,l.badge||':'||l.level from auth.users u cross join lateral app.badge_levels(u.id) l on conflict do nothing`.
  - A header comment gives recovery: restore the previous `read_my_badges`, `mark_badges_seen` and `read_profile` bodies from `20261022170000_badges.sql` and `20261024100000_profile_fixes.sql`, restore `badge_progress`, and `delete from app.badge_views where badge_id ~ '^[a-z-]+:[1-5]$'`.
  - Apply with `pnpm db:start`, then run `pnpm db:lint`.
- [ ] **Step 5: Rehearsal check.** For the snapshot users, every current `app.badge_levels` row is in `badge_views`, and their old seen rows and titles are untouched. The user count matches. Record the result for the evidence file.
- [ ] **Step 6: Run** the badge, profile and domain tests. Expected: PASS.
- [ ] **Step 7: Commit** `feat: derive badge levels in SQL and mark existing levels seen`.

### Task 3: Medallion, shelf, details sheet, popup, nudge and title pill

**Files:**
- Modify: `apps/web/src/badges.tsx`
- Modify: `apps/web/src/styles/badges.css`
- Modify (only if types require it): `apps/web/src/screens.tsx`

**Interfaces:**
- **Consumes:** Task 1's exports.
- **Produces:**
  - `Medallion({ badge: BadgeKey; level: 0 | Level; size: number; decorative?: boolean })`
  - `TitlePill({ title: RosterTitle })`
  - `BadgeDetails` (internal sheet)

**Steps:**
- [ ] **Step 1: Medallion.**
  - Level 0 is today's dashed outline.
  - Levels 1–5 use the `levelColors[level-1]` gradient, a white glyph, and today's inner ring at stroke 1.6, or 2.6 at levels ≥ 3. Level 5 adds a second ring at r 43.
  - At `size >= 32`, a chip circle (r 13 at 76,76): white fill, a stroke in the level's dark stop, and the numeral in the dark stop.
  - `aria-label` = `medallionLabel`.
  - The `calendar` glyph is today's `regular` drawing.
- [ ] **Step 2: Shelf.**
  - **Owner view:** all six badges as `<button>` items: medallion, name and `levelLabel`. Each opens a `Sheet` titled with the badge name. The sheet lists the five levels (`Level n · {target} {unit}`), ticks earned ones with a localized date, and then shows:
    - `"{left} more … to level {n}"` from `progressLabel` while unfinished;
    - "Your first session earns level 1"-style text (using that badge's level 1 sentence) when `current` is 0;
    - "Complete" at level 5.
  - **Public view:** started badges only, as plain items with "Level n". The title picker lists `view.titles`.
- [ ] **Step 3: Earned sheet.**
  - The heading is `"{name} · Level {n}"` and the line is `levelSentence`.
  - "+N more on your profile" uses `more`. Closing posts `unseenIds(view.badges).slice(0,50)`.
  - "Show as my title" shows only when `titleForLevel(key, level)` is among `view.titles` IDs, and posts that ID.
- [ ] **Step 4: Nudge and pill.**
  - **Nudge:** `NextBadge` uses `nextBadge`: a ring around a 26px medallion at the current level, the name, and `progressLabel`.
  - **Pill:** `TitlePill` renders `legacyTitles[key].shows` as an 18px decorative medallion, or no medallion for retired keys, followed by `titleLabel`.
  - **Public profile:** `PersonProfilePage` maps `{key, level}` through the catalog, and accepts a title only when its key is in `legacyTitles`.
- [ ] **Step 5: Run** `pnpm check`. Expected: lint, typecheck and build pass.
- [ ] **Step 6: Browser check at 375×812** on `http://127.0.0.1:3002`, in light and dark modes, with a synthetic account that has mixed levels:
  - the shelf with six items at three per row;
  - the details sheet: keyboard open/close and focus return;
  - the earned sheet shown once and gone after reload;
  - the Home nudge;
  - a roster title pill for a mapped title and for `founder`;
  - the public profile;
  - reduced motion, emulated by checking the computed `animation-name` of `.earned-badge__halo .medallion` under `prefers-reduced-motion: reduce` media emulation where available.

  Record what was and wasn't checked.
- [ ] **Step 7: Commit** `feat: show one medallion per badge with its level`.

### Task 4: Records, full checks and review

**Files:**
- Modify: `PRD.md` (D-16 row: P-19 accepted catalog and levels, with a link to the spec; RP-15 implementation note)
- Create: `docs/superpowers/reviews/2026-10-25-badge-levels-validation.md`

- [ ] **Step 1:** Update the PRD D-16 row and RP-15 note: the six badges, five shared levels, retired three, titles unchanged until WDL-405, and parked WDL-406/WDL-407. Mark this as implementation, not acceptance.
- [ ] **Step 2: Run** `pnpm check`, `pnpm db:lint` and `RALLYPOINT_TEST_URL=http://127.0.0.1:3002 pnpm test:api`. Expected: all pass. Record any unrelated failure verbatim.
- [ ] **Step 3:** Dispatch one fresh reviewer over `git diff origin/main...HEAD` with the spec. Fix the confirmed findings test-first and re-run the affected checks.
- [ ] **Step 4:** Write the validation file in the P-17 format: environment, date, commands and results, rehearsal, browser coverage, review findings and fixes, gaps, and a user note. Commit `docs: record P-19 validation`.
