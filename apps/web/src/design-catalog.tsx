"use client";
import { PanelSkeleton } from "./skeletons";
import { useState } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { ReceiptIcon } from "@phosphor-icons/react/dist/csr/Receipt";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import {
  AffixInput,
  Avatar,
  Badge,
  Button,
  cx,
  Card,
  CheckField,
  DateTimeField,
  Divider,
  EmptyState,
  Field,
  Help,
  IconButton,
  IconTile,
  Input,
  Kicker,
  Lede,
  Notice,
  NumberStepper,
  Pending,
  SelectField,
  Sheet,
  SpotsMeter,
  StatusBanner,
  SwitchField,
  Ticket,
  TicketMeta,
  TicketTime,
  Pill,
} from "@rallypoint/ui";
// shadcn's names first, then the roles RallyPoint adds.
const colors = [
  "background",
  "foreground",
  "card",
  "muted",
  "muted-foreground",
  "border",
  "input",
  "primary",
  "secondary",
  "secondary-foreground",
  "tertiary",
  "tertiary-foreground",
  "ring",
  "chrome",
  "stub",
  "link",
  "success",
  "success-foreground",
  "warning",
  "warning-foreground",
  "neutral",
  "neutral-foreground",
  "danger",
  "danger-foreground",
];
const space = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const type = ["xs", "sm", "base", "lg", "xl", "2xl"];
// Literal class names, so Tailwind sees and generates each one.
const radii = [
  ["xs", "rounded-xs"],
  ["sm", "rounded-sm"],
  ["md", "rounded-md"],
  ["lg", "rounded-lg"],
  ["xl", "rounded-xl"],
  ["full", "rounded-full"],
] as const;
/**
 * Every token and library component on one page, in both themes via the
 * floating menu's theme switch. Look here before adding a new style: if a
 * piece already exists, use it; if a value is missing, add it to
 * packages/ui/src/styles/globals.css.
 */
