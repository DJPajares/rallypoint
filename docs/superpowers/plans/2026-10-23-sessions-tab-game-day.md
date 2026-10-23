# Sessions Tab and Game-Day View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give everyone a Sessions tab listing their own sessions across groups, give joined players a quiet game-day session page, and add Open in Maps beside the venue.

**Architecture:**
- One new read-only plpgsql function, `api.list_my_sessions`, behind `GET /api/me/sessions`. It returns two bounded lists, with status computed on the server.
- Pure helpers in `packages/domain/src/my-sessions.ts` hold the labels, links, maps URL and the game-day rule, so they can be tested with `node --test`.
- The session page lifts the viewer's registration read out of `RegistrationPanel` into a signed-in child component. That component picks today's layout or the game-day layout.

**Tech Stack:** Next.js 16 App Router (`apps/web`), Hono + Zod (`apps/api`), Supabase Postgres, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-23-sessions-tab-game-day-design.md`

## Global Constraints

- D-13: plain words, no internal terms and no zone labels. Times show in the session's own local time.
- Status is always written in words. Colour only supports it.
- The new read never returns rosters, fees, payments or attendance.
- Bounds: up to **100** coming-up rows, the **20** most recent past rows, and `pastTotal` as the true count.
- "Ended" means `endsAt` has passed, except a cancelled session, which leaves Coming up once `startsAt` passes. No state-flip job.
- Inclusion: a `confirmed` or `waitlisted` party of yours, **or** an `owner`, `organizer` or `cohost` role in the session's group. Drafts are included only through that role.
- Status precedence: `cancelled` > `draft` > `organizing` > `in` / `waitlisted`.
- Maps link: `https://www.google.com/maps/search/?api=1&query=<encodeURIComponent(venue.trim())>`, opened in a new tab with `rel="noopener noreferrer"`. No link when the venue is blank.
- The game-day view applies only to a signed-in non-manager with a `confirmed` or `waitlisted` party on a `published` session that hasn't ended.
- Withdraw keeps its exact current wording and confirmation.
- Accessibility: 44px targets, visible focus, `aria-expanded` on disclosures and reduced motion respected.
- Synthetic data only. Never touch ports 3000 or 3100. Tests use `RALLYPOINT_TEST_URL=http://127.0.0.1:3101`. Stop the dev server before `pnpm check`.

## Review Focus

1. **Rejoining after leaving.** A player who withdrew (or was released) and joined again has two party rows. They must appear once, as You're in. Test added in Task 2.
2. **A draft with no date.** A manager's draft with an empty start must still list under Coming up, sorted last, and show "Date to be decided". Test added in Task 2.
3. **Venue text with `&`, `#`, commas, accents or emoji.** The maps link must encode it, never break the URL, and never inject a query parameter. Test added in Task 1.
4. **The exact end boundary.** At `now === endsAt` the session counts as ended. The game-day view switches off and the row moves to Past. Tests added in Tasks 1 and 2.
5. **Waitlist position after earlier parties leave.** The position counts only waitlisted parties still ahead of you. Test added in Task 2.

---

### Task 1: Domain helpers for my sessions

**Files:**
- Create: `packages/domain/src/my-sessions.ts`
- Modify: `packages/domain/package.json` (add `"./my-sessions": "./src/my-sessions.ts"` to `exports`, next to `"./run-again"`)
- Test: `tests/my-sessions-domain.test.mjs`

**Interfaces:**
- Produces:
  ```ts
  export type MySessionStatus = "in" | "waitlisted" | "organizing" | "draft" | "cancelled";
  export interface MySessionRow {
    id: string | null;          // drafts only
    slug: string;
    title: string;
    groupName: string;
    startLocal: string;         // "" when undecided
    startsAt: string | null;
    endsAt: string | null;
    timeZone: string;
    state: "draft" | "published" | "completed" | "cancelled";
    status: MySessionStatus;
    waitPosition: number | null;
  }
  export interface MySessions { upcoming: MySessionRow[]; past: MySessionRow[]; pastTotal: number }
  export function statusLabel(row: Pick<MySessionRow, "status" | "waitPosition">, past: boolean): string
  export function sessionHref(row: Pick<MySessionRow, "status" | "id" | "slug">): string
  export function mapsUrl(venue: string | undefined): string | null
  export function isGameDay(input: { state: string; endsAt?: string; canManage: boolean; ownState?: string }, now: number): boolean
  export function gameDayHeadline(own: { state: string; seats: number; queuePosition?: number | null }): string
  export function comingLine(confirmedSeats: number, capacity: number): string
  ```

