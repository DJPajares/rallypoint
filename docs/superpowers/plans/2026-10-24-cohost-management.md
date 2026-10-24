# Co-host Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Let a group owner grant and remove co-host access using people who have registered for that group's sessions.

**Architecture:** Keep role authority in transactional Postgres functions called through the existing Prisma allowlist. Add an owner-only management page using the existing authenticated reads and recoverable mutation hook. Serialize changes on the group lock already used by manager mutations, preserve prior membership, and return current state on receipt recovery.

**Tech Stack:** Existing Next.js App Router/React/TypeScript, Hono/Zod, Prisma PostgreSQL function adapter, Supabase Postgres/Auth, Node integration tests. No new dependencies or provider resources.

**Spec:** [P-15 / WDL-390](https://linear.app/wwonderland/issue/WDL-390), `PRD.md` RP-01, D-01 and D-20. On 2026-10-24 the owner accepted the proposed past-registrant approach and selected P-15 in chat. The implementation details below are routine choices within that accepted scope.

## Global Constraints

- The owner picks a person from those who have registered for one of the group's sessions and makes them co-host, or removes a co-host.
- Changes take effect immediately at the trusted boundary; the acting role is shown; last-owner protection is kept.
- Invitations, general membership entry, ownership transfer, and member removal remain excluded.
- Membership and event registration are independent. Granting and removing co-host access must not silently create ordinary membership.
- Candidate labels contain current display names, never email addresses or other contact details. Link names with the existing public profile handle.
- Keep existing organizer/co-host capabilities; only the owner can change co-host assignments.
- SQL migrations remain the schema/function/grant authority. No Prisma model writes, historical migration edits, hosted migrations, deployment, or spending.
- Preserve all registrations, seats, queue positions, payment/attendance records and delivery history.
- The existing isolated worktree is on the issue-supplied branch `djpajares/wdl-390-p-15-let-a-group-owner-make-someone-a-co-host`.

## Review Focus

1. A co-host may previously have been a member or a nonmember: removal restores exactly that prior ordinary membership, without changing participation.
2. A stale grant request must not regrant access after another owner removes it; same-key replay only reads the current state.
3. A previously authorized co-host may have an open manager page and successful operation receipts: subsequent privileged requests and receipt reads must recheck the role.
4. Two people can have the same name, and a profile name can change: account selection must use a stable profile handle and names must use current profile data.
5. Groups can have no registrants or more candidates than fit on a phone: show a useful empty state and bounded pagination, without leaking candidates from another group.

---

## Task 1: Transactional owner-only co-host API

**Files:**
- Create: `supabase/migrations/20261024121000_cohost_management.sql` (choose a later unused timestamp if execution reveals newer migrations).
- Create: `apps/api/src/cohosts.ts`.
- Modify: `apps/api/src/index.ts`, `packages/database/src/functions.ts`, `packages/domain/src/contracts.ts`.
- Create: `tests/cohosts.test.mjs`.
- Modify: `docs/foundation-api.md`, `PRD.md` RP-01/D-01.

**Interfaces:**
- `GET /api/groups/:id/cohosts?after=<profileId>` returns `{ cohosts: GroupCohosts }` to the current owner only.
- `POST /api/groups/:id/cohosts` accepts `{ operationKey, profileId, action: "add" | "remove", revision }`; returns `{ operationKey, cohosts: GroupCohosts }`.
- `GroupCohosts` contains `group: GroupSummary` (acting role `owner`), `revision: string`, `assigned: CohostPerson[]`, `candidates: CohostPerson[]`, and `nextCursor: string | null`.
- `CohostPerson` contains only `profileId` and `name`. Use the stable public profile handle as the target; never accept a caller-supplied actor or role.
- `api.read_group_cohosts(p_actor_id uuid, p_group_id uuid, p_after uuid)` and `api.update_group_cohost(p_actor_id uuid, p_key uuid, p_group_id uuid, p_profile_id uuid, p_action text, p_revision text)` are the new allowlisted functions.
- Existing `GET /api/operations/:key` recognizes `update_group_cohost`, rechecks current owner authority, and returns the same result envelope with current co-host state.

- [x] **Write behavioral integration tests before production code.** Reuse the synthetic login/request/cleanup patterns in `tests/sessions.test.mjs`; create disposable groups through the real API. Use local SQL only for deterministic fixtures and inspecting persisted invariants.
  - Owner grants a current member who registered, and separately a nonmember registrant; each gains manager access only in the selected group.
  - Removal restores the member role for the first person and no group role for the second. Registrations, fees, payment markers and attendance remain unchanged.
  - Confirmed, waiting and historical registrants are eligible; guests, unrelated accounts, and people tied only to another group are not candidates. Existing co-hosts remain removable even without registration history.
  - Signed-out requests return 401; member, organizer, co-host and unrelated identities get 403 for reads/writes/recovery. Denials leave roles and audit records unchanged.
  - Owner and organizer targets cannot be changed by either action, including direct requests; the owner role remains intact.
  - Metadata actor/role spoofing cannot change authority. Browser roles cannot call backend functions or read/write role/audit tables.
  - Repeated/concurrent same-key grants produce one role change and one audit record. A key reused with different details returns 409 `idempotency_conflict`.
  - Requests with an old revision return 409 `stale_cohosts`. Replay of an earlier grant after removal returns current state and cannot restore the role.
  - Revoked co-host access is denied on the next manager read/write and earlier manager receipt recovery. A group-lock race with removal must serialize coherently.
  - Audit rows preserve actor ID, target ID, before/after roles and server time; a no-op must not invent another change.
  - Current names and profile handles survive duplicate names/name changes; responses contain no contact information. Candidate pages have 50 entries and an explicit next cursor; all candidates can be reached without duplicates. Assigned co-hosts remain separate from candidates.
  - Invalid UUID/action/revision/body shape returns a bounded client error; private success and denial responses use `no-store`.
- [x] **Run red:** with the local app/database available, run `node --test tests/cohosts.test.mjs`. Confirm failures are missing-route/behavior failures rather than fixture/setup failures.
- [x] **Implement the migration.** Add an append-only, RLS-protected `app.group_cohost_changes` audit table with a monotonic ID, group/actor/target, prior role, resulting role and server timestamp. Grant only the required backend privileges. Derive the group's opaque revision from its latest audit ID (`"0"` initially). On removal, restore the prior member role from the most recent recorded grant, or delete the role if no prior membership existed; a pre-existing co-host with no P-15 grant history returns to no role. Do not change owners or organizers.
- [x] **Implement the SQL functions.** Lock actor/request key, then group; recheck owner authority under the lock. Compare the requested revision before a new change. Validate target eligibility in SQL, not only against UI choices. Use current profiles for names; ensure existing role/registration identities have profile rows without deriving labels from contact details. Page candidates in stable profile-ID order. Append the audit and receipt atomically with the role change. Same-key replay validates the original payload but returns current state without reapplying it. Extend `api.read_operation` using the repository's wrapper pattern and retain all previous action recovery.
- [x] **Implement the Hono module and bound Prisma entries.** Reuse `requireUser`, `uuidParam`, bounded `readBody`, Zod parsing, `json`, and existing unsupported-method handling. Map owner denial to 403 `group_owner_required`, stale state/key conflicts to 409, ineligible targets to 409 `cohost_not_eligible`, malformed input to 422 and infrastructure failure to 503. Update shared operation recovery mapping for the new owner-denial error without changing other routes.
- [x] **Record the accepted policy and API contract.** Amend RP-01/D-01 with the dated owner acceptance; retain the open general membership/invitation decisions. Document inputs, owner-only access, paging, retry/conflict semantics and error codes in `docs/foundation-api.md`.
- [x] **Run green:** `node --test tests/cohosts.test.mjs tests/api.test.mjs tests/prisma.test.mjs`, followed by the full adopted suite during Task 3.
- [x] **Checkpoint:** review the diff and current branch; commit the cohesive API change if repository delivery is available.

## Task 2: Small owner management flow

**Files:**
- Create: `apps/web/app/groups/[id]/cohosts/page.tsx`.
- Create: `apps/web/src/cohost-management.tsx`.
- Modify: `apps/web/src/screens.tsx` (owner entry point and acting-role label only).
- Modify: `apps/web/src/styles/pages.css` only if existing layout classes cannot accommodate the view.

**Interfaces:**
- The group page shows its acting role and an owner-only **Co-hosts** link to `/groups/:id/cohosts`.
- `CohostManagement` uses `useApi<{ cohosts: GroupCohosts }>` and `useMutation<{ operationKey: string; cohosts: GroupCohosts }>`.
- Mutations use exactly the `profileId`, action and revision read from the current state. Successful changes reload current state and restore focus to a sensible remaining control.

- [x] **Read relevant local Next.js guides** under `apps/web/node_modules/next/dist/docs/` before editing App Router files, and check current official documentation only for APIs that need clarification. Reuse the existing route/Auth/Suspense/DetailPage pattern.
- [x] **Establish the failing UI behavior in the browser.** As a synthetic owner, verify the current group has no co-host management entry. Do not add an end-to-end test framework for this change.
- [x] **Implement the screen using existing UI primitives.** Show the group name, **Owner** acting-role label, current co-hosts with **Remove co-host**, and candidates with **Make co-host**. Display names link to their public profiles. Include one plain explanation of co-host capabilities, an empty candidate state explaining that people appear after registering, and **Load more** when another page exists. No contact search, invitations, membership editor, ownership transfer or redesign.
- [x] **Keep changes deliberate and recoverable.** Confirm removal with the existing accessible Sheet pattern, naming the person and lost management access. Disable competing changes during pending/uncertain writes. Keep the submitted request in `useMutation`; retain **Check result** and **Retry same request**. For stale-state errors offer a reload and require another explicit action rather than automatically resubmitting.
- [x] **Verify the complete browser flow.** At phone width, grant a nonmember registrant access, open their group/roster with a second identity, remove access, and verify their next privileged action is denied while their own registration stays available. Check empty/loading/denied states, failed reads/retry, interrupted writes/result recovery, keyboard focus, narrow-layout overflow and reduced-motion behavior. Verify a member's pre-existing membership survives removal and two identical names still target distinct profile handles.
- [x] **Checkpoint:** review current branch and UI diff; commit the cohesive management flow if delivery is available.

## Task 3: Full verification and review evidence

**Files:**
- Modify: `README.md` with the real co-host flow and migration/recovery notes.
- Create: `docs/superpowers/reviews/2026-10-24-cohost-management-validation.md`.

- [x] **Prepare the local baseline.** Node observed: 24.16.0. This worktree initially has no installed dependencies. Inspect the current `packageManager`/engines/README mismatch before setup: the manifest selects pnpm 12.15.0 while engines and README still name pnpm 11.14.0. Record or resolve a proven setup blocker without silently upgrading packages. Run the documented local setup with synthetic services only, avoiding destructive resets of unrelated work. Establish baseline test results before implementation.
- [x] **Run focused tests as above, then adopted checks:** `pnpm check`, `pnpm test:api`, `pnpm db:lint`, and `pnpm db:validate`. Record exact passed, failed and unavailable checks. Do not run Node and Workers client generation concurrently. Test the SQL migration against the local existing migration chain.
- [x] **Review the full diff** for owner authorization on reads/writes/replays, fresh role checks, group-lock ordering, prior membership restoration, last-owner safety, current profile names, contact privacy, bounded queries and receipt recovery. Use the Superpowers review/verification skills; a reviewer subagent is optional only if the execution method authorizes it.
- [x] **Document recovery.** The new migration is additive. A code rollback can hide the new routes while retaining audit and authoritative roles; it does not undo grants already made. Before enabling hosted changes, preserve a backup and validate an owner-operated rollback/revocation procedure. Local fixture cleanup removes only task-created groups and dependent audit/receipt rows. Do not drop real history or apply a hosted migration here.
- [x] **Write review evidence** naming the branch/commit, environment, date, test coverage and material gaps. Include the plain-language user note: “Group owners can make a past session registrant a co-host and remove that access when it is no longer needed.” Local synthetic results do not establish live Auth/provider or deployment verification.
- [ ] **Deliver through the selected repository workflow when authorized/available.** Check the branch immediately before commit and push; open a GitHub PR targeting `main`, link WDL-390 in actual PR/task metadata and attach the PR to this chat. Move the issue to **In Review** only after review readiness is observed. Do not merge, deploy, enable auto-merge, mark Done or start another task.

## Plan self-review

The three tasks cover all five P-15 acceptance criteria, the owner's accepted candidate policy, privacy, direct-request denial, revocation, auditable writes and a mobile flow. Review Focus cases are assigned to backend tests and browser verification. The API and UI share the same named response types and recoverable operation envelope. No unrelated backlog feature or new infrastructure is included.

**Execution:** the owner reviewed the plan and selected **native execution** on 2026-10-24. The implementation and observed validation are recorded in `../reviews/2026-10-24-cohost-management-validation.md`; human review and integration remain separate.
