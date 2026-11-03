# Search redesign: sessions, people and clubs

Status: **draft for owner approval.** Owner decisions recorded below (2026-11-03). Brainstormed with the owner on 2026-11-03.

## Intent

Search should be where people go to find something to do and someone to do it with. Today it finds groups by name and only your own sessions. It is a plain text box and a list.

The owner described three people who open Search:

1. Someone looking for a game in public postings, today or on another day. This is the default view.
2. Someone trying to find a particular person.
3. Someone looking for interesting public clubs.

The look should be "less boring and more modern, but not excessive that it becomes noisy and corny" (owner).

## What this changes in the PRD (owner decisions, 2026-11-03)

- **Public sessions become discoverable.** The PRD excluded an open discovery feed ("other people's sessions are never discoverable and people can't be looked up") and parked "Discovery by area/activity" in phase 3. The owner now wants public sessions browsable in Search:
  - "Public sessions automatically show in the calendar activities. Private don't."
  - This includes public sessions that already exist.
  - Private sessions never appear.
- **People can be looked up when they choose to be.** Each profile gets a public/private setting:
  - **public by default**
  - the private setting is "easily seen but not overcrowding the profile page"
  - a private profile is never found by search
- **Clubs.** Public groups are found and browsed, which extends P-37's search by name. Private groups don't appear in browsing; they still show by name only, as today, when searched by name.
- **Parked:** "near me", distance and any location filter. These need real locations, so they will be planned separately (owner: "park this near me or actual location based feature so we can plan it better").

The PRD gets a new accepted decision (D-27) recording all of this.

## Goals

1. Opening Search shows public sessions for today, with the next days one tap away.
2. One search box finds sessions, people and clubs.
3. Filters narrow sessions by what matters when picking a game.
4. People control whether they can be found.
5. The page feels current and calm: clear hierarchy, generous spacing, few colours, no decoration for its own sake.

## Non-goals

- Distance, "near me", maps, area or location filters (parked).
- Follows, friends, feeds, messages, recommendations, "people you may know".
- Ranking sessions or people by popularity.
- Search for signed-out visitors (Search stays signed-in only, as today).
- Ranked sessions in Search: they are always private.

## Anti-goals (a failure even if it works)

- A private session, a private profile, or a private group's details ever appear.
- An email, a phone number, or what sessions someone joined ever appear in people results.
- The page becomes busy: loud gradients, emoji, confetti, badges everywhere, more than one accent colour.
- The default view is empty or confusing for someone who just wants a game today.

## The page

### Top

- Title **Search** and one search box ("Search sessions, people and clubs").
- Under it, a three-way switch: **Sessions · People · Clubs**. Sessions is selected by default.
- The search box and the switch work together: typing searches whichever is selected.

### Sessions (default)

- **Date strip.** A horizontal row of days starting today: "Today", "Tomorrow", then "Wed 5", "Thu 6", and so on.
  - It covers 14 days and scrolls sideways on a phone.
  - Today is selected on open.
  - Each day shows how many sessions it has, so empty days read as empty before you tap them.
  - Days are in the viewer's device time zone.
- **Session cards** for the selected day, earliest first. Each card shows:
  - the start and end time
  - the title and activity
  - the place, and the host's name
  - spots ("3 spots left", "Full · waitlist", or "Join by request")
  - the fee ("Free" or the amount; for a split fee, the estimated share)

  One tap opens the session page, where joining works as it does today.
- **Which sessions:**
  - published, `access = public`, not cancelled, and not yet ended
  - sessions that already started today still show until they end, marked "Happening now"
  - private and draft sessions never show
- **Typing** filters sessions across all 14 days by title, activity, place or host name. A host whose profile is private is not matched by name. Days with no matching session show 0.
- **Filters** open from a "Filters" button into a sheet:
  - Activity (one or more, from the activity catalog)
  - Time of day: morning (before 12:00), afternoon (12:00–17:00), evening (from 17:00)
  - Price: free or paid
  - Spots: has spots left
  - Joining: join directly or ask to join

  Active filters show as small removable chips under the search box, with "Clear all". Filters apply to every day of the strip.
