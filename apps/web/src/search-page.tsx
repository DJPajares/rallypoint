"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { LockSimpleIcon } from "@phosphor-icons/react/dist/csr/LockSimple";
import { buttonClass, Field, Notice, Pending } from "@rallypoint/ui";
import { sessionHref, statusLabel } from "@rallypoint/domain/my-sessions";
import type { MySessionRow } from "@rallypoint/domain/my-sessions";
import { useApi } from "./use-api";

type Found = {
  id?: string;
  name: string;
  visibility: "public" | "private";
  viewerRole?: "admin" | "member" | null;
};
type Results = { groups: Found[]; sessions: MySessionRow[] };

/**
 * Universal search, opened from the menu (owner, 2026-10-30). It finds groups
 * by name (P-37: a public group, or one you're in, opens its page; a private
 * group shows only its name) and your own sessions by title. Other people's
 * sessions and people can't be searched.
 */
export function SearchPage() {
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState("");
  // One status line stays on the page so screen readers hear each change.
  const [status, setStatus] = useState("");
  // Searching waits for a pause in typing, so each keystroke isn't a request.
  useEffect(() => {
    const timer = setTimeout(() => setShown(query.trim()), 300);
    return () => clearTimeout(timer);
  }, [query]);
  useEffect(() => {
    document.title = "Search · RallyPoint";
  }, []);
  return (
    <section className="page search" aria-labelledby="search-title">
      <div className="page-head">
        <h1 id="search-title">Search</h1>
      </div>
      <Field
        id="search"
        label="Search groups and your sessions"
        help="Type at least 2 letters."
      >
        <input
          id="search"
          type="search"
          aria-describedby="search-help"
          value={query}
          maxLength={40}
          autoComplete="off"
          // The menu opened this page to search, so the field is ready.
          autoFocus
          onChange={(e) => setQuery(e.target.value)}
        />
      </Field>
      <p className="rp-help" role="status">
        {shown.length >= 2 ? status : ""}
      </p>
      {shown.length >= 2 ? (
        <Found query={shown} onStatus={setStatus} />
      ) : null}
    </section>
  );
}

function Found({
  query,
  onStatus,
}: {
  query: string;
  onStatus: (text: string) => void;
}) {
  const found = useApi<Results>(`/api/search?q=${encodeURIComponent(query)}`);
  // Read once per search, so a row reads past or upcoming steadily.
  const [now] = useState(() => Date.now());
  const groups = found.data?.groups ?? [];
  const sessions = found.data?.sessions ?? [];
  const count = groups.length + sessions.length;
  const status =
    found.loading || found.error
      ? ""
      : count
        ? `${count} ${count === 1 ? "result" : "results"} found.`
        : "Nothing found.";
  useEffect(() => onStatus(status), [onStatus, status]);
  if (found.loading) return <Pending>Searching…</Pending>;
  if (found.error) return <Notice retry={found.retry}>{found.error}</Notice>;
  return (
    <>
      {sessions.length ? (
        <section aria-labelledby="search-sessions">
          <h2 id="search-sessions">Your sessions</h2>
          <ul className="join-requests__list">
            {sessions.map((s) => {
              const past = !!s.endsAt && Date.parse(s.endsAt) <= now;
              return (
                <li key={s.slug} className="join-request access-option">
                  <p className="join-request__name">
                    <strong>{s.title || "Untitled session"}</strong>
                    <span className="join-request__facts">
                      {s.startsAt ? `${when(s.startsAt, s.timeZone)} · ` : ""}
                      {statusLabel(s, past)}
                    </span>
                  </p>
                  <Link
                    href={sessionHref(s)}
                    className={buttonClass()}
                    aria-label={`Open ${s.title || "session"}`}
                  >
                    Open
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
      {groups.length ? (
        <section aria-labelledby="search-groups">
          <h2 id="search-groups">Groups</h2>
          <ul className="join-requests__list">
            {groups.map((g, i) => (
              <li
                key={g.id ?? `private-${i}`}
                className="join-request access-option"
              >
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
        </section>
      ) : null}
    </>
  );
}

// A session's time reads in its own local time, never with a zone label (D-13).
const when = (iso: string, timeZone: string) =>
  new Intl.DateTimeFormat("en", {
    timeZone,
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
