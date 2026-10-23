"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { PaperPlaneTiltIcon } from "@phosphor-icons/react/dist/csr/PaperPlaneTilt";
import {
  buttonClass,
  cx,
  ListGroup,
  ListRow,
  Notice,
  Pill,
  Segmented,
  Sheet,
  StatRow,
} from "@rallypoint/ui";
import {
  filterParties,
  gameDaySummary,
  partyNoteWords,
  partyStanding,
  paymentWords,
} from "@rallypoint/domain/game-day";
import type { GameDayFilter, RosterParty } from "@rallypoint/domain/game-day";
import type {
  ManagedFee,
  RegistrationView,
} from "@rallypoint/domain/registration";
import { splitMoney } from "@rallypoint/domain/fees";
import { feeLabel } from "@rallypoint/domain/session";
import { useAuth } from "./auth-context";
import { useMutation } from "./use-mutation";
import { FeeControls } from "./fee-controls";
import { PendingSplitControls } from "./split-controls";
import { SeatAttendanceControls } from "./attendance-controls";
import { TitlePill } from "./badges";

// The organizer's view on the day (PRD D-17, R2): big numbers, one round
// check per party, money as a quiet line. Everything else about a person
// lives in one sheet, using the same controls and rules as before.
const money = (currency: string, feeMinor: number) =>
  feeLabel({ currency, feeMinor });
const partyName = (p: RosterParty) =>
  p.primaryName + (p.seats === 2 ? ` + ${p.guestName || "guest"}` : "");
const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join("") || "?";
// The same person keeps the same tint everywhere.
const tint = (name: string) =>
  `var(--avatar-${([...name].reduce((n, c) => n + c.charCodeAt(0), 0) % 6) + 1})`;

function Avatar({ name }: { name: string }) {
  return (
    <span
      className="game-avatar"
      style={{ background: tint(name) }}
      aria-hidden="true"
    >
      {initials(name)}
    </span>
  );
}

function Payment({ party }: { party: RosterParty }) {
  const words = paymentWords(party, money);
  if (!words) return null;
  return words.endsWith("to pay") ? (
    <Pill tone="warning">{words}</Pill>
  ) : (
    <>{words}</>
  );
}

/** What the player said about sending payment: quiet words under the amount. */
function SentNote({ party }: { party: RosterParty }) {
  const words = partyNoteWords(party);
  if (!words) return null;
  return (
    <span className="game-row__note">
      <PaperPlaneTiltIcon size={14} aria-hidden="true" /> {words}
    </span>
  );
}

/** A confirmed party: the quick check acts on the primary seat only. */
function ConfirmedRow({
  slug,
  party,
  tracked,
  onOpen,
  onDone,
}: {
  slug: string;
  party: RosterParty;
  /** Whether this session tracks payment at all. */
  tracked: boolean;
  onOpen: () => void;
  onDone: (view: RegistrationView) => void;
}) {
  const mutation = useMutation<{ registration: RegistrationView }>((value) =>
    onDone(value.registration),
  );
  const seat = party.attendance?.find((a) => a.seat === 1);
  const here = seat?.state === "checked_in";
  const standing = partyStanding(party);
  // Only say who is missing when part of a two-seat party has arrived.
  const missing =
    party.seats === 2 && standing.seatsHere > 0 && standing.missing.length
      ? `${standing.missing.join(" and ")} not here yet`
      : "";
  const owed = tracked ? paymentWords(party, money) : "";
  const note = tracked ? partyNoteWords(party) : "";
  return (
    <ListRow
      leading={<Avatar name={party.primaryName} />}
      title={
        <>
          {partyName(party)}
          {party.title ? <TitlePill title={party.title} /> : null}
        </>
      }
      subtitle={
        missing || owed || note ? (
          <>
            {missing}
            {missing && owed ? " · " : null}
            {owed ? <Payment party={party} /> : null}
            {note ? <SentNote party={party} /> : null}
          </>
        ) : undefined
      }
      onSelect={onOpen}
      selectHint="Open details"
      trailing={
        seat && party.id ? (
          <button
            type="button"
            className={cx("check-toggle", here && "is-on")}
            aria-pressed={here}
            aria-label={
              here
                ? `Undo ${party.primaryName} check-in`
                : `Mark ${party.primaryName} here`
            }
            disabled={mutation.busy || mutation.uncertain}
            onClick={() =>
              mutation.run(`/api/registrations/${slug}/attendance`, {
                partyId: party.id,
                seat: 1,
                state: here ? "unrecorded" : "checked_in",
                revision: seat.revision,
              })
            }
          >
            {here ? <CheckIcon size={20} weight="bold" /> : null}
          </button>
        ) : undefined
      }
    >
      {mutation.error || mutation.uncertain ? (
        <div className="game-row-recovery">
          {mutation.error ? <Notice>{mutation.error}</Notice> : null}
          {mutation.recovery}
        </div>
      ) : null}
    </ListRow>
  );
}

