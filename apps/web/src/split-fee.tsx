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
}: {
  summary: SplitSummary;
  claim?: OwnSplitClaim;
  fee?: Fee | null;
  history?: OwnSplitChange[];
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
    <div className="split-fee">
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
      {summary.phase === "estimating" &&
      (!claim || (claim.eligible && !claim.waived)) ? (
        <p className="rp-help">
          {summary.payingSeats === 0 ? "No split yet. " : ""}
          {money(summary.totalMinor)} total · {summary.payingSeats} paying{" "}
          {summary.payingSeats === 1 ? "seat" : "seats"}, including retained
          cancellations. Shares can change until the organizer finalizes after
          start.
        </p>
      ) : null}
      {claim?.waived || (claim && !claim.eligible) ? (
        <p className="rp-help">Nothing is due for this party.</p>
      ) : null}
      {!claim && summary.estimatedSeatRange ? (
        <p className="rp-help">
          Current estimate per seat:{" "}
          {money(summary.estimatedSeatRange.minMinor)}
          {summary.estimatedSeatRange.minMinor !==
          summary.estimatedSeatRange.maxMinor
            ? `–${money(summary.estimatedSeatRange.maxMinor)}`
            : ""}
          .
        </p>
      ) : null}
      {!claim && summary.phase !== "estimating" ? (
        <p className="rp-help">
          {money(summary.totalMinor)} total · {summary.payingSeats} paying
          seats.{" "}
          {summary.phase === "unallocated"
            ? "No split yet."
            : "Split finalized."}
        </p>
      ) : null}
      {fee?.markedPaid ? (
        <p className="rp-help">Marked paid by the organizer.</p>
      ) : null}
      {history.length ? (
        <details>
          <summary>Your amount changes</summary>
          <ul className="split-history">
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
