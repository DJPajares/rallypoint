export interface Counts {
  confirmedSeats: number;
  waitingParties: number;
}
export interface Fee {
  currency: string;
  unitMinor: number;
  chargedSeats: number;
  totalMinor: number;
}
export interface OwnParty {
  id: string;
  state: "confirmed" | "waitlisted" | "withdrawn" | "removed";
  seats: number;
  primaryName: string;
  guestName: string;
  queuePosition: number | null;
  consentVersion: number;
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
    fee?: { currency: string; totalMinor: number } | null;
  }>;
}
