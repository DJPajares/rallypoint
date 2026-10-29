"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { buttonClass, Field, Notice, Pending } from "@rallypoint/ui";
import { useApi } from "./use-api";

type Found = {
  id?: string;
  name: string;
  visibility: "public" | "private";
  viewerRole?: "admin" | "member" | null;
};

/**
 * P-37: find a group by name. A public group, or one you're in, opens its
 * page, where you can ask to join. A private group shows only its name; you
 * join it by invite.
 */
export function GroupSearch() {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState("");
  // Searching waits for a pause in typing, so each keystroke isn't a request.
  useEffect(() => {
    const timer = setTimeout(() => setShown(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  return (
    <section className="group-search" aria-label="Find a group">
      <Field
        id="group-search"
        label="Find a group"
        help="Search by group name."
      >
        <input
          id="group-search"
          type="search"
          aria-describedby="group-search-help"
          value={query}
          maxLength={40}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      {shown.length >= 2 ? <Results query={shown} /> : null}
    </section>
  );
}

function Results({ query }: { query: string }) {
  const found = useApi<{ groups: Found[] }>(
    `/api/groups/search?q=${encodeURIComponent(query)}`,
  );
  if (found.loading) return <Pending>Searching groups…</Pending>;
  if (found.error)
    return <Notice retry={found.retry}>{found.error}</Notice>;
  const groups = found.data?.groups ?? [];
  return (
    <>
      <p className="rp-help" role="status">
        {groups.length
          ? `${groups.length} ${groups.length === 1 ? "group" : "groups"} found.`
          : "No group by that name."}
      </p>
      {groups.length ? (
        <ul className="join-requests__list">
          {groups.map((g, i) => (
            <li key={g.id ?? `private-${i}`} className="join-request access-option">
              <p className="join-request__name">
                <strong>{g.name}</strong>
                <span className="join-request__facts">
                  {g.viewerRole ? (
                    "Your group"
                  ) : g.visibility === "public" ? (
                    "Public"
                  ) : (
                    <span className="session-private">
                      <LockSimpleIcon size={14} aria-hidden="true" />
                      Private · join by invite
                    </span>
                  )}
                </span>
              </p>
              {g.id ? (
                <Link
                  href={`/groups/${g.id}`}
                  className={buttonClass()}
                  aria-label={`Open ${g.name}`}
                >
                  Open
                </Link>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </>
  );
}
