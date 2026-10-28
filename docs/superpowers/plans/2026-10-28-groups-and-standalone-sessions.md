# Groups as Member Lists, Standalone Sessions (P-35) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Sessions are created and run without a group. Groups become Public/Private member lists that people ask to join, and the admin accepts or declines.

**Architecture:**
- Every session points (`app.sessions.group_id`) at its own hidden `host` group, the hosting team. All existing manager checks keep working and now mean "manages this session".
- Visible groups are `community` groups with a visibility, an invite token and an admin-approved request table.
- A one-way migration moves existing sessions into hosting teams. It refuses to commit if any session's set of managers changes.

**Tech Stack:** Postgres plpgsql (Supabase migrations), Hono API (`apps/api`), Next.js/React (`apps/web`), `packages/domain`, `node --test` via `pnpm test:api`.

**Spec:** `docs/superpowers/specs/2026-10-28-groups-and-standalone-sessions-design.md`

## Global Constraints

**Groups:**
- `app.groups.kind` is `'community'` (default) or `'host'`. Host groups never appear as groups anywhere: lists, counts, badges or copy.
- `app.groups.visibility` is `'public'` or `'private'`, for community groups only. Migrated groups get `'private'`. New groups default to `'public'`.
- Community roles after the migration are only `owner` (shown as "Admin") and `member`. Host roles are `owner`, `organizer` and `cohost`.

**Group requests:**
- They mirror P-34:
  - one pending request per (group, person);
  - declined is final;
  - at most 2 own cancels;
  - at most 10 pending group requests per person, counted separately from session requests.
- A private group needs a valid `invite_token` to ask. A public group accepts asks with or without it.
- Removal isn't a ban.
- The admin can't leave. Members can.

**Everywhere:**
- No email anywhere.
- No internal terms in copy ("host", "team", "kind", "token", "role").

**Copy (exact):**
- Session header: "Hosted by {name}".
- Group visibility help:
  - Public: "Anyone can find it and ask to join."
  - Private: "Only people with your invite link can ask to join."
- Group page lines and buttons:
  - "This group is private."
  - "Join this group"
  - "Ask to join"
  - "Request sent. The admin will accept or decline it."
  - "The admin didn't accept your request."
  - "Leave group"
  - "Copy invite link"
  - "Requests (N)"
- P-34 request card line: "Played in your sessions: N".

## Review Focus

1. **A migrated session's managers.** The exact same people can still edit, cancel and check in. Pinned by the migration's own invariant check, plus Task 1's test `organizer still manages an older session`.
2. **A retried "create session" after a timeout.** It produces one session and one hosting team. Task 1 test: `new session is idempotent`.
3. **An old client sending a stale `groupId` on update.** The update still applies to the right session and is still authorized by its team. Task 1 test: `update ignores the body group`.
4. **A private group opened without, or with a wrong, invite token.** No member count, no members, no Ask button, through both the API and the page. Task 3 test: `private group conceals without a token`.
5. **A former group co-host.** They lose nothing on old sessions, and gain nothing on new sessions in that group. Task 2 test: `group roles grant nothing on new sessions`.

---

### Task 1: Hosting teams, migration and standalone session saves

**Files:**
- Create: `supabase/migrations/20261028100000_hosting_teams.sql`
- Modify: `apps/api/src/sessions.ts`, `packages/database/src/functions.ts`
- Test: `tests/standalone-sessions.test.mjs`. Use the harness from `tests/join-requests.test.mjs`.

**Interfaces — Produces:**

Schema:
- `app.groups` gains:
  - `kind text not null default 'community' check (kind in ('community','host'))`
  - `visibility text check (visibility in ('public','private'))`
  - `invite_token uuid`
- Constraint: host rows have both `visibility` and `invite_token` null. Community rows have both non-null.

Migration body, in order:
1. Snapshot `(session_id, user_id)` manager pairs into a temp table.
2. Create one host group per session, named after the old group. Copy the old group's owner/organizer/cohost rows into it.
3. Re-point `sessions.group_id`.
4. Set community `visibility='private'` and `invite_token=gen_random_uuid()`.
5. Demote community `organizer`/`cohost` rows to `member`.
6. Re-snapshot and `raise exception 'manager_set_changed'` on any difference.

