# Ranked rating engine (WDL-420) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn confirmed ranked results into hidden Glicko-2 ratings and public ranks, per activity and format, shown on profiles and session rosters.

**Architecture:** One migration adds the format catalog, per-player ratings, an applied-results ledger (idempotency key = result id) and plpgsql functions: the Glicko-2 step, `app.apply_ranked_result`, rank mapping, visible ranks and the matchmaking seed rating. The profile, badges and roster reads gain a `ranks` array of `{activity, format, rank}`; the number never leaves the database. The web app shows a rank pill beside names and a Ranked list on the profile. No HTTP write path: WDL-425 will call `app.apply_ranked_result`.

**Tech Stack:** Supabase Postgres (plpgsql, `security invoker`, `search_path=''`), Next.js/React with shadcn tokens, `node --test` suites against the local stack.

**Spec:** `docs/superpowers/specs/2026-11-03-ranked-matchmaking-design.md` (PRD D-26), Linear [WDL-420](https://linear.app/wwonderland/issue/WDL-420).

## Global Constraints

- Categories are (activity, format); pickleball has `singles` (team size 1) and `doubles` (team size 2). Ratings never carry across categories.
- Glicko-2: start rating 1500, deviation 350, volatility 0.06, τ = 0.5; one match = one rating period; idle time inflates deviation by one period per full 7 days, capped at 350.
- Doubles: expected score uses each team's average μ; opponent deviation is the root mean square of the opponents' φ; each player updates with their own φ and σ.
- Unranked until 5 applied matches in that category. Ranks on the display rating r: Bronze < 1400 ≤ Silver < 1550 ≤ Gold < 1700 ≤ Platinum < 1850 ≤ Diamond.
- Seed rating for a player with 0 matches (matchmaking only): Beginner 1325, Intermediate or none 1550, Advanced 1775, read from that activity's self-rated level.
- The rating number, deviation and volatility never appear in any API response or UI. Self-rated levels and badges are untouched.
- Functions: revoke from public/anon/authenticated, grant execute to service_role; migration header carries a recovery note.
- Label copy: "Gold · Doubles"; "Unranked" is never shown.

## Review Focus

1. A retry of the same result id (network retry from WDL-425) changes nothing the second time.
2. The same person on both teams, a duplicate within a team or the wrong team size is refused, never half-applied.
3. Two results for overlapping players applied concurrently both land (row locks in a fixed order, no deadlock or lost update).
4. A player who played long ago moves more on their next match than one who played yesterday.
5. A roster for a non-ranked activity (e.g. Workshop) shows no rank pills even if the person is ranked in pickleball.

---

### Task 1: Ratings schema, Glicko-2 step and apply-result

**Files:**
- Create: `supabase/migrations/20261103090000_ranked_ratings.sql`
- Test: `tests/ranked.test.mjs`

**Interfaces:**
- Produces: tables `app.ranked_formats(activity_key, format, name, team_size, sort_order)`, `app.ranked_ratings(user_id, activity_key, format, mu, phi, sigma, matches, last_played_at)`, `app.ranked_results(result_id uuid pk, activity_key, format, winners uuid[], losers uuid[], played_at, applied_at)`; `app.apply_ranked_result(p_result_id uuid, p_activity text, p_format text, p_winners uuid[], p_losers uuid[], p_played_at timestamptz) returns boolean` (true = applied, false = already applied; raises `ranked_invalid_result` otherwise); `app.ranked_display(p_mu double precision) returns double precision`.

- [ ] **Step 1: Write failing SQL tests** (synthetic users via the admin client, reads via `sql()`): `win raises the winner and lowers the loser`; `an upset moves both more than an expected result` (preset μ for an underdog vs favourite); `doubles moves all four and uses the team average` (same player gains less beside a stronger partner); `a retry of the same result changes ratings once`; `wrong team size, overlap and unknown format are refused and change nothing`; `idle time makes the next match move more`; `concurrent results for a shared player both apply`.
- [ ] **Step 2: Run** `RALLYPOINT_TEST_URL=http://127.0.0.1:3100 node --test tests/ranked.test.mjs` — expect FAIL (function missing).
- [ ] **Step 3: Write the migration.** Lock rating rows `for update` ordered by user_id after inserting the ledger row (`on conflict do nothing`, return false when nothing inserted). The volatility update uses the Glickman Illinois iteration (ε = 0.000001).
- [ ] **Step 4: Apply** with `pnpm db:migrate:local` and rerun — expect PASS.
- [ ] **Step 5: Commit** `feat(ranked): ratings and apply-result engine (WDL-420)`.

### Task 2: Ranks, seed rating and the reads

**Files:**
- Modify: `supabase/migrations/20261103090000_ranked_ratings.sql`
- Test: `tests/ranked.test.mjs`

**Interfaces:**
- Consumes: Task 1 tables.
- Produces: `app.ranked_rank(p_mu double precision, p_matches integer) returns text` (null when < 5); `app.visible_ranks(p_user uuid, p_activity text default null) returns jsonb` (array of `{"activity","format","rank"}` in activity then format order, ranked only); `app.ranked_seed_rating(p_user uuid, p_activity text, p_format text) returns double precision`; `api.read_profile`, `api.read_my_badges` gain `'ranks'`; `app.registration_view_before_split` roster entries gain `'ranks'` filtered to the session's activity.

- [ ] **Step 1: Failing tests:** `unranked until 5 matches and singles separate from doubles`; `rank names follow the thresholds` (1399.9 Bronze, 1400 Silver, 1550 Gold, 1700 Platinum, 1850 Diamond); `public profile shows ranked categories only and no numbers` (JSON contains none of `mu`, `phi`, `sigma`, `rating`); `roster shows ranks for the session's activity only`; `seed rating follows the self-rated level only before the first match`; `self-rated levels and badges are unchanged by results`.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement**, copying the current bodies of the three redefined functions from `20261102090000_more_badges.sql` and `20261024091000_one_name.sql` and adding only `ranks`.
- [ ] **Step 4: Apply and run** — expect PASS.
- [ ] **Step 5: Commit** `feat(ranked): public ranks on profiles and rosters (WDL-420)`.

### Task 3: Domain labels and the UI

**Files:**
- Create: `packages/domain/src/ranked.ts` (export in `packages/domain/package.json` as `./ranked`)
- Modify: `packages/domain/src/profile.ts` (`PublicProfile.ranks`), `packages/domain/src/badges.ts` (`BadgesView.ranks`), `packages/domain/src/registration.ts` (roster entry `ranks?`), `apps/web/src/badges.tsx` (`RankPill`, profile Ranked list), `apps/web/src/registration-panel.tsx`, `apps/web/src/game-day.tsx`
- Test: `tests/ranked-domain.test.mjs`

**Interfaces:**
- Produces: `type RankName = "Bronze" | "Silver" | "Gold" | "Platinum" | "Diamond"`; `interface RankedCategory { activity: string; format: string; rank: RankName }`; `rankedCategories(value: unknown): RankedCategory[]` (drops anything unknown, like `badgeStates`); `rankLabel(c: RankedCategory): string` → `"Gold · Doubles"`.

- [ ] **Step 1: Failing domain tests:** `rankLabel names rank and format`; `rankedCategories drops unknown ranks and shapes`.
- [ ] **Step 2: Run** `node --test tests/ranked-domain.test.mjs` — expect FAIL.
- [ ] **Step 3: Implement** the domain module; `RankPill` beside `TitlePill` on the roster and game-day rows; a "Ranked" list on the profile under Plays (activity name, rank label), hidden when empty. Text label carries the meaning (no colour-only status).
- [ ] **Step 4: Run** domain tests, `pnpm lint`, `pnpm typecheck` — expect PASS; check profile and roster on a 375px viewport with seeded synthetic results.
- [ ] **Step 5: Commit** `feat(ranked): rank labels on profiles and rosters (WDL-420)`.

### Task 4: Record and validate

- [ ] Add an "Implemented for review" note under D-26 context in `PRD.md` (one paragraph, builder's calls listed).
- [ ] Run the full suite `RALLYPOINT_TEST_URL=http://127.0.0.1:3100 pnpm test` and `pnpm check`; record results.
- [ ] Commit `docs(prd): note WDL-420 implementation for review`, push, open the PR, move WDL-420 to In Review.

---

## Amendment, 2026-11-03: medals, stars and calibration

The owner replaced the five ranks with Dota-2-inspired medals (design "Rating and medals"). Tasks 1–4 stand; Task 5 replaces the rank layer. Global Constraints change as follows: the hidden Glicko-2 rating is now the **skill**; a second hidden integer, the **standing**, is what players climb; nothing numeric is shown to anyone, owner included; the word "MMR" is never used.

### Task 5: Standing, medals and calibration

**Files:**
- Create: `supabase/migrations/20261103092000_ranked_medals.sql`
- Modify: `packages/domain/src/ranked.ts`, `apps/web/src/badges.tsx`, `tests/ranked.test.mjs`, `tests/ranked-domain.test.mjs`

**Interfaces:**
- Produces: column `app.ranked_ratings.standing integer` (null while calibrating); `app.ranked_target(p_mu double precision) returns integer` = max(0, round(2.5 × (display − 1000))); `app.ranked_next_standing(p_standing integer, p_matches integer, p_mu double precision, p_won boolean) returns integer` (null below 5 matches; at 5, min(target, 1499); after, max(0, standing ± 25 + clamp(round((target − standing) / 20), −10, 10))); `app.ranked_medal(p_standing integer) returns jsonb` `{"medal","stars"}` (Rookie, Contender, Challenger, Veteran, Elite at 500 each, stars = floor(standing mod 500 / 100) + 1; Master from 2500 with stars null); `app.visible_ranks` returns `{"activity","format","medal","stars"}` for calibrated categories; `app.my_ranks(p_user uuid) returns jsonb` adds `{"activity","format","calibrating":n}` for 1–4 matches, used by `api.read_my_badges`; `app.ranked_rank` dropped.
- Domain: `type MedalName = "Rookie" | "Contender" | "Challenger" | "Veteran" | "Elite" | "Master"`; `RankedCategory { activity; format; medal: MedalName; stars: number | null }`; `CalibratingCategory { activity; format; calibrating: number }`; `rankedCategories`, `calibratingCategories`, `rankLabel` ("Veteran ★★★ · Doubles", "Master · Doubles"), `rankSpoken` ("Doubles: Veteran, 3 of 5 stars", "Doubles: Master"), `calibratingLabel` ("Calibrating · 3 of 5").

- [ ] **Step 1: Failing tests:** `medals and stars follow the standing` (0 Rookie 1; 499 Rookie 5; 500 Contender 1; 1499 Challenger 5; 2499 Elite 5; 2500 Master null); `calibration places no higher than Challenger 5`; `after calibration a match moves about 25, leaning toward skill` (+25/−25 at target, +35/−15 well below target, floor 0); `the owner sees calibration and nobody else does`; profile secrets include `"standing"`; domain label/spoken/calibrating tests.
- [ ] **Step 2: Run** — expect FAIL.
- [ ] **Step 3: Implement** the migration (backfill calibrated rows to min(target, 1499)) and domain/UI.
- [ ] **Step 4: Run** focused tests, then the full suite and `pnpm check`; browser check at 375px.
- [ ] **Step 5: Commit** `feat(ranked): medals, stars and calibration (WDL-420)`.
