"use client";
import type { ReactNode } from "react";
import { CircleNotchIcon } from "@phosphor-icons/react/dist/csr/CircleNotch";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { cx } from "../cx";
export function Pending({
  children = "Getting things ready…",
}: {
  children?: ReactNode;
}) {
  return (
    <p role="status" className="rp-pending">
      <CircleNotchIcon className="rp-spin" size={20} aria-hidden="true" />
      {children}
    </p>
  );
}
export function Notice({
  children,
  retry,
  tone = "danger",
}: {
  children: ReactNode;
  retry?: () => void;
  tone?: "danger" | "warning";
}) {
  return (
    <div
      className={cx("rp-notice", tone === "warning" && "rp-notice--warning")}
      role="alert"
    >
      <WarningCircleIcon size={22} aria-hidden="true" />
      <div>
        {children}
        {retry ? (
          <button className="rp-button rp-button--link" onClick={retry}>
            Try again
          </button>
        ) : null}
      </div>
    </div>
  );
}
export type Tone = "success" | "warning" | "neutral" | "danger";
/** Status always carries an icon and words; the colour only reinforces them. */
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
    <div className={`rp-status rp-tone-${tone}`}>
      <span className="rp-status__icon" aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </div>
  );
}
export function EmptyState({
  icon,
  title,
  children,
  action,
  headingLevel = 2,
}: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
  headingLevel?: 1 | 2;
}) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <div className="rp-empty">
      <span className="rp-empty__icon" aria-hidden="true">
        {icon}
      </span>
      <Heading>{title}</Heading>
      <p>{children}</p>
      {action}
    </div>
  );
}
