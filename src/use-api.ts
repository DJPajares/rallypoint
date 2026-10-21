import { useEffect, useState } from "react";
import { useAuth } from "./auth-context";
export function useApi<T>(path: string) {
  const { session } = useAuth();
  const token = session?.access_token ?? "";
  const [attempt, setAttempt] = useState(0);
  const key = path + token + attempt;
  const [state, setState] = useState<{
    key: string;
    data: T | null;
    error: string | null;
    loading: boolean;
  }>({ key: "", data: null, error: null, loading: true });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch(path, {
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(7000),
          ]),
        });
        const body = await response.json();
        if (!response.ok)
          throw new Error(body.error?.message ?? "Please try again.");
        if (!controller.signal.aborted)
          setState({ key, data: body, error: null, loading: false });
      } catch (error) {
        if (!controller.signal.aborted)
          setState({
            key,
            data: null,
            error:
              error instanceof Error
                ? error.message
                : "The connection was interrupted.",
            loading: false,
          });
      }
    })();
    return () => controller.abort();
  }, [key, path, token, attempt]);
  // Clear previous identity data synchronously, before the next effect runs.
  return {
    ...(state.key === key ? state : { data: null, error: null, loading: true }),
    retry: () => setAttempt((x) => x + 1),
  };
}
