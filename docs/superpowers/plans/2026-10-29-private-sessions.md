# Private Sessions (P-36) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Organizers make a session Public or Private. A private session is seen and joined only by its managers, the groups and people on its list, invitees, people who hold or held a party, and people with a pending request.

**Architecture:**
- The mode lives in session details as `details.access` (`public` | `private`, missing means public), like `joinMode`. It therefore round-trips through the form, Run again and versions, and is not a material change.
- The list lives in a new table `app.session_access`. It is written atomically by `save_new_session` and `update_session` through a new `p_access jsonb` parameter.
- One predicate, `app.can_view_session(actor, session_id)`, guards:
  - the share read (now with an optional actor);
  - the registration read;
  - `join_session` and `ask_to_join`.

  The other participant writes already require a party, request or invite, each of which grants access.

**Tech Stack:** Postgres plpgsql (Supabase migrations), Hono (`apps/api`), Next.js/React (`apps/web`), `packages/domain`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-29-private-sessions-design.md`

## Global Constraints

- **Access:**
  - Access holders:
    - managers (`app.is_session_manager`);
    - listed users;
    - members of a listed community group that is not archived;
    - anyone with a pending invite to the session;
    - anyone with a party in the session, in any state;
    - anyone with a pending join request for it.
  - Public sessions: everyone has access.
- **Limits:** 20 groups and 100 people per session.
- **Who can be added** (each new entry is checked on save; entries already on the list are kept):
  - groups: `kind='community'`, not archived, where the saver has any role;
  - people: in `app.known_people(saver)`.
- **Run again** (`p_from_session` set, `p_access` null, saver manages the source): copy the source's list as is.
- **No access:**
  - The share and registration reads return exactly `{ "slug": <slug>, "private": true }`.
  - Writes raise `session_private`, which the API maps to HTTP 403 with the message "This session is private."
- **Ask to join:**
  - It is refused on a private session.
  - When `access='private'`, `joinMode` is stored as `direct`. The domain normaliser forces it.
- **Copy (exact):**
  - Field "Who can see it", with options:
    - "Public" / "Anyone with the link.";
    - "Private" / "Only people you add.".
  - The button "Add groups or people", and the sheet title "Add groups or people", with sections "Your groups" and "People you know".
  - Empty-list help: "Only you and your co-hosts can see it until you add people or invite them."
  - Errors:
    - "You can't add that group."
    - "You can't add that person."
    - "You can add up to 20 groups and 100 people."
  - The label "Private" with a lock icon.
  - The no-access heading "This session is private". Signed out: "Sign in to see it if the organizer added you." plus a "Sign in" button. Signed in: "Only people the organizer added can see it."
  - The tab title "Private session · RallyPoint".
- **No email.** Nothing in this task writes registration events beyond the existing join.

## Review Focus

1. **A party holder taken off the list.** They still read the session, see their fee and payment QR, and can withdraw. After withdrawing they still see it; a rejoin needs access, and they still have it because they held a party. Test: `removed party holder keeps view and booking`.
2. **A member who leaves a listed group, or a group that is archived.** They lose view unless they have access another way. Test: `leaving or archiving a listed group removes access`.
3. **A join racing a removal.** One outcome only: either the join committed before the removal (booking kept) or it's refused with `session_private`. Never a party without access at commit. Test: `join racing removal`.
4. **Switching Public → Private with pending requests.** The requester still sees their request, Accept still works, and a new ask is refused. Test: `pending request survives switch to private`.
5. **The signed-out share read and a bad token.** Both get the private stub with no title or counts, never a 401 or a leak. Test: `share read with no or bad token is the stub`.

---

### Task 1: Database and API

**Files:**
- Create: `supabase/migrations/20261029100000_private_sessions.sql`
- Modify:
  - `apps/api/src/identity.ts` (`optionalUser` middleware)
  - `apps/api/src/sessions.ts` (shared read with actor; `access` in the save body; `GET /sessions/access-options`)
  - `apps/api/src/registrations.ts` (map `session_private` → 403)
  - `packages/database/src/functions.ts` (parameter types)
  - `packages/domain/src/session.ts`: `access?: "public"|"private"` in details, the normaliser default `public`, and `joinMode` forced to `direct` when private
  - `packages/domain/src/run-again.ts` (copy `access`)
  - `packages/domain/src/contracts.ts`: `SessionAccessList`, `AccessOptions` and `SharedSession.private?`
- Test: `tests/private-sessions.test.mjs`. Also add domain cases to `tests/session-domain*.test.mjs` if that file exists, otherwise to a new `tests/private-sessions-domain.test.mjs`.

**Interfaces — Produces:**

Table and constraint:
- `app.session_access(session_id uuid references app.sessions on delete cascade, group_id uuid null references app.groups on delete cascade, user_id uuid null, added_by uuid, created_at)`.
  - Exactly one of `group_id`/`user_id` is set.
  - Unique on (session_id, group_id) and on (session_id, user_id).
- The details check accepts `details.access in ('public','private')`, or the key may be absent.

Functions:
- `app.can_view_session(p_actor uuid, p_session uuid) → boolean`. A null actor is true only for public sessions.
- `app.assert_session_access(p_actor uuid, p_session uuid)` raises `insufficient_privilege` with message `session_private`.
- `api.read_shared_session(p_slug uuid, p_actor_id uuid default null)`. Without access it returns the stub.
- `api.read_registration(p_actor_id, p_slug)`. Without access it returns the stub. Drafts and unknown sessions are unchanged.
- `api.join_session` and `api.ask_to_join` gain `assert_session_access` after the session lock. `ask_to_join` also raises `session_private` when access is private, even for someone with access.
- `api.save_new_session(..., p_access jsonb default null)` and `api.update_session(..., p_access jsonb default null)`:
  - `p_access = {"groups":[uuid],"people":[profileId]}` replaces the list.
  - Null leaves it, except when a Run again copy applies.
  - Errors: `access_group_invalid`, `access_person_invalid`, `access_limit`.
- `api.read_managed_session` gains `access: {groups:[{id,name}], people:[{profileId,name}]}`.
- `api.session_access_options(p_actor_id uuid, p_query text) → {groups:[{id,name}], people:[{profileId,name,title}]}`:
  - the saver's community groups;
  - known people, filtered by a case-insensitive name substring of up to 40 characters, with a limit of 50.
- Keep the advisory receipt and the replay paths unchanged. A replay re-applies the same list, so the result is idempotent.

Lock order: the session row `for update` in save, join and ask. The access check reads the list after the lock.

Material/booked edits:
- Add `'access'` to the keys allowed in `app.assert_booked_edit`.
- Add it to the non-confirm list in `app.request_needs_confirm`.

Routes:
- `GET /api/shared/:slug` (`optionalUser`: a missing, empty or invalid token means anonymous);
- `POST /api/sessions` and `POST /api/sessions/:id` accept an optional `access`;
- `GET /api/sessions/access-options?q=`.

Steps:
- [ ] **Step 1: Write the failing tests** in `tests/private-sessions.test.mjs`, using the invites test's fixture pattern with fresh synthetic users:
  - `public session unchanged`: an outsider reads details and counts, and joins.
  - `outsider and signed-out get only the stub`:
    - the share read deep-equals `{slug, private:true}` for no token, an outsider token and a bad token;
    - the registration read for the outsider gives the same stub;
    - join → 403 `session_private`;
    - ask → 403;
    - the payment QR → refused.
  - `listed person and listed group member view and join`.
  - `invitee views; withdrawn invite removes view`.
  - `removed party holder keeps view and booking` (Review Focus 1): after removal, the booking state and fee are unchanged and they can withdraw.
  - `leaving or archiving a listed group removes access` (Review Focus 2).
  - `ask to join refused on private; joinMode stored direct`.
  - `pending request survives switch to private` (Review Focus 4).
  - `save checks`:
    - a stranger → 422 `access_person_invalid` "You can't add that person.";
    - a hosting team or an archived or unjoined group → 422 `access_group_invalid`;
    - 21 groups → 422 `access_limit`;
    - another manager's earlier entry is kept on a co-host's save.
  - `switching access is not a material change`: a booked participant needs no reconfirm, and the version-change `material` is false.
  - `run again copies mode and list`.
  - `join racing removal` (Review Focus 3): run Promise.all of a join and an update that removes the person, then check that the final state is consistent with the result.
  - `share read with no or bad token is the stub` (Review Focus 5).
  - `access options only list your groups and known people`.
  - Domain: the normaliser defaults `access` to public and forces `joinMode` direct when private.
- [ ] **Step 2:** Run `node --test tests/private-sessions.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement and apply with `pnpm db:migrate:local`.
- [ ] **Step 4:** Run `node --test --test-concurrency=1 tests/private-sessions.test.mjs tests/invites.test.mjs tests/join-requests.test.mjs tests/standalone-sessions.test.mjs tests/registrations.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: private sessions with chosen groups and people (P-36)`.

