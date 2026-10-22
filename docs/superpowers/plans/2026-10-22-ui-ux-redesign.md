# RallyPoint UI/UX redesign — implementation plan

**Spec:** `docs/superpowers/specs/2026-10-22-ui-ux-redesign-design.md`

## Implementation

Chat-only work (no Linear task). Work on the current worktree branch
`claude/ui-ux-design-brainstorm-cb1629`; check the branch before each commit.
No push/PR until the owner asks. All work is in `apps/web` unless noted.

1. **Docs.** Save the spec and plan files named above. Add a short D-12 row to
   the decisions table in `PRD.md`: the UI frame and visual direction, plus
   Sessions/Dues/Updates as empty states only.
2. **Tokens, fonts, theme.**
   - Rewrite `src/index.css` with the light/dark tokens.
   - Load Bricolage Grotesque and Inter via `next/font/google` in
     `app/layout.tsx`, exposed as CSS variables.
   - Add an inline pre-paint theme script in `layout.tsx` that sets
     `data-theme` from `localStorage` `rallypoint.theme`, with try/catch.
   - `viewport`: `themeColor` per color scheme, and
     `viewportFit: "cover"` for safe areas.
   - Update `public/manifest.webmanifest` (colors, `start_url: "/home"`).
   - Update `scripts/icons.mjs` to navy/neon and regenerate the icons.
3. **App frame.** Replace the sidebar in `src/shell.tsx` with:
   - `TopBar`: one component, compact under 1200px via CSS.
   - `BottomBar`: under 768px, with the raised + button.
   - `FloatingMenu`: port Trove's behaviour from
     `floating-action-stack.tsx` using CSS transitions instead of motion/react.
     Keep the Escape, outside-tap, route-change and focus rules, and the
     hide-on-scroll behaviour.
   - `CreatePicker` sheet: groups filtered by role from `/api/workspace`.
   - Keep `PageFocus`, the skip link and the sign-out logic.
   - Put tab destinations in `src/navigation.ts`.
   - Pages opt into detail chrome through a `<DetailPage back=… action=…>`
     wrapper instead of matching paths. The wrapper hides the bottom bar on
     phone and renders the back chip and sticky action bar.
4. **Primitives** (`src/ui.tsx` or `src/components/`):
   - `Sheet`: native `<dialog>`, focus trap and restore, bottom-anchored on
     phone.
   - `TicketCard`, `SpotsMeter` (with a text equivalent), `StatusBanner`,
     `EmptyState`.
   - Keep `Pending` and `Notice`.
5. **New routes.**
   - `app/home/page.tsx`: greeting, New session prompt, up to 3 groups.
   - `app/sessions/page.tsx`: empty state. Must not conflict with
     `app/sessions/[id]/edit`.
   - `app/dues/page.tsx`: empty state.
   - All wrapped in `RequireAuth`.
   - `/` sends signed-in users to `/home` (client-side `router.replace`).
6. **Restyle screens** in `src/screens.tsx`, `src/session-pages.tsx` and
   `src/registration-panel.tsx`:
   - Landing: keep the asserted copy.
   - Sign-in.
   - Workspace: groups grid.
   - Group detail and session list: ticket cards.
   - New group, new session and session editor: form column with sticky Save
     bar.
   - Shared session page:
     - Ticket header, spots meter and status banner.
     - On desktop, a sticky panel holding the full `RegistrationPanel` form.
     - On phone, a sticky bar that opens a `Sheet` with the same form.
     - The form markup lives in one place and is rendered once per breakpoint
       context, not duplicated in the DOM. A duplicate would break label and id
       uniqueness.
   - 404 page: keep "Back to home".
   - Move CSS out of the 1,042-line `src/App.css` into per-area files, deleting
     the sidebar/topbar/footer rules.
7. **Tests.** Extend `tests/pages.test.mjs` so that `/home`, `/sessions` and
   `/dues` render 200 HTML. Keep every existing assertion.

**Reuse:** `useAuth` (`src/auth-context.ts`), `useApi` (`src/use-api.ts`),
`useMutation` (`src/use-mutation.tsx`), `RequireAuth` and `Notice`/`Pending`.
The `GroupSummary.role` field (`packages/domain/src/contracts.ts`) filters the
create picker. Use Phosphor icons, which are already a dependency.

## Verification

- `pnpm check` (lint, typecheck, build).
- `pnpm db:start`, `pnpm dev`, then `pnpm test:api` (all API, page and
  navigation tests).
- Browser pane at 375×812, 768×1024 and 1280×800, in light and dark:
  - Bar, FAB and top-bar variants.
  - FAB open/close by mouse, keyboard and Escape, including focus return.
  - Create picker for `organizer@rallypoint.test` (shows groups) and
    `newcomer@rallypoint.test` (only "Start a group").
  - Join with a guest, then withdraw on `/s/[slug]` as `member@` via the
    phone sheet and the desktop panel. Fee, cutoff and timezone text must be
    visible before confirming.
  - Empty states for Sessions, Dues and Updates.
  - 404 page.
  - No horizontal scroll.
  - Safe-area padding.
  - Reduced-motion emulation.
  - Contrast spot-checks on neon/navy pairs.
- User-facing note for the completion record: "RallyPoint now looks and moves
  like a phone app, with a bottom tab bar, a floating menu, dark mode, and
  dedicated tablet and desktop layouts."
