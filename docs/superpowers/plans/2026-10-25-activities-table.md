# Shared Activities Table Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move activities into one database catalog (defaults, per-plan limits, level descriptions, icon) that sessions, profiles and every screen read, replacing the hard-coded presets.

**Architecture:**

- **Catalog and links (SQL):** `app.activities`, `app.activity_limits` and `app.activity_levels` are served by `api.read_activities()`. Sessions get a trigger-maintained `activity_key`. Profiles move from `jsonb` to `app.profile_activities`.
- **Limit check (SQL):** enforced in the `api.save_session` wrapper, which already holds the row lock, against the stored details.
- **Pure rules (domain):** matching, default application and limit messages live in `@rallypoint/domain/activities`.
- **Screens:** the web reads the catalog through `GET /api/activities`.

**Tech Stack:**

- Postgres (Supabase local) SQL migrations recorded by the Prisma migrate runner (D-20).
- Hono API, plus `packages/database` with its RPC allowlist.
- Next.js and React, `@js-temporal/polyfill`, and `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-25-activities-table-design.md`

## Global Constraints

- **Plans:** only the `free` limits are read. `pro` rows exist but nothing selects them.
- **Free text stays valid.** A typed activity resolves to `general` for defaults, limits and level text, and its typed name is what displays.
- **Matching:** text matches an activity when `normalize(nfc) → collapse whitespace → lower-case` equals the activity's name or key, the same rule profiles use today. `general` is never matched by name.
- **Limits on edit:** a value is checked only when it changed against the stored, published session.
  - Spots count as changed when the number or the resolved activity changes.
  - Length counts as changed when the start or end changes.
  - Drafts are never limited.
  - A new session, or publishing a draft, checks everything.
- **Limit message copy:** "{Name} sessions can have {min} to {max} spots." and "{Name} sessions can run {min} to {max}." Durations read "30 minutes" or "4 hours" (whole hours as hours, otherwise minutes). `general` uses the name "These".
- **Seed values:** exactly the spec's table. `pro` maximums: spots ×2, and length 480.
- **Data access:** browsers have no table access; reads go through `api` functions, and every new function is added to `packages/database/src/functions.ts`.
- **Styling:** UI uses tokens only (`tests/design-tokens.test.mjs`). Icons are inline SVG with `currentColor`.
- **History:** existing sessions and profiles display exactly as before.

## Review Focus

- **An old session with 30 spots whose activity is now limited to 24.** Editing only its title must save. Pinned in Task 2 (`unchanged out-of-range spots still save`).
- **Switching sport on a published session** without touching spots, where the old spots exceed the new maximum, must be refused with the new sport's range. Pinned in Task 2.
- **A typed activity such as "Pottery"** must use `general` limits and show the typed name everywhere. Pinned in Tasks 2 and 4.
- **A profile with 3 typed and 2 listed activities and levels** must survive the migration unchanged. Pinned in Task 2's migration test.
- **The organizer edits spots, then switches sport.** Spots must stay as they typed them. Pinned in Task 1 (`touched field kept`).

---

### Task 1: Domain catalog rules

**Files:**

- Modify: `packages/domain/src/activities.ts`
- Modify: `packages/domain/src/profile.ts`: `normalizeProfile(input, catalog)`
- Tests:
  - create `tests/activities-domain.test.mjs`;
  - update `tests/profile-domain.test.mjs` call sites.

**Interfaces (produces):**

```ts
export interface ActivityLimits {
  minCapacity: number;
  maxCapacity: number;
  minDurationMinutes: number;
  maxDurationMinutes: number;
}
export interface Activity {
  key: string;
  name: string;
  icon: string;
  sortOrder: number;
  listed: boolean;
  defaults: {
    capacity: number;
    durationMinutes: number;
    guests: boolean;
    cutoffHours: number;
    opensDays: number | null;
  };
  limits: ActivityLimits; // the caller's plan (free)
  levels: Record<SkillLevel, string>; // one-line descriptions
}
export type DefaultedField =
  "capacity" | "guests" | "endLocal" | "openLocal" | "cutoffLocal";
export function activityName(text: string): string; // the normalized compare form
export function matchActivity(
  catalog: Activity[],
  text: string,
): Activity | null; // listed or not, never general
export function activityFor(catalog: Activity[], text: string): Activity; // match, else general
export function applyActivityDefaults(
  form: SessionForm,
  activity: Activity,
  touched: ReadonlySet<DefaultedField>,
  nowLocal: string,
): SessionForm;
export function limitProblem(
  activity: Activity,
  value: { capacity: number; durationMinutes: number | null },
  check: { capacity: boolean; duration: boolean },
): string | null;
```

- `SkillLevel` moves into `activities.ts`, and `profile.ts` re-exports it. This avoids a circular import, because `profile.ts` imports from `activities.ts`.
- Keep `presetActivities` and `presetFor` exported until Task 4 deletes them.

