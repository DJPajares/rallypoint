"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PublicConfig } from "@rallypoint/domain/contracts";
import {
  classifyLinkError,
  linkErrorCode,
} from "@rallypoint/domain/auth-links";
import { AuthContext, initial } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const controller = new AbortController();
    // Read before the client starts: it finishes the link and tidies the URL.
    const urlCode = linkErrorCode(window.location.search, window.location.hash);
    void (async () => {
      try {
        const response = await fetch("/api/config", {
          signal: controller.signal,
        });
        if (!response.ok) throw new Error("Configuration unavailable");
        const config = (await response.json()) as PublicConfig;
        if (!active) return;
        if (!config.auth) {
          setState({ ...initial, config, loading: false });
          return;
        }
        const { createClient } = await import("@supabase/supabase-js");
        if (!active) return;
        const client = createClient(
          config.auth.url,
          config.auth.publishableKey,
          { auth: { flowType: "pkce", storageKey: "rallypoint.auth" } },
        );
        const { data: listener } = client.auth.onAuthStateChange(
          (event, session) => {
            if (active)
              setState((previous) => ({
                ...previous,
                config,
                client,
                session,
                // Loading ends below, once any email link's outcome is known,
                // so the callback never judges a link before it is finished.
                loading: previous.loading,
                error: null,
                recovery: previous.recovery || event === "PASSWORD_RECOVERY",
              }));
          },
        );
        unsubscribe = () => listener.subscription.unsubscribe();
        // A confirmation or reset link is finished during initialize; its
        // failure is reported here, not by getSession.
        const { error: linkFailure } = await client.auth.initialize();
        const linkError =
          urlCode || linkFailure
            ? classifyLinkError(urlCode, linkFailure?.code)
            : null;
        const {
          data: { session },
          error,
        } = await client.auth.getSession();
        if (error) throw error;
        if (active)
          setState((previous) => ({
            ...previous,
            config,
            client,
            session,
            loading: false,
            error: null,
            linkError,
          }));
      } catch {
        if (active)
          setState({
            ...initial,
            loading: false,
            error: "Sign-in could not be loaded. Refresh to try again.",
          });
      }
    })();
    return () => {
      active = false;
      controller.abort();
      unsubscribe?.();
    };
  }, []);
  return <AuthContext value={state}>{children}</AuthContext>;
}