/**
 * The confirmation for giving one unpaid, confirmed party's spot to the
 * waitlist. It repeats anything the player said about sending payment.
 * Nothing is released on its own; this is the only way it happens. It lives in
 * a sheet of its own, beside the details sheet rather than inside it.
 *
 * The release names the note this sheet shows (or none), and the server refuses
 * it if the player has since posted, changed or undone one. Any refusal reloads
 * the registration, so the sheet shows what is true now and can be tried again.
 */
function ReleaseConfirm({
  slug,
  party,
  fee,
  onKeep,
  onDone,
  onRefreshed,
}: {
  slug: string;
  party: RosterParty;
  fee: ManagedFee;
  onKeep: () => void;
  onDone: (view: RegistrationView) => void;
  onRefreshed: (view: RegistrationView) => void;
}) {
  const { session } = useAuth();
  const token = session?.access_token;
  const mutation = useMutation<{ registration: RegistrationView }>((value) =>
    onDone(value.registration),
  );
  const busy = mutation.busy || mutation.uncertain;
  const said = party.paymentNote;
  // A refusal is definite (an interrupted request is not): reload the roster so
  // the revision and note shown here are current. The sheet stays open. The
  // callback lives in a ref so a new render alone never reloads again.
  const refreshed = useRef(onRefreshed);
  useEffect(() => {
    refreshed.current = onRefreshed;
  });
  useEffect(() => {
    if (!mutation.error || mutation.uncertain) return;
    const controller = new AbortController();
    void fetch(`/api/registrations/${slug}`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((body: { registration?: RegistrationView } | null) => {
        if (body?.registration && !controller.signal.aborted)
          refreshed.current(body.registration);
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [mutation.error, mutation.uncertain, slug, token]);
  return (
    <>
      <p>
        Their unpaid {money(fee.currency, fee.totalMinor)} is dropped and the
        next person in line gets the spot.
      </p>
      {said ? (
        <p>
          {party.primaryName} says they sent it
          {said.reference ? ` · ref ${said.reference}` : ""}.
        </p>
      ) : null}
      <div className="fee-actions">
        <button
          type="button"
          className={buttonClass()}
          disabled={busy}
          onClick={onKeep}
        >
          Keep
        </button>
        <button
          type="button"
          className={buttonClass({ variant: "primary" })}
          disabled={busy}
          onClick={() =>
            mutation.run(`/api/registrations/${slug}/release`, {
              partyId: party.id,
              revision: fee.revision,
              // The note as this sheet shows it; null when it shows none.
              noteSentAt: said?.sentAt ?? null,
            })
          }
        >
          {mutation.busy ? "Giving spot away…" : "Give spot away"}
        </button>
      </div>
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </>
  );
}

/** Everything about one party, with the controls the roster used to repeat. */
function PartyDetails({
  slug,
  party,
  queue,
  ended,
  tracked,
  when,
  onDone,
  onRelease,
  onUndoReview,
}: {
  slug: string;
  party: RosterParty;
  queue: number | null;
  ended: boolean;
  tracked: boolean;
  when: (iso: string) => string;
  onDone: (view: RegistrationView) => void;
  onRelease: (partyId: string) => void;
  onUndoReview: (partyId: string) => void;
}) {
  const labelId = `sheet-party-${party.id}`;
  const said = tracked ? partyNoteWords(party) : "";
  return (
    <div className="party-details">
      <p id={labelId} className="party-details__meta">
        {party.seats} {party.seats === 1 ? "seat" : "seats"} ·{" "}
        {party.state === "waitlisted" && queue
          ? `waiting, number ${queue} in line`
          : party.state}
      </p>
      {party.id
        ? party.attendance?.map((seat) => (
            <SeatAttendanceControls
              key={seat.seat}
              slug={slug}
              partyId={party.id!}
              name={
                seat.seat === 1 ? party.primaryName : party.guestName || "Guest"
              }
              seat={seat}
              ended={ended}
              when={when}
              onDone={onDone}
            />
          ))
        : null}
      {said && party.paymentNote ? (
        <p className="party-details__sent">
          <PaperPlaneTiltIcon size={16} aria-hidden="true" /> {said} ·{" "}
          {when(party.paymentNote.sentAt)}
        </p>
      ) : null}
      {party.id && party.fee ? (
        <FeeControls
          slug={slug}
          partyId={party.id}
          labelId={labelId}
          fee={party.fee}
          when={when}
          onDone={onDone}
          onUndoReview={
            party.splitUndoRequiresReview
              ? () => onUndoReview(party.id!)
              : undefined
          }
        />
      ) : null}
      {party.id && party.releasable && party.fee ? (
        <div>
          <button
            type="button"
            className={buttonClass({ size: "sm" })}
            aria-describedby={labelId}
            aria-haspopup="dialog"
            onClick={() => onRelease(party.id!)}
          >
            Give spot to waitlist
          </button>
        </div>
      ) : null}
      {party.id && party.splitClaim && !party.fee ? (
        <PendingSplitControls
          slug={slug}
          partyId={party.id}
          claim={party.splitClaim}
          onDone={onDone}
          onUndoReview={
            party.splitUndoRequiresReview
              ? () => onUndoReview(party.id!)
              : undefined
          }
        />
      ) : null}
      {tracked && party.state === "waitlisted" ? (
        <p className="rp-help">Waiting is free until a place opens.</p>
      ) : null}
    </div>
  );
}

export function GameDay({
  slug,
  view,
  ended,
  tracked,
  when,
  splitCurrency,
  onDone,
  onUndoReview,
}: {
  slug: string;
  view: RegistrationView;
  ended: boolean;
  /** "Pay the organizer": only then do payment words, counts and filters show. */
  tracked: boolean;
  when: (iso: string) => string;
  splitCurrency?: string;
  onDone: (view: RegistrationView) => void;
  onUndoReview: (partyId: string) => void;
}) {
  const [filter, setFilter] = useState<GameDayFilter>("everyone");
  const [openId, setOpenId] = useState<string | null>(null);
  const [releaseId, setReleaseId] = useState<string | null>(null);
  // After a release the party's row is gone, so focus lands on this message
  // rather than being lost, and it is read out as it takes focus.
  const [gaveAway, setGaveAway] = useState("");
  const gaveAwayNote = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (gaveAway) gaveAwayNote.current?.focus();
  }, [gaveAway]);
  const summary = gameDaySummary(view.roster);
  const filtered = filterParties(view.roster, filter);
  const { confirmed, waiting } = filtered;
  const left = tracked ? filtered.left : [];
  const open = view.roster.find((p) => p.id && p.id === openId);
  const releasing = view.roster.find((p) => p.id && p.id === releaseId);
  const openParty = (p: RosterParty) => {
    setGaveAway("");
    setOpenId(p.id ?? null);
  };
  const queue = (p: RosterParty) =>
    view.roster.filter((x) => x.state === "waitlisted").indexOf(p) + 1 || null;
  const quietRow = (p: RosterParty, subtitle: ReactNode) => (
    <ListRow
      key={p.id}
      leading={<Avatar name={p.primaryName} />}
      title={partyName(p)}
      subtitle={subtitle}
      onSelect={() => openParty(p)}
      selectHint="Open details"
    />
  );
  return (
    <section className="game-day" aria-labelledby="game-day-title">
      <h2 id="game-day-title">People</h2>
      {gaveAway ? (
        <p
          ref={gaveAwayNote}
          tabIndex={-1}
          role="status"
          className="game-day__status"
        >
          {gaveAway}
        </p>
      ) : null}
      <StatRow
        items={[
          {
            label: "here",
            value: (
              <>
                {summary.here}
                <small>/{summary.expected}</small>
              </>
            ),
          },
          ...(tracked ? [{ label: "to pay", value: summary.toPay }] : []),
          { label: "waiting", value: summary.waiting },
        ]}
      />
      <Segmented
        label="Show"
        value={filter}
        onChange={setFilter}
        options={[
          { value: "everyone", label: "Everyone" },
          { value: "not_here", label: "Not here" },
          ...(tracked ? [{ value: "to_pay" as const, label: "To pay" }] : []),
        ]}
      />
      {confirmed.length ? (
        <ListGroup label="Confirmed">
          {confirmed.map((p) => (
            <ConfirmedRow
              key={p.id}
              slug={slug}
              party={p}
              tracked={tracked}
              onOpen={() => openParty(p)}
              onDone={onDone}
            />
          ))}
        </ListGroup>
      ) : (
        <p className="rp-help">
          {filter === "not_here"
            ? "Everyone with a place is here."
            : filter === "to_pay"
              ? "Nobody with a place owes anything."
              : "No one has a place yet."}
        </p>
      )}
      {waiting.length ? (
        <>
          <h3>Waiting</h3>
          <ListGroup>
            {waiting.map((p) =>
              quietRow(
                p,
                <>
                  {p.splitClaim?.estimateMinor != null && splitCurrency
                    ? `Number ${queue(p)} · share about ${splitMoney(splitCurrency, p.splitClaim.estimateMinor)}`
                    : `Number ${queue(p)} in line`}
                  {tracked ? <SentNote party={p} /> : null}
                </>,
              ),
            )}
          </ListGroup>
        </>
      ) : null}
      {left.length ? (
        <>
          <h3>Left</h3>
          <ListGroup>
            {left.map((p) => quietRow(p, <Payment party={p} />))}
          </ListGroup>
        </>
      ) : null}
      <Sheet
        open={!!open}
        onClose={() => setOpenId(null)}
        title={open ? partyName(open) : "Details"}
      >
        {open ? (
          <PartyDetails
            slug={slug}
            party={open}
            queue={queue(open)}
            ended={ended}
            tracked={tracked}
            when={when}
            onDone={onDone}
            onRelease={(id) => {
              // The details sheet closes first, so focus returns to the row
              // and the confirmation opens from there.
              setOpenId(null);
              setReleaseId(id);
            }}
            onUndoReview={(id) => {
              setOpenId(null);
              onUndoReview(id);
            }}
          />
        ) : null}
      </Sheet>
      <Sheet
        open={!!releasing}
        onClose={() => setReleaseId(null)}
        title={
          releasing
            ? `Give ${releasing.primaryName}’s spot to the waitlist?`
            : "Give spot to waitlist"
        }
      >
        {releasing?.fee ? (
          <ReleaseConfirm
            slug={slug}
            party={releasing}
            fee={releasing.fee}
            onKeep={() => setReleaseId(null)}
            onRefreshed={onDone}
            onDone={(next) => {
              onDone(next);
              setReleaseId(null);
              setGaveAway(
                `${releasing.primaryName}’s spot went to the waitlist.`,
              );
            }}
          />
        ) : null}
      </Sheet>
    </section>
  );
}
