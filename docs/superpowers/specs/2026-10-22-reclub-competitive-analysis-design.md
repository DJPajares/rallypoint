# Learning from Reclub: design direction, badges and titles (D-15, D-16)

Date: 2026-10-22. Baseline: `ba5ba14`. No tracker task: this is a direct owner request in chat.

**Decision status.** The owner chose the visual direction and the Medallion badge style from a mockup (“the designs are really nice… this is what I want for our app design direction”). The owner asked for badges and titles covering “participation, skills, people met, and all other earnings that will make that user come back”, then said “fill in the rest and start building”. So the direction and the four badge families are the owner's. Every rule marked **Builder's call** was filled in by Claude and is open to the owner's correction. Merge, deployment and live setup keep their own authorization.

## Why

Reclub ([reclub.co](https://reclub.co/)) is the app that Philippine pickleball groups already use: 4.9★ from about 17k ratings on the Philippine App Store. RallyPoint should keep what makes people use it, avoid what frustrates them, and add a reason to come back that stays quiet. In the owner's words: “everything is quiet and focused on the thing at hand, make gatherings happen”, and “social media is all about the bragging rights”.

## What the research found

Evidence comes from Reclub's site, help center and FAQ, live session pages, App Store reviews (US, Philippines, Malaysia), one independent UX audit and one press profile. Sources are listed at the end. Researched on 2026-10-22; the findings can go stale.

### Why people use Reclub

- **The players are already there.** A discovery feed lets players find games nearby and while travelling, and beginners say it's how they found easy games. Reclub reports 35+ countries and 59 sports.
- **It's free and runs a whole club.** Recurring meets are created and announced automatically, and there are RSVPs with an automatic waitlist, +1s, several hosts, check-in and a "mark paid" toggle.
- **Game-day tools are its strongest pickleball feature.** It generates round robins (singles, rotating partners, set teams, ladder), assigns courts by skill, keeps live scores and standings, submits results to DUPR in bulk, and runs brackets.
- **There's a social layer.** Kudos after a meet feed a "Street Cred" community leaderboard, alongside match history and stats.

### Where Reclub is weak

| Weakness | Evidence |
| --- | --- |
| You need the app to join | A shared meet page has no join button, only "Open app". Hosts add "reserves" for people without the 235 MB app. A web version is "on the roadmap" with no date. |
| Payment rules live in free text | Hosts paste personal GCash names and numbers into public, search-indexed descriptions. They invent rules such as "first to upload receipt in the chat = first confirmed" and "all requests waitlisted until payment". Payment details are announced by renaming the meet ("NEW PAYMENT DETAILS"). |
| Payment tracking is paywalled | Receipt upload and host payment details require the paid Supporter tier. |
| Fee shown wrong | Their server-rendered page shows a PHP fee as `$200.00` (checked in the page source). A meet header can show one fee while the description states another. |
| Confusing waitlist | "Request to join" plus manual approval. The UX audit flags the "Requested" label as unclear. |
| Unreliable | Reviews report chats not loading, no push notifications for two months, Facebook sign-in loops, an unexplained account ban and slow support. |
| Smaller gaps | Recurrence is weekly only (users ask for every two weeks), calendar add is basic, and there are banner ads and cross-app tracking. |

### Where RallyPoint already does better

Join from the link with no install. A strict waitlist that promotes automatically. Payment instructions and QR visible only to booked participants. The fee stated once, in the right currency. Free manual paid tracking. Email plus a page that always shows your real status.

## What we take, improve or leave

| Reclub strength or gap | RallyPoint move | When |
| --- | --- | --- |
| Kudos and Street Cred bring people back | Badges and titles, quiet in the app and shareable outside it (this document) | Now (B1), then B2 and B3 |
| Polished, friendly app | "Quiet, not boring" design direction (D-15) | New screens now; existing screens in their own increment |
| Recurring meets that create and announce themselves | Already RP-04. **Builder's call:** extend the D-02 recommendation to "every N weeks" because Reclub users ask for it | With the series work |
| Round robins, court rotation, team randomizer | Phase 2 game-day tools; the strongest reason pickleball clubs stay on Reclub | After the first-loop pilot |
| Reserves for people without the app | Mostly unnecessary because the link works without an install. An organizer-added named seat for walk-ins is a later proposal | Later |
| DUPR submission | Phase 3; check the partnership terms first | Later |
| Discovery feed, in-app chat | Still excluded. RallyPoint works alongside the group chat | No |
| Hosts demanding "pay first to lock your slot" | **Open decision for the owner:** RP-11 says payment never grants a spot, and AGENTS.md forbids choosing payment holds silently | Decide before any change |

## Design direction: "Quiet, not boring" (D-15, accepted)

The approved mockup is [2026-10-22-quiet-not-boring-mockup.html](2026-10-22-quiet-not-boring-mockup.html). It builds on D-12 (navy and neon, Bricolage Grotesque and Inter, ticket card, seat dots, tab bar). It sharpens the finish without replacing D-12.

- **One job per screen.** Large confident titles, generous space, simple grouped lists with hairline separators.
- **Color has to mean something.** One neon primary action per screen. Color otherwise belongs to status (always with an icon and words) and to badges. Chrome stays navy and neutral.
- **Depth is subtle.** Soft card shadows, a frosted see-through tab bar, and sheets that rise from the bottom on phones.
- **Celebrate briefly.** A badge gets one bright moment, then it gets out of the way.
- **Badges are Medallions:** round, a soft two-stop gradient, a thin inner ring, a glint of light and one simple white glyph (navy on the neon badge).
- **The discipline is Apple-like, not a copy.** RallyPoint keeps its own fonts, colors and shapes.
- **Anti-goals:** ads, red counters, nag banners, leaderboards, streak-loss guilt, rules buried in long text.

## Badges and titles (D-16)

### The four families

The owner named them. Increment B1 builds three; skills follow in B3.

| Family | What it says about you |
| --- | --- |
| Playing | You keep showing up |
| People | You've met and brought people |
| Hosting | You make sessions happen |
| Skills | People you played with vouch for something you do well (B3) |

### B1 catalog

**Builder's call** on names, thresholds and glyphs. Every rule reads data RallyPoint already records.

| ID | Name | Earned when | Medallion |
| --- | --- | --- | --- |
| `first-rally` | First Rally | You're checked in at your first session | blue · ball and arc |
| `regular:<group>` | Regular | You're checked in at 5 sessions of the same group (once per group) | indigo · calendar check |
| `sessions-10` | Ten | Checked in at 10 sessions | teal · "10" |
| `sessions-25` | Twenty-Five | 25 sessions | violet · "25" |
| `sessions-50` | Fifty | 50 sessions | navy · "50" |
| `sessions-100` | Century | 100 sessions | gold · "100" |
| `off-the-bench` | Off the Bench | You moved up from the waitlist and were checked in | neon · up arrow |
| `plus-one` | Plus One | A guest you brought was checked in | pink · two people |
| `new-faces-10` | New Faces | You've been checked in alongside 10 different people | coral · three faces |
| `new-faces-25` | Mixer | 25 different people | rose · three faces |
| `new-faces-50` | Connector | 50 different people | magenta · three faces |
| `host` | Host | You checked people in at a session (you ran it) | orange · flag |
| `hosted-10` | Seasoned Host | You ran check-in at 10 sessions | ember · flag |
| `full-house` | Full House | You ran a session where every seat was taken | neon · seat grid |
| `founder:<group>` | Founder | You own a group (once per group) | gold · sprout |

Definitions:

- **Checked in** means seat 1 (you, not your guest) of a confirmed party is `checked_in` in a session that wasn't cancelled. Several parties in one session count once.
- **People met** counts other accounts whose own seat 1 was checked in at a session where yours was. Guests have no account and don't count. Only the number is used; nobody sees whom you met.
- **Ran a session** means you recorded at least one `checked_in` change at it (only organizers and co-hosts can). Organizers who never use check-in won't earn hosting badges. **Builder's call:** this rewards the check-in habit that makes every other count trustworthy.
- **Full House** means confirmed seats are at least the session's capacity. Withdrawal closes at start, so the count is final once the session begins.
- **Earned at** is the time of the record that crossed the threshold, such as the 5th check-in or the 10th new person.

### Rules that never bend

These come from the PRD (RP-11, RP-14, RP-15 and AGENTS.md):

- Badges never come from payments, fees, waitlist position, no-shows or any reliability score. No badge says or implies "never misses".
- Badges are **derived, not stored**. Correcting a mistaken check-in removes a badge that depended on it. A badge never outlives its evidence.
- There's no ranking of people against each other: no leaderboards, no "top 10", no streaks you can lose.
- Badges never trigger push notifications, emails or banners.

### Where badges appear (B1)

- **The earned moment.** On Home and on a session page, a signed-in person with a badge they haven't seen gets one sheet. It shows the large medallion with a soft glow, the badge name, one plain sentence, **Show as my title** and **Done**. With several new badges it shows the newest and says "+N more on your profile". Dismissing marks them all seen, so the moment never repeats. Reduced motion turns off the glow animation.
- **Home.** One quiet progress row toward your closest badge, for example "Regular · 1 more session at Sunday Dink", with a progress ring. It's hidden when nothing is in progress.
- **Profile (`/profile`, yours only).** Your initials, name and chosen title, then three numbers in one row (played, hosted, groups) and the badge shelf. Locked badges in the B1 catalog appear as faint dashed outlines with their names. You open it from the floating menu ("Profile") and from the Home progress row.
- **Titles.** You choose one earned badge as your title, or none. It shows as a small pill next to your name on session rosters, which is where people who share the session already see your name. Group badges read "Regular · Sunday Dink". If the badge disappears, so does the title. **Builder's call:** choosing a title that names a group is your consent to show that group name on other groups' rosters.

### Visibility

**Builder's call, pending D-06's profile decision.** In B1 only you can see your profile and shelf. Others see only the title you chose, and only where they can already see your display name (the confirmed participants and managers of a session). Viewing another person's profile waits for D-06.

### Cost and bounds

Badges are computed on read for one person from indexed tables. Roster titles are computed per roster entry, so the cost is bounded by session capacity. That's fine for pilot sizes. Store a summary only if a measured roster read becomes slow.

## Later increments

- **B2 · Share cards ("loud outside").** One tap on an earned badge makes an image with the medallion, badge name, your first name, group name and a small RallyPoint mark. It's sized for an Instagram story or Messenger, shared through the device share sheet, with a download as fallback. RallyPoint never posts anything itself. There's no feed.
- **B3 · Skills (owner to confirm the voucher).** **Builder's recommendation:** after a session ends, each checked-in player can quietly give a "nod" to up to three other checked-in players for one skill from a short fixed list (for example Great Serve, Sharp at the Net, Great Sport, Patient Coach). A skill badge needs nods from 5 different people for the same skill. You see the count but not who nodded. Nods only come from people who actually played with you, nobody is prompted by notification, and an organizer can turn nods off for their group. This copies what works in Reclub's kudos while avoiding its nagging and its leaderboard.
- **Design refresh.** Apply D-15 to the existing screens (Home "Up next", groups, sessions, session page, forms) in its own reviewable increment.

## Open decisions for the owner

1. **Pay first to lock your slot.** It conflicts with RP-11, and AGENTS.md forbids choosing payment holds silently.
2. **Who vouches for skills (B3).** The recommendation is above.
3. **Profile visibility to others.** Part of D-06.

## Calls Claude made (owner: please check)

- The B1 catalog: names, thresholds, glyphs and colors.
- Hosting is credited by running check-in, not by creating the session.
- Badges are derived on read, so corrections can remove them. Only "seen" markers and the chosen title are stored.
- In B1 your profile is visible only to you, and the title shows on rosters.
- Every-N-weeks recurrence is added to the D-02 recommendation.
- Share cards and skills come after B1, to keep this increment reviewable.

## Sources

[reclub.co](https://reclub.co/) · [Pickleball FAQ](https://pickleball.reclub.co/faq) · [For organizers](https://pickleball.reclub.co/for-organizers) · [Payments help](https://help.reclub.co/hc/reclub-help/articles/1765846532-how-do-i-manage-payment-methods-and-receipts) · [Payment articles](https://help.reclub.co/hc/reclub-help/en/categories/payment) · [PH App Store reviews](https://apps.apple.com/ph/app/reclub-social-sports-nearby/id1323924315?see-all=reviews&platform=iphone) · [US App Store reviews](https://apps.apple.com/us/app/reclub-social-sports-nearby/id1323924315?see-all=reviews&platform=iphone) · [MY App Store](https://apps.apple.com/my/app/reclub-social-sports-nearby/id1323924315) · [Session with payment-first rules](https://reclub.co/m/1INCY1) · [Session with GCash flow](https://reclub.co/m/BLE640) · [UX audit](https://limzhiyang.medium.com/ux-audit-1-reclub-9c4597ccb27e) · [Tech Show Asia profile](https://techshowasia.substack.com/p/this-app-helps-you-find-and-organize) · Other local tools seen: [PickleHQ](https://picklehq.ph/), [DinkHub](https://dinkhub.ph/), [Pickleballer](https://pickleballer.ph/)
