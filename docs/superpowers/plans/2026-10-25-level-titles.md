# Level Titles Implementation Plan (WDL-405)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A person shows one badge as their title, and the title reads that badge's current level title ("Mainstay"), which replaces the old badge-name titles.

**Architecture:**
- **Domain catalog:** each badge carries its five level titles.
- **Database:** `app.user_titles.badge_id` stores the chosen badge key. `app.visible_title` returns `{key, level}` while that badge is started, so rosters, which already embed it, pick up the new shape without changes.
- **Old titles:** a one-way migration maps the old choices to badges, then drops the old-badge evaluation and the old-title domain code.

**Tech Stack:** TypeScript domain package, Hono API, Supabase Postgres migrations (applied by Prisma `pnpm db:start`), Next.js App Router, `node --test`.

**Spec:** [docs/superpowers/specs/2026-10-25-level-titles-design.md](../specs/2026-10-25-level-titles-design.md) (owner direction 2026-10-25).

## Global Constraints

**The 30 level titles, levels 1–5, exactly as written:**
- rally: Rookie, Regular, Mainstay, Veteran, Rally Master
- steady: Returner, Familiar Face, Fixture, Year-Rounder, Lifer
- new-faces: Friendly Face, Mixer, Connector, Social Butterfly, Super Connector
- plus-one: Good Company, Recruiter, Talent Scout, Ambassador, Grand Ambassador
- host: Organizer, Game Runner, Ringleader, Club Captain, Community Pillar
- full-house: Crowd Puller, Crowd Favourite, Headliner, Sell-Out Star, Main Event

**Title data and rules**
- A title in data is `{ key: BadgeKey, level: 1–5 }`, everywhere: `read_my_badges.title`, roster `title` and public `title`. Nothing else is attached.
- Only a started badge (level ≥ 1, right now) can be chosen. `null` clears the choice. Error codes stay `title_not_earned` and `invalid_title`.

**Migration mapping (one-way)**
- Old choices move as follows:
  - `first-rally`, `sessions-*`, `regular:*`, `off-the-bench` → `rally`
  - `new-faces-*` → `new-faces`
  - `host`, `hosted-10` → `host`
  - `plus-one` → `plus-one`
  - `full-house` → `full-house`
  - `founder:*` → `host` if the person's Host level is at least 1, otherwise the row is deleted
- Recovery steps go in the header.
- Migration file: `supabase/migrations/20261025100000_level_titles.sql`.

**Copy and display**
- Sheet copy: "Your title is now {title}." and the button `Show “{title}” as my title`.
- Picker secondary line: `{Badge name} · level {n}`.
- Level list row: `Level {n} · {target} · {title}`.
- The web treats an unrecognised title (an unknown key or bad level) as no title.

## Review Focus

1. A roster title from the old shape (`{key:"first-rally",groupName:null}`) during rollout renders no pill and doesn't throw. Test in Task 1 (`rosterTitle`).
2. A correction drops the shown badge's level: the roster title follows it down, and disappears at level 0 while the choice row stays. Test in Task 2.
3. Choosing a badge at level 0, an unknown key, an old id (`sessions-25`) or another person's state through a direct request is refused. Test in Task 2.
4. When the shown badge and another badge level up together, the sheet leads with the shown badge. Test in Task 1 (`newestUnseen` with `prefer`).
5. Saving the same title twice, or at the same time, leaves one row. Test in Task 2.

---

### Task 1: Domain level titles, tolerant title reading, sheet preference

**Files:**
- Modify: `packages/domain/src/badges.ts`. Add `titles` to `BadgeDefinition`, then remove `LegacyBadgeKey`, `legacyTitles`, `parseTitleId`, `titleForLevel`, `TitleOption`, `titleOptions` and the old `titleLabel`.
- Modify: `apps/api/src/badges.ts`. The title body is `{ badgeId: BadgeKey | null }`, validated against the catalog.
- Modify: `packages/domain/src/profile.ts`. `PublicProfile.title: { key: string; level: number } | null`.
- Test: `tests/badges-domain.test.mjs`

