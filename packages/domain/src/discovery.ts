// Finding public sessions in Search (D-27). The server returns the next 14
// days of public sessions, each tagged with the viewer's day; these helpers
// build the day strip and apply the filters on the device, so changing a
// filter never waits on the network.
import { Temporal } from "@js-temporal/polyfill";
import { feeLabel } from "./session.ts";

/** A public session as Search lists it. */
export interface SearchSession {
  slug: string;
  title: string;
  activity: string;
  startsAt: string;
  endsAt: string;
  timeZone: string;
  location: string;
  hostName: string;
  capacity: number;
  takenSeats: number;
  joinMode: "direct" | "request";
  currency: string;
  feeMinor: number | null;
  totalMinor: number | null;
  feeMode: "fixed" | "split";
  paymentMode: "organizer" | "untracked";
  /** The viewer's local day it's listed on (YYYY-MM-DD). */
  day: string;
  happeningNow: boolean;
}

export type TimeOfDay = "morning" | "afternoon" | "evening";

export interface SessionFilters {
  activities: string[];
  times: TimeOfDay[];
  price: "any" | "free" | "paid";
  spotsLeft: boolean;
  joining: "any" | "direct" | "request";
}

export const noFilters: SessionFilters = {
  activities: [],
  times: [],
  price: "any",
  spotsLeft: false,
  joining: "any",
};

/** Days Search covers, today first. */
export const searchDays = 14;

const today = (now: Date, timeZone: string) =>
  Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(timeZone)
    .toPlainDate();

/** The day strip: "Today", "Tomorrow", then "Thu 5". */
export function dayStrip(
  now: Date,
  timeZone: string,
  days = searchDays,
): Array<{ key: string; label: string; short: string }> {
  const first = today(now, timeZone);
  return Array.from({ length: days }, (_, i) => {
    const date = first.add({ days: i });
    const short = date.toLocaleString("en", { weekday: "short" });
    return {
      key: date.toString(),
      label: i === 0 ? "Today" : i === 1 ? "Tomorrow" : `${short} ${date.day}`,
      short,
    };
  });
}

/** The instant the viewer's day starts, which Search reads from. */
export function startOfDay(now: Date, timeZone: string): string {
  return today(now, timeZone)
    .toZonedDateTime({ timeZone })
    .toInstant()
    .toString();
}

/** Morning before 12:00, afternoon until 17:00, then evening, by the session's own clock. */
export function timeOfDay(
  row: Pick<SearchSession, "startsAt" | "timeZone">,
): TimeOfDay {
  const hour = Temporal.Instant.from(row.startsAt).toZonedDateTimeISO(
    row.timeZone,
  ).hour;
  return hour < 12 ? "morning" : hour < 17 ? "afternoon" : "evening";
}

const tracked = (row: SearchSession) => row.paymentMode !== "untracked";
const cost = (row: SearchSession) =>
  (row.feeMode === "split" ? row.totalMinor : row.feeMinor) ?? 0;

export function filterSessions(
  rows: SearchSession[],
  filters: SessionFilters,
): SearchSession[] {
  return rows.filter(
    (row) =>
      (!filters.activities.length ||
        filters.activities.includes(row.activity)) &&
      (!filters.times.length || filters.times.includes(timeOfDay(row))) &&
      (filters.price === "any" ||
        (tracked(row) &&
          (filters.price === "free" ? cost(row) === 0 : cost(row) > 0))) &&
      (!filters.spotsLeft || row.takenSeats < row.capacity) &&
      (filters.joining === "any" || row.joinMode === filters.joining),
  );
}

/** How many filter choices are on, for the Filters button. */
export function activeFilterCount(filters: SessionFilters): number {
  return (
    filters.activities.length +
    filters.times.length +
    (filters.price === "any" ? 0 : 1) +
    (filters.spotsLeft ? 1 : 0) +
    (filters.joining === "any" ? 0 : 1)
  );
}

export function spotsLabel(row: SearchSession): string {
  if (row.joinMode === "request") return "Ask to join";
  const left = row.capacity - row.takenSeats;
  if (left <= 0) return "Full · waitlist";
  return `${left} ${left === 1 ? "spot" : "spots"} left`;
}

export function priceLabel(row: SearchSession): string {
  if (!tracked(row)) return "Fee set by the host";
  const minor = cost(row);
  if (minor === 0) return "Free";
  if (row.feeMode === "split")
    return `≈ ${feeLabel({ currency: row.currency, feeMinor: Math.round(minor / Math.max(row.capacity, 1)) })} each`;
  return feeLabel({ currency: row.currency, feeMinor: minor });
}
