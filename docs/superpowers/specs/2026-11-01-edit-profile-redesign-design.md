# Edit profile redesign (P-32)

**Task:** [WDL-410](https://linear.app/wwonderland/issue/WDL-410/p-32-redesign-edit-profile-clear-easy-activity-choices-and-better-self). **Owner decisions, 2026-11-01:** keep the three levels (Beginner, Intermediate, Advanced) and show each one's description before choosing; rate an activity inline, directly under it.

## What was wrong

- Activities were checkboxes, each with a bare `<select>` beside it. The catalog already holds a one-line description per level, but it only appeared _after_ a level was picked, so it couldn't help anyone choose.
- Catalog activities, typed-in activities, the name and the account line all sat in one card with equal weight. Hard to scan.

## The design (D-15 "Quiet, not boring", D-21 one orange action)

- **Name** — one field. Help: anyone with your profile link sees your name and activities.
- **Activities you play** — one inset list (`rp-list`) of the catalog's listed activities (`/api/activities`, D-23).
  - Each row is one tap target: the activity icon, its name and a trailing state that uses words and an icon, not colour alone: **＋ Add** when off and **✓ Playing** when on. Underneath it is a native checkbox named by the activity.
  - When on, the row's subtitle shows the rating ("Intermediate" or "Not rated"), and a level choice opens directly below: native radios for Beginner, Intermediate and Advanced. Each shows its description for that activity, followed by **No rating**. Arrow keys move between them, and the group is named "Your Badminton level".
  - Turning an activity off hides its levels but keeps the chosen level until Save, so an accidental tap loses nothing.
- **Folding (owner feedback, 2026-11-01):** the "Activities you play" heading is a toggle (a button inside the heading, with `aria-expanded`). It starts open. Folded, the list is inert and a summary line ("Badminton · Intermediate, Tennis") stands in for it. The fold animates its height, and switches instantly with reduced motion.
- **Something else?** — up to three typed-in activities as rows of their own. Each has a name input, the same level radios (with the typed activity's descriptions, or the general ones) and a Remove link.
- **Save** — the single orange action in `StickyActions`, with Cancel beside it. While saving, the form is disabled and the button reads "Saving…". On success you stay on Edit profile, which then shows what was stored with nothing left unsaved, and a "Profile saved." toast pops in at the top and leaves on its own (owner feedback, 2026-11-01; Base UI Toast, mounted once for the whole app). A failure keeps every choice and says what to do. The existing "save again to be sure" wording still covers unclear results.
- **Leaving** — Back and Cancel ask "Discard your changes?" when something changed, and a clean form leaves at once. Closing or reloading the tab with changes triggers the browser's own warning.

## Profile: Plays card (owner feedback, 2026-11-01)

"Plays" moves out of the profile head into its own card, placed after the stats card (or after the message standing in for the stats while they load or fail), like the other sections:

- one row per activity: its icon in a tinted circle (the same tint as "Playing" in Edit profile), its name, a three-step meter and the level in words ("Not rated" when blank);
- "Self-rated" is said once, beside the heading;
- visitors see the same card when the person plays something;
- an owner with no activities gets a short prompt and an "Add activities" link, shown only after the profile loads.

## Profile: actions row (owner feedback, 2026-11-01)

Sign out leaves the Account section and becomes an icon-only button at the end of the Edit / Share row. It's named "Sign out" for screen readers and has a tooltip, and any sign-out error appears right under the row. The row stays on one line: below 25rem the buttons read "Edit" and "Share", with "profile" kept for screen readers. A long activity name wraps, and its level drops under the name. Account keeps only "Signed in as …".

## Unchanged

- The levels, their stored values and the API: `POST /api/me/profile` takes the same shape. No migration and no new PRD decision, because the scale didn't change (AC 7 doesn't apply).
- Validation is still `normalizeProfile`, with the same error wording, and it still focuses the field that has the problem.
- The public profile (`/people/{id}`) still reads the same saved activities and levels.

## Excluded

Photo (WDL-404), vouches or verified skill (WDL-406), matching or filtering by level, and anything inferred from attendance.