Functions:
- `api.save_new_session(p_actor_id uuid, p_key uuid, p_intent text, p_details jsonb, p_host_name text, p_from_session uuid) returns jsonb`
  - Replay: when a receipt for `p_key` with action `save_session` exists, call `api.save_session` with `(receipt.payload->>'groupId')::uuid`.
  - Otherwise: insert a host group named `p_host_name` with the actor as `owner`. When `p_from_session` is set and the actor manages it, copy its team's `cohost` rows. Then call `api.save_session(p_actor_id, p_key, team, null, p_intent, null, p_details)`.
- `api.update_session(p_actor_id uuid, p_key uuid, p_session_id uuid, p_intent text, p_version integer, p_details jsonb) returns jsonb`
  - Looks up `s.group_id`. A missing session raises `group_access_denied`.
  - Calls `api.save_session` with it.

Routes:
- `POST /api/sessions`, body `{operationKey, intent, details, fromSession?}`. Calls `save_new_session`. `p_host_name` is `actorName(c,"Organizer").name`.
- Legacy `POST /api/groups/:id/sessions` keeps its body and response, but calls `save_new_session` and ignores the group.
- `POST /api/sessions/:id` calls `update_session` and ignores any body `groupId`.

- [ ] **Step 1: Write failing tests** in `tests/standalone-sessions.test.mjs`:
  - `create a session without a group`: `POST /api/sessions` → 200.
    - Organizer `GET /api/sessions/{id}` → 200.
    - Member → 403.
    - Its `app.groups.kind` is `'host'`.
    - A synthetic person joins → `own.state==="confirmed"`.
  - `new session is idempotent`: the same key twice → the same `session.id`. Exactly one host group has that session.
  - `update ignores the body group`: update with `groupId` set to `secondGroup` → 200, and the details changed.
  - `organizer still manages an older session`: a session created through the legacy route, then edited → 200, and its group is a host.
  - `migration left no session on a community group`: SQL `select count(*) from app.sessions s join app.groups g on g.id=s.group_id where g.kind<>'host'` → `0`.
  - `community groups hold only admins and members`: SQL count of community `organizer`/`cohost` rows → `0`.
- [ ] **Step 2:** `node --test tests/standalone-sessions.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Write the migration, register both functions in `functions.ts`, and update the three routes. Apply with `pnpm db:migrate:local`.
- [ ] **Step 4:** Run `node --test --test-concurrency=1 tests/standalone-sessions.test.mjs tests/sessions.test.mjs tests/booked-edits.test.mjs tests/drafts.test.mjs tests/join-requests.test.mjs`. Expected: PASS.
  - Where an old test grants a group role to make someone a session manager, change it to grant the role on the session's host group. Ledger each such change.
- [ ] **Step 5:** Commit `feat: sessions stand alone on their own hosting team (P-35)`.

### Task 2: Co-hosts per session

**Files:**
- Create: `supabase/migrations/20261028101000_session_cohosts.sql`
- Modify: `apps/api/src/cohosts.ts`, `tests/helpers/cohost-fixtures.mjs`, `tests/cohosts.test.mjs`

**Interfaces — Consumes:** Task 1 host groups, and `save_new_session`'s `p_from_session`.

**Interfaces — Produces:**
- `api.read_group_cohosts` and `api.update_group_cohost` are redefined. Same signatures.
  - A community group target raises `group_access_denied`.
  - **Eligibility for a host target:** the person has a party in any session whose team includes the actor as owner/organizer/cohost, or is a `member` of a community group the actor owns.
  - **Add** inserts the `cohost` row from no prior row. **Remove** deletes the row.
- Routes `GET|POST /api/sessions/:id/cohosts` resolve the session's team id and call the same functions with the existing bodies. The group routes return 403 for community groups.

- [ ] **Step 1: Write failing tests**, rewriting the fixture to make a standalone session through `POST /api/sessions`:
  - `owner adds a co-host who joined`: the co-host can then `GET /api/sessions/{id}` → 200.
  - `group roles grant nothing on new sessions`: a member of the organizer's community group, made `cohost` there by SQL → 403 on the new session.
  - `run again copies co-hosts`: `POST /api/sessions` with `fromSession` → the new session's team has the co-host.
  - `a co-host can't add co-hosts`: → 403.
  - Keep the existing denial and revision-conflict cases, re-pointed to the session routes.
- [ ] **Step 2:** Run them. Expected: FAIL.
- [ ] **Step 3:** Implement and apply.
- [ ] **Step 4:** `node --test --test-concurrency=1 tests/cohosts.test.mjs tests/standalone-sessions.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: co-hosts belong to each session (P-35)`.

