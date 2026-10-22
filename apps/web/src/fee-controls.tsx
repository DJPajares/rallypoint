"use client";
import { buttonClass, Notice } from "@rallypoint/ui";
import { feeLabel } from "@rallypoint/domain/session";
import { feeStanding } from "@rallypoint/domain/registration";
import type {
  ManagedFee,
  PaymentAction,
  RegistrationView,
} from "@rallypoint/domain/registration";
import { useMutation } from "./use-mutation";
const changeWords: Record<ManagedFee["history"][number]["action"], string> = {
  split_corrected: "Amount corrected",
  marked_paid: "Marked paid",
  marked_unpaid: "Marked unpaid",
  waived: "Waived",
  waiver_undone: "Waiver undone",
  removed_before_cutoff: "Removed before the cutoff",
};
/**
 * One roster party's fee for organizers/co-hosts: its standing in words, the
 * last change and who made it, and the actions that apply to it now. Each
 * write names the revision shown, so a newer correction is never overwritten.
 */
export function FeeControls({
  slug,
  partyId,
  labelId,
  fee,
  when,
  onDone,
}: {
  slug: string;
  partyId: string;
  /** id of the element naming the party, so each button says whose fee it is */
  labelId: string;
  fee: ManagedFee;
  when: (iso: string) => string;
  onDone: (view: RegistrationView) => void;
}) {
  const mutation = useMutation<{ registration: RegistrationView }>((value) =>
    onDone(value.registration),
  );
  const last = fee.history[0];
  const actions: Array<[PaymentAction, string]> =
    fee.liabilityState === "waived"
      ? [["undo_waiver", "Undo waiver"]]
      : fee.liabilityState !== "due"
        ? []
        : fee.markedPaid
          ? [["mark_unpaid", "Mark unpaid"]]
          : [
              ["mark_paid", "Mark paid"],
              ["waive", "Waive fee"],
            ];
  return (
    <div className="fee-controls">
      <span>
        <strong>{feeStanding(fee)}</strong> ·{" "}
        {feeLabel({ currency: fee.currency, feeMinor: fee.totalMinor })}
      </span>
      {last ? (
        <span>
          {changeWords[last.action]} by {last.by} · {when(last.at)}
        </span>
      ) : null}
      {actions.length ? (
        <div className="fee-actions">
          {actions.map(([action, label]) => (
            <button
              key={action}
              type="button"
              className={buttonClass({ size: "sm" })}
              aria-describedby={labelId}
              disabled={mutation.busy || mutation.uncertain}
              onClick={() =>
                mutation.run(`/api/registrations/${slug}/payments`, {
                  partyId,
                  action,
                  revision: fee.revision,
                })
              }
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </div>
  );
}