export function DesignCatalog() {
  const [sheet, setSheet] = useState(false);
  const [when, setWhen] = useState("2026-11-05T19:00");
  const [seats, setSeats] = useState("12");
  const [currency, setCurrency] = useState("SGD");
  const [guests, setGuests] = useState(true);
  const [guest, setGuest] = useState(false);
  return (
    <section className="[&_h2]:mt-10">
      <div className="mb-4">
        <Kicker>@rallypoint/ui</Kicker>
        <h1>Design system</h1>
        <Lede>
          Tokens and components. Change a value in globals.css and every screen
          follows.
        </Lede>
      </div>

      <h2>Colour</h2>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3">
        {colors.map((name) => (
          <div
            key={name}
            className="grid gap-2 text-xs [&_span]:h-16 [&_span]:rounded-md [&_span]:border [&_span]:border-border"
          >
            <span style={{ background: `var(--${name})` }} />
            <code>--{name}</code>
          </div>
        ))}
      </div>

      <h2>Type</h2>
      <Card className="grid gap-3">
        <span
          style={{ fontSize: "var(--text-display-lg)" }}
          className="font-heading leading-tight font-bold tracking-tight"
        >
          Display large
        </span>
        <span
          style={{ fontSize: "var(--text-display-md)" }}
          className="font-heading leading-tight font-bold tracking-tight"
        >
          Display medium
        </span>
        {type.map((name) => (
          <span key={name} style={{ fontSize: `var(--text-${name})` }}>
            --text-{name} · Thursday night doubles
          </span>
        ))}
      </Card>

      <h2>Space and radius</h2>
      <Card className="grid gap-3">
        {space.map((step) => (
          <div
            key={step}
            className="flex items-center gap-3 text-xs [&_code]:min-w-22.5"
          >
            <code>p-{step}</code>
            <span
              className="h-3 rounded-xs bg-chrome"
              style={{ width: `calc(var(--spacing) * ${step})` }}
            />
          </div>
        ))}
        <div className="mt-3 flex flex-wrap gap-4 text-center text-xs">
          {radii.map(([name, rounded]) => (
            <div key={name}>
              <span className={cx("mb-1 block h-12 w-16 bg-stub", rounded)} />
              <code>{name}</code>
            </div>
          ))}
        </div>
      </Card>

      <h2>Buttons</h2>
      <Card className="flex flex-wrap items-center gap-3">
        <Button variant="primary">Primary action</Button>
        <Button>Secondary</Button>
        <Button variant="accent">Accent</Button>
        <Button variant="link">Link button</Button>
        <Button variant="primary" size="sm">
          Small
        </Button>
        <Button disabled>Disabled</Button>
        <IconButton label="Open menu">
          <ListIcon size={22} />
        </IconButton>
      </Card>

      <h2>Surfaces</h2>
      <div className="grid gap-3 md:grid-cols-2 desk:grid-cols-3">
        <Card className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <IconTile>
              <UsersThreeIcon size={24} />
            </IconTile>
            <Badge>Organizer</Badge>
            <Avatar name="Mika" />
          </div>
          <h3>Card</h3>
          <Help>The default surface for grouped content.</Help>
        </Card>
        <Card tone="accent" className="grid gap-3">
          <h3>Accent card</h3>
          <p>For the one block a screen leads with.</p>
        </Card>
      </div>

      <h2>Status and feedback</h2>
      <div className="grid gap-3">
        <StatusBanner tone="success" icon={<CheckCircleIcon size={22} />}>
          <Badge inherit>Confirmed</Badge>
          <h2>You have two places.</h2>
          <p>Mika + one guest · 2 seats</p>
        </StatusBanner>
        <StatusBanner tone="warning" icon={<HourglassIcon size={22} />}>
          <h2>Waiting party 2</h2>
        </StatusBanner>
        <StatusBanner tone="neutral" icon={<LockSimpleIcon size={22} />}>
          <h2>Registration is closed.</h2>
        </StatusBanner>
        <StatusBanner tone="danger" icon={<WarningIcon size={22} />}>
          <h2>Session cancelled</h2>
        </StatusBanner>
        <p className="m-0 flex flex-wrap gap-2">
          <Pill tone="highlight">Happening now</Pill>
          <Pill tone="success">Confirmed</Pill>
          <Pill tone="warning">Waiting</Pill>
          <Pill tone="neutral">Closed</Pill>
          <Pill tone="danger">Cancelled</Pill>
        </p>
        <Notice retry={() => {}}>The session could not be loaded.</Notice>
        <Notice tone="warning">The result has not been confirmed.</Notice>
        <Pending>Checking your place…</Pending>
        <PanelSkeleton label="Checking your place…" />
      </div>

      <h2>Session pieces</h2>
      <div className="grid gap-3 md:grid-cols-2 desk:grid-cols-3">
        <Ticket
          date={{ weekday: "Thu", day: "5", month: "Nov", time: "7:00 PM" }}
        >
          <TicketTime>7:00 – 9:00 PM</TicketTime>
          <TicketMeta>Asia/Manila · session time</TicketMeta>
        </Ticket>
        <Card>
          <SpotsMeter capacity={12} taken={10} />
        </Card>
        <Card>
          <SpotsMeter capacity={40} taken={31} />
        </Card>
      </div>

      <h2>Forms</h2>
      <Card>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-0">
          <Field
            id="catalog-title"
            label="Session title"
            help="Shown on the shared page."
          >
            <Input
              id="catalog-title"
              placeholder="Sunday morning badminton"
              aria-describedby="catalog-title-help"
            />
          </Field>
          <Field id="catalog-when" label="Starts">
            <DateTimeField id="catalog-when" value={when} onChange={setWhen} />
          </Field>
        </div>
        <div className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-x-4 gap-y-0">
          <Field id="catalog-seats" label="Capacity, in seats">
            <NumberStepper
              id="catalog-seats"
              value={seats}
              onChange={setSeats}
              min={1}
            />
          </Field>
          <Field id="catalog-currency" label="Currency">
            <SelectField
              id="catalog-currency"
              value={currency}
              onChange={setCurrency}
              options={["SGD", "USD", "EUR"].map((code) => ({
                value: code,
                label: code,
              }))}
            />
          </Field>
          <Field id="catalog-fee" label="Fixed fee per seat">
            <AffixInput
              id="catalog-fee"
              prefix={currency}
              inputMode="decimal"
              defaultValue="12.00"
            />
          </Field>
        </div>
        <SwitchField
          checked={guests}
          onCheckedChange={setGuests}
          description="Two seats that join, wait and withdraw together."
        >
          Allow each participant to bring one guest
        </SwitchField>
        <CheckField checked={guest} onCheckedChange={setGuest}>
          Bring one guest (two seats together)
        </CheckField>
        <Divider>Or</Divider>
        <Button variant="secondary" onClick={() => setSheet(true)}>
          Open a sheet
        </Button>
      </Card>

      <h2>Empty state</h2>
      <Card>
        <EmptyState
          icon={<ReceiptIcon size={34} />}
          title="Dues are on the way"
          action={null}
        >
          An invitation, not an apology: say what will live here.
        </EmptyState>
      </Card>

      <Sheet open={sheet} onClose={() => setSheet(false)} title="A sheet">
        <p>Bottom-anchored on phones, a centred card elsewhere.</p>
        <Button variant="primary" wide onClick={() => setSheet(false)}>
          Done
        </Button>
      </Sheet>
    </section>
  );
}
