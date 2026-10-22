# Quiet everywhere else: redesign proposal (applies D-15)

Date: 2026-10-23. Builds on: D-12 (navigation frame), D-13 (interface boundaries), D-15 ("Quiet, not boring"), D-16 (badges). Mockup: [2026-10-23-quiet-redesign-mockup.html](2026-10-23-quiet-redesign-mockup.html).

**Status: proposal.** The owner asked how to bring "quiet, not boring" to the rest of the app and skipped the questions ("skip"). Everything below is the builder's recommendation until the owner accepts it. Nothing here is built yet.

## Why

The badge screens follow D-15. The rest of the app still reads like the earlier pass. These are the most frequent screens, and an organizer on game day feels them most. Reclub's strongest pickleball feature is game-day tooling, and RallyPoint's badges now depend on organizers recording check-ins. So the check-in moment has to be the fastest, calmest screen in the app.

## What the current screens show

From a walkthrough on 2026-10-23 with the synthetic organizer and member, at phone width:

| Screen | What breaks the direction |
| --- | --- |
| Session page, organizer view | Every person carries 3–4 buttons (Mark paid, Waive fee, Clear) plus an audit line. The neon sticky button says **Join**, even while the organizer is managing. The check-in count is small text. |
| Home | No "what's next". A large "Plan the next one" card with a neon button competes with the neon **+** tab. Group cards are tall, with a role chip and an "Open group" button each. |
| Sessions tab | Placeholder ("will gather here in a later release"). |
| Group page | A tall ticket card per session, each with a "Manage session" button. "Live" is an internal word. Upcoming, past and cancelled are mixed together. |
| New session | One long form that asks for start, end, opening and cutoff separately. Activity tiles take a full screen. Currency defaults to SGD, and **PHP isn't supported**. |
| Dues | Underlined neon titles, and the currency shows two ways (`$24.00` beside `SGD 12.50`). |
| Landing and sign-in | Already close to the direction. Sign-in logs an earlier hydration warning. |

## Proposed changes

These follow the D-15 rules: one job and one neon action per screen; color only for status and badges; status always shown with an icon and words; large titles and grouped lists; brief, reduced-motion-safe motion.

### 1. Game day: the organizer session page

- **Header:** the session time as the large title, with the group and "Today" as an eyebrow line and the venue below.
- **Stats strip:** three numbers that count real records: *here* (checked-in seats out of capacity), *to pay* (unpaid obligations), *waiting* (waitlisted parties).
- **Filters:** a segmented control for **Everyone · Not here · To pay**.
- **One row per party:**
  - Initials avatar, name and title pill.
  - Payment shown as one quiet line ("Paid", or an amber "₱400 to pay").
  - One round check button for the primary seat. A two-seat party's guest is handled in the person sheet.
  - The check is a real button with `aria-pressed` and an accessible name such as "Mark Alex here".
- **Person sheet** (tap the row): check in each seat, mark paid or unpaid, waive or undo a waiver, and the history ("Checked in by Mika · 7:02"). The per-row audit lines and buttons go away.
- **Organizer actions:** for managers the sticky bar is **Share link** (neon) and **Edit**. "Join" becomes a quiet row in the details, because an organizer isn't automatically an attendee (PRD concepts).
- **After the end:** the same list offers "Mark no-show" in the person sheet only, matching the current rules.
- **Unchanged:** registration-view data and attendance/payment RPCs (`record_attendance`, payment actions with revisions and recovery). This is a presentation change.

### 2. Home: "Up next"

- **Up next:** the next session you host or hold a place in, shown as the ticket. It carries status pills ("Hosting", "You're in", "Waitlist #2") and, for hosts, a "3 to pay" pill.
- **Rest of the week:** the next few sessions as list rows, with a "Your week" link to the Sessions tab.
- **Badge nudge:** the next-badge row stays.
- **Remove the "Plan the next one" card.** Creating lives on the **+** only, so there's one neon action. A person with nothing upcoming sees a quiet line, plus "Start a group" if they have no groups.

### 3. Sessions tab: "Your week"

- **Upcoming | Past** segmented control. Rows are grouped by day: group tile, title, time and venue, one status pill.
- **Covers:** sessions where you hold a confirmed or waitlisted place, and sessions in groups you own or co-host. **Builder's call:** members don't see every session of their groups here, only ones they joined, which avoids a discovery feed.
- **Needs one read-only endpoint:** `GET /api/me/sessions?when=upcoming|past`, bounded to 50 rows, backed by an `api.list_my_sessions(actor, when)` RPC. It returns only fields each person is already entitled to (D-06), and Home "Up next" reuses it.

### 4. New session: ask only what you must decide

