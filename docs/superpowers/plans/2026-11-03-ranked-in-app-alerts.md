# Ranked In-App Alerts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show what ranked play is waiting on the player: on Home, with each item's action and deadline, and as a count on the menu button that updates while the app is open ([WDL-423](https://linear.app/wwonderland/issue/WDL-423/ranked-in-app-alerts)).

**Architecture:** A pure domain function turns the existing `GET /api/ranked/search` read (`MySearch`) into a list of waiting items. A client provider in the shell owns one copy of that read for the signed-in person. It refreshes every 60 seconds while the page is visible, when the page becomes visible again, and on every route change, and it keeps the last good data between refreshes. Home lists the items with their actions. The floating menu shows the count on its button and lists the same items in its Updates sheet. No new server reads, nothing sent outside the app.

**Tech Stack:** TypeScript domain package, Next.js 16 client components, `node:test`.

**Spec:** `docs/superpowers/specs/2026-11-03-ranked-matchmaking-design.md`, "Alerts": in-app only, a Home alert with the action, and a count on the menu button for anything waiting on you, updating live while the app is open. Expiries never penalise anyone.

## Global Constraints

- In-app only: no email, no Web Push, no app-icon badge (owner, 2026-10-28 and 2026-11-03).
- Deadlines in the device's local time; no time zone named (D-13).
- Status is never colour alone; count changes are announced politely to screen readers.
- Expired items simply disappear, with no "missed" or penalty wording.
- Bounded: one read per open, visible tab per minute (D-08).

## Builder's calls

- **The items today:**
  - a proposed match you haven't answered
  - a doubles partner invite sent to you directly
  - the 3-day "look across the region" prompt

  "Court to book" (WDL-424) and "result to confirm" (WDL-425) join the same list when those reads exist. Each of those tasks adds its own kind.
- **"Live"** means polling every 60 seconds (the engine runs once a minute) plus refreshing on focus and route change. No realtime channel: the ranked tables aren't exposed to clients.
- **The Updates sheet** in the menu lists the same items, so the count on the menu leads somewhere. Its existing empty state stays for when nothing is waiting.

## Review Focus

1. A match accepted on the Ranked page must drop out of Home and the menu count without a reload. *(Task 2: refresh on route change; browser check.)*
2. A deadline passing while the app sits open must remove the item at the next refresh, not show an "expired" alert. *(Task 1 test: past deadlines are excluded.)*
3. A failed refresh must keep the last items rather than blank the count. *(Task 2: keep the last good data.)*
4. Two quick taps on Accept must not send two different answers. *(Task 2: the shared mutation hook ignores taps while busy.)*
5. Signed-out pages must not poll. *(Task 2: the provider only runs when signed in.)*

---

### Task 1: Waiting items from the ranked read

**Files:**
- Create: `packages/domain/src/ranked-alerts.ts`
- Modify: `packages/domain/package.json` (export `./ranked-alerts`)
- Test: `tests/ranked-alerts-domain.test.mjs`

**Interfaces:**
- Consumes: `MySearch`, `MatchView`, `SearchInvite` and `SearchView` from `@rallypoint/domain/ranked-search`.
- Produces:

```ts
export type RankedAlert =
  | { kind: "match"; key: string; matchId: string; format: SearchFormat; deadline: string }
  | { kind: "invite"; key: string; token: string; starterName: string; format: SearchFormat; deadline: string }
  | { kind: "widen"; key: string; searchId: string; regions: string[]; deadline: string };
export function rankedAlerts(mine: MySearch | null, now?: number): RankedAlert[];
```

  The `key` values are `match:<id>`, `invite:<token>` and `widen:<searchId>`. The list is sorted by deadline, soonest first.

- [ ] **Step 1: Failing tests**:
  - `nothing waiting gives an empty list`: null, and an empty `MySearch`, both give `[]`.
  - `an unanswered proposed match is waiting until its deadline`: proposed with `myAnswer` null and a future `respondBy` gives one `match` item with `deadline = respondBy`. Once accepted, past its deadline, confirmed or expired, it gives nothing.
  - `each live direct invite is waiting`: two invites with future `endsAt` give two `invite` items; a past `endsAt` is dropped.
  - `the widen prompt waits while the search runs`: `canWiden: true` gives a `widen` item with the search's `endsAt` as the deadline and its `regions`. `canWiden: false` gives nothing.
  - `items are ordered by deadline and keys are unique`.
