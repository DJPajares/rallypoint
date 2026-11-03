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

test("an ended search says how the match went, never naming a no-show", () => {
  const say = (endReason) => endedLabel({ endReason, partner: null });
  assert.equal(say("match_won"), "You won your last match.");
  assert.equal(say("match_lost"), "You lost your last match.");
  assert.equal(
    say("match_missed"),
    "You didn’t check in, so your last match counted as a loss.",
  );
  assert.equal(
    say("match_void"),
    "Your last match didn’t count, so no ranks changed.",
  );
});
