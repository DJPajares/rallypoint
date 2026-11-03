// The session a booked ranked match is played in (D-26, WDL-424). The booker
// enters the court, the time and the court's total cost; everything else is
// fixed: private to the matched players, the cost split equally and paid to
// the booker, and a cutoff a day before the start (or now, for a same-day
// booking). The result goes through the ordinary session checks.
import { Temporal } from "@js-temporal/polyfill";
import type { SessionForm } from "./session.ts";
import type { SearchFormat } from "./ranked-search.ts";

export interface BookingInput {
  format: SearchFormat;
  players: number;
  location: string;
  mapsLink: string;
  startLocal: string;
  endLocal: string;
  /** The court's total cost in SGD; the session splits it equally. */
  cost: string;
  timeZone: string;
}

/** Hours before the start when withdrawing stops being free (spec: 24). */
export const rankedCutoffHours = 24;

const minute = (value: Temporal.PlainDateTime) =>
  value.toString({ smallestUnit: "minute" });

/** A session form for a ranked match; invalid times fail the session checks. */
export function rankedSessionForm(input: BookingInput, now: Date): SessionForm {
  const opens = Temporal.Instant.fromEpochMilliseconds(now.getTime())
    .toZonedDateTimeISO(input.timeZone)
    .toPlainDateTime()
    .round({ smallestUnit: "minute", roundingMode: "floor" });
  let cutoff = opens;
  try {
    const dayBefore = Temporal.PlainDateTime.from(input.startLocal).subtract({
      hours: rankedCutoffHours,
    });
    if (Temporal.PlainDateTime.compare(dayBefore, opens) > 0)
      cutoff = dayBefore;
  } catch {
    // A start that can't be read fails the session checks with its own message.
  }
  return {
    title: `Ranked ${input.format === "doubles" ? "Doubles" : "Singles"}`,
    activity: "Pickleball",
    startLocal: input.startLocal,
    endLocal: input.endLocal,
    timeZone: input.timeZone,
    location: input.location,
    mapsLink: input.mapsLink,
    instructions:
      "Ranked match. Check yourself in on the Ranked page from 30 minutes before the start.",
    capacity: String(input.players),
    openLocal: minute(opens),
    cutoffLocal: minute(cutoff),
    fee: input.cost,
    currency: "SGD",
    guests: false,
    feeMode: "split",
    paymentMode: "organizer",
    releaseUnpaid: false,
    joinMode: "direct",
    access: "private",
  };
}
