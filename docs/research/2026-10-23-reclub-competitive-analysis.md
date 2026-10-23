# Reclub competitive analysis: what to adopt, improve and leave

Date: 2026-10-23. Baseline: `0ac42f7`. No tracker task: this is a direct owner request in chat ("do a deep research of the app https://reclub.co/ … adopt what works … improve them especially the weaker areas"). The owner skipped the brainstorming questions, so **every recommendation here is Claude's proposal, not an accepted decision**. Accepted decisions keep their authority in [PRD.md](../../PRD.md).

**Update, 2026-10-23:** the owner walked through DQ-1 to DQ-5 and accepted them, with changes, as [D-18 and D-19](../../PRD.md). Each decision below now ends with its outcome. The owner also set that RallyPoint is designed for international use: recommendations name no country-specific payment service. Reclub evidence still mentions the services its hosts use.

This expands the research summary in the [D-15/D-16 record](../superpowers/specs/2026-10-22-reclub-competitive-analysis-design.md). That record stays the authority for the design direction and for badges and titles; this document does not reopen them.

## Summary

Reclub is the app Philippine pickleball groups already use for open play. People stay for three things: **the players are already there**, **it's a free toolkit for a whole club**, and **its game-day tools** (round robins, court assignment, DUPR). Its weak spots are exactly where RallyPoint is built to be strong. You need the app to join. Payment rules live in free text, often next to the host's personal GCash number. The waitlist mixes "full" with "waiting for the host". And chat, push notifications and sign-in are unreliable.

RallyPoint shouldn't try to beat Reclub on its network or its social features. The opening is narrower and stronger: **an organizer's own sessions, run from the group chat they already have.** Someone joins from a Messenger link without downloading anything, sees one clear price in their currency, keeps the organizer's payment details private, gets moved up the waitlist automatically, and can always trust the status on the page.

Recommendations, in order:

1. **Finish the share loop.** Rich link previews, a copy-as-text roster and a QR code (RP-16), then add-to-calendar (RP-12). Today the app can only copy or share the bare link.
2. **Build repeating sessions next** (RP-04, D-02 already includes "every N weeks"). Sessions that create and announce themselves are one of the main reasons clubs run on Reclub.
3. **Let each host choose how payment works** (DQ-1, decided as D-18). The pilot ships "Not tracked here" and "Pay the organizer", with a one-tap release of unpaid spots after the cutoff. "Pay in RallyPoint" with holds follows right after the pilot.
4. **Keep rules out of long descriptions.** The fee, cutoff, payment details and guest allowance are already structured fields (D-13). Keep the notes short and say so where organizers write them.
5. **Make open-play court rotation the first Phase 2 bet.** It's Reclub's strongest game-day feature and fits RallyPoint's "show up" step.
6. **Keep leaving out** the discovery feed, chat, leaderboards, ads and paid tiers for organizer tools.

## Method and confidence