- **Grouped sections**, like phone settings:
  - *Title and activity*: activity as horizontal chips, not tiles.
  - *Date, time, place*.
  - *Seats and fee*: a seat stepper, and a fee row showing the currency symbol.
  - *Rules*: one summary row ("Opens now · free cancel until 24h before · +1 allowed") that opens a sheet to change any of them.
- **Defaults (builder's call):**
  - The end time defaults to two hours after the start.
  - Registration opens when the session is published.
  - The cancellation cutoff is 24 hours before the start, or at publication when that's sooner.
  - Guests stay off unless turned on.
  - Currency comes from the phone's region the first time, then from the group's last session.

  D-13 still holds: the time zone is never asked or shown.
- **Buttons:** **Publish** (neon) and **Save draft** (quiet text). The existing validation, draft safety and duplicate-publication protection stay as they are.

### 5. Groups list and group page

- **Groups list:** a grouped list with a gradient initials tile, name, "You organize · next Sun 7 AM", and a chevron. "Start a group" is a quiet row at the end.
- **Group page:**
  - The group name as the large title.
  - An **Upcoming · Past · Drafts** segmented control.
  - One row per session: a mini date, title, time and venue, and seats ("10/12", "Full") with waiting shown under the time. Cancelled sessions are dimmed and labelled "Cancelled". The whole row opens the session.
  - **New session** in the sticky bar (D-12 detail page).

### 6. Participant session page and Dues

- **Session page:** the same header as game day. The status banner is the hero once you hold a place. Details become a grouped list (Fee, Free cancellation until, Guests), and "How to pay" is one row that opens a sheet. The roster becomes list rows with initials and title pills. Join, withdraw and consent stay exactly as they are (D-12 sheet with terms).
- **Dues:** one total up top ("₱450 to pay across 2 sessions"), rows with the amount right-aligned in tabular figures, and settled items folded under "Settled". Titles aren't underlined, and each amount is shown once in its own currency.

### Shared building blocks (`packages/ui`)

- **List group and row:** inset group with hairline separators, leading slot, title and subtitle, trailing slot, chevron. At least 44px tall, and the whole row is the target.
- **Segmented control:** radio-group semantics with arrow-key navigation.
- **Status pill:** in, waitlist, hosting, to pay, paid, cancelled. Each has an icon and words, with tones from existing tokens.
- **Large-title header:** eyebrow, title and meta.
- **`RingAvatar`:** moves from `apps/web/src/badges.tsx` into the UI kit.
- **Rule:** cards remain for grouped content. Repeated items become rows, not cards.

### Fixes along the way

- **Peso support:**
  - Add `PHP` (two decimal places) to the domain currency map and to the currency checks in `fee_obligations` and the split tables. That's one migration, additive, with no data rewritten.
  - Default the currency from the device region (PH → PHP, SG → SGD, and so on), falling back to the current default.
  - Other Southeast Asian currencies wait until a group needs them.
- **Refreshing:** refetch reads when the app comes back into view. Drop the stand-alone "Refresh" links, but keep **Check result** and **Retry same request** for interrupted writes. The PRD requires that recovery.

## Constraints

- **Keep these exactly:** every URL; auth guards; the registration, queue, fee, payment, attendance and recovery behavior and its consent copy; D-12 navigation; and D-13 copy rules.
- **No new dependencies.** Tokens only, which `tests/design-tokens.test.mjs` enforces.
- **Accessibility:** 44px targets, visible focus, reduced motion, and status never shown by color alone. Check buttons and segmented controls must be usable by keyboard and screen reader.
- **Out of scope:** discovery, chat, payment processing and new roles. Sessions lists only what the viewer may already read.

## Build order (recommended)

| # | Increment | Why this order |
| --- | --- | --- |
| R1 | UI building blocks plus PHP currency | Everything else is assembled from them, and PHP blocks real pilot groups |
| R2 | Game day: organizer session page and person sheet | The noisiest screen, the most used on the day, and what makes badges trustworthy |
| R3 | Your week: `GET /api/me/sessions`, Sessions tab and Home "Up next" | Replaces two placeholders with the most useful information |
| R4 | New session form with defaults and the Rules sheet | Setup in under a minute (PRD success measure) |
| R5 | Groups list and group page | Mostly presentation |
| R6 | Participant session page and Dues polish | Lowest risk, done last |

Each increment ships with its own tests and browser checks, like B1. R1 and R2 could go together as one PR.

## Open for the owner

1. Accept this direction and the order (or reorder).
2. Sessions tab scope: only sessions you joined or host (recommended), or every session of your groups.
3. Currencies: PHP now and others on request (recommended), or a wider Southeast Asian set now.