### Task 3: Group membership, visibility and admin-approved requests

**Files:**
- Create: `supabase/migrations/20261028102000_group_membership.sql`
- Modify: `apps/api/src/sessions.ts` (group routes), `apps/api/src/index.ts` (`/workspace`), `packages/database/src/functions.ts`, `packages/domain/src/contracts.ts`
- Test: `tests/group-membership.test.mjs`

**Interfaces — Produces:**

Table `app.group_join_requests`: same shape and indexes as `app.join_requests`, with `group_id` instead of `session_id` and without seats, names or consent:
- `id`, `group_id`, `user_id`, `state` (`pending`/`accepted`/`declined`/`cancelled`), `asked_at`, `decided_at`, `decided_by`.
- A partial unique index for pending rows.

Functions (all community-only; a host id raises `not_found`):
- `api.read_group(p_actor_id uuid, p_group_id uuid, p_invite uuid) returns jsonb`:
  - Shape: `{id, name, visibility, viewerRole: 'admin'|'member'|null, memberCount|null, canAsk, request: {id,state}|null, members?: [{profileId,name,title,role}], requests?: [{id,profileId,name,title,played,hosted,askedAt}], inviteToken?}`.
  - **Non-members of a private group without a matching token** get only `{id, visibility:'private', concealed:true}`.
  - **Members** get `members`.
  - **The admin** also gets `requests` and `inviteToken`.
  - An archived group raises `not_found`.
- `api.ask_to_join_group(p_actor_id, p_key, p_group_id, p_invite uuid)`.
- `api.cancel_group_request(p_actor_id, p_key, p_group_id, p_request_id)`.
- `api.answer_group_request(p_actor_id, p_key, p_group_id, p_request_id, p_action text 'accept'|'decline')`.
- `api.remove_group_member(p_actor_id, p_key, p_group_id, p_profile_id)`.
- `api.leave_group(p_actor_id, p_key, p_group_id)`.
- `api.set_group_visibility(p_actor_id, p_key, p_group_id, p_visibility text)`.
- Each write returns `{group: read_group(...), operationKey}`.
- Errors (P0001): `request_declined`, `request_cancel_limit`, `request_limit`, `request_not_pending`, `already_member`, `invite_required`, `admin_cannot_leave`. Plus 42501 `group_access_denied`.
- Other changes:
  - `api.create_group` gains `p_visibility text` (default `'public'`).
  - `api.list_my_groups` filters `kind='community'` and returns roles `admin`/`member`.

Routes:
- `GET /api/groups/:id?invite=`
- `POST /api/groups/:id/requests`, `/requests/cancel`, `/requests/answer`, `/members/remove`, `/leave`, `/visibility`
- `POST /groups` accepts `visibility`.

- [ ] **Step 1: Write failing tests:**
  - `public group: ask, admin accepts`: the member appears in `members`. The requester's `viewerRole` is `'member'`.
  - `private group conceals without a token`: the response equals `{id, visibility:'private', concealed:true}` for a wrong token, no token and signed out. Asking without a token → 409 `invite_required`.
  - `private group with the invite link`: ask → pending → admin declines → asking again → 409 `request_declined`.
  - `only the admin answers and removes`: a member and an outsider → 403.
  - `limits`: two cancels → `request_cancel_limit`. Ten pending → `request_limit`.
  - `two admins…`: not applicable (single admin). Instead, `accept racing cancel` → one result.
  - `admin cannot leave; member can`.
  - `removed member may ask again`.
  - `host groups are invisible`: `GET /api/groups/{hostId}` → 404. `/api/workspace` lists no host group.
  - `visibility switch keeps pending requests`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and apply.
- [ ] **Step 4:** `node --test --test-concurrency=1 tests/group-membership.test.mjs tests/groups.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: groups are member lists that people ask to join (P-35)`.

### Task 4: Badges, counts and session labels

**Files:**
- Create: `supabase/migrations/20261028103000_hosting_badges.sql`
- Modify: `apps/web/src/join-requests.tsx` (label), `packages/domain/src/registration.ts` (`playedInGroup` → `playedWithYou`)
- Test: `tests/badges.test.mjs`, `tests/join-requests.test.mjs`

**Interfaces — Produces:**
- `app.earned_badges` / `app.badge_progress`:
  - The "regular" badge groups by the host team owner's user id. Its `group_name` is that owner's display name.
  - The owner badge counts `kind='community'` only.