- **Looked at (2026-10-22 and 23):** reclub.co and its platform pages; the pickleball site's organizer, player and FAQ pages; Reclub's help center (payment, waitlist, host and awareness articles); about ten public Philippine session pages (Metro Manila, Laguna, Batangas, Cebu, Samar, Cotabato), two of them read in full along with the data behind them; one session page's server-rendered HTML; App Store listings and reviews for the US, Philippines and Malaysia; one press profile; one independent UX audit (seen through a search excerpt, because the page returned 403); and the home pages of a few local booking tools.
- **Not done:** installing Reclub and running a session in it; Reddit and Facebook groups (Reddit couldn't be reached and the search index had no threads); Google Play reviews beyond search excerpts.
- **How to read it:** "Observed" means I saw it on a page or in page data. "Reclub says" means vendor marketing or help text. Severity ratings are my judgment. The findings can go stale: Reclub shipped version 2.49 the week of this research.
- **Privacy:** public Reclub pages show hosts' personal payment names and numbers. This document links some of those pages as evidence but doesn't copy any personal details.

## Reclub at a glance

| | |
| --- | --- |
| Company | Reclub PBC, a US public benefit corporation. Founded 2018 by Tony Ho and Luis Aloma, with engineering in Ho Chi Minh City and backing from 500 Global (press profile; funding not independently verified) |
| Scale | 4.9★ from about 17k ratings in the Philippine App Store, 4.8★ from about 4.6k in Malaysia and 4.8★ from 809 in the US (observed). Google Play shows about 4.7★ from about 25k reviews (search excerpt). Reclub says it's used in 35+ countries across 59 sports; it added Mahjong in 2.49 |
| Platforms | iOS and Android only (235 MB on iOS). Shared web pages are read-only with an "Open app" button. Reclub says a web version is on the roadmap, with no date |
| Business model | Free core app with a top banner ad. "Reclub Supporter" costs US$2.99 a month or $29.99 a year and removes the ad. It also unlocks stats, full Street Cred, match history and payment receipts. The App Store privacy label lists identifiers and usage data used to track people across other companies' apps |
| Structure | Communities (cities or "Greater" areas) → clubs → meets, plus competitions (leagues and tournaments) |

**What a meet holds** (observed in page data): capacity; whether +1s are allowed; auto-approval; fee type, amount and currency; a cancellation threshold (12 hours in one example); a minimum or maximum skill level; age group and gender limits; whether players can score; hidden teams; and whether people still waiting can see the chat. Participants can be marked host, coach, referee or "payment collector". Each payment is "digital" or "cash", and attendance is recorded as checked in.

## Why people use Reclub

| Strength | What it is | Evidence | RallyPoint today |
| --- | --- | --- | --- |
| The players are already there | Discover games by city, sport, day, time and distance, with a map within 10 km; switch cities when travelling | Reviews: a beginner found easy games nearby, a traveller found people to play with, someone who moved home "met so many amazing people" | Excluded by design (no discovery feed). Organizers bring their own players |
| A free toolkit for a whole club | Clubs with members and a club code; weekly meets that create and invite themselves; RSVPs with an automatic waitlist; +1s and reserves; several hosts; check-in; "mark paid"; calendar sync; "Get more players" (once per meet to the club, and community-wide within 36 hours of the start) | Reclub's FAQ and organizer page; reviews: "I know ahead of time how many players there will be" | Groups, sessions, waitlist, +1, co-hosts, check-in and paid tracking are in the codebase (local, not deployed). Series, calendar export and reminders are not built yet |
| Game-day tools | Round robins (singles, rotating partners, set teams, ladder), sort by skill, court assignment, scoring by host, referee or permitted players, live standings, bulk DUPR submission, brackets with pools and seeding | Organizer page, FAQ and host help articles | Game-day check-in view exists (D-17 R2). Court rotation and team randomizer are Phase 2 |
| A social loop | Kudos after a meet feed a daily "Street Cred" leaderboard; match history; partner and opponent stats; stickers | Reviews ask to see who gave them kudos, so people care | D-16 badges and titles (built, B1). Skill "nods" are planned for B3. No leaderboards, on purpose |
| People behind it | Fast feature releases; developer replies to reviews | Reviews credit the team for growing pickleball in Cambodia; others report slow support | Not comparable yet |

## Where Reclub falls short

| Weakness | Evidence | Who feels it | Severity |
| --- | --- | --- | --- |
| You need the app to join | Shared pages have no join button, only "Open app". Hosts add "reserves" for people without the app. Web version is "on the roadmap" | New players invited from a group chat; organizers who chase them | High |
| Payment rules live in free text | Observed rules: "first to upload receipt in the chat = first confirmed"; everyone stays waitlisted until payment is confirmed; unpaid players are removed for the waitlist; no refunds within 12 hours; late payments count toward a future session. Hosts post personal GCash names and numbers in public, search-indexed descriptions, and announce changes by renaming the meet "NEW PAYMENT DETAILS" | Every paying player; organizers who check receipts by hand | High |
| Payment tools cost extra | Players need Supporter to upload a receipt, and host payment details and receipts are part of Supporter (help center) | Organizers and players in paid sessions | Medium |
| Wrong currency | A PHP ₱200 session renders as `$200.00` in the page HTML (observed). Another session's header shows one fee while its description states another | Players deciding whether to join | Medium |
| The waitlist means several things | Help center: you can be waitlisted while spots are still open, because the host wants payment or a rating check first. Joining is "Request to join" with optional manual approval. The UX audit flags the "Requested" label as unclear | Players who can't tell whether they have a spot | High |
| Unreliable | Reviews: event chats that don't load, no push notifications "in the last 2 months", Facebook sign-in loops, freezing, invite links that need several refreshes, profile changes that take up to 24 hours, an account banned without explanation, slow support | Everyone, but worst for organizers who rely on notifications | High |
| Smaller gaps | Repeating meets are weekly only (users ask for every two weeks); calendar sync adds to the default calendar only; no match schedule generator; no waivers; city areas lumped together ("Greater KL"); the Supporter badge can't be hidden | Recurring organizers; competitive leagues | Low to medium |
| Rules buried in long text | Session descriptions repeat the cutoff, payment steps, skill expectations, footwear and liability notes, even where a field exists | Players reading on a phone | Medium |

## What organizers build around Reclub

Workarounds are the strongest evidence of what organizers need. Each one points to a job the app doesn't do.

| Workaround seen | The job behind it | RallyPoint today | Proposal |
| --- | --- | --- | --- |
| "First to upload receipt = first confirmed"; "waitlisted until paid" | Make sure the people who play are the people who pay | Payment never grants a spot (RP-11). Confirmation creates the fee; it's kept after the cutoff unless waived (D-04) | Decide DQ-1 |
| "Unpaid players will be removed" | Free the spot of someone who hasn't paid | Organizers can't remove a registration yet: the database has a `removed` state that nothing uses | Part of DQ-1 |
| Personal GCash number in the public description | Tell booked players where to pay | Payment details and the QR are shown only to booked players (RP-10, built in WDL-383) | Lead with it: "Your payment details stay private" |
| Renaming the meet "NEW PAYMENT DETAILS" | Change where to pay after people booked | Payment details can be edited after booking (WDL-383) but nobody is told | DQ-5 |
| "Slots are transferable to waitlisted players" | Hand a spot on when you can't come | Withdraw and the next party is promoted automatically (RP-08) | Say it where people withdraw: "The next person on the waitlist gets your spot." Handing a spot to a chosen friend stays unsupported because the queue is strict (D-03) |
| "Late payments can be used for a future session" | Credit instead of refund | Not supported; refunds and credits happen outside RallyPoint (D-04) | Leave |
| Reserves for people without the app | Count someone who won't install anything | Anyone with the link can view, and joining needs a Google sign-in, not an app | DQ-3 for walk-ins with no account |
| Payment collector role; digital or cash marker | Several people collect money, some in cash | Organizers and co-hosts mark paid; method isn't recorded | Small proposal: an optional "cash" or "transfer" note on the paid marker, if pilot organizers ask |
| Meet chat to coordinate | Talk to the group | RallyPoint works alongside Messenger and Viber; announcements are one-way (RP-13, not built) | Leave chat out; build the text roster so the group chat stays the place to talk |

## Head to head

"Built" means in the codebase and tested locally. Nothing is deployed, and live email isn't set up.

| Job | Reclub | RallyPoint built | RallyPoint planned |
| --- | --- | --- | --- |
| Create a session | In-app form with many settings; rules often typed into notes | Short form with no timezone or visibility questions; fees in the session's currency | R4 form with more defaults (D-17) |
| Share | App link; web page is read-only | Copy or share the link | Rich preview, text roster, QR (RP-16) |
| Join | Install, sign in (Facebook among options), request to join | Open link, Google sign-in, one tap | — |
| Waitlist | Can mean full, unpaid or awaiting approval; manual or auto | Strict order, parties stay together, automatic promotion, honest position (D-03) | — |
| Fee | One amount; currency can display wrong | Free, fixed or split; minor-unit exact; per-session currency | — |
| Payment | Host details in profile; receipts for Supporters only; checked by hand | Private instructions and QR; organizer marks paid; fee kept after the cutoff | DQ-1, DQ-2 |
| Changes after booking | Edit freely; tell people in chat | Locked after booking for now | D-14 rules (P-16): change email and free withdrawal |
| Cancel a session | Cancel, recover via support | Cancel keeps registrations and paid history (WDL-384) | — |
| Check-in | Mark checked in | Quiet game-day view, one-tap check-in, no-shows (D-17 R2) | — |
| Repeat | Weekly meets that create and invite themselves | Not built | Series (RP-04, D-02) |
| Game day | Round robins, courts, scores, DUPR, brackets | Check-in only | Phase 2: court rotation, team randomizer |
| Notifications | Push, reported as unreliable | Page always shows real status | Email and 24-hour reminder (D-05; live setup gated) |
| Calendar | Adds to the default calendar | Not built | Calendar file (RP-12) |
| Coming back | Kudos, Street Cred, stats behind a paywall | Badges and titles (D-16 B1) | Share cards (B2), skill nods (B3) |
| Finding players | Discover feed and map | None, on purpose | Phase 3 at the earliest |
| Cost and privacy | Ads, tracking, subscription | No ads; free-tier hosting goal | — |

## Recommendations

### 1. Lead with what's already better

No new scope. These are the lines to use with pilot organizers and to check in the pilot:

- **No app to download.** Join from the link in your group chat.
- **Your payment details stay private.** Only people with a spot see where to pay.
- **The waitlist fills itself.** Someone withdraws and the next person is in, with nobody approving anything.
- **One price, in your currency, said once.** The fee and cutoff appear where you join and withdraw.
- **The page tells the truth.** Your status is always on the page, even if an email is late.

Pilot check: send a session link into a real group chat. Count taps from the link to a confirmed spot for someone who has never used RallyPoint, and compare that with the group's current Reclub path. This is the PRD's "Clear, quick participation" measure.

### 2. Build next: the MVP parts that answer Reclub directly

These are already in the MVP but not built yet. The order is my recommendation.

1. **RP-16 sharing.** A rich link preview showing the session name, day and time, spots left and fee (no roster, no payment details). Add a copy-as-text roster for the group chat, and a QR code for the court. Reclub's link pushes people toward an app install; RallyPoint's link should do the whole job.
2. **RP-04 series.** Weekly on chosen days, every 1 to N weeks, with an end date and a preview (D-02). Without it, organizers rebuild the same session each week, which is the habit Reclub removes.
3. **RP-12 email and calendar.** The confirmation, promotion and 24-hour reminder emails (D-05), plus a calendar file. Reclub reviewers both complain about missing pushes and ask for calendar adds.
4. **P-16 post-booking edits (D-14).** Reclub hosts edit freely and announce in chat. RallyPoint already decided a fairer rule; building it removes the current "locked after booking" limit.

### 3. Decisions for the owner

Each of these changes an accepted rule or adds scope, so none should be built without an answer.

**DQ-1 · Pay first to lock your slot.** This is the most common rule Philippine organizers improvise. AGENTS.md forbids choosing payment holds silently.

| Option | How it works | Trade-off |
| --- | --- | --- |
| A. Keep RP-11 as is | Payment never affects the spot; the fee stays after the cutoff | Simplest and already built, but it doesn't solve organizers' unpaid-player problem |
| **B. Pay-by time and release (recommended)** | The organizer can set an optional pay-by time. After it, confirmed spots still marked unpaid are listed for the organizer, who can release any of them with one tap and a confirmation. Releasing cancels that registration, removes its unpaid fee, tells the person, and promotes the waitlist the normal way. Nothing happens automatically | Keeps payment separate from queue order, with no race and no limbo. Gives organizers the control they now improvise. Risk: someone who paid but wasn't marked yet gets released, so release only from Unpaid, and tell the person |
| C. Confirm only after payment | A spot stays pending until the organizer marks paid (Reclub style) | Recreates "waitlisted even though not full". Conflicts with automatic promotion and immediate confirmation (D-03), and people can't tell whether they're in |
| D. First to pay wins | Whoever's payment is marked first gets the spot | Favors whoever pays fastest, forces refunds for people who paid but lost, and asks RallyPoint to judge payments it can't verify |

**Outcome (D-18):** the owner widened the question. Each host picks how payment works for a session:

| Mode | Spot depends on payment? | Who records paid | When |
| --- | --- | --- | --- |
| Not tracked here (never labelled "Free") | No | Nobody; the group settles any cost its own way | Pilot |
| Pay the organizer | Only through option B, tied to the cutoff | The organizer, by hand | Pilot |
| Pay in RallyPoint | Yes: confirmed when the payment succeeds | The payment provider | Right after the pilot |

Pay in RallyPoint keeps the waitlist with holds: 15 minutes during checkout, and 2 hours for the next waiting party when a spot opens (30 minutes within the last 2 hours, never past start). The provider is international, chosen at build time and checked for each launch country. Automatic refunds for payments that land after a hold ends, refunds on withdrawal, provider fees and organizer payouts are still open for that increment.

**DQ-2 · "I've sent payment" from the player.** A player taps "I've sent it" and can add a short reference number. Organizers see it as a separate hint next to their own Paid marker. It's never proof and never changes the spot. Reclub's paywalled receipts show the demand for this. **Recommended:** yes, after DQ-1, text only. RP-10 rules out receipt uploads for the MVP, and images add storage and privacy work.

**Outcome (D-18):** accepted as recommended for "Pay the organizer" sessions. The player can undo it until marked paid, only they and the organizers see it, and releasing someone who sent a note asks once more.

**DQ-3 · Organizer-added walk-in spot.** A named spot with no account that counts against capacity, can be checked in, owes the fee, and gets no emails. It conflicts with RP-05 (reserving needs a verified sign-in). **Recommended:** wait for pilot evidence. Joining from the link removes most of Reclub's reason for reserves.

**Outcome (D-19):** accepted as recommended.

**DQ-4 · Join approval and skill limits.** **Recommended:** no for the MVP. Approval breaks strict queue order and automatic promotion, and it causes the "waitlisted but not full" confusion seen in Reclub. Private sessions with organizer-granted access (RP-16) already cover closed groups.

**Outcome (D-19):** accepted as recommended.

**DQ-5 · Tell booked players when payment details change.** One short email to confirmed and waiting primaries when the organizer edits the payment details after booking. It doesn't include the details themselves, only a link back to the session. **Recommended:** yes. It replaces the "NEW PAYMENT DETAILS" rename hack. It needs a yes because it adds a message type to D-05's delivery budget.

**Outcome (D-18):** accepted as recommended.

### 4. First Phase 2 bet: open-play court rotation

Round robins and court assignment are why pickleball clubs stay on Reclub. RallyPoint's game-day view already knows who's checked in. The suggested first slice (needs a separate scope decision):

- The organizer enters the number of courts.
- Checked-in players are queued, and the app suggests the next four for each free court, with rotating partners. This replaces the paddle-stack or whiteboard queue.
- No scores, ratings or DUPR in the first slice. Sorting by skill uses only a skill the person chose to set on their profile (RP-15), never an inferred one (AGENTS.md).
- Pilot question first: how do the pilot groups rotate courts today, and would they hand that to a phone?

### 5. Leave out, and why

| Reclub feature | Why RallyPoint leaves it |
| --- | --- |
| Discovery feed and map | Excluded in the PRD (Phase 3 at the earliest). It's Reclub's moat and would need moderation, privacy and safety work |
| In-app chat | Excluded. It's also Reclub's most complained-about part; RallyPoint feeds the group chat instead |
| Street Cred leaderboards | D-16 rules out ranking people. Badges and skill nods cover recognition |
| DUPR submission | Not in any planned phase. It would need DUPR's partnership terms and a scope decision first |
| Ads, cross-app tracking, paid tiers for organizer tools | Conflict with the organizer-first, low-cost principles |
| Competitions, brackets, waivers | Outside the MVP; revisit only with pilot demand |
| Skill and age/gender gates | Not planned. Optional self-declared skill stays on the profile |

## Risks to watch

- **Network pull.** Players already have Reclub profiles and DUPR links. An organizer may switch only if the join step is noticeably easier and payment chasing drops. Measure both in the pilot.
- **Google-only sign-in.** Reclub offers Facebook sign-in, and Facebook is heavily used in the Philippines. Check how many pilot players hesitate at a Google sign-in. Don't add providers without a decision (D-10).
- **Reclub is moving fast.** Web access and in-app payments are on its roadmap. If both ship, RallyPoint's lasting edges are private payment details, a waitlist you can trust, honest status and less organizer effort, not "no app".
- **Free text creeps back.** Organizers used to Reclub will paste their rules into notes. Keep the notes field short and point to the fields that already exist.

## Questions for the pilot

1. How often do organizers use the release of unpaid spots, and do players use "I've sent it"? (Tests D-18.)
2. How many players don't have, or won't use, a Google account?
3. How many taps and minutes does it take from a group-chat link to a confirmed spot, compared with the group's current tool?
4. How are courts rotated today, and would organizers use a rotation helper?
5. Do organizers collect cash at the court, and do they need to record it separately?

## Sources

Reclub: [reclub.co](https://reclub.co/) · [Meets](https://reclub.co/platform/meets) · [Competitions](https://reclub.co/platform/competitions) · [Pickleball FAQ](https://pickleball.reclub.co/faq) · [For organizers](https://pickleball.reclub.co/for-organizers) · [For players](https://pickleball.reclub.co/for-players) · [DUPR partnership](https://pickleball.reclub.co/news/official-partnership-announcement-dupr-and-reclub-join-forces)

Help center: [Index](https://help.reclub.co/hc/reclub-help/en) · [How payments work](https://help.reclub.co/hc/reclub-help/articles/1765845748-how-do-payments-work-in-recub) · [Payment methods and receipts](https://help.reclub.co/hc/reclub-help/articles/1765846532-how-do-i-manage-payment-methods-and-receipts) · [Payment articles](https://help.reclub.co/hc/reclub-help/en/categories/payment) · [Paying to confirm a spot](https://help.reclub.co/hc/reclub-help/articles/1765846764-i-requested-to-join-a-meet-competition-how-to-make-the-payment-to-confirm) · [Waitlisted in meet](https://help.reclub.co/hc/reclub-help/articles/1765846690-waitlisted-in-meet) · [Awareness articles](https://help.reclub.co/hc/reclub-help/en/categories/awareness)

Session pages sampled: [Pasig, payment-first rules](https://reclub.co/m/1INCY1) · [Quezon City, GCash flow](https://reclub.co/m/BLE640) · [Laguna](https://reclub.co/m/RTCW19) · [Laguna](https://reclub.co/m/ABVV60) · [Batangas](https://reclub.co/m/2W6OEX) · [Samar](https://reclub.co/m/S2O0NS) · [Automated Open Play club](https://reclub.co/clubs/@automated-open-play)

Stores and reviews: [PH App Store reviews](https://apps.apple.com/ph/app/reclub-social-sports-nearby/id1323924315?see-all=reviews&platform=iphone) · [US App Store reviews](https://apps.apple.com/us/app/reclub-social-sports-nearby/id1323924315?see-all=reviews&platform=iphone) · [MY App Store](https://apps.apple.com/my/app/reclub-social-sports-nearby/id1323924315) · [Google Play](https://play.google.com/store/apps/details?id=co.reclub)

Commentary: [UX audit](https://limzhiyang.medium.com/ux-audit-1-reclub-9c4597ccb27e) · [Tech Show Asia profile](https://techshowasia.substack.com/p/this-app-helps-you-find-and-organize)

Other local tools seen (mostly court booking, not open-play organizing): [PickleHQ](https://picklehq.ph/) · [DinkHub](https://dinkhub.ph/) · [Pickleballer](https://pickleballer.ph/) · [Pickle Time](https://www.pickletime.ph/) · [OpenCourt](https://opencourt.ph/)
