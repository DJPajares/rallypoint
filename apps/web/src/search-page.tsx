"use client";
import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MagnifyingGlassIcon } from "@phosphor-icons/react/dist/csr/MagnifyingGlass";
import { Input, Segmented } from "@rallypoint/ui";
import { SearchSessions } from "./search-sessions";
import { SearchClubs, SearchPeople } from "./search-people";

type Tab = "sessions" | "people" | "clubs";
const tabs: Array<{ value: Tab; label: string }> = [
  { value: "sessions", label: "Sessions" },
  { value: "people", label: "People" },
  { value: "clubs", label: "Clubs" },
];
const placeholders: Record<Tab, string> = {
  sessions: "Search sessions",
  people: "Search people",
  clubs: "Search clubs",
};

/**
 * Search (D-27): public sessions by day, people with a public profile, and
 * public clubs. One box searches whichever is chosen; the choice is kept in
 * the address so Back returns to it.
 */
export function SearchPage() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const tab = (tabs.find((t) => t.value === params.get("tab"))?.value ??
    "sessions") as Tab;
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
  const choose = (next: Tab) =>
    router.replace(next === "sessions" ? pathname : `${pathname}?tab=${next}`, {
      scroll: false,
    });
  const q = shown.length >= 2 ? shown : "";
  return (
    <section
      className="mx-auto grid max-w-form content-start gap-5"
      aria-labelledby="search-title"
    >
      <h1 id="search-title" className="m-0 text-display-md leading-[1.05]">
        Search
      </h1>
      <div className="grid gap-3">
        <label htmlFor="search" className="sr-only">
          {placeholders[tab]}
        </label>
        <div className="relative">
          <MagnifyingGlassIcon
            size={20}
            aria-hidden="true"
            className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id="search"
            type="search"
            className="pl-10"
            placeholder={placeholders[tab]}
            value={query}
            maxLength={40}
            autoComplete="off"
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <Segmented
          label="Search for"
          options={tabs}
          value={tab}
          onChange={choose}
        />
      </div>
      <p className="sr-only" role="status">
        {status}
      </p>
      {tab === "sessions" ? (
        <SearchSessions query={q} onStatus={setStatus} />
      ) : tab === "people" ? (
        <SearchPeople query={q} onStatus={setStatus} />
      ) : (
        <SearchClubs query={q} onStatus={setStatus} />
      )}
    </section>
  );
}