- [ ] **Step 1: Write the tests** in `tests/activities-domain.test.mjs`. Use a fixture catalog of `pickleball` (8, 4–24, 120 min, 30–240, guests, 24 h, opens null) and `general` (12, 2–50, 120, 15–480).
  - **`matching`:**
    - `activityFor(c, "  PICKLEBALL ")` gives key `pickleball`;
    - `"pottery"` gives `general`;
    - `matchActivity(c, "Other")` gives null, so `general` is never matched by name.
  - **`defaults fill spots and guests without a start`:** applying to a blank form sets capacity "8" and guests true, and leaves endLocal "".
  - **`times follow the start`:** with startLocal `2026-11-02T18:00` and nowLocal `2026-10-30T09:00`:
    - endLocal `2026-11-02T20:00`;
    - openLocal `2026-10-30T09:00` (null opensDays gives now);
    - cutoffLocal `2026-11-01T18:00`.
  - **`cutoff never before opening`:** with start `2026-10-30T20:00` and now `2026-10-30T09:00`, cutoffLocal is `2026-10-30T09:00`.
  - **`touched field kept`:** with touched `{capacity}` and form capacity "30", the result capacity stays "30" while guests updates.
  - **`limitProblem`:**
    - capacity 30 with check.capacity gives "Pickleball sessions can have 4 to 24 spots.";
    - with check.capacity false gives null;
    - duration 300 gives "Pickleball sessions can run 30 minutes to 4 hours.";
    - the edges 4/24 and 30/240 give null;
    - a `general` duration problem says "These sessions can run 15 minutes to 8 hours."
- [ ] **Step 2:** Run `node --test tests/activities-domain.test.mjs`. Expected: FAIL on the missing exports.
- [ ] **Step 3: Implement** the functions. Local times are wall-clock `YYYY-MM-DDTHH:mm`, so do the arithmetic with `Temporal.PlainDateTime`; no timezone is involved.
- [ ] **Step 4: Change `normalizeProfile(input, catalog: Activity[])`.** A listed match keeps the catalog spelling and doesn't count toward the 3-typed limit. Update `tests/profile-domain.test.mjs` to pass a fixture catalog, with the same expectations. Run both test files. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: activity catalog rules in the domain`

### Task 2: Migration, catalog read, limit enforcement and API

**Files:**

- Create: `supabase/migrations/20261025120000_activities.sql`
- Modify:
  - `packages/database/src/functions.ts`: add `read_activities: {}` and `read_activity: { p_key: "text" }`, if used.
  - Create `apps/api/src/activities.ts` (route), and mount it in `apps/api/src/index.ts`.
  - `apps/api/src/sessions.ts`: map limit errors.
  - `apps/api/src/profiles.ts`: pass the catalog to `normalizeProfile`.
- Tests:
  - create `tests/activities.test.mjs`;
  - update any `tests/profiles.test.mjs` SQL that reads `app.profiles.activities`.

**SQL contents:**

- **Tables** per the spec, with checks:
  - `min ≥ 1`;
  - `min ≤ default ≤ max` (on the `free` row, enforced by a deferred check or a function at seed time);
  - `pro ≥ free`.
- **Seeds:** activities, limits and levels.
- **`app.activity_key_for(p_text text) returns text`:** the normalized match against listed or unlisted, non-`general` names or keys, else null.
- **Sessions:**
  - `alter table app.sessions add column activity_key text references app.activities(key)`;
  - a BEFORE INSERT OR UPDATE OF details trigger sets it from `details->>'activity'`;
  - one backfill `update`.

  Find any existing triggers on `app.sessions` first and make sure the new one is independent of them.

- **Profiles:**
  - `app.profile_activities(user_id, position, activity_key null, custom_name null, level null)`, with a check that exactly one of key or custom name is set, PK `(user_id, position)`;
  - copy every `app.profiles.activities` entry (listed names → key, others → custom), keeping order and level;
  - then `alter table app.profiles drop column activities`;
  - `create or replace` `api.read_my_profile`, `api.save_my_profile` (same validation; custom = entries without a key; replaces the rows) and `api.read_profile` (copy the current body from `20261025100000_level_titles.sql`, changing only `activities`).
  - **Activities JSON:** `[{ name, level, key }]` in position order, where name is the catalog name or the custom name.
- **`api.read_activities() returns jsonb`:**
  - active activities plus `general`;
  - each shaped like `Activity` (camelCase), with `free` limits;
  - order: `sort_order`, then `general` last.
- **Limits:**
  - `app.assert_activity_limits(p_previous jsonb, p_next jsonb)` raises `sqlstate 'P0001'` with message `activity_capacity_limit` or `activity_duration_limit`, using the Global Constraints rules. `p_previous` is null for new sessions and draft→publish.
  - Call it from `api.save_session` (replace that wrapper) when `p_intent in ('publish','update')`, after the locked select, and only when no operation receipt exists for `p_key` (the same guard the wrapper uses for `session_closed`).
- **Grants:** revoke from public, anon and authenticated; grant to service_role.

**API:**

- **`GET /api/activities`:** public; `Cache-Control: public, max-age=300`; `{ activities: Activity[] }`.
- **`sessions.ts` `rpc()`:** on `activity_capacity_limit` or `activity_duration_limit`, the save route re-reads the catalog and throws `ApiError(422, code, limitProblem(...))`, using the submitted details. If the catalog read fails, fall back to "Check the spots and times for this activity."
- **`profiles.ts`:** load the catalog for `normalizeProfile`, and return a 503 if it can't load.

