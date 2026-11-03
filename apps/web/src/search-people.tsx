"use client";
import { useEffect } from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { Notice } from "@rallypoint/ui";
import { RankPills, RingAvatar } from "./badges";
import { ListSkeleton } from "./skeletons";
import { useApi } from "./use-api";

type Person = {
  profileId: string;
  name: string;
  activities: Array<{ name: string; level: string | null }>;
  ranks: unknown;
};
type Club = {
  id?: string;
  name: string;
  visibility: "public" | "private";
  members?: number;
  viewerRole?: "admin" | "member" | null;
};

const levelLabel = (level: string | null) =>
  level ? level[0].toUpperCase() + level.slice(1) : null;
const rowLink =
  "flex items-center gap-3 px-4 py-3 text-foreground no-underline hover:bg-muted focus-visible:outline-offset-[-3px]";
const listShell =
  "m-0 grid list-none divide-y divide-border overflow-hidden rounded-xl border border-border bg-card p-0";

function Hint({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 rounded-xl border border-dashed border-border px-5 py-8 text-muted-foreground">
      {children}
    </p>
  );
}

/** People with a public profile, found by name; never browsed (D-27). */
export function SearchPeople({
  query,
  onStatus,
}: {
  query: string;
  onStatus: (text: string) => void;
}) {
  useEffect(() => {
    if (!query) onStatus("");
  }, [query, onStatus]);
  if (!query)
    return <Hint>Find people by name. Only public profiles show up.</Hint>;
  return <People query={query} onStatus={onStatus} />;
}

function People({
  query,
  onStatus,
}: {
  query: string;
  onStatus: (text: string) => void;
}) {
  const found = useApi<{ people: Person[] }>(
    `/api/search/people?q=${encodeURIComponent(query)}`,
  );
  const people = found.data?.people ?? [];
  const status =
    found.loading || found.error
      ? ""
      : people.length
        ? `${people.length} ${people.length === 1 ? "person" : "people"} found.`
        : "Nobody found.";
  useEffect(() => onStatus(status), [onStatus, status]);
  if (found.loading) return <ListSkeleton label="Searching…" rows={3} />;
  if (found.error) return <Notice retry={found.retry}>{found.error}</Notice>;
  if (!people.length)
    return (
      <Hint>
        Nobody by that name has a public profile. Check the spelling, or ask
        them for their profile link.
      </Hint>
    );
  return (
    <ul className={listShell} aria-label="People">
      {people.map((p) => (
        <li key={p.profileId}>
          <Link href={`/people/${p.profileId}`} className={rowLink}>
            <span className="size-11 shrink-0">
              <RingAvatar name={p.name} size="sm" />
            </span>
            <span className="grid min-w-0 gap-1">
              <strong className="truncate">{p.name}</strong>
              {p.activities.length ? (
                <span className="truncate text-sm text-muted-foreground">
                  {p.activities
                    .map((a) =>
                      levelLabel(a.level)
                        ? `${a.name} (${levelLabel(a.level)})`
                        : a.name,
                    )
                    .join(", ")}
                </span>
              ) : null}
              <span className="flex flex-wrap gap-1 empty:hidden">
                <RankPills ranks={p.ranks} />
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/** Public clubs, biggest first; a search also names private ones (P-37). */
export function SearchClubs({
  query,
  onStatus,
}: {
  query: string;
  onStatus: (text: string) => void;
}) {
  const found = useApi<{ clubs: Club[] }>(
    query
      ? `/api/search/clubs?q=${encodeURIComponent(query)}`
      : "/api/search/clubs",
  );
  const clubs = found.data?.clubs ?? [];
  const status =
    found.loading || found.error
      ? ""
      : clubs.length
        ? `${clubs.length} ${clubs.length === 1 ? "club" : "clubs"}${query ? " found" : ""}.`
        : "No clubs found.";
  useEffect(() => onStatus(status), [onStatus, status]);
  if (found.loading) return <ListSkeleton label="Finding clubs…" rows={4} />;
  if (found.error) return <Notice retry={found.retry}>{found.error}</Notice>;
  if (!clubs.length)
    return (
      <Hint>
        {query
          ? "No club by that name. Clubs show here when their organizers make them public."
          : "No public clubs yet."}
      </Hint>
    );
  return (
    <ul className={listShell} aria-label="Clubs">
      {clubs.map((club, i) => (
        <li key={club.id ?? `${club.name}-${i}`}>
          {club.id ? (
            <Link href={`/groups/${club.id}`} className={rowLink}>
              <span className="grid min-w-0 gap-0.5">
                <strong className="truncate">{club.name}</strong>
                <span className="text-sm text-muted-foreground">
                  {club.members} {club.members === 1 ? "member" : "members"}
                  {club.viewerRole ? ", including you" : ""}
                </span>
              </span>
            </Link>
          ) : (
            <span className="flex items-center gap-3 px-4 py-3">
              <span className="grid min-w-0 gap-0.5">
                <strong className="truncate">{club.name}</strong>
                <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
                  <LockSimpleIcon size={14} aria-hidden="true" />
                  Private club: ask an organizer for an invite
                </span>
              </span>
            </span>
          )}
        </li>
      ))}
    </ul>
  );
}
