"use client";
import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import { useDetailChrome } from "./frame";
import type { TicketDate } from "./dates";
export function Pending({
  children = "Getting things ready…",
}: {
  children?: ReactNode;
}) {
  return (
    <p role="status" className="status">
      <CircleNotchIcon className="spin" size={20} />
      {children}
    </p>
  );
}
export function Notice({
  children,
  retry,
}: {
  children: ReactNode;
  retry?: () => void;
}) {
  return (
    <div className="notice" role="alert">
      <WarningCircleIcon size={22} />
      <div>
        {children}
        {retry ? (
          <button className="text-button" onClick={retry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
/**
 * A native modal dialog: the browser traps focus, closes on Escape and returns
 * focus to whatever opened it. Anchored to the bottom edge on phones.
 * Children mount only while open, so a sheet's data loads when it is wanted.
 */
export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal();
    else if (!open && element.open) element.close();
  }, [open]);
  return (
    <dialog
      ref={dialog}
      className="sheet"
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(event) => {
        // A click on the dialog box itself (not its content) is the backdrop.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      {open ? (
        <div className="sheet-body">
          <div className="sheet-head">
            <h2 id={titleId}>{title}</h2>
            <button
              type="button"
              className="chip-button"
              aria-label="Close"
              onClick={onClose}
            >
              <XIcon size={20} />
            </button>
          </div>
          {children}
        </div>
      ) : null}
    </dialog>
  );
}
export function EmptyState({
  icon,
  title,
  children,
  action,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon" aria-hidden="true">
        {icon}
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
      {action}
    </div>
  );
}
export type Tone = "ok" | "wait" | "closed" | "danger";
/** Status always carries an icon and words; the color only reinforces them. */
export function StatusBanner({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className={`status-banner tone-${tone}`}>
      <span aria-hidden="true">{icon}</span>
      <div>{children}</div>
    </div>
  );
}
export function SpotsMeter({
  capacity,
  taken,
}: {
  capacity: number;
  taken: number;
}) {
  const open = Math.max(capacity - taken, 0);
  const safeCapacity = Number.isFinite(capacity) && capacity > 0 ? capacity : 0;
  return (
    <div className="spots">
      <p className="spots-text nums">
        <strong>
          {taken} of {safeCapacity} {safeCapacity === 1 ? "seat" : "seats"}{" "}
          taken
        </strong>
        <span>{open === 0 ? "Full" : `${open} left`}</span>
      </p>
      {safeCapacity > 0 && safeCapacity <= 24 ? (
        <div className="spots-dots" aria-hidden="true">
          {Array.from({ length: safeCapacity }, (_, i) => (
            <span key={i} className={i < taken ? "dot taken" : "dot"} />
          ))}
        </div>
      ) : safeCapacity > 0 ? (
        <div className="spots-bar" aria-hidden="true">
          <span
            style={{
              width: `${Math.min(100, Math.round((taken / safeCapacity) * 100))}%`,
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
export function TicketStub({ date }: { date: TicketDate | null }) {
  return (
    <span className="ticket-stub" aria-hidden="true">
      {date ? (
        <>
          <span>{date.weekday}</span>
          <strong className="nums">{date.day}</strong>
          <span>{date.month}</span>
        </>
      ) : (
        <strong>?</strong>
      )}
    </span>
  );
}
export function Ticket({
  date,
  children,
}: {
  date: TicketDate | null;
  children: ReactNode;
}) {
  return (
    <div className="ticket">
      <TicketStub date={date} />
      <div className="ticket-body">{children}</div>
    </div>
  );
}
/**
 * Wraps a page that is reached from somewhere else. On a phone the tab bar
 * gives way to a round back chip; on larger screens it is a plain back link.
 */
export function DetailPage({
  back,
  backLabel,
  children,
  className = "",
}: {
  back: string;
  backLabel: string;
  children: ReactNode;
  className?: string;
}) {
  useDetailChrome();
  return (
    <section className={`page detail-page ${className}`}>
      <Link className="back-chip" href={back}>
        <ArrowLeftIcon size={20} aria-hidden="true" />
        <span>{backLabel}</span>
      </Link>
      {children}
    </section>
  );
}
/** The page's primary actions: pinned above the home indicator on phones, inline elsewhere. */
export function StickyActions({ children }: { children: ReactNode }) {
  return <div className="sticky-actions">{children}</div>;
}
