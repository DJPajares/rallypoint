"use client";
import type { ReactNode } from "react";
import { cx, Skeleton } from "@rallypoint/ui";

/*
 * Loading skeletons (owner, 2026-11-02): while a page reads, it shows the
 * shape of what's coming instead of a spinner, so nothing jumps when the
 * content lands. Each skeleton mirrors its page's real layout. The shapes
 * are decorative; one status line says what's loading for screen readers.
 * Reduced motion stops the pulse (@rallypoint/ui/globals.css), leaving still shapes.
 */

/** One placeholder shape. */
function Bone({ className }: { className?: string }) {
  return (
    <Skeleton
      aria-hidden="true"
      className={cx("h-4 rounded-sm bg-muted", className)}
    />
  );
}

/** Says what's loading, once, to screen readers; shows only the shapes. */
function Loading({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div role="status" className={cx("grid content-start gap-5", className)}>
      <span className="sr-only">{label}</span>
      {children}
    </div>
  );
}

/** A tab's large title and its one-line summary. */
function TitleBones() {
  return (
    <div className="grid gap-3">
      <Bone className="h-10 w-48 rounded-md" />
      <Bone className="w-64 max-w-full" />
    </div>
  );
}

/** Rows like a session or group list: a tile, a title and a line under it. */
function RowBones({ rows = 3 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg bg-card shadow-sm">
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          className="flex min-h-13 items-center gap-3 border-t border-border px-3 py-2 first:border-t-0"
        >
          <Bone className="h-11 w-11 flex-none rounded-md" />
          <div className="grid flex-1 gap-2">
            <Bone className={i % 2 ? "w-1/2" : "w-2/3"} />
            <Bone className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A card of text lines, like a form panel or a block of details. */
function CardBones({
  lines = 3,
  action,
}: {
  lines?: number;
  action?: boolean;
}) {
  return (
    <div className="grid gap-3 rounded-lg border border-border bg-card p-5">
      <Bone className="h-5 w-40" />
      {Array.from({ length: lines }, (_, i) => (
        <Bone key={i} className={i === lines - 1 ? "w-3/5" : "w-full"} />
      ))}
      {action ? <Bone className="mt-1 h-11 w-36 rounded-full" /> : null}
    </div>
  );
}

/** Home's Up next card: the date tile beside what, when and where. */
function UpNextBones() {
  return (
    <div className="grid grid-cols-[auto_1fr] items-center gap-5 rounded-xl border border-border bg-card p-6 shadow-sm max-[520px]:gap-4 max-[520px]:p-5">
      <Bone className="h-22 w-19 rounded-lg max-[520px]:w-16" />
      <div className="grid gap-3">
        <Bone className="h-3 w-24" />
        <Bone className="h-7 w-3/4 rounded-md" />
        <Bone className="w-1/2" />
      </div>
    </div>
  );
}

export function UpNextSkeleton() {
  return (
    <Loading label="Finding what's next…">
      <UpNextBones />
    </Loading>
  );
}

/** Home, Sessions, Groups, Dues and Search: a title, then a list. */
export function TabSkeleton({
  label,
  upNext,
  rows = 4,
}: {
  label: string;
  /** Home leads with its big Up next card. */
  upNext?: boolean;
  rows?: number;
}) {
  return (
    <Loading label={label} className="mx-auto w-full max-w-form">
      <TitleBones />
      {upNext ? <UpNextBones /> : null}
      <RowBones rows={rows} />
    </Loading>
  );
}

/** A list inside a page or panel: people, invites, records, results. */
export function ListSkeleton({
  label,
  rows = 3,
}: {
  label: string;
  rows?: number;
}) {
  return (
    <Loading label={label}>
      <RowBones rows={rows} />
    </Loading>
  );
}

/** The group page: the crest beside the name, then its sections. */
export function GroupSkeleton() {
  return (
    <Loading label="Opening the group…">
      <div className="grid grid-cols-[auto_1fr] items-start gap-4">
        <Bone className="aspect-square h-auto w-21 rounded-xl max-[520px]:w-16" />
        <div className="grid gap-3 pt-1">
          <Bone className="h-10 w-3/4 rounded-md" />
          <Bone className="w-1/2" />
        </div>
      </div>
      <Bone className="h-6 w-32" />
      <RowBones rows={2} />
      <Bone className="h-6 w-28" />
      <RowBones rows={3} />
    </Loading>
  );
}

/** The session page: the hero, the spots, then Your place and the details. */
export function SessionSkeleton() {
  return (
    <Loading label="Opening the session…" className="gap-6">
      <div className="grid grid-cols-[auto_1fr] items-start gap-5 max-[520px]:gap-4">
        <Bone className="h-22 w-19 rounded-lg max-[520px]:w-16" />
        <div className="grid gap-3 pt-1">
          <Bone className="h-3 w-40" />
          <Bone className="h-10 w-4/5 rounded-md" />
          <Bone className="w-1/2" />
          <Bone className="w-2/5" />
        </div>
      </div>
      <div className="grid gap-2 rounded-lg border border-border bg-card p-4">
        <Bone className="w-28" />
        <Bone className="h-3 w-40" />
      </div>
      <div className="grid items-start gap-5 md:grid-cols-[minmax(0,1fr)_minmax(300px,360px)] md:gap-x-8 desk:grid-cols-[minmax(0,1fr)_380px] desk:gap-x-12">
        <div className="md:col-start-2 md:row-start-1">
          <PanelSkeletonBones />
        </div>
        <div className="md:col-start-1 md:row-start-1">
          <CardBones lines={4} />
        </div>
      </div>
    </Loading>
  );
}

function PanelSkeletonBones() {
  return <CardBones lines={3} action />;
}

/** "Your place" while the viewer's registration is read. */
export function PanelSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label}>
      <PanelSkeletonBones />
    </Loading>
  );
}

/** Forms: sign in, new or edit session, group and profile. */
export function FormSkeleton({
  label,
  fields = 4,
}: {
  label: string;
  fields?: number;
}) {
  return (
    <Loading label={label} className="mx-auto w-full max-w-form">
      <Bone className="h-10 w-56 rounded-md" />
      {Array.from({ length: fields }, (_, i) => (
        <div key={i} className="grid gap-2">
          <Bone className="h-3 w-28" />
          <Bone className="h-11 w-full rounded-md" />
        </div>
      ))}
      <Bone className="h-11 w-40 rounded-full" />
    </Loading>
  );
}

/** A profile: the face and name, then badges. */
export function ProfileSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label} className="mx-auto w-full max-w-160">
      <div className="flex items-center gap-4">
        <Bone className="size-20 flex-none rounded-full" />
        <div className="grid flex-1 gap-3">
          <Bone className="h-8 w-1/2 rounded-md" />
          <Bone className="w-1/3" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Bone key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    </Loading>
  );
}

/** Badges on your own profile, under the header that's already shown. */
export function BadgesSkeleton({ label }: { label: string }) {
  return (
    <Loading label={label}>
      <div className="grid grid-cols-3 gap-3 max-[520px]:grid-cols-2">
        {Array.from({ length: 6 }, (_, i) => (
          <Bone key={i} className="h-28 w-full rounded-lg" />
        ))}
      </div>
    </Loading>
  );
}

/** A page whose shape isn't known yet, such as before sign-in is checked. */
export function PageSkeleton({
  label = "Getting things ready…",
}: {
  label?: string;
}) {
  return <TabSkeleton label={label} rows={3} />;
}
