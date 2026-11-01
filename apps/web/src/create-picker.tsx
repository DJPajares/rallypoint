"use client";
import Link from "next/link";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { CalendarPlusIcon } from "@phosphor-icons/react/dist/csr/CalendarPlus";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { buttonClass } from "@rallypoint/ui";
/** Sessions stand alone (P-35): start one directly, or start a group. */
export function CreatePicker({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div>
      <ul className="m-0 mb-4 grid list-none gap-2 p-0">
        <li>
          <Link
            className="flex items-center gap-3 rounded-lg border border-border px-3 py-2 text-text no-underline hover:bg-surface-sunken [&>span:nth-child(2)]:flex [&>span:nth-child(2)]:flex-1 [&>span:nth-child(2)]:flex-col"
            href="/sessions/new"
            onClick={onNavigate}
          >
            <span
              className="inline-flex size-icon-tile flex-none items-center justify-center rounded-md bg-surface-sunken text-text"
              aria-hidden="true"
            >
              <CalendarPlusIcon size={22} />
            </span>
            <span>
              <strong>New session</strong>
              <span className="text-sm text-text-muted">
                Share one link to fill it
              </span>
            </span>
            <ArrowRightIcon size={18} aria-hidden="true" />
          </Link>
        </li>
      </ul>
      <Link
        className={buttonClass({ wide: true })}
        href="/groups/new"
        onClick={onNavigate}
      >
        <PlusCircleIcon size={20} aria-hidden="true" />
        Start a group
      </Link>
    </div>
  );
}
