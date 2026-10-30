"use client";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import {
  buttonClass,
  iconButtonClass,
  ListGroup,
  ListRow,
  Notice,
  Pending,
  Pill,
  Sheet,
  StatusBanner,
} from "@rallypoint/ui";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { HourglassIcon } from "@phosphor-icons/react/dist/csr/Hourglass";
import { GlobeHemisphereWestIcon } from "@phosphor-icons/react/dist/csr/GlobeHemisphereWest";
import { UserPlusIcon } from "@phosphor-icons/react/dist/csr/UserPlus";
import { PencilSimpleIcon } from "@phosphor-icons/react/dist/csr/PencilSimple";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { LinkSimpleIcon } from "@phosphor-icons/react/dist/csr/LinkSimple";
import type { GroupView } from "@rallypoint/domain/contracts";
import { useApi } from "./use-api";
import { useMutation } from "./use-mutation";
import { DetailPage } from "./ui";
import { PersonName, TitlePill } from "./badges";
import { InvitePanel } from "./invites";
import { DateTile, Face, FaceStack, GroupCrest } from "./visuals";

type Answer = { group?: GroupView; left?: true };
const subscribe = () => () => undefined;
const clientOrigin = () => window.location.origin;
const serverOrigin = () => "";

/**
 * A group (P-35): a list of members. People ask to join through the admin's
 * invite link, or the Join button on a public group; the admin accepts or
 * declines. A private group shows nothing to someone without the link.
 *
 * Layout (owner, 2026-10-30, "Quiet, not boring"): the group's crest and faces
 * lead; each viewer gets one brand-coloured action (admin: Invite people;
 * visitor: Join or Ask to join); requests, upcoming sessions and members are
 * grouped lists that appear only when they have something in them; member
 * actions live in a sheet.
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
  const [inviting, setInviting] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const said_ = useRef("");
  useEffect(() => {
    if (said) note.current?.focus();
  }, [said]);
  const mutation = useMutation<Answer>((value) => {
    setConfirm(null);
    if (value.left) setLeft(true);
    // An answer is read without the invite link. Someone holding the link
    // reads the group again with it, so they can still ask to join.
    if (value.group?.concealed && invite) {
      setChanged(null);
      read.retry();
    } else if (value.group) setChanged(value.group);
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
  const status = (
    <>
      {said ? (
        <p ref={note} tabIndex={-1} role="status" className="game-day__status">
          {said}
        </p>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
    </>
  );
  const cancelButton = (requestId: string) => (
    <button
      type="button"
      className={buttonClass()}
      disabled={busy}
      onClick={() =>
        run("requests/cancel", { requestId }, "Request cancelled.")
      }
    >
      Cancel request
    </button>
  );
  if (group.concealed)
    return (
      <DetailPage back="/workspace" backLabel="Your groups">
        {status}
        <div className="own-status">
          <StatusBanner tone="neutral" icon={<LockSimpleIcon size={22} />}>
            <h1>This group is private.</h1>
            <p>
              {group.request
                ? "Your request to join is waiting for the admin."
                : "Ask its admin for an invite link."}
            </p>
          </StatusBanner>
          {group.request ? cancelButton(group.request.id) : null}
        </div>
      </DetailPage>
    );
  const admin = group.viewerRole === "admin";
  const inviteLink =
    admin && group.inviteToken && origin
      ? `${origin}/groups/${group.id}?invite=${group.inviteToken}`
      : "";
  const request = group.request;
  const members = left ? undefined : group.members;
  const requests = admin ? (group.requests ?? []) : [];
  const upcoming = left ? [] : (group.upcoming ?? []);
  const selected = members?.find(
    (m) => `${m.profileId ?? m.name}` === selectedKey,
  );
  const memberCount = members?.length ?? group.memberCount;

  // The one action this person has here, in the brand colour (D-15).
  const action = left ? (
    <p>You left this group.</p>
  ) : admin ? (
    <div className="group-actions">
      <button
        type="button"
        className={buttonClass({ variant: "primary" })}
        aria-haspopup="dialog"
        onClick={() => setInviting(true)}
      >
        <UserPlusIcon size={18} aria-hidden="true" />
        Invite people
      </button>
      <Link
        className={iconButtonClass()}
        href={`/groups/${group.id}/edit`}
        aria-label="Edit group"
      >
        <PencilSimpleIcon size={20} aria-hidden="true" />
      </Link>
    </div>
  ) : group.viewerRole === null ? (
    request?.state === "pending" ? (
      <div className="own-status">
        <StatusBanner tone="warning" icon={<HourglassIcon size={22} />}>
          <h2>Request sent. The admin will accept or decline it.</h2>
        </StatusBanner>
        {cancelButton(request.id)}
      </div>
    ) : request?.state === "declined" ? (
      <StatusBanner tone="neutral" icon={<LockSimpleIcon size={22} />}>
        <h2>The admin didn’t accept your request.</h2>
      </StatusBanner>
    ) : group.canAsk ? (
      <div className="group-action">
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
        <p className="rp-help">The admin accepts or declines each request.</p>
      </div>
    ) : null
  ) : null;

  return (
    <DetailPage
      back="/workspace"
      backLabel="Your groups"
      className="group-page"
    >
      <header className="group-hero">
        <GroupCrest id={group.id} name={group.name} />
        <div className="group-hero__text">
          <h1>{group.name}</h1>
          <p className="group-hero__meta">
            {group.visibility === "private" ? (
              <LockSimpleIcon size={16} aria-hidden="true" />
            ) : (
              <GlobeHemisphereWestIcon size={16} aria-hidden="true" />
            )}
            {group.visibility === "private" ? "Private group" : "Public group"}
            {admin ? (
              <Pill tone="neutral">You’re the admin</Pill>
            ) : group.viewerRole === "member" ? (
              <Pill tone="neutral">You’re a member</Pill>
            ) : null}
          </p>
          {memberCount !== undefined ? (
            <p className="group-hero__people">
              {members?.length ? <FaceStack members={members} /> : null}
              {memberCount} {memberCount === 1 ? "member" : "members"}
            </p>
          ) : null}
        </div>
      </header>
      {status}
      {action}

      {requests.length ? (
        <section className="group-section" aria-labelledby="group-requests">
          <h2 id="group-requests">
            {requests.length === 1
              ? "1 person wants to join"
              : `${requests.length} people want to join`}
          </h2>
          <ListGroup>
            {requests.map((r) => (
              <ListRow
                key={r.id}
                leading={<Face name={r.name} />}
                title={
                  <>
                    <PersonName name={r.name} profileId={r.profileId} />
                    <TitlePill title={r.title} />
                  </>
                }
                subtitle={`Played ${r.played} · Hosted ${r.hosted}`}
              >
                {confirm === `decline:${r.id}` ? null : (
                    <div className="group-request__actions">
                      <button
                        type="button"
                        className={buttonClass({ size: "sm" })}
                        disabled={busy}
                        aria-label={`Decline ${r.name}`}
                        onClick={() => setConfirm(`decline:${r.id}`)}
                      >
                        Decline
                      </button>
                      <button
                        type="button"
                        className={buttonClass({ size: "sm" })}
                        disabled={busy}
                        aria-label={`Accept ${r.name}`}
                        onClick={() =>
                          run(
                            "requests/answer",
                            { requestId: r.id, action: "accept" },
                            `${r.name} is in.`,
                          )
                        }
                      >
                        <CheckIcon size={16} aria-hidden="true" />
                        Accept
                      </button>
                    </div>
                )}
                {confirm === `decline:${r.id}` ? (
                  <div className="group-confirm">
                    <p>Decline {r.name}? They can’t ask again for this group.</p>
                    <div className="fee-actions">
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
                        className={buttonClass()}
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
                  </div>
                ) : null}
              </ListRow>
            ))}
          </ListGroup>
        </section>
      ) : null}

      {upcoming.length ? (
        <section className="group-section" aria-labelledby="group-upcoming">
          <h2 id="group-upcoming">Coming up</h2>
          <ul className="rp-list">
            {upcoming.map((s) => (
              <li key={s.slug} className="rp-row">
                <div className="rp-row__line">
                  <Link className="rp-row__main" href={`/s/${s.slug}`}>
                    <span className="rp-row__lead">
                      <DateTile iso={s.startsAt} timeZone={s.timeZone} />
                    </span>
                    <span className="rp-row__text">
                      <span className="rp-row__title">{s.title}</span>
                      <span className="rp-row__sub">
                        {when(s.startsAt, s.timeZone)}
                        {s.activity ? ` · ${s.activity}` : ""}
                      </span>
                    </span>
                  </Link>
                  <span className="rp-row__trail" aria-hidden="true">
                    <CaretRightIcon size={18} />
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {members?.length ? (
        <section className="group-section" aria-labelledby="group-members">
          <h2 id="group-members">Members</h2>
          <ListGroup>
            {members.map((m) => (
              <ListRow
                key={m.profileId ?? m.name}
                leading={<Face name={m.name} />}
                title={
                  <>
                    {m.name}
                    <TitlePill title={m.title} />
                  </>
                }
                subtitle={m.role === "admin" ? "Admin" : undefined}
                onSelect={() => {
                  setConfirm(null);
                  setSelectedKey(`${m.profileId ?? m.name}`);
                }}
                selectHint="Open details"
                trailing={<CaretRightIcon size={18} aria-hidden="true" />}
              />
            ))}
          </ListGroup>
        </section>
      ) : null}

      {admin ? (
        <InvitePanel
          kind="group"
          target={group.id}
          invites={group.invites ?? []}
          sheetOpen={inviting}
          onSheetChange={setInviting}
          sheetTop={
            inviteLink ? (
              <div className="group-invite-link">
                <p>
                  Anyone with the link can ask to join. You accept each
                  request.
                </p>
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
                  <LinkSimpleIcon size={18} aria-hidden="true" />
                  Copy invite link
                </button>
                <p role="status" className="rp-help">
                  {copied}
                </p>
              </div>
            ) : null
          }
          onChanged={() => {
            setChanged(null);
            read.retry();
          }}
        />
      ) : null}

      {group.viewerRole === "member" && !left ? (
        <div className="group-leave">
          {confirm === "leave" ? (
            <div className="group-confirm">
              <p>Leave {group.name}? You can ask to join again later.</p>
              <div className="fee-actions">
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
                  className={buttonClass()}
                  disabled={busy}
                  onClick={() => run("leave", {}, "You left this group.")}
                >
                  Leave group
                </button>
              </div>
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
          )}
        </div>
      ) : null}

      {/* One member's details: their profile, and Remove for the admin. */}
      <Sheet
        open={!!selected}
        onClose={() => setSelectedKey(null)}
        title={selected ? selected.name : "Member"}
      >
        {selected ? (
          <div className="group-member-sheet">
            <div className="group-member-sheet__who">
              <Face name={selected.name} size="lg" />
              <div>
                <TitlePill title={selected.title} />
                <p className="rp-help">
                  {selected.role === "admin" ? "Admin" : "Member"}
                </p>
              </div>
            </div>
            {selected.profileId ? (
              <Link
                className={buttonClass()}
                href={`/people/${selected.profileId}`}
              >
                See profile
              </Link>
            ) : null}
            {admin && selected.role === "member" ? (
              confirm === `remove:${selected.profileId}` ? (
                <div className="group-confirm">
                  <p>
                    Remove {selected.name} from the group? They can ask to join
                    again.
                  </p>
                  <div className="fee-actions">
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
                      className={buttonClass()}
                      disabled={busy}
                      onClick={() => {
                        setSelectedKey(null);
                        run(
                          "members/remove",
                          { profileId: selected.profileId },
                          `Removed ${selected.name}.`,
                        );
                      }}
                    >
                      Remove
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  className={buttonClass({ variant: "link" })}
                  disabled={busy}
                  onClick={() => setConfirm(`remove:${selected.profileId}`)}
                >
                  Remove from group
                </button>
              )
            ) : null}
          </div>
        ) : null}
      </Sheet>
    </DetailPage>
  );
}

const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