- [ ] **Step 2: Run** `node --test tests/ranked-alerts-domain.test.mjs`. Expected: FAIL (module not found).
- [ ] **Step 3: Implement** `rankedAlerts`.
- [ ] **Step 4: Run again.** Expected: PASS.
- [ ] **Step 5: Commit**: `feat(ranked): waiting items from the ranked read (WDL-423)`.

### Task 2: Provider, Home list and menu count

**Files:**
- Create: `apps/web/src/ranked-alerts.tsx`
- Modify: `apps/web/src/shell.tsx` (wrap the app in `RankedAlertsProvider` when signed in)
- Modify: `apps/web/src/screens.tsx` (`HomeDashboard` renders `<RankedAlertList />` right after the hero)
- Modify: `apps/web/src/floating-menu.tsx` (count on the trigger and the Updates item; the Updates sheet lists the items)

**Interfaces:**
- Consumes: `rankedAlerts` (Task 1); the routes `POST /api/ranked/matches/:id/answer`, `POST /api/ranked/invites/:token` and `POST /api/ranked/search/:id/widen`; `useMutation`.
- Produces:
  - `RankedAlertsProvider({ enabled, children })`
  - `useRankedAlerts(): { alerts: RankedAlert[]; refresh(): void }`. Outside the provider it returns an empty list.
  - `RankedAlertList({ heading?: boolean })`

- [ ] **Step 1: Provider.**
  - Fetch `/api/ranked/search` with the session token.
  - Refresh:
    - every 60 s, but only while `document.visibilityState === "visible"`
    - on `visibilitychange` to visible
    - on `usePathname()` change
    - on `refresh()`
  - Keep the last good data on error. Do nothing when `enabled` is false.
- [ ] **Step 2: `RankedAlertList`.** With no items it renders nothing. Otherwise it renders a card section `Waiting on you (n)`, one `li` per item:
  - **match:** "{Singles|Doubles} match found · accept by {local date time}", with **Accept** (primary), **Decline**, and a **See the match** link to `/ranked`.
  - **invite:** "{starterName} invited you to play ranked Doubles · answer by {local date time}", with **Accept** (primary) and **Decline**.
  - **widen:** "No ranked match yet. Look across all of {the East region}?", with a **Look across …** button and "Your search runs until {date}".

  After an action, a `role="status"` line (focused, like `HomeInvites`) says "Match accepted." / "Match declined." / "Invite accepted." / "Invite declined." / "Now looking across {region}." Then it calls `refresh()`.
- [ ] **Step 3: Menu.**
  - When `n > 0`, the trigger's `aria-label` is "Open menu, {n} waiting".
  - A small count pill sits on the trigger, a number in text, `aria-hidden`.
  - A visually hidden `role="status"` span in the menu wrapper reads "{n} waiting" when n > 0 and nothing otherwise.
  - The Updates item label becomes "Updates ({n})".
  - The Updates sheet shows `RankedAlertList` without its heading when n > 0, else the existing empty state.
- [ ] **Step 4: Verify.**
  - Run `pnpm typecheck && pnpm lint`.
  - Browser at 375px, using a synthetic proposal for the signed-in local user:
    - Home shows the item and the menu shows 1.
    - Accept on Home removes both.
    - A new proposal created by SQL while Home is open appears within a minute without a reload.
    - Setting `respond_by` in the past removes it at the next refresh, with no penalty wording.
    - With nothing waiting, the empty state shows in Updates.
    - Reduced motion: the pill doesn't animate.
- [ ] **Step 5: Commit**: `feat(ranked): Home alerts and menu count (WDL-423)`.

### Task 3: Record

- [ ] Add an "Implemented for review (WDL-423)" note to the PRD D-26 row with the Builder's calls. Run the full suite `RALLYPOINT_TEST_URL=http://127.0.0.1:3100 pnpm test`. Commit `docs(prd): ranked alerts (WDL-423)`.
