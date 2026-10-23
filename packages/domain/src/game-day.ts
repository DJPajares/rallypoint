import type { PaymentNote, RegistrationView } from "./registration.ts";

// What an organizer needs at a glance on the day (PRD D-17, R2). Every number
// counts records the organizer already sees; nothing here decides anything.
export type Roster = RegistrationView["roster"];
export type RosterParty = Roster[number];
export type GameDayFilter = "everyone" | "not_here" | "to_pay";

/** A fee that is due, not marked paid, and above zero. */
const owes = (p: RosterParty) =>
  !!p.fee &&
  p.fee.liabilityState === "due" &&
  !p.fee.markedPaid &&
  p.fee.totalMinor > 0;

/**
 * Withdrawn or removed, but still carrying money an organizer may act on: a
 * fee that is due or waived, or (before a split is final) a retained or
 * waived share. A spot given to the waitlist stays listed too, as the record
 * of who released it (owner, 2026-10-23).
 */
const leftWithFee = (p: RosterParty) =>
  (p.state === "withdrawn" || p.state === "removed") &&
  (p.fee
    ? p.fee.liabilityState === "due" ||
      p.fee.liabilityState === "waived" ||
      p.fee.liabilityState === "released_unpaid"
    : !!p.splitClaim && (p.splitClaim.eligible || p.splitClaim.waived));

/** Who gave this party's spot to the waitlist, and when; null if nobody did. */
export function releaseRecord(p: RosterParty) {
  if (p.fee?.liabilityState !== "released_unpaid") return null;
  const change = p.fee.history.find((h) => h.action === "released_unpaid");
  return change ? { by: change.by, at: change.at } : null;
}

export function gameDaySummary(roster: Roster) {
  const confirmed = roster.filter((p) => p.state === "confirmed");
  return {
    here: confirmed.reduce(
      (n, p) =>
        n + (p.attendance ?? []).filter((a) => a.state === "checked_in").length,
      0,
    ),
    expected: confirmed.reduce((n, p) => n + p.seats, 0),
    toPay: roster.filter(owes).length,
    waiting: roster.filter((p) => p.state === "waitlisted").length,
  };
}

/** Who in a confirmed party has not been checked in yet, by name. */
export function partyStanding(p: RosterParty) {
  const seats = p.attendance ?? [];
  const missing = seats
    .filter((a) => a.state !== "checked_in")
    .map((a) => (a.seat === 1 ? p.primaryName : p.guestName || "Guest"));
  return { seatsHere: seats.length - missing.length, seats: p.seats, missing };
}

export function paymentWords(
  p: RosterParty,
  money: (currency: string, minor: number) => string,
): string {
  if (!p.fee) return p.splitClaim ? "Share pending" : "";
  if (p.fee.liabilityState === "waived") return "Waived";
  if (p.fee.liabilityState === "released_unpaid") return "Released";
  if (p.fee.liabilityState !== "due") return "Nothing due";
  if (p.fee.markedPaid) return "Paid";
  if (p.fee.totalMinor === 0) return "";
  return `${money(p.fee.currency, p.fee.totalMinor)} to pay`;
}

/**
 * What a player said about sending payment, in the organizer's words. It is a
 * hint, never a payment: it says nothing about whether the fee is paid.
 */
export function noteWords(note: PaymentNote | null | undefined): string {
  if (!note) return "";
  return note.reference ? `Says sent · ref ${note.reference}` : "Says sent";
}

/**
 * The same hint for a roster row, only while the party's fee is still open: a
 * fee that is paid, waived, removed or released has nothing left to hint at.
 * A waiting party has no fee yet and may still have said it sent payment.
 */
export function partyNoteWords(p: RosterParty): string {
  if (p.fee && (p.fee.liabilityState !== "due" || p.fee.markedPaid)) return "";
  return noteWords(p.paymentNote);
}

/** The roster in three groups, narrowed by the chosen filter. Queue order is kept. */
export function filterParties(roster: Roster, filter: GameDayFilter) {
  const confirmed = roster.filter((p) => p.state === "confirmed");
  const waiting = roster.filter((p) => p.state === "waitlisted");
  const left = roster.filter(leftWithFee);
  if (filter === "not_here")
    return {
      confirmed: confirmed.filter((p) => partyStanding(p).missing.length > 0),
      waiting: [],
      left: [],
    };
  if (filter === "to_pay")
    return {
      confirmed: confirmed.filter(owes),
      waiting: waiting.filter(owes),
      left: left.filter(owes),
    };
  return { confirmed, waiting, left };
}
