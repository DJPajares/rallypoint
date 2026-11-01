"use client";
import { splitMoney } from "@rallypoint/domain/fees";
import { feeStanding } from "@rallypoint/domain/registration";
import type { Fee } from "@rallypoint/domain/registration";
import type {
  OwnSplitChange,
  OwnSplitClaim,
  SplitSummary,
} from "@rallypoint/domain/fees";
export function SplitFee({
  summary,
  claim,
  fee,
  history = [],
  cancelled = false,
}: {
  summary: SplitSummary;
  claim?: OwnSplitClaim;
  fee?: Fee | null;
  history?: OwnSplitChange[];
  cancelled?: boolean;
}) {
  const money = (n: number) => splitMoney(summary.currency, n);
  const status = fee
    ? feeStanding(fee)
    : claim?.waived
      ? "Waived"
      : claim && !claim.eligible
        ? "Removed"
        : summary.phase === "estimating"
          ? "Estimated share"
          : claim
            ? "No amount due"
            : "Session cost";
  return (
    <div className="grid min-w-0 gap-3 [&_p]:m-0 [&_summary]:cursor-pointer [&_summary]:font-medium">
      <p>
        <strong>
          {status}
          {fee
            ? ` · ${money(fee.totalMinor)}`
            : claim?.eligible &&
                !claim.waived &&
                claim.estimateMinor !== null &&
                claim.estimateMinor !== undefined
              ? ` · ${money(claim.estimateMinor)}`
              : ""}
        </strong>
      </p>
      {!cancelled &&
      summary.phase === "estimating" &&
      (!claim || (claim.eligible && !claim.waived)) ? (
        <p className="mt-1 mb-0 text-sm text-text-muted">
          {summary.payingSeats === 0 ? "No split yet. " : ""}
          {money(summary.totalMinor)} total · {summary.payingSeats} paying{" "}
          {summary.payingSeats === 1 ? "seat" : "seats"}, including retained
          cancellations. Shares can change until the organizer finalizes after
          start.
        </p>
      ) : null}
      {claim?.waived || (claim && !claim.eligible) ? (
        <p className="mt-1 mb-0 text-sm text-text-muted">
          Nothing is due for this party.
        </p>
      ) : null}
      {!cancelled && !claim && summary.estimatedSeatRange ? (
        <p className="mt-1 mb-0 text-sm text-text-muted">
          Current estimate per seat:{" "}
          {money(summary.estimatedSeatRange.minMinor)}
          {summary.estimatedSeatRange.minMinor !==
          summary.estimatedSeatRange.maxMinor
            ? `–${money(summary.estimatedSeatRange.maxMinor)}`
            : ""}
          .
        </p>
      ) : null}
      {!cancelled && !claim && summary.phase !== "estimating" ? (
        <p className="mt-1 mb-0 text-sm text-text-muted">
          {money(summary.totalMinor)} total · {summary.payingSeats} paying
          seats.{" "}
          {summary.phase === "unallocated"
            ? "No split yet."
            : "Split finalized."}
        </p>
      ) : null}
      {fee?.markedPaid ? (
        <p className="mt-1 mb-0 text-sm text-text-muted">
          Marked paid by the organizer.
        </p>
      ) : null}
      {history.length ? (
        <details>
          <summary>Your amount changes</summary>
          <ul className="grid list-none gap-3 p-0 [&_li]:wrap-anywhere [&_ul]:list-disc [&_ul]:pl-4">
            {history.map((h, i) => (
              <li key={`${h.at}:${i}`}>
                {h.previousMinor === null
                  ? "No previous share"
                  : money(h.previousMinor)}{" "}
                → {h.currentMinor === null ? "No share" : money(h.currentMinor)}{" "}
                ·{" "}
                {
                  {
                    total_reduced: "Session cost reduced",
                    waiver_redistributed: "Split updated after a waiver",
                    waiver_restored:
                      "Split updated after a waiver was restored",
                  }[h.kind]
                }
                <br />
                <time dateTime={h.at}>{new Date(h.at).toLocaleString()}</time>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}