- [ ] **Step 1: Write the failing tests** in `tests/my-sessions-domain.test.mjs`. Import from `../packages/domain/src/my-sessions.ts`.
  ```js
  test("labels say the status in words", () => {
    assert.equal(statusLabel({ status: "in", waitPosition: null }, false), "You're in");
    assert.equal(statusLabel({ status: "waitlisted", waitPosition: 2 }, false), "Waitlist #2");
    assert.equal(statusLabel({ status: "organizing", waitPosition: null }, false), "Organizing");
    assert.equal(statusLabel({ status: "draft", waitPosition: null }, false), "Draft");
    assert.equal(statusLabel({ status: "cancelled", waitPosition: null }, false), "Cancelled");
  });
  test("past labels read in the past", () => {
    assert.equal(statusLabel({ status: "in", waitPosition: null }, true), "You were in");
    assert.equal(statusLabel({ status: "waitlisted", waitPosition: 3 }, true), "Waitlisted");
    assert.equal(statusLabel({ status: "organizing", waitPosition: null }, true), "Organized");
    assert.equal(statusLabel({ status: "cancelled", waitPosition: null }, true), "Cancelled");
  });
  test("drafts open their editor, everything else the session page", () => {
    assert.equal(sessionHref({ status: "draft", id: "d1", slug: "s1" }), "/sessions/d1/edit");
    assert.equal(sessionHref({ status: "in", id: null, slug: "s1" }), "/s/s1");
    assert.equal(sessionHref({ status: "organizing", id: null, slug: "s1" }), "/s/s1");
  });
  test("maps link searches the venue text and encodes it", () => {
    assert.equal(mapsUrl("  Synthetic Courts, Court 3 "),
      "https://www.google.com/maps/search/?api=1&query=Synthetic%20Courts%2C%20Court%203");
    const tricky = new URL(mapsUrl("A&B #2 café 🏓 &api=2"));
    assert.equal(tricky.origin + tricky.pathname, "https://www.google.com/maps/search/");
    assert.deepEqual([...tricky.searchParams.keys()], ["api", "query"]);
    assert.equal(tricky.searchParams.get("query"), "A&B #2 café 🏓 &api=2");
    assert.equal(mapsUrl(""), null);
    assert.equal(mapsUrl("   "), null);
    assert.equal(mapsUrl(undefined), null);
  });
  test("game day is for joined players before the end", () => {
    const end = "2026-10-31T03:00:00Z", t = Date.parse(end);
    const base = { state: "published", endsAt: end, canManage: false };
    assert.equal(isGameDay({ ...base, ownState: "confirmed" }, t - 1), true);
    assert.equal(isGameDay({ ...base, ownState: "waitlisted" }, t - 1), true);
    assert.equal(isGameDay({ ...base, ownState: "confirmed" }, t), false);
    assert.equal(isGameDay({ ...base, ownState: "withdrawn" }, t - 1), false);
    assert.equal(isGameDay({ ...base, ownState: undefined }, t - 1), false);
    assert.equal(isGameDay({ ...base, canManage: true, ownState: "confirmed" }, t - 1), false);
    assert.equal(isGameDay({ ...base, state: "cancelled", ownState: "confirmed" }, t - 1), false);
  });
  test("headline and coming line", () => {
    assert.equal(gameDayHeadline({ state: "confirmed", seats: 1 }), "You're in");
    assert.equal(gameDayHeadline({ state: "confirmed", seats: 2 }), "You're in, with 1 guest");
    assert.equal(gameDayHeadline({ state: "waitlisted", seats: 2, queuePosition: 2 }), "Waitlist #2");
    assert.equal(comingLine(12, 16), "12 of 16 coming");
    assert.equal(comingLine(1, 8), "1 of 8 coming");
  });
  ```

- [ ] **Step 2: Run them and confirm they fail**
  Run: `node --test tests/my-sessions-domain.test.mjs`
  Expected: FAIL, because the module cannot be resolved.

