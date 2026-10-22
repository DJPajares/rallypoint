import type { ReactNode } from "react";
export interface TicketDate {
  weekday: string;
  day: string;
  month: string;
  time: string;
}
export function TicketStub({ date }: { date: TicketDate | null }) {
  return (
    <span className="rp-ticket__stub" aria-hidden="true">
      {date ? (
        <>
          <span>{date.weekday}</span>
          <strong className="rp-ticket__day rp-nums">{date.day}</strong>
          <span>{date.month}</span>
        </>
      ) : (
        <strong className="rp-ticket__day">?</strong>
      )}
    </span>
  );
}
/** A session's date on a navy stub, with whatever details sit beside it. */
export function Ticket({
  date,
  children,
}: {
  date: TicketDate | null;
  children: ReactNode;
}) {
  return (
    <div className="rp-ticket">
      <TicketStub date={date} />
      <div className="rp-ticket__body">{children}</div>
    </div>
  );
}
export function TicketTime({ children }: { children: ReactNode }) {
  return <div className="rp-ticket__time">{children}</div>;
}
export function TicketMeta({ children }: { children: ReactNode }) {
  return <div className="rp-ticket__meta">{children}</div>;
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
    <div className="rp-spots">
      <p className="rp-spots__text">
        <strong>
          {taken} of {seats} {seats === 1 ? "seat" : "seats"} taken
        </strong>
        <span>{open === 0 ? "Full" : `${open} left`}</span>
      </p>
      {seats > 0 && seats <= 24 ? (
        <div className="rp-spots__dots" aria-hidden="true">
          {Array.from({ length: seats }, (_, i) => (
            <span
              key={i}
              className={
                i < taken
                  ? "rp-spots__dot rp-spots__dot--taken"
                  : "rp-spots__dot"
              }
            />
          ))}
        </div>
      ) : seats > 0 ? (
        <div className="rp-spots__bar" aria-hidden="true">
          <span
            className="rp-spots__fill"
            style={{
              width: `${Math.min(100, Math.round((taken / seats) * 100))}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
