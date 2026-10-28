import { Temporal } from "@js-temporal/polyfill";
import type { SessionDetails, SessionForm } from "./session.ts";

const minute = (p: Temporal.PlainDateTime) =>
  p.toString({ smallestUnit: "minute" });

/**
 * The form for running a session again (P-22): the same details on the same
 * weekday and local time, in the first week whose start is still ahead.
 * Opening and cutoff keep their gap before the start; an opening that would
 * already have passed opens now, and the cutoff never precedes the opening.
 * Nothing derived at publish (instants, minor amounts) is carried over.
 */
export function nextWeekForm(d: SessionDetails, now: number): SessionForm {
  const zone = d.timeZone;
  const today = Temporal.Instant.fromEpochMilliseconds(now)
    .toZonedDateTimeISO(zone)
    .toPlainDateTime();
  const start = Temporal.PlainDateTime.from(d.startLocal);
  // Jump close to now, then step until the start is ahead of it.
  let weeks = Math.max(
    1,
    Math.floor(start.toPlainDate().until(today.toPlainDate()).days / 7),
  );
  while (Temporal.PlainDateTime.compare(start.add({ weeks }), today) <= 0)
    weeks += 1;
  const shift = (local: string) =>
    local ? minute(Temporal.PlainDateTime.from(local).add({ weeks })) : local;
  const nowLocal = today.round({
    smallestUnit: "minute",
    roundingMode: "ceil",
  });
  let openLocal = shift(d.openLocal);
  if (openLocal && Temporal.PlainDateTime.compare(openLocal, nowLocal) < 0)
    openLocal = minute(nowLocal);
  let cutoffLocal = shift(d.cutoffLocal);
  if (
    cutoffLocal &&
    openLocal &&
    Temporal.PlainDateTime.compare(cutoffLocal, openLocal) < 0
  )
    cutoffLocal = openLocal;
  return {
    title: d.title,
    activity: d.activity,
    startLocal: shift(d.startLocal),
    endLocal: shift(d.endLocal),
    timeZone: zone,
    location: d.location,
    mapsLink: d.mapsLink ?? "",
    instructions: d.instructions,
    capacity: d.capacity,
    openLocal,
    cutoffLocal,
    fee: d.fee,
    currency: d.currency,
    guests: d.guests,
    feeMode: d.feeMode,
    paymentMode: d.paymentMode,
    releaseUnpaid: d.releaseUnpaid,
    joinMode: d.joinMode ?? "direct",
  };
}
