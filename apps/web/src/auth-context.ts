"use client";
import { createContext, useContext } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { PublicConfig } from "@rallypoint/domain/contracts";
import type { LinkError } from "@rallypoint/domain/auth-links";
interface AuthState {
  config: PublicConfig | null;
  client: SupabaseClient | null;
  session: Session | null;
  loading: boolean;
  error: string | null;
  /** Supabase reported a password reset link this page load. */
  recovery: boolean;
  /** Why an email link on this page load did not sign anyone in. */
  linkError: LinkError | null;
}
export const initial: AuthState = {
  config: null,
  client: null,
  session: null,
  loading: true,
  error: null,
  recovery: false,
  linkError: null,
};
export const AuthContext = createContext<AuthState>(initial);
export const useAuth = () => useContext(AuthContext);
export { safeReturnPath } from "@rallypoint/domain/navigation";
