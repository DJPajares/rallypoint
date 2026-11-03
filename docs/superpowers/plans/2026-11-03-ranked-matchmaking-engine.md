# Ranked Matchmaking Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pair active ranked searches into proposed matches on the per-minute scheduler, and let the players accept or decline them ([WDL-422](https://linear.app/wwonderland/issue/WDL-422/ranked-matchmaking-engine)).

**Architecture:** A transactional SQL function `api.run_matchmaking(p_limit)` does a bounded pass. It expires overdue proposals, then walks searches oldest-first from a stored cursor and pairs each with the longest-waiting compatible search. A global try-lock means only one pass runs at a time. Per-person try-locks plus a unique open-seat index mean nobody is ever in two matches. Players answer through `api.answer_match`. The Cloudflare `scheduled` handler calls the engine next to the email drain. `/ranked` shows the proposal and the 3-day "look across the region" prompt.

**Tech Stack:** Supabase Postgres (plpgsql, security invoker, `search_path=''`), Hono API, Next.js 16 client page, Node `node:test` tests against the local stack.

**Spec:** `docs/superpowers/specs/2026-11-03-ranked-matchmaking-design.md` (sections "Where and when", "Matching", "Calls made after the builder check"). Where the Linear text says "rank band", the spec's later amendment wins: hidden **skill** within **100** points, widening to **300** after **1 day**.

## Global Constraints

- Matching reads the hidden skill (`app.ranked_seed_rating`), never the medal; no number ever leaves the database or reaches the interface (D-13, anti-goals).
- A match needs the same category (activity + format) and a shared area; times are optional (empty = any time).
- Longest-waiting search first. A search's wait is measured from `started_at`.
- Never pair the same opponents again within **7 days**.
- Everyone accepts within **48 hours**; decline or expiry cancels with no penalty and returns the others to the front of the queue with their original wait.
- After **3 days** unmatched the app *asks* to widen to the whole region; it never widens on its own.
- One person is never in two matches, even under concurrent runs and retries.
- Pilot bounds (D-08): each pass handles at most **50** searches and **50** overdue proposals; the rest wait for the next minute.
- Only the players in a match can read or answer it.
- No new emails (owner, 2026-10-28). Alerts are WDL-423; booking is WDL-424; results are WDL-425.
- Migrations get a recovery note at the top, like `20261103110000_ranked_search.sql`.

## Builder's calls (recorded in the PRD at the end)

