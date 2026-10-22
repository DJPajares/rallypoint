import type { RegistrationView } from "./registration.ts";

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

/** Withdrawn or removed, but still carrying a fee an organizer may act on. */
const leftWithFee = (p: RosterParty) =>
  (p.state === "withdrawn" || p.state === "removed") &&
  !!p.fee &&
  (p.fee.liabilityState === "due" || p.fee.liabilityState === "waived");

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
  if (p.fee.liabilityState !== "due") return "Nothing due";
  if (p.fee.markedPaid) return "Paid";
  if (p.fee.totalMinor === 0) return "";
  return `${money(p.fee.currency, p.fee.totalMinor)} to pay`;
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
