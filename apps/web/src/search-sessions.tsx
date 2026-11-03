"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import Link from "next/link";
import { CoinsIcon } from "@phosphor-icons/react/dist/csr/Coins";
import { FunnelSimpleIcon } from "@phosphor-icons/react/dist/csr/FunnelSimple";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import {
  buttonClass,
  CheckField,
  cn,
  Notice,
  Pill,
  Segmented,
  Sheet,
} from "@rallypoint/ui";
import {
  activeFilterCount,
  dayStrip,
  filterSessions,
  noFilters,
  priceLabel,
  spotsLabel,
  startOfDay,
} from "@rallypoint/domain/discovery";
import type {
  SearchSession,
  SessionFilters,
  TimeOfDay,
} from "@rallypoint/domain/discovery";
import { sessionHref, statusLabel } from "@rallypoint/domain/my-sessions";
import type { MySessionRow } from "@rallypoint/domain/my-sessions";
import { ListSkeleton } from "./skeletons";
import { useApi } from "./use-api";

const perDay = 50;
const times: Array<{ value: TimeOfDay; label: string }> = [
  { value: "morning", label: "Morning" },
  { value: "afternoon", label: "Afternoon" },
  { value: "evening", label: "Evening" },
];
const clock = (iso: string, timeZone: string) =>
  new Date(iso).toLocaleTimeString(undefined, {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

/** Public sessions for the next 14 days, one day at a time (D-27). */
export function SearchSessions({
  query,
  onStatus,
}: {
  query: string;
  onStatus: (text: string) => void;
}) {
  // Read once: the strip and its "Today" don't need to tick.
  const [now] = useState(() => new Date());
  const timeZone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    [],
  );
  const strip = useMemo(() => dayStrip(now, timeZone), [now, timeZone]);
  const params = new URLSearchParams({
    from: startOfDay(now, timeZone),
    tz: timeZone,
  });
  if (query) params.set("q", query);
  const found = useApi<{ sessions: SearchSession[] }>(
    `/api/search/sessions?${params}`,
  );
  const [day, setDay] = useState(strip[0].key);
  const [filters, setFilters] = useState<SessionFilters>(noFilters);
  const [editing, setEditing] = useState(false);
  const rows = useMemo(() => found.data?.sessions ?? [], [found.data]);
  const shown = useMemo(() => filterSessions(rows, filters), [rows, filters]);
  const counts = useMemo(() => {
    const byDay = new Map<string, number>();
    for (const row of shown) byDay.set(row.day, (byDay.get(row.day) ?? 0) + 1);
    return byDay;
  }, [shown]);
  const activities = useMemo(
    () =>
      [...new Set(rows.map((r) => r.activity).filter(Boolean))].sort((a, b) =>
        a.localeCompare(b, undefined, { sensitivity: "base" }),
      ),
    [rows],
  );
  const today = shown.filter((r) => r.day === day);
  const fullDay = rows.filter((r) => r.day === day).length >= perDay;
  const label = strip.find((d) => d.key === day)?.label ?? "";
  const filtered = activeFilterCount(filters);
  const status =
    found.loading || found.error
      ? ""
      : `${today.length} ${today.length === 1 ? "session" : "sessions"} ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : `on ${label}`}.`;
  useEffect(() => onStatus(status), [onStatus, status]);
  const next = strip.find((d) => d.key > day && (counts.get(d.key) ?? 0) > 0);
  return (
    <div className="grid gap-4">
      {query ? <YourSessions query={query} /> : null}
      <DayStrip
        days={strip}
        counts={found.loading ? null : counts}
        value={day}
        onChange={setDay}
      />
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={buttonClass({ size: "sm" })}
          onClick={() => setEditing(true)}
          aria-haspopup="dialog"
        >
          <FunnelSimpleIcon size={16} aria-hidden="true" />
          Filters{filtered ? ` (${filtered})` : ""}
        </button>
        <FilterChips filters={filters} onChange={setFilters} />
      </div>
      {found.loading ? (
        <ListSkeleton label="Finding sessions…" rows={4} />
      ) : found.error ? (
        <Notice retry={found.retry}>{found.error}</Notice>
      ) : today.length ? (
        <>
          <ul
            className="m-0 grid list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0"
            aria-label={`Sessions ${label === "Today" || label === "Tomorrow" ? label.toLowerCase() : `on ${label}`}`}
          >
            {today.map((row) => (
              <SessionRow key={row.slug} row={row} />
            ))}
          </ul>
          {fullDay ? (
            <p className="m-0 text-sm text-muted-foreground">
              {filtered
                ? `This day has more than ${perDay} sessions, and filters only look through the first ${perDay}. Search by name to narrow it down.`
                : `Showing the first ${perDay} sessions for this day.`}
            </p>
          ) : null}
        </>
      ) : filtered && !shown.length ? (
        <Empty
          text="No sessions match these filters."
          action={
            <button
              type="button"
              className={buttonClass()}
              onClick={() => setFilters(noFilters)}
            >
              Clear filters
            </button>
          }
        />
      ) : (
        <Empty
          text={
            fullDay && filtered
              ? `No matches in the first ${perDay} sessions of this day. Search by name to narrow it down.`
              : filtered
                ? "No sessions match these filters on this day."
                : query
                  ? "No sessions match on this day."
                  : "Nothing on this day yet."
          }
          action={
            next ? (
              <button
                type="button"
                className={buttonClass()}
                onClick={() => setDay(next.key)}
              >
                Next: {next.label}
              </button>
            ) : null
          }
        />
      )}
      <FilterSheet
        open={editing}
        onClose={() => setEditing(false)}
        activities={activities}
        filters={filters}
        onChange={setFilters}
        matches={shown.length}
      />
    </div>
  );
}

/**
 * The day strip: a weekday over a large date, with how many sessions it has.
 * Arrow keys move between days, as in any tab list.
 */
function DayStrip({
  days,
  counts,
  value,
  onChange,
}: {
  days: Array<{ key: string; label: string; short: string }>;
  counts: Map<string, number> | null;
  value: string;
  onChange: (key: string) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  useEffect(() => {
    refs.current[days.findIndex((d) => d.key === value)]?.scrollIntoView({
      block: "nearest",
      inline: "nearest",
    });
  }, [days, value]);
  function onKeyDown(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const next = Math.min(Math.max(index + step, 0), days.length - 1);
    onChange(days[next].key);
    refs.current[next]?.focus();
  }
  return (
    <div
      role="tablist"
      aria-label="Day"
      className="flex snap-x gap-2 overflow-x-auto pb-2 [scrollbar-width:none] [@media(hover:hover)]:[scrollbar-width:thin]"
    >
      {days.map((d, i) => {
        const selected = d.key === value;
        const n = counts?.get(d.key) ?? 0;
        const date = Number(d.key.slice(8));
        return (
          <button
            key={d.key}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            aria-label={`${d.label === "Today" || d.label === "Tomorrow" ? `${d.label}, ${d.short} ${date}` : d.label}, ${counts ? `${n} ${n === 1 ? "session" : "sessions"}` : "loading"}`}
            onClick={() => onChange(d.key)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "grid min-w-15 shrink-0 snap-start justify-items-center gap-0.5 rounded-2xl border px-3 pt-2 pb-2.5 transition-colors duration-150 ease-standard motion-reduce:transition-none",
              selected
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border bg-card text-foreground hover:bg-muted",
            )}
          >
            <span
              className={cn(
                "text-xs font-medium",
                selected ? "text-primary-foreground" : "text-muted-foreground",
              )}
            >
              {i === 0 ? "Today" : d.short}
            </span>
            <span className="text-2xl leading-none font-bold tabular-nums">
              {date}
            </span>
            <span
              aria-hidden="true"
              className={cn(
                "text-xs tabular-nums",
                selected ? "text-primary-foreground" : "text-muted-foreground",
                !n && !selected ? "opacity-50" : null,
              )}
            >
              {counts ? (n ? n : "–") : " "}
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** One session: the start time leads, the facts sit beside it. */
function SessionRow({ row }: { row: SearchSession }) {
  const left = row.capacity - row.takenSeats;
  return (
    <li>
      <Link
        href={`/s/${row.slug}`}
        className="grid grid-cols-[5.5rem_1fr] gap-4 px-4 py-4 text-foreground no-underline hover:bg-muted focus-visible:outline-offset-[-3px]"
      >
        <span className="grid content-start gap-0.5">
          <span className="text-lg leading-tight font-bold tabular-nums">
            {clock(row.startsAt, row.timeZone)}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">
            to {clock(row.endsAt, row.timeZone)}
          </span>
        </span>
        <span className="grid min-w-0 gap-1">
          <span className="flex flex-wrap items-center gap-2">
            <strong className="truncate">
              {row.title || "Untitled session"}
            </strong>
            {row.happeningNow ? (
              <Pill tone="success">Happening now</Pill>
            ) : null}
          </span>
          <span className="truncate text-sm text-muted-foreground">
            {row.activity}
            {row.location ? ` at ${row.location}` : ""}
          </span>
          <span className="text-sm text-muted-foreground">
            Hosted by {row.hostName}
          </span>
          <span className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            <span
              className={cn(
                "inline-flex items-center gap-1.5",
                left <= 0 && row.joinMode === "direct"
                  ? "text-muted-foreground"
                  : null,
              )}
            >
              <UsersIcon size={16} aria-hidden="true" />
              {spotsLabel(row)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <CoinsIcon size={16} aria-hidden="true" />
              {priceLabel(row)}
            </span>
          </span>
        </span>
      </Link>
    </li>
  );
}

function Empty({ text, action }: { text: string; action: React.ReactNode }) {
  return (
    <div className="grid justify-items-start gap-3 rounded-xl border border-dashed border-border px-5 py-8">
      <p className="m-0 text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

/** Filters that are on, each removable in one tap. */
function FilterChips({
  filters,
  onChange,
}: {
  filters: SessionFilters;
  onChange: (next: SessionFilters) => void;
}) {
  const chips: Array<{ label: string; remove: () => SessionFilters }> = [
    ...filters.activities.map((a) => ({
      label: a,
      remove: () => ({
        ...filters,
        activities: filters.activities.filter((x) => x !== a),
      }),
    })),
    ...filters.times.map((t) => ({
      label: times.find((x) => x.value === t)?.label ?? t,
      remove: () => ({
        ...filters,
        times: filters.times.filter((x) => x !== t),
      }),
    })),
    ...(filters.price === "any"
      ? []
      : [
          {
            label: filters.price === "free" ? "Free" : "Paid",
            remove: () => ({ ...filters, price: "any" as const }),
          },
        ]),
    ...(filters.spotsLeft
      ? [
          {
            label: "Has spots left",
            remove: () => ({ ...filters, spotsLeft: false }),
          },
        ]
      : []),
    ...(filters.joining === "any"
      ? []
      : [
          {
            label:
              filters.joining === "direct" ? "Join directly" : "Ask to join",
            remove: () => ({ ...filters, joining: "any" as const }),
          },
        ]),
  ];
  if (!chips.length) return null;
  return (
    <>
      {chips.map((chip) => (
        <button
          key={chip.label}
          type="button"
          onClick={() => onChange(chip.remove())}
          aria-label={`Remove filter: ${chip.label}`}
          className="inline-flex min-h-8 items-center gap-1 rounded-full border border-border bg-card px-3 text-sm font-medium text-foreground hover:bg-muted"
        >
          {chip.label}
          <XIcon size={14} aria-hidden="true" />
        </button>
      ))}
      <button
        type="button"
        className={buttonClass({ variant: "link", size: "sm" })}
        onClick={() => onChange(noFilters)}
      >
        Clear all
      </button>
    </>
  );
}

function FilterSheet({
  open,
  onClose,
  activities,
  filters,
  onChange,
  matches,
}: {
  open: boolean;
  onClose: () => void;
  activities: string[];
  filters: SessionFilters;
  onChange: (next: SessionFilters) => void;
  matches: number;
}) {
  const toggle = <T,>(list: T[], value: T, on: boolean) =>
    on ? [...list, value] : list.filter((x) => x !== value);
  return (
    <Sheet open={open} onClose={onClose} title="Filters">
      <div className="grid gap-5 [&_fieldset]:m-0 [&_fieldset]:border-0 [&_fieldset]:p-0 [&_legend]:mb-1 [&_legend]:text-base [&_legend]:font-semibold">
        {activities.length ? (
          <fieldset>
            <legend>Activity</legend>
            {activities.map((a) => (
              <CheckField
                key={a}
                checked={filters.activities.includes(a)}
                onCheckedChange={(on) =>
                  onChange({
                    ...filters,
                    activities: toggle(filters.activities, a, on),
                  })
                }
              >
                {a}
              </CheckField>
            ))}
          </fieldset>
        ) : null}
        <fieldset>
          <legend>Time of day</legend>
          {times.map((t) => (
            <CheckField
              key={t.value}
              checked={filters.times.includes(t.value)}
              onCheckedChange={(on) =>
                onChange({
                  ...filters,
                  times: toggle(filters.times, t.value, on),
                })
              }
            >
              {t.label}
            </CheckField>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <span className="font-semibold">Price</span>
          <Segmented
            label="Price"
            options={[
              { value: "any", label: "Any" },
              { value: "free", label: "Free" },
              { value: "paid", label: "Paid" },
            ]}
            value={filters.price}
            onChange={(price) => onChange({ ...filters, price })}
          />
        </div>
        <div className="grid gap-2">
          <span className="font-semibold">Joining</span>
          <Segmented
            label="Joining"
            options={[
              { value: "any", label: "Any" },
              { value: "direct", label: "Join directly" },
              { value: "request", label: "Ask to join" },
            ]}
            value={filters.joining}
            onChange={(joining) => onChange({ ...filters, joining })}
          />
        </div>
        <CheckField
          checked={filters.spotsLeft}
          onCheckedChange={(spotsLeft) => onChange({ ...filters, spotsLeft })}
        >
          Has spots left
        </CheckField>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={buttonClass({ variant: "primary" })}
            onClick={onClose}
          >
            Show {matches} {matches === 1 ? "session" : "sessions"}
          </button>
          {activeFilterCount(filters) ? (
            <button
              type="button"
              className={buttonClass()}
              onClick={() => onChange(noFilters)}
            >
              Clear all
            </button>
          ) : null}
        </div>
      </div>
    </Sheet>
  );
}

/** Your own sessions matching the search, private ones included. */
function YourSessions({ query }: { query: string }) {
  const found = useApi<{ sessions: MySessionRow[] }>(
    `/api/search?q=${encodeURIComponent(query)}`,
  );
  // Read once per search, so a row reads past or upcoming steadily.
  const [now] = useState(() => Date.now());
  const sessions = found.data?.sessions ?? [];
  if (found.loading || found.error || !sessions.length) return null;
  return (
    <section aria-labelledby="your-sessions" className="grid gap-2">
      <h2 id="your-sessions" className="m-0 text-base">
        Your sessions
      </h2>
      <ul className="m-0 grid list-none gap-1 p-0">
        {sessions.slice(0, 5).map((s) => {
          const past = !!s.endsAt && Date.parse(s.endsAt) <= now;
          return (
            <li key={s.slug}>
              <Link
                href={sessionHref(s)}
                className="flex flex-wrap items-baseline gap-x-2 rounded-md px-2 py-1.5 text-foreground no-underline hover:bg-muted"
              >
                <strong>{s.title || "Untitled session"}</strong>
                <span className="text-sm text-muted-foreground">
                  {statusLabel(s, past)}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
