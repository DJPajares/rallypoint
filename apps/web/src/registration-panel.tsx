"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckCircleIcon } from "@phosphor-icons/react/dist/csr/CheckCircle";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { ArrowsClockwiseIcon } from "@phosphor-icons/react/dist/csr/ArrowsClockwise";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
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
import { PersonName, TitlePill } from "./badges";
import type { Tone } from "@rallypoint/ui";
import { feeLabel } from "@rallypoint/domain/session";
import type { SharedSession } from "@rallypoint/domain/session";
import { feeStanding } from "@rallypoint/domain/registration";
import { comingLine, gameDayHeadline } from "@rallypoint/domain/my-sessions";
import type {
  OwnParty,
  RegistrationView,
} from "@rallypoint/domain/registration";

/**
 * "I've sent it": the player's own hint that they paid the organizer, with an
 * optional reference. It is not a payment and changes nothing about their
 * place; the organizer still marks the fee paid. They can take it back until
 * then.
 */
function SentNote({
  slug,
  party,
  onDone,
}: {
  slug: string;
  party: OwnParty;
  onDone: (view: RegistrationView) => void;
}) {
  const [reference, setReference] = useState("");
  const box = useRef<HTMLDivElement>(null);
  const sendButton = useRef<HTMLButtonElement>(null);
  const undoButton = useRef<HTMLButtonElement>(null);
  const mutation = useMutation<{ registration: RegistrationView }>((value) => {
    setReference("");
    onDone(value.registration);
  });
  const note = party.paymentNote ?? null;
  const said = !!note;
  const wasSaid = useRef(said);
  // The button that was pressed is replaced, so focus follows to its
  // replacement. A change that arrives while focus is elsewhere leaves it be.
  useEffect(() => {
    if (said === wasSaid.current) return;
    wasSaid.current = said;
    const active = document.activeElement;
    if (active && active !== document.body && !box.current?.contains(active))
      return;
    (said ? undoButton : sendButton).current?.focus();
  }, [said]);
  const busy = mutation.busy || mutation.uncertain;
  const send = (action: "mark" | "undo") =>
    mutation.run(`/api/registrations/${slug}/payment-note`, {
      partyId: party.id,
      action,
      reference: action === "mark" ? reference : "",
    });
  return (
    <div ref={box} className="sent-note">
      {note ? (
        <>
          <p id="sent-note-text" role="status" className="sent-note__said">
            <PaperPlaneTiltIcon size={18} aria-hidden="true" />
            <span>
              You said you sent it
              {note.reference ? ` · ref ${note.reference}` : ""}
            </span>
          </p>
          <div>
            <button
              ref={undoButton}
              type="button"
              className={buttonClass({ size: "sm" })}
              aria-describedby="sent-note-text"
              disabled={busy}
              onClick={() => send("undo")}
            >
              {mutation.busy ? "Undoing…" : "Undo"}
            </button>
          </div>
        </>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            send("mark");
          }}
        >
          <fieldset disabled={busy}>
            <Field id="payment-reference" label="Payment reference (optional)">
              <input
                id="payment-reference"
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                maxLength={60}
                autoComplete="off"
              />
            </Field>
            <div>
              <button
                ref={sendButton}
                className={buttonClass()}
                aria-describedby="sent-note-help"
              >
                {mutation.busy ? "Saving…" : "I’ve sent it"}
              </button>
            </div>
            <p id="sent-note-help" className="rp-help">
              The organizer still marks it paid.
            </p>
          </fieldset>
        </form>
      )}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </div>
  );
}

/**
 * The viewer's place in a session and what they can do about it. The page
 * owns the registration read (it chooses the layout from it); every change
 * here hands the new view back through onChanged.
 */
