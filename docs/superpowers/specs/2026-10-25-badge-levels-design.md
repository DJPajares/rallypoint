# Badges with shared levels (P-19)

Linear: [WDL-394](https://linear.app/wwonderland/issue/WDL-394). Requirements: PRD RP-15, D-06, D-15, D-16. Owner direction, 2026-10-24 (icon/level treatment, in the issue) and 2026-10-25 (this design talk).

## Intent

The owner, picturing a person who has used RallyPoint for 10 months:

> "it would be nice to see, as a user for 10 months, be motivated by my consistency, people i met along, commendations, my improved skills, and other stuff that can even motivate me more for using the app"

Today's shelf is 15 badges, and most of them are one idea drawn at different sizes (First Rally, Ten, Twenty-Five, Fifty, Century). The profile should tell a person their own story instead: they keep showing up, they've met people, they bring friends, they run sessions. That story grows in place, one badge per idea, each with levels. Motivation comes from seeing growth, never from fear of losing something.

## Goals

1. Six distinct badges, each with five levels, replacing the 15 one-off badges.
2. One shared level palette: the same level is the same colour on every badge. The icon and name say which badge it is.
3. The profile shows each badge once, at its highest level, with the earlier levels and a concrete next target in a details sheet.
4. Existing people lose nothing true. Their history maps onto the new levels, their titles keep working unchanged, and nobody gets a pile of popups on release day.

## Non-goals

- **Commendations and skill badges.** These are parked as [WDL-406](https://linear.app/wwonderland/issue/WDL-406); they need a vouching rule first (D-16).
- **More badges than six.** The owner said "6 different badges is quite few. but this is fine for now"; expansion is parked as [WDL-407](https://linear.app/wwonderland/issue/WDL-407).
- **Titles.** That covers title wording, a title catalog, unlocks, the picker and title migration: [WDL-405](https://linear.app/wwonderland/issue/WDL-405). This task only keeps today's titles working exactly as they are.
- **Excluded by the issue:** leaderboards, rankings, XP, streaks that break, badges from payments, no-shows, reliability or waitlist position, share cards, feeds, push, email and banners.

## Anti-goals (a failure even if it works)

- A missed week or month takes away a level or progress. Only a corrected or cancelled record can remove one, as today (D-16).
- The release fires a cascade of "new badge" sheets for history people already had.
- A badge rewards gaming: joining waitlists on purpose, creating empty groups, or repeating an action just to fill a ladder.
- A public profile reveals group names, dates, sessions, progress or who someone played with.
- Someone's chosen title disappears or is renamed.

## The catalog (owner-approved 2026-10-25)

Families pair up: playing (Rally, Steady), people (New Faces, Plus One), hosting (Host, Full House).

| ID | Name | Icon (existing glyph) | Counts | Levels 1 · 2 · 3 · 4 · 5 |
|---|---|---|---|---|
| `rally` | Rally | ball arc (`rally`) | sessions you checked in at | 1 · 10 · 25 · 50 · 100 |
| `steady` | Steady | calendar (`regular`) | months with at least one of those sessions | 2 · 3 · 6 · 12 · 24 |
| `new-faces` | New Faces | three faces (`faces`) | different people with accounts checked in at a session you were checked in at | 5 · 10 · 25 · 50 · 100 |
| `plus-one` | Plus One | person plus (`plus`) | sessions where the guest on your booking was checked in | 1 · 3 · 5 · 10 · 20 |
| `host` | Host | flag (`host`) | sessions where you recorded a check-in | 1 · 5 · 10 · 25 · 50 |
| `full-house` | Full House | seat grid (`full`) | of those, sessions where confirmed seats reached capacity | 1 · 3 · 10 · 25 · 50 |

### What counts (trusted sources, unchanged from the current engine)

- **A session you played** is one where your own seat (seat 1) of a confirmed booking is checked in and the session is not cancelled. Registrations and waitlist entries don't count. Counting is per session, so a second booking at the same session never counts twice. This is today's `app.badge_sessions`.
- **A guest** is seat 2 of your confirmed booking. A guest who was checked in counts toward Plus One once per session. Guests never add to your own Rally, Steady or New Faces.
- **People met** are other accounts whose own seat 1 was checked in at a session you played, counted once per person, ever. Guests have no account, so they are never counted. This is today's `app.badge_met`.
- **Hosting** credit comes from running check-in: recording at least one check-in at a non-cancelled session, as now (a D-16 builder call that stays). Each person who records check-ins at a session gets credit for it. If you check yourself in at a session you host, you get both Rally and Host credit. That's accepted, since you did both.
- **Full House** means confirmed seats (guests included) are at or above capacity at a session you hosted. It is evaluated the same way as today.
- **A Steady month** is the calendar month of the session's start, in the session's own time zone (`details.timeZone`). This is my call; see Builder's calls.

### Levels are derived, never stored

Levels are recomputed from these records on every read, like today's badges. Corrections, cancellations and reversals recalculate levels both ways. A level can't be awarded or written directly. Inactivity never removes anything, because counts only change when records do. Retries and simultaneous updates can't double count, because counts are distinct sessions, months and people.

### How the 15 old badges map

| Old badge | Becomes |
|---|---|
| First Rally, Ten, Twenty-Five, Fifty, Century | Rally levels 1, 2, 3, 4, 5 (same thresholds) |
| New Faces (10), Mixer (25), Connector (50) | New Faces levels 2, 3, 4 |
| Host, Seasoned Host (10) | Host levels 1, 3 |
| Plus One | Plus One level 1 |
| Full House | Full House level 1 |
| Regular (5 at one group) | retired: for most people it repeats Rally, and Steady covers consistency |
| Off the Bench (moved up from the waitlist) | retired: giving it levels would reward joining waitlists on purpose |
| Founder (started a group) | retired: giving it levels would reward creating empty groups |

The retired three disappear from the shelf. Their evidence (the check-ins) still counts in Rally and Steady. They still work as titles (next section). Nothing is said or implied about skill.

### Titles stay exactly as they are

Today, a title is an earned old badge ID (for example `sessions-25` or `founder:<group>`), shown by its old name. Until WDL-405 replaces titles:

- The old badge evaluation (`app.earned_badges`) stays as it is, only for titles. `visible_title`, `set_my_title`, rosters and the public title keep working unchanged, under their old names.
- The title picker on the profile keeps offering the old badges you have earned, with the same names, the retired three included.
- A title pill shows the old name. Its small medallion shows the new badge at the mapped level (for example Twenty-Five shows Rally level 3). A retired title (Regular, Off the Bench, Founder) shows its name without a medallion.

## How it looks and behaves (owner-approved 2026-10-25)

### Medallion

- **Icon and name are permanent per badge.** The disc colour comes from the level only:
  1. sky blue
  2. teal
  3. violet
  4. coral
  5. gold

  Gold always means complete.
- **Non-colour level marker.** A small numeral chip (1–5) on the medallion's lower-right edge.
- **Rim.** The rim gets slightly heavier at level 3, and doubles at level 5. Nothing else escalates: no crowns, wings, flames or stars.
- **Icons are white on every level.** Each level's gradient must keep the white glyph at least 3:1 against the disc (WCAG non-text contrast) in both themes. Medallions look the same in light and dark, and only the surrounding surface changes. The chip must stay legible at the shelf size (64px) and the details size.
- **Small sizes.** Under 32px (the title pill and the Home nudge) the chip is dropped, and nearby text carries the level.
- **Screen readers.** An earned medallion reads "Rally, level 3 of 5". One not started reads "Rally, not started".
- **Not started.** The dashed outline used today, with the icon in the outline colour.

### Profile shelf (owner's view, `/profile`)

- All six badges always show, in catalog order, three per row at phone width.
- **Started badge:** the medallion at the current level, the name, and "Level 3" (or "Complete" at level 5).
- **Not started:** the dashed medallion, the name, and "Not started".
- Every shelf item is a button. It opens a details sheet:
  - the medallion and name;
  - all five levels with their targets ("Level 3 · 25 sessions"). Earned levels are ticked and show the date earned; the dates are owner-only.
  - the next step in words ("13 more sessions to level 4");
  - at level 5, "Complete", with no next target.
- The profile's stat row (played, hosted, groups) stays as it is.

### Public profile (`/people/{id}`)

The public profile shows only started badges, each at its highest level, with the name and "Level n". It shows no dates, progress, group names or details sheet. The API returns `{ key, level }` per started badge and nothing more. The stat row (played, hosted, groups count) stays as P-21 left it.

### New-level sheet

- It is today's single sheet, now naming the level: "Rally · Level 3", with the line "25 sessions, checked in."
- It is shown once and marked seen however it's closed. Push and email are never sent.
- If one record jumps several levels at once, the sheet shows only the highest unseen level of that badge.
- "+N more on your profile" counts other badges with unseen levels, as today.
- Closing the sheet marks every unseen level seen, across all badges, as today. One check-in that lifts three badges gives one sheet, never three in a row.
- The "Show as my title" button stays when the level has an old-badge equivalent you have earned (the mapping table, reversed: Rally level 3 sets `sessions-25`). Otherwise the button is hidden.
- With reduced motion turned on, the medallion appears without its pop-in, as today.

### Release day: no cascade

When this ships, every level each person already qualifies for is marked seen. People find their levels on their profile without a popup. Seen markers are never deleted, so a level lost to a correction and earned again doesn't celebrate twice.

### Home nudge

It stays as is, and points at the started, unfinished badge closest to its next level: "Rally · 3 more sessions".

### Per-level wording

| Badge | Level line ({n} is that level's target) | Progress ({left} remaining) |
|---|---|---|
| Rally | level 1: "Your first session, checked in."; otherwise "{n} sessions, checked in." | "{left} more session(s)" |
| Steady | "Played in {n} different months." | "{left} more month(s)" |
| New Faces | "Played alongside {n} different people." | "{left} more new person/people" |
| Plus One | level 1: "You brought a guest who showed up."; otherwise "Guests you brought showed up {n} times." | "{left} more session(s) with a guest" |
| Host | level 1: "You ran check-in at a session."; otherwise "You've run check-in at {n} sessions." | "{left} more session(s) to run" |
| Full House | level 1: "You ran a session where every seat was taken."; otherwise "{n} sessions you ran were full." | "{left} more full session(s) to run" |

## Constraints

- Reuse the current engine: the SQL derivation, `badge_views`, `user_titles`, the API routes and `apps/web/src/badges.tsx`. No new tables are expected. The only persistent changes are a migration later than `20261024150000`, replacing functions and backfilling seen markers.
- Recovery: the migration is additive (new functions, replaced read functions, inserted seen rows with new-style IDs). Rolling back means restoring the previous function bodies and deleting `badge_views` rows whose ID matches the new `key:level` form. The plan states this.
- Authorization is unchanged. Badges remain readable only by their owner through `/api/me/badges` and writable only as seen markers for levels earned right now. The public profile and rosters get only the facts listed above. All functions stay `service_role`-only.

## Builder's calls (open to owner correction)

- A Steady month uses the session's start in its own time zone. An unrecognised zone falls back to UTC rather than failing the read.
- New-style badge IDs are `key:level` (for example `rally:3`). They never collide with old IDs, which have no level suffix.
- Thresholds live in the domain catalog and in the SQL. Tests check that the two agree.
- "Started" means level 1 or higher. The shelf and the public profile use that. Below level 1 the shelf says "Not started", but the details sheet and the Home nudge still show progress toward level 1 ("2 more new people to level 1"). With no count at all, the details sheet shows the level 1 target ("Your first session earns level 1").
- Closing the new-level sheet marks all unseen levels seen (today's behaviour), so a single check-in never produces sheets in a row.
- The public profile shelf is not tappable.
- The exact gradient stops for the five level colours are set during the build, against the 3:1 check, starting from the current sky, teal, violet, coral and gold medallion colours.

## Left to the builder

The API response shape, how the SQL is split, the CSS, the chip and rim geometry, test structure, and the migration's backfill query.
