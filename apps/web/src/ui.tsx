"use client";
import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { useDetailChrome } from "./frame";
// Shared visual components live in @rallypoint/ui. This file keeps only the
// pieces that depend on the app frame.
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