- **Empty states.**
  - A day with nothing: "Nothing on this day yet." and, when other days have sessions, a "Next: Thu 6" link.
  - Nothing matching the filters: "No sessions match these filters." with "Clear filters".

### People

- **Before typing:** a short line, "Find people by name. Only public profiles show up." Nothing is browsed: people are found by name, not listed.
- **After typing at least 2 letters:** up to 20 people with public profiles whose shown name matches. Each row shows:
  - initials avatar and name
  - their activities and self-rated levels
  - ranked medal if any

  A row opens the existing public profile page (`/people/{id}`).
- **Never shown:** email, account name if different, private profiles, or anything about which sessions they joined.

### Clubs

- **Before typing:** public groups listed, the ones with the most members first, each showing its name and member count.
- **After typing:** public groups matching the name, plus private groups by name only (as P-37 does today, so you can find a group you were told about).
- A public group opens its page, where asking to join works as today.

### Profile privacy

- **The setting:** on the owner's own profile page, one quiet row near the bottom: "Profile: Public · anyone signed in can find you in Search" with a switch.
  - Turning it off reads "Private · only people who already have your link see it".
  - No banner and no repeated reminders.
- **Default:** public for everyone, existing accounts included (owner decision).
- **What private hides:** a private profile is not found in Search. Its page stays reachable by link, as profile pages are today.

### Look and feel (owner: modern, not noisy)

- Built from the existing shadcn/ui components and RallyPoint tokens (D-24, D-25), in light and dark.
- **Date strip:** pill-shaped day chips. The selected day is filled with the primary colour; the others are quiet, with the count in small muted text.
- **Session cards:** white or card surface, rounded corners, a soft shadow on hover only.
  - The time is set in large type on the left, as on Home's "Up next".
  - Title, place and host sit on the right.
  - Spots and fee go in one muted line, with the status in words plus an icon, never colour alone.
- **The switch and the filters:** the three-way switch is a segmented control. Filter chips are small outlined pills.
- **Motion:** short fades when switching day or tab, and none with reduced motion.
- **Restraint:** no illustrations, gradients or emoji. One accent colour.

## Constraints

- $0 new monthly spending; no map or places service.
- Pilot scale (D-08). Each list is bounded: up to 50 sessions per day, 20 people, 30 clubs. A day with more sessions says "Showing the first 50".
- Authorization at the trusted boundary. Search reads go through new SQL functions that only return public sessions, public profiles and public groups.
- Mobile-first, keyboard and screen reader friendly. The result count is announced politely, and focus never jumps while typing.
- D-13 copy: no internal terms. Times are local, with no time zone shown.
- Synthetic data only in development; the schema change ships as a migration with a recovery note.

## Builder's calls (open to owner correction)

- Search stays signed-in only.
- 14 days in the date strip.
- Time-of-day boundaries: before 12:00, 12:00–17:00, from 17:00, by the session's start in its own time zone.
- "Happening now" sessions stay listed until they end.
- People are found by name only, never browsed.
- Clubs are browsed with the most members first, showing name and member count only. Groups have no activities of their own, and the only link from a group to sessions is through private ones, so "what they play" is left out rather than leaking private sessions. A group activities field can come later.
- A host with a private profile still shows as host on their public session cards, since the session itself is public. Typing their name doesn't find their sessions, so a private profile can't be traced through Search.
- A typed query in Sessions searches all 14 days, and each day shows its matching count.
- Search still finds your own sessions, private ones included, as it does today (owner, 2026-10-30). When you type in the Sessions tab, a small "Your sessions" group shows your matches above the public ones. It shows nothing when the box is empty.

## Left to the builder

- Data model for the profile setting, and the search reads (one call per tab, or one per day).
- How the date strip scrolls and snaps on a phone.
- Exact wording within the D-13 and D-15 rules.
