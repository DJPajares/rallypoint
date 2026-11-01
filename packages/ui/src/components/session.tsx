import type { ReactNode } from "react";
import { cn } from "../lib/utils";
const dayClass =
  "my-0.5 font-heading text-2xl leading-none tracking-tight tabular-nums";
export interface TicketDate {
  weekday: string;
  day: string;
  month: string;
  time: string;
}
export function TicketStub({ date }: { date: TicketDate | null }) {
  return (
    <span
      className="flex min-w-stub flex-none flex-col items-center justify-center bg-stub px-2 py-3 text-xs font-semibold tracking-wide text-on-stub uppercase"
      aria-hidden="true"
    >
      {date ? (
        <>
          <span>{date.weekday}</span>
          <strong className={dayClass}>{date.day}</strong>
          <span>{date.month}</span>
        </>
      ) : (
        <strong className={dayClass}>?</strong>
      )}
    </span>
  );
}
/** A session's date on a graphite stub, with whatever details sit beside it. */
export function Ticket({
  date,
  children,
}: {
  date: TicketDate | null;
  children: ReactNode;
}) {
  return (
    <div className="flex items-stretch overflow-hidden rounded-lg border border-border bg-surface">
      <TicketStub date={date} />
      <div className="min-w-0 flex-1 border-l-2 border-dashed border-border px-4 py-3">
        {children}
      </div>
    </div>
  );
}
export function TicketTime({ children }: { children: ReactNode }) {
  return <div className="font-semibold tabular-nums">{children}</div>;
}
export function TicketMeta({ children }: { children: ReactNode }) {
  return <div className="text-sm text-text-muted">{children}</div>;
}
/**
 * Taken and open seats: one dot per seat up to 24, a bar beyond that.
 * The words carry the meaning; the dots are decoration for sighted readers.
 */
export function SpotsMeter({
  capacity,
  taken,
}: {
  capacity: number;
  taken: number;
}) {
  const seats = Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
  const open = Math.max(seats - taken, 0);
  return (
    <div>
      <p className="mb-3 flex justify-between gap-3 text-sm tabular-nums">
        <strong>
          {taken} of {seats} {seats === 1 ? "seat" : "seats"} taken
        </strong>
        <span className="text-text-muted">
          {open === 0 ? "Full" : `${open} left`}
        </span>
      </p>
      {seats > 0 && seats <= 24 ? (
        <div className="flex flex-wrap gap-1" aria-hidden="true">
          {Array.from({ length: seats }, (_, i) => (
            <span
              key={i}
              className={cn(
                "size-dot rounded-full",
                i < taken
                  ? "bg-chrome"
                  : "border-2 border-dashed border-border-strong",
              )}
            />
          ))}
        </div>
      ) : seats > 0 ? (
        <div
          className="h-2 overflow-hidden rounded-full border border-dashed border-border-strong bg-surface-sunken"
          aria-hidden="true"
        >
          <span
            className="block h-full bg-chrome"
            style={{
              width: `${Math.min(100, Math.round((taken / seats) * 100))}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