- Profile and badge "groups" stats count community groups only.
- `registration_view.requests[].playedWithYou`: the requester's checked-in sessions whose team includes `p_actor`. This replaces `playedInGroup`.
- `SharedSession.groupName` and `MySessionRow.groupName` keep the same key and now carry the team name.

- [ ] **Step 1: Write failing tests:**
  - `regular badge counts sessions with the same organizer`: 5 checked-in standalone sessions by one organizer → a `regular` badge named after the organizer.
  - `hosting teams don't count as groups`: the profile `stats.groups` is unchanged after creating a session.
  - In join-requests: the card has `playedWithYou` and no `playedInGroup`.
- [ ] **Step 2:** Run. Expected: FAIL.
- [ ] **Step 3:** Implement and apply. Change the card label to "Played in your sessions: N".
- [ ] **Step 4:** `node --test --test-concurrency=1 tests/badges.test.mjs tests/join-requests.test.mjs tests/profiles.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: badges and counts follow organizers, not groups (P-35)`.

### Task 5: Web — standalone create, Hosted by, session co-hosts

**Files:**
- Modify:
  - `apps/web/src/create-picker.tsx`: **New session** and **Start a group**.
  - `apps/web/src/session-pages.tsx`: `NewSession`/`RunAgain` post to `/api/sessions`; the header shows "Hosted by {groupName}"; the editor links to "Co-hosts".
  - `apps/web/src/cohost-management.tsx`: takes a session id and uses `/api/sessions/{id}/cohosts`.
  - `apps/web/src/screens.tsx`: the group page no longer lists sessions.
- Create:
  - `apps/web/app/sessions/new/page.tsx`
  - `apps/web/app/sessions/[id]/cohosts/page.tsx`
- Replace with redirects:
  - `apps/web/app/groups/[id]/sessions/new/page.tsx` → `/sessions/new` (keep `?from=`)
  - `apps/web/app/groups/[id]/cohosts/page.tsx` → `/workspace`

- [ ] **Step 1:** Implement. Run `pnpm check`. Expected: PASS.
- [ ] **Step 2:** Commit `feat(web): create sessions without a group; co-hosts per session (P-35)`.

### Task 6: Web — group pages

**Files:**
- Create: `apps/web/src/group-page.tsx`, with `export function GroupPage()`, which reads `/api/groups/{id}?invite=`.
- Modify:
  - `apps/web/app/groups/[id]/page.tsx`: render `GroupPage`.
  - `apps/web/src/screens.tsx` (`Workspace`): roles show as "Admin"/"Member".
  - `apps/web/src/session-pages.tsx` (`CreateGroup`): Public/Private `SelectField` with the help copy.
  - The group edit screen: the visibility select.

The page renders, by state:
- **Concealed:** "This group is private."
- **Non-member:** "Join this group" (public) or "Ask to join" (with invite).
- **Pending:** with Cancel request.
- **Declined.**
- **Member:** the member list and Leave group.
- **Admin:** Requests (N) with Accept/Decline (decline confirms), Remove with confirmation, and Copy invite link (`${origin}/groups/{id}?invite={token}`).

The page reuses `PersonName`/`TitlePill`, `useMutation`, and focus-on-status as in `join-requests.tsx`.

- [ ] **Step 1:** Implement. Run `pnpm check`. Expected: PASS.
- [ ] **Step 2:** Commit `feat(web): group pages with members and join requests (P-35)`.

### Task 7: PRD, full checks, browser

- [ ] **Step 1:** Update `PRD.md`:
  - D-01 amended: sessions stand alone; groups are Public/Private member lists that people ask to join, and the admin accepts.
  - RP-03 updated to match.
  - D-16 note: "regular" means 5 sessions with the same organizer.
  - D-13 note: groups ask Public/Private.
  - Cite the owner, 2026-10-28.
- [ ] **Step 2:** `pnpm check && pnpm db:lint && pnpm test:api`. Expected: all PASS.
- [ ] **Step 3:** Browser check at 375px light and desktop dark, using a synthetic co-host role on `member@` as in P-34, reverted after:
  - create a session without a group, then join it;
  - an older session is still editable;
  - a public group: ask, then accept;
  - a private group concealed without the link, and asking with the link;
  - remove a member and leave a group.
- [ ] **Step 4:** Commit `docs: record standalone sessions and member groups (P-35)`.
