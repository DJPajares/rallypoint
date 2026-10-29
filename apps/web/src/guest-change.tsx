"use client";
import { useState } from "react";
import { buttonClass, Field, Notice } from "@rallypoint/ui";
import { feeLabel } from "@rallypoint/domain/session";
import type { SharedSession } from "@rallypoint/domain/session";
import type {
  OwnParty,
  RegistrationView,
} from "@rallypoint/domain/registration";
import { useMutation } from "./use-mutation";

/**
 * P-27: a booked player removes their +1, or adds one later. Removing frees
 * only the guest's place. Adding needs a free place and nobody waiting, so it
 * never jumps the queue; the fee applies once they agree to it.
 */
export function GuestChange({
  event,
  own,
  view,
  now,
  onDone,
}: {
  event: SharedSession;
  own: OwnParty;
  view: RegistrationView;
  now: number;
  onDone: (view: RegistrationView) => void;
}) {
  const [open, setOpen] = useState(false);
  const [guestName, setGuestName] = useState("");
  const mutation = useMutation<{ registration: RegistrationView }>((value) => {
    setOpen(false);
    setGuestName("");
    onDone(value.registration);
  });
  const busy = mutation.busy || mutation.uncertain;
  const d = event.details;
  if (
    event.state !== "published" ||
    !d.startsAt ||
    now >= Date.parse(d.startsAt) ||
    (own.state !== "confirmed" && own.state !== "waitlisted")
  )
    return null;
  const tracked = (d.paymentMode ?? "organizer") === "organizer";
  const split = tracked && d.feeMode === "split";
  const beforeCutoff = !!d.cutoffAt && now < Date.parse(d.cutoffAt);
  const fee = own.fee;
  const guest = own.guestName || "Your guest";
  const run = (body: Record<string, unknown>) =>
    mutation.run(`/api/registrations/${event.slug}/guest`, {
      partyId: own.id,
      ...body,
    });
  const status = (
    <>
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </>
  );

  if (own.seats === 2) {
    // What happens to the guest's fee, said once, before they confirm.
    const feeWords = !tracked
      ? ""
      : fee?.markedPaid
        ? "Your payment stays marked paid; sort out any refund with the organizer."
        : fee && fee.liabilityState === "due" && fee.unitMinor
          ? beforeCutoff || own.freeWithdrawalAfterChange
            ? `Their ${feeLabel({ currency: fee.currency, feeMinor: fee.unitMinor })} is dropped.`
            : `Their ${feeLabel({ currency: fee.currency, feeMinor: fee.unitMinor })} stays unless the organizer waives it.`
          : split && own.state === "confirmed" && !beforeCutoff
            ? "After the cutoff your guest’s share stays, so ask the organizer."
            : "";
    return (
      <div className="guest-change">
        {open ? (
          <>
            <p id="guest-drop-terms">
              {guest}’s place goes to the next person waiting. You keep yours.{" "}
              {feeWords}
            </p>
            <div className="fee-actions">
              <button
                type="button"
                className={buttonClass()}
                disabled={busy}
                onClick={() => setOpen(false)}
              >
                Keep my guest
              </button>
              <button
                type="button"
                className={buttonClass({ variant: "primary" })}
                aria-describedby="guest-drop-terms"
                disabled={busy}
                onClick={() => run({ action: "drop" })}
              >
                {mutation.busy ? "Removing…" : "Remove guest"}
              </button>
            </div>
          </>
        ) : (
          <button
            type="button"
            className={buttonClass({ variant: "link" })}
            onClick={() => setOpen(true)}
          >
            Remove my guest
          </button>
        )}
        {status}
      </div>
    );
  }

  // Adding: a confirmed booking, guests allowed, a free place and nobody waiting.
  const room =
    own.state === "confirmed" &&
    !!d.guests &&
    view.counts.waitingParties === 0 &&
    Number(d.capacity) - view.counts.confirmedSeats >= 1 &&
    (!tracked || split || !fee || (fee.liabilityState === "due" && !fee.markedPaid));
  if (!room) return null;
  const guestFee =
    tracked && !split && (d.feeMinor ?? 0) > 0
      ? `I agree to pay ${feeLabel({ currency: d.currency, feeMinor: d.feeMinor })} for my guest.`
      : split
        ? "My guest’s seat counts toward the final split."
        : "";
  return (
    <div className="guest-change">
      {open ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            run({
              action: "add",
              guestName,
              version: event.version,
              consent: true,
            });
          }}
        >
          <fieldset disabled={busy}>
            <legend>Add a guest</legend>
            <Field id="add-guest-name" label="Guest name (optional)">
              <input
                id="add-guest-name"
                value={guestName}
                onChange={(e) => setGuestName(e.target.value)}
                maxLength={80}
                autoComplete="off"
              />
            </Field>
            {guestFee ? <p id="guest-add-terms">{guestFee}</p> : null}
            <div className="fee-actions">
              <button
                type="button"
                className={buttonClass()}
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
              <button
                className={buttonClass({ variant: "primary" })}
                aria-describedby={guestFee ? "guest-add-terms" : undefined}
              >
                {mutation.busy
                  ? "Adding…"
                  : guestFee && !split
                    ? "Agree & add guest"
                    : "Add guest"}
              </button>
            </div>
          </fieldset>
        </form>
      ) : (
        <button
          type="button"
          className={buttonClass({ variant: "link" })}
          onClick={() => setOpen(true)}
        >
          Add a guest
        </button>
      )}
      {status}
    </div>
  );
}
