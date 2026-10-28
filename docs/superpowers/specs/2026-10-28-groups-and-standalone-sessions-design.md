# Groups as member lists, standalone sessions (P-35) — design

Task: [WDL-413](https://linear.app/wwonderland/issue/WDL-413). This builds on P-34 Ask to join ([DJPajares/rallypoint#49](https://github.com/DJPajares/rallypoint/pull/49)).

## Why

Owner, 2026-10-28:

- "sessions should not be tied to any groups. It should be stand alone. Groups should just be a list of all users exclusive to that group."
- "A group must have the same public/private option. There are two ways to join, a link sent for the public or private group by the group admin, and a join the group button for a public group… Both options don't automatically accept a member join request, it must be accepted by the group admin."

Today a group is a container for sessions. Everyone who manages a session does so because of their role in its group, and nobody can join a group. This task separates the two ideas:

- **A session is run by its own people.** That's its organizer and co-hosts.
- **A group is a list of members.** It has an admin and a public or private setting.

Later tasks build on this:

- P-38: direct invites.
- P-36: private sessions limited to chosen groups and people.
- P-37: group search.

## Goals

- A session is created without choosing a group. Its creator runs it, and co-hosts are added per session.
- Everyone who manages an existing session today still manages it afterwards. Nobody gains or loses access.
- A group has one **admin** (its owner) and **members**. It is **Public** or **Private**.
- People **ask** to join a group:
  - through the admin's **invite link**, for any group;
  - through a **Join this group** button, on public groups only.

  The admin accepts or declines every request.
- Members see the group's member list. The admin also sees requests and can remove members.

## Non-goals

These are excluded or belong to later tasks:

- Private sessions and access lists (P-36).
- Direct in-app invites (P-38).
- Group search (P-37).
- Group chat, feeds, descriptions or photos.
- Bans.
- Admin roles beyond the single owner.
- Moving payment, fee or attendance rules.
- Email: the owner's rule is no new emails.

## Anti-goals (a failure even if it works)

- Anyone gains control of a session because of a group role.
- An existing organizer or co-host loses control of a session they run today.
- A private group reveals its members, or a way in, to someone without the link.
- Someone becomes a member without the admin accepting them.
- Badge counts silently jump or vanish because of the restructure.
- Interface copy that leaks internals ("host team", "kind", "token", "role").

## Approach (my call)

The current permission checks all ask "does this person hold an owner, organizer or co-host role in the session's group?". About 30 database functions do this through `app.require_manager(actor, session.group_id)` or the same query.

Rewriting all of them is a large, risky change. Instead, every session gets its **own hidden hosting team**. That's a group row of a new kind `host`, holding exactly that session's organizer and co-hosts. `app.sessions.group_id` points at the hosting team, so every existing check keeps working unchanged. It simply now means "manages this session".

Groups people can see and join are groups of kind `community`. Hosting teams never appear as groups anywhere in the interface.

- `app.groups.kind`: `'community'` (default) or `'host'`.
- `app.groups.visibility`: `'public'` or `'private'`, for community groups only.
- `app.groups.invite_token`: a random uuid, for community groups only.
- **Hosting team name:** the session creator's display name for new sessions, and the original group's name for migrated ones. It shows on the session as "Hosted by {name}".

### Migration of existing data (one-way, pre-launch)

1. For each existing session:
   - create a hosting team named after its current group;
   - copy that group's `owner`, `organizer` and `cohost` rows into the team with the same roles;
   - point the session at the team.

   Drafts and cancelled sessions move too.
2. Existing groups become community groups with visibility **Private**. That's the safer default for data that predates the setting. Their `organizer` and `cohost` rows become `member`. Those people keep managing the old sessions through the hosting teams.
3. Each community group gets a fresh invite token.

A test pins step 1: for every session, the set of people `app.require_manager` accepts is the same before and after.

## Sessions

### Creating

- The create entry opens **New session** directly, at `/sessions/new`. The "choose a group" step is gone.
- The create menu offers **New session** and **Start a group**.
- One new SQL entry point, `api.save_new_session(actor, key, intent, details, host_name, from_session)`:
  - creates the hosting team with the actor as `owner`;
  - then calls the existing `api.save_session` with that team.
- **Idempotency:** a replayed key whose receipt is already a `save_session` reuses the `groupId` stored in the receipt. A retry never creates a second team.
- **Run again** (`from_session`) copies the source session's co-hosts into the new team, but only when the actor manages the source. It never copies registrations, payments or attendance.
- Saving an existing session keeps today's path, `/api/sessions/{id}` → `save_session`, with the session's own team.

### Who manages it

- The team's `owner` is the organizer. The team's `organizer` and `cohost` rows, which only migrated sessions have, also manage it.
- Co-hosts are managed per session on `/sessions/{id}/cohosts`. This reuses the existing co-host screen and `update_group_cohost` / `read_group_cohosts` with the session's team id.
- **Only the team owner adds or removes co-hosts.** That's the existing rule, applied per session.
- **Eligibility (my call):** a person can be made co-host if they have joined any session the actor manages, or are a member of a community group the actor admins. Today it's "has joined a session of this group".

### What shows

- The session page header reads "Hosted by {team name} · {activity}" instead of "{group name} · {activity}". This includes the share page, ticket and Sessions tab rows.
- Group pages no longer list sessions.

## Groups

### Roles

- **Admin:** stored as `owner`, shown as "Admin". There is exactly one, the creator.
- **Member.**
- A community group never holds `organizer` or `cohost` rows after the migration.

### Settings

The admin can set:

- name (existing rename);
- **Public / Private**, with help text:
  - "Anyone can find it and ask to join."
  - "Only people with your invite link can ask to join."
- archive (existing).

New groups default to **Public**, matching sessions. Search itself arrives in P-37, so "find" is forward-looking copy. Until then, Public means the group page shows **Join this group** to anyone signed in who opens it.

### Group page `/groups/{id}`

Signed-out visitors see the group name and a sign-in button. On a private group without a valid invite they see only "This group is private".

Signed-in non-members see:

- **Public group:** name, member count, and **Join this group**, which sends a request.
- **Private group, opened from the invite link (`/groups/{id}?invite={token}`):** name and **Ask to join**.
- **Private group, without a valid invite:** "This group is private." No count, members or button.
- **After asking:** "Request sent. The admin will accept or decline it." with **Cancel request**. Later states read "The admin didn't accept your request." or nothing (once accepted, they're a member).

Members see:

- the member list (name and title, linked to profiles);
- **Leave group** (my call: members can leave; the admin can't).

The admin additionally sees:

- **Requests (N)**, with Accept and Decline (Decline confirms);
- **Remove** on each member, with confirmation;
- **Copy invite link**;
- the settings above.

Request cards show the same person facts as P-34: name, title, played and hosted counts. There's no session-specific level here.

### Requests: rules and limits (mirroring P-34)

- A request holds nothing. Accept adds them as `member`.
- One pending request per person per group. Asking again returns the same request.
- **Declined is final** for that group.
- After **two own cancels** for a group, no more asking.
- At most **10 pending group requests** per person. This counts separately from session requests.
- The invite token is checked at ask time for private groups. A public group accepts asks with or without it.
- A removed member may ask again (my call: removal isn't a ban; bans are excluded).
- No email anywhere.

### Groups list `/workspace`

- Shows the community groups you belong to, with "Admin" or "Member".
- Hosting teams never show.
- **Start a group** asks for a name and Public/Private.

## Badges and counts

- **Group ownership badge:** counts community groups only, so hosting teams don't inflate it.
- **"Regular" badge:** today it's "5 sessions in the same group". It becomes **5 sessions with the same organizer**: sessions whose hosting-team owner is the same person, shown with that person's name. Migrated sessions keep their original group's owner as team owner. Most existing progress carries over, unless an old group had several organizers. The PRD records this (D-16 note).
- **Profile "groups" stat:** counts community groups only.
- **P-34 request card:** "Played in this group's sessions" becomes **"Played in your sessions"**. That's the count of the requester's checked-in sessions whose team includes the viewing manager.

## PRD

- D-01 is amended: sessions stand alone and groups are member lists.
- RP-03 group requirements are updated to match.
- D-16: the regular badge note.
- D-13 note: groups ask Public/Private.

Each entry cites the owner, 2026-10-28.

## Constraints

- Existing stack and conventions: SQL functions behind Hono routes, `packages/domain` types, `node --test` through `pnpm test:api`, and the README checks.
- Pre-launch, so one-way migrations are fine.
- D-13: no internal terms in copy.
- D-15: one primary action per view.
- Accessibility as P-34: native controls, focus after actions, status in words.

## Left to the builder

- Exact function and route names beyond those named here, and the migration split.
- How the Sessions tab and Home re-point the "create" entry.
- Request card layout, which can reuse the P-34 component where it fits.
- Test layout. These must be covered:
  - the manager-set invariant;
  - membership denial for each role;
  - private-group concealment;
  - every request limit;
  - races: two accepts, accept vs cancel;
  - `save_new_session` idempotency.

## Builder questions settled (my calls, 2026-10-28)

### Co-hosts

- `update_group_cohost` and `read_group_cohosts` are redefined. When the target is a hosting team:
  - **Eligibility:** the person has joined any session whose team includes the actor as a manager, or is a member of a community group the actor admins.
  - **Adding:** works from no prior row. Hosting teams have no `member` rows.
  - **Removing:** deletes the row.
- Community groups no longer have co-hosts. Calling these functions on a community group returns `group_access_denied`.

### Who reads group roles

- The only things that read `group_roles` for a session's group are the manager checks, `payment_entitled` (manager or booked), `registration_view` (manager) and `list_my_sessions` (manager).
- No path gives a plain `member` anything on a session. So pointing sessions at their teams loses nothing.
- The other readers change as follows:
  - `list_my_groups`, `read_group_setup`, `read_profile` / `read_my_badges` "groups" and `earned_badges` filter to community groups.

### Migration naming and badges

- Migrated sessions show "Hosted by {old group name}", even though several teams share that name.
- The "regular" badge groups by the team owner's user id. Its label is that person's current display name.
- Groups that had several organizers keep their sessions under the original owner. Progress can only stay the same or merge; it is never split.

### Owner accounts and archiving

- **A deleted owner account:** account deletion runs through the D-09 owner-operated process, which handles sessions and groups case by case. No automated guard is added, and there's no transfer path (out of scope).
- **Archived groups:** take no new asks, and pending requests can't be answered.

### Group requests

- Group requests use a separate `app.group_join_requests` table, with the same states and limits as P-34 and their own counters.
- The P-34 session request table is untouched.

### Invite links

- The invite token never rotates (revocation is out of scope).
- It works whatever the visibility.
- Declined stays final whatever the token.
- A wrong or missing token on a private group is treated as no token.

### Concealment

- A private group's page says "This group is private" to anyone without a valid token.
- A nonexistent id returns not found.
- Group ids are random, so this only confirms existence to someone who already holds the id.

### Switching visibility

- Pending requests stay pending when visibility changes either way.

### Old links

- Session links are `/s/{slug}` and are unaffected.
- The old `/groups/{id}/sessions/new` route redirects to `/sessions/new`.
- The old group co-host route `/groups/{id}/cohosts` redirects to the groups list.
