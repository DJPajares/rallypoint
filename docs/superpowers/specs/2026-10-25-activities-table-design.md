# Shared activities table — design (WDL-409 / P-31)

Date: 2026-10-25. Status: draft for owner review.

## Why

Activities are scattered today:

- a hard-coded list of four (`presetActivities` in `packages/domain/src/activities.ts`);
- free text on each session;
- a `jsonb` array on `app.profiles.activities`.

Every sport gets the same session defaults (12 spots, and blank times the organizer fills in), so organizers retype the same things. Nothing checks that a value makes sense for the sport.

The owner wants one shared source that every part of the app reads, and that carries for each activity:

- the defaults pre-filled when an organizer picks it;
- the minimum and maximum values the form and the API allow;
- its icon;
- the details other screens need, such as self-rating descriptions for profiles.

## Goals

1. **One catalog of activities in the database.** It is served by the API and read by the session editor, Edit profile, public profiles and the session page.
2. **Defaults pre-filled** when an organizer picks an activity in New session:
   - spots;
   - session length;
   - guests on or off;
   - cancellation cutoff;
   - when registration opens.
3. **Limits** on spots and session length, per activity and per plan. The form shows them as the allowed range and the API enforces them.
4. **Free text stays allowed** (owner, 2026-10-25). A typed activity that isn't in the list uses a common `general` row for its defaults, limits and level descriptions.
5. **Per-activity self-rating descriptions** (beginner, intermediate, advanced), for profiles and the WDL-410 redesign.
6. **One custom SVG icon per activity**, drawn in the brand palette and working in light and dark mode.

## Non-goals

- **Plan tiers.** Everyone is treated as `free` (owner, 2026-10-25). The table stores `pro` limits so plans can arrive later without a schema change. Nothing selects or sells a plan.
- An admin screen for editing activities. Rows change through reviewed migrations or SQL.
- Discovery or filtering by activity (excluded from the MVP).
- The Edit profile redesign itself (WDL-410). This work only gives it the data and keeps today's editor working.
- Photos or illustrations for activities. Icons only, for now.

## Anti-goals

- **Breaking history.** An existing session or profile must show exactly what it showed before. That includes sessions saved with typed activities, and sessions whose values now fall outside a new limit.
- **Blocking edits of old sessions.** Limits apply to what an organizer is changing now. An unchanged value outside the range must not stop them saving something else.
- **Hard-coded per-sport numbers in components.** Numbers live in the table only.

## Data model

All tables are in the `app` schema. Browsers get no table access; reads go through `api` schema functions, the same rule as `app.profiles`.

### `app.activities`

One row per activity, plus `general`.

| Column                         | Meaning                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `key` text PK                  | Stable slug: `pickleball`, `badminton`, `tennis`, `basketball`, `general`                                                             |
| `name` text                    | Display name                                                                                                                          |
| `icon` text                    | Icon key the UI maps to an SVG                                                                                                        |
| `sort_order` int               | Order in pickers                                                                                                                      |
| `active` bool                  | Inactive rows are hidden from new choices but still display for history                                                               |
| `listed` bool                  | `false` only for `general`: it is never offered as a choice                                                                           |
| `default_capacity` int         | Spots                                                                                                                                 |
| `default_duration_minutes` int | End time = start + this                                                                                                               |
| `default_guests` bool          | Guests allowed                                                                                                                        |
| `default_cutoff_hours` int     | Cutoff = start − this                                                                                                                 |
| `default_opens_days` int null  | Registration opens this many days before start. Null means the form fills "now"; the opening time stays required to publish, as today |

### `app.activity_limits`

One row per activity per plan.

| Column                                                       | Meaning                                  |
| ------------------------------------------------------------ | ---------------------------------------- |
| `activity_key` FK, `plan` text (`free` \| `pro`), PK on both | The plan tier. Only `free` is read today |
| `min_capacity`, `max_capacity` int                           | Allowed spots                            |
| `min_duration_minutes`, `max_duration_minutes` int           | Allowed length                           |

Checks keep each range sane: min ≥ 1, min ≤ default ≤ max on the `free` row, and `pro` maximums ≥ `free` maximums.

### `app.activity_levels`

One row per activity per level.

| Column                                                                              | Meaning                   |
| ----------------------------------------------------------------------------------- | ------------------------- |
| `activity_key` FK, `level` (`beginner` \| `intermediate` \| `advanced`), PK on both | The level being described |
| `description` text (≤ 120 characters)                                               | One plain line            |

### Links from sessions and profiles

- **Sessions** gain a nullable `activity_key` FK.
  - The typed `activity` text stays as the display name. History never changes.
  - On save, the API sets `activity_key` when the text matches an activity name, ignoring case and outer spaces as `presetFor` does today. Otherwise it is null, and `general` applies.
  - A backfill sets it for existing sessions the same way.
- **Profiles** move from the `jsonb` array to `app.profile_activities`, one row per person per activity:
  - `user_id` FK;
  - `activity_key` FK, or null for a typed one;
  - `custom_name` (set only when typed);
  - `level`, nullable.

  Today's limits stay: at most 10 activities, at most 3 typed. The migration copies every `jsonb` entry: names matching an activity become that key, and the rest become custom names with their levels. Nothing is dropped.

