"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { buttonClass, Pill } from "@rallypoint/ui";
import { CalendarDotsIcon } from "@phosphor-icons/react/dist/csr/CalendarDots";
import { PlusIcon } from "@phosphor-icons/react/dist/csr/Plus";
import type { Tone } from "@rallypoint/ui";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import {
  sessionHref,
  startsIn,
  statusLabel,
} from "@rallypoint/domain/my-sessions";
import type { MySessionRow } from "@rallypoint/domain/my-sessions";
import type { GroupSummary } from "@rallypoint/domain/contracts";
import { fromLocal } from "./dates";
import { DateTile, GroupCrest } from "./visuals";

/*
 * The parts Home, Sessions and Groups share (owner, 2026-10-30), so the three
 * tabs keep one look: the same heading, the same session row and the same
 * group row wherever they appear.
 */

/** A tab's large title and one line of what's true right now. */
export function TabHero({
  title,
  summary,
  onCreate,
}: {
  title: ReactNode;
  summary?: ReactNode;
  /** New session, shown on tablet and desktop where there's no + tab. */
  onCreate?: () => void;
}) {
  return (
    <header className="tab-hero">
      <h1>{title}</h1>
      {summary ? <p className="tab-hero__summary">{summary}</p> : null}
      {onCreate ? (
        <button
          type="button"
          className={`${buttonClass({ variant: "primary" })} tab-hero__action`}
          onClick={onCreate}
        >
          <PlusIcon size={18} weight="bold" aria-hidden="true" />
          New session
        </button>
      ) : null}
    </header>
  );
}

/** A row's day in words for screen readers, where no day heading says it. */
const spokenDay = (row: MySessionRow) =>
  row.startsAt
    ? new Intl.DateTimeFormat("en", {
        timeZone: row.timeZone,
        weekday: "long",
        month: "long",
        day: "numeric",
      }).format(new Date(row.startsAt))
    : "";

/** Every status gets words and a tone; colour only supports the words (D-15). */
const statusTone: Record<MySessionRow["status"], Tone> = {
  in: "success",
  organizing: "neutral",
  waitlisted: "warning",
  requested: "neutral",
  not_accepted: "neutral",
  request_expired: "neutral",
  removed: "neutral",
  draft: "neutral",
  cancelled: "danger",
};

/** One session: its date tile, title, time and place, and where you stand. */
export function SessionRow({
  row,
  past,
  today,
  speakDate,
}: {
  row: MySessionRow;
  past: boolean;
  /** Today's sessions stand out a little in a list. */
  today?: boolean;
  /** Say the day aloud when no day heading above the row says it. */
  speakDate?: boolean;
}) {
  const time = fromLocal(row.startLocal)?.time;
  const where = [time, row.location].filter(Boolean).join(" · ");
  const pills = (
    <>
      {row.requestCount ? (
        <Pill tone="warning">
          {row.requestCount} {row.requestCount === 1 ? "request" : "requests"}
        </Pill>
      ) : null}
      <Pill tone={statusTone[row.status]}>{statusLabel(row, past)}</Pill>
    </>
  );
  return (
    <li className={today ? "rp-row tab-row tab-row--today" : "rp-row tab-row"}>
      <div className="rp-row__line">
        <Link className="rp-row__main" href={sessionHref(row)}>
          <span className="rp-row__lead">
            {row.startsAt ? (
              <DateTile iso={row.startsAt} timeZone={row.timeZone} />
            ) : (
              <span className="group-date" aria-hidden="true">
                <CalendarDotsIcon size={22} />
              </span>
            )}
          </span>
          <span className="rp-row__text">
            <span className="rp-row__title">
              {row.title || "Untitled session"}
              {speakDate && row.startsAt ? (
                <span className="rp-sr-only">, {spokenDay(row)}</span>
              ) : null}
            </span>
            <span className="rp-row__sub">{where || row.groupName}</span>
            {/* On a phone the pills sit under the line, so titles keep room. */}
            <span className="tab-row__pills tab-row__pills--below">
              {pills}
            </span>
          </span>
          <span className="rp-row__trail">
            <span className="tab-row__pills tab-row__pills--beside">
              {pills}
            </span>
            <CaretRightIcon size={16} aria-hidden="true" />
          </span>
        </Link>
      </div>
    </li>
  );
}

/** One group: its crest, name, your role, who can find it and its size. */
export function GroupRow({ group }: { group: GroupSummary }) {
  const facts = [
    group.role === "admin" ? "Admin" : "Member",
    group.visibility === "private" ? "Private" : "Public",
    group.memberCount !== undefined
      ? `${group.memberCount} ${group.memberCount === 1 ? "member" : "members"}`
      : "",
  ].filter(Boolean);
  return (
    <li className="rp-row tab-row">
      <div className="rp-row__line">
        <Link className="rp-row__main" href={`/groups/${group.id}`}>
          <span className="rp-row__lead tab-row__crest">
            <GroupCrest id={group.id} name={group.name} />
          </span>
          <span className="rp-row__text">
            <span className="rp-row__title">{group.name}</span>
            <span className="rp-row__sub tab-row__facts">
              {group.visibility === "private" ? (
                <LockSimpleIcon size={14} aria-hidden="true" />
              ) : null}
              {facts.join(" · ")}
            </span>
          </span>
          <span className="rp-row__trail">
            <CaretRightIcon size={16} aria-hidden="true" />
          </span>
        </Link>
      </div>
    </li>
  );
}

/**
 * Home's hero: the next session you're going to, as a big ticket. How soon,
 * what, when and where, and where you stand; a host also sees who's waiting
 * and who still owes. The whole card opens the session.
 */
export function UpNext({ row, now }: { row: MySessionRow; now: number }) {
  const time = fromLocal(row.startLocal)?.time;
  const soon = startsIn(row.startsAt, row.endsAt, now);
  return (
    <Link className="up-next" href={sessionHref(row)}>
      <span className="up-next__date">
        {row.startsAt ? (
          <DateTile iso={row.startsAt} timeZone={row.timeZone} />
        ) : null}
      </span>
      <span className="up-next__body">
        <span className="up-next__eyebrow">
          Up next{soon ? ` · ${soon}` : ""}
        </span>
        <span className="up-next__title">
          {row.title || "Untitled session"}
          {row.startsAt ? (
            <span className="rp-sr-only">, {spokenDay(row)}</span>
          ) : null}
        </span>
        <span className="up-next__where">
          {[time, row.location].filter(Boolean).join(" · ") || row.groupName}
        </span>
        <span className="up-next__pills">
          <Pill tone={statusTone[row.status]}>{statusLabel(row, false)}</Pill>
          {row.waitingCount ? (
            <Pill tone="warning">{row.waitingCount} waiting</Pill>
          ) : null}
          {row.toPayCount ? (
            <Pill tone="warning">{row.toPayCount} to pay</Pill>
          ) : null}
          {row.requestCount ? (
            <Pill tone="warning">
              {row.requestCount}{" "}
              {row.requestCount === 1 ? "request" : "requests"}
            </Pill>
          ) : null}
        </span>
      </span>
      <CaretRightIcon className="up-next__go" size={22} aria-hidden="true" />
    </Link>
  );
}
