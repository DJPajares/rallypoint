"use client";
import { useEffect, useRef, useState } from "react";
import { buttonClass, Notice } from "@rallypoint/ui";
import { levelLabel } from "@rallypoint/domain/profile";
import type {
  ManagedJoinRequest,
  RegistrationView,
} from "@rallypoint/domain/registration";
import { useMutation } from "./use-mutation";
import { PersonName, TitlePill } from "./badges";

interface Answer {
  registration: RegistrationView;
  accepted?: {
    name: string;
    state: "confirmed" | "waitlisted";
    queuePosition: number | null;
  };
  declined?: number;
}

const asked = (iso: string, now: number) => {
  const minutes = Math.round((now - Date.parse(iso)) / 60000);
  const words = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (minutes < 60) return words.format(-Math.max(minutes, 0), "minute");
  if (minutes < 1440) return words.format(-Math.round(minutes / 60), "hour");
  return words.format(-Math.round(minutes / 1440), "day");
};

/**
 * Ask to join (P-34): the requests still waiting, oldest first, with only
 * what helps decide. Accept places them as a join would; Decline is final for
 * this session. After an answer the card is gone, so focus moves to the line
 * that says what happened.
 */
export function JoinRequests({
  slug,
  requests,
  onChanged,
}: {
  slug: string;
  requests: ManagedJoinRequest[];
  onChanged: (view: RegistrationView) => void;
}) {
  const [said, setSaid] = useState("");
  const [declining, setDeclining] = useState<string | null>(null);
  const answering = useRef("");
  const note = useRef<HTMLParagraphElement>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    if (said) note.current?.focus();
  }, [said]);
  const mutation = useMutation<Answer>((value) => {
    setDeclining(null);
    setSaid(
      value.accepted
        ? value.accepted.state === "confirmed"
          ? `${value.accepted.name} is in.`
          : `${value.accepted.name} is #${value.accepted.queuePosition} on the waitlist.`
        : value.declined !== undefined
          ? `Declined ${value.declined} ${value.declined === 1 ? "request" : "requests"}.`
          : `Declined ${answering.current}.`,
    );
    onChanged(value.registration);
  });
  const busy = mutation.busy || mutation.uncertain;
  const answer = (verb: string, r?: ManagedJoinRequest, expected?: number) => {
    answering.current = r?.name ?? "";
    mutation.run(
      `/api/registrations/${slug}/requests/${verb}`,
      r ? { requestId: r.id } : { expected },
    );
  };
  if (!requests.length && !said && !mutation.error && !mutation.uncertain)
    return null;
  return (
    <section className="join-requests" aria-labelledby="join-requests-title">
      <h2 id="join-requests-title">
        Requests{requests.length ? ` (${requests.length})` : ""}
      </h2>
      {said ? (
        <p ref={note} tabIndex={-1} role="status" className="game-day__status">
          {said}
        </p>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
      <ul className="join-requests__list">
        {requests.map((r) => (
          <li key={r.id} className="rp-card join-request">
            <p className="join-request__name">
              <strong>
                <PersonName name={r.name} profileId={r.profileId} />
              </strong>
              <TitlePill title={r.title} />
            </p>
            <p className="join-request__facts">
              {r.level ? `${levelLabel[r.level]} · ` : ""}
              Played {r.played} · Hosted {r.hosted}
            </p>
            <p className="join-request__facts">
              Played in this group’s sessions: {r.playedInGroup}
            </p>
            {r.seats === 2 ? <p>+1: {r.guestName || "Guest"}</p> : null}
            <p className="join-request__facts">Asked {asked(r.askedAt, now)}</p>
            <p>
              <strong>
                {r.needsConfirm
                  ? "Waiting for them to confirm the new details"
                  : r.fitsNow
                    ? "Fits now"
                    : `Would join the waitlist at #${r.waitlistPosition}`}
              </strong>
            </p>
            {declining === r.id ? (
              <div className="fee-actions">
                <p className="join-request__confirm">
                  Decline {r.name}? They can’t ask again for this session.
                </p>
                <button
                  type="button"
                  className={buttonClass()}
                  disabled={busy}
                  onClick={() => setDeclining(null)}
                >
                  Keep
                </button>
                <button
                  type="button"
                  className={buttonClass({ variant: "primary" })}
                  disabled={busy}
                  onClick={() => answer("decline", r)}
                >
                  {mutation.busy ? "Declining…" : "Decline"}
                </button>
              </div>
            ) : (
              <div className="fee-actions">
                {r.needsConfirm ? null : (
                  <button
                    type="button"
                    className={buttonClass({ variant: "primary" })}
                    disabled={busy}
                    onClick={() => answer("accept", r)}
                  >
                    Accept
                  </button>
                )}
                <button
                  type="button"
                  className={buttonClass()}
                  disabled={busy}
                  onClick={() => setDeclining(r.id)}
                >
                  Decline
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
      {requests.length >= 2 ? (
        declining === "rest" ? (
          <div className="fee-actions">
            <p className="join-request__confirm">
              Decline all {requests.length} requests? They can’t ask again for
              this session.
            </p>
            <button
              type="button"
              className={buttonClass()}
              disabled={busy}
              onClick={() => setDeclining(null)}
            >
              Keep
            </button>
            <button
              type="button"
              className={buttonClass({ variant: "primary" })}
              disabled={busy}
              onClick={() => answer("decline-rest", undefined, requests.length)}
            >
              {mutation.busy ? "Declining…" : `Decline ${requests.length}`}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={buttonClass({ variant: "link" })}
            disabled={busy}
            onClick={() => setDeclining("rest")}
          >
            Decline the rest
          </button>
        )
      ) : null}
    </section>
  );
}