- **Band:** compatible when `abs(skillA - skillB) <= greatest(band(A), band(B))`, with band 100 (or 300 once that search has waited a day). Doubles use the team's average.
- **Decline:** the declining side's search ends (state `cancelled`), and their partner's with it, since a doubles team searches together. Every other side goes back to `searching`.
- **Expiry:** a side where everyone accepted goes back to `searching`. A side with anyone unanswered has its search ended. No rating change and no record against anyone.
- **Requeue keeps the wait:** `started_at` is unchanged, and `ends_at` is pushed back by the time spent in the proposal, so the 48 hours don't eat the 7-day search.
- **Repeat block:** covers both `app.ranked_results.played_at` and matches everyone accepted (`confirmed_at`) within 7 days, so a voided or still-unplayed match also blocks.
- **Place:**
  1. A court both sides chose (in the longest-waiting side's order) fixes the court and its area.
  2. Otherwise, the area is the first of the longest-waiting side's own areas that the other side covers, then the other side's own areas, then any shared area (by area `sort_order`).
  3. The court is then the longest-waiting side's first court in that area, else the other side's, else none.
- **Window:** the first shared window in the listed order. If only one side chose times, their first. If neither chose, none ("Any time").
- **A confirmed match** keeps both searches in `matched` (no new search) until booking or results (WDL-424/425) release them.

## Review Focus

1. A search whose 7-day `ends_at` passes while it sits in a proposal: after decline or expiry it must come back with time left, not lapse instantly. *(Task 2 test: requeue extends `ends_at`.)*
2. Cancelling a search that's currently matched must not leave a dangling proposal. *(Task 1 test: `cancel_search` on a matched search → 409 `search_matched`.)*
3. A proposal past its 48 hours that nobody has swept yet must not accept new answers, and must read as lapsed. *(Task 2 test: `answer_match` after `respond_by` → 409 `proposal_closed`; the read shows `state: "expired"`.)*
4. A retry of the same accept, by the same key, must not double-count or error. *(Task 2 test: idempotent accept.)*
5. The engine meeting a search whose person is locked by a concurrent action must skip that person, not block or deadlock. *(Task 1 test: parallel runs; the global lock lets exactly one pair.)*

---

### Task 1: Pairing engine (schema + `api.run_matchmaking`)

**Files:**
- Create: `supabase/migrations/20261103120000_ranked_matching.sql`
- Modify: `packages/database/src/functions.ts` (register `run_matchmaking: { p_limit: "integer" }`)
- Test: `tests/ranked-matchmaking.test.mjs` (new; reuse the `sql`, `person` and `request` helpers pattern from `tests/ranked-search.test.mjs`, with nonce prefix `rm-`)

**Interfaces:**
- Consumes: `app.ranked_searches`, `app.search_active`, `app.active_search_of`, `app.ranked_seed_rating(uuid,text,text)`, `app.ranked_results`, `app.areas(region_key, sort_order)`.
- Produces:
  - Table `app.ranked_matches(id uuid pk, activity_key text, format text, state text check in ('proposed','confirmed','cancelled'), area_key text references app.areas, court_id uuid references app.courts on delete set null, time_window text null, created_at timestamptz, respond_by timestamptz, confirmed_at timestamptz null, ended_at timestamptz null, end_reason text null check in ('declined','expired'))`.
  - Table `app.ranked_match_players(match_id uuid references app.ranked_matches on delete cascade, user_id uuid references auth.users on delete cascade, side smallint check in (1,2), search_id uuid references app.ranked_searches, answer text null check in ('accepted'), answered_at timestamptz null, released_at timestamptz null, primary key(match_id,user_id))`, plus `create unique index ranked_match_players_open on app.ranked_match_players(user_id) where released_at is null`. Side 1 is the longer-waiting side.
  - `app.ranked_searches`:
    - state check gains `'matched'`
    - new columns `match_id uuid null`, `matched_at timestamptz null`, `wide boolean not null default false`
    - `app.search_active(s)` becomes `(state in ('waiting_partner','searching') and ends_at > now()) or state = 'matched'`
  - Table `app.ranked_engine(id smallint primary key check (id = 1), cursor_started_at timestamptz, cursor_id uuid)` seeded with one row.
  - `app.search_skill(s app.ranked_searches) returns double precision`: the seed rating, averaged over starter and partner.
  - `app.search_band(s) returns integer`: 100, or 300 when `now() - started_at >= interval '1 day'`.
  - `app.search_reach(s) returns text[]`: `areas`, or every area in those areas' regions when `wide`.
  - `app.met_recently(a uuid[], b uuid[]) returns boolean`.
  - `app.search_users(s) returns uuid[]`.
  - `api.run_matchmaking(p_limit integer) returns jsonb {ran boolean, proposed integer, expired integer}`. Task 2 adds the expiry sweep and the `expired` count; Task 1 returns `expired: 0`.
  - `api.cancel_search` raises `search_matched` on a matched search.

- [ ] **Step 1: Write the failing tests** in `tests/ranked-matchmaking.test.mjs`. A `beforeEach` quiets the shared local DB: it cancels every `searching`/`waiting_partner` search, cancels every `proposed`/`confirmed` match, and releases its players. Helpers:
  - `singles(p, areas, opts)` starts a search over HTTP.
  - `age(searchId, interval)` runs `update app.ranked_searches set started_at = started_at - interval, ends_at = ends_at - interval`.
  - `run()` runs `select api.run_matchmaking(50)`.
  - `matchOf(userId)` returns the open match row.

  Tests:
  - `two compatible singles searches make one proposal`: A and B search Tampines with no times. `run()` → `proposed: 1`. Both `matchOf` are the same id, sides 1 and 2, `respond_by ≈ created_at + 48h`, area `tampines`, window null. Both searches are `matched`.
  - `different areas, formats or windows never pair`: A in Tampines vs B in Bishan → 0. A Weekday mornings vs B Weekend evenings in Tampines → 0. Singles vs a doubles team → 0.
  - `skill band starts at 100 and widens to 300 after a day`: give A a rating (`insert into app.ranked_ratings(user_id,activity_key,format,mu,matches) values (A,'pickleball','singles',(1750-1500)/173.7178,6)`; B is unrated at 1550, so the gap is 200). Run → 0. Then `age(A,'25 hours')`, run → 1.
  - `the longest-waiting compatible search is paired first`: A, then B, then C, all compatible; age A by 2h and B by 1h. Run → A is matched with B, and C is still `searching`.
  - `players who met in the last 7 days are not paired`: insert an `app.ranked_results` row with winners `{A}`, losers `{B}`, `played_at = now() - interval '2 days'`. Run → 0. Update `played_at` to 8 days ago, run → 1.
  - `the region is only searched after the player widens`: A in Tampines, B in Bedok (both East), A aged 4 days. Run → 0. Set A `wide = true` by SQL (the API comes in Task 2), run → 1, area `bedok`.
  - `a shared court picks the court and its area`: both choose court X in Tampines (create it via `POST /api/courts`) → the match has `court_id = X`.
  - `each pass handles at most p_limit searches and resumes`: 4 compatible pairs. `select api.run_matchmaking(2)` → `proposed: 1` (A pairs with its partner, which also counts toward the batch). The next `run_matchmaking(2)` pairs the next one. After at most 4 small runs, all 4 pairs are matched.
  - `two engine runs at once never place anyone twice`: 6 compatible searchers. Fire two `docker exec … psql -c "select api.run_matchmaking(50)"` processes at once (`Promise.all` over `execFile`, promisified). Then assert:
    - `select count(*) from app.ranked_match_players where released_at is null group by user_id having count(*) > 1` is empty
    - there are 3 open matches in total
  - `a matched search can't be cancelled or replaced`: after pairing, `POST /api/ranked/search/:id/cancel` → 409 `search_matched`, and starting a new search → 409 `search_active`.

- [ ] **Step 2: Run them and watch them fail**

Run: `RALLYPOINT_TEST_URL=http://127.0.0.1:3100 node --test tests/ranked-matchmaking.test.mjs`
Expected: FAIL. `function api.run_matchmaking(integer) does not exist`.

- [ ] **Step 3: Write the migration** `20261103120000_ranked_matching.sql`, with the interfaces above. Engine algorithm (plpgsql), the one part the tests don't fully determine:

```
if not pg_try_advisory_xact_lock(hashtextextended('ranked-matchmaking', 0)) then return {ran:false,...}
batch := searching, active, started_at not null, (started_at,id) > cursor, order by started_at,id, limit p_limit
for a in batch:
  re-read a; skip unless state='searching' and active
  b := first search with: id<>a.id, same activity+format, state='searching', active, started_at not null,
       app.search_reach(a) && app.search_reach(b),
       (cardinality(a.windows)=0 or cardinality(b.windows)=0 or a.windows && b.windows),
       abs(app.search_skill(a)-app.search_skill(b)) <= greatest(app.search_band(a), app.search_band(b)),
       not app.met_recently(app.search_users(a), app.search_users(b))
       order by started_at, id   -- longest-waiting first
  skip unless every user in both searches gets pg_try_advisory_xact_lock('ranked-search:'||user)
  select both rows for update; skip unless both still 'searching'
  pick place and window (Builder's calls); insert match + players; set both searches matched (match_id, matched_at=now())
  count 2 searches toward p_limit
cursor := last processed (started_at,id), or null when the batch was shorter than p_limit
```

The per-person key must equal `app.lock_searchers`'s key (`'ranked-search:' || user`), so user actions and the engine serialise on the same lock. The engine uses only try-locks, so it never waits on a person and can't deadlock with a user action. Revoke from public/anon/authenticated and grant to service_role for every new function and table.

- [ ] **Step 4: Apply and run**

Run: `pnpm db:migrate && RALLYPOINT_TEST_URL=http://127.0.0.1:3100 node --test tests/ranked-matchmaking.test.mjs`
Expected: PASS (all Task 1 tests).

- [ ] **Step 5: Commit**: `feat(ranked): pair searches into proposed matches (WDL-422)`.

### Task 2: Answers, expiry, requeue, widening and reads

**Files:**
- Create: `supabase/migrations/20261103121000_ranked_match_answers.sql`
- Modify: `packages/database/src/functions.ts` (`answer_match: { ...actor, p_key: "uuid", p_match: "uuid", p_accept: "boolean" }`, `widen_search: { ...actor, p_key: "uuid", p_search: "uuid" }`)
- Modify: `apps/api/src/ranked.ts`:
  - `POST /ranked/matches/:match/answer` with body `{operationKey, accept}`
  - `POST /ranked/search/:search/widen` with body `{operationKey}`
  - conflicts:
    - `search_matched`: "You’ve been matched. Accept or decline the match instead."
    - `proposal_closed`: "This match has already been settled or has run out."
    - `cannot_widen`: "You can widen your search after 3 days without a match."
  - missing: `match_not_found`: "That match isn’t available."
- Modify: `packages/domain/src/ranked-search.ts` (types below)
- Test: `tests/ranked-matchmaking.test.mjs`

**Interfaces:**
- Consumes: Task 1 tables and functions.
- Produces:
  - `app.requeue_side(p_match uuid, p_side smallint)` puts that side's search back to `searching`, pushing `ends_at` back by `now() - matched_at` and clearing `match_id`/`matched_at`.
  - `app.end_side(p_match, p_side)` sets that side's search to `cancelled` with `ended_at = now()`.
  - Both release the side's player rows.
  - `api.answer_match(p_actor_id uuid, p_key uuid, p_match uuid, p_accept boolean) returns jsonb`: the same shape as `read_my_search`, with `operationKey`, and idempotent via `app.search_receipt`.
  - `api.widen_search(p_actor_id, p_key, p_search) returns jsonb`: allowed when the search is `searching` and `now() - started_at >= 3 days`; sets `wide = true`.
  - `api.run_matchmaking` gains the expiry sweep: `state='proposed' and respond_by <= now()`, `for update skip locked`, limit `p_limit`. A side where everyone accepted is requeued; any other side is ended. The match gets `state 'cancelled'`, `end_reason 'expired'`.
  - `app.search_view` adds `wide boolean`, `canWiden boolean`, and `regions text[]` (region names of the chosen areas).
  - `api.read_my_search` adds `match`: the actor's open match (player row with `released_at is null`), via `app.match_view(m, actor)`, or null.
  - `app.match_view` → `{ id, format, state: 'proposed'|'confirmed'|'expired', area:{key,label}, court:{id,name,mapsUrl}|null, window: SearchWindow|null, respondBy, players:[{profileId,name,side:'yours'|'theirs',accepted:boolean}], myAnswer: 'accepted'|null }`. `expired` shows for a `proposed` match past `respond_by`. No ratings.
  - `api.read_operation` adds `answer_match` and `widen_search` to the ranked-search branch.
  - Domain:
    - `SearchView.state` gains `"matched"`, plus `wide: boolean; canWiden: boolean; regions: string[]`.
    - New `MatchView` interface as above.
    - `export interface MySearch { search: SearchView | null; invites: SearchInvite[]; match: MatchView | null }`.

- [ ] **Step 1: Write the failing tests**:
  - `everyone accepting confirms the match`: pair A/B. A accepts → `match.state` `proposed`, A's `myAnswer` `accepted`. B accepts → `confirmed`, `confirmed_at` set, and both searches stay `matched`.
  - `a decline cancels and puts the other side back first with its wait`:
    - Pair A (aged 3h) with B. Note A's `started_at`.
    - B declines → match `cancelled`/`declined`, and B's search is `cancelled`. A's search is `searching` with the same `started_at`.
    - Add C (new) and D (aged 1h). Run → A is paired before D.
  - `requeue gives back the time spent waiting on answers`: pair A/B, then set the match's `respond_by` and A's `matched_at` back 47h. B declines → A's `ends_at` moved later by about 47h.
  - `48 hours without every answer expires the proposal`: pair A/B, A accepts. Set `respond_by = now() - interval '1 minute'`. The read shows `state: "expired"`. B answering → 409 `proposal_closed`. Run → `expired: 1`, A is back `searching`, and B's search is `cancelled`.
  - `a retried accept with the same key changes nothing`: post the same accept body twice → both 200 with equal `match`.
  - `only the players can read or answer a match`: an outsider posting an answer → 404, and the outsider's read has `match: null`. Nothing in the read contains `mu`, `skill` or a number other than the dates.
  - `widening needs three days and only widens on request`: `widen` at 2 days → 409 `cannot_widen`. At 3 days → 200, `search.wide: true`, `canWiden: false`. Before that, the read at 3 days showed `canWiden: true` with `regions: ["East"]`.

- [ ] **Step 2: Run and watch them fail.** Expected: 404s (no routes) and missing function errors.

- [ ] **Step 3: Implement the migration and routes.** `answer_match` steps:
  1. Load the player row; missing → `match_not_found`.
  2. `app.lock_searchers` over all of the match's players.
  3. Lock the match `for update`.
  4. Not `proposed`, or `respond_by <= now()` → `proposal_closed`.
  5. Accept: set `answer`. If no unanswered players remain → `confirmed`.
  6. Decline: `end_side` on the actor's side, `requeue_side` on the other, then the match becomes `cancelled`/`declined` with `ended_at`.
  7. Write the receipt.

- [ ] **Step 4: Run.** `pnpm db:migrate && RALLYPOINT_TEST_URL=http://127.0.0.1:3100 node --test tests/ranked-matchmaking.test.mjs tests/ranked-search.test.mjs`. Expected: PASS. The existing search tests still pass, with `wide`/`canWiden`/`regions` added to their expected keys if they assert exact shape.

- [ ] **Step 5: Commit**: `feat(ranked): accept, decline, expiry and region widening (WDL-422)`.

### Task 3: Run the engine every minute

**Files:**
- Modify: `apps/web/worker.ts`
- Test: `tests/worker-schedule.test.mjs` (new). Only if `worker.ts` can't be imported in node (it imports the built `.open-next` worker): move the scheduled logic into `apps/web/scheduled.ts` and test that.

**Interfaces:**
- Consumes: `api.run_matchmaking` via `createDatabase(env).rpc("run_matchmaking", { p_limit: 50 })` from `@rallypoint/database`.
- Produces: `export async function matchmake(env: DatabaseEnv, open = createDatabase): Promise<void>`. It needs only `DATABASE_URL`, swallows and never logs errors (it prints `matchmaking failed`), and always closes the client. `scheduled` does `ctx.waitUntil(Promise.all([run(env), matchmake(env)]))`.

- [ ] **Step 1: Failing test**:
  - `matchmake calls run_matchmaking with 50 and closes`: a fake `open` returns `{ rpc, close }` recorders. Assert one call `("run_matchmaking", { p_limit: 50 })` and that `close` was called.
  - `matchmake does nothing without DATABASE_URL`.
  - `a database error is swallowed and the client still closes`.
- [ ] **Step 2: Run, watch it fail** (module or export missing).
- [ ] **Step 3: Implement** in `apps/web/scheduled.ts` (plus `run` moved there if needed), and import it in `worker.ts`.
- [ ] **Step 4: Run** `node --test tests/worker-schedule.test.mjs && pnpm typecheck`. Expected: PASS.
- [ ] **Step 5: Commit**: `feat(ranked): run matchmaking on the minute scheduler (WDL-422)`.

### Task 4: Match card and widen prompt on /ranked

**Files:**
- Modify: `apps/web/src/ranked-page.tsx`
- Test: browser check (dev server `web-shadcn`, port 3100) plus `tests/pages.test.mjs` staying green.

**Interfaces:**
- Consumes: `MySearch`, `MatchView`, the `POST /api/ranked/matches/:id/answer` and `POST /api/ranked/search/:id/widen` routes (Task 2).
- Produces: `MatchCard({ match, onDone })`, and the widen prompt inside `ActiveSearch`.

- [ ] **Step 1: Build `MatchCard`**, shown in place of the search card when `match` is set:
  - Heading: "Match found" (proposed), "Match on" (confirmed), or "This match ran out" (expired).
  - Rows for:
    - your partner (doubles)
    - opponents
    - area
    - court, with a Maps link when there is one
    - when: the window label, or "Any time"
  - Each player shows "Accepted" or "Waiting" with an icon and text, never colour alone.
  - "Answer by <local date and time>".
  - Proposed and not yet answered: **Accept** (primary) and **Decline** (outline) buttons, using the page's existing operation-key + retry pattern. Both send `{operationKey, accept}`.
  - After your accept: "Waiting for N more."
  - Confirmed: "Everyone’s in. Booking the court comes next."
  - Expired: "Nobody’s been charged. Your search continues shortly."
- [ ] **Step 2: Widen prompt.** When `search.canWiden`, `ActiveSearch` shows "No match yet. Look across all of {regions joined with ' and '}?" and a **Look across {region}** button, which posts to `/widen`. When `search.wide`, the areas row reads "All of {regions}".
- [ ] **Step 3: Verify in the browser.** Two synthetic accounts search Singles in Tampines; run `select api.run_matchmaking(50)` by SQL. Check:
  - both accounts see "Match found"
  - accept on one shows "Waiting for 1 more"
  - decline on the other: that account's search ended, and the first is back to searching
  - mobile width (375px) has no horizontal scroll
  - keyboard focus lands on the result message after each action

  Run `pnpm typecheck && pnpm lint`.
- [ ] **Step 4: Commit**: `feat(ranked): match card and region prompt on the Ranked page (WDL-422)`.

### Task 5: Record the calls

**Files:**
- Modify: `PRD.md`: the D-26 row gets an "Implemented for review (WDL-422)" note with the Builder's calls above, and the bounds 50 searches and 50 proposals per minute.

- [ ] **Step 1: Write the note.** Run the full suite: `RALLYPOINT_TEST_URL=http://127.0.0.1:3100 pnpm test`. Expected: all pass.
- [ ] **Step 2: Commit**: `docs(prd): matchmaking engine calls (WDL-422)`.
