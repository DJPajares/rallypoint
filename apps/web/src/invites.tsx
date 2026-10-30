"use client";
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import {
  buttonClass,
  Field,
  ListGroup,
  ListRow,
  Notice,
  Pending,
  Sheet,
} from "@rallypoint/ui";
import type {
  InviteCandidate,
  MyInvite,
  SentInvite,
} from "@rallypoint/domain/contracts";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { PersonName, TitlePill } from "./badges";

const when = (iso: string | null, timeZone: string) =>
  iso
    ? new Intl.DateTimeFormat("en", {
        timeZone,
        weekday: "short",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso))
    : "";

/**
 * P-38: the invites waiting for you, at the top of Home. A group invite is
 * answered here; a session invite opens its page, where the join step takes
 * the fee and waitlist consent.
 */
export function HomeInvites() {
  const [refresh, setRefresh] = useState(0);
  const list = useApi<{ invites: MyInvite[] }>(
    "/api/me/invites",
    false,
    String(refresh),
  );
  const [said, setSaid] = useState("");
  const note = useRef<HTMLParagraphElement>(null);
  const message = useRef("");
  useEffect(() => {
    if (said) note.current?.focus();
  }, [said]);
  const mutation = useMutation<unknown>(() => {
    setSaid(message.current);
    setRefresh((n) => n + 1);
  });
  const busy = mutation.busy || mutation.uncertain;
  const invites = list.data?.invites ?? [];
  if (!invites.length && !said && !mutation.error) return null;
  const answer = (invite: MyInvite, verb: string, text: string) => {
    message.current = text;
    mutation.run(`/api/invites/${invite.id}/${verb}`, {});
  };
  return (
    <section className="rp-card join-requests" aria-labelledby="home-invites">
      <h2 id="home-invites">Invites ({invites.length})</h2>
      {said ? (
        <p ref={note} tabIndex={-1} role="status" className="game-day__status">
          {said}
        </p>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
      <ul className="join-requests__list">
        {invites.map((invite) => (
          <li key={invite.id} className="join-request">
            <p>
              {invite.inviterName} invited you to{" "}
              <strong>
                {invite.group
                  ? invite.group.name
                  : `${invite.session?.title} · ${when(invite.session?.startsAt ?? null, invite.session?.timeZone ?? "UTC")}`}
              </strong>
            </p>
            <div className="fee-actions">
              {invite.group ? (
                <button
                  type="button"
                  className={buttonClass({ variant: "primary" })}
                  disabled={busy}
                  onClick={() =>
                    answer(
                      invite,
                      "accept",
                      `You joined ${invite.group?.name}.`,
                    )
                  }
                >
                  Join
                </button>
              ) : (
                <Link
                  className={buttonClass({ variant: "primary" })}
                  href={`/s/${invite.session?.slug}`}
                >
                  Open
                </Link>
              )}
              <button
                type="button"
                className={buttonClass()}
                disabled={busy}
                onClick={() => answer(invite, "decline", "Invite declined.")}
              >
                Decline
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

const stateWords: Record<SentInvite["state"], string> = {
  pending: "Waiting",
  accepted: "Joined",
  declined: "Declined",
  withdrawn: "Withdrawn",
};

/**
 * P-38: for a group's admin or a session's organizers. Invite opens a sheet
 * of people you already know; Invited lists who was asked and how it went.
 */
export function InvitePanel({
  kind,
  target,
  invites,
  onChanged,
  sheetOpen,
  onSheetChange,
  sheetTop,
}: {
  kind: "group" | "session";
  target: string;
  invites: SentInvite[];
  onChanged: () => void;
  /**
   * When the page opens the sheet itself (the group page's Invite people),
   * the panel shows only the invites already sent, and only if there are any.
   */
  sheetOpen?: boolean;
  onSheetChange?: (open: boolean) => void;
  /** Shown first in the sheet, such as the group's invite link. */
  sheetTop?: ReactNode;
}) {
  const [ownOpen, setOwnOpen] = useState(false);
  const controlled = sheetOpen !== undefined;
  const open = controlled ? sheetOpen : ownOpen;
  const setOpen = (next: boolean) =>
    controlled ? onSheetChange?.(next) : setOwnOpen(next);
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState("");
  const [said, setSaid] = useState("");
  const message = useRef("");
  const note = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (said) note.current?.focus();
  }, [said]);
  // Searching waits for a pause in typing, so each keystroke isn't a request.
  useEffect(() => {
    const timer = setTimeout(() => setShown(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  const [round, setRound] = useState(0);
  const mutation = useMutation<unknown>(() => {
    setSaid(message.current);
    setRound((n) => n + 1);
    onChanged();
  });
  const busy = mutation.busy || mutation.uncertain;
  const run = (path: string, body: Record<string, unknown>, text: string) => {
    message.current = text;
    mutation.run(path, body);
  };
  // A page that opens the sheet itself hides an empty list entirely.
  if (controlled && !invites.length && !open && !said && !mutation.error)
    return null;
  return (
    <section className="join-requests" aria-labelledby={`invited-${kind}`}>
      {controlled ? (
        <h2 id={`invited-${kind}`}>Invited</h2>
      ) : (
        <div className="fee-actions">
          <h2 id={`invited-${kind}`}>Invited</h2>
          <button
            type="button"
            className={buttonClass()}
            aria-haspopup="dialog"
            onClick={() => {
              setSaid("");
              setOpen(true);
            }}
          >
            Invite
          </button>
        </div>
      )}
      {said && !open ? (
        <p ref={note} tabIndex={-1} role="status" className="game-day__status">
          {said}
        </p>
      ) : null}
      {mutation.error && !open ? <Notice>{mutation.error}</Notice> : null}
      {invites.length ? (
        <ul className="join-requests__list">
          {invites.map((invite) => (
            <li key={invite.id} className="rp-card join-request">
              <p className="join-request__name">
                <strong>{invite.name}</strong>
              </p>
              <p className="join-request__facts">{stateWords[invite.state]}</p>
              {invite.state === "pending" ? (
                <div className="fee-actions">
                  <button
                    type="button"
                    className={buttonClass({ variant: "link" })}
                    disabled={busy}
                    onClick={() =>
                      run(
                        `/api/invites/${invite.id}/withdraw`,
                        {},
                        `Invite to ${invite.name} withdrawn.`,
                      )
                    }
                  >
                    Withdraw
                  </button>
                </div>
              ) : null}
            </li>
          ))}
        </ul>
      ) : controlled ? null : (
        <p className="rp-help">Nobody invited yet.</p>
      )}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={controlled ? "Invite people" : "Invite someone"}
      >
        {sheetTop}
        <Field
          id={`invite-search-${kind}`}
          label="Search people you know"
          help="People who joined your sessions or share a group with you."
        >
          <input
            id={`invite-search-${kind}`}
            aria-describedby={`invite-search-${kind}-help`}
            value={query}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </Field>
        {said ? (
          <p role="status" className="game-day__status">
            {said}
          </p>
        ) : null}
        {mutation.error ? <Notice>{mutation.error}</Notice> : null}
        {mutation.recovery}
        {open ? (
          <Candidates
            kind={kind}
            target={target}
            query={shown}
            round={round}
            busy={busy}
            invite={(person) =>
              run(
                "/api/invites",
                { kind, target, profileId: person.profileId },
                `Invited ${person.name}.`,
              )
            }
          />
        ) : null}
      </Sheet>
    </section>
  );
}

/** People you can invite, read only while the sheet is open. */
function Candidates({
  kind,
  target,
  query,
  round,
  busy,
  invite,
}: {
  kind: "group" | "session";
  target: string;
  query: string;
  round: number;
  busy: boolean;
  invite: (person: InviteCandidate) => void;
}) {
  const candidates = useApi<{ people: InviteCandidate[] }>(
    `/api/invites/candidates?kind=${kind}&target=${target}${query ? `&q=${encodeURIComponent(query)}` : ""}`,
    false,
    String(round),
  );
  if (candidates.loading) return <Pending>Finding people…</Pending>;
  if (candidates.error)
    return <Notice retry={candidates.retry}>{candidates.error}</Notice>;
  if (!candidates.data?.people.length)
    return (
      <p className="rp-help">
        {query ? "Nobody by that name." : "Nobody to invite yet."}
      </p>
    );
  return (
    // One row per person with a small Invite, so the sheet has no wall of
    // brand-coloured buttons (D-15).
    <ListGroup label="People you can invite">
      {candidates.data.people.map((person) => (
        <ListRow
          key={person.profileId}
          title={
            <>
              <PersonName name={person.name} profileId={person.profileId} />
              <TitlePill title={person.title} />
            </>
          }
          trailing={
            <button
              type="button"
              className={buttonClass({ size: "sm" })}
              disabled={busy}
              aria-label={`Invite ${person.name}`}
              onClick={() => invite(person)}
            >
              Invite
            </button>
          }
        />
      ))}
    </ListGroup>
  );
}
