# Home, Sessions and Groups redesign

**Owner request, 2026-10-30:** "improve the design of the home, sessions, and groups pages. Make them have the same design direction and be consistent. Follow the ui ux design principles and improve hierarchy and layouts. Make the design not boring. Improve hero." The owner approved the proposal ("All good").

## Direction (D-15 "Quiet, not boring", matching the group page)
- **One frame for all three tabs:** the same left-aligned column (form width), a large title, and one line of what's true now:
  - Home: "Friday, October 30 · 3 sessions this week";
  - Sessions: "4 coming up · next today, 7:00 PM";
  - Groups: "3 groups · you run 2".
- **One row style:** grouped lists in which every row leads with a picture, and the whole row is the tap target. There are no per-item buttons.
  - A session row has a date tile, its title, the time and place, and a status pill on every row (words plus tone). On phones the pill moves under the line so titles keep their room.
  - A group row has its gradient crest, its name, and "Admin · Private · 5 members".
- **Home's hero, Up next:** the next session you're in, hosting or waiting for, as one big card:
  - a filled brand-colour date tile;
  - "Up next · Starts in 3 hours";
  - the title, time and place, and your status;
  - for a host, "N waiting" and "N to pay".

  With nothing coming up, it becomes a calm empty card with New session.
- **Below the hero on Home:** invites, "This week" (up to 4 more), the next badge, and up to 3 groups.
- **Removed:** the "Plan the next one" card, which competed with the + tab.
- **Sessions:** day headings stay pinned while scrolling, and today's date tiles are outlined in the brand colour.
- **Groups:** "Start a group" is a quiet last row.

## Data (read-only, already visible to the same person)
- `api.list_my_groups` adds `memberCount`.
- `api.list_my_sessions` adds `location` to each row, plus `waitingCount` and `toPayCount` on a host's own upcoming published rows.

## Shared code
- `apps/web/src/visuals.tsx`: crest, faces and date tile.
- `apps/web/src/tab-parts.tsx`: the tab heading, session row, group row and Up next.
