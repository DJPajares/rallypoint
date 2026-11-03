"use client";
import { PanelSkeleton } from "./skeletons";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
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
import { JoinRequests } from "./join-requests";
import { InvitePanel } from "./invites";
import { GuestChange } from "./guest-change";
import {
  buttonClass,
  iconButtonClass,
  cx,
  Input,
  CheckField,
  Field,
  Notice,
  Sheet,
  StatusBanner,
} from "@rallypoint/ui";
import { StickyActions } from "./ui";
import { PersonName, RankPills, TitlePill } from "./badges";
import type { Tone } from "@rallypoint/ui";
import { feeLabel } from "@rallypoint/domain/session";
import type { SharedSession } from "@rallypoint/domain/session";
import { feeStanding } from "@rallypoint/domain/registration";
import { gameDayHeadline } from "@rallypoint/domain/my-sessions";
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
    <div
      ref={box}
      className="grid gap-3 [&_fieldset]:grid [&_fieldset]:gap-3 [&_form]:grid [&_form]:gap-3 [&_p]:m-0"
    >
      {note ? (
        <>
          <p
            id="sent-note-text"
            role="status"
            className="m-0 flex items-center gap-2 font-semibold"
          >
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
              <Input
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
            <p
              id="sent-note-help"
              className="mt-1 mb-0 text-sm text-muted-foreground"
            >
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
  mainTarget,
  lastView,
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
  /**
   * The page's main column, where a host's tools (people, requests, invites
   * sent, the split) are drawn so they lead the page. Their state stays in
   * this panel. Null until the page has the column; nothing is drawn until
   * then. Left out, the tools stay in the panel.
   */
  mainTarget?: HTMLElement | null;
  /**
   * The last view known, kept while a read is out. A host's card stays up
   * from it, so Share and Manage session stay in reach.
   */
  lastView?: RegistrationView | null;
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
  // A host shares first; joining as a player waits behind a quiet link.
  const [hostJoining, setHostJoining] = useState(false);
  const [inviting, setInviting] = useState(false);
  const joinArea = useRef<HTMLDivElement>(null);
  // Revealing the join form moves focus into it, so it isn't lost.
  useEffect(() => {
    // A phone's sheet moves focus itself.
    if (hostJoining && !phone)
      joinArea.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, [hostJoining, phone]);
  const mutation = useMutation<{ registration: RegistrationView }>((value) => {
    setSheetOpen(false);
    onChanged(value.registration);
    onChange();
  });
  // Declining an invite (P-38) changes nothing but the invite itself.
  const declineInvite = useMutation<unknown>(() => refresh());
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
  const requestKey = view?.joinRequest
    ? `${view.joinRequest.id}:${view.joinRequest.state}`
    : "";
  useEffect(() => {
    if (requestKey) statusHeading.current?.focus();
  }, [requestKey]);
  const d = event.details,
    total = (d.feeMinor ?? 0) * (guest ? 2 : 1);
  function refresh() {
    onRefresh();
    onChange();
  }
  // The host's card. While a read is out it keeps Share and Manage session
  // from the last known view; Invite, Join and Refresh wait for a live one.
  function hostCard(sessionId: string | undefined, live?: { join: boolean }) {
    return (
      <div className="grid justify-items-start gap-3 rounded-lg border border-border bg-card p-5">
        <div className="flex items-center justify-between gap-2 justify-self-stretch">
          <h2 className="m-0 text-lg">You’re hosting</h2>
          {live ? (
            <button
              type="button"
              className={iconButtonClass()}
              aria-label="Refresh"
              title="Refresh"
              disabled={mutation.busy || mutation.uncertain}
              onClick={refresh}
            >
              <ArrowsClockwiseIcon size={18} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        <div className="flex flex-wrap gap-2 max-[520px]:w-full max-[520px]:*:w-full">
          {event.state === "published" ? (
            <ShareButton title={d.title} primary />
          ) : null}
          {sessionId ? (
            <Link
              className={buttonClass()}
              href={`/sessions/${sessionId}/edit`}
            >
              <PencilSimpleIcon size={18} aria-hidden="true" />
              Manage session
            </Link>
          ) : null}
          {live && sessionId && event.state === "published" ? (
            <button
              type="button"
              className={buttonClass()}
              aria-haspopup="dialog"
              onClick={() => setInviting(true)}
            >
              <UserPlusIcon size={18} aria-hidden="true" />
              Invite people
            </button>
          ) : null}
        </div>
        {live?.join ? (
          <button
            type="button"
            className={buttonClass({ variant: "link" })}
            onClick={() => {
              setHostJoining(true);
              // On a phone the join form lives in a sheet: open it now.
              if (phone) setSheetOpen(true);
            }}
          >
            Join as a player
          </button>
        ) : null}
      </div>
    );
  }
  // A read in flight or failed has no view, unless a change already gave one.
  if (!view) {
    const wait = loading ? (
      <PanelSkeleton label="Checking your place…" />
    ) : error ? (
      <Notice retry={refresh}>{error}</Notice>
    ) : null;
    if (lastView?.canManage)
      return (
        <section className="grid gap-3" aria-label="Your registration">
          {hostCard(lastView.sessionId)}
          {wait}
        </section>
      );
    // On game day the time, place and notes stay put while the read is out.
    return gameDay ? (
      <section
        className="grid gap-3 [&>p]:m-0 [&>p]:text-sm gap-4 **:data-[slot=facts]:mb-0 **:data-[slot=session-instructions]:mb-0"
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
  // Ask to join (P-34): people who can't join directly ask instead, and see
  // their request until an organizer answers it.
  // An invite (P-38) counts as the organizer's approval: join directly.
  const asking = d.joinMode === "request" && !view.canManage && !view.invite;
  // A request still waiting shows even after the session switches to join
  // directly, so it can be cancelled; how a request ended shows only while
  // the session still takes requests.
  const ownRequest = view.canManage ? null : (view.joinRequest ?? null);
  const requestShown =
    !!ownRequest &&
    (ownRequest.state === "pending" ||
      (asking && ownRequest.state !== "cancelled"));
  const full =
    view.counts.waitingParties > 0 ||
    Number(d.capacity) - view.counts.confirmedSeats < (guest ? 2 : 1);
  const joinLabel = asking
    ? "Ask to join"
    : full
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
  // Removed by the organizers (P-28): back in only through their invite.
  const removedByOrganizer =
    own?.state === "removed" && !!own.removedByOrganizer;
  // A player whose unpaid spot went to the waitlist, or who withdrew, can join
  // again; someone removed can once the organizers invite them back.
  const canJoin =
    event.registrationWindow === "open" &&
    (!own ||
      released ||
      own.state === "withdrawn" ||
      (removedByOrganizer && !!view.invite));
  const hasAction =
    (own
      ? ((own.state === "confirmed" || own.state === "waitlisted") &&
          event.registrationWindow !== "closed") ||
        canJoin
      : canJoin) &&
    !(
      asking &&
      !!ownRequest &&
      ownRequest.state !== "pending" &&
      ownRequest.state !== "cancelled"
    );
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
    if (!phone) return <div className="grid gap-3 [&_p]:text-sm">{body}</div>;
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
          {/* A host's Share is in their tools card. */}
          {view?.canManage ? null : <ShareButton title={d.title} />}
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
            own.fee.liabilityState === "removed_session_cancelled" ||
            own.fee.liabilityState === "removed_by_organizer"
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
                : own.fee.liabilityState === "removed_by_organizer"
                  ? " · You were removed, so nothing is due."
                  : own.fee.liabilityState === "waived"
                    ? " · Nothing is due."
                    : own.state === "withdrawn" && !own.fee.markedPaid
                      ? " · The fee stays unless the organizer waives it."
                      : own.seats === 1 && own.fee.chargedSeats === 2
                        ? " · Includes your removed guest’s fee, which stays unless the organizer waives it."
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
  // Remove the +1, or add one later (P-27); it shows only when it can happen.
  const guestChange = own ? (
    <GuestChange
      event={event}
      own={own}
      view={view}
      now={now}
      onDone={(value) => {
        onChanged(value);
        onChange();
      }}
    />
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
  // The viewer's own request while it waits, or how it ended.
  const requestBlock = ownRequest ? (
    <div className="grid gap-3 [&>p]:m-0 [&>p]:text-sm **:data-[slot=badge]:mb-1">
      <StatusBanner
        tone={ownRequest.state === "pending" ? "warning" : "neutral"}
        icon={
          ownRequest.state === "pending" ? (
            <HourglassIcon size={22} />
          ) : (
            <LockSimpleIcon size={22} />
          )
        }
      >
        <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-0.5 text-xs font-semibold text-muted-foreground bg-current/14 text-inherit">
          {ownRequest.state === "pending"
            ? "Request sent"
            : ownRequest.state === "declined"
              ? "Not accepted"
              : ownRequest.state === "expired"
                ? "Closed"
                : "Cancelled"}
        </span>
        <h2 ref={statusHeading} tabIndex={-1}>
          {ownRequest.state === "pending"
            ? "Request sent. The organizer will accept or decline it."
            : ownRequest.state === "declined"
              ? "The organizer didn’t accept your request for this session."
              : ownRequest.state === "expired"
                ? "This session has started."
                : "This session was cancelled"}
        </h2>
        {ownRequest.state === "pending" ? (
          <p>
            {ownRequest.seats === 2
              ? `You + ${ownRequest.guestName || "one guest"} · 2 seats`
              : "Just you · 1 seat"}
          </p>
        ) : null}
      </StatusBanner>
      {ownRequest.state === "pending" && ownRequest.needsConfirm ? (
        <>
          <p id="keep-terms">The details changed since you asked.</p>
          <button
            type="button"
            className={buttonClass({ variant: "primary" })}
            aria-describedby="keep-terms"
            disabled={mutation.busy || mutation.uncertain}
            onClick={() =>
              mutation.run(`/api/registrations/${event.slug}/requests/keep`, {
                requestId: ownRequest.id,
                version: event.version,
              })
            }
          >
            Keep my request
          </button>
        </>
      ) : null}
      {ownRequest.state === "pending"
        ? actionArea(
            "Cancel your request",
            "Cancel request",
            <form
              onSubmit={(e) => {
                e.preventDefault();
                mutation.run(
                  `/api/registrations/${event.slug}/requests/cancel`,
                  { requestId: ownRequest.id },
                );
              }}
            >
              <fieldset disabled={mutation.busy || mutation.uncertain}>
                <legend>Cancel your request</legend>
                <p id="cancel-request-terms">
                  {ownRequest.cancelsLeft > 1
                    ? "You can ask again later."
                    : "This is your last cancel: after it you can’t ask again for this session."}
                </p>
                <button
                  className={buttonClass()}
                  aria-describedby="cancel-request-terms"
                >
                  {mutation.busy ? "Cancelling…" : "Cancel request"}
                </button>
              </fieldset>
            </form>,
            "secondary",
          )
        : null}
    </div>
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
            <RankPills ranks={p.ranks} />
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
        className="grid gap-3 [&>p]:m-0 [&>p]:text-sm gap-4 **:data-[slot=facts]:mb-0 **:data-[slot=session-instructions]:mb-0"
        aria-label="Your registration"
      >
        {/* The headline already says where they stand, and the hero above
            carries the date, so the banner holds just the one line. */}
        <div className="grid gap-3 [&>p]:m-0 [&>p]:text-sm **:data-[slot=badge]:mb-1">
          <StatusBanner tone={ownTone} icon={ownIcon}>
            <h2 ref={statusHeading} tabIndex={-1}>
              {gameDayHeadline(own)}
            </h2>
          </StatusBanner>
        </div>
        {gameDay.details}
        {/* How full it is shows in the hero; here is just who's coming. */}
        {view.rosterAllowed ? (
          <div className="grid justify-items-start gap-1">
            <button
              type="button"
              className={buttonClass({ variant: "link" })}
              aria-expanded={rosterOpen}
              aria-controls="game-day-roster"
              onClick={() => setRosterOpen((open) => !open)}
            >
              {"See who's coming"}
            </button>
            <div
              id="game-day-roster"
              className="col-span-full justify-self-stretch [&_h2]:text-xl [&_ul]:m-0 [&_ul]:list-none [&_ul]:p-0 [&_li]:grid [&_li]:gap-0.5 [&_li]:border-t [&_li]:border-border [&_li]:py-2 [&_li]:text-sm [&_li_span]:text-muted-foreground"
              hidden={!rosterOpen}
            >
              {rosterList}
            </div>
          </div>
        ) : null}
        {showFee ? (
          <div className="rounded-lg border border-border bg-card p-5 grid gap-3 [&>p]:m-0">
            {feeBlock}
          </div>
        ) : null}
        {gameDay.notes}
        {/* Held open while a request's error or recovery shows, so a
            collapsed More can't hide it. */}
        <details
          className="group/more border-t border-border [&>summary]:flex [&>summary]:min-h-touch [&>summary]:cursor-pointer [&>summary]:list-none [&>summary]:items-center [&>summary]:gap-2 [&>summary]:font-semibold [&>summary::-webkit-details-marker]:hidden"
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
              className="transition-transform duration-200 ease-standard group-open/more:rotate-180"
              size={18}
              aria-hidden="true"
            />
          </summary>
          <div className="grid justify-items-start gap-4 py-3 *:justify-self-stretch [&>a]:justify-self-start [&>button]:justify-self-start">
            {gameDay.more}
            <ShareButton title={d.title} />
            {guestChange}
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
  const host = view.canManage;
  // A host's tools, drawn in the page's main column (see mainTarget).
  const hostBlocks = (
    <>
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
      {view.canManage && view.requests ? (
        <JoinRequests
          slug={event.slug}
          requests={view.requests}
          onChanged={(value) => {
            onChanged(value);
            onChange();
          }}
        />
      ) : null}
      {view.canManage && view.sessionId && event.state === "published" ? (
        <InvitePanel
          kind="session"
          target={view.sessionId}
          invites={view.invites ?? []}
          sheetOpen={inviting}
          onSheetChange={setInviting}
          onChanged={() => {
            // The sheet closes once the invite is sent.
            setInviting(false);
            refresh();
          }}
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
      ) : null}
    </>
  );
  // A host joins only after choosing to; until then the side card is theirs.
  const joinHidden = host && !own && !hostJoining;
  return (
    <section
      className="grid gap-3 [&>p]:m-0 [&>p]:text-sm"
      aria-label="Your registration"
    >
      {host
        ? hostCard(view.sessionId, {
            join: joinHidden && canJoin,
          })
        : null}
      {own ? (
        <div className="grid gap-3 [&>p]:m-0 [&>p]:text-sm **:data-[slot=badge]:mb-1">
          <StatusBanner tone={ownTone} icon={ownIcon}>
            <span className="inline-flex items-center gap-1 rounded-full bg-muted px-3 py-0.5 text-xs font-semibold text-muted-foreground bg-current/14 text-inherit">
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
                    : removedByOrganizer
                      ? "The organizer removed you from this session."
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
          {guestChange}
          {withdrawArea}
        </div>
      ) : null}
      {requestShown ? (
        requestBlock
      ) : canJoin ? (
        joinHidden ? null : (
          // A host who chose to join gets focus moved into this form.
          // Larger screens show the form as the "Your place" card.
          <div
            ref={joinArea}
            className={
              phone
                ? "contents"
                : "grid rounded-lg border border-border bg-card p-5"
            }
          >
            {actionArea(
              asking ? "Ask to join" : "Join this session",
              asking
                ? "Ask to join"
                : view.counts.waitingParties > 0 ||
                    Number(d.capacity) - view.counts.confirmedSeats < 1
                  ? "Join the waitlist"
                  : "Join",
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  mutation.run(
                    `/api/registrations/${event.slug}${asking ? "/requests" : ""}`,
                    {
                      version: event.version,
                      seats: guest ? 2 : 1,
                      guestName: guest ? guestName : "",
                      consent: true,
                    },
                  );
                }}
              >
                <fieldset disabled={mutation.busy || mutation.uncertain}>
                  <legend>
                    {asking ? "Ask to join" : "Join this session"}
                  </legend>
                  {view.invite ? (
                    <p>{view.invite.inviterName} invited you.</p>
                  ) : null}
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
                          <Input
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
                        change until the organizer finalizes after start, up to
                        the full total if my party is the only payer left. A
                        guest counts as another seat. Waiting is free; promotion
                        before start includes our seats in the split.{" "}
                        {cutoffTerms}
                      </p>
                    </>
                  ) : tracked ? (
                    <p id="join-terms">
                      By choosing <strong>{joinLabel}</strong>, I agree to pay{" "}
                      {feeLabel({ ...d, feeMinor: total })} for{" "}
                      {guest ? "two seats" : "one seat"} if I get a place. If
                      it’s full, I join the waitlist for free; if a place opens
                      before the start, I’m moved in automatically and the fee
                      applies. {cutoffTerms}
                    </p>
                  ) : (
                    <p id="join-terms">
                      By choosing <strong>{joinLabel}</strong>, I take{" "}
                      {guest ? "two seats" : "one seat"} if I get a place. If
                      it’s full, I join the waitlist; if a place opens before
                      the start, I’m moved in automatically.
                    </p>
                  )}
                  {payBy ? (
                    <p id="join-pay-by">
                      Pay by {payBy} or your spot may go to the waitlist.
                    </p>
                  ) : null}
                  {!Number.isSafeInteger(total) ? (
                    <Notice>
                      The party fee is too large to store precisely.
                    </Notice>
                  ) : null}
                  {asking && full ? (
                    <p>
                      It’s full. If the organizer accepts, you’ll join the
                      waitlist.
                    </p>
                  ) : null}
                  {asking ? (
                    <p id="ask-terms">
                      The organizer accepts or declines each request.
                    </p>
                  ) : null}
                  <button
                    className={buttonClass({ variant: "primary" })}
                    aria-describedby={[
                      "join-terms",
                      payBy ? "join-pay-by" : "",
                      asking ? "ask-terms" : "",
                    ]
                      .filter(Boolean)
                      .join(" ")}
                    disabled={!Number.isSafeInteger(total)}
                  >
                    {mutation.busy
                      ? asking
                        ? "Sending your request…"
                        : "Checking your place…"
                      : joinLabel}
                  </button>
                </fieldset>
              </form>,
              "primary",
            )}
          </div>
        )
      ) : !own ? (
        <div className="grid gap-3 [&>p]:m-0 [&>p]:text-sm **:data-[slot=badge]:mb-1">
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
      {view.invite && canJoin && !joinHidden ? (
        <>
          <button
            type="button"
            className={buttonClass({ variant: "link" })}
            disabled={declineInvite.busy || declineInvite.uncertain}
            onClick={() =>
              declineInvite.run(`/api/invites/${view.invite?.id}/decline`, {})
            }
          >
            Decline invite
          </button>
          {declineInvite.error ? <Notice>{declineInvite.error}</Notice> : null}
          {declineInvite.recovery}
        </>
      ) : null}
      {!hasAction && mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {!hasAction ? mutation.recovery : null}
      {/* A host refreshes from their card; everyone else from this link. */}
      {host ? null : (
        <button
          className={cx(buttonClass({ variant: "link" }), "justify-self-end")}
          disabled={mutation.busy || mutation.uncertain}
          onClick={refresh}
        >
          <ArrowsClockwiseIcon size={18} aria-hidden="true" />
          Refresh
        </button>
      )}
      {host
        ? mainTarget === undefined
          ? hostBlocks
          : mainTarget
            ? createPortal(hostBlocks, mainTarget)
            : null
        : null}
      {/* A host's people list is game day (in hostBlocks); the roster is for
          everyone else, and for a host once the session is cancelled. */}
      {view.rosterAllowed && !(host && event.state !== "cancelled") ? (
        <section className="rounded-lg border border-border bg-card p-5 [&_h2]:text-xl [&_ul]:m-0 [&_ul]:list-none [&_ul]:p-0 [&_li]:grid [&_li]:gap-0.5 [&_li]:border-t [&_li]:border-border [&_li]:py-2 [&_li]:text-sm [&_li_span]:text-muted-foreground">
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
