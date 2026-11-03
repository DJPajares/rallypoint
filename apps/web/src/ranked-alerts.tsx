"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { buttonClass, Notice } from "@rallypoint/ui";
import { rankedAlerts } from "@rallypoint/domain/ranked-alerts";
import type { RankedAlert } from "@rallypoint/domain/ranked-alerts";
import type { MySearch } from "@rallypoint/domain/ranked-search";
import { useAuth } from "./auth-context";
import { regionLabel } from "./ranked-labels";
import { useMutation } from "./use-mutation";

/** How often an open, visible app checks for ranked news (the engine runs every minute). */
const REFRESH_MS = 60_000;

const RankedAlertsContext = createContext<{
  alerts: RankedAlert[];
  refresh: () => void;
}>({ alerts: [], refresh: () => {} });

export function useRankedAlerts() {
  return useContext(RankedAlertsContext);
}

const dateTimeLabel = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
  });
const formatLabel = (format: string) =>
  format === "doubles" ? "Doubles" : "Singles";

/**
 * What ranked play is waiting on the signed-in person (D-26, WDL-423), kept
 * fresh while the app is open: every minute while it's visible, when it
 * comes back into view, and on every page change. A failed check keeps what
 * was last known. In-app only; nothing is sent anywhere else.
 */
export function RankedAlertsProvider({
  enabled,
  children,
}: {
  enabled: boolean;
  children: ReactNode;
}) {
  const { session } = useAuth();
  const token = enabled ? (session?.access_token ?? "") : "";
  const pathname = usePathname();
  const [known, setKnown] = useState<{
    token: string;
    mine: MySearch;
  } | null>(null);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => setTick((n) => n + 1), []);
  useEffect(() => {
    if (!token) return;
    const controller = new AbortController();
    fetch("/api/ranked/search", {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(7000)]),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((mine: MySearch | null) => {
        if (mine && !controller.signal.aborted) setKnown({ token, mine });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [token, pathname, tick]);
  useEffect(() => {
    if (!token) return;
    const check = () => {
      if (document.visibilityState === "visible") refresh();
    };
    const timer = setInterval(check, REFRESH_MS);
    document.addEventListener("visibilitychange", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", check);
    };
  }, [token, refresh]);
  // Another person's items never outlive their session.
  const mine = known && known.token === token ? known.mine : null;
  const value = useMemo(
    () => ({ alerts: rankedAlerts(mine), refresh }),
    [mine, refresh],
  );
  return <RankedAlertsContext value={value}>{children}</RankedAlertsContext>;
}

function describe(alert: RankedAlert) {
  switch (alert.kind) {
    case "match":
      return `${formatLabel(alert.format)} match found · accept by ${dateTimeLabel(alert.deadline)}`;
    case "invite":
      return `${alert.starterName} invited you to play ranked ${formatLabel(alert.format)} · answer by ${dateTimeLabel(alert.deadline)}`;
    case "widen":
      return `No ranked match yet. Look across all of ${regionLabel(alert.regions)}? Your search runs until ${dateLabel(alert.deadline)}.`;
  }
}

/**
 * The waiting items with their actions: on Home, and in the menu's Updates
 * sheet. Renders `empty` (or nothing) when there is nothing to show.
 */
export function RankedAlertList({
  heading = true,
  empty = null,
}: {
  heading?: boolean;
  empty?: ReactNode;
}) {
  const { alerts, refresh } = useRankedAlerts();
  const [said, setSaid] = useState("");
  const note = useRef<HTMLParagraphElement>(null);
  const message = useRef("");
  useEffect(() => {
    if (said) note.current?.focus();
  }, [said]);
  const mutation = useMutation<unknown>(() => {
    setSaid(message.current);
    refresh();
  });
  const busy = mutation.busy || mutation.uncertain;
  if (!alerts.length && !said && !mutation.error) return empty;
  const act = (path: string, body: Record<string, unknown>, text: string) => {
    message.current = text;
    mutation.run(path, body);
  };
  return (
    <section
      className="grid gap-3 rounded-lg border border-border bg-card p-5 [&_h2]:m-0"
      aria-labelledby={heading ? "ranked-alerts" : undefined}
      aria-label={heading ? undefined : "Waiting on you"}
    >
      {heading && alerts.length ? (
        <h2 id="ranked-alerts">Waiting on you ({alerts.length})</h2>
      ) : null}
      {said ? (
        <p ref={note} tabIndex={-1} role="status" className="m-0 text-sm">
          {said}
        </p>
      ) : null}
      {mutation.error ? <Notice>{mutation.error}</Notice> : null}
      {mutation.recovery}
      {alerts.length ? (
        <ul className="m-0 grid list-none gap-4 p-0">
          {alerts.map((alert) => (
            <li key={alert.key} className="grid gap-2 [&_p]:m-0">
              <p>{describe(alert)}</p>
              <div className="flex flex-wrap gap-2">
                {alert.kind === "match" ? (
                  <>
                    <button
                      type="button"
                      className={buttonClass({ variant: "primary" })}
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/api/ranked/matches/${alert.matchId}/answer`,
                          { accept: true },
                          "Match accepted.",
                        )
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className={buttonClass()}
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/api/ranked/matches/${alert.matchId}/answer`,
                          { accept: false },
                          "Match declined.",
                        )
                      }
                    >
                      Decline
                    </button>
                    <Link
                      className={buttonClass({ variant: "link" })}
                      href="/ranked"
                    >
                      See the match
                    </Link>
                  </>
                ) : alert.kind === "invite" ? (
                  <>
                    <button
                      type="button"
                      className={buttonClass({ variant: "primary" })}
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/api/ranked/invites/${alert.token}`,
                          { accept: true },
                          "Invite accepted. You’re searching together.",
                        )
                      }
                    >
                      Accept
                    </button>
                    <button
                      type="button"
                      className={buttonClass()}
                      disabled={busy}
                      onClick={() =>
                        act(
                          `/api/ranked/invites/${alert.token}`,
                          { accept: false },
                          "Invite declined.",
                        )
                      }
                    >
                      Decline
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    className={buttonClass()}
                    disabled={busy}
                    onClick={() =>
                      act(
                        `/api/ranked/search/${alert.searchId}/widen`,
                        {},
                        `Now looking across ${regionLabel(alert.regions)}.`,
                      )
                    }
                  >
                    Look across {regionLabel(alert.regions)}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
