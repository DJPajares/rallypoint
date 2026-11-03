# Ranked Results Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record who won a played ranked match without a referee, and send each confirmed result to the rating engine exactly once ([WDL-425](https://linear.app/wwonderland/issue/WDL-425/ranked-results)).

**Architecture:**
- **One place for the result.** A match's result lives on `app.ranked_matches`.
- **Absence at check-in close.** Once check-in closes (start + 30 min), an absent player decides the match:
  - nobody checked in → void
  - one side has someone missing → the other side wins, with no dispute
  - both sides have someone missing → void
  - everyone checked in → a result must be reported

  The scheduled pass settles this, and so does any report or answer that arrives first.
- **Report and answer.** A checked-in player reports "we won" or "we lost". A checked-in player on the other side confirms or disputes. Silence for 48 hours confirms; a dispute voids the match. No report within 48 hours of the session's end voids it.
- **Finishing.** A finished match goes once to `app.apply_ranked_result` (keyed by the match id). Every seat is released, and both searches end with an outcome the Ranked page shows.

**Tech Stack:** Supabase Postgres (plpgsql), Hono API, Next.js client page, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-ranked-matchmaking-design.md` ("Results", "Calls made after the builder check").

## Global Constraints

- Only the winner is recorded; no game scores.
- The other side confirms or disputes within **48 hours**; silence confirms. A dispute voids the match: no rating change for anyone.
- No-show = loss, and the absent player can't dispute it. In doubles, one absent partner makes the team lose, and both partners lose rating. If nobody checked in, the match is void. A withdrawal after the cutoff is an absence.
- A match nobody reports within **48 hours after its session ends** is void.
- Confirmed results are final and reach the rating engine once.
- "No-show" never appears publicly; publicly it's just a loss.

## Builder's calls

- Reporting opens when check-in closes (start + 30 min), so absences are known first.
- Both sides with someone missing → void (nobody showed up properly on either side).
- The reporting side can't confirm its own report. If the other side reports the same winner, that counts as confirming; a different winner counts as a dispute.
- After a finished or void match, both searches end. The page says how the match went ("You won your last match", "You lost your last match", "You didn't check in, so your last match counted as a loss", "Your last match didn't count, so no ranks changed") and offers Search again.
- Every pass handles at most `p_limit` matches per sweep, like the other sweeps.

## Review Focus

1. A confirm retried by key, or the sweep running at the same moment as a confirm, must apply ratings once. *(Test: confirm, then run, then a repeat confirm; ratings `matches = 1`.)*
2. A report from the side that missed check-in must not overturn its loss. *(Test.)*
3. A report arriving before check-in closes is refused, not stored. *(Test.)*
4. After a void or a finish, the players can search again (seats released). *(Test: `start_search` works.)*
5. The word "no-show" stays out of public reads. *(Test on `read_profile`.)*

---

### Task 1: Results in the database

**Files:**
- Create: `supabase/migrations/20261103140000_ranked_results.sql`
- Modify: `packages/database/src/functions.ts`, `apps/api/src/ranked.ts`
- Test: `tests/ranked-results.test.mjs` (helpers copied from `tests/ranked-booking.test.mjs`)

**Interfaces:**
- **Columns:**
  - `ranked_matches.state` also allows `completed`/`void`.
  - New columns: `presence_settled_at`, `reported_side smallint`, `reported_winner smallint`, `reported_at`, `confirm_by`, `winner_side smallint`, `finished_at`.
  - `end_reason` also allows `disputed`/`unreported`/`absent`.
- **Internal:**
  - `app.match_absent(p_match) → table(side smallint, absent integer, present integer)`
  - `app.settle_presence(p_match) → void`, idempotent; it may finish or void the match
  - `app.finish_match(p_match, p_winner smallint)`: applies ratings, sets `completed`, releases seats, ends searches
  - `app.void_match(p_match, p_reason)`
- **API functions:**
  - `api.report_result(p_actor_id, p_key, p_match, p_won boolean)`
  - `api.answer_result(p_actor_id, p_key, p_match, p_agree boolean)`

  Errors: `result_not_open` (before check-in closes), `not_checked_in`, `result_settled`, `already_reported`, `nothing_to_answer`, `match_not_found`.
- **Sweeps** added to `api.run_matchmaking`: presence settling, silent confirms, unreported voids.
- **API routes:** `POST /ranked/matches/:match/report` `{operationKey, won}` and `/answer` `{operationKey, agree}`.
- **Reads:**
  - `app.match_view` gains `result: { state: "waiting" | "report" | "reported", reportedBy: "yours" | "theirs" | null, reportedWinner: "yours" | "theirs" | null, reportBy, confirmBy, canAct }`
  - `search_view.endReason` gains `match_won | match_lost | match_missed | match_void`

- [ ] **Step 1: Failing tests.**
  - report then confirm applies ratings once (retries and a pass don't repeat it)
  - 48 hours of silence confirms
  - a dispute voids with no rating change
  - an absent singles player loses at check-in close and can't report it away
  - doubles with one absent partner: the team loses and all four ratings move
  - nobody checked in → void
  - unreported 48 hours after the end → void
  - a settled result can't be changed
  - reporting before check-in closes is refused
  - players can search again afterwards
  - the outcome shows on the page read (`endReason`)
  - no "no-show" in `read_profile`
- [ ] **Step 2: Run them, and watch them fail.**
- [ ] **Step 3: Implement.**
- [ ] **Step 4: Run again; expect PASS.** Commit.

### Task 2: Report and confirm on the match card, and alerts

**Files:** `packages/domain/src/ranked-search.ts`, `packages/domain/src/ranked-alerts.ts` (kind `result`), `apps/web/src/ranked-page.tsx`, `apps/web/src/ranked-alerts.tsx`, `apps/web/src/ranked-labels.ts`; tests in `tests/ranked-alerts-domain.test.mjs` and `tests/ranked-labels.test.mjs`.

- [ ] **Failing tests:**
  - **Alerts:** `result` when `canAct` and the state is `report` (deadline `reportBy`), or `reported` by theirs (deadline `confirmBy`); nothing otherwise.
  - **Labels:** the four new end reasons.
- [ ] **Implement:**
  - **ResultPanel**
    - **report:** "Who won?" with **We won** / **We lost** ("I won" / "I lost" in singles), plus "Report by {date}. The other side confirms."
    - **reported by you:** "You reported a win/loss. If they don't answer by {date}, it stands."
    - **reported by them:** "They say {you won / they won}." with **Confirm** / **Dispute**, plus "A dispute means the match doesn't count for anyone."
  - **Alerts list:** a "Report the result" / "Confirm the result" item linking to /ranked.
- [ ] **Verify:** browser at 375px with synthetic accounts (report, confirm, outcome line). Commit.

### Task 3: Record

- [ ] Add the PRD D-26 "Implemented for review (WDL-425)" note, run the full suite, and commit.