## Seed values (builder's calls, tuned later as data)

| Key        | Name       | Spots default (free min–max) | Length default (free min–max) | Guests | Cutoff | Opens |
| ---------- | ---------- | ---------------------------- | ----------------------------- | ------ | ------ | ----- |
| pickleball | Pickleball | 8 (4–24)                     | 120 min (30–240)              | yes    | 24 h   | null  |
| badminton  | Badminton  | 8 (2–24)                     | 120 min (30–240)              | yes    | 24 h   | null  |
| tennis     | Tennis     | 4 (2–16)                     | 90 min (30–240)               | yes    | 24 h   | null  |
| basketball | Basketball | 10 (6–30)                    | 90 min (30–240)               | no     | 24 h   | null  |
| general    | Other      | 12 (2–50)                    | 120 min (15–480)              | no     | 24 h   | null  |

- **`pro` limits:** double each free maximum for spots, and 480 min for length.
- **Level descriptions:** one plain line per activity per level, for example Pickleball beginner "Learning the rules, serves and dinks". These are the builder's call within D-13, and the owner reviews them in the PR.

## API

- **`GET /api/activities`** is public and cacheable (`public, max-age=300`). It returns listed, active activities in `sort_order`, plus `general` marked `listed: false`. Each carries its defaults, the caller's limits (always `free` today), its level descriptions and its icon key.
- **Session create and edit** load the limits for the session's `activity_key`, or for `general`, and validate:
  - spots within the range;
  - length within the range, when both times are set.
  - **Editing:** only a value that changed is checked against the range, so old sessions stay editable (anti-goal). Builder's calls (2026-10-25):
    - **Changed** means against the stored session.
    - **Spots** count as changed when the number or the activity changes. A new activity brings its own limits.
    - **Length** counts as changed when the start or end time changes.
    - The previous values are read in the same transaction as the version check, inside the save function or right before it, so a concurrent edit can't slip past.
  - **Drafts** are never blocked by limits, matching today's draft leniency on spots. Limits apply on publish and on edits of published sessions.
  - **Run again and copies** are new sessions, so every value is checked. When a copied value is outside the new range, the form shows the range message to fix it before publishing.
  - Out-of-range messages name the range in plain words: "Pickleball sessions can have 4 to 24 spots."
- **Validation stays in the domain.** `normalizeSession` takes the limits as an argument, so the rule is pure and testable. The API supplies the data.

## Screens

- **New session.** Picking an activity chip, or typing a name that matches one, fills in the defaults. A field the organizer already changed in this form is never overwritten. The spots and length fields show the allowed range as help text.
- **When defaults fill** (builder's call, 2026-10-25). Defaults are a calculation over the form, not a one-time event. A field counts as "untouched" until the organizer edits it.
  - **Spots and guests** fill as soon as an activity is picked or matched.
  - **End, opening and cutoff** depend on the start time, so they fill once a start is entered. While untouched, they move with the start:
    - end = start + length;
    - opening = start − opening days, or the current time when the setting is null;
    - cutoff = start − cutoff hours, but never earlier than the opening (then it equals the opening).

    This keeps the existing rule that the cutoff falls between opening and start.

  - **Switching sport** replaces untouched fields with the new sport's defaults. Touched fields stay as the organizer set them.
- **Edit session.** Defaults are not re-applied to a saved session. The limits apply as below.
- **Edit profile (today's editor).** It reads the catalog instead of `presetActivities`. When a level is chosen, it shows that activity's level description, or the `general` one for typed activities.
- **Public profile.** Shows the activity icon next to each name.
- **Session page.** Shows the activity icon beside the activity name; `general` uses the general icon.
- **Icons.**
  - A new `ActivityIcon` in `@rallypoint/ui` maps icon keys to inline SVGs with `currentColor` and tokens only, so they follow the theme.
  - Unknown or missing keys fall back to the `general` icon.
  - The four sports get custom drawn icons in one consistent stroke style.

## Constraints and decisions this rests on

- D-13 copy rules, D-15 design direction, D-21 colours.
- **D-20:** migrations are SQL in `supabase/migrations`, recorded through the Prisma migrate runner. Production migration is a separate owner step, applied before merging dependent code.
- The pre-launch rule (owner memory): a one-way migration is fine, and no compatibility shims are needed.
- AGENTS.md: no skill inferred from other signals. Levels stay self-rated and optional.

## Verification

- Domain tests:
  - limit checks, including "unchanged out-of-range value passes on edit";
  - default application, including "never overwrites a touched field";
  - activity matching.
- API tests:
  - the public catalog read, its order, and inactive or unlisted rules;
  - session create rejected out of range, and allowed at the edges;
  - an old out-of-range session still editable;
  - profile migration keeps every entry and level;
  - typed activities use `general`.
- `pnpm check`, `pnpm db:start` (local migration), `pnpm test:api`.
- Browser at 375 px in light and dark:
  - pick each sport and see its defaults;
  - try out-of-range spots;
  - type a custom activity;
  - edit a profile level and see its description.

## Left to the builder

- Exact SQL function names, and whether `/api/activities` is one function or three.
- The SVG drawings, within one consistent style.
- Level description copy.
- How the session form marks a field as touched.
