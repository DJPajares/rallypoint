# Small Fixes Implementation Plan (rejoin, P-25, P-24, P-26)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove four dead ends:
- a player who withdrew can't rejoin;
- screens promise that organizers can add people to groups;
- groups can't be renamed or removed;
- drafts can't be deleted.

**Architecture:**
- Rejoining is a UI change: the server already allows a new active party once the old one has left.
- P-25 is copy only.
- P-24 adds `app.groups.archived_at`, plus owner-only `api.rename_group` and `api.archive_group` behind an "Edit group" screen.
- P-26 adds a draft-only `api.delete_draft` behind a "Delete draft" button. The draft's stored QR image is cleaned up best-effort.

**Tech Stack:** Next.js 16 App Router (`apps/web`), Hono + Zod (`apps/api`), Supabase Postgres plpgsql, `node --test`.

**Spec:** The Linear issues are the requirements:
- [WDL-400 P-25](https://linear.app/wwonderland/issue/WDL-400)
- [WDL-399 P-24](https://linear.app/wwonderland/issue/WDL-399)
- [WDL-401 P-26](https://linear.app/wwonderland/issue/WDL-401)
- Rejoin: owner-approved in chat on 2026-10-24 ("do all the mentioned small fixes in sequence"); the gap was found in the P-14 walkthrough.
- PRD RP-01, RP-02, RP-08 and D-13.

## Global Constraints

- **Branch:** `codex/small-fixes-rejoin-groups-drafts`, cut from `origin/main`.
  - Run `git branch --show-current` before every commit.
  - Run `gh pr view` before every push once a PR exists. Never push to a merged PR's branch.
  - Never push to `main`.
- D-13: plain words, no internal terms, no zone labels.
- Authorization is enforced at the trusted boundary: the actor comes from the verified session, and managers are `owner`/`organizer`/`cohost` in `app.group_roles`. **Rename and remove are owner-only.**
- Mutations follow the existing pattern:
  - The actor/key advisory lock comes first, then the group row, then the session row.
  - An `app.operation_receipts` row makes retries return the same result.
  - `check_violation` / `insufficient_privilege` / `P0001` messages map to plain API errors.
- New functions: `security invoker`, `search_path=''`, revoked from public, anon and authenticated, granted to service_role.
- History is kept. Archiving a group never deletes sessions, registrations, payments, attendance or badges. Only drafts are ever deleted.
- **Copy (verbatim):**
  - "Edit group"
  - "Remove group"
  - "Remove this group?"
  - "It disappears for everyone in it. Past sessions and badges stay."
  - "Cancel its upcoming sessions first."
  - "Delete draft"
  - "Delete this draft?"
  - "It can't be undone."
  - P-25 strings exactly as given in Task 2.
- Synthetic data only. Dev server at `http://127.0.0.1:3101`. Never reset the shared local DB. Apply migrations with `npx supabase migration up --local --include-all`.

## Review Focus

1. **A player who withdrew after the cutoff and rejoins:** their old record still shows its retained fee, the new join shows the normal fee terms, and the two stay separate. Test in Task 1.
2. **Archiving a group with an upcoming published session that has no bookings** must still be refused, because its link would stay joinable otherwise. Test in Task 3.
3. **Drafts in an archived group** must not linger on the Sessions tab. Test in Task 3.
4. **A delete racing a publish of the same draft** must leave either a published session or no session, never a published session that is then deleted. Test in Task 4.
5. **Renaming a group to blank or 101 characters** is refused without losing the typed value, and the new name shows on shared session pages. Tests in Task 3.

---

### Task 1: Rejoin after withdrawing

**Files:**
- Modify: `apps/web/src/registration-panel.tsx` (the `canJoin` rule, about line 270: `event.registrationWindow === "open" && (!own || released)`)
- Test: `tests/withdrawals.test.mjs` (add a case)

**Interfaces:** none new.

- [ ] **Step 1: Write the failing API-level test** `"a player who withdrew can join again and gets a new place in line"`.
  - Use `splitFixture({ feeMode: "fixed", total: "10.00", seats: [1], capacity: 2, cutoffPast: true })`.
  - Actor 0 withdraws, using the body from the existing withdraw test.
  - Actor 0 joins again (`f.join(actors[0])`). Expect 200, a new party id that differs from the old one, and `own.state === "confirmed"`.
  - In SQL, the old party is still `withdrawn` and its fee obligation is still `due` (retained after the cutoff). The new party has its own obligation.
  - The organizer's roster shows actor 0 once among confirmed parties.
- [ ] **Step 2:** Run `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/withdrawals.test.mjs`. Expected: it passes already, because the server allows rejoining. This test pins the server behaviour the UI change relies on. If it fails, stop and report NEEDS_CONTEXT.
- [ ] **Step 3: Widen `canJoin`** to `event.registrationWindow === "open" && (!own || released || own.state === "withdrawn")`.
  - The previous-registration card stays above the join form, with its fee line.
  - Change no other copy.
- [ ] **Step 4: Verify.**
  - Run the web typecheck and oxlint.
  - Browser check as the synthetic member on `http://localhost:3101`: withdraw from a session, see "Join this session" under the withdrawn card, join, and land on the game-day view.
- [ ] **Step 5: Commit:** `git commit -m "Let a player who withdrew join again"`.

---

### Task 2: Stop promising that organizers add people to groups (P-25)

**Files:**
- Modify: `apps/web/src/screens.tsx`:
  - line ~145 (`GroupCard`, member branch)
  - line ~219 (`HomeDashboard`, no groups)
  - line ~710 (`Workspace` empty state)
- Test: search `tests/` for the old strings. Update any that assert them.

- [ ] **Step 1: Replace the copy, exactly:**
  - `GroupCard` member note becomes: "Sessions from this group show on your Sessions tab."
  - `HomeDashboard` no-groups line becomes: "No groups yet. Start one to run sessions — sessions you join are on the Sessions tab."
  - `Workspace` empty state: title "No groups yet", body "Start a group to run sessions. Sessions you join are on the Sessions tab.". The action stays "Start a group".
- [ ] **Step 2: Verify.** Run `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test tests/pages.test.mjs tests/navigation.test.mjs`, the web typecheck and oxlint. Grep `apps/web/src` for "adds you to a group" (expect no matches).
- [ ] **Step 3: Commit:** `git commit -m "Say only what groups can do today"`.

---

### Task 3: Rename or remove a group (P-24)

**Files:**
- Create: `supabase/migrations/20261024110000_group_edit.sql`
- Modify: `apps/api/src/sessions.ts`: add routes next to `POST /groups`.
- Create: `apps/web/app/groups/[id]/edit/page.tsx` and an `EditGroup` component in `apps/web/src/screens.tsx`, next to `GroupSetup`.
- Modify: `GroupSetup` gets an "Edit group" link for `role === "owner"` only.
- Test: `tests/groups.test.mjs`. Create it, using `splitFixture` actors. An actor makes its own group with `POST /api/groups`, and the test cleans that group up (sessions, receipts, roles, group) in `t.after`.

**Interfaces:**
- **Column:** `app.groups.archived_at timestamptz` (nullable).
- **`api.rename_group(p_actor_id uuid, p_key uuid, p_group_id uuid, p_name text) returns jsonb`:**
  - The name is trimmed and must be 1–100 characters (same as `create_group`).
  - Owner only, otherwise `insufficient_privilege` `group_access_denied`.
  - An archived group gets `group_access_denied`.
  - Writes a receipt with action `rename_group`.
  - Returns `{ group: { id, name, role } }`.
- **`api.archive_group(p_actor_id uuid, p_key uuid, p_group_id uuid) returns jsonb`:**
  - Owner only.
  - Refused with `P0001` `group_has_upcoming` when the group has any session with `state = 'published'` whose `startsAt > now()`, booked or not.
  - Otherwise it sets `archived_at = now()`, writes a receipt with action `archive_group`, and returns `{ archived: true }`.
  - Retrying the same request returns the same result.
- **`create or replace` with the same bodies,** changing only:
  - `api.list_my_groups`: excludes `archived_at is not null`.
  - `api.read_group_setup`: an archived group gets `group_access_denied`.
  - `app.require_manager`: raises `group_access_denied` for an archived group, so no new sessions can be saved there.
  - `api.list_my_sessions`: a **draft** row whose group is archived is excluded. Copy the latest body from `supabase/migrations/20261023151000_my_sessions_cancelled_drafts.sql`.
- **Routes:**
  - `POST /api/groups/:id/rename` with `{ operationKey, name }`. Use the existing `groupName` Zod schema and its message "Use a group name of 1 to 100 characters."
  - `POST /api/groups/:id/archive` with `{ operationKey }`. `group_has_upcoming` maps to a 409 with "Cancel its upcoming sessions first."

- [ ] **Step 1: Write failing tests** in `tests/groups.test.mjs`:
  - `"the owner renames their group and the new name shows on its session page"`:
    - Rename gives 200.
    - `GET /api/workspace` lists the new name.
    - A published session in the group shows `groupName` as the new name on `GET /api/shared/{slug}`.
  - `"a blank or 101-character name is refused and nothing changes"`: both give 400, and the name is unchanged in SQL.
  - `"only the owner can rename or remove"`: give a second actor the `organizer` role in SQL. Rename and archive by them give 403, and a non-member gets 403.
  - `"a group with an upcoming session can't be removed, even with no bookings"`:
    - Publish a future session with no parties. Archive gives 409 with "Cancel its upcoming sessions first.", and `archived_at` is null.
    - Cancel the session (cancel route), and archive then gives 200.
  - `"a removed group disappears but keeps its history"`:
    - After archiving, `/api/workspace` omits it and `/api/groups/{id}/setup` gives 403.
    - Its past or cancelled session row and its parties still exist in SQL.
    - A draft in that group is absent from `GET /api/me/sessions` for the owner.
    - Saving a new session to it gives 403.
  - `"retrying a rename or removal returns the same result"`: send the same `operationKey` twice and get the same response.
- [ ] **Step 2:** Run `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/groups.test.mjs`. Expected: FAIL (404s).
- [ ] **Step 3: Write the migration and routes, apply them, and build the UI.**
  - `/groups/[id]/edit` sits behind `RequireAuth`. It uses `DetailPage` with back to `/groups/{id}`. It has:
    - **A "Group name" field** with Save and Cancel, using the existing `useMutation` so retries and recovery behave as elsewhere. Save returns to the group page.
    - **A "Remove group" section.** Its button opens a `Sheet` titled "Remove this group?" with the body "It disappears for everyone in it. Past sessions and badges stay." and two buttons: "Remove group" and "Keep it".
      - On success it goes to `/workspace`.
      - On 409 the error shows inside the sheet.
  - Non-owners who open the URL see the existing "Group unavailable" state (the setup read is manager-gated). The page shows the edit form only when `role === "owner"`.
- [ ] **Step 4:** Run the Step 2 command plus `tests/my-sessions.test.mjs tests/sessions.test.mjs tests/api.test.mjs`, then `pnpm db:lint`, the typechecks and oxlint. Browser check as the organizer on `http://127.0.0.1:3101`: rename a test group, then try removing one that has an upcoming session.
- [ ] **Step 5: Commit:** `git commit -m "Let a group owner rename or remove their group"`.

---

### Task 4: Delete a draft (P-26)

**Files:**
- Create: `supabase/migrations/20261024111000_delete_draft.sql`
- Modify: `apps/api/src/sessions.ts` (route) and `apps/api/src/payments.ts`.
  - Export `removeSessionImages(c, sessionId): Promise<void>`. It's best-effort: list the bucket under `${sessionId}/` and remove everything, never throwing, following `cleanUp`.
- Modify: `apps/web/src/session-pages.tsx` (`Editor`, shown only when `record.state === "draft"`).
- Test: `tests/sessions.test.mjs` (add cases) or a new `tests/drafts.test.mjs`.

**Interfaces:**
- **`api.delete_draft(p_actor_id uuid, p_key uuid, p_session_id uuid) returns jsonb`:**
  - **Locks:** actor/key advisory lock, then the session row `for update`, then `app.require_manager(actor, s.group_id)`.
  - **Refusals:**
    - Not a draft → `P0001` `not_a_draft`.
    - Not a manager → `group_access_denied`.
    - Missing → `insufficient_privilege` `session_unavailable`.
  - **Deletes,** in FK-safe order: the session's `payment_instruction_notices`, `payment_instructions`, `session_changes` and `operation_receipts` (where `resource_id` is the session), then the session.
  - **Retries:** writes a receipt with action `delete_draft`, keyed to the deleted id, so a retry returns `{ deleted: true }` instead of `session_unavailable`.
  - **Returns** `{ deleted: true, groupId }`.
  - Check every table with a `session_id` FK first, using `select conrelid::regclass from pg_constraint where confrelid='app.sessions'::regclass`. Delete only rows that can exist for a draft. If a non-draft table could hold rows for a draft, stop and report.
- **Route:** `POST /api/sessions/:id/delete` with `{ operationKey }`.
  - `not_a_draft` maps to a 409 with "Only a draft can be deleted. Cancel a published session instead."
  - After a successful delete, `await removeSessionImages(c, id)`.

- [ ] **Step 1: Write failing tests:**
  - `"an organizer deletes a draft and its payment details go with it"`:
    - Save a draft, save payment instructions on it, and upload a 1×1 PNG QR, following the P-22 browser-check script pattern.
    - Delete gives 200. The session, its instructions and receipts are gone in SQL, and the storage list under the id is empty.
    - `GET /api/sessions/{id}` gives 404 or 403.
  - `"a published session can't be deleted"`: delete gives 409, and the session is unchanged.
  - `"a non-manager can't delete a draft"`: gives 403.
  - `"a delete racing a publish leaves one outcome"`:
    - Fire publish and delete concurrently with `Promise.all`.
    - Either the publish succeeded and the session exists and is published, with the delete giving 409 or `stale_version`. Or the delete succeeded and the session is gone, with the publish giving 403 or 404.
    - Never "published" and "missing" at once.
  - `"retrying a delete returns the same result"`: send the same `operationKey` twice and both give 200.
- [ ] **Step 2:** Run the tests and confirm they fail.
- [ ] **Step 3: Implement the migration, route, helper and UI.**
  - In the draft editor, put a "Delete draft" button (secondary style) after the Save draft and Publish actions. It opens a `Sheet` titled "Delete this draft?" with the body "It can't be undone." and two buttons: "Delete draft" and "Keep it". Use `useMutation` for the call.
  - On success, `router.push("/groups/{groupId}")`.
- [ ] **Step 4:** Run the tests plus `tests/sessions.test.mjs tests/payment-instructions.test.mjs tests/my-sessions.test.mjs`, then `pnpm db:lint`, the typechecks and oxlint. Browser check: delete a test draft and confirm it leaves the group page.
- [ ] **Step 5: Commit:** `git commit -m "Let organizers delete a draft they no longer want"`.

---

### Task 5: Full checks

- [ ] **Step 1:** Run `RALLYPOINT_TEST_URL=http://127.0.0.1:3101 node --test --test-concurrency=1 tests/*.test.mjs`. Expected: all pass.
- [ ] **Step 2:** Stop the 3101 dev server, run `pnpm check` (expect exit 0), then restart the server.
- [ ] **Step 3:** No PRD change is needed. These are small fixes within RP-01, RP-02 and RP-08, and the PR description records them.

## Recovery

- **What changes:** the migrations add a nullable column and new functions, and replace four functions with the same bodies plus archived-group checks.
- **Rollback:** revert the app. The old code ignores `archived_at`. To restore an archived group, run `update app.groups set archived_at = null where id = …`.
- **What can't be undone:** deleted drafts are gone for good. They hold no registrations, payments or attendance by construction, because joining a draft is refused.
