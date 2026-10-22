export interface Counts {
  confirmedSeats: number;
  waitingParties: number;
}
export interface Fee {
  currency: string;
  unitMinor: number;
  chargedSeats: number;
  totalMinor: number;
  liabilityState: "due" | "removed_before_cutoff";
  removedAt: string | null;
  markedPaid: boolean;
}
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
    fee?: Fee | null;
  }>;
}
