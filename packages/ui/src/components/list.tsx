"use client";
import { useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../lib/utils";
import {
  listClass,
  rowClass,
  rowLeadClass,
  rowLineClass,
  rowMainClass,
  rowSubClass,
  rowTextClass,
  rowTitleClass,
  rowTrailClass,
  toneClass,
} from "./list-classes";
import type { Tone } from "./feedback";

// The quiet building blocks (PRD D-15/D-17): repeated things are rows in one
// inset group, not a card each.
export function ListGroup({
  label,
  children,
}: {
  /** Names the list for assistive technology when no heading precedes it. */
  label?: string;
  children: ReactNode;
}) {
  return (
    <ul className={listClass} aria-label={label}>
      {children}
    </ul>
  );
}

/**
 * One row: a leading picture, a title and a subtitle, and a trailing control.
 * With `onSelect` the title area is a button of its own, so a trailing control
 * (a check, a toggle) stays a separate target.
 */
export function ListRow({
  leading,
  title,
  subtitle,
  trailing,
  onSelect,
  selectHint,
  className,
  children,
}: {
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  trailing?: ReactNode;
  onSelect?: () => void;
  /**
   * Hidden words added after the row's visible text, such as "Open details".
   * The visible text stays the accessible name, so nothing shown is lost.
   */
  selectHint?: string;
  className?: string;
  /** Anything that belongs to the row but sits below it, like an error. */
  children?: ReactNode;
}) {
  const body = (
    <>
      {leading ? <span className={rowLeadClass}>{leading}</span> : null}
      <span className={rowTextClass}>
        <span data-slot="row-title" className={rowTitleClass}>
          {title}
        </span>
        {subtitle ? <span className={rowSubClass}>{subtitle}</span> : null}
      </span>
    </>
  );
  return (
    <li className={cn(rowClass, className)}>
      <div className={rowLineClass}>
        {onSelect ? (
          <button type="button" className={rowMainClass} onClick={onSelect}>
            {body}
            {selectHint ? <span className="sr-only">{selectHint}</span> : null}
          </button>
        ) : (
          <div className={rowMainClass}>{body}</div>
        )}
        {trailing ? <span className={rowTrailClass}>{trailing}</span> : null}
      </div>
      {children}
    </li>
  );
}

/** A small status label: an icon and words, the colour only reinforces them. */
export function Pill({
  tone,
  icon,
  children,
}: {
  tone: Tone;
  icon?: ReactNode;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs leading-[1.6] font-semibold whitespace-nowrap",
        toneClass[tone],
      )}
    >
      {icon ? <span aria-hidden="true">{icon}</span> : null}
      {children}
    </span>
  );
}

/** A few big numbers in one row, each with its label underneath. */
export function StatRow({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="m-0 grid auto-cols-fr grid-flow-col rounded-lg bg-surface shadow-sm">
      {items.map((item) => (
        <div
          key={item.label}
          className="flex flex-col-reverse border-l border-border py-3 text-center first:border-l-0"
        >
          <dt className="text-xs text-text-muted">{item.label}</dt>
          <dd className="m-0 font-heading text-2xl leading-tight font-extrabold tabular-nums">
            {item.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Choose one view of the same list. A radio group: Tab reaches the chosen
 * option, arrow keys move between options.
 */
export function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: Array<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  function onKeyDown(event: KeyboardEvent, index: number) {
    const step =
      event.key === "ArrowRight" || event.key === "ArrowDown"
        ? 1
        : event.key === "ArrowLeft" || event.key === "ArrowUp"
          ? -1
          : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + options.length) % options.length;
    onChange(options[next].value);
    refs.current[next]?.focus();
  }
  return (
    <div
      data-slot="segmented"
      className="flex rounded-md bg-surface-sunken p-0.5"
      role="radiogroup"
      aria-label={label}
    >
      {options.map((option, index) => (
        <button
          key={option.value}
          ref={(el) => {
            refs.current[index] = el;
          }}
          type="button"
          role="radio"
          aria-checked={option.value === value}
          tabIndex={option.value === value ? 0 : -1}
          className="min-h-control-sm flex-1 rounded-sm border-0 bg-transparent px-2 py-1 text-sm font-semibold text-text-muted transition-colors duration-150 ease-standard focus-visible:outline-offset-0.5 aria-checked:bg-surface aria-checked:text-text aria-checked:shadow-sm"
          onClick={() => onChange(option.value)}
          onKeyDown={(event) => onKeyDown(event, index)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
