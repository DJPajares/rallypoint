"use client";
import Link from "next/link";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { CalendarPlusIcon } from "@phosphor-icons/react/dist/csr/CalendarPlus";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { buttonClass } from "@rallypoint/ui";
/** Sessions stand alone (P-35): start one directly, or start a group. */
export function CreatePicker({ onNavigate }: { onNavigate: () => void }) {
  return (
    <div className="picker">
      <ul className="picker-list">
        <li>
          <Link
            className="picker-row"
            href="/sessions/new"
            onClick={onNavigate}
          >
            <span className="rp-icon-tile" aria-hidden="true">
              <CalendarPlusIcon size={22} />
            </span>
            <span>
              <strong>New session</strong>
              <span className="picker-meta">Share one link to fill it</span>
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
