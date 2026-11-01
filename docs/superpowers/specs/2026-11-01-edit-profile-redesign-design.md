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
- **Something else?** — up to three typed-in activities as rows of their own. Each has a name input, the same level radios (with the typed activity's descriptions, or the general ones) and a Remove link.
- **Save** — the single orange action in `StickyActions`, with Cancel beside it. While saving, the form is disabled and the button reads "Saving…". On success you return to Profile, which announces "Profile saved." A failure keeps every choice and says what to do. The existing "save again to be sure" wording still covers unclear results.
- **Leaving** — Back and Cancel ask "Discard your changes?" when something changed, and a clean form leaves at once. Closing or reloading the tab with changes triggers the browser's own warning.

## Unchanged

- The levels, their stored values and the API: `POST /api/me/profile` takes the same shape. No migration and no new PRD decision, because the scale didn't change (AC 7 doesn't apply).
- Validation is still `normalizeProfile`, with the same error wording, and it still focuses the field that has the problem.
- The public profile (`/people/{id}`) still reads the same saved activities and levels.

## Excluded

Photo (WDL-404), vouches or verified skill (WDL-406), matching or filtering by level, and anything inferred from attendance.
