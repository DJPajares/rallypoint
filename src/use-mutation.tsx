import { useEffect, useRef, useState } from "react";
import { useAuth } from "./auth-context";
export function useMutation<T>(done: (result: T) => void) {
  const { session } = useAuth();
  const [job, setJob] = useState<{
    path: string;
    body: Record<string, unknown>;
  } | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<string | null>(null);
  const active = useRef<AbortController | null>(null);
  const pending = useRef(false);
  useEffect(() => () => active.current?.abort(), []);
  async function send(
    path: string,
    body: Record<string, unknown>,
    check = false,
  ) {
    if (active.current && !active.current.signal.aborted) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        check ? `/api/operations/${body.operationKey}` : path,
        {
          method: check ? "GET" : "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session?.access_token}`,
          },
          body: check ? undefined : JSON.stringify(body),
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(10000),
          ]),
        },
      );
      const result = await response.json();
      if (!response.ok) {
        if (response.status < 500 && !(check && response.status === 404)) {
          pending.current = false;
          setJob(null);
        }
        throw new Error(
          result.error?.message ?? "The action could not be confirmed.",
        );
      }
      if (!controller.signal.aborted) {
        pending.current = false;
        setJob(null);
        done(result);
      }
    } catch (e) {
      if (!controller.signal.aborted)
        setError(
          e instanceof Error && e.name === "Error"
            ? e.message
            : "The connection was interrupted. Check the result or retry the same request.",
        );
    } finally {
      if (active.current === controller) active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return {
    busy,
    error,
    uncertain: !!job,
    run: (path: string, body: Record<string, unknown>) => {
      if (pending.current || active.current) return;
      pending.current = true;
      const next = { ...body, operationKey: crypto.randomUUID() };
      setJob({ path, body: next });
      void send(path, next);
    },
    recovery: job ? (
      <div className="request-recovery">
        <p>
          The result has not been confirmed. Your submitted details and request
          key are preserved while this page stays open.
        </p>
        <button
          type="button"
          disabled={busy}
          className="button secondary"
          onClick={() => void send(job.path, job.body, true)}
        >
          Check result
        </button>
        <button
          type="button"
          disabled={busy}
          className="text-button"
          onClick={() => void send(job.path, job.body)}
        >
          Retry same request
        </button>
      </div>
    ) : null,
  };
}
