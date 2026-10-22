export interface Counts {
  confirmedSeats: number;
  waitingParties: number;
}
export interface Fee {
  currency: string;
  unitMinor: number | null;
  mode?: FeeMode;
  splitRunId?: string;
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
export type AttendanceState = "unrecorded" | "checked_in" | "no_show";
/** Seat 1 is the primary registrant, seat 2 their guest. */
export interface SeatAttendance {
  seat: 1 | 2;
  state: AttendanceState;
  revision: number;
  by: string | null;
  at: string | null;
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
  splitClaim?: OwnSplitClaim;
  splitHistory?: OwnSplitChange[];
}
export interface RegistrationView {
  own: OwnParty | null;
  canManage: boolean;
  rosterAllowed: boolean;
  counts: Counts;
  split?: SplitSummary;
  roster: Array<{
    primaryName: string;
    guestName: string;
    seats: number;
    id?: string;
    state?: string;
    fee?: ManagedFee | null;
    splitClaim?: ManagedSplitClaim;
    /** Organizers/co-hosts only; one entry per confirmed seat. */
    attendance?: SeatAttendance[];
  }>;
}
import type {
  FeeMode,
  ManagedSplitClaim,
  OwnSplitChange,
  OwnSplitClaim,
  SplitSummary,
} from "./fees.ts";
