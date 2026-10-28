# Direct Invites (P-38) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A group admin or a session's organizer or co-hosts invite someone they know. The person invited joins or declines from Home and the session page.

**Architecture:**
- One `app.invites` table with SQL functions for candidates, send, withdraw, decline, accepting a group invite, and listing your own invites.
- Session invites are accepted through the existing `api.join_session`. It is redefined to let someone with an invite past Ask to join and to mark the invite accepted.
- The views (`registration_view` and `read_group`) gain invite data.

**Tech Stack:** Postgres plpgsql (Supabase migrations), Hono (`apps/api`), Next.js/React (`apps/web`), `packages/domain`, `node --test`.

**Spec:** `docs/superpowers/specs/2026-10-29-direct-invites-design.md`

## Global Constraints

- **Limits:**
  - one pending invite per (target, person);
  - declined is final for that exact target;
  - the cap is 20 pending invites per sender, counting only live targets.
- **Expiry:** session invites expire at start. This is derived, never stored.
- **Known people:**
  - **Session sources:**
    - the hosting team includes the actor as owner, organizer or co-host; or
    - the actor's own party is confirmed.
  - **Who counts from those sessions:** people currently `confirmed`, in sessions that weren't cancelled.
  - **Group co-members:** any role.
  - **Excluded:**
    - the actor;
    - existing members, or people already booked;
    - anyone with a pending invite;
    - anyone who declined an invite to this target.
- **No email.** Invite actions write no registration events except the normal join's. That join records silent events, so it queues no join email.
- **Copy (exact):**
  - Invites card heading: "Invites (N)".
  - Invites card rows:
    - "{inviter} invited you to {group}" with "Join" and "Decline";
    - "{inviter} invited you to {title} · {date}" with "Open" and "Decline".
  - On the session page, for the person invited: "{inviter} invited you." and "Decline invite".
  - For organizers and admins:
    - an "Invite" button;
    - an "Invited" list with the states "Waiting", "Declined", "Joined" and "Withdrawn", and "Withdraw" on waiting invites.
  - Errors:
    - "You've already invited this person."
    - "They declined an invite to this before."
    - "You have 20 invites waiting. Withdraw one or wait for answers."
    - "They're already in."

## Review Focus

1. **Accepting a session invite on a full Ask to join session.** The person goes to the back of the waitlist with consent, without skipping the request queue. Task 1 test: `invited join on a full request session waitlists`.
2. **A Join racing a Withdraw.** There is one result, and no party without an accepted invite. Task 1 test: `join racing withdraw`.
3. **A stranger in the picker.** Never listed, and refused if sent directly. Task 1 test: `candidates are only people you know`.
4. **An invite seen by someone else.** Absent from their Home and views. Task 1 test: `only the invitee sees it`.
5. **A retried send.** Returns the same invite. Task 1 test: `send is idempotent`.

---

### Task 1: Database and API

**Files:**
- Create: `supabase/migrations/20261029090000_invites.sql`
- Create: `apps/api/src/invites.ts`
- Modify:
  - `apps/api/src/index.ts`
  - `packages/database/src/functions.ts`
  - `packages/domain/src/contracts.ts` (types)
  - `packages/domain/src/registration.ts` (`invite`, `invites`)
- Test: `tests/invites.test.mjs`

**Interfaces — Produces:**

Functions:
- `api.invite_candidates(p_actor_id, p_kind text 'group'|'session', p_target uuid, p_query text, p_after uuid) → {people:[{profileId,name,title}], nextCursor}`.
  - The session target is the session **id**.
  - Denial: 42501.
- `api.send_invite(p_actor_id, p_actor_name, p_key, p_kind, p_target, p_profile_id) → {invite:{id,state}, operationKey}`.
  - Errors: `invite_exists`, `invite_declined`, `invite_limit`, `already_in`, `not_known`, `registration_closed`.
- `api.withdraw_invite(p_actor_id, p_key, p_invite_id)`
- `api.decline_invite(p_actor_id, p_key, p_invite_id)`
- `api.accept_group_invite(p_actor_id, p_key, p_invite_id)`
- `api.list_my_invites(p_actor_id) → [{id, kind, inviterName, sentAt, group?:{id,name}, session?:{slug,title,startsAt,timeZone}}]`
- `api.join_session` redefinition:
  - A pending invite skips `request_required`.
  - After the admission step:
    - the invite becomes `accepted`;
    - a pending request for the same session becomes `accepted`, with its party linked.

View changes:
- `app.registration_view` gains:
  - `invite: {id, inviterName}|null` for the viewer;
  - `invites: [{id,name,state,sentAt}]` for managers.
- `api.read_group` gains `invites` for the admin.

Routes:
- `GET /api/invites/candidates?kind&target&q&after`
- `POST /api/invites` (send)
- `POST /api/invites/:id/withdraw`
- `POST /api/invites/:id/decline`
- `POST /api/invites/:id/accept` (group invites only)
- `GET /api/me/invites`

- [ ] **Step 1: Write the failing tests:**
  - the five Review Focus tests;
  - `group invite: join makes a member`;
  - `session invite skips ask to join with consent`;
  - `decline is final`;
  - `withdraw`;
  - `cap of 20`;
  - `expired at start`;
  - `role denial` (member, outsider, signed-out);
  - `no email queued`.
- [ ] **Step 2:** Run `node --test tests/invites.test.mjs`. Expected: FAIL.
- [ ] **Step 3:** Implement and apply with `pnpm db:migrate:local`.
- [ ] **Step 4:** Run `node --test --test-concurrency=1 tests/invites.test.mjs tests/join-requests.test.mjs tests/group-membership.test.mjs tests/registrations.test.mjs`. Expected: PASS.
- [ ] **Step 5:** Commit `feat: direct invites for groups and sessions (P-38)`.

### Task 2: Web

**Files:**
- Create: `apps/web/src/invites.tsx`:
  - `HomeInvites`;
  - `InvitePanel({kind, target, invites, onChanged})`, the Invite sheet plus the Invited list.
- Modify:
  - `apps/web/src/screens.tsx` (Home);
  - `apps/web/src/registration-panel.tsx` (the invited line, `asking` false when invited, Decline invite, and `InvitePanel` for managers);
  - `apps/web/src/group-page.tsx` (`InvitePanel` for the admin).

- [ ] **Step 1:** Implement. Run `pnpm check`. Expected: PASS.
- [ ] **Step 2:** Commit `feat(web): invite people and answer invites (P-38)`.

### Task 3: PRD, full checks, browser, review

- [ ] **Step 1:** Add the P-38 decisions to PRD RP-01 and the D-19 notes.
- [ ] **Step 2:** Run `pnpm check && pnpm db:lint && pnpm test:api`. Expected: PASS, except the known local email-queue saturation.
- [ ] **Step 3:** Browser check at 375px light and desktop dark:
  - invite to a group from the admin page;
  - Join from Home;
  - invite to a full Ask to join session;
  - open it from Home and join, landing on the waitlist;
  - decline;
  - withdraw.
- [ ] **Step 4:** Final whole-branch review, then fix the Critical and Important findings, each with a test that fails first.
