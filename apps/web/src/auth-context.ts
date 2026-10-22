"use client";
import { createContext, useContext } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import type { PublicConfig } from "@rallypoint/domain/contracts";
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
export { safeReturnPath } from "@rallypoint/domain/navigation";
