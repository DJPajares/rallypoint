"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import {
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
  partyStanding,
  paymentWords,
} from "@rallypoint/domain/game-day";
import type { GameDayFilter, RosterParty } from "@rallypoint/domain/game-day";
import type { RegistrationView } from "@rallypoint/domain/registration";
import { splitMoney } from "@rallypoint/domain/fees";
import { feeLabel } from "@rallypoint/domain/session";
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

/** A confirmed party: the quick check acts on the primary seat only. */
function ConfirmedRow({
  slug,
  party,
  onOpen,
  onDone,
}: {
  slug: string;
  party: RosterParty;
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
  const payment = <Payment party={party} />;
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
        missing || paymentWords(party, money) ? (
          <>
            {missing}
            {missing && paymentWords(party, money) ? " · " : null}
            {payment}
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

/** Everything about one party, with the controls the roster used to repeat. */
function PartyDetails({
  slug,
  party,
  queue,
  ended,
  when,
  onDone,
  onUndoReview,
}: {
  slug: string;
  party: RosterParty;
  queue: number | null;
  ended: boolean;
  when: (iso: string) => string;
  onDone: (view: RegistrationView) => void;
  onUndoReview: (partyId: string) => void;
}) {
  const labelId = `sheet-party-${party.id}`;
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
      {party.state === "waitlisted" ? (
        <p className="rp-help">Waiting is free until a place opens.</p>
      ) : null}
    </div>
  );
}

export function GameDay({
  slug,
  view,
  ended,
  when,
  splitCurrency,
  onDone,
  onUndoReview,
}: {
  slug: string;
  view: RegistrationView;
  ended: boolean;
  when: (iso: string) => string;
  splitCurrency?: string;
  onDone: (view: RegistrationView) => void;
  onUndoReview: (partyId: string) => void;
}) {
  const [filter, setFilter] = useState<GameDayFilter>("everyone");
  const [openId, setOpenId] = useState<string | null>(null);
  const summary = gameDaySummary(view.roster);
  const { confirmed, waiting, left } = filterParties(view.roster, filter);
  const open = view.roster.find((p) => p.id && p.id === openId);
  const queue = (p: RosterParty) =>
    view.roster.filter((x) => x.state === "waitlisted").indexOf(p) + 1 || null;
  const quietRow = (p: RosterParty, subtitle: ReactNode) => (
    <ListRow
      key={p.id}
      leading={<Avatar name={p.primaryName} />}
      title={partyName(p)}
      subtitle={subtitle}
      onSelect={() => setOpenId(p.id ?? null)}
      selectHint="Open details"
    />
  );
  return (
    <section className="game-day" aria-labelledby="game-day-title">
      <h2 id="game-day-title">People</h2>
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
          { label: "to pay", value: summary.toPay },
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
          { value: "to_pay", label: "To pay" },
        ]}
      />
      {confirmed.length ? (
        <ListGroup label="Confirmed">
          {confirmed.map((p) => (
            <ConfirmedRow
              key={p.id}
              slug={slug}
              party={p}
              onOpen={() => setOpenId(p.id ?? null)}
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
                p.splitClaim?.estimateMinor != null && splitCurrency
                  ? `Number ${queue(p)} · share about ${splitMoney(splitCurrency, p.splitClaim.estimateMinor)}`
                  : `Number ${queue(p)} in line`,
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
            when={when}
            onDone={onDone}
            onUndoReview={(id) => {
              setOpenId(null);
              onUndoReview(id);
            }}
          />
        ) : null}
      </Sheet>
    </section>
  );
}