- [ ] **Step 3: Implement `packages/domain/src/my-sessions.ts` and the package export.**
  - Use `URLSearchParams` (`api=1`, `query=<trimmed>`) and then replace `+` with `%20`, so the first test's exact string holds.
  - In `isGameDay`, a published session whose `endsAt` is missing or unparseable counts as not ended.

- [ ] **Step 4: Run them and confirm they pass**
  Run: `node --test tests/my-sessions-domain.test.mjs`
  Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**
  ```bash
  git add packages/domain/src/my-sessions.ts packages/domain/package.json tests/my-sessions-domain.test.mjs
  git commit -m "Name a person's session status, maps link and game-day rule in one place"
  ```

---

### Task 2: List my sessions, server side

**Files:**
- Create: `supabase/migrations/20261023150000_my_sessions.sql`
- Modify: `apps/api/src/index.ts`. Add the route next to `app.get("/dues", …)`, in the same style as `/dues` and `/workspace`.
- Test: `tests/my-sessions.test.mjs`

**Interfaces:**
- Consumes: the `MySessions` shape from Task 1. The JSON keys match it exactly.
- Produces: `GET /api/me/sessions` returns `200 { upcoming, past, pastTotal }`, and `401` signed out. The database function is `api.list_my_sessions(p_actor_id uuid) returns jsonb`.

**SQL rules** (security invoker, `search_path=''`, `revoke … from public, anon, authenticated`, `grant execute … to service_role`, as in `list_my_groups`):
- **Candidate sessions** are those in a group where the actor's `app.group_roles.role in ('owner','organizer','cohost')`, plus those where an `app.parties` row has `user_id = actor` and `state in ('confirmed','waitlisted')`. Take one row per session with `distinct` or `exists`; never join parties directly into the output.
- **Status:**
  - `cancelled` when `s.state = 'cancelled'`.
  - Else `draft` when `s.state = 'draft'`.
  - Else `organizing` when the actor manages the group.
  - Else `in` if the active party is confirmed, otherwise `waitlisted`.
- **`waitPosition`** applies only when the status is `waitlisted`. It is `count(*) + 1` of the same session's `waitlisted` parties with a smaller `queue_sequence`, the same formula as the email worker.
- **`over`:**
  - A draft is never over.
  - A cancelled session is over when `startsAt <= now()`.
  - Anything else is over when `endsAt <= now()`.
  - A missing time counts as not over.
