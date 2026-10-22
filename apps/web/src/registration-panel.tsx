"use client";
import { useEffect, useRef, useState } from "react";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { Notice, Pending } from "./ui";
import { feeLabel } from "@rallypoint/domain/session";
import type { SharedSession } from "@rallypoint/domain/session";
import type { RegistrationView } from "@rallypoint/domain/registration";
export function RegistrationPanel({
  event,
  onChange,
}: {
  event: SharedSession;
  onChange: () => void;
}) {
  const result = useApi<{ registration: RegistrationView }>(
    `/api/registrations/${event.slug}`,
  );
  const [changed, setChanged] = useState<RegistrationView | null>(null),
    [guest, setGuest] = useState(false),
    [guestName, setGuestName] = useState("");
  const mutation = useMutation<{ registration: RegistrationView }>((value) => {
    setChanged(value.registration);
    onChange();
  });
  const view = changed ?? result.data?.registration;
  const own = view?.own;
  const statusHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (own?.id) statusHeading.current?.focus();
  }, [own?.id, own?.state, event.state]);
  const d = event.details,
    total = (d.feeMinor ?? 0) * (guest ? 2 : 1);
  function refresh() {
    setChanged(null);
    result.retry();
    onChange();
  }
  if (result.loading && !changed)
    return <Pending>Checking your place…</Pending>;
  if (result.error && !changed)
    return <Notice retry={refresh}>{result.error}</Notice>;
  if (!view) return null;
  const joinLabel =
    view.counts.waitingParties > 0 ||
    Number(d.capacity) - view.counts.confirmedSeats < (guest ? 2 : 1)
      ? "Agree & waitlist"
      : "Agree & join";
  return (
    <section className="registration-panel" aria-label="Your registration">
      {own ? (
        <div className="own-status">
          <span className="pill">
            {event.state !== "published"
              ? "Your registration record"
              : own.state === "confirmed"
                ? "Confirmed"
                : own.state === "waitlisted"
                  ? "Waitlisted"
                  : own.state === "withdrawn"
                    ? "Withdrawn"
                    : "Removed"}
          </span>
          <h2 ref={statusHeading} tabIndex={-1}>
            {event.state !== "published"
              ? "Your previous registration"
              : own.state === "confirmed"
                ? `You have ${own.seats === 2 ? "two places" : "a place"}.`
                : own.state === "waitlisted"
                  ? `Waiting party ${own.queuePosition}`
                  : "Your previous registration"}
          </h2>
          <p>
            {own.primaryName}
            {own.seats === 2 ? ` + ${own.guestName || "one guest"}` : ""} ·{" "}
            {own.seats} {own.seats === 1 ? "seat" : "seats"}
          </p>
          {own.state === "waitlisted" ? (
            <p>
              No fee is due while waiting. Your current party position is not a
              promise of admission. The whole party stays together.
            </p>
          ) : null}
          {own.fee ? (
            <p>
              <strong>
                {own.fee.liabilityState === "removed_before_cutoff"
                  ? "Unpaid fee removed: "
                  : own.fee.markedPaid
                    ? "Fee marked paid manually: "
                    : "Amount due: "}
                {feeLabel({
                  ...d,
                  currency: own.fee.currency,
                  feeMinor: own.fee.totalMinor,
                })}
              </strong>{" "}
              · {own.fee.chargedSeats} chargeable{" "}
              {own.fee.chargedSeats === 1 ? "seat" : "seats"}.
              {own.fee.liabilityState === "removed_before_cutoff"
                ? " This allocation is kept for history; no amount is due."
                : own.state === "withdrawn"
                  ? " Your place is released. This fee remains unless an organizer explicitly waives it, even if someone fills the vacancy."
                  : ""}
              {own.fee.markedPaid
                ? " The marker is a manual record, not verification of a transfer. Any refund is arranged outside RallyPoint."
                : ""}
            </p>
          ) : null}
          {own.state === "confirmed" || own.state === "waitlisted" ? (
            event.registrationWindow !== "closed" ? (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  mutation.run(`/api/registrations/${event.slug}/withdraw`, {
                    partyId: own.id,
                  });
                }}
              >
                <fieldset disabled={mutation.busy || mutation.uncertain}>
                  <legend>
                    {own.state === "waitlisted"
                      ? "Leave the waitlist"
                      : "Withdraw your party"}
                  </legend>
                  <p id="withdraw-terms">
                    This withdraws{" "}
                    {own.seats === 2
                      ? "you and your guest together"
                      : "your whole registration"}{" "}
                    and releases your places. Before cutoff, unpaid fees are
                    removed. At or after cutoff, an existing fee remains unless
                    an organizer explicitly waives it. A waiting party may be
                    promoted before this request reaches the server; its
                    resulting fee follows the same cutoff rule. Paid records are
                    kept; any refund is arranged with the organizer outside
                    RallyPoint.
                  </p>
                  <p className="field-help">
                    Cancellation cutoff:{" "}
                    {new Date(d.cutoffAt!).toLocaleString(undefined, {
                      timeZone: d.timeZone,
                    })}{" "}
                    ({d.timeZone}). The server checks the time when processing
                    your request. Self-service withdrawal closes at start.
                  </p>
                  <button
                    className="button secondary"
                    aria-describedby="withdraw-terms"
                  >
                    {mutation.busy
                      ? "Checking withdrawal…"
                      : own.state === "waitlisted"
                        ? "Withdraw from waitlist"
                        : own.seats === 2
                          ? "Withdraw both seats"
                          : "Withdraw my place"}
                  </button>
                </fieldset>
              </form>
            ) : (
              <p>
                Self-service withdrawal is closed. Your record remains visible.
              </p>
            )
          ) : null}
        </div>
      ) : event.registrationWindow === "open" ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            mutation.run(`/api/registrations/${event.slug}`, {
              version: event.version,
              seats: guest ? 2 : 1,
              guestName: guest ? guestName : "",
              consent: true,
            });
          }}
        >
          <fieldset disabled={mutation.busy || mutation.uncertain}>
            <legend>Make room for a good time.</legend>
            {d.guests && Number(d.capacity) >= 2 ? (
              <>
                <label className="checkbox-field">
                  <input
                    type="checkbox"
                    checked={guest}
                    onChange={(e) => setGuest(e.target.checked)}
                  />
                  Bring one guest (two seats together)
                </label>
                {guest ? (
                  <label className="guest-field">
                    Guest name (optional)
                    <input
                      value={guestName}
                      onChange={(e) => setGuestName(e.target.value)}
                      maxLength={80}
                      autoComplete="off"
                    />
                  </label>
                ) : null}
              </>
            ) : null}
            <p id="join-terms">
              By choosing <strong>{joinLabel}</strong>, I agree to{" "}
              {feeLabel({ ...d, feeMinor: total })} for{" "}
              {guest ? "two seats" : "one seat"} if confirmed. If full or a
              party is waiting, I join the waitlist in order. Waiting is free;
              my whole party may be automatically confirmed before start,
              including after the cancellation cutoff, and then owes the
              published fee. New joins and waitlist entries stop at start.
            </p>
            <p className="field-help">
              Before cutoff, withdrawing removes unpaid fees; at/after cutoff an
              obligation remains unless waived. Refunds are handled outside
              RallyPoint. Self-service withdrawal closes at start.
            </p>
            {!Number.isSafeInteger(total) ? (
              <Notice>The party fee is too large to store precisely.</Notice>
            ) : null}
            <button
              className="button primary"
              aria-describedby="join-terms"
              disabled={!Number.isSafeInteger(total)}
            >
              {mutation.busy ? "Checking your place…" : joinLabel}
            </button>
          </fieldset>
        </form>
      ) : (
        <div className="own-status">
          <h2>
            {event.registrationWindow === "closed"
              ? "Registration is closed."
              : "Registration has not opened yet."}
          </h2>
          <p>
            Existing registrations stay visible. New joins and waitlist entries
            close at the session start.
          </p>
        </div>
      )}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
      <button
        className="text-button"
        disabled={mutation.busy || mutation.uncertain}
        onClick={refresh}
      >
        Refresh status and availability
      </button>
      {view.rosterAllowed ? (
        <section className="roster">
          <h2>{view.canManage ? "Organizer roster" : "Who’s confirmed"}</h2>
          {view.roster.length ? (
            <ul>
              {view.roster.map((p, i) => (
                <li key={p.id ?? i}>
                  <div>
                    <strong>{p.primaryName}</strong>
                    {p.seats === 2 ? ` + ${p.guestName || "one guest"}` : ""}
                  </div>
                  <span>
                    {p.seats} {p.seats === 1 ? "seat" : "seats"}
                    {p.state ? ` · ${p.state}` : ""}
                  </span>
                  {view.canManage && p.fee ? (
                    <span>
                      {p.fee.liabilityState === "removed_before_cutoff"
                        ? "Unpaid fee removed: "
                        : p.fee.markedPaid
                          ? "Marked paid manually: "
                          : "Amount due: "}
                      {feeLabel({
                        ...d,
                        currency: p.fee.currency,
                        feeMinor: p.fee.totalMinor,
                      })}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No registrations yet.</p>
          )}
        </section>
      ) : (
        <p className="field-help">
          The display-name roster is available to confirmed participants. Other
          people’s fee and attendance history stays private.
        </p>
      )}
    </section>
  );
}
