"use client";
import type { ReactNode } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { cn } from "../lib/utils";
import { buttonClass } from "../classes";
import { Alert } from "./ui/alert";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
} from "./ui/empty";
import { Spinner } from "./ui/spinner";
/** Something is loading; the words say what. */
export function Pending({
  children = "Getting things ready…",
}: {
  children?: ReactNode;
}) {
  return (
    <p role="status" className="flex items-center gap-2 text-text-muted">
      <Spinner
        role={undefined}
        aria-label={undefined}
        aria-hidden="true"
        className="size-5"
      />
      {children}
    </p>
  );
}
/** A problem the person should know about, with a way to try again. */
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
    <Alert variant={tone} className="my-4 flex items-start gap-2">
      <WarningCircleIcon className="shrink-0" size={22} aria-hidden="true" />
      <div>
        {children}
        {retry ? (
          <button
            type="button"
            className={cn(
              buttonClass({ variant: "link" }),
              "flex min-h-10 text-inherit",
            )}
            onClick={retry}
          >
            Try again
          </button>
        ) : null}
      </div>
    </Alert>
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
    <Alert
      variant={tone}
      role={undefined}
      className="flex items-start gap-2 rounded-lg text-base [&_h2]:mb-0.5 [&_h2]:text-xl [&_h2]:text-inherit [&_p]:m-0"
    >
      <span className="mt-0.5 inline-flex" aria-hidden="true">
        {icon}
      </span>
      <div>{children}</div>
    </Alert>
  );
}
/** Nothing here yet: an icon, a heading, what will appear, and an action. */
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
    <Empty className="mx-auto my-6 max-w-110 gap-0 px-5 py-8">
      <EmptyHeader className="max-w-none gap-0">
        <EmptyMedia
          className="mb-4 size-16 rounded-xl bg-action font-bold text-on-action"
          aria-hidden="true"
        >
          {icon}
        </EmptyMedia>
        <Heading>{title}</Heading>
        <EmptyDescription className="text-base text-text-muted">
          <p>{children}</p>
        </EmptyDescription>
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
