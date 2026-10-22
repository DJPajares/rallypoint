# RallyPoint UI/UX redesign — design

Status: accepted by the owner, 2026-10-22. Implementation plan: `docs/superpowers/plans/2026-10-22-ui-ux-redesign.md`.

## Context

The owner's verdict: every screen feels like a desktop website, not a mobile app.
Today `apps/web/src/shell.tsx` renders a 228px left sidebar plus a topbar and
footer on every page; under 760px the sidebar collapses into a cramped top strip
(`App.css` @media 760px). There is no bottom navigation, no app-style back/header,
no sticky action, no dark mode, and only two nav items (Home, Your groups).
PRD principle: "Deliver a polished, modern, fun mobile experience without
expanding the MVP." Goal: a native-feeling mobile frame with distinct tablet and
desktop layouts, a new visual direction, and the owner's Trove floating menu as
the cross-app identity.

## Design

### Decided by the owner

1. **Phone (< 768px):** bottom tab bar. No persistent top header.
2. **Tablet (768–1199px):** compact top bar. **Desktop (≥ 1200px):** full top bar.
3. **Floating menu button (FAB)** fixed top-right on every size, modelled on Trove
   (`~/dev/github/trove/apps/web/components/floating-action-stack.tsx`): burger
   unfolds a vertical column of round chips downward and turns into an X in the
   same spot. This is the shared identity with Trove. Search is not copied.
4. **Tabs from day one:** Home · Sessions · [+] · Groups · Dues. Sessions and
   Dues have no backing features yet → honest "coming soon" empty states.
5. **Brand colors:** navy blue + neon green.
6. Everything else in the visual direction below was proposed by Claude and
   accepted ("all looks great").

### Navigation frame

- **Phone bar:** 5-column grid; column 3 is a raised round **+** create button
  overhanging the bar (Trove's notch pattern is optional polish — builder's call).
  Active tab: neon indicator + icon weight change + `aria-current="page"`.
  Respects `env(safe-area-inset-bottom)`; content gets bottom padding so nothing
  hides under the bar.
- **Tablet bar:** wordmark left; tabs right as compact icon+label links; **+** as
  an icon-only round button; FAB in the right rail (bar reserves space for it).
- **Desktop bar:** wordmark left; text tabs with an underline active indicator;
  labelled "New session" pill; FAB in the right rail.
- **FAB contents (signed in), top to bottom:** Updates (empty "coming soon",
  same treatment as Dues), Appearance (light / dark / system), Account (name,
  email, Sign out). Each chip has a visible label beside it on open. **Signed
  out:** Appearance, Sign in.
  Behaviour (from Trove): Escape and outside-tap close it; focus returns to the
  trigger only when focus was inside; route change closes it; stagger-in
  animation disabled under reduced motion; on phone it hides on scroll-down and
  reappears on scroll-up or focus.
- **Detail pages on phone** (shared session `/s/[slug]`, session editor, new
  session, new group, group detail): the tab bar is replaced by a back button
  (top-left, round chip matching the FAB) and a **sticky bottom action bar**
  carrying the page's primary action (Join / Withdraw + Share / Save). Tablet and
  desktop keep the top bar on these pages.
- **Create (+):** opens a picker sheet (bottom sheet on phone, popover/dialog on
  larger sizes) listing groups where the user's role is owner/organizer/cohost →
  `/groups/[id]/sessions/new`, plus "Start a group" → `/groups/new`. Inside a group
  page the + goes straight to that group's new session. A user with no eligible
  groups sees only "Start a group".
- **Signed-out shell:** no tab bar; minimal top header (wordmark) + FAB
  (Appearance, Sign in). Shared session page still gets the sticky Join bar.

### Routes (all existing URLs preserved)

| Tab / page        | Route                                                 | Content                                                                                                                                |
| ----------------- | ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Home (signed out) | `/`                                                   | Landing; keep "Good company." / "Great sessions." copy (asserted by `tests/pages.test.mjs`)                                            |
| Home (signed in)  | `/home` **(new)**; `/` redirects there when signed in | Greeting, "New session" prompt, up to 3 of your groups with "See all" → Groups. Cross-group "your week" waits for the Sessions feature |
| Sessions          | `/sessions` **(new)**                                 | Empty state: your sessions across groups will live here; CTA to Groups                                                                 |
| Groups            | `/workspace`                                          | Existing group list, restyled                                                                                                          |
| Dues              | `/dues` **(new)**                                     | Empty state: what you owe and who's paid will live here. Must not imply payment tracking exists                                        |
| Updates           | in FAB                                                | Empty state in a sheet/popover                                                                                                         |

`/home`, `/sessions` and `/dues` require sign-in (reuse `RequireAuth`). Note: `/sessions/[id]/edit` already exists, so the new `/sessions` index must not shadow it.

### Visual direction

