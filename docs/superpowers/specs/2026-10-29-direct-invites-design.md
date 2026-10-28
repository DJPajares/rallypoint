# Direct invites (P-38) — design

Task: [WDL-415](https://linear.app/wwonderland/issue/WDL-415). This builds on P-35 (standalone sessions and member groups, [DJPajares/rallypoint#50](https://github.com/DJPajares/rallypoint/pull/50)) and P-34 (Ask to join).

## Why

Owner, 2026-10-28: "a direct invite (not link). from the app, a group and session can have an option to directly invite, the invitee will see the request within the app, and be able to join or decline." The owner approved the defaults below on 2026-10-29 ("Yes, use them").

## Goals

- **Who invites:**
  - a group's admin, to the group;
  - a session's organizer or co-hosts, to the session.
- **Who can be picked:** only people the inviter already knows through RallyPoint.
  - Anyone who was **confirmed** in a session the inviter ran or played in.
  - Anyone who shares a group with the inviter.
- **Where invites show:** the person invited sees their invites in an **Invites** card at the top of Home, each with **Join** and **Decline**.
- **Group Join:** makes them a member straight away. The admin chose them, so there is no second approval.
- **Session Join:** opens the session page with the normal join step: fee, +1 and waitlist consent.
  - They are confirmed if the whole party fits and nobody is waiting; otherwise they go to the back of the waitlist.
  - An invite counts as approval, so it skips Ask to join.
  - It never skips the queue.

## Non-goals

These are excluded or belong to later tasks:

- Looking up strangers by name or email (P-37 search is groups only).
- Invite links (P-35).
- Email or push notifications.
- Bulk invites.
- Private-session access (P-36 will treat an invite as access).
- Inviting someone to be a co-host.

## Anti-goals

- The picker reveals people the inviter doesn't already know, or reveals anyone's email.
- An invite places someone without their consent to the fee and waitlist terms.
- An invite jumps the queue.
- Someone other than the person invited can see or act on an invite.
- Copy shows internal terms.

## Rules (owner-approved defaults, 2026-10-29)

- **One waiting invite per person per group or session.** Sending again returns the existing invite.
- **The sender** (or any current admin/manager of that group or session) **can withdraw** a waiting invite.
- **Session invites expire at the session's start.** Join is refused at or after start, as join is.
- **Declined is final:** a declined person can't be invited to that group or session again.
- **Sender limit:** at most **20 waiting invites** per sender, across groups and sessions not yet started.
- Nobody can be invited to a group they're already in, or to a session where they're already confirmed or waitlisted.
- No email.

## Decisions in this document (my calls)

### Data

`app.invites` has these columns:

- `id`;
- `group_id` (a community group) **or** `session_id`, with exactly one set;
- `invitee_id`, `inviter_id`, `inviter_name`;
- `state`: `pending`, `accepted`, `declined` or `withdrawn`;
- `created_at`, `decided_at`.

A partial unique index allows one pending invite per (target, invitee). "Expired" is derived, never stored.

### Candidates

`api.invite_candidates(actor, target kind, target id, query text, after uuid)` returns up to 50 profiles (name, title), paged by profile id.

- **Who is included:** people known to the actor, minus:
  - the actor;
  - existing members, or people already booked;
  - anyone with a pending invite;
  - anyone who declined an invite to this target.
- **"Known":**
  - confirmed in a session whose team includes the actor as a manager;
  - confirmed in a session where the actor was confirmed;
  - shares a community group with the actor (any role).
- The optional `query` filters by name, case-insensitive substring, up to 40 characters.
- **Performance:** the candidate set is built from those sources and then joined to profiles, never by scanning every profile (lesson from the P-35 review).

### Session joins

- `api.join_session` lets a person with a pending invite to that session join even when it is Ask to join.
- On a successful join, their pending invite becomes `accepted`, in the same transaction.
- **Accept through the request path:** if an invitee also has a pending Ask to join request, joining through the invite leaves the request for the existing "already booked" rule to resolve. P-34 accept links the existing party.
- Group join is a separate call, `api.accept_group_invite`, which adds `member`. The P-35 group requests stay untouched. If the person also has a pending group request, it is marked accepted too.

### What people see

**Home "Invites (N)" card.** It's shown only when there are pending, non-expired invites. Each row reads:

- for a group: "{inviter} invited you to {group name}", with **Join** and **Decline**;
- for a session: "{inviter} invited you to {session title} · {date}", with **Open** (the session page, where the join step is) and **Decline**.

**Session page, invited person.** A line above the join form: "{inviter} invited you." On an Ask to join session, the form is the normal join (button "Agree & join" or "Agree & waitlist"), not Ask to join. A **Decline invite** link sits below it.

**Session page, organizer or co-host.**

- An **Invite** button (secondary) opens a sheet with a name search and the candidate list. Tapping a person sends the invite.
- Below the roster, an **Invited** list shows each invite's person and state ("Waiting", "Declined", "Joined") with **Withdraw** on waiting ones.

**Group page, admin.** The same **Invite** button and **Invited** list.

**Errors in plain words:**

- "You've already invited this person."
- "They declined an invite to this before."
- "You have 20 invites waiting. Withdraw one or wait for answers."
- "They're already in."

## Constraints

- The existing stack and test conventions, the P-35 hosting-team model, and D-13 copy rules apply.
- One primary action per view (D-15). For organizers that stays Share; Invite is secondary.
- Accessibility follows P-34/P-35 practice.

## Left to the builder

- Function and route names beyond those named here.
- The sheet layout.
- How Home refreshes after an action.
- Test layout. It must cover:
  - denial for every role;
  - invitee-only visibility;
  - Join and Decline for each kind;
  - races: Join vs Withdraw, and two Joins;
  - the start boundary;
  - the candidate scope and exclusions;
  - each limit;
  - Ask to join bypass with consent;
  - no email queued by invite actions.

## Builder questions settled (my calls)

### Reading the session

- Sessions are readable by anyone with the link until P-36. The Home row carries the session slug, and invites add no read access now.
- When P-36 arrives, a pending or accepted invite will grant access to a private session.

### When an invitee also asked to join

- **Session:** joining through an invite also marks that person's pending Ask to join request for the same session `accepted`, linked to their new party.
- **Group:** accepting a group invite marks their pending group request `accepted`. This is symmetric with sessions.
- Declining or withdrawing an invite never touches a request.

### Declined is final

- It blocks further invites to that exact group or session from anyone.
- It doesn't block Ask to join, joining by link, or invites to a different session, including one made with Run again.

### The 20-invite cap

- It counts the sender's `pending` invites whose target is either:
  - a non-archived community group; or
  - a published session that hasn't started.
- Expired session invites don't count. Withdrawn ones don't count.

### Who counts as "known"

- The sessions involved are those whose hosting team (P-35, standalone included) has the actor as owner, organizer or co-host, plus sessions where the actor's own party is confirmed.
- There is no time window, and past sessions count.
- A person counts if their party in such a session is currently `confirmed` and the session wasn't cancelled. Group co-members count in any role.
- A co-host sees people from every session they help run.

### Joining, then leaving

- `accepted` is terminal. Withdrawing from the session later doesn't change the invite row.
- The person can be invited again once they have no pending invite and haven't declined. An older accepted invite doesn't block a new one.
- The Invited list keeps showing "Joined" for the old row, which is history.

### Who can withdraw a group invite

- The group's admin. Groups have no other manager role.

### Retries

- Send, withdraw, decline, accept-group and invited joins use the `operation_receipts` + key pattern, with the same idempotency-conflict rule.

### Inviter's name

- The name stored when the invite was sent (`inviter_name`) is what Home shows.
