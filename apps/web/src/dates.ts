import type { TicketDate } from "@rallypoint/ui";
function parts(date: Date, timeZone: string): TicketDate {
  const get = (options: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat("en", { timeZone, ...options }).format(date);
  return {
    weekday: get({ weekday: "short" }),
    day: get({ day: "numeric" }),
    month: get({ month: "short" }),
    time: get({ hour: "numeric", minute: "2-digit" }),
  };
}
/** An absolute instant, shown on the session's own wall clock. */
export function fromInstant(value: string | undefined, timeZone: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : parts(date, timeZone);
}
/**
 * A draft's "YYYY-MM-DDTHH:mm" is already wall-clock time in the session's
 * timezone. Reading its fields as UTC keeps the same calendar day and weekday
 * without guessing an offset.
 */
export function fromLocal(value: string | undefined) {
  const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!match) return null;
  const [, y, m, d, h, min] = match.map(Number);
  return parts(new Date(Date.UTC(y, m - 1, d, h, min)), "UTC");
}
/** The current wall-clock minute in a timezone, as "YYYY-MM-DDTHH:mm". */
export function nowLocal(timeZone: string): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date())
      .map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
