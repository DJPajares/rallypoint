import { createContext, useContext } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { PublicConfig } from "./shared/contracts";
interface AuthState {
  config: PublicConfig | null;
  client: SupabaseClient | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
}
export const initial: AuthState = {
  config: null,
  client: null,
  session: null,
  loading: true,
  error: null,
};
export const AuthContext = createContext<AuthState>(initial);
export const useAuth = () => useContext(AuthContext);
export function safeReturnPath(value: string | null) {
  if (!value?.startsWith("/") || value.startsWith("//") || value.includes("\\"))
    return "/workspace";
  try {
    const url = new URL(value, window.location.origin);
    return url.origin === window.location.origin &&
      !["/sign-in", "/auth/callback"].includes(url.pathname)
      ? url.pathname + url.search + url.hash
      : "/workspace";
  } catch {
    return "/workspace";
  }
}
