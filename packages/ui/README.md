# @rallypoint/ui

RallyPoint's design tokens and shared components. The aim is modern, pretty and
simple, with one place to change each decision.

## Where things live

| File                   | Holds                                                            |
| ---------------------- | ---------------------------------------------------------------- |
| `src/tokens.css`       | Every colour, space, type, radius, shadow, motion and size value |
| `src/tokens.ts`        | The few token values JavaScript needs (browser theme colour)     |
| `src/base.css`         | Element defaults (body, headings, form controls, focus)          |
| `src/components.css`   | The `rp-` component classes                                      |
| `src/components/*.tsx` | React components that render those classes                       |
| `src/fields.css`       | Styles for the form controls and their popovers                  |

The app imports `@rallypoint/ui/styles.css` once in its root layout and the
components from `@rallypoint/ui`.

## Tokens

Three layers, used top to bottom:

1. **Palette** (`--palette-*`, `--brand-*`): raw colours. Only `tokens.css`
   names them.
2. **Semantic colours** (`--color-*`): what a colour is for. Each is defined
   once with its light and dark value through `light-dark()`, so the themes
   can't drift apart. The theme switch sets `color-scheme` on `<html>`.
3. **Scales**:
   - `--space-*` on a 4px rhythm
   - `--text-*`
   - `--radius-*`
   - `--shadow-*`
   - `--duration-*`
   - `--size-*`
   - `--layout-*`
   - `--layer-*`

### Colour roles

- `--color-action`: neon. Use it for the one primary action on a screen, with
  `--color-on-action` text.
- `--color-accent`: navy on light and neon on dark. Use it for active and
  selected marks.
- `--color-stub`: the navy ticket stub and other blocks that stay navy in both
  themes.
- Status tones: `success`, `warning`, `neutral` and `danger`. Each has a `-bg`
  pair. Always show the status in words and an icon too, never by colour alone.

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
| `ComboboxField`                                      | Type-to-filter choice from a long list, such as timezones (`timezoneOptions()`)                 |
| `SelectField`                                        | A short list of fixed choices, such as currencies                                               |
| `NumberStepper`                                      | A whole number with − and + buttons                                                             |
| `AffixInput`                                         | A text input with a fixed prefix, such as a currency code                                       |
| `SwitchField`, `CheckField`                          | An on/off setting, and a checkbox row                                                           |
| `Sheet`                                              | A modal bottom sheet (native `<dialog>`)                                                        |

Run the app in development and open `/design` to see every token and component
in both themes. Production builds return 404 for that page.

## Form controls

The form controls are built on [Base UI](https://base-ui.com) (unstyled,
accessible popover, select, combobox, number field, switch and checkbox) and
[react-day-picker](https://daypicker.dev) for the calendar grid. Both are styled
only through `fields.css` and the tokens, so they follow the theme. Date values
stay `"YYYY-MM-DDTHH:mm"` wall-clock strings, the same format a
`datetime-local` input produces.

## Rules

- No raw colours, font sizes, radii or shadows outside `tokens.css`/`tokens.ts`.
  `tests/design-tokens.test.mjs` enforces this.
- Need a new value? Add it to a scale in `tokens.css` rather than writing a
  literal.
- Need a new shared piece? Add the class to `components.css` and a component
  here. Keep page layout in the app.
