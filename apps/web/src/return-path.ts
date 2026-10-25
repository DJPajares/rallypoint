"use client";
import { safeReturnPath } from "@rallypoint/domain/navigation";

// Where to go after signing in. Kept in localStorage, not sessionStorage, so an
// email link opened in a new tab still finds it (D-22). Always re-validated.
const key = "rallypoint.returnTo";

export function rememberReturnPath(next: string) {
  try {
    localStorage.setItem(key, safeReturnPath(next));
  } catch {
    // Storage can be blocked; the person then lands on the default page.
  }
}

/** The remembered path, once: reading it clears it. */
export function takeReturnPath(): string {
  try {
    const value = localStorage.getItem(key);
    localStorage.removeItem(key);
    return safeReturnPath(value);
  } catch {
    return safeReturnPath(null);
  }
}

export function forgetReturnPath() {
  try {
    localStorage.removeItem(key);
  } catch {
    // Nothing stored, nothing to clear.
  }
}

/** The one redirect address Supabase allows for this site's email links. */
export const redirectUrl = () => `${window.location.origin}/auth/callback`;
