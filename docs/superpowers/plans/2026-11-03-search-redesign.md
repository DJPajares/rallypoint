# Search Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild Search around three jobs: finding a public game by day, finding a person, and browsing public clubs. Add a public/private profile switch.

**Architecture:**
- Three new SQL reads, each bounded and returning only public data:
  - `api.search_sessions` returns public sessions for the next 14 days, grouped by the viewer's day.
  - `api.search_people` finds discoverable profiles by name.
  - `api.search_clubs` browses or finds public groups.
- A new `profiles.discoverable` flag, public by default, with a setter.
- Pure domain helpers build the day strip and apply the session filters on the client.
- The page is a segmented Sessions/People/Clubs view built from existing UI kit pieces (Segmented, Sheet, Pill, CheckField, SwitchField).

**Tech Stack:** Supabase Postgres (plpgsql), Hono API, `@rallypoint/domain` (Temporal), Next.js client components, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-search-redesign-design.md` (owner-approved 2026-11-03).

## Global Constraints

- Only public data: sessions that are published, have `access` public (missing means public), aren't cancelled and haven't ended; profiles with `discoverable = true`; groups that are community, unarchived and `visibility = 'public'`. The one exception is that private groups' names alone may appear when searched by name, as P-37 already allows.
- Never show: email, a different account name, or which sessions a person joined.
- **Bounds:**
  - up to 50 sessions per day, over 14 days
  - up to 20 people (people are found only after at least 2 letters, never browsed)
  - up to 30 clubs
- **Filters:**
  - activity (multi)
  - time of day: morning before 12:00, afternoon 12:00–17:00, evening from 17:00, by the session's own time zone
  - price: free or paid
  - has spots left
  - joining: direct or ask
- Days use the viewer's device time zone. D-13: no time zone shown.
- A host whose profile is private is not matched by typing their name; the card still shows the host name.
- Search is signed-in only.
- **Look:**
  - existing tokens and components
  - one accent colour; no gradients, emoji or illustrations
  - fades only, and none with reduced motion
  - status in words plus icon, never colour alone
- "Your sessions" (the actor's own, private included) shows above the public results only when there's a query.

## Review Focus

1. A private session, or one with no `access` key in old details (which counts as public), must be handled correctly. *(Task 1 test: private is excluded and a missing key is included.)*
2. A session that started earlier today and hasn't ended shows "Happening now" on today. One that ended does not show. *(Task 1 test.)*
3. A day boundary in the viewer's zone: a session at 23:30 local time belongs to that day, not the next. *(Task 2 test.)*
4. A private profile is never returned by people search, and its host name doesn't match in session search. *(Task 1 tests.)*
5. An invalid time zone or `from` gives a 422, not a 500. *(Task 1 test.)*

---

### Task 1: Discovery reads and the profile switch

**Files:**
- Create: `supabase/migrations/20261103150000_search_discovery.sql`
- Modify: `packages/database/src/functions.ts`, `apps/api/src/search.ts`, `apps/api/src/profiles.ts` (or wherever `/me/profile` lives)
- Test: `tests/search-discovery.test.mjs`

**Interfaces:**
- **Schema:** `app.profiles.discoverable boolean not null default true`.
- **`api.search_sessions(p_actor_id uuid, p_from timestamptz, p_time_zone text, p_query text) → jsonb {sessions: SearchSession[]}`**
  - Covers sessions with `startsAt` in `[p_from, p_from + 14 days)` or already started and not ended, and `endsAt > now()`.
  - Each row carries `day` (YYYY-MM-DD in `p_time_zone`). At most 50 per day, earliest first.
  - `p_query` (null or 2–40 characters) matches title, activity, location, or host name when the host team's owner or organizer is discoverable.
  - Raises `invalid_input` for a bad zone (not in `pg_timezone_names`) or a bad query.
- **`SearchSession` row:** `{ slug, title, activity, startsAt, endsAt, timeZone, location, hostName, capacity, takenSeats, joinMode, currency, feeMinor, totalMinor, feeMode, paymentMode, day, happeningNow }`
  - `takenSeats` comes from `app.registration_counts(...).confirmedSeats`.
- **`api.search_people(p_actor_id, p_query) → jsonb {people: [{ profileId, name, activities: [{name, level}], ranks }]}`**
  - discoverable profiles only, not the actor
  - name = `coalesce(display_name, account_name)` contains the query
  - `ranks` = `app.visible_ranks(user_id)`
  - limit 20, names starting with the query first
- **`api.search_clubs(p_actor_id, p_query text null) → jsonb {clubs: [{ id, name, members, visibility, viewerRole }]}`**
  - no query: public community groups, most members first, limit 30
  - with a query: like `search_groups`, and private groups show only `{name, visibility}`
- **`api.set_profile_discoverable(p_actor_id, p_discoverable boolean) → jsonb {discoverable}`**
- **`api.read_my_profile`** adds `discoverable`.
- **Routes** (signed in):
  - `GET /api/search/sessions?from&tz&q`
  - `GET /api/search/people?q`
  - `GET /api/search/clubs?q`
  - `POST /api/me/profile/discoverable {discoverable}`
  - The existing `GET /api/search?q` stays, for "Your sessions" and group name search.

- [ ] **Step 1: Failing tests** (synthetic users and sessions created as in the existing session tests):
  - `public sessions in the next 14 days come grouped by day; private, draft, cancelled and ended ones never do`. This includes a session whose details lack `access` (included) and one with `access: private` (excluded).
  - `a session that started and hasn't ended shows today as happening now`
  - `typing matches title, place, activity and a discoverable host's name, but not a private host's name`
  - `each day holds at most 50 sessions`. Seed 51 on one day, then assert 50.
  - `a bad time zone or query is refused with 422`
  - `people search finds discoverable profiles by shown name and never returns email, account name or private profiles`
  - `a profile is public by default and can be made private`. After the setter, `read_my_profile.discoverable` is false and search no longer finds the person.
  - `clubs: browsing shows public groups by member count; searching shows a private group's name only`