**Interfaces (Produces):**
- `BadgeDefinition.titles: readonly [string, string, string, string, string]`
- `RosterTitle { key: BadgeKey; level: Level }`
- `levelTitle(key: BadgeKey, level: Level): string`
- `rosterTitle(value: unknown): RosterTitle | null`: accepts only a catalog key with an integer level of 1–5; everything else gives `null`.
- `BadgesView { badges: BadgeState[]; title: RosterTitle | null; stats }`, with `titles` removed.
- `newestUnseen(badges, prefer?: BadgeKey | null)`: when `prefer` has an unseen level, return it (`more` counts the others); otherwise behave as today.
- `isBadgeKey(value: unknown): value is BadgeKey`

- [ ] **Step 1: Write failing tests.**
  - **Exact table:** `badgeCatalog.map(b => [b.key, b.titles])` equals the Global Constraints table.
  - **Distinct names:** no title equals any badge `name`, compared case-insensitively.
  - **Unique:** all 30 titles are different.
  - **`levelTitle`:** `levelTitle("rally",5)` = "Rally Master" and `levelTitle("host",3)` = "Ringleader".
  - **`rosterTitle`:** `rosterTitle({key:"rally",level:3})` → `{key:"rally",level:3}`. Each of these gives `null`: `{key:"first-rally",groupName:null}`, `{key:"rally",level:0}`, `{key:"rally",level:6}`, `{key:"rally",level:"3"}`, `{key:"rally"}`, `null`, `"rally"`.
  - **`newestUnseen` prefer:** rally level 2 unseen and earlier, host level 1 unseen and newer, with `prefer` "rally" → `{key:"rally",level:2,more:1}`. Without `prefer` → host. With `prefer` "steady" (no unseen) → host.
  - **`isBadgeKey`:** `isBadgeKey("rally")` is true; `isBadgeKey("sessions-25")` and `isBadgeKey("rally:1")` are false.
  - **Old-title tests:** remove the legacy-title tests.
- [ ] **Step 2: Run** `node --test tests/badges-domain.test.mjs`. Expected: FAIL (missing exports).
- [ ] **Step 3: Implement** to the interfaces. `badgeStates` stays.
- [ ] **Step 4: Run** the same command. Expected: PASS.
- [ ] **Step 5: Commit** `feat: level titles in the badge catalog`.

### Task 2: Migration and API behaviour

**Files:**
- Create: `supabase/migrations/20261025100000_level_titles.sql`
- Modify: `tests/badges.test.mjs` (title tests), `tests/profiles.test.mjs` (the public title becomes `{key, level}` and the setup uses `host` via check-in or `rally`), `tests/registrations.test.mjs` only if the shape assertion needs it.

**Interfaces:**
- `app.visible_title(p_user)` → `{key, level}` or null.
- `api.set_my_title(p_actor_id, p_badge_id text)`:
  - `null` deletes the row;
  - a catalog key with level ≥ 1 upserts it (`on conflict(user_id)` update);
  - anything else raises `title_not_earned`.
- `api.read_my_badges`: `title` = `app.visible_title(p_actor_id)`, and the `titles` key is gone.
- `api.read_profile`: `title` = `app.visible_title(p.user_id)`.
- `drop function app.earned_badges(uuid)`.