- **`upcoming`** is the rows that aren't over, ordered by `startsAt` ascending with nulls last, then title, limited to 100.
- **`past`** is the rows that are over, ordered by `startsAt` descending, limited to 20. **`pastTotal`** is the count of every row that's over.
- **Fields per row:**
  - `id` (the session id when it's a draft, else null)
  - `slug`
  - `title` from `details->>'title'`
  - `groupName` from `g.name`
  - `startLocal` from `coalesce(details->>'startLocal','')`
  - `startsAt`, `endsAt` and `timeZone` from details
  - `state`, `status` and `waitPosition`

- [ ] **Step 1: Write the failing tests** in `tests/my-sessions.test.mjs`.
  - Use `splitFixture(t, { feeMode: "fixed", total: "10.00", seats: [1], capacity: 1 })` from `tests/helpers/split-fixtures.mjs`.
  - Actor 0 holds the only seat. Actor 1 joins and waits. Actor 2 stays an outsider.
  - For manager cases, actor 2 creates its own group with `POST /api/groups` (`{ operationKey, name: "Synthetic my-sessions group" }`). Read the group id from the response. Create a published session and a draft with an empty `startLocal` there through `POST /api/groups/{id}/sessions` (`intent: "publish"`, and `"draft"`).
  - Register a `t.after` that deletes that group's `operation_receipts` (by resource id), `session_changes`, `sessions`, `group_roles` and `groups` rows. It must not depend on hook order.
  - Copy the withdraw request body from `tests/withdrawals.test.mjs`, and the cancel call from `tests/cancellations.test.mjs`.
  - Helper: `const mine = async (a) => (await f.get(a, "/api/me/sessions")).json();` and `const find = (list, slug) => list.find((r) => r.slug === slug);`.
  ```js
  test("signed out is refused", async (t) => {
    const f = await splitFixture(t, { feeMode: "fixed", total: "10.00", seats: [1], capacity: 1 });
    assert.equal((await f.get(null, "/api/me/sessions")).status, 401);
  });
  test("a player sees only sessions they're in or waiting for", async (t) => {
    // actor 0 confirmed, actor 1 waitlisted at position 1, actor 2 nothing
    // assert find(mine(actor0).upcoming, slug).status === "in", waitPosition === null
    // assert find(mine(actor1).upcoming, slug) has status "waitlisted", waitPosition 1
    // assert mine(actor2).upcoming has no row with this slug, and no row from firstGroup at all
    // assert Object.keys(row).sort() deep-equals the 11 MySessionRow keys, sorted (no fee/roster/attendance)
  });
  test("leaving removes the session; rejoining lists it once", async (t) => {
    // actor 0 withdraws -> absent from mine(actor0); actor 1 is promoted -> status "in"
    // actor 0 joins again (waits) -> exactly one row for slug, status "waitlisted", waitPosition 1
  });
  test("waitlist position counts only parties still ahead", async (t) => {
    // capacity 1, actor 0 confirmed; actors 1 and 2 join and wait (positions 1 and 2)
    // actor 1 leaves the waitlist -> actor 2 now waitPosition 1
  });
  test("managers see their group's sessions and drafts, outsiders don't", async (t) => {
    // in actor 2's own group: published row status "organizing"; draft row status "draft", id equals the draft id, startLocal ""
    // the draft is last in upcoming
    // actor 0 (no role there) sees neither row
  });
  test("cancelled stays in coming up until start, then moves to past", async (t) => {
    // organizer cancels the fixture session -> actor 0 row status "cancelled" in upcoming
    // set details startsAt to now-1m via SQL with protect_booked_session disabled -> row is in past, pastTotal >= 1
  });
  test("a session moves to past exactly at its end", async (t) => {
    // set startsAt now-2h and endsAt to clock_timestamp() via SQL -> row in past, not upcoming
  });
  ```
  The comments name the assertions. Write each as real `assert` calls with those values.

- [ ] **Step 2: Run them and confirm they fail**
  Run: `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/my-sessions.test.mjs`
  Expected: FAIL. The signed-out case gets `404` instead of 401 before the route exists.

- [ ] **Step 3: Write the migration and the route.**
  - Apply with `npx supabase migration up --local --include-all`. The local database is shared, so never reset it.
  - Route: `app.get("/me/sessions", requireUser, …)` calls `db.rpc("list_my_sessions", { p_actor_id })`. On error it throws `ApiError(503, "service_unavailable", "Your sessions could not be loaded. Please try again.")`, and returns `json(data)`.

- [ ] **Step 4: Run them and confirm they pass**
  Run: the Step 2 command, then `pnpm db:lint` if README lists it.
  Expected: PASS, 7 tests, and lint clean.

- [ ] **Step 5: Commit**
  ```bash
  git add supabase/migrations/20261023150000_my_sessions.sql apps/api/src/index.ts tests/my-sessions.test.mjs
  git commit -m "List a person's own sessions across groups, nothing else"
  ```

---

### Task 3: The Sessions tab

**Files:**
- Modify: `apps/web/src/screens.tsx` (`SessionsPage`, about lines 223–243)
- Modify: `apps/web/src/styles/pages.css` (row-link styles)

**Interfaces:**
- Consumes: `GET /api/me/sessions` (Task 2), plus `statusLabel` and `sessionHref` (Task 1). Also `Ticket`, `fromLocal`, `EmptyState`, `Pending`, `Notice`, `useApi` and `useFrame().openCreate`, which already exist.

- [ ] **Step 1: Replace the placeholder `SessionsPage`.**
  - The `h1` stays "Sessions".
  - **Coming up:** a `section-head` titled "Coming up", then one row per `upcoming` item.
  - **Each row** is a single `<Link href={sessionHref(row)}>` wrapping a `Ticket`:
    - `date={fromLocal(row.startLocal)}`
    - an `rp-badge` with `statusLabel(row, false)`
    - an `h3` with the title, or "Untitled session"
    - a meta line `"<time> · <groupName>"`, using `fromLocal(...)?.time` or "Date to be decided"
    - The whole card is the tap target, with a visible focus ring.
  - **Past:** when `pastTotal > 0`, a button `"Past sessions (<pastTotal>)"` with `aria-expanded` reveals the `past` rows, using `statusLabel(row, true)`.
  - **Empty** (no upcoming and no past): `EmptyState` with the title "Nothing coming up" and the body "Sessions you join or run will show here."
    - If `/api/workspace` shows any non-member role, add the primary "New session" button calling `openCreate`, as on Home.
  - **Loading:** `Pending` with "Finding your sessions…". **Error:** `Notice` with retry.

- [ ] **Step 2: Verify the deep link still renders.**
  Run: `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test tests/pages.test.mjs tests/navigation.test.mjs`
  Expected: PASS.

- [ ] **Step 3: Check it in the browser** at `http://127.0.0.1:3101/sessions`, at phone width (375×812) and on desktop.
  - As the synthetic organizer, rows show Organizing, and a draft opens its editor.
  - As a synthetic player with one confirmed and one waiting session, the rows show You're in and Waitlist #n, and each opens its session page.
  - Past expands and collapses with the keyboard.
  - Signed out, the page sends you to sign-in and returns you to `/sessions`.

- [ ] **Step 4: Commit**
  ```bash
  git add apps/web/src/screens.tsx apps/web/src/styles/pages.css
  git commit -m "Show your sessions across groups on the Sessions tab"
  ```

---

### Task 4: Open in Maps beside the venue

**Files:**
- Modify: `apps/web/src/session-pages.tsx`. In `SharedSessionPage`, the `rp-ticket__meta` venue line, about line 818.

**Interfaces:**
- Consumes: `mapsUrl` (Task 1).

- [ ] **Step 1: Add the link.**
  - Under the venue text, when `mapsUrl(d.location)` isn't null, render `<a className={buttonClass({ variant: "link" })} href={url} target="_blank" rel="noopener noreferrer">Open in Maps</a>`, with a map-pin icon from the existing icon set marked `aria-hidden`.
  - It shows for every viewer of `/s/{slug}`. Nothing changes in the editor or on the group page.

- [ ] **Step 2: Check it in the browser.**
  - Signed out and as the organizer, the link opens a Google Maps search for the venue in a new tab.
  - A session with a blank venue shows no link.

- [ ] **Step 3: Commit**
  ```bash
  git add apps/web/src/session-pages.tsx
  git commit -m "Open a session's venue in Maps"
  ```

---

### Task 5: The game-day view for joined players

**Files:**
- Modify: `apps/web/src/session-pages.tsx` (`SharedSessionPage`)
- Modify: `apps/web/src/registration-panel.tsx` (`RegistrationPanel`)
- Modify: `apps/web/src/styles/pages.css`

**Interfaces:**
- Consumes: `isGameDay`, `gameDayHeadline` and `comingLine` (Task 1).
- Produces: new `RegistrationPanel` props, replacing its own fetch:
  ```ts
  {
    event: SharedSession;
    view: RegistrationView | null;
    loading: boolean;
    error: string | null;
    onRefresh: () => void;                       // clears the lifted "changed" value and retries
    onChanged: (view: RegistrationView) => void; // replaces setChanged
    onChange: () => void;                        // unchanged: refreshes the shared read
    gameDay?: { details: ReactNode; notes: ReactNode; more: ReactNode };
  }
  ```

- [ ] **Step 1: Lift the registration read, with no visible change yet.**
  - Split `SharedSessionPage`'s JSX into local components: `SessionHead` (kicker, title, activity, state notice, ticket), `Availability` (the spots card), `SessionFacts` (the `dl.facts`) and `GoodToKnow`.
  - Signed out, the page composes them exactly as today.
  - Signed in, render a new `SignedInSession({ shared, onChange })` child. It owns `useApi<{ registration: RegistrationView }>(\`/api/registrations/${slug}\`)` and `const [changed, setChanged] = useState<RegistrationView | null>(null)`, and passes `view = changed ?? data.registration` to the panel.
  - Remove the panel's own `useApi` and `changed` state. Every former `setChanged(x)` becomes `onChanged(x)`, and `refresh()` becomes `onRefresh()`.
  - Keep the `key={session.user.id + slug}` on the signed-in child.

- [ ] **Step 2: Confirm today's behavior is unchanged.**
  Run: `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/registrations.test.mjs tests/withdrawals.test.mjs tests/pages.test.mjs`
  Expected: PASS.
  - Then, in the browser, join, withdraw, use "Check your request" (block `/api/registrations/*` once to see it), and confirm the status heading still takes focus.

- [ ] **Step 3: Add the game-day layout.**
  - In `SignedInSession`, compute `isGameDay({ state: shared.state, endsAt: d.endsAt, canManage: view.canManage, ownState: view.own?.state }, now)`.
    - `now` comes from a one-minute `setInterval`, as in the panel, so the layout switches off at the end.
  - **When true**, render `SessionHead` without its ticket, then `<RegistrationPanel … gameDay={{ details, notes, more }} />`, where:
    - `details` is the time line (start–end plus date) and the venue with its Task 4 maps link.
    - `notes` is `<GoodToKnow/>`, or null.
    - `more` is `<Availability/>` plus `<SessionFacts/>`.
  - **When false**, the layout is today's, unchanged.
  - **In the panel, when `gameDay` is set**, render in this order:
    1. The status banner. Its `h2` text is `gameDayHeadline(own)`, it keeps the heading ref and focus, and the session date sits under it.
    2. `gameDay.details`.
    3. **Who's coming:** `comingLine(view.counts.confirmedSeats, Number(d.capacity))`. When `view.rosterAllowed`, a "See who's coming" button with `aria-expanded` reveals the existing roster list.
    4. The fee block: the existing fee paragraph, `SplitFee`, `HowToPay` and `SentNote` logic, unchanged. It is omitted when `!tracked`. A waitlisted party without `own.fee` and without `own.splitClaim` shows nothing.
    5. `gameDay.notes`.
    6. **More:** a `<details>`/`<summary>` row labelled "More" holding `gameDay.more`, the `ShareButton` and the existing withdraw `actionArea`.
       - On phones, don't render the sticky bar in game-day mode.
       - The withdraw trigger and sheet sit inside More.
       - `mutation.error` and `mutation.recovery` render directly above More, so a failed or uncertain request stays visible.
  - Don't render the old waitlist explainer paragraph in game-day mode. It's join-time text, and More keeps the terms.

- [ ] **Step 4: Check it in the browser** at phone width and on desktop, with synthetic accounts.
  - A confirmed player sees, in order: You're in, the time, the place with Open in Maps, "n of m coming" with See who's coming, the fee line, Good to know, then More. Withdraw inside More works, and the page goes back to today's layout.
  - Joining from today's layout switches straight to game day, with focus on the banner.
  - A waitlisted player sees Waitlist #n, the count and no roster.
  - A split session shows the existing estimate. A "Not tracked here" session shows no fee row.
  - The organizer, a signed-out visitor and a player who withdrew see today's page.
  - Move a test session's end into the past with SQL (trigger disabled, as in the fixture). Within a minute the page shows today's layout and its finished notice.

- [ ] **Step 5: Commit**
  ```bash
  git add apps/web/src/session-pages.tsx apps/web/src/registration-panel.tsx apps/web/src/styles/pages.css
  git commit -m "Lead the session page with what a joined player needs on game day"
  ```

---

### Task 6: Record it and run the adopted checks

**Files:**
- Modify: `PRD.md`. Add one "Implemented for review, 2026-10-23 (P-14)" line under RP-16, pointing to the spec and stating the builder's calls from the spec's last section. This records implementation, not acceptance.

- [ ] **Step 1: Add the PRD note.**
- [ ] **Step 2: Run the full suite**
  Run: `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/*.test.mjs`
  Expected: all pass. Note any known-flaky email-dispatch rerun.
- [ ] **Step 3: Stop the 3101 dev server, then run `pnpm check`**
  Expected: lint, typecheck and build pass. Restart the server afterwards.
- [ ] **Step 4: Remove synthetic rows** left by failed runs (sessions titled "Synthetic …" in the test groups), only if the suite left any.
- [ ] **Step 5: Commit**
  ```bash
  git add PRD.md
  git commit -m "Note the Sessions tab and game-day view for review"
  ```
