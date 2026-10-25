"use client";
import { useState } from "react";
import { useAuth } from "./auth-context";
import { forgetReturnPath } from "./return-path";

/** Ends this browser's session and leaves every protected page behind. */
export function useSignOut() {
  const { client } = useAuth();
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function signOut() {
    setLeaving(true);
    setError(null);
    const result = await client?.auth.signOut({ scope: "local" });
    if (result?.error) {
      setError("Sign-out did not finish. Please try again.");
      setLeaving(false);
      return;
    }
    forgetReturnPath();
    // Clear protected App Router trees as well as the managed Auth session.
    // A soft redirect can race the signed-out guard on the current private page.
    window.location.replace("/");
  }
  return { signOut, leaving, error };
}
