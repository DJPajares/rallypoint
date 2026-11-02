# @rallypoint/ui

RallyPoint's design tokens and shared components. The aim is modern, pretty and
simple, with one place to change each decision.

## Where things live

| Path                      | Holds                                                                     |
| ------------------------- | ------------------------------------------------------------------------- |
| `src/styles/globals.css`  | The theme in shadcn's format: every colour, type, radius, shadow and size |
| `src/tokens.ts`           | The few token values JavaScript needs (browser theme colour)              |
| `src/components/ui/*.tsx` | shadcn/ui components, restyled to RallyPoint                              |
| `src/components/*.tsx`    | RallyPoint components built on them                                       |
| `src/lib/utils.ts`        | `cn()`, which joins and merges Tailwind classes                           |
| `components.json`         | shadcn CLI settings for this package                                      |

The app imports `@rallypoint/ui/globals.css` from its own `app/globals.css`, and
the components from `@rallypoint/ui`.

## Tokens

`src/styles/globals.css` follows shadcn's
[theming docs](https://ui.shadcn.com/docs/theming): light values in `:root`,
dark values in `.dark`, and `@theme inline` turning each into a utility.
Tailwind's own colour palette is removed, so only these colours exist.

### Colour roles

- shadcn's names come first: `background`/`foreground`, `card`, `popover`,
  `primary`, `secondary`, `muted`, `accent`, `destructive`, `border`, `input`
  and `ring`. A surface pairs with its `-foreground` colour for the text on it.
- `primary`: orange. Use it for the one primary action on a screen, with
  `primary-foreground` text; `primary-hover` is its hover fill.
- `chrome`: graphite on light and orange on dark. Use it for active and
  selected marks, with `chrome-foreground` on it.
- `stub`: the graphite ticket stub and other blocks that stay graphite in both
  themes.
- `link`, `scrim`, `qr-backdrop` and `brand` cover links, overlays, QR quiet
  zones and the logo.
- Status tones: `success`, `warning`, `neutral` and `danger` are soft surfaces;
  each `-foreground` is the ink on them (`bg-warning text-warning-foreground`).
  Always show the status in words and an icon too, never by colour alone.
- Scales: `rounded-*` (RallyPoint's pinned steps; `--radius` equals `rounded-lg`), `text-*`, `shadow-*`, named
  sizes (`size-touch`, `h-control`…), `container-*` widths and `--layer-*`.

## Components

| Component                                            | Use                                                                                             |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `Button`, `buttonClass()`                            | Actions. Use `buttonClass()` on links that look like buttons                                    |
| `IconButton`, `iconButtonClass()`                    | Round icon-only chips                                                                           |
| `Card`, `cardClass()`, `Badge`, `IconTile`, `Avatar` | Surfaces and labels                                                                             |
| `Kicker`, `Lede`, `Help`                             | Text roles around titles and fields                                                             |
| `Pending`, `Notice`, `StatusBanner`, `EmptyState`    | Feedback                                                                                        |
| `Ticket`, `TicketTime`, `TicketMeta`, `SpotsMeter`   | Session pieces                                                                                  |
| `Field`, `Divider`                                   | Labels, help text and section breaks for forms                                                  |
| `DateTimeField`                                      | Date and time picker. A calendar plus 15-minute slots in a popover, or a bottom sheet on phones |
| `SelectField`                                        | A short list of fixed choices, such as currencies                                               |
| `NumberStepper`                                      | A whole number with − and + buttons                                                             |
| `AffixInput`                                         | A text input with a fixed prefix, such as a currency code                                       |
| `SwitchField`, `CheckField`                          | An on/off setting, and a checkbox row                                                           |
| `Sheet`                                              | A modal bottom sheet (native `<dialog>`)                                                        |

Run the app in development and open `/design` to see every token and component
in both themes. Production builds return 404 for that page.

## Form controls

The form controls are built on [Base UI](https://base-ui.com) (unstyled,
accessible popover, select, number field, switch and checkbox) and
[react-day-picker](https://daypicker.dev) for the calendar grid. Both are styled
only with theme utilities, so they follow the theme. Date values
stay `"YYYY-MM-DDTHH:mm"` wall-clock strings, the same format a
`datetime-local` input produces.

## Rules

- No raw colours, font sizes, radii or shadows outside `src/styles/globals.css`
  and `src/tokens.ts`. `tests/design-tokens.test.mjs` enforces this.
- Need a new value? Add it to the theme in `src/styles/globals.css` (a colour in
  `:root`, `.dark` and `@theme inline`) rather than writing a literal.
- Need a new shared piece? Add a component here, from shadcn
  (`pnpm exec shadcn add <name>`) where one exists. Keep page layout in the app.
