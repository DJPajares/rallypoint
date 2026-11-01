# shadcn/ui + Tailwind CSS v4 (D-24)

**Owner decision, 2026-11-01:** rewrite the UI on shadcn/ui and Tailwind CSS "for a more structured future", keep the RallyPoint look, and deliver it as one PR.

## Stack

- **Tailwind CSS 4.3.3** through `@tailwindcss/postcss` in `apps/web`.
- **shadcn/ui 4.21.0, `base-nova` style.** Its components are built on Base UI, which the app already uses (`@base-ui/react` 1.8.0, unchanged).
- **Supporting packages:** `class-variance-authority`, `clsx`, `tailwind-merge` and `tw-animate-css`.
- **Monorepo layout as shadcn documents it:**
  - `packages/ui` holds the components as source;
  - `components.json` sits in `packages/ui` and in `apps/web`;
  - `cn()` lives in `packages/ui/src/lib/utils.ts`.
- **Installation:** the sandbox can't reach `ui.shadcn.com`, so the shadcn CLI can't fetch components. They're copied from the shadcn repository at tag `shadcn@4.21.0` (`apps/v4/registry/bases/base/ui`), and the `cn-*` style classes are expanded from `registry/styles/style-nova.css`, the same transform the CLI applies. Icons use Phosphor, as in the rest of the app.

## Theme: the tokens are the Tailwind theme

- **`packages/ui/src/theme.css` is the single source.** It holds an `@theme` block with the palette, semantic colours (each one `light-dark()`), type scale, radius, shadows, motion and sizing.
- **Default colours removed.** `--color-*: initial` removes Tailwind's palette, so `bg-red-500` or `text-white` don't exist and only RallyPoint tokens can be used. This replaces the old "no literal colours" lint with the compiler itself. The design-token test still guards against hex or rgb values and arbitrary `[…]` colour and size values in class strings.
- **shadcn's names alias our tokens:**

  | shadcn name          | Our token                |
  | -------------------- | ------------------------ |
  | `background`         | `bg`                     |
  | `foreground`         | `text`                   |
  | `card`, `popover`    | `surface`                |
  | `primary`            | `action` (orange)        |
  | `primary-foreground` | `on-action`              |
  | `secondary`, `muted` | `surface-sunken`         |
  | `muted-foreground`   | `text-muted`             |
  | `accent`             | `surface-sunken` (hover) |
  | `destructive`        | `danger`                 |
  | `input`              | `border-strong`          |
  | `ring`               | `focus`                  |

- **"accent" renamed.** The old `--color-accent` (graphite chrome) becomes `chrome` / `on-chrome`.
- **Spacing:** Tailwind's default 4 px scale matches `--space-*` one to one.
- **Breakpoints:** `md` is 768 px (the phone/tablet edge already used). A `desk` breakpoint at 1200 px covers the old desktop rules.
- **Dark mode:** follows the system, and `data-theme` on `<html>` overrides it. The `dark:` variant matches both cases.

## Components (`@rallypoint/ui`)

The exports keep their names and props where they already exist, so screens change their styling, not their behaviour:

- **Button and links:** `Button` and `buttonVariants` come from shadcn. `buttonClass` is kept as a thin wrapper so links look like buttons.
- **Form controls:** `Field`, `CheckField`, `SwitchField`, `SelectField`, `NumberStepper`, `DateTimeField` and `AffixInput` are rebuilt on shadcn's Field, Input, Checkbox, Switch, Select and Popover.
- **Sheet:** keeps its API, but becomes shadcn's **Drawer** (bottom, swipe to close, scroll lock) on phones and shadcn's **Dialog** elsewhere. This replaces the hand-built swipe from #67.
- **Feedback:** `Notice`, `StatusBanner`, `EmptyState` and `Pending` move to shadcn's Alert, Empty and Spinner. The toast becomes shadcn's Base UI toast with our tone.
- **Rebuilt with Tailwind, no shadcn equivalent:** `ListGroup`/`ListRow`, `Pill`, `Segmented`, `StatRow`, `ChoiceTiles`, `Ticket`, `SpotsMeter`, `Avatar` and `ActivityIcon` (RallyPoint-specific).

## Screens

Every `className` in `apps/web` becomes Tailwind utilities, and the old CSS files are deleted.

What remains as CSS is a small base layer in `theme.css`:

- element defaults: body, headings, links, focus ring and reduced motion;
- a few things utilities can't express cleanly: the medallion gradients, the avatar ring, the tab bar notch and the safe-area bars.

## Unchanged

- URLs, behaviour, copy, data and API.
- Accessibility rules (D-13 interface boundaries, 44 px targets, status shown by words and icons, focus return, reduced motion).
- D-15 "Quiet, not boring" and D-21 (one orange action).
