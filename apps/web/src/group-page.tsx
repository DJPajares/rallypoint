"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { buttonClass, Notice, Pending, StatusBanner } from "@rallypoint/ui";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import type { GroupMember, GroupView } from "@rallypoint/domain/contracts";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { DetailPage } from "./ui";
import { PersonName, TitlePill } from "./badges";
import { InvitePanel } from "./invites";

type Answer = { group?: GroupView; left?: true };
const subscribe = () => () => undefined;
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

/**
 * A group (P-35): a list of members. People ask to join through the admin's
 * invite link, or the Join button on a public group; the admin accepts or
 * declines. A private group shows nothing to someone without the link.
 */
export function GroupPage() {
  const { id } = useParams<{ id: string }>();
  const invite = useSearchParams().get("invite");
  const path = `/api/groups/${id}${invite ? `?invite=${encodeURIComponent(invite)}` : ""}`;
  const read = useApi<{ group: GroupView }>(path);
  const [changed, setChanged] = useState<GroupView | null>(null);
  const [said, setSaid] = useState("");
  const [confirm, setConfirm] = useState<string | null>(null);
  const [left, setLeft] = useState(false);
  const note = useRef<HTMLParagraphElement>(null);
  const origin = useSyncExternalStore(subscribe, clientOrigin, serverOrigin);
  const [copied, setCopied] = useState("");
  const said_ = useRef("");
  useEffect(() => {
    if (said) note.current?.focus();
  }, [said]);
  const mutation = useMutation<Answer>((value) => {
    setConfirm(null);
    if (value.left) setLeft(true);
    if (value.group) setChanged(value.group);
    setSaid(said_.current);
  });
  const busy = mutation.busy || mutation.uncertain;
  const run = (
    verb: string,
    body: Record<string, unknown>,
    message: string,
  ) => {
    said_.current = message;
    mutation.run(`/api/groups/${id}/${verb}`, body);
  };
  // A refresh after an action keeps showing the last group read, so the page
  // (and any confirmation on it) stays put while the new read is out.
  const [lastGroup, setLastGroup] = useState<GroupView | null>(null);
  if (read.data?.group && read.data.group !== lastGroup)
    setLastGroup(read.data.group);
  const group = changed ?? read.data?.group ?? lastGroup;
  if (read.loading && !group)
    return (
      <DetailPage back="/workspace" backLabel="Your groups">
        <Pending>Opening the group…</Pending>
      </DetailPage>
    );
  if (read.error && !group)
    return (
      <DetailPage back="/workspace" backLabel="Your groups">
        <h1>Group unavailable</h1>
        <Notice retry={read.retry}>{read.error}</Notice>
      </DetailPage>
    );
  if (!group) return null;
  if (group.concealed)
    return (
      <DetailPage back="/workspace" backLabel="Your groups">
        <div className="own-status">
          <StatusBanner tone="neutral" icon={<LockSimpleIcon size={22} />}>
            <h1>This group is private.</h1>
            <p>Ask its admin for an invite link.</p>
          </StatusBanner>
        </div>
      </DetailPage>
    );
  const admin = group.viewerRole === "admin";
  const inviteLink =
    admin && group.inviteToken && origin
      ? `${origin}/groups/${group.id}?invite=${group.inviteToken}`
      : "";
  const request = group.request;
  const member = (m: GroupMember) => (
    <li key={m.profileId ?? m.name} className="rp-card join-request">
      <p className="join-request__name">
        <strong>
          <PersonName name={m.name} profileId={m.profileId} />
        </strong>
        <TitlePill title={m.title} />
        {m.role === "admin" ? <span className="rp-badge">Admin</span> : null}
      </p>
      {admin && m.role === "member" ? (
        confirm === `remove:${m.profileId}` ? (
          <div className="fee-actions">
            <p className="join-request__confirm">
              Remove {m.name} from the group?
            </p>
            <button
              type="button"
              className={buttonClass()}
              disabled={busy}
              onClick={() => setConfirm(null)}
            >
              Keep
            </button>
            <button
              type="button"
              className={buttonClass({ variant: "primary" })}
              disabled={busy}
              onClick={() =>
                run(
                  "members/remove",
                  { profileId: m.profileId },
                  `Removed ${m.name}.`,
                )
              }
            >
              Remove
            </button>
          </div>
        ) : (
          <div className="fee-actions">
            <button
              type="button"
              className={buttonClass({ variant: "link" })}
              disabled={busy}
              onClick={() => setConfirm(`remove:${m.profileId}`)}
            >
              Remove
            </button>
          </div>
        )
      ) : null}
    </li>
  );
  return (
    <DetailPage back="/workspace" backLabel="Your groups">
      <div className="page-head-row">
        <div>
          <span className="rp-badge">
            {admin
              ? "Admin"
              : group.viewerRole === "member"
                ? "Member"
                : group.visibility === "public"
                  ? "Public group"
                  : "Private group"}
          </span>
          <h1>{group.name}</h1>
          <p className="rp-help">
            {group.memberCount} {group.memberCount === 1 ? "member" : "members"}
          </p>
        </div>
        {admin ? (
          <div className="fee-actions">
            <Link className={buttonClass()} href={`/groups/${group.id}/edit`}>
              Edit group
            </Link>
          </div>
        ) : null}
      </div>
      {said ? (
        <p ref={note} tabIndex={-1} role="status" className="game-day__status">
          {said}
        </p>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
      {left ? (
        <p>You left this group.</p>
      ) : group.viewerRole === null ? (
        request?.state === "pending" ? (
          <div className="own-status">
            <StatusBanner tone="warning" icon={<HourglassIcon size={22} />}>
              <h2>Request sent. The admin will accept or decline it.</h2>
            </StatusBanner>
            <button
              type="button"
              className={buttonClass()}
              disabled={busy}
              onClick={() =>
                run(
                  "requests/cancel",
                  { requestId: request.id },
                  "Request cancelled.",
                )
              }
            >
              Cancel request
            </button>
          </div>
        ) : request?.state === "declined" ? (
          <div className="own-status">
            <StatusBanner tone="neutral" icon={<LockSimpleIcon size={22} />}>
              <h2>The admin didn’t accept your request.</h2>
            </StatusBanner>
          </div>
        ) : group.canAsk ? (
          <div className="action-area">
            <p className="rp-help">
              The admin accepts or declines each request.
            </p>
            <button
              type="button"
              className={buttonClass({ variant: "primary" })}
              disabled={busy}
              onClick={() =>
                run("requests", invite ? { invite } : {}, "Request sent.")
              }
            >
              {group.visibility === "public" && !invite
                ? "Join this group"
                : "Ask to join"}
            </button>
          </div>
        ) : null
      ) : null}
      {admin ? (
        <section className="join-requests" aria-labelledby="group-requests">
          <h2 id="group-requests">Requests ({group.requests?.length ?? 0})</h2>
          {group.requests?.length ? (
            <ul className="join-requests__list">
              {group.requests.map((r) => (
                <li key={r.id} className="rp-card join-request">
                  <p className="join-request__name">
                    <strong>
                      <PersonName name={r.name} profileId={r.profileId} />
                    </strong>
                    <TitlePill title={r.title} />
                  </p>
                  <p className="join-request__facts">
                    Played {r.played} · Hosted {r.hosted}
                  </p>
                  {confirm === `decline:${r.id}` ? (
                    <div className="fee-actions">
                      <p className="join-request__confirm">
                        Decline {r.name}? They can’t ask again for this group.
                      </p>
                      <button
                        type="button"
                        className={buttonClass()}
                        disabled={busy}
                        onClick={() => setConfirm(null)}
                      >
                        Keep
                      </button>
                      <button
                        type="button"
                        className={buttonClass({ variant: "primary" })}
                        disabled={busy}
                        onClick={() =>
                          run(
                            "requests/answer",
                            { requestId: r.id, action: "decline" },
                            `Declined ${r.name}.`,
                          )
                        }
                      >
                        Decline
                      </button>
                    </div>
                  ) : (
                    <div className="fee-actions">
                      <button
                        type="button"
                        className={buttonClass({ variant: "primary" })}
                        disabled={busy}
                        onClick={() =>
                          run(
                            "requests/answer",
                            { requestId: r.id, action: "accept" },
                            `${r.name} is in.`,
                          )
                        }
                      >
                        Accept
                      </button>
                      <button
                        type="button"
                        className={buttonClass()}
                        disabled={busy}
                        onClick={() => setConfirm(`decline:${r.id}`)}
                      >
                        Decline
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="rp-help">No requests waiting.</p>
          )}
          {inviteLink ? (
            <div className="fee-actions">
              <button
                type="button"
                className={buttonClass()}
                onClick={() =>
                  void navigator.clipboard.writeText(inviteLink).then(
                    () => setCopied("Invite link copied."),
                    () => setCopied(inviteLink),
                  )
                }
              >
                Copy invite link
              </button>
              <p role="status" className="rp-help">
                {copied}
              </p>
            </div>
          ) : null}
        </section>
      ) : null}
      {admin ? (
        <InvitePanel
          kind="group"
          target={group.id}
          invites={group.invites ?? []}
          onChanged={() => {
            setChanged(null);
            read.retry();
          }}
        />
      ) : null}
      {group.members && !left ? (
        <section className="join-requests" aria-labelledby="group-members">
          <h2 id="group-members">Members</h2>
          <ul className="join-requests__list">{group.members.map(member)}</ul>
          {group.viewerRole === "member" ? (
            confirm === "leave" ? (
              <div className="fee-actions">
                <p className="join-request__confirm">Leave {group.name}?</p>
                <button
                  type="button"
                  className={buttonClass()}
                  disabled={busy}
                  onClick={() => setConfirm(null)}
                >
                  Stay
                </button>
                <button
                  type="button"
                  className={buttonClass({ variant: "primary" })}
                  disabled={busy}
                  onClick={() => run("leave", {}, "You left this group.")}
                >
                  Leave group
                </button>
              </div>
            ) : (
              <button
                type="button"
                className={buttonClass({ variant: "link" })}
                disabled={busy}
                onClick={() => setConfirm("leave")}
              >
                Leave group
              </button>
            )
          ) : null}
        </section>
      ) : null}
    </DetailPage>
  );
}
