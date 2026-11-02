"use client";
import type { MouseEvent, ReactNode } from "react";
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
  onBack,
}: {
  back: string;
  backLabel: string;
  children: ReactNode;
  className?: string;
  /** Called first; preventDefault keeps the page, e.g. to confirm leaving. */
  onBack?: (event: MouseEvent<HTMLAnchorElement>) => void;
}) {
  useDetailChrome();
  return (
    <section className={className}>
      <Link
        className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-muted-foreground no-underline hover:text-foreground max-md:fixed max-md:top-[calc(var(--safe-top)+12px)] max-md:left-[max(var(--layout-gutter),var(--safe-left))] max-md:z-(--layer-float) max-md:m-0 max-md:size-touch max-md:justify-center max-md:rounded-full max-md:border max-md:border-border max-md:bg-card max-md:text-foreground max-md:shadow-sm group-data-signed-out/app:max-md:static group-data-signed-out/app:max-md:mb-4 group-data-signed-out/app:max-md:size-auto group-data-signed-out/app:max-md:border-0 group-data-signed-out/app:max-md:bg-transparent group-data-signed-out/app:max-md:shadow-none"
        href={back}
        onClick={onBack}
        data-slot="back-chip"
      >
        <ArrowLeftIcon size={20} aria-hidden="true" />
        <span className="max-md:sr-only group-data-signed-out/app:max-md:not-sr-only">
          {backLabel}
        </span>
      </Link>
      {children}
    </section>
  );
}
/** The page's primary actions: pinned above the home indicator on phones, inline elsewhere. */
export function StickyActions({ children }: { children: ReactNode }) {
  return (
    <div
      data-slot="sticky-actions"
      className="mt-5 flex flex-wrap items-center gap-2 max-md:glass-card max-md:fixed max-md:inset-x-0 max-md:bottom-0 max-md:z-(--layer-sticky) max-md:m-0 max-md:flex-nowrap max-md:border-t max-md:border-border max-md:pt-3 max-md:pr-[max(var(--layout-gutter),var(--safe-right))] max-md:pb-[calc(12px+var(--safe-bottom))] max-md:pl-[max(var(--layout-gutter),var(--safe-left))] max-md:*:data-[slot=button]:flex-1 max-md:[&>button]:flex-1 max-md:[&>a]:flex-1"
    >
      {children}
    </div>
  );
}
