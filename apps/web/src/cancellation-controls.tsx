"use client";
import { useEffect, useState } from "react";
import { buttonClass, Notice, Pending, Sheet } from "@rallypoint/ui";
import type { SessionRecord } from "@rallypoint/domain/session";
import { feeLabel } from "@rallypoint/domain/session";
import { feeStanding } from "@rallypoint/domain/registration";
import type { RegistrationView } from "@rallypoint/domain/registration";
import { useMutation } from "./use-mutation";
import { useApi } from "./use-api";

export function CancelSession({
  record,
  saving,
  onPending,
  onDone,
}: {
  record: SessionRecord;
  saving: boolean;
  onPending: (pending: boolean) => void;
  onDone: (record: SessionRecord) => void;
}) {
  const [open, setOpen] = useState(false);
  // "Not tracked here" has no fees or payment records to speak of.
  const tracked = (record.details.paymentMode ?? "organizer") === "organizer";
  const mutation = useMutation<{ session: SessionRecord }>((value) => {
    setOpen(false);
    onDone(value.session);
  });
  useEffect(() => {
    onPending(mutation.busy || mutation.uncertain);
  }, [mutation.busy, mutation.uncertain, onPending]);
  return (
    <section className="rp-card" aria-label="Cancel session">
      <button
        type="button"
        className={buttonClass()}
        disabled={saving || mutation.busy || mutation.uncertain}
        onClick={() => setOpen(true)}
      >
        Cancel session
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Cancel this session?"
      >
        <p>
          This can’t be undone. No one can join or withdraw, and the waitlist
          stops.
        </p>
        {tracked ? (
          <p>
            Unpaid fees stop being due. Paid records stay; arrange any refund
            outside RallyPoint.
          </p>
        ) : null}
        <div className="fee-actions">
          <button
            type="button"
            className={buttonClass()}
            disabled={mutation.busy || mutation.uncertain}
            onClick={() => setOpen(false)}
          >
            Keep session
          </button>
          <button
            type="button"
            className={buttonClass({ variant: "primary" })}
            disabled={saving || mutation.busy || mutation.uncertain}
            onClick={() =>
              mutation.run(`/api/sessions/${record.id}/cancel`, {})
            }
          >
            {mutation.busy ? "Cancelling…" : "Yes, cancel session"}
          </button>
        </div>
        {mutation.error ? <Notice>{mutation.error}</Notice> : null}
        {mutation.recovery}
      </Sheet>
      {!open && mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {!open ? mutation.recovery : null}
    </section>
  );
}

/** A cancelled session keeps its entitled organizer records, with no actions. */
export function CancelledRoster({ slug }: { slug: string }) {
  const result = useApi<{ registration: RegistrationView }>(
    `/api/registrations/${slug}`,
  );
  if (result.loading) return <Pending>Opening registration records…</Pending>;
  if (result.error) return <Notice retry={result.retry}>{result.error}</Notice>;
  if (!result.data?.registration.canManage) return null;
  const roster = result.data.registration.roster;
  return (
    <section className="rp-card roster">
      <h2>Registration records</h2>
      {roster.length ? (
        <ul>
          {roster.map((p) => (
            <li key={p.id}>
              <strong>
                {p.primaryName}
                {p.seats === 2 ? ` + ${p.guestName || "guest"}` : ""}
              </strong>
              <span>
                {p.seats} {p.seats === 1 ? "seat" : "seats"} · Previously{" "}
                {p.state}
              </span>
              {p.fee ? (
                <span>
                  {feeStanding(p.fee)} ·{" "}
                  {feeLabel({
                    currency: p.fee.currency,
                    feeMinor: p.fee.totalMinor,
                  })}
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p>No registrations.</p>
      )}
    </section>
  );
}
