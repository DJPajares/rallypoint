import { InputError } from "./session.ts";

export type FeeMode = "fixed" | "split";
export interface SplitParty {
  partyId: string;
  queueSequence: string;
  seats: 1 | 2;
}
export interface SplitSeat {
  partyId: string;
  seat: 1 | 2;
  amountMinor: number;
}
export interface SplitPartyAmount {
  partyId: string;
  chargedSeats: 1 | 2;
  totalMinor: number;
}
export interface SplitAllocation {
  state: "allocated" | "unallocated";
  totalMinor: number;
  payingSeats: number;
  unallocatedMinor: number;
  seats: SplitSeat[];
  parties: SplitPartyAmount[];
}
export interface SplitSummary {
  phase: "estimating" | "finalized" | "unallocated";
  currency: string;
  totalMinor: number;
  payingSeats: number;
  estimatedSeatRange: { minMinor: number; maxMinor: number } | null;
  prospectivePartyMinor: { one: number; two: number | null } | null;
}
export interface OwnSplitClaim {
  eligible: boolean;
  waived: boolean;
  estimateMinor: number | null;
}
export interface ManagedSplitClaim extends OwnSplitClaim {
  revision: number;
}
export interface OwnSplitChange {
  previousMinor: number | null;
  currentMinor: number | null;
  at: string;
  kind: "total_reduced" | "waiver_redistributed" | "waiver_restored";
}
export type SplitPreviewInput =
  | { intent: "finalize" }
  | { intent: "correct"; totalMinor: number; undoWaiverPartyId?: string };
export interface SplitPreviewParty extends SplitPartyAmount {
  previousMinor: number | null;
  markedPaid: boolean;
  primaryName: string;
  guestName: string;
  changes: OwnSplitChange[];
}
export interface SplitPreview extends Omit<SplitAllocation, "parties"> {
  basis: string;
  currency: string;
  currentRunId: string | null;
  blockedPaidPartyIds: string[];
  parties: SplitPreviewParty[];
}
export interface ManagedSplitView {
  summary: SplitSummary;
  currentRunId: string | null;
  revision: number;
  uncoveredMinor: number;
  history: Array<{
    runId: string;
    totalMinor: number;
    currency: string;
    payingSeats: number;
    by: string;
    at: string;
    reason: string;
    parties: Array<{
      partyId: string;
      previousMinor: number | null;
      currentMinor: number | null;
    }>;
  }>;
}
export function feeModeOf(details: { feeMode?: unknown }): FeeMode {
  if (details.feeMode === undefined) return "fixed";
  if (details.feeMode === "fixed" || details.feeMode === "split")
    return details.feeMode;
  throw new InputError("Choose a fee per seat or a total to split.");
}
function money(total: number) {
  if (!Number.isSafeInteger(total) || total < 0)
    throw new InputError(
      "The session cost must be a precise nonnegative amount.",
    );
}
export function allocateSplit(
  totalMinor: number,
  parties: readonly SplitParty[],
): SplitAllocation {
  money(totalMinor);
  if (!Array.isArray(parties)) throw new InputError("Check the paying seats.");
  const ids = new Set<string>();
  let count = 0;
  for (const party of parties) {
    if (
      !party ||
      typeof party.partyId !== "string" ||
      !party.partyId ||
      ids.has(party.partyId) ||
      ![1, 2].includes(party.seats) ||
      typeof party.queueSequence !== "string" ||
      !/^(0|[1-9]\d*)$/.test(party.queueSequence)
    )
      throw new InputError("Check the paying seats and their order.");
    ids.add(party.partyId);
    count += party.seats;
    if (!Number.isSafeInteger(count))
      throw new InputError("There are too many paying seats.");
  }
  const result: SplitAllocation = {
    state: count ? "allocated" : "unallocated",
    totalMinor,
    payingSeats: count,
    unallocatedMinor: count ? 0 : totalMinor,
    seats: [],
    parties: [],
  };
  if (!count) return result;
  const amount = BigInt(totalMinor),
    divisor = BigInt(count);
  const base = amount / divisor,
    remainder = amount % divisor;
  const ordered = [...parties].sort((a, b) => {
    const left = BigInt(a.queueSequence),
      right = BigInt(b.queueSequence);
    return left < right
      ? -1
      : left > right
        ? 1
        : a.partyId < b.partyId
          ? -1
          : a.partyId > b.partyId
            ? 1
            : 0;
  });
  let index = 0n;
  for (const party of ordered) {
    let total = 0n;
    for (let seat = 1; seat <= party.seats; seat++) {
      const minor = base + (index++ < remainder ? 1n : 0n);
      result.seats.push({
        partyId: party.partyId,
        seat: seat as 1 | 2,
        amountMinor: Number(minor),
      });
      total += minor;
    }
    result.parties.push({
      partyId: party.partyId,
      chargedSeats: party.seats,
      totalMinor: Number(total),
    });
  }
  return result;
}
export function estimateNextParty(
  totalMinor: number,
  payingSeats: number,
  seats: 1 | 2,
): number {
  money(totalMinor);
  if (
    !Number.isSafeInteger(payingSeats) ||
    payingSeats < 0 ||
    ![1, 2].includes(seats) ||
    !Number.isSafeInteger(payingSeats + seats)
  )
    throw new InputError("Check the paying seats.");
  const divisor = BigInt(payingSeats + seats),
    total = BigInt(totalMinor);
  const base = total / divisor,
    remainder = total % divisor;
  let result = 0n;
  for (let i = 0; i < seats; i++)
    result += base + (BigInt(payingSeats + i) < remainder ? 1n : 0n);
  return Number(result);
}