- [ ] **Step 1: Write `tests/activities.test.mjs`** (run against the local app, like `tests/sessions.test.mjs`, reusing its login/post helpers or a fixture):
  - **`catalog is public, ordered and cacheable`:** keys are `pickleball, badminton, tennis, basketball, general`; `cache-control` includes `max-age=300`; pickleball limits are 4–24.
  - **`out-of-range spots are refused on publish`:** Pickleball with 30 → 422, message "Pickleball sessions can have 4 to 24 spots."; 24 → 201/200.
  - **`unchanged out-of-range spots still save`:**
    - publish with 20;
    - with SQL, set `details = jsonb_set(details,'{capacity}','30')`;
    - an update changing only the title passes.
  - **`switching sport rechecks spots`:** a published Basketball with 30, updated to Tennis without touching spots → 422 with Tennis 2–16.
  - **`typed activity uses general`:** "Pottery" with 60 → 422 "These sessions can have 2 to 50 spots."; with 40 → ok; `activity_key` is null.
  - **`drafts are not limited`:** a draft with 999 saves.
  - **`profile activities keep order, levels and typed names`:** save Badminton (intermediate), "Pottery" (null) and "Chess" (beginner); read back the names, levels and keys `badminton`, null, null.
- **Migration copy (one-time check, recorded in the ledger, not an automated test):** before applying the migration, snapshot every local profile's `activities` JSON. After applying it, compare the snapshot with `api.read_my_profile` names and levels per user. Expect identical lists.
- [ ] **Step 2:** `pnpm db:start` (applies the migration), then start the app and run `node --test tests/activities.test.mjs`. Expected: FAIL before the API and SQL changes, or 404 on `/api/activities`.
- [ ] **Step 3: Implement** the SQL and API above.
- [ ] **Step 4:** `pnpm db:start`, then run `tests/activities.test.mjs`, `tests/profiles.test.mjs` and `tests/sessions.test.mjs`. Expected: PASS.
- [ ] **Step 5: Commit.** `feat: shared activities table with per-plan limits`

### Task 3: Icons and the catalog in the UI

**Files:**

- Create:
  - `packages/ui/src/components/activity-icon.tsx`, exporting `ActivityIcon({ icon, size })`;
  - `apps/web/src/use-activities.ts`, where `useActivities()` wraps `useApi<{activities: Activity[]}>("/api/activities", true)`.
- Modify:
  - `apps/web/src/activity-picker.tsx`: tiles from the catalog (listed only), using `ActivityIcon`; "Something else" unchanged.
  - `apps/web/src/session-pages.tsx` `Editor`:
    - track `touched: Set<DefaultedField>`;
    - for a new blank session only, after each activity or start change, set `form = applyActivityDefaults(form, activityFor(catalog, form.activity), touched, nowLocal)`, where `nowLocal` is `Temporal.Now.plainDateTimeISO(form.timeZone)` to the minute;
    - spots and length help text show the range;
    - an inline `limitProblem` message before submit.
  - The session page: an icon beside the activity in `SessionHead`.
  - `apps/web/src/profile-edit.tsx`: catalog instead of presets; under each level select, the activity's level description (`general` for typed).
  - The profile view in `apps/web/src/badges.tsx`: an icon beside each activity, using `key ? catalog icon : general`.
- Delete: `presetActivities` and `presetFor` from the domain (all callers now use the catalog).
- Styles: `apps/web/src/styles/pages.css`, tokens only.

- [ ] **Step 1: Implement.** Icons: five SVGs (pickleball paddle and ball, badminton shuttle, tennis ball, basketball, general "spark"), 24×24, 1.75 stroke, `currentColor`, `aria-hidden`. An unknown key renders general.
- [ ] **Step 2:** `pnpm check` and `node --test tests/design-tokens.test.mjs tests/activities-domain.test.mjs tests/profile-domain.test.mjs`. Expected: PASS.
- [ ] **Step 3: Commit.** `feat: activity icons and catalog-driven session and profile forms`

### Task 4: Records and end-to-end check

**Files:**

- `PRD.md`: a D-23 row covering the catalog, free text resolving to `general`, limits per plan with only `free` read, the limit rules on edits, and the link to the spec.
- `docs/superpowers/specs/...`: no change.

- [ ] **Step 1:** Add D-23.
- [ ] **Step 2:** Run `pnpm check`, then `pnpm test:api` against the running app (record the known email-outbox environmental failures if they recur).
- [ ] **Step 3: Browser check at 375 px, light and dark, as the organizer:**
  - New session: pick Pickleball and see 8 spots and guests on;
  - set a start and see the end at +2 h, the opening now and the cutoff −24 h;
  - change spots to 30 and see the range message;
  - switch to Tennis and see spots stay at 30 with the Tennis range;
  - type "Pottery" and see the general range;
  - on Edit profile, pick a level and see its description;
  - on the profile and session pages, see the icons.
- [ ] **Step 4: Commit.** `docs: record D-23 shared activities`
