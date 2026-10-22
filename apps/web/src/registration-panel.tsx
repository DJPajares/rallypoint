"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { useIsPhone } from "./frame";
import { ShareButton } from "./share-button";
import { FeeControls } from "./fee-controls";
import {
  buttonClass,
  CheckField,
  Field,
  Notice,
  Pending,
  Sheet,
  StatusBanner,
} from "@rallypoint/ui";
import { StickyActions } from "./ui";
import type { Tone } from "@rallypoint/ui";
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
  // On phones the join/withdraw form lives in a sheet. It closes before the
  // new status heading takes focus (the sheet is a child, so its effect runs
  // first and hands focus back before this panel moves it to the heading).
  const phone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const mutation = useMutation<{ registration: RegistrationView }>((value) => {
    setSheetOpen(false);
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
  // Times read in the session's own local time, never with a zone label (D-13).
  const when = (iso: string) =>
    new Intl.DateTimeFormat("en", {
      timeZone: d.timeZone,
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(iso));
  const cutoffTerms = d.cutoffAt
    ? `Cancel before ${when(d.cutoffAt)} and no fee is due; after that, the fee stays unless the organizer waives it.`
    : "";
  const ownTone: Tone =
    event.state !== "published" || !own
      ? "neutral"
      : own.state === "confirmed"
        ? "success"
        : own.state === "waitlisted"
          ? "warning"
          : "neutral";
  const ownIcon =
    ownTone === "success" ? (
      <CheckCircleIcon size={22} />
    ) : ownTone === "warning" ? (
      <HourglassIcon size={22} />
    ) : (
      <LockSimpleIcon size={22} />
    );
  const hasAction = own
    ? (own.state === "confirmed" || own.state === "waitlisted") &&
      event.registrationWindow !== "closed"
    : event.registrationWindow === "open";
  /**
   * The form, its error and its recovery stay together. Larger screens show
   * them inline; a phone keeps them in a sheet opened from the sticky bar, so
   * the fee terms are always read before the final button. Rendered in one
   * place only, so ids like join-terms stay unique.
   */
  function actionArea(
    sheetTitle: string,
    triggerLabel: string,
    form: ReactNode,
    tone: "primary" | "secondary",
  ) {
    const body = (
      <>
        {form}
        {mutation.error ? <Notice>{mutation.error}</Notice> : null}
        {mutation.recovery}
      </>
    );
    if (!phone) return <div className="action-area">{body}</div>;
    return (
      <>
        <StickyActions>
          <button
            type="button"
            className={buttonClass({ variant: tone })}
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
          >
            {mutation.uncertain ? "Check your request" : triggerLabel}
          </button>
          <ShareButton title={d.title} />
        </StickyActions>
        <Sheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          title={sheetTitle}
        >
          {body}
        </Sheet>
      </>
    );
  }
  return (
    <section className="registration-panel" aria-label="Your registration">
      {own ? (
        <div className="own-status">
          <StatusBanner tone={ownTone} icon={ownIcon}>
            <span className="rp-badge rp-badge--inherit">
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
              {own.seats === 2
                ? ` + ${own.guestName || "one guest"}`
                : ""} · {own.seats} {own.seats === 1 ? "seat" : "seats"}
            </p>
          </StatusBanner>
          {own.state === "waitlisted" ? (
            <p>
              Waiting is free. If places open before the start, your party moves
              in automatically and the fee applies.
            </p>
          ) : null}
          {own.fee ? (
            <p>
              <strong>
                {own.fee.liabilityState === "removed_before_cutoff"
                  ? "Fee removed: "
                  : own.fee.liabilityState === "waived"
                    ? "Fee waived by the organizer: "
                    : own.fee.markedPaid
                      ? "Marked paid by the organizer: "
                      : "Amount due: "}
                {feeLabel({
                  currency: own.fee.currency,
                  feeMinor: own.fee.totalMinor,
                })}
              </strong>{" "}
              {own.fee.liabilityState === "removed_before_cutoff"
                ? " · You withdrew before the cutoff, so nothing is due."
                : own.fee.liabilityState === "waived"
                  ? " · Nothing is due."
                  : own.state === "withdrawn" && !own.fee.markedPaid
                    ? " · The fee stays unless the organizer waives it."
                    : ""}
            </p>
          ) : null}
          {own.state === "confirmed" || own.state === "waitlisted" ? (
            event.registrationWindow !== "closed" ? (
              actionArea(
                own.state === "waitlisted" ? "Leave the waitlist" : "Withdraw",
                own.state === "waitlisted"
                  ? "Leave waitlist"
                  : own.seats === 2
                    ? "Withdraw both seats"
                    : "Withdraw my place",
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
                      {own.seats === 2
                        ? "You and your guest leave together."
                        : "Your place is released."}{" "}
                      {cutoffTerms}
                    </p>
                    <button
                      className={buttonClass()}
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
                </form>,
                "secondary",
              )
            ) : (
              <p>You can no longer withdraw here.</p>
            )
          ) : null}
        </div>
      ) : event.registrationWindow === "open" ? (
        actionArea(
          "Join this session",
          view.counts.waitingParties > 0 ||
            Number(d.capacity) - view.counts.confirmedSeats < 1
            ? "Join the waitlist"
            : "Join",
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
              <legend>Join this session</legend>
              {d.guests && Number(d.capacity) >= 2 ? (
                <>
                  <CheckField
                    checked={guest}
                    onCheckedChange={setGuest}
                    disabled={mutation.busy || mutation.uncertain}
                  >
                    Bring one guest (two seats together)
                  </CheckField>
                  {guest ? (
                    <Field id="guest-name" label="Guest name (optional)">
                      <input
                        id="guest-name"
                        value={guestName}
                        onChange={(e) => setGuestName(e.target.value)}
                        maxLength={80}
                        autoComplete="off"
                      />
                    </Field>
                  ) : null}
                </>
              ) : null}
              <p id="join-terms">
                By choosing <strong>{joinLabel}</strong>, I agree to pay{" "}
                {feeLabel({ ...d, feeMinor: total })} for{" "}
                {guest ? "two seats" : "one seat"} if I get a place. If it’s
                full, I join the waitlist for free; if a place opens before the
                start, I’m moved in automatically and the fee applies.{" "}
                {cutoffTerms}
              </p>
              {!Number.isSafeInteger(total) ? (
                <Notice>The party fee is too large to store precisely.</Notice>
              ) : null}
              <button
                className={buttonClass({ variant: "primary" })}
                aria-describedby="join-terms"
                disabled={!Number.isSafeInteger(total)}
              >
                {mutation.busy ? "Checking your place…" : joinLabel}
              </button>
            </fieldset>
          </form>,
          "primary",
        )
      ) : (
        <div className="own-status">
          <StatusBanner tone="neutral" icon={<LockSimpleIcon size={22} />}>
            <h2>
              {event.registrationWindow === "closed"
                ? "Registration is closed."
                : "Registration has not opened yet."}
            </h2>
            {event.registrationWindow !== "closed" && d.opensAt ? (
              <p>Opens {when(d.opensAt)}.</p>
            ) : null}
          </StatusBanner>
        </div>
      )}
      {!hasAction && mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {!hasAction ? mutation.recovery : null}
      <button
        className={buttonClass({ variant: "link" })}
        disabled={mutation.busy || mutation.uncertain}
        onClick={refresh}
      >
        <ArrowsClockwiseIcon size={18} aria-hidden="true" />
        Refresh
      </button>
      {view.rosterAllowed ? (
        <section className="rp-card roster">
          <h2>{view.canManage ? "Organizer roster" : "Who’s confirmed"}</h2>
          {view.roster.length ? (
            <ul>
              {view.roster.map((p, i) => (
                <li key={p.id ?? i}>
                  <div id={p.id ? `party-${p.id}` : undefined}>
                    <strong>{p.primaryName}</strong>
                    {p.seats === 2 ? ` + ${p.guestName || "one guest"}` : ""}
                  </div>
                  <span>
                    {p.seats} {p.seats === 1 ? "seat" : "seats"}
                    {p.state ? ` · ${p.state}` : ""}
                  </span>
                  {view.canManage && p.id && p.fee ? (
                    <FeeControls
                      slug={event.slug}
                      partyId={p.id}
                      labelId={`party-${p.id}`}
                      fee={p.fee}
                      when={when}
                      onDone={setChanged}
                    />
                  ) : null}
                </li>
              ))}
            </ul>
          ) : (
            <p>No registrations yet.</p>
          )}
        </section>
      ) : null}
    </section>
  );
}
