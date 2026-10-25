// Reading what came back from a Supabase email link (D-22). Pure helpers: the
// page decides what to say; nothing here grants access.

/** Why a confirmation or reset link did not sign someone in. */
export type LinkError = "other_browser" | "expired" | "invalid";

const expiredCodes = [
  "otp_expired",
  "flow_state_expired",
  "flow_state_not_found",
];

/** The error Supabase put on the redirect, from the query or the #fragment. */
export function linkErrorCode(search: string, hash: string): string | null {
  for (const params of [
    new URLSearchParams(search),
    new URLSearchParams(hash.replace(/^#/, "")),
  ]) {
    const code = params.get("error_code") ?? params.get("error");
    if (code) return code;
  }
  return null;
}

/**
 * A missing PKCE verifier means the link opened in another browser or device:
 * Supabase already confirmed the email before redirecting, so that is not a
 * failed link.
 */
export function classifyLinkError(
  urlCode: string | null,
  errorCode: string | undefined,
): LinkError {
  if ([urlCode, errorCode].some((code) => code && expiredCodes.includes(code)))
    return "expired";
  if (errorCode === "pkce_code_verifier_not_found") return "other_browser";
  return "invalid";
}

/**
 * What an email link on this page load amounts to, or null when it worked or
 * there was none. A `?code=` with no stored verifier is another browser:
 * auth-js skips the exchange then and reports nothing, so it is read here.
 */
export function linkOutcome(input: {
  urlCode: string | null;
  errorCode: string | undefined;
  hasCode: boolean;
  hasVerifier: boolean;
}): LinkError | null {
  if (input.urlCode || input.errorCode)
    return classifyLinkError(input.urlCode, input.errorCode);
  return input.hasCode && !input.hasVerifier ? "other_browser" : null;
}

/**
 * Supabase limits sends per email only for addresses it would mail, so showing
 * that limit would say an account exists. Such a reply reads as sent.
 */
export const hidesAccount = (code: string | undefined) =>
  code === "over_email_send_rate_limit";

/**
 * Whether this session came from a password reset link, read from the access
 * token's amr claim. Routing only: the token is not verified here, and the API
 * never trusts this.
 */
export function isRecoverySession(accessToken: string): boolean {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return false;
    const json = atob(payload.replace(/-/g, "+").replace(/_/g, "/"));
    const amr: unknown = JSON.parse(json).amr;
    return (
      Array.isArray(amr) &&
      amr.some(
        (entry) =>
          typeof entry === "object" &&
          entry !== null &&
          (entry as { method?: unknown }).method === "recovery",
      )
    );
  } catch {
    return false;
  }
}
