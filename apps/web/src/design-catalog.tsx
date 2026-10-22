"use client";
import { useState } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { ListIcon } from "@phosphor-icons/react/dist/csr/List";
import { ReceiptIcon } from "@phosphor-icons/react/dist/csr/Receipt";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import { WarningIcon } from "@phosphor-icons/react/dist/csr/Warning";
import {
  Avatar,
  Badge,
  Button,
  Card,
  CheckField,
  Divider,
  EmptyState,
  Field,
  Help,
  IconButton,
  IconTile,
  Kicker,
  Lede,
  Notice,
  Pending,
  Sheet,
  SpotsMeter,
  StatusBanner,
  Ticket,
  TicketMeta,
  TicketTime,
} from "@rallypoint/ui";
const colors = [
  "bg",
  "surface",
  "surface-sunken",
  "text",
  "text-muted",
  "border",
  "border-strong",
  "accent",
  "stub",
  "action",
  "link",
  "success",
  "warning",
  "neutral",
  "danger",
];
const space = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16];
const type = ["xs", "sm", "md", "lg", "xl", "2xl"];
const radii = ["xs", "sm", "md", "lg", "xl", "full"];
/**
 * Every token and library component on one page, in both themes via the
 * floating menu's theme switch. Look here before adding a new style: if a
 * piece already exists, use it; if a value is missing, add it to tokens.css.
 */
export function DesignCatalog() {
  const [sheet, setSheet] = useState(false);
  return (
    <section className="page catalog">
      <div className="page-head">
        <Kicker>@rallypoint/ui</Kicker>
        <h1>Design system</h1>
        <Lede>
          Tokens and components. Change a value in tokens.css and every screen
          follows.
        </Lede>
      </div>

      <h2>Colour</h2>
      <div className="catalog-grid">
        {colors.map((name) => (
          <div key={name} className="catalog-swatch">
            <span style={{ background: `var(--color-${name})` }} />
            <code>--color-{name}</code>
          </div>
        ))}
      </div>

      <h2>Type</h2>
      <Card className="stack">
        <span
          style={{ fontSize: "var(--text-display-lg)" }}
          className="catalog-display"
        >
          Display large
        </span>
        <span
          style={{ fontSize: "var(--text-display-md)" }}
          className="catalog-display"
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
      <Card className="stack">
        {space.map((step) => (
          <div key={step} className="catalog-row">
            <code>--space-{step}</code>
            <span
              className="catalog-bar"
              style={{ width: `var(--space-${step})` }}
            />
          </div>
        ))}
        <div className="catalog-radii">
          {radii.map((name) => (
            <div key={name}>
              <span style={{ borderRadius: `var(--radius-${name})` }} />
              <code>{name}</code>
            </div>
          ))}
        </div>
      </Card>

      <h2>Buttons</h2>
      <Card className="catalog-wrap">
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
      <div className="group-grid">
        <Card className="stack">
          <div className="catalog-wrap">
            <IconTile>
              <UsersThreeIcon size={24} />
            </IconTile>
            <Badge>Organizer</Badge>
            <Avatar name="Mika" />
          </div>
          <h3>Card</h3>
          <Help>The default surface for grouped content.</Help>
        </Card>
        <Card tone="accent" className="stack">
          <h3>Accent card</h3>
          <p>For the one block a screen leads with.</p>
        </Card>
      </div>

      <h2>Status and feedback</h2>
      <div className="stack">
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
        <Notice retry={() => {}}>The session could not be loaded.</Notice>
        <Notice tone="warning">The result has not been confirmed.</Notice>
        <Pending>Checking your place…</Pending>
      </div>

      <h2>Session pieces</h2>
      <div className="group-grid">
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
        <Field
          id="catalog-title"
          label="Session title"
          help="Shown on the shared page."
        >
          <input id="catalog-title" placeholder="Sunday morning badminton" />
        </Field>
        <CheckField>Bring one guest (two seats together)</CheckField>
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
