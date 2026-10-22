import { useEffect, useRef, useState } from "react";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { Notice, Pending } from "./ui";
import { feeLabel } from "./shared/session";
import type { SharedSession } from "./shared/session";
import type { RegistrationView } from "./shared/registration";
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
        <div className="own-status" role="status">
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
                Amount due: {feeLabel({ ...d, feeMinor: own.fee.totalMinor })}
              </strong>{" "}
              · {own.fee.chargedSeats} chargeable{" "}
              {own.fee.chargedSeats === 1 ? "seat" : "seats"}. Payment markers
              and withdrawal controls come in the next increments; no transfer
              is verified here.
            </p>
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
              RallyPoint. Withdrawal controls are not available in this build
              yet.
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
                      Amount due:{" "}
                      {feeLabel({ ...d, feeMinor: p.fee.totalMinor })}
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
