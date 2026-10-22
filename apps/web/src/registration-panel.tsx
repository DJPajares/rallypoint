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
import { SplitFee } from "./split-fee";
import { splitMoney } from "@rallypoint/domain/fees";
import { SplitControls } from "./split-controls";
import { HowToPay } from "./payment-instructions";
import { GameDay } from "./game-day";
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
import { TitlePill } from "./badges";
import type { Tone } from "@rallypoint/ui";
import { feeLabel } from "@rallypoint/domain/session";
import type { SharedSession } from "@rallypoint/domain/session";
import { feeStanding } from "@rallypoint/domain/registration";
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
  const [undoPartyId, setUndoPartyId] = useState<string | undefined>();
  const mutation = useMutation<{ registration: RegistrationView }>((value) => {
    setSheetOpen(false);
    setChanged(value.registration);
    onChange();
  });
  const view = changed ?? result.data?.registration;
  const own = view?.own;
  const statusHeading = useRef<HTMLHeadingElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
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
  // Only decides whether to offer no-show; the server checks its own clock.
  const ended = !!d.endsAt && now >= Date.parse(d.endsAt);
  const split = view.split ?? event.split;
  const cutoffTerms = d.cutoffAt
    ? `Cancel before ${when(d.cutoffAt)} and no fee is due; after that, your ${split ? "share" : "fee"} stays unless the organizer waives it.`
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
            className={buttonClass({
              // Organizers share first; joining is something they may also do.
              variant: view?.canManage ? "secondary" : tone,
            })}
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
          >
            {mutation.uncertain ? "Check your request" : triggerLabel}
          </button>
          <ShareButton title={d.title} primary={view?.canManage} />
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
          {event.state === "published" && own.state === "waitlisted" ? (
            <p>
              Waiting is free. If places open before the start, your party moves
              in automatically and{" "}
              {split
                ? "your seats count toward the final split."
                : "the fee applies."}
            </p>
          ) : null}
          {split && own.splitClaim ? (
            <SplitFee
              summary={split}
              claim={own.splitClaim}
              fee={own.fee}
              history={own.splitHistory}
              cancelled={event.state === "cancelled"}
            />
          ) : own.fee ? (
            <p>
              <strong>
                {own.fee.liabilityState === "removed_before_cutoff" ||
                own.fee.liabilityState === "removed_session_cancelled"
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
              {own.fee.liabilityState === "removed_session_cancelled"
                ? " · This session was cancelled, so nothing is due."
                : own.fee.liabilityState === "removed_before_cutoff"
                  ? " · You withdrew before the cutoff, so nothing is due."
                  : own.fee.liabilityState === "waived"
                    ? " · Nothing is due."
                    : own.state === "withdrawn" && !own.fee.markedPaid
                      ? " · The fee stays unless the organizer waives it."
                      : ""}
            </p>
          ) : null}
          {view.paymentInstructions ? (
            <HowToPay
              slug={event.slug}
              instructions={view.paymentInstructions}
            />
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
              {split ? (
                <>
                  <p>
                    <strong>
                      Estimated share if confirmed now:{" "}
                      {split.prospectivePartyMinor
                        ? splitMoney(
                            split.currency,
                            guest
                              ? (split.prospectivePartyMinor.two ??
                                  split.prospectivePartyMinor.one)
                              : split.prospectivePartyMinor.one,
                          )
                        : "Awaiting the organizer’s split"}
                    </strong>
                  </p>
                  <p id="join-terms">
                    By choosing <strong>{joinLabel}</strong>, I agree to my
                    party’s final share of{" "}
                    {splitMoney(split.currency, split.totalMinor)}. It can
                    change until the organizer finalizes after start, up to the
                    full total if my party is the only payer left. A guest
                    counts as another seat. Waiting is free; promotion before
                    start includes our seats in the split. {cutoffTerms}
                  </p>
                </>
              ) : (
                <p id="join-terms">
                  By choosing <strong>{joinLabel}</strong>, I agree to pay{" "}
                  {feeLabel({ ...d, feeMinor: total })} for{" "}
                  {guest ? "two seats" : "one seat"} if I get a place. If it’s
                  full, I join the waitlist for free; if a place opens before
                  the start, I’m moved in automatically and the fee applies.{" "}
                  {cutoffTerms}
                </p>
              )}
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
      {event.state !== "cancelled" && view.canManage && split ? (
        <SplitControls
          slug={event.slug}
          onDone={(value) => {
            setChanged(value);
            onChange();
          }}
          refreshKey={view.roster
            .map((p) => `${p.id}:${p.fee?.revision}:${p.splitClaim?.revision}`)
            .join(",")}
          undoPartyId={undoPartyId}
          onUndoDone={() => setUndoPartyId(undefined)}
          partyNames={Object.fromEntries(
            view.roster
              .filter((p) => p.id)
              .map((p) => [
                p.id!,
                p.primaryName +
                  (p.seats === 2 ? ` + ${p.guestName || "guest"}` : ""),
              ]),
          )}
        />
      ) : null}
      {view.canManage && event.state !== "cancelled" ? (
        <GameDay
          slug={event.slug}
          view={view}
          ended={ended}
          when={when}
          splitCurrency={split?.currency}
          onDone={(value) => {
            setChanged(value);
            onChange();
          }}
          onUndoReview={setUndoPartyId}
        />
      ) : view.rosterAllowed ? (
        <section className="rp-card roster">
          <h2>
            {event.state === "cancelled"
              ? "Registration records"
              : "Who’s confirmed"}
          </h2>
          {view.roster.length ? (
            <ul>
              {view.roster.map((p, i) => (
                <li key={p.id ?? i}>
                  <div id={p.id ? `party-${p.id}` : undefined}>
                    <strong>{p.primaryName}</strong>
                    {p.seats === 2 ? ` + ${p.guestName || "one guest"}` : ""}
                    {p.title ? <TitlePill title={p.title} /> : null}
                  </div>
                  <span>
                    {p.seats} {p.seats === 1 ? "seat" : "seats"}
                    {p.state ? ` · ${p.state}` : ""}
                  </span>
                  {event.state === "cancelled" && view.canManage && p.fee ? (
                    <p>
                      {feeStanding(p.fee)} ·{" "}
                      {feeLabel({
                        currency: p.fee.currency,
                        feeMinor: p.fee.totalMinor,
                      })}
                    </p>
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
