export interface Counts {
  confirmedSeats: number;
  waitingParties: number;
}
export interface Fee {
  currency: string;
  unitMinor: number;
  chargedSeats: number;
  totalMinor: number;
  liabilityState: "due" | "removed_before_cutoff" | "waived";
  removedAt: string | null;
  markedPaid: boolean;
}
export type PaymentAction =
  "mark_paid" | "mark_unpaid" | "waive" | "undo_waiver";
/** Organizer/co-host view: the revision to write against and who changed what. */
export interface ManagedFee extends Fee {
  revision: number;
  history: Array<{
    action:
      | "marked_paid"
      | "marked_unpaid"
      | "waived"
      | "waiver_undone"
      | "removed_before_cutoff";
    by: string;
    at: string;
  }>;
}
export interface DuesItem {
  partyId: string;
  partyState: OwnParty["state"];
  seats: number;
  fee: Fee;
  session: {
    slug: string;
    state: "published" | "cancelled" | "completed";
    title: string;
    startsAt: string;
    timeZone: string;
  };
}
/** One plain word for a fee's standing, shared by every view. */
export const feeStanding = (fee: Fee) =>
  fee.liabilityState === "removed_before_cutoff"
    ? "Removed"
    : fee.liabilityState === "waived"
      ? "Waived"
      : fee.markedPaid
        ? "Paid"
        : "Unpaid";
export interface OwnParty {
  id: string;
  state: "confirmed" | "waitlisted" | "withdrawn" | "removed";
  seats: number;
  primaryName: string;
  guestName: string;
  queuePosition: number | null;
  consentVersion: number;
  withdrawnAt: string | null;
  fee: Fee | null;
}
export interface RegistrationView {
  own: OwnParty | null;
  canManage: boolean;
  rosterAllowed: boolean;
  counts: Counts;
  roster: Array<{
    primaryName: string;
    guestName: string;
    seats: number;
    id?: string;
    state?: string;
    fee?: ManagedFee | null;
  }>;
}