### Task 2: Web

**Files:**
- Create: `apps/web/src/session-access.tsx`:
  - `AccessField({ value, list, onChange })`, with the Public/Private radios, the chips and the Add button;
  - `AccessSheet`, which reads `/api/sessions/access-options?q=` with a 300 ms debounce, like the invite picker.
- Modify:
  - `apps/web/src/session-pages.tsx`:
    - the new and edit forms render `AccessField` and hide "Who can join" when private;
    - the save body includes `access` when private;
    - `SharedSessionPage` sends the token (not `publicRead`) and renders the private state;
    - the "Private" label goes in the session head.
  - `apps/web/src/registration-panel.tsx`, if it reads the registration stub: render nothing for `private`.

- [ ] **Step 1:** Implement. Run `pnpm check`. Expected: PASS.
- [ ] **Step 2:** Commit `feat(web): public or private sessions (P-36)`.

### Task 3: PRD, full checks, browser, review

- [ ] **Step 1:** Update the PRD:
  - RP-16: private mode accepted, with the access rule;
  - D-13: visibility is now asked as Public/Private;
  - D-19 note: Ask to join is public only.
- [ ] **Step 2:** Run `pnpm check && pnpm db:lint && pnpm test:api`. Expected: PASS, except the known local email-queue saturation (WDL-417 item 9).
- [ ] **Step 3:** Browser check at 375px light:
  - create a private session for one group plus one person;
  - the member and the person see and join it;
  - an outsider sees the private state;
  - signed out sees the private state;
  - remove the person and their booking stays.
- [ ] **Step 4:** Final whole-branch review, then fix the Critical and Important findings, each with a test that fails first.
