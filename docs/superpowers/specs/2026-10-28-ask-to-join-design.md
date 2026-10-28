# Ask to join (P-34) — design

Task: [WDL-412](https://linear.app/wwonderland/issue/WDL-412). Rules: PRD RP-16 and the D-19 amendment of 2026-10-25. This document adds what the owner asked for on 2026-10-28 (spam limits, what an organizer sees about the person asking) and settles the screens.

## Why

Organizers want to choose who comes to some sessions without giving up the shared link. Today anyone with the link who signs in can join. Ask to join keeps the link and the public details. The difference is that a person asks, and an organizer or co-host accepts or declines.

## Scope and sequence (owner, 2026-10-28)

This is the first of three pieces. The owner chose this order:

1. **This task:** Ask to join on today's sessions. Every session is reachable by link, which the owner calls "public". Organizers choose **Join directly** or **Ask to join**.
2. **Later task:** groups become member lists, and sessions stop belonging to a group.
3. **Later task:** a **Public / Private** setting when creating or editing a session. A private session is open only to the chosen groups and/or individual people. Ask to join stays a public-session option.

Nothing in this task adds a Public/Private control, group membership or an access list. Pieces 2 and 3 are drafted as Linear tasks for the owner's approval after this one.

## Goals

- One choice on the session form: how people get in, **Join directly** (default, today's behavior) or **Ask to join**.
- A signed-in person can ask in one step (optional +1, the same consent as joining), see that their request is pending, and cancel it.
- Organizers and co-hosts see pending requests on the session page, with enough about each person to decide, and can **Accept** or **Decline**. When many are left over they can also **Decline the rest**.
- Join spam is bounded.
- Accepting never bypasses the strict queue (D-03).

## Non-goals

- Public/Private visibility, groups as member lists, access lists of groups or people (pieces 2 and 3).
- Invite links or codes, discovery listing, join conditions (skill, age, gender), automatic acceptance rules.
- Messaging between requester and organizer, including a note attached to the request.
- Any email about requests, to anyone. Requests and outcomes are surfaced in the app only.

## Anti-goals (a failure even if it works)

- A pending request that holds a seat, changes counts or jumps the waitlist.
- An organizer shown anything that implies reliability: no-shows, payment history, a score.
- A requester confirmed on terms they never agreed to.
- Two results from one accept (double seat, accepted and declined).
- Interface copy that leaks internals ("admission mode", "pending state", "version").

## Accepted rules (D-19 amendment, unchanged)

1. A pending request holds no seat and has no place in the queue.
2. On Accept the party goes through the normal join: confirmed if the whole party fits and nobody is waiting, otherwise to the back of the waitlist as of acceptance. The +1 is never split. Waitlist and fee consent is taken when asking.
3. A declined person cannot ask again for that session. (The amendment's accept/decline email is withdrawn: see "Email: none".)
4. Requests still pending at start expire. Asking and accepting are refused at or after start.
5. Switching a session from Ask to join to Join directly leaves pending requests pending for the organizer, and accepts no one automatically.
6. Link visitors see the same basic details and counts as today. Roster rules don't change.

## Decisions in this document

### Owner-directed, 2026-10-28

- **The organizer sees who is asking.** Details below.
- **Spam is limited.** Limits below.

The specific contents and limits below are my calls within that direction. The owner reviews them with this document.

### What the organizer sees on each request

- Display name and chosen title (the existing roster title rules), linking to the existing public profile page `/people/{id}`.
- Their self-rated level for this session's activity, when their profile lists that activity with a level. Otherwise nothing.
- **Played** and **Hosted** counts, the same numbers their public profile already shows.
- **"Played in this group's sessions: N"**: completed sessions of this session's group where their own seat was checked in. This is derived only from check-ins the organizer's group already recorded. When piece 2 changes groups, the count follows the new model.
- "+1: {guest name or 'Guest'}" when the request is for two seats.
- When they asked, as relative time ("2 hours ago").

Never shown: email address, no-shows, payment or fee history, waitlist history, or any combined "score".

### Spam limits

- Asking requires the same verified sign-in as joining.
- At most one pending request per person per session. Asking again (a retry or a second tap) returns the existing request.
- A person who has **cancelled their own request twice** for a session can't ask again for it. The third attempt is refused: "You've cancelled two requests for this session, so you can't ask again."
- A person can have at most **10 pending requests** across all sessions that haven't started. The 11th is refused: "You have 10 requests waiting. Cancel one or wait for an answer."
- A declined person can't ask again for that session (accepted rule 3).
- Same idempotency-key rules as join: the same key with different details is a conflict.

### Requests whose session details change

Only a **material** change counts. This uses the D-14 rule booked parties already use: a `session_changes` row with `material = true` and a version newer than the request's consent version. A material change after someone asked means their consent no longer covers the current terms. That request is shown to the organizer as **"Waiting for them to confirm the new details"**, and Accept is unavailable for it. The requester sees the current details and a **Keep my request** button. Tapping it re-takes consent and keeps the request's original asked-at time. Like join, it sends the version they saw and gets `stale_terms` if the version has moved. Cancel stays available.

A non-material edit (a typo, the join-mode switch) leaves the request acceptable. Without this rule, a person could be confirmed on terms they never agreed to (anti-goal).

### Windows, limits and races (my calls, from the existing code)

- **When asking is possible:** the same window as joining, from registration open (`opensAt`) until start. Asking checks the session version exactly as join does.
- **Accept:** refused at or after start. A request asked inside the window stays acceptable after the window, until start.
- **Full sessions:** no extra case. Sessions have no waitlist off switch, so a party that doesn't fit always goes to the back of the waitlist, as with join.
- **Cancellation:** if the session is cancelled, pending requests can no longer be acted on and show "This session was cancelled". No email is sent beyond the existing cancellation email, which goes only to booked people.
- **The cancel limit** counts that person's `cancelled` request rows for that session. Earlier bookings don't count.
- **Asking again:** someone who was accepted and later withdrew may ask again, subject to the limits. Declined stays final for that session.
- **Organizers and co-hosts** of the session join directly even on an Ask to join session. They are never asked to request their own session.
- **Locking:** every request action takes the session lock that join takes. Two accepts, accept vs cancel, accept vs Decline the rest, and accept vs the last seat all produce one result. Decline the rest skips rows that are no longer pending and returns how many it declined.
- **"Played in this group's sessions":** counts checked-in primary seats (seat 1) of that person in completed sessions of this group. Guest seats never count.

### Screens

**Session form (create/edit).** One field, "Who can join". It's a two-option choice, **Join directly** (default) or **Ask to join**, each with a one-line hint: "Anyone with the link can take a spot." / "You accept or decline each person." It belongs near capacity and guests.

Changing it is not a material change under D-14: no confirmation step, no free withdrawal, no email. It's stored in the session details like guests. Existing confirmed and waitlisted parties are never affected by a change.

**Session page, signed-out visitor.** The same details and counts as today. The action reads "Sign in to ask to join".

**Session page, signed-in person, Ask to join session:**

- *No request:* the same panel as joining (seats choice when guests are allowed, guest name, consent) with the button **Ask to join**. One line under it: "The organizer accepts or declines each request."
- *Pending:* "Request sent. The organizer will accept or decline it." Shows the party (1 or 2 seats) and a **Cancel request** button with one confirmation.
- *Needs confirming:* as above, plus "The details changed since you asked." and **Keep my request**.
- *Declined:* "The organizer didn't accept your request for this session." No action.
- *Expired:* "This session has started." No action.
- *Accepted:* the normal booked view (confirmed or waitlisted), exactly as after joining.
- A person already confirmed or waitlisted always sees their booking, never the request UI.

**Session page, organizer or co-host.** A **Requests (N)** section above the roster, shown when there are pending requests. Each request is a card with the details above and **Accept** and **Decline** buttons. Decline asks for one confirmation. Accept doesn't, and its result says where the person landed ("Alex is in" / "Alex is #3 on the waitlist").

When two or more requests are pending, a **Decline the rest** button declines every pending request after one confirmation that names the count. After start, the section shows "Requests that weren't answered expired when the session started" and no actions.

**Sessions tab.**

- A requester's row shows the status **"Request sent"**, or "Declined" or "Expired" in past or terminal cases.
- An organizer's row for a session with pending requests shows "N requests" beside "Organizing".

**Availability counts.** Unchanged. Pending requests appear in no public count.

### Email: none (owner, 2026-10-28)

The owner directed "Don't do any emails from here on out." Asking, cancelling, accepting, declining and Decline the rest send **no email** to anyone. That includes the joined-confirmed and joined-waitlisted emails a direct join sends: an accepted party is placed without queuing them. The requester learns the outcome on the session page and the Sessions tab. Emails that already exist for other events (a later promotion from the waitlist, the 24-hour reminder, cancellation) keep working for an accepted party exactly as they do for anyone booked. This replaces the D-19 amendment's "one email on accept or decline", and the PRD is updated to match.

### Full sessions (owner question, 2026-10-28)

People can still ask when the session is full. This is the same as Join directly, where a full session puts you on the waitlist. Both sides are told before they act:

- **The person asking** sees the usual "Full" availability and, above the button: "It's full. If the organizer accepts, you'll join the waitlist." The consent they give already covers being confirmed from the waitlist later.
- **The organizer** sees on each card where Accept would put them right now: "Fits now" or "Would join the waitlist at #N". When the +1 doesn't fit whole, the card says so.
- Organizers who want no more people can **Decline the rest**, or switch the session back to Join directly. Switching doesn't affect anyone already pending.

### Data

- Session details gain `joinMode: "direct" | "request"`. A missing value reads as `"direct"`.
- A new `app.join_requests` table holds one row per ask: session, person, primary/guest names, seats, consent version and time, state (`pending`, `accepted`, `declined`, `cancelled`), asked-at, decided-at, decided-by (actor and name), and the resulting party id on accept. "Expired" is derived (pending and now ≥ start), so no scheduler is needed.
- A partial unique index allows one pending request per (session, person).
- Join and accept share one admission path. The body of `api.join_session` that places a party (fill waitlist, check fit, assign the queue sequence, confirm the fee, record the event) moves into an internal function. Join and accept both call it under the same session lock.
- `api.join_session` refuses a direct join on a request session with a new `request_required` error, including through a direct API call.
- An accept that finds the person already confirmed or waitlisted marks the request accepted and links that existing party. It never creates a second party.
- New API calls: ask, cancel, keep (re-consent), accept, decline and decline-the-rest. Each is idempotent with an operation key and denied to non-managers where it should be.

## Constraints

- The existing stack and conventions: SQL functions behind `apps/api`, Hono routes, shared types in `packages/domain`, `node --test` integration tests through `pnpm test:api`, and the checks in README.
- Pre-launch: a one-way migration is fine (owner memory).
- D-13: the interface asks only what the organizer must decide, with no internal terms.
- D-15: one primary action per view. For organizers that stays Share; Accept and Decline are per-card actions.
- Accessibility: real buttons, focus kept after an accept/decline removes a card, status in words and not colour, and reduced motion respected.

## Left to the builder

- Exact SQL function and route names, error codes beyond `request_required`, and the migration split.
- Card layout details within the existing UI kit, and where "N requests" sits on the Sessions row.
- How the organizer's request list refreshes. Refreshing on focus and after each action is enough. Live updates are not required.
- Test layout, as long as the acceptance criteria in WDL-412 and the limits above are each covered, including the races: two managers accepting, accept vs cancel, and accept vs the last seat.
