"use client";
import Link from "next/link";
import { ArrowRightIcon } from "@phosphor-icons/react/dist/csr/ArrowRight";
import { PlusCircleIcon } from "@phosphor-icons/react/dist/csr/PlusCircle";
import { UsersThreeIcon } from "@phosphor-icons/react/dist/csr/UsersThree";
import type { GroupSummary } from "@rallypoint/domain/contracts";
import { useApi } from "./use-api";
import { buttonClass, Notice, Pending } from "@rallypoint/ui";
/** Sessions belong to a group, so creating one starts with choosing where. */
export function CreatePicker({ onNavigate }: { onNavigate: () => void }) {
  const workspace = useApi<{ groups: GroupSummary[] }>("/api/workspace");
  const groups =
    workspace.data?.groups.filter((group) => group.role !== "member") ?? [];
  return (
    <div className="picker">
      {workspace.loading ? (
        <Pending>Finding your groups…</Pending>
      ) : workspace.error ? (
        <Notice retry={workspace.retry}>{workspace.error}</Notice>
      ) : groups.length ? (
        <>
          <p className="rp-help">Choose the group this session is for.</p>
          <ul className="picker-list">
            {groups.map((group) => (
              <li key={group.id}>
                <Link
                  className="picker-row"
                  href={`/groups/${group.id}/sessions/new`}
                  onClick={onNavigate}
                >
                  <span className="rp-icon-tile" aria-hidden="true">
                    <UsersThreeIcon size={22} />
                  </span>
                  <span>
                    <strong>{group.name}</strong>
                    <span className="picker-meta">New session</span>
                  </span>
                  <ArrowRightIcon size={18} aria-hidden="true" />
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p className="rp-help">
          You can create sessions in groups you own or help organize. Start a
          group to plan your first one.
        </p>
      )}
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
