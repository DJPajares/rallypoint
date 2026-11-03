"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { buttonClass, cx, Pill } from "@rallypoint/ui";
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
  createHref,
  createLabel = "New session",
}: {
  title: ReactNode;
  summary?: ReactNode;
  /** The page's add button, beside its title at every size: opens the picker. */
  onCreate?: () => void;
  /** Or goes straight to a form. */
  createHref?: string;
  createLabel?: string;
}) {
  const createClass = cx(
    buttonClass({ variant: "primary" }),
    "col-start-2! row-span-2 row-start-1 inline-flex",
  );
  return (
    <header className="grid grid-cols-[1fr_auto] items-end gap-x-4 gap-y-2 *:col-start-1 [&_h1]:m-0 [&_h1]:text-display-md [&_h1]:leading-[1.05]">
      <h1>{title}</h1>
      {summary ? (
        <p className="m-0 text-base text-muted-foreground">{summary}</p>
      ) : null}
      {createHref ? (
        <Link className={createClass} href={createHref}>
          <PlusIcon size={18} weight="bold" aria-hidden="true" />
          {createLabel}
        </Link>
      ) : onCreate ? (
        <button type="button" className={createClass} onClick={onCreate}>
          <PlusIcon size={18} weight="bold" aria-hidden="true" />
          {createLabel}
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
    <li className="border-t border-border first:border-t-0">
      <div className="flex min-h-13 items-center gap-2">
        <Link
          className="flex min-h-13 min-w-0 flex-1 items-center gap-3 border-0 bg-transparent py-2 pr-3 pl-3 text-left text-inherit no-underline [font:inherit] [a&]:hover:bg-muted [button&]:cursor-pointer [button&]:hover:bg-muted focus-visible:-outline-offset-3"
          href={sessionHref(row)}
        >
          <span className="inline-flex flex-none">
            {row.startsAt ? (
              <DateTile
                iso={row.startsAt}
                timeZone={row.timeZone}
                variant={today ? "today" : "default"}
              />
            ) : (
              <span
                className="inline-grid w-11 place-items-center rounded-sm bg-muted py-1 leading-[1.1]"
                aria-hidden="true"
              >
                <CalendarDotsIcon size={22} />
              </span>
            )}
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-semibold">
              {row.title || "Untitled session"}
              {speakDate && row.startsAt ? (
                <span className="sr-only">, {spokenDay(row)}</span>
              ) : null}
            </span>
            <span className="truncate text-sm text-muted-foreground">
              {where || row.groupName}
            </span>
            {/* On a phone the pills sit under the line, so titles keep room. */}
            <span className="mt-1 hidden flex-wrap gap-1 max-[520px]:flex">
              {pills}
            </span>
          </span>
          <span className="inline-flex flex-none items-center gap-2 text-muted-foreground">
            <span className="inline-flex flex-wrap gap-1 max-[520px]:hidden">
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
    <li className="border-t border-border first:border-t-0">
      <div className="flex min-h-13 items-center gap-2">
        <Link
          className="flex min-h-13 min-w-0 flex-1 items-center gap-3 border-0 bg-transparent py-2 pr-3 pl-3 text-left text-inherit no-underline [font:inherit] [a&]:hover:bg-muted [button&]:cursor-pointer [button&]:hover:bg-muted focus-visible:-outline-offset-3"
          href={`/groups/${group.id}`}
        >
          <span className="inline-flex flex-none">
            <GroupCrest id={group.id} name={group.name} size="sm" />
          </span>
          <span className="grid min-w-0 flex-1">
            <span className="truncate font-semibold">{group.name}</span>
            <span className="inline-flex items-center gap-1 truncate text-sm text-muted-foreground">
              {group.visibility === "private" ? (
                <LockSimpleIcon size={14} aria-hidden="true" />
              ) : null}
              {facts.join(" · ")}
            </span>
          </span>
          <span className="inline-flex flex-none items-center gap-2 text-muted-foreground">
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
    <Link
      className="grid grid-cols-[auto_1fr_auto] items-center gap-5 rounded-xl border border-border bg-card p-6 text-inherit no-underline shadow-sm hover:border-input focus-visible:shadow-focus focus-visible:outline-none max-[520px]:grid-cols-[auto_1fr] max-[520px]:gap-4 max-[520px]:p-5"
      href={sessionHref(row)}
    >
      <span>
        {row.startsAt ? (
          <DateTile iso={row.startsAt} timeZone={row.timeZone} variant="hero" />
        ) : null}
      </span>
      <span className="grid min-w-0 gap-1">
        <span className="text-sm font-semibold text-link">
          Up next{soon ? ` · ${soon}` : ""}
        </span>
        <span className="font-heading text-display-sm leading-[1.15] font-bold wrap-anywhere">
          {row.title || "Untitled session"}
          {row.startsAt ? (
            <span className="sr-only">, {spokenDay(row)}</span>
          ) : null}
        </span>
        <span className="text-muted-foreground">
          {[time, row.location].filter(Boolean).join(" · ") || row.groupName}
        </span>
        <span className="mt-2 flex flex-wrap gap-2">
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
      <CaretRightIcon
        className="text-muted-foreground max-[520px]:hidden"
        size={22}
        aria-hidden="true"
      />
    </Link>
  );
}