- **Palette (tokens on `:root`, dark under `[data-theme=dark]` and
  `prefers-color-scheme` when theme = system):**
  - Light: paper `#F5F7F2` bg, white cards, navy ink `#0E1A3D`, primary navy
    `#13235B`, muted `#5B6478`, line `#DFE3EA`, neon `#C6F432` (fill only, always
    with navy text — never neon text on light).
  - Dark: bg `#0A1024`, card `#121B36`, ink `#EEF1F8`, muted `#98A2B8`, line
    `#243052`, neon `#C8FF3D` (text and indicators allowed in dark).
  - Status: confirmed green, waitlist amber, closed/ineligible neutral, error red —
    each with an icon and words, never color alone.
  - Builder tunes exact hexes to WCAG AA (4.5:1 text, 3:1 UI); the roles above are
    the contract.
- **Neon = the one primary action per screen** (Join, Create, Save) — neon fill,
  navy text, pill shape. Secondary actions: outline pills. Navy carries chrome:
  ticket stubs, active states in light mode, brand mark.
- **Type:** Bricolage Grotesque (700) for headings/brand; Inter (400/500) for UI;
  `font-variant-numeric: tabular-nums` for spots, fees, times. Load via
  `next/font/google` (self-hosted at build; no runtime third-party requests).
- **Shape:** 16–18px card radius, pill buttons/chips, 44px minimum touch targets.
- **Signature components:**
  - _Ticket card_ — date stub (navy, day/date/month) with dashed perforation, time
    - timezone on the right. Used for session cards and the session page header.
  - _Spots meter_ — one dot per seat (filled = taken, dashed = open) when capacity
    ≤ 24; above that a segmented bar. Always paired with text ("10 of 12 taken ·
    2 left"); `role="img"` + label, or text-only for screen readers.
  - _Status banner_ — "You're in · you + 1 guest", "Waitlist #2", "Closed".
- **Brand mark:** "r." → navy tile, white "r", neon dot. Regenerate PWA icons
  (`scripts/icons.mjs`), update `manifest.webmanifest` (`theme_color` navy,
  `background_color` paper) and `viewport.themeColor` (per color scheme).
- **Theme:** light / dark / system, stored in `localStorage`
  (`rallypoint.theme`), applied as `data-theme` on `<html>` by a tiny inline
  script before paint (no flash); wrap storage access in try/catch.
- **Motion:** CSS transitions only (no new motion library): 150–200ms, standard
  ease; FAB stagger; tab indicator slide. All disabled under
  `prefers-reduced-motion`.

### Layout per size

- **Phone:** single column, 16px gutters, page title in large Bricolage; FAB
  reserves top-right space (titles get right padding).
- **Tablet:** two-column grids for lists (groups, sessions); session page stacks
  summary card above details.
- **Desktop:** max content width ~1200px; session page = details left + **sticky
  summary panel right** (ticket, fee, spots meter, Join). Forms = centered
  ~640px column.
- Forms (create/edit session, new group) stay as **routes** (URLs and deep-link
  tests preserved), presented as detail pages: sticky Save bar on phone.

### Preserve / non-goals / anti-goals

- **Preserve:** every URL; auth guards and return paths; registration, withdrawal,
  guest and waitlist behaviour and its copy for fee/cutoff/timezone; page-focus
  heading behaviour (`PageFocus` in `shell.tsx`); skip link; 404 "Back to home";
  existing tests passing.
- **Non-goals:** building cross-group session lists, dues/payment tracking,
  notifications, search, profiles, or offline writes. No new API endpoints.
- **Anti-goals:** empty tabs that pretend features exist; neon text on light
  backgrounds; status by color alone; a desktop layout that is just a stretched
  phone; motion that ignores reduced-motion; adding Tailwind/component-library
  churn.

### Calls Claude made after the builder check (owner: please check)

- **Join/Withdraw keep their consent step.** Today the Join button lives in a
  form with the guest option and an "By choosing Join, I agree to {fee}…" terms
  paragraph (`registration-panel.tsx`). On **phone**, the sticky bar button opens
  a bottom sheet containing that same form (guest option, terms, final button).
  This costs one extra tap but shows the fee before the participant acts. On
  **tablet/desktop**, the sticky right panel holds the full form inline, so
  there's no extra tap. Withdraw works the same way. All existing labels and
  their party-size wording are kept.
- **Signed-in Home gets its own route `/home`.** `/` stays the public landing
  (server-rendered copy kept for the test) and sends signed-in visitors to
  `/home` from the browser. The manifest `start_url` becomes `/home`, so opening
  the installed app never flashes the landing page. The Home tab points to
  `/home`.

### Left to the builder

Exact hex tuning for contrast, icon choices (keep Phosphor), notch vs plain
raised + button, CSS file organisation, whether the + picker is a `<dialog>` or
custom sheet (must trap focus and restore it), empty-state illustrations.
