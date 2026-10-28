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
  liabilityState:
    | "due"
    | "removed_after_change"
    | "removed_before_cutoff"
    | "removed_session_cancelled"
    | "released_unpaid"
    | "waived";
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
      | "split_corrected"
      | "marked_paid"
      | "marked_unpaid"
      | "waived"
      | "waiver_undone"
      | "removed_after_change"
      | "removed_before_cutoff"
      | "removed_session_cancelled"
      | "released_unpaid";
    previousMinor?: number | null;
    currentMinor?: number | null;
    currency?: string;
    splitRunId?: string | null;
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
export interface SplitClaimDuesItem {
  partyId: string;
  partyState: OwnParty["state"];
  seats: number;
  session: DuesItem["session"];
  split: SplitSummary;
  splitClaim: OwnSplitClaim;
}
/** One plain word for a fee's standing, shared by every view. */
export const feeStanding = (fee: Fee) =>
  fee.liabilityState === "removed_after_change" ||
  fee.liabilityState === "removed_before_cutoff" ||
  fee.liabilityState === "removed_session_cancelled"
    ? "Removed"
    : fee.liabilityState === "released_unpaid"
      ? "Released"
      : fee.liabilityState === "waived"
        ? "Waived"
        : fee.markedPaid
          ? "Paid"
          : fee.totalMinor === 0
            ? "Nothing due"
            : "Unpaid";
/**
 * "I've sent it": the player's own hint that they paid the organizer. Never
 * proof of payment and never part of the fee, the spot or any email.
 */
export interface PaymentNote {
  reference: string | null;
  sentAt: string;
}
export interface OwnParty {
  id: string;
  state: "confirmed" | "waitlisted" | "withdrawn" | "removed";
  seats: number;
  primaryName: string;
  guestName: string;
  queuePosition: number | null;
  consentVersion: number;
  freeWithdrawalAfterChange?: boolean;
  withdrawnAt: string | null;
  fee: Fee | null;
  /** Their own note, or null; only booked people in "Pay the organizer" can have one. */
  paymentNote?: PaymentNote | null;
  splitClaim?: OwnSplitClaim;
  splitHistory?: OwnSplitChange[];
}
/** Shown only to organizers/co-hosts and the session's booked people. */
export interface PaymentInstructions {
  text: string;
  hasImage: boolean;
  /** Changes whenever the instructions change, so a stale image is refetched. */
  imageRevision: number;
}
/** Organizer/co-host view: the revision to write against and the last change. */
export interface ManagedPaymentInstructions {
  revision: number;
  paymentInstructions: {
    text: string;
    hasImage: boolean;
    imageType: string | null;
    revision: number;
    updatedAt: string;
    updatedBy: string;
  } | null;
}
/** The kinds of email RallyPoint sends; matches the renderer in packages/email. */
export type EmailKind =
  | "joined_confirmed"
  | "joined_waitlisted"
  | "promoted"
  | "released"
  | "cancelled"
  | "instructions_changed"
  | "reminder";
/**
 * Organizer/co-host view of one email: "queued" covers waiting and sending, and
 * "sent" means the email service accepted it, not that anyone read it. The
 * reason is a safe code, or null. No address is ever included.
 */
export interface EmailStatus {
  kind: EmailKind;
  status: "queued" | "sent" | "not_confirmed" | "not_sent";
  reason: string | null;
  attempts: number;
  at: string;
}
/** Organizer/co-host view: updates withheld from too many people, and the cancellation tally. */
export interface EmailSummary {
  suppressed: Array<{
    kind: EmailKind;
    reason: "audience_limit";
    recipients: number;
    at: string;
  }>;
  cancellation: {
    queued: number;
    sent: number;
    notConfirmed: number;
    notSent: number;
  } | null;
}
/** The viewer's own latest request to join; null once accepted or never asked. */
export interface OwnJoinRequest {
  id: string;
  state: "pending" | "declined" | "cancelled" | "expired" | "session_cancelled";
  seats: 1 | 2;
  guestName: string;
  /** The details changed materially since they asked; Keep my request first. */
  needsConfirm: boolean;
  askedAt: string;
  cancelsLeft: number;
}
/**
 * Organizer/co-host view of one waiting request. Only what helps decide:
 * never an email address, no-shows, payments or a score.
 */
export interface ManagedJoinRequest {
  id: string;
  profileId: string | null;
  name: string;
  title: RosterTitle | null;
  level: SkillLevel | null;
  played: number;
  hosted: number;
  /** Sessions they were checked in at that the viewer runs or co-hosts. */
  playedWithYou: number;
  seats: 1 | 2;
  guestName: string;
  askedAt: string;
  needsConfirm: boolean;
  fitsNow: boolean;
  /** Where Accept would place them now; null when they fit. */
  waitlistPosition: number | null;
}
export interface RegistrationView {
  own: OwnParty | null;
  canManage: boolean;
  paymentInstructions?: PaymentInstructions;
  rosterAllowed: boolean;
  counts: Counts;
  split?: SplitSummary;
  /**
   * The viewer's own earlier bookings in this session (withdrawn or removed)
   * whose retained fee is still owed; empty when there are none.
   */
  earlierFees?: Array<{ currency: string; totalMinor: number }>;
  /** Organizers/co-hosts only. */
  emailSummary?: EmailSummary;
  joinRequest?: OwnJoinRequest | null;
  /** Organizers/co-hosts only: requests waiting for an answer, oldest first. */
  requests?: ManagedJoinRequest[];
  /** The viewer's own waiting invite to this session (P-38). */
  invite?: { id: string; inviterName: string } | null;
  /** Organizers/co-hosts only: everyone invited and how it went. */
  invites?: SentInvite[];
  /** Organizers/co-hosts only: the session's id, for inviting people. */
  sessionId?: string;
  roster: Array<{
    primaryName: string;
    /** The public profile to open from this name; null until they have one. */
    profileId?: string | null;
    guestName: string;
    seats: number;
    id?: string;
    state?: string;
    fee?: ManagedFee | null;
    splitClaim?: ManagedSplitClaim;
    splitUndoRequiresReview?: boolean;
    /** Organizers/co-hosts only; one entry per confirmed seat. */
    attendance?: SeatAttendance[];
    /** The badge this person chose to show, while it is still earned. */
    title?: RosterTitle | null;
    /** Organizers/co-hosts only; whether this party could be released right now. */
    releasable?: boolean;
    /** Organizers/co-hosts only; what this party said about sending payment. */
    paymentNote?: PaymentNote | null;
    /** Organizers/co-hosts only; the latest email of each kind to this party's primary. */
    emails?: EmailStatus[];
  }>;
}
import type {
  FeeMode,
  ManagedSplitClaim,
  OwnSplitChange,
  OwnSplitClaim,
  SplitSummary,
} from "./fees.ts";
import type { RosterTitle } from "./badges.ts";
import type { SkillLevel } from "./activities.ts";
import type { SentInvite } from "./contracts.ts";