- [ ] **Step 1: Write failing API tests.** Rewrite the two title tests in `tests/badges.test.mjs`:
  - **Choosing:**
    - `"rally"` before any check-in → 422 `title_not_earned`.
    - `"sessions-25"`, `"rally:1"`, `5` and `"nope"` → 422 `invalid_title`.
    - `"rally"` after a check-in → 200, `title` `{key:"rally",level:1}`.
  - **Rosters:** for a co-player and the organizer, the roster `title` is `{key:"rally",level:1}`, and `null` for someone without one.
  - **Levels change:**
    - The 10th check-in makes the title `{key:"rally",level:2}` with no new save.
    - Unchecking it brings back level 1.
    - Unchecking the only check-in gives `title` null and a roster title of null, while the `user_titles` row still exists.
    - Re-checking brings back `{key:"rally",level:1}`.
  - **Saving twice:** two simultaneous saves of `"rally"` → both 200, and one row.
  - **Clearing:** `null` → 200, `title` null, and no row.
  - **Old ids gone:** a founder-only account (a new group) can't choose `"host"` (422 `title_not_earned`), and there is no `titles` key in the response.
  - **Public profile:** in `profiles.test.mjs`, the public title is `{key:"rally",level:1}`, with its setup using a check-in instead of Founder.
- [ ] **Step 2: Run** `RALLYPOINT_TEST_URL=http://127.0.0.1:3002 node --test tests/badges.test.mjs tests/profiles.test.mjs`. Expected: FAIL (old title behaviour).
- [ ] **Step 3: Snapshot before migrating.** Record the counts of `app.user_titles` grouped by mapped badge key (a select-only `case` over `badge_id`) and the founder rows with and without Host started.
- [ ] **Step 4: Write the migration.**
  - Map with one `update … set badge_id = case …`, then delete the founder rows whose Host is not started.
  - Replace `visible_title`, `set_my_title`, `read_my_badges` and `read_profile`.
  - Drop `app.earned_badges`.
  - Keep the revoke/grant lines.
  - Add the one-way recovery header from the spec.
  - Apply it with `pnpm db:start`, then run `pnpm db:lint`.
- [ ] **Step 5: Rehearsal check.**
  - Every remaining `user_titles.badge_id` is a catalog key.
  - The counts match the snapshot mapping.
  - Founder rows without Host are gone.
- [ ] **Step 6: Run** the Step 2 command. Expected: PASS.
- [ ] **Step 7: Commit** `feat: titles follow the chosen badge's level`.

### Task 3: Web

**Files:** `apps/web/src/badges.tsx`, `apps/web/src/styles/badges.css`

- [ ] **Step 1:** `TitlePill({ title: unknown })` reads through `rosterTitle`: it renders nothing for `null`, and otherwise an 18px decorative medallion followed by `levelTitle`. The roster call sites keep passing `p.title`.
- [ ] **Step 2: Picker.** Options are "No title" plus each started badge (catalog order). Each one shows its pill and the line `{name} · level {n}`. The value is the badge key; saving posts `{ badgeId }`. "Choose title" shows only when at least one badge is started.
- [ ] **Step 3: Earned sheet.**
  - Use `newestUnseen(badges, view.title?.key)`.
  - If the moment's key is the shown title's key, show "Your title is now {levelTitle}." and no title button.
  - Otherwise show the button `Show “{levelTitle}” as my title`, which posts `{ badgeId: key }`.
- [ ] **Step 4: Level list.** Each row reads `Level n` / `{target}` / `{levelTitle}`.
- [ ] **Step 5: Run** `pnpm check`. Expected: pass.
- [ ] **Step 6: Browser check at 375×812** on `:3002`, in light and dark:
  - picker choose and clear;
  - the pill on the profile and the roster;
  - level-list titles;
  - the earned sheet's line or button;
  - keyboard through the picker.
- [ ] **Step 7: Commit** `feat: choose a badge as your title`.

### Task 4: Records, checks and review

- [ ] **Step 1:** Add a WDL-405 note to the PRD D-16 row: the accepted title table, the behaviour and the one-way migration.
- [ ] **Step 2: Run** `pnpm check`, `pnpm db:lint` and `pnpm test:api`. Expected: all pass.
- [ ] **Step 3:** One fresh reviewer reads the whole branch. Fix the confirmed Critical and Important findings test-first.
- [ ] **Step 4:** Write `docs/superpowers/reviews/2026-10-25-level-titles-validation.md` in the P-19 format, then commit.
