import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyLinkError,
  hidesAccount,
  isRecoverySession,
  linkErrorCode,
  linkOutcome,
} from "../packages/domain/src/auth-links.ts";
import { safeReturnPath } from "../packages/domain/src/navigation.ts";

test("link errors are told apart", () => {
  assert.equal(
    classifyLinkError(null, "pkce_code_verifier_not_found"),
    "other_browser",
  );
  assert.equal(classifyLinkError("otp_expired", undefined), "expired");
  assert.equal(classifyLinkError(null, "flow_state_expired"), "expired");
  assert.equal(classifyLinkError(null, "flow_state_not_found"), "expired");
  assert.equal(classifyLinkError(null, "bad_code_verifier"), "invalid");
  assert.equal(classifyLinkError(null, undefined), "invalid");
});

test("a link opened where it wasn't requested reads as another browser", () => {
  // auth-js skips the exchange (and reports nothing) when no verifier is stored.
  const base = { urlCode: null, errorCode: undefined };
  assert.equal(
    linkOutcome({ ...base, hasCode: true, hasVerifier: false }),
    "other_browser",
  );
  assert.equal(
    linkOutcome({ ...base, hasCode: true, hasVerifier: true }),
    null,
  );
  assert.equal(
    linkOutcome({ ...base, hasCode: false, hasVerifier: false }),
    null,
  );
  assert.equal(
    linkOutcome({
      urlCode: "otp_expired",
      errorCode: undefined,
      hasCode: false,
      hasVerifier: false,
    }),
    "expired",
  );
  assert.equal(
    linkOutcome({
      urlCode: null,
      errorCode: "bad_code_verifier",
      hasCode: true,
      hasVerifier: true,
    }),
    "invalid",
  );
});

test("the per-email send limit is not shown, so it can't reveal an account", () => {
  assert.equal(hidesAccount("over_email_send_rate_limit"), true);
  assert.equal(hidesAccount("over_request_rate_limit"), false);
  assert.equal(hidesAccount(undefined), false);
});

test("a link's error code is read from the query or the fragment", () => {
  assert.equal(
    linkErrorCode("?error=access_denied&error_code=otp_expired", ""),
    "otp_expired",
  );
  assert.equal(
    linkErrorCode("", "#error=access_denied&error_code=otp_expired"),
    "otp_expired",
  );
  assert.equal(linkErrorCode("?error=access_denied", ""), "access_denied");
  assert.equal(linkErrorCode("?code=abc", ""), null);
});

test("a recovery session is read from its amr claim", () => {
  const jwt = (payload) =>
    [
      "e30",
      Buffer.from(JSON.stringify(payload)).toString("base64url"),
      "sig",
    ].join(".");
  assert.equal(
    isRecoverySession(jwt({ amr: [{ method: "recovery", timestamp: 1 }] })),
    true,
  );
  assert.equal(
    isRecoverySession(jwt({ amr: [{ method: "password", timestamp: 1 }] })),
    false,
  );
  assert.equal(isRecoverySession(jwt({})), false);
  assert.equal(isRecoverySession("not-a-jwt"), false);
});

test("auth pages never become a return path", () => {
  for (const path of [
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/sign-in",
    "/auth/callback",
  ])
    assert.equal(safeReturnPath(path), "/workspace");
  assert.equal(safeReturnPath("/s/abc?x=1#people"), "/s/abc?x=1#people");
  assert.equal(safeReturnPath("https://evil.test/s/abc"), "/workspace");
});