export function RegistrationPanel({
  event,
  view,
  loading,
  error,
  onRefresh,
  onChanged,
  onChange,
  gameDay,
}: {
  event: SharedSession;
  view: RegistrationView | null;
  loading: boolean;
  error: string | null;
  /** Drops any view from a change and reads it again. */
  onRefresh: () => void;
  /** A change returned the viewer's new registration view. */
  onChanged: (view: RegistrationView) => void;
  /** Reads the shared session again. */
  onChange: () => void;
  /**
   * Set on game day for a joined player: the page's own parts, placed in
   * the order that player needs them.
   */
  gameDay?: { details: ReactNode; notes: ReactNode; more: ReactNode };
}) {
  const [guest, setGuest] = useState(false),
    [guestName, setGuestName] = useState("");
  // On phones the join/withdraw form lives in a sheet. It closes before the
  // new status heading takes focus (the sheet is a child, so its effect runs
  // first and hands focus back before this panel moves it to the heading).
  const phone = useIsPhone();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [undoPartyId, setUndoPartyId] = useState<string | undefined>();
  const [rosterOpen, setRosterOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const mutation = useMutation<{ registration: RegistrationView }>((value) => {
    setSheetOpen(false);
    onChanged(value.registration);
    onChange();
  });
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
    onRefresh();
    onChange();
  }
  // A read in flight or failed has no view, unless a change already gave one.
  if (!view) {
    const wait = loading ? (
      <Pending>Checking your place…</Pending>
    ) : error ? (
      <Notice retry={refresh}>{error}</Notice>
    ) : null;
    // On game day the time, place and notes stay put while the read is out.
    return gameDay ? (
      <section
        className="registration-panel game-day-panel"
        aria-label="Your registration"
      >
        {gameDay.details}
        {wait}
        {gameDay.notes}
      </section>
    ) : (
      wait
    );
  }
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
  // Not tracked here has no fee, cutoff or payment terms to show. A session
  // saved before payment modes behaves as Pay the organizer.
  const tracked = (d.paymentMode ?? "organizer") === "organizer";
  // A fee kept from an earlier booking in this session (withdrawn after the
  // cutoff) stays due after rejoining, until the organizer waives it.
  const earlierFees = tracked ? (view.earlierFees ?? []) : [];
  const released =
    own?.state === "removed" && own.fee?.liabilityState === "released_unpaid";
  // "I've sent it" is offered to a booked player who still owes the organizer
  // something: never once it is marked paid, waived, removed or released.
  const canSaySent =
    tracked &&
    event.state === "published" &&
    !!own &&
    (own.state === "confirmed" || own.state === "waitlisted") &&
    (own.fee
      ? own.fee.liabilityState === "due" &&
        !own.fee.markedPaid &&
        own.fee.totalMinor > 0
      : !split && (d.feeMinor ?? 0) > 0);
  // Said once, in the join step, only when the organizer turned release on and
  // only until the cutoff: whoever is confirmed after it can't be released.
  const payBy =
    tracked && d.releaseUnpaid && d.cutoffAt && now < Date.parse(d.cutoffAt)
      ? when(d.cutoffAt)
      : "";
  const cutoffTerms =
    tracked && d.cutoffAt
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
  // A player whose unpaid spot went to the waitlist, or who withdrew, can join again.
  const canJoin =
    event.registrationWindow === "open" &&
    (!own || released || own.state === "withdrawn");
  const hasAction = own
    ? ((own.state === "confirmed" || own.state === "waitlisted") &&
        event.registrationWindow !== "closed") ||
      canJoin
    : canJoin;
  // A request's error and its recovery, shown in one place only.
  const requestState = (
    <>
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </>
  );
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
    // On game day the request's error and recovery sit under the withdraw
    // area in More; a phone shows them in its sheet while that is open.
    const body = (
      <>
        {form}
        {!gameDay || (phone && sheetOpen) ? requestState : null}
      </>
    );
    if (!phone) return <div className="action-area">{body}</div>;
    // On game day the trigger waits under More, with no sticky bar.
    if (gameDay)
      return (
        <>
          <button
            type="button"
            className={buttonClass({ variant: tone })}
            aria-haspopup="dialog"
            onClick={() => setSheetOpen(true)}
          >
            {mutation.uncertain ? "Check your request" : triggerLabel}
          </button>
          <Sheet
            open={sheetOpen}
            onClose={() => setSheetOpen(false)}
            title={sheetTitle}
          >
            {body}
          </Sheet>
        </>
      );
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
  // What the player owes, and how to pay and say they sent it.
  const feeBlock = own ? (
    <>
      {split && own.splitClaim ? (
        <SplitFee
          summary={split}
          claim={own.splitClaim}
          fee={own.fee}
          history={own.splitHistory}
          cancelled={event.state === "cancelled"}
        />
      ) : released ? (
        <p>
          Your spot went to the waitlist because it wasn’t marked paid by{" "}
          {d.cutoffAt ? when(d.cutoffAt) : "the cutoff"}.
        </p>
      ) : own.fee ? (
        <p>
          <strong>
            {own.fee.liabilityState === "removed_after_change" ||
            own.fee.liabilityState === "removed_before_cutoff" ||
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
            : own.fee.liabilityState === "removed_after_change"
              ? " · The time or place changed after you booked, so nothing is due."
              : own.fee.liabilityState === "removed_before_cutoff"
                ? " · You withdrew before the cutoff, so nothing is due."
                : own.fee.liabilityState === "waived"
                  ? " · Nothing is due."
                  : own.state === "withdrawn" && !own.fee.markedPaid
                    ? " · The fee stays unless the organizer waives it."
                    : ""}
        </p>
      ) : null}
      {earlierFees.map((fee, i) => (
        <p key={i}>
          <strong>
            Still due from your earlier booking:{" "}
            {feeLabel({ currency: fee.currency, feeMinor: fee.totalMinor })}
          </strong>
        </p>
      ))}
      {tracked && view.paymentInstructions ? (
        <HowToPay slug={event.slug} instructions={view.paymentInstructions} />
      ) : null}
      {canSaySent ? (
        <SentNote
          slug={event.slug}
          party={own}
          onDone={(value) => {
            onChanged(value);
            onChange();
          }}
        />
      ) : null}
    </>
  ) : null;
  // Withdraw or leave the waitlist, or say it can no longer happen here.
  const withdrawArea =
    own && (own.state === "confirmed" || own.state === "waitlisted") ? (
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
                {own.freeWithdrawalAfterChange
                  ? "The time or place changed after you booked, so withdrawing now is free."
                  : cutoffTerms}
                {own.freeWithdrawalAfterChange && own.fee?.markedPaid
                  ? " Your payment marker stays. Contact the organizer about any refund."
                  : ""}
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
    ) : null;
  // Display names only; the server decides who may see them.
  const rosterList = view.roster.length ? (
    <ul>
      {view.roster.map((p, i) => (
        <li key={p.id ?? i}>
          <div id={p.id ? `party-${p.id}` : undefined}>
            <strong>
              <PersonName name={p.primaryName} profileId={p.profileId} />
            </strong>
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
  );
  if (gameDay && own) {
    // Game day: where they stand, when and where, who's coming, their fee
    // and the organizer's notes. Everything else waits under More.
    const requestShowing = !!mutation.error || mutation.uncertain;
    // A waitlisted party owes nothing until it moves in.
    const showFee =
      tracked &&
      (earlierFees.length > 0 ||
        !(own.state === "waitlisted" && !own.fee && !own.splitClaim));
    return (
      <section
        className="registration-panel game-day-panel"
        aria-label="Your registration"
      >
        {/* The headline already says where they stand, and the ticket below
            carries the date, so the banner holds just the one line. */}
        <div className="own-status">
          <StatusBanner tone={ownTone} icon={ownIcon}>
            <h2 ref={statusHeading} tabIndex={-1}>
              {gameDayHeadline(own)}
            </h2>
          </StatusBanner>
        </div>
        {gameDay.details}
        <div className="rp-card game-day-coming">
          <p>{comingLine(view.counts.confirmedSeats, Number(d.capacity))}</p>
          {view.rosterAllowed ? (
            <>
              <button
                type="button"
                className={buttonClass({ variant: "link" })}
                aria-expanded={rosterOpen}
                aria-controls="game-day-roster"
                onClick={() => setRosterOpen((open) => !open)}
              >
                {"See who's coming"}
              </button>
              <div id="game-day-roster" className="roster" hidden={!rosterOpen}>
                {rosterList}
              </div>
            </>
          ) : null}
        </div>
        {showFee ? (
          <div className="rp-card game-day-fee">{feeBlock}</div>
        ) : null}
        {gameDay.notes}
        {/* Held open while a request's error or recovery shows, so a
            collapsed More can't hide it. */}
        <details
          className="game-day-more"
          open={moreOpen || requestShowing}
          onToggle={(e) => setMoreOpen(e.currentTarget.open)}
        >
          <summary
            onClick={(e) => {
              if (requestShowing) e.preventDefault();
            }}
          >
            More
            <CaretDownIcon
              className="game-day-more__caret"
              size={18}
              aria-hidden="true"
            />
          </summary>
          <div className="game-day-more__body">
            {gameDay.more}
            <ShareButton title={d.title} />
            {withdrawArea}
            {phone && sheetOpen ? null : requestState}
            <button
              className={buttonClass({ variant: "link" })}
              disabled={mutation.busy || mutation.uncertain}
              onClick={refresh}
            >
              <ArrowsClockwiseIcon size={18} aria-hidden="true" />
              Refresh
            </button>
          </div>
        </details>
      </section>
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
                      : released
                        ? "Released"
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
              {tracked ? (
                <>
                  Waiting is free. If places open before the start, your party
                  moves in automatically and{" "}
                  {split
                    ? "your seats count toward the final split."
                    : "the fee applies."}
                </>
              ) : (
                "If places open before the start, your party moves in automatically."
              )}
            </p>
          ) : null}
          {feeBlock}
          {withdrawArea}
        </div>
      ) : null}
      {canJoin ? (
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
              ) : tracked ? (
                <p id="join-terms">
                  By choosing <strong>{joinLabel}</strong>, I agree to pay{" "}
                  {feeLabel({ ...d, feeMinor: total })} for{" "}
                  {guest ? "two seats" : "one seat"} if I get a place. If it’s
                  full, I join the waitlist for free; if a place opens before
                  the start, I’m moved in automatically and the fee applies.{" "}
                  {cutoffTerms}
                </p>
              ) : (
                <p id="join-terms">
                  By choosing <strong>{joinLabel}</strong>, I take{" "}
                  {guest ? "two seats" : "one seat"} if I get a place. If it’s
                  full, I join the waitlist; if a place opens before the start,
                  I’m moved in automatically.
                </p>
              )}
              {payBy ? (
                <p id="join-pay-by">
                  Pay by {payBy} or your spot may go to the waitlist.
                </p>
              ) : null}
              {!Number.isSafeInteger(total) ? (
                <Notice>The party fee is too large to store precisely.</Notice>
              ) : null}
              <button
                className={buttonClass({ variant: "primary" })}
                aria-describedby={
                  payBy ? "join-terms join-pay-by" : "join-terms"
                }
                disabled={!Number.isSafeInteger(total)}
              >
                {mutation.busy ? "Checking your place…" : joinLabel}
              </button>
            </fieldset>
          </form>,
          "primary",
        )
      ) : !own ? (
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
      ) : null}
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
            onChanged(value);
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
          tracked={tracked}
          when={when}
          splitCurrency={split?.currency}
          onDone={(value) => {
            onChanged(value);
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
          {rosterList}
        </section>
      ) : null}
    </section>
  );
}
