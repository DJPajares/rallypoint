import { test } from "node:test";
import assert from "node:assert/strict";
import { safeReturnPath } from "../packages/domain/src/navigation.ts";
test("valid local auth return paths survive rendering without a browser", () => {
  assert.equal(
    safeReturnPath("/s/example?view=places#status"),
    "/s/example?view=places#status",
  );
});
test("auth return paths reject foreign origins, backslashes and auth loops", () => {
  for (const value of [
    null,
    "https://example.com/",
    "//example.com",
    "/\\example.com",
    "/sign-in?next=/",
    "/auth/callback",
  ]) {
    assert.equal(safeReturnPath(value), "/workspace");
  }
});
