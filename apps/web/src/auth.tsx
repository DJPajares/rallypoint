"use client";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import type { PublicConfig } from "@rallypoint/domain/contracts";
import { AuthContext, initial } from "./auth-context";

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(initial);
  useEffect(() => {
    let active = true;
    let unsubscribe: (() => void) | undefined;
    const controller = new AbortController();
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
          (_event, session) => {
            if (active)
              setState({
                config,
                client,
                session,
                loading: false,
                error: null,
              });
          },
        );
        unsubscribe = () => listener.subscription.unsubscribe();
        const {
          data: { session },
          error,
        } = await client.auth.getSession();
        if (error) throw error;
        if (active)
          setState({ config, client, session, loading: false, error: null });
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