- [ ] **Step 2: Run, watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run; expect PASS.** Commit `feat(search): public sessions, people and clubs reads (D-27)`.

### Task 2: Day strip and filters (domain)

**Files:**
- Create: `packages/domain/src/discovery.ts` (exported as `./discovery`)
- Test: `tests/discovery-domain.test.mjs`

**Interfaces:**
- `SearchSession` type, matching the Task 1 row.
- `dayStrip(now: Date, timeZone: string, days = 14): Array<{ key: string; label: string; short: string }>`. Labels are "Today", "Tomorrow", then "Wed 5"; `short` is the weekday.
- `startOfDay(now: Date, timeZone: string): string`, the ISO instant of local midnight, for `from`.
- `SessionFilters = { activities: string[]; times: ("morning" | "afternoon" | "evening")[]; price: "any" | "free" | "paid"; spotsLeft: boolean; joining: "any" | "direct" | "request" }`, and `noFilters`.
- `timeOfDay(row): "morning" | "afternoon" | "evening"`, using the row's own time zone.
- `filterSessions(rows, filters): SearchSession[]`
- `activeFilterCount(filters): number`
- `spotsLabel(row): string`: "3 spots left", "1 spot left", "Full · waitlist", or "Ask to join" (when `joinMode = request`).
- `priceLabel(row): string`: "Free", the fixed fee, or "≈ S$6.00 each" (split total ÷ capacity).

- [ ] **Step 1: Failing tests:**
  - strip labels from a Singapore "now" on 2026-11-03: `Today`, `Tomorrow`, then `Thu 5`
  - `startOfDay` is 16:00Z the previous day for Asia/Singapore
  - 23:30 local stays on its own day
  - time-of-day boundaries at 11:59, 12:00, 16:59 and 17:00
  - each filter alone and combined
  - `spotsLabel` and `priceLabel` cases
- [ ] **Step 2: Implement; tests pass.** Commit.

### Task 3: The Search page

**Files:**
- Rewrite: `apps/web/src/search-page.tsx` (split into `search-page.tsx` plus `search-sessions.tsx`, `search-people.tsx` and `search-clubs.tsx` if it passes ~300 lines)
- Modify: `apps/web/src/badges.tsx` (`ProfilePage`: the switch row)

**Steps:**
- [ ] **Header:** title "Search", one search box ("Search sessions, people and clubs"), and a `Segmented` Sessions · People · Clubs control. Remember the chosen tab in the URL (`?tab=people`), so Back keeps it.
- [ ] **Sessions:**
  - **Day strip:** a scrollable row of pill buttons (`role="tablist"`). The selected day is filled primary, and each pill shows its count in muted text. Arrow keys move between days.
  - **Filters:** a "Filters" button with the active count opens a `Sheet` holding the filter controls. Active filters show as removable `Pill` chips plus "Clear all".
  - **Session cards:**
    - large start time on the left
    - title, activity · place, "Hosted by {name}" on the right
    - a muted line with `spotsLabel` (with icon) · `priceLabel`, plus "Happening now" when it applies
    - links to `/s/{slug}`
  - **When typing:** a "Your sessions" list above the cards, from `/api/search`.
  - **Empty states:**
    - "Nothing on this day yet." with a "Next: {day}" link
    - "No sessions match these filters." with "Clear filters"
    - a day at its limit says "Showing the first 50"
- [ ] **People:**
  - With no query: "Find people by name. Only public profiles show up."
  - Otherwise, rows with `RingAvatar`, name, activities with levels, and `RankPills`, linking to `/people/{id}`.
- [ ] **Clubs:** the browse list with no query, and search results with one. Rows show name and "{n} members". Public clubs link to `/groups/{id}`; private ones show "Private" with a lock icon and no link.
- [ ] **Profile switch:** one `SwitchField` row near the bottom of the owner's profile page:
  - on: "Public profile · anyone signed in can find you in Search"
  - off: "Private · only people who already have your link see it"
- [ ] **Throughout:**
  - debounced queries (300 ms)
  - one polite status line for the result count
  - no focus jumps while typing
  - reduced motion: no fade
- [ ] **Verify:** `pnpm typecheck && pnpm lint`. Browser at 375 px and on desktop, light and dark:
  - date strip, filters and chips, cards, empty day
  - typing with "Your sessions"
  - People, Clubs and the profile switch
  - no sideways scroll

  Commit `feat(search): sessions by day, people and clubs (D-27)`.

### Task 4: Record

- [ ] **PRD:** add D-27, and amend the exclusions line (38) to point to D-27. The note: public sessions are discoverable in Search, people can be looked up when their profile is public (the default), and public clubs can be browsed. "Near me", distance and location filters are parked.
- [ ] **Full suite** (`RALLYPOINT_TEST_URL=http://127.0.0.1:3100 pnpm test`), then commit.
