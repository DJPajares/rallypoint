# Sessions tab and the player's game-day view (P-14)

Linear: [WDL-389](https://linear.app/wwonderland/issue/WDL-389). Requirements: PRD D-12, D-13, RP-05, RP-12, RP-16. Owner direction, 2026-10-23.

## Intent

A person who joins a session today has no way back to it inside RallyPoint. The Sessions tab in the main menu is an empty placeholder, Home lists only groups, and joining a session doesn't make you a group member. Their only way back is the original link or an email. That breaks the loop at "show up".

The owner described what a player wants on game day:

> "open the session page and see useful information like the event place. ability to see the exact location, like opening it from my maps app. maybe i want to see who's coming to the game once again. or maybe i want to double check if the time i had in mind is correct. how much i paid. all the things that might help me when that game day comes. but not too noisy"

The owner approved the mockup of both screens ("lgtm"). This design is that mockup, written down.

## Goals

1. **Sessions tab:** one list of your sessions across every group, so you can always get back in.
2. **Game-day view:** once you've joined, the session page leads with what you need on the day and tucks away what you already agreed to.
3. **Open in Maps** beside the venue.

## Non-goals

- Discovery: sessions from groups you have no part in, public listings, search or filters.
- Calendar export, notifications and a Home "up next" card.
- Organizer-pasted exact map pins. Parked P-17 ([WDL-392](https://linear.app/wwonderland/issue/WDL-392)) stays for that.
- Any change to the organizer's page or game-day tools, or to the page before someone joins.
- Editing anything. P-20 owns the wider page redesign; this change only reorders what a joined player sees.

## Anti-goals (a failure even if it works)

- A session from a group you have no part in shows up, through the UI or a direct API read.
- The game-day view is noisy. If it reads like today's page with more added, it failed.
- Status is shown by colour alone, or the list shows another person's money, attendance or roster.
- Withdraw becomes hard to find, or loses its fee warning and consent.

## Part 1: Sessions tab (`/sessions`)

**Who sees what.** Signed in only. A signed-out visitor goes to sign-in and comes back to `/sessions` (the existing `RequireAuth`). A session is listed if either:

- you have a **confirmed or waitlisted party** in it, or
- you're the **owner, organizer or co-host** of its group.

Withdrawn, released or removed parties don't count. A session you left doesn't appear unless you organize it.

**Sections.**

- **Coming up:** sessions that haven't ended, soonest first. Cancelled sessions stay here, labelled Cancelled, until their start time passes, so people see that it's off.
- **Past sessions (n):** one link that expands the most recent 20 sessions that have ended, newest first.

**Each row** uses the same date-tile card as the group page:

- The date tile.
- The title.
- The start time in the session's own local time, with no zone label (D-13).
- The group name.
- One status in words:

| Status | When |
| --- | --- |
| You're in | You have a confirmed party. |
| Waitlist #n | You're waiting; n is your party's current position. |
| Organizing | You manage the group. This wins over the two above. |
| Draft | Managers only, for an unpublished session. |
| Cancelled | The session was cancelled. This wins over everything. |

Status is always written out. Colour only supports it.

**Tapping a row** opens `/s/{slug}`. A draft opens its editor instead (`/sessions/{id}/edit`).

**Empty state.** One plain line: "Nothing coming up. Sessions you join or run will show here." Organizers also get the existing New session action. No promise about being added to groups (see P-25, WDL-400).

**Data.**

- A new read, `GET /api/me/sessions`, backed by `api.list_my_sessions(p_actor_id)`. It follows the existing pattern: security invoker, service-role-only grant, actor taken from the verified session (as in `list_my_dues` and `list_my_groups`).
- It returns per row: `slug`, the `id` for drafts only, `title`, `groupName`, `startsAt`, `endsAt`, `timeZone`, `state`, `status` and `waitPosition`.
- It never returns rosters, fees, payments or attendance.
- It's bounded: up to 100 coming up and the 20 most recent past sessions.

## Part 2: The game-day view on `/s/{slug}`

**When it applies:** the signed-in viewer has a **confirmed or waitlisted** party, is **not** a manager, and the session is published (not cancelled or finished). Everyone else sees today's page unchanged. That covers signed-out visitors, people who haven't joined, people who left and managers.

**Order, top to bottom:**

1. Group name, title and activity, as today.
2. **Status banner:** "You're in" with "with 1 guest" when relevant, or "Waitlist #n". The session date goes underneath.
3. **Time:** start–end, with the date.
4. **Place:** the venue text and an **Open in Maps** button (see Part 3).
5. **Who's coming:** "12 of 16 coming". Confirmed players also get the existing display-name roster behind "See who's coming" (RP-16). Waitlisted players see the count only, as today.
6. **Your fee**, shown only for a tracked session (D-18):
   - The amount for your seats and its status (Due, Paid, Waived), with who marked it paid and when, using today's wording.
   - When it's due under Pay the organizer: the existing payment instructions and "I've sent it" note.
   - For a "Not tracked here" session there's no fee row at all, never "Free".
7. **Good to know:** the organizer's instructions, when there are any.
8. **More:** one collapsed row holding everything else that's there today: the spots meter and waiting count, the cancellation terms, the guest rule, Share, and Withdraw or Leave the waitlist.

Withdraw keeps its current confirmation and fee wording exactly. It's just one tap further away.

Nothing new is fetched for this view. It's the same data as today's page, in a different order. Recovery states keep working: refresh, "Check your request" and errors.

## Part 3: Open in Maps

Show a plain link beside the venue wherever the session page shows it, for every viewer who can already see the venue. The link is a keyless Google Maps URL:

`https://www.google.com/maps/search/?api=1&query=<URL-encoded venue text>`

No key, SDK, lookup or Google Cloud service is involved. The device opens the Maps app or the browser. The link opens in a new tab with `rel="noopener"`, and there's no button when the venue text is empty.

This searches the venue text, so a vague venue gives a vague result. That's the accepted trade-off for now; organizer-pasted exact links remain P-17.

## Constraints

- D-13 copy rules: plain words, no internal terms and no zone labels.
- Accessible controls: 44px targets, visible focus, the disclosure announces its state, and reduced motion is respected.
- Authorization is server-side and is the only thing that decides what's listed. Synthetic data only.
- Adopted checks: `pnpm check` and the `node --test` suite against the local app, with an isolation test.

## Settled after the builder check

- **"Ended" means `endsAt` has passed.** Nothing sets a `completed` state today, and publishing always stores an end time. The list and the view both derive "ended" from `endsAt`; no state-flip job is added. A session in progress (started, not ended) stays in Coming up and keeps the game-day view.
- **Page data.** The page lifts the viewer's registration read (`/api/registrations/{slug}`) up from `RegistrationPanel` so it can choose the layout; the endpoints don't change. After a successful join the page switches to the game-day view straight away, with focus on the status banner. After withdrawing it switches back to today's layout. The "Check your request" recovery stays where it is and shows on whichever layout is current.
- **Fee row.**
  - A split session reuses the existing `SplitFee` estimate or finalized claim UI for your seats.
  - A waitlisted party with no obligation gets no fee row.
  - Since the view only applies to confirmed and waitlisted parties, released and removed states never reach it.
- **Open in Maps appears on every view of `/s/{slug}` that shows the venue:** before joining, signed out, cancelled, and the manager view. It's additive, and it's the only change those views get. It doesn't appear in the editor or on the group page.
- **Managers are owner, organizer and co-host**, read from the existing group roles. They see every session in their groups within the bounds.
  - Drafts always sit in Coming up, whatever their date, because they're unfinished work.
  - A manager who also holds a party shows Organizing, with no position.
  - Cancelling a session doesn't change its parties' states, so your party still ties you to a cancelled session.
- **Bounds.** Silent truncation at 100 upcoming is acceptable for the pilot. "Past sessions (n)" shows the true total, while the list shows the most recent 20.

## Left to the builder

The exact component structure, the SQL shape of `list_my_sessions` (as long as it reuses existing party/role tables and the bounds above), styling inside the existing design tokens, and test layout.

## Builder's calls (open to owner correction)

- Organizing wins over You're in, and Cancelled wins over all.
- Cancelled sessions stay in Coming up until their start time passes.
- Past shows the 20 most recent; upcoming is capped at 100.
- The game-day view applies to waitlisted players too, without the roster, as today.
- A finished or cancelled session keeps today's page.
- The maps link searches the venue text rather than needing a pasted link.
