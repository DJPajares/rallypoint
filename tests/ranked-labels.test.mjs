import { test } from "node:test";
import assert from "node:assert/strict";
import { endedLabel, returnedLabel } from "../apps/web/src/ranked-labels.ts";

test("every way back to searching has its own sentence", () => {
  for (const reason of ["declined", "lapsed", "unbooked", "withdrawn"])
    assert.match(returnedLabel[reason], /searching again with your place kept/);
  assert.match(returnedLabel.withdrawn, /withdrew/);
});

test("an ended search says how it ended", () => {
  const partner = { profileId: null, name: "Sam" };
  assert.equal(
    endedLabel({ endReason: "withdrew_match", partner }),
    "You withdrew from the match.",
  );
  assert.equal(
    endedLabel({ endReason: "partner_withdrew_match", partner }),
    "Sam withdrew from the match.",
  );
  assert.equal(
    endedLabel({ endReason: "match_lapsed", partner: null }),
    "The match ran out before everyone accepted.",
  );
  assert.equal(
    endedLabel({ endReason: "expired", partner: null }),
    "It ran out without a match.",
  );
});
