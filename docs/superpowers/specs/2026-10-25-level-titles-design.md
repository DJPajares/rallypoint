# Level titles tied to badges (WDL-405)

Linear: [WDL-405](https://linear.app/wwonderland/issue/WDL-405). Requirements: PRD RP-15, D-06, D-16. Builds on P-19 ([design](2026-10-25-badge-levels-design.md)), merged in PR #39. Owner direction: the design talk on 2026-10-25.

## Intent

Today a title is an old badge name ("Twenty-Five", "Host") shown beside a person's name. The owner wants the title to say something about the person, through what they achieved:

> "it should tell something based on the user's achievement which is tied to the badge selected. sample … rally level 5, says "rally master". it's a user title that is related to the badge and at the same time describes the person and his achievement"

> "the title's badge can't be retroactive, it must select the latest title tied to the achievement/badge"

> "don't change the badge name. a user title is different from it. but it is tied to it. so level 1 badge contains, badge name and user title"

So each level of each badge carries a **level title**. A person picks which badge to show, and the title always reads that badge's current level.

## Goals

1. **30 level titles:** one per level of each of the six badges, using the owner-approved wording below.
2. **Pick a badge, or none.** The shown title is always that badge's current level title, and it moves up with the level.
3. **Every existing title choice moves to a matching badge.** Nobody shows a title they haven't earned.
4. **One moment per achievement.** A level-up of the badge you show is announced in the existing new-level sheet, never in a second popup.

## Non-goals

- **Unchanged from P-19:** badge names, icons, colours, thresholds and how levels are counted.
- **Ruled out by the task:** free-text or custom titles, rankings, rarity, skill or reliability claims, and purchases.
- **Ruled out by the owner:** choosing an older level's title ("can't be retroactive").
- More badges ([WDL-407](https://linear.app/wwonderland/issue/WDL-407)), and commendations or skills ([WDL-406](https://linear.app/wwonderland/issue/WDL-406)).

## Anti-goals (a failure even if it works)

- A title shows a level the person hasn't reached, or stays up after its evidence is corrected away.
- A title or its data reveals group names, dates, sessions or who someone played with.
- Levelling up produces two interruptions: the level sheet and then a title prompt.
- A level title is just a badge's name ("Rally", "Host").
- Pages that show names break while the app and database are on different versions.

## The level titles (owner-approved 2026-10-25)

| Badge (what it counts) | Level 1 | Level 2 | Level 3 | Level 4 | Level 5 |
|---|---|---|---|---|---|
| **Rally** (sessions played) | Rookie | Regular | Mainstay | Veteran | Rally Master |
| **Steady** (months played) | Returner | Familiar Face | Fixture | Year-Rounder | Lifer |
| **New Faces** (people met) | Friendly Face | Mixer | Connector | Social Butterfly | Super Connector |
| **Plus One** (guests who came) | Good Company | Recruiter | Talent Scout | Ambassador | Grand Ambassador |
| **Host** (sessions run) | Organizer | Game Runner | Ringleader | Club Captain | Community Pillar |
| **Full House** (full sessions run) | Crowd Puller | Crowd Favourite | Headliner | Sell-Out Star | Main Event |

- **"Rally Master" stays.** The owner: "perfect due to the app name". Beside the Rally medallion it reads as sessions played, not skill.
- **No title equals a badge name** (Rally, Steady, New Faces, Plus One, Host, Full House). A test checks this.

## Behaviour

### Choosing
- The title picker on your profile lists:
  - "No title";
  - each badge you've started (level 1 or higher), shown as its pill with "Rally · level 3" beneath.
- Saving stores the **badge**, not the words.
- The server accepts only a catalog badge you have started right now, or none. Anything else is refused with the existing errors. Saving the same choice again changes nothing.

### Showing
- The pill is the badge's medallion at its current level, then the level title, for example "Mainstay".
- It shows in the same places as today: the profile head, the public profile and rosters. The audiences are unchanged (D-06).
- The data behind a pill is `{ key, level }` only: no group names, dates or counts.
- **The owner's badge sheet** (P-19's five-level list) shows each level's title beside its target, for example "Level 3 · 25 sessions · Mainstay". Levels not yet reached show their title as what that level brings. Only reached levels can be shown beside your name.
- **The public badge shelf** is unchanged: badge and level.

### Levels change, the title follows
- **Level goes up:** the title moves up with it (Rookie → Regular).
- **Correction takes a level away:** the title moves down with it.
- **Badge drops to "not started":** no title shows, but the choice stays saved and returns if the badge is earned again.

### New-level sheet (P-19's sheet, one moment)
- **The badge you show levels up:** the sheet adds one line, "Your title is now Mainstay." If other badges also have new levels, the sheet leads with the badge you show, so this line is never folded into "+N more".
- **Any other badge levels up:** the sheet offers a button named with the new words, "Show “Mainstay” as my title", which sets that badge.
- There is no separate title popup, reminder or banner.

### Existing title choices
These move once, when the change ships:

| Old title | Becomes |
|---|---|
| First Rally, Ten, Twenty-Five, Fifty, Century, Regular, Off the Bench | Rally |
| New Faces, Mixer, Connector | New Faces |
| Host, Seasoned Host | Host |
| Plus One | Plus One |
| Full House | Full House |
| Founder | Host if Host is started; otherwise no title |

- **Regular and Off the Bench** always involve a check-in, so Rally is started for anyone who still has them.
- **Founder** has no matching badge; this is the one case that can clear a title.
- **Afterwards**, each moved choice shows its badge's current level title, under the same "started" rule as above.

## Constraints

- **Storage:** reuse `app.user_titles` (one row per person) to store the chosen badge key.
- **Old evaluation:** the old-badge evaluation (`app.earned_badges`) and the old-title mapping in the domain package exist only for titles. They are removed once nothing uses them.
- **Migration:** a single migration later than `20261025090000`. It keeps the `service_role`-only grants and states its recovery steps.
- **Recovery is one-way (owner, 2026-10-25: "just do whatever is necessary. this app is not launched yet so we can change anything and even everything").**
  - Old title choices are not backed up.
  - A rollback maps each badge back to its level-1 old title (rally→`first-rally`, new-faces→`new-faces-10`, host→`host`, plus-one→`plus-one`, full-house→`full-house`), and steady is cleared.
  - `app.earned_badges` and the old-title code are dropped in this change.
- **Release order, as in P-19:** ship the app first, then apply the migration. The app must treat a title it doesn't recognise (old or new shape) as no title, rather than failing.

## Builder's calls (open to owner correction)

- The field is called the "level title" in code and docs. The interface just says "title".
- The picker shows "Rally · level 3" under each pill, so people know which badge a title comes from.
- When the badge you already show levels up, the sheet has no title button, only the "Your title is now …" line.
- The five-level badge sheet shows every level's title, reached or not, as what the level brings. "Level 1 badge contains badge name and user title."
- When several badges level up at once, the sheet leads with the badge you show.

## Left to the builder

The API and SQL shape, the migration's mapping query, the CSS, and test structure.
