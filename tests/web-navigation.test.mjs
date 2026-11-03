import assert from "node:assert/strict";
import test from "node:test";
import { destinations, isActive } from "../apps/web/src/navigation.ts";

test("the bottom bar offers Ranked in place of Dues", () => {
  assert.deepEqual(
    destinations.map((d) => d.label),
    ["Home", "Sessions", "Groups", "Ranked"],
  );
  assert.equal(destinations.find((d) => d.key === "ranked")?.href, "/ranked");
});

test("a ranked invite link keeps Ranked highlighted", () => {
  assert.equal(isActive("/ranked", "/ranked"), true);
  assert.equal(isActive("/ranked/invite/abc", "/ranked"), true);
  assert.equal(isActive("/rankedx", "/ranked"), false);
});
