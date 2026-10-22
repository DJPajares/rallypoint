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
                      This withdraws{" "}
                      {own.seats === 2
                        ? "you and your guest together"
                        : "your whole registration"}{" "}
                      and releases your places. Before cutoff, unpaid fees are
                      removed. At or after cutoff, an existing fee remains
                      unless an organizer explicitly waives it. A waiting party
                      may be promoted before this request reaches the server;
                      its resulting fee follows the same cutoff rule. Paid
                      records are kept; any refund is arranged with the
                      organizer outside RallyPoint.
                    </p>
                    <p className="rp-help">
                      Cancellation cutoff:{" "}
                      {new Date(d.cutoffAt!).toLocaleString(undefined, {
                        timeZone: d.timeZone,
                      })}{" "}
                      ({d.timeZone}). The server checks the time when processing
                      your request. Self-service withdrawal closes at start.
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
              <p>
                Self-service withdrawal is closed. Your record remains visible.
              </p>
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
              <legend>Make room for a good time.</legend>
              {d.guests && Number(d.capacity) >= 2 ? (
                <>
                  <CheckField
                    checked={guest}
                    onChange={(e) => setGuest(e.target.checked)}
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
                By choosing <strong>{joinLabel}</strong>, I agree to{" "}
                {feeLabel({ ...d, feeMinor: total })} for{" "}
                {guest ? "two seats" : "one seat"} if confirmed. If full or a
                party is waiting, I join the waitlist in order. Waiting is free;
                my whole party may be automatically confirmed before start,
                including after the cancellation cutoff, and then owes the
                published fee. New joins and waitlist entries stop at start.
              </p>
              <p className="rp-help">
                Before cutoff, withdrawing removes unpaid fees; at/after cutoff
                an obligation remains unless waived. Refunds are handled outside
                RallyPoint. Self-service withdrawal closes at start.
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
            <p>
              Existing registrations stay visible. New joins and waitlist
              entries close at the session start.
            </p>
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
        Refresh status and availability
      </button>
      {view.rosterAllowed ? (
        <section className="rp-card roster">
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
        <p className="rp-help">
          The display-name roster is available to confirmed participants. Other
          people’s fee and attendance history stays private.
        </p>
      )}
    </section>
  );
}
