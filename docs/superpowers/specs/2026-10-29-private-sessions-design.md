# Private sessions (P-36) — design

Task: [WDL-414](https://linear.app/wwonderland/issue/WDL-414). This builds on P-35 (standalone sessions and member groups, [DJPajares/rallypoint#50](https://github.com/DJPajares/rallypoint/pull/50)), P-34 (Ask to join) and P-38 (direct invites, [DJPajares/rallypoint#51](https://github.com/DJPajares/rallypoint/pull/51)).

## Why

Owner, 2026-10-28: "there should be a public/private session settings when setting or editing the session up… A session can be set to only be available to a specific group/s… adding a group/s are not limited to groups. It can also be individuals." The scope and acceptance criteria in WDL-414 are the owner's. PRD RP-16 already requires that "private events require organizer-granted access; knowing the ordinary URL is insufficient". This task makes visibility an asked field, which changes D-13's "visibility is defaulted, never asked" for this one field.

## Goals

- The session form asks **Public** or **Private**. Public is the default and behaves exactly as today, with Join directly or Ask to join.
- A private session has an **access list** of community groups and individual people.
- **Who can see and join a private session** ("has access"):
  - the session's managers (owner, organizers and co-hosts of its hosting team);
  - anyone on the list directly;
  - any current member (any role) of a listed group;
  - anyone with a pending invite to it (P-38 said an invite would count as access);
  - anyone who has ever held a party in it, in any state (confirmed, waitlisted, withdrawn or removed), so they can always see and pay what they owe;
  - anyone with a pending Ask to join request from before it became private (see below).
- **Everyone else**, signed in or not, gets only "This session is private". No title, time, place, fee, counts, roster or join control, from the page or from any API call.
- Taking someone off the list, or a member leaving a listed group, never cancels their booking or changes their fee. It only stops new views and joins once they hold no party.

## Non-goals

- Ask to join on private sessions (refused; the form hides it).
- Invite codes or special private links.
- Discovery or search of sessions.
- Per-person roles on the list.
- Changing groups themselves.
- Email or push of any kind ("Don't do any emails from here on out").

## Anti-goals

- A private session's details, counts or existence beyond "it's private" reach someone without access, including through the share read, registration read, payment instructions or QR, previews, the page title, group pages or profile pages.
- A list change cancels, moves or re-prices an existing booking.
- The picker reveals people the organizer doesn't already know, or anyone's email.
- Internal words ("visibility", "access control", "ACL") appear in the interface.

## Decisions (my calls, open to owner correction)

### Data

- The session stores its mode, `public` or `private`, default `public`. Changing it is **not** a material change (D-14): it never asks booked people to re-confirm, and never bumps what they agreed to.
- A new table holds the list: one row per (session, community group) or (session, profile), exactly one set.
- **Limits:** at most 20 groups and 100 people per session.
- Making a session Public keeps its list (so switching back restores it) but the list then has no effect.
- **Run again / duplicate** copies the mode and the list as they are, without re-checking each entry, since the list is setup, not registration history, and only a manager of the original session can run it again.
- **Archived groups** stop granting access (matching how `app.known_people` ignores archived groups). Their list rows stay, so un-archiving restores access, and members keep any party they already hold.
- **Names on the list.** Every manager of the session sees the names (never emails) of everyone on its list, including people another manager added. That is the same session's own setup, so it's accepted.

### Who can be added

- **Groups:** community groups (not hosting teams), not archived, where the person saving is a member in any role.
- **People:** the same "people you know" set as P-38's invite picker (`app.known_people`): confirmed together in a session, or sharing a group.
- On save, the server checks every **new** entry against those rules. Entries already on the list are kept even if another manager added them or the saver no longer shares a group, so a co-host's edit never fails over someone else's pick.
- Whoever can edit the session today can edit its mode and list. No new role.

### Private and Ask to join

- On Private, the form hides "Who can join"; the session is always Join directly for people with access.
- The server refuses a new Ask to join on a private session. A person with access never sees the button.
- **Switching a session with waiting requests to Private:** waiting requests stay as they are. Those people keep access to see their request, and managers can still Accept or Decline them. No new requests can start. This needs no new request state and treats an organizer's Accept like an invite.

### Invites

- Sending an invite to a private session is allowed for managers as today. The pending invite is what lets the person see it. Withdrawing or declining the invite removes that access unless they're on the list or hold a party.
- Invite candidates are unchanged.

### Reads and writes that must check access

Every one of these returns the private result or refuses for someone without access, decided on the server:

- the share read (`/api/shared/:slug`), which must now accept an optional sign-in so it can tell who's asking;
- the registration read and every participant write (join, ask, keep/cancel request, withdraw, decline invite);
- payment instructions and the payment QR;
- any list that shows sessions to people other than their participants and managers (group pages, profile pages, Home). The builder confirms which exist; Sessions tab and Dues only list your own sessions and parties.

**One response shape for "no access".** The owner's acceptance criteria say outsiders see "This session is private", so saying a private session exists at that link is accepted; nothing else is. Reads (share and registration) answer normally with only `{ slug, private: true }`. Writes refuse with one code, `session_private`, and the message "This session is private." Unknown or draft sessions keep their existing not-found answers.

Writes by people who already hold a party (withdraw, their own payment views) keep working after they leave the list. Manager actions are unchanged.

### What people see

**Session form (create and edit).** A field "Who can see it":

- **Public** — "Anyone with the link." (default)
- **Private** — "Only people you add."

When Private:

- "Who can join" is hidden.
- An **Add groups or people** button opens a sheet with two sections: "Your groups" (tap to add) and "People you know" with a name search (tap to add). Added entries show as removable chips above the button: group names, then people.
- With nobody added, help text reads: "Only you and your co-hosts can see it until you add people or invite them." Saving with an empty list is allowed.
- Errors in plain words: "You can't add that group.", "You can't add that person.", "You can add up to 20 groups and 100 people."

**Session page, people with access.** Everything as today, plus a small "Private" label with a lock icon (text, not colour alone) beside the session's status.

**Session page, no access.**

- Heading: "This session is private".
- Signed out: "Sign in to see it if the organizer added you." with a **Sign in** button that returns to this page.
- Signed in: "Only people the organizer added can see it."
- The browser tab title is "Private session · RallyPoint". Nothing else from the session is shown or sent.

**Share button and previews.** The app has no rich previews today; any added later must return the generic private result. The link copied by Share is the same link; copying it reveals nothing more than opening it.

## Constraints

- The existing stack and test conventions, the P-35 hosting-team model, operation receipts for retries, and the lock order (group, then session) apply. A join and a list change on the same session serialise on the session row, so a join that commits after a removal is refused unless the person still has access another way.
- D-13 copy rules and D-15 one primary action per view.
- Accessibility follows P-34/P-35/P-38 practice: labelled controls, focus moves to the result, chips removable by keyboard.
- No email.

## Left to the builder

- Function, route and column names; where the mode is stored (column or session details).
- The sheet layout and chip styling.
- How the share read accepts an optional sign-in.
- Test layout. It must cover:
  - each kind of access (manager, listed person, listed group member, pending invite, party holder, pending request);
  - denial for signed-out and unrelated signed-in people through every read and write listed above;
  - removal keeping a booking and fee, and then blocking a rejoin after withdrawal;
  - leaving a listed group;
  - Ask to join refused on private;
  - save-time checks for unknown groups and people, archived groups, hosting teams and limits;
  - a join racing a removal;
  - Public behaving exactly as before.
