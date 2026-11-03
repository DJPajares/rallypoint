import { test } from "node:test";
import assert from "node:assert/strict";
import { rankLabel, rankedCategories } from "../packages/domain/src/ranked.ts";

test("rankLabel names rank and format", () => {
  assert.equal(
    rankLabel({ activity: "pickleball", format: "doubles", rank: "Gold" }),
    "Gold · Doubles",
  );
  assert.equal(
    rankLabel({
      activity: "badminton",
      format: "mixed-doubles",
      rank: "Diamond",
    }),
    "Diamond · Mixed doubles",
  );
});

test("rankedCategories drops unknown ranks and shapes", () => {
  const good = { activity: "pickleball", format: "singles", rank: "Silver" };
  assert.deepEqual(
    rankedCategories([
      good,
      { activity: "pickleball", format: "doubles", rank: "Unranked" },
      { activity: "pickleball", rank: "Gold" },
      null,
      "Gold",
    ]),
    [good],
  );
  assert.deepEqual(rankedCategories(undefined), []);
  assert.deepEqual(rankedCategories({ ranks: [good] }), []);
});
