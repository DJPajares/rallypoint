import type {
  EmailSummary,
  PaymentNote,
  RegistrationView,
} from "./registration.ts";

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

const emailKinds: Record<string, string> = {
  joined_confirmed: "Booking",
  joined_waitlisted: "Waitlist",
  promoted: "Moved up",
  released: "Spot released",
  cancelled: "Cancellation",
  instructions_changed: "Payment details",
  reminder: "Reminder",
};
/** The short name an organizer sees before an email's status. */
export const emailKindLabel = (kind: string): string =>
  emailKinds[kind] ?? "Email";

const notSentWords: Record<string, string> = {
  superseded: "no longer applies",
  expired: "too late",
  rejected: "email service refused it",
  render_failed: "couldn’t be prepared",
  attempts_exhausted: "email service didn’t accept it",
  delivery_disabled: "email is off",
  queue_capacity: "too many emails waiting",
  no_verified_email: "no verified email",
  destination_changed: "email address changed",
};

/**
 * What the organizer may be told about one email. "Sent" means the email
 * service accepted it; nothing here says it was delivered or read. A waiting
 * email only ever explains a sending limit; an unknown reason says nothing.
 */
export function emailWords(e: {
  status: string;
  reason: string | null;
  kind: string;
}): string {
  switch (e.status) {
    case "queued":
      return e.reason === "daily_limit"
        ? "Queued · daily email limit"
        : e.reason === "monthly_limit"
          ? "Queued · monthly email limit"
          : "Queued";
    case "sent":
      return "Sent to email service";
    case "not_confirmed":
      return "Not confirmed";
    default: {
      const why = e.reason ? notSentWords[e.reason] : undefined;
      return why ? `Not sent · ${why}` : "Not sent";
    }
  }
}

/**
 * One line on how the cancellation emails went, or "" when none were queued or
 * withheld. Zero counts are left out. A withheld update says why in place of
 * counts: it was never sent to anyone.
 */
export function cancellationEmailWords(
  summary: EmailSummary | undefined,
): string {
  if (!summary) return "";
  if (summary.suppressed.some((s) => s.kind === "cancelled"))
    return "Cancellation emails weren’t sent: more than 50 people.";
  const c = summary.cancellation;
  if (!c) return "";
  const parts = [
    c.sent ? `${c.sent} sent to email service` : "",
    c.queued ? `${c.queued} queued` : "",
    c.notConfirmed ? `${c.notConfirmed} not confirmed` : "",
    c.notSent ? `${c.notSent} not sent` : "",
  ].filter(Boolean);
  return parts.length ? `Cancellation emails: ${parts.join(" · ")}` : "";
}

/**
 * One line when the latest changed payment details were withheld because they
 * would have reached more than 50 people, otherwise "". Said once, in words.
 */
export function instructionsEmailWords(
  summary: EmailSummary | undefined,
): string {
  const latest = (summary?.suppressed ?? [])
    .filter((s) => s.kind === "instructions_changed")
    .reduce<EmailSummary["suppressed"][number] | null>(
      (a, b) => (!a || Date.parse(b.at) >= Date.parse(a.at) ? b : a),
      null,
    );
  return latest
    ? "Payment-details emails weren’t sent: more than 50 people."
    : "";
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
