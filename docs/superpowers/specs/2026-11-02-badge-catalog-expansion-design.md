# More badges (WDL-407)

Linear: [WDL-407](https://linear.app/wwonderland/issue/WDL-407). Requirements: PRD D-16 and the P-19 design ([2026-10-25 badge levels](2026-10-25-badge-levels-design.md)). Owner direction, 2026-10-25: "6 different badges is quite few … don't forget to create another task after this to handle expanding the badges." Owner approved this catalog on 2026-11-02 ("Approved and proceed").

## Intent

A long-time player should see more of their own story than six badges tell: playing beyond one organizer, picking up a second activity, the people they keep coming back to, and everyone who has come to the sessions they run. Each new badge uses P-19's engine, five shared levels, palette, numeral and medallion grammar.

## The catalog (owner-approved 2026-11-02)

Families keep their order on the shelf: playing (Rally, Steady, Explorer, All-Rounder), people (New Faces, Crew, Plus One), hosting (Host, Full House, Open Door).

| ID            | Name        | Family  | Meaning                                      | Icon (glyph)            | Counts (source)                                                                                              | Levels 1 · 2 · 3 · 4 · 5 | Titles 1 → 5                                                    | Scope        | State |
| ------------- | ----------- | ------- | -------------------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------ | ------------------------ | --------------------------------------------------------------- | ------------ | ----- |
| `explorer`    | Explorer    | playing | Playing beyond one organizer's sessions      | compass (`compass`)     | different organizers (the owner of a session's hosting team, never you) of sessions you played               | 2 · 3 · 5 · 8 · 12       | Wanderer, Roamer, Trailblazer, Globetrotter, Pathfinder         | all sessions | built |
| `all-rounder` | All-Rounder | playing | Playing more than your main activity         | split diamond (`split`) | sessions you played outside your most-played activity; "Other" and sessions without an activity are left out | 1 · 5 · 10 · 25 · 50     | Dabbler, Switch Hitter, Versatile, Multi-Talent, Decathlete     | all sessions | built |
| `crew`        | Crew        | people  | The people you keep coming back to play with | linked rings (`rings`)  | different accounts checked in at 3 or more of the sessions you played                                        | 1 · 3 · 5 · 10 · 20      | Teammate, Crewmate, Inner Circle, Core Crew, Family             | all sessions | built |
| `open-door`   | Open Door   | hosting | Everyone who has played at sessions you ran  | open door (`door`)      | different accounts, other than you, checked in at sessions where you ran check-in                            | 10 · 25 · 50 · 100 · 200 | Welcomer, Gatherer, Community Builder, Scene Maker, Town Square | all sessions | built |

"A session you played" and "ran check-in" mean exactly what they mean for the P-19 badges: your own checked-in seat at a confirmed booking of a non-cancelled session (`app.badge_sessions`), and recording a check-in at a non-cancelled session (`app.badge_hosted`). Guests have no account and never count toward these four.

## Rules each badge keeps

- **Derived, never stored.** Levels are recomputed from check-in records on every read, so corrections and cancellations recalculate them both ways, as for P-19.
- **No grinding.** Explorer, Crew and Open Door count different people, so repeating the same session adds nothing. All-Rounder counts real check-ins like Rally. Its count is your sessions minus those in your most-played activity, which never goes down as you play more; only a correction can lower it.
- **Private.** Public profiles show each badge's key and level, never counts, organizers, activities or people.
- **Existing badges untouched.** The six P-19 badges, their earned levels, seen markers and titles do not change. On release, levels people already have on the four new badges are marked seen, so nobody gets a pile of sheets for history.

## Left out, with reasons

- **Co-hosting.** Host already credits running check-in, which includes co-hosts; a role-based badge would also count sessions where the co-host did nothing.
- **Guests who later joined with an account.** Guest seats are not linked to an account, so the link can't be proven.
- **Playing in several groups.** Most sessions don't belong to a group people join, so it would undercount; Explorer covers the idea through organizers.

## Builder's calls

- Two approved titles repeated their badge's name ("Explorer" at Explorer level 2, "All-Rounder" at All-Rounder level 4), which the existing title rule forbids (a title never reads as a badge name). They are Roamer and Multi-Talent instead.
- Catalog order groups badges by family, so the new ones sit beside their family on the shelf.
- Crew's "3 sessions together" is fixed, not a level.
- A response from a newer database with a badge this app doesn't know drops that badge instead of breaking the page, because the database migrates before the app deploys.
