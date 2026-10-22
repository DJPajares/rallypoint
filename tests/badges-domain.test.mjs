import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeCatalog,
  newestUnseen,
  nextBadge,
  parseBadgeId,
  progressLabel,
  titleLabel,
} from "../packages/domain/src/badges.ts";

const group = "0f8fad5b-d9cb-469f-a165-70867728950e";
const earned = (key, earnedAt, seen = false) => ({
  id: key,
  key,
  groupId: null,
  groupName: null,
  earnedAt,
  seen,
});
const progress = (key, current, target) => ({
  key,
  groupId: null,
  groupName: null,
  current,
  target,
});

test("catalog keys are unique and 15 long", () => {
  const keys = badgeCatalog.map((badge) => badge.key);
  assert.equal(keys.length, 15);
  assert.equal(new Set(keys).size, 15);
});

test("parseBadgeId accepts plain and group ids and rejects everything else", () => {
  assert.deepEqual(parseBadgeId("first-rally"), {
    key: "first-rally",
    groupId: null,
  });
  assert.deepEqual(parseBadgeId(`regular:${group}`), {
    key: "regular",
    groupId: group,
  });
  for (const bad of [
    "regular",
    `first-rally:${group}`,
    `Regular:${group}`,
    `regular:${group.toUpperCase()}`,
    "regular:not-a-uuid",
    "",
    "x".repeat(81),
    "streak-7",
  ])
    assert.equal(parseBadgeId(bad), null, bad);
});

test("titleLabel joins a group name with a middle dot", () => {
  assert.equal(
    titleLabel({ key: "regular", groupName: "Sunday Dink" }),
    "Regular · Sunday Dink",
  );
  assert.equal(
    titleLabel({ key: "first-rally", groupName: null }),
    "First Rally",
  );
});

test("newestUnseen picks the newest unseen and counts the rest", () => {
  const badges = [
    earned("first-rally", "2026-10-01T00:00:00Z"),
    earned("plus-one", "2026-10-03T00:00:00Z"),
    earned("host", "2026-10-02T00:00:00Z"),
    earned("full-house", "2026-10-09T00:00:00Z", true),
  ];
  const result = newestUnseen(badges);
  assert.equal(result.badge.key, "plus-one");
  assert.equal(result.more, 2);
  assert.equal(
    newestUnseen(badges.map((badge) => ({ ...badge, seen: true }))),
    null,
  );
});

test("progressLabel says what is left in plain words", () => {
  assert.equal(
    progressLabel({ ...progress("regular", 4, 5), groupName: "Sunday Dink" }),
    "1 more session at Sunday Dink",
  );
  assert.equal(
    progressLabel(progress("sessions-10", 3, 10)),
    "7 more sessions",
  );
  assert.equal(
    progressLabel(progress("new-faces-10", 9, 10)),
    "1 more new person",
  );
  assert.equal(
    progressLabel(progress("hosted-10", 2, 10)),
    "8 more sessions to run",
  );
});

test("nextBadge prefers the closest badge and ignores empty or finished progress", () => {
  assert.equal(
    nextBadge([progress("sessions-10", 3, 10), progress("regular", 4, 5)]).key,
    "regular",
  );
  assert.equal(
    nextBadge([progress("regular", 0, 5), progress("hosted-10", 10, 10)]),
    null,
  );
});
