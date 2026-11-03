# Ranked matchmaking (D-26)

Status: **owner-approved 2026-11-03** ("Approve and proceed"). Approval covers this design; Linear tasks and implementation each need their own approval. Brainstormed with the owner on 2026-11-02 and 2026-11-03, starting from [WDL-406](https://linear.app/wwonderland/issue/WDL-406).

## Intent

Players want to know how good they are and to play people at their level, the way ranked modes work in online games. A player searches for a ranked pickleball match; RallyPoint finds opponents of a similar rank in the areas they chose, which may take days; the players book a court and play; the result moves everyone's rank up or down.

This replaces WDL-406's co-player vouching idea. The owner chose an automated win/loss rating over nods (2026-11-02: "instead of this nod, can we just have an automated system for ratings… used for matchmaking… think of it like the online games ranked matchmaking").

## What this changes in the PRD (owner to confirm on approval)

- **D-16** says badges never rank people and WDL-406 excludes ratings and rankings. Ranked play is a new, separate system: badges stay unranked, and ranks come only from ranked matches.
- **Exclusions / phase 3**: matchmaking puts strangers together. It is not a browse feed: nobody can look people or sessions up; the engine only pairs people who are searching. Leaderboards stay out.
- **Profile**: the self-rated level (Beginner/Intermediate/Advanced) stays as it is and is never changed by ranked results. The ranked rank is shown separately.
- **No new emails** (owner rule, 2026-10-28) holds for now; alerts are in-app. Email arrives "at the very late portion of the development" (owner, 2026-11-03).
- WDL-406 is cancelled or rewritten as this project (owner's choice).

## Goals

1. A per-player, per-category rating that rises with wins and falls with losses.
2. Asynchronous matchmaking: searches can wait days.
3. A match ends as an ordinary RallyPoint session the players can attend, pay for and check in to.
4. Results are honest enough to trust without a referee.

## Non-goals (first version)

- Other activities than pickleball (the engines are activity-agnostic; only pickleball is switched on).
- Searching alone for doubles (being paired with a stranger partner).
- Email or phone (Web Push) notifications.
- DUPR or any external rating link.
- Leaderboards, rankings lists, "top player" displays.
- Game scores; only the match winner is recorded.
- Referees, leagues, tournaments.
- A map service or stored exact locations.

## Anti-goals (a failure even if it works)

- Someone pays for a court before everyone has said yes.
- A player can win by lying, by not checking an opponent in, or by farming a friend.
- One person ends up in two matches at once.
- "No-show" appears on anyone's public profile.
- Anyone, owner included, can see or work out a hidden number.
- The rank and the self-rating blur into one number.

## Decisions made with the owner

### Scope

- **Pickleball, Singapore only** to start.
- **Two categories: Pickleball Singles and Pickleball Doubles**, each with its own rating. A category is (activity, format); each activity lists its formats, so later activities add their own (e.g. badminton Mixed Doubles). Ratings never carry across categories.
- **Doubles: you search with a partner you choose** (owner chose option A). The engine finds one other team.
- **Picking a partner** (owner, 2026-11-03): choose from people you've already played with, or send an invite link. The partner must accept before the search starts, and it counts as their one search too. Nobody can be looked up.

### Where and when

- **Areas**: Singapore's URA planning areas (55, grouped in the five regions), shown by everyday name where it differs, e.g. "CBD (Downtown Core)". A search picks **1 to 3 areas**; a match needs a shared area.
- **Courts (optional)**: a shared court list, each court belonging to one area. Anyone can add a court (name, area, optional Maps link). Occasional duplicates are tolerated in the pilot.
- **Times (optional)**: broad windows such as weekday evenings or weekend mornings. Empty means any time.
- **Widening**: after 3 days unmatched, the app _asks_ whether to widen to your whole region. It never widens the area on its own.

### Matching

- Start with your own rank only; after 1 day widen to one rank above and below.
- Longest-waiting search is matched first.
- A search lasts 7 days, then ends; restart with one tap.
- One search at a time per person (singles _or_ doubles).
- The search never pairs the same opponents again within 7 days.
- Proposal: the app proposes a shared area, a court (a shared preferred court if any, otherwise the longest-waiting player's first court) and a time window from the overlap.
- Everyone accepts within **48 hours**. A decline or expiry cancels the proposal with no penalty and returns the others to the front of the queue.

### Booking

- After everyone accepts, **any player can tap "I'll book the court"**. The first tap wins, atomically; everyone else then sees "<name> is booking the court" instead of the button, to avoid double booking.
- The booker has **48 hours** to enter the exact court and time, or tap "I can't book" to hand it back; on hand-back or expiry the button returns for everyone.
- On entry, RallyPoint creates a **private session** for exactly those 2 or 4 players, with the booker as organizer, using **Pay the organizer** with an equal split of the court cost. Existing cutoff and fee rules (D-04) apply; a ranked session's cutoff defaults to 24 hours before start.
- **Withdrawal before the cutoff** (owner, 2026-11-03): the ranked match is cancelled with no penalty, but the session stays as a normal unranked session. The booker can keep it, invite a replacement or cancel it. The leaver owes nothing (D-04's before-cutoff rule), and the other players go back to the front of the queue.

### Results

- After the match, **either side reports the winner** (best of 3, games to 11, win by 2; only the winner is recorded).
- The other side **confirms or disputes within 48 hours**; silence confirms.
- A **dispute voids the match**: no rating change for anyone.
- **Self check-in** (owner, 2026-11-03): each player checks themselves in from the match page, from 30 minutes before start to 30 minutes after. This replaces organizer check-in for ranked sessions.
- **No-show = loss** (owner). A player who didn't check in loses and can't dispute their absence. If nobody checks in, the match is void. Withdrawing after the session's cutoff counts as a no-show. The opponents get a normal win.
- **Doubles no-show: both partners lose** (owner).
- Because check-in is self-service, the booker can't win by not checking someone in. Disputes are only about who won a match that was played.
- Publicly a no-show is just a loss; "no-show" is never shown.

### Rating and medals

Amended 2026-11-03 (owner: "we have to establish our rating system as early as now"; Dota 2's ranking as inspiration only, "don't follow the exact ranking system"). Two hidden numbers per player per category; people only ever see a medal and its stars.

- **Skill** (hidden, for matchmaking): Glicko-2. A win raises it and a loss lowers it; beating a stronger opponent gains more. Doubles use each side's average; both partners move. New or long-inactive players move faster until the engine is confident. The self-rating may at most influence who an uncalibrated player meets first; it never sets the skill.
- **Standing** (hidden, the thing you climb): after calibration it moves about 25 per match, a little more toward your skill when your medal is behind or ahead of it, and never below 0. It never drops while you're away. It is never shown, not even to its owner, and the interface never names it.
- **Calibration**: the first 5 confirmed matches in a category. The owner sees "Calibrating · 3 of 5"; others see nothing. After the fifth, the standing starts from the skill, capped at the top of Challenger, so a lucky streak can't place anyone high.
- **Medals** (owner-chosen names): **Rookie, Contender, Challenger, Veteran, Elite**, each with **5 stars**, then **Master** with no stars. Owner chose stars over pips: "it is a skill-based rating anyway".
- **Public** (owner, 2026-11-03): the medal and stars show on the profile and beside the name on rosters, e.g. "Veteran ★★★ · Doubles". No number anywhere, and the word "MMR" is not used.

### Alerts

- **In-app only** for now: a Home alert with the action (accept, book, confirm) and a count on the menu button for anything waiting on you, updating live while the app is open.
- The search screen says matches appear when you open the app and to check back daily.
- Expiries never penalise anyone.

## The work, as separate tasks (to be drafted in Linear after approval)

1. **Areas and courts**: planning-area catalog with everyday names; shared court list.
2. **Rating engine** (large): categories per (activity, format); hidden skill (win/loss updates, doubles averaging, confidence for new/inactive players); hidden standing with calibration; medals and stars. Buildable and testable with synthetic results before matching exists.
3. **Ranked search**: start, cancel, 7-day expiry; format, areas, courts, times; doubles partner invite and acceptance.
4. **Matchmaking engine** (large): scheduled pairing on the existing per-minute scheduler with bounded work per run; rank widening; longest-wait priority; 7-day repeat block; never double-matching under concurrent runs; proposals; accept/decline/expiry and requeue.
5. **In-app alerts**: Home alert and menu count.
6. **Booking and the match session**: the "I'll book" claim, hand-back, private session creation with split fee, self check-in window, falling back to a casual session on withdrawal.
7. **Results**: report, confirm, dispute, no-show/forfeit handling, sending confirmed results to the rating engine.
8. **Later (parked)**: email, Web Push, searching alone for doubles, DUPR link.

Order: 1 → 2 → 3 → 4 → (5 and 6 in parallel) → 7.

## Constraints

- $0 new monthly spending (D-08); no paid map, places or rating service.
- Pilot scale (D-08): up to 100 accounts. Every scheduled job, queue and alert has explicit bounds.
- Authorization at the trusted boundary: searches, proposals, claims and results are only readable and writable by the players in them.
- Synthetic data only in development; persistent schema changes need migrations with a recovery note.
- D-13: ask only what the player must decide; no internal terms (rating numbers, queue mechanics) in the interface.

## Calls made after the builder check (open to owner correction)

- **Confirmed results are final.** Nothing voids a result once confirmed (the 48-hour window is the only way out), so ratings update incrementally and the rating engine needs no history replay. Task 2's "recalculation when a confirmed result is later voided" is dropped.
- **Nothing hangs forever.** A match that isn't booked within 4 days of everyone accepting is cancelled with no penalty and the players return to the front of the queue. A match nobody reports within 48 hours after its session ends is void. While a player is in a pending match they can't start another search.
- **Uncalibrated players.** Everyone gets a hidden starting skill; matching always uses the hidden skill, so calibrating and calibrated players can meet. For an uncalibrated player's first search only, the self-rating picks the starting skill band (Beginner low, Intermediate or none middle, Advanced high). It never changes the skill itself.
- **Doubles teams search at their average** hidden rating, and widening is measured from it.

## Left to the builder

- The exact skill method. **Builder's call: Glicko-2.** The standing scale, step sizes and how the standing leans toward the skill are the builder's, recorded in the PRD.
- Data model, scheduling cadence within the existing cron, and how replay after a voided result is stored.
- Exact wording and screen layout, following D-15/D-17 and shadcn components (D-24/D-25).
- How the planning-area list is sourced and stored (URA names are public).
