import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeCatalog,
  legacyTitles,
  levelColors,
  levelLabel,
  levelOf,
  levelSentence,
  medallionLabel,
  newestUnseen,
  nextBadge,
  nextTarget,
  parseLevelId,
  parseTitleId,
  progressLabel,
  titleForLevel,
  titleLabel,
  unseenIds,
} from "../packages/domain/src/badges.ts";

const group = "0f8fad5b-d9cb-469f-a165-70867728950e";
const state = (key, current, levels = []) => ({
  key,
  current,
  levels: levels.map(([level, earnedAt, seen = false]) => ({
    level,
    earnedAt,
    seen,
  })),
});

test("six badges with distinct icons and five rising levels each", () => {
  assert.deepEqual(
    badgeCatalog.map((b) => [b.key, b.thresholds]),
    [
      ["rally", [1, 10, 25, 50, 100]],
      ["steady", [2, 3, 6, 12, 24]],
      ["new-faces", [5, 10, 25, 50, 100]],
      ["plus-one", [1, 3, 5, 10, 20]],
      ["host", [1, 5, 10, 25, 50]],
      ["full-house", [1, 3, 10, 25, 50]],
    ],
  );
  assert.equal(new Set(badgeCatalog.map((b) => b.glyph)).size, 6);
  for (const b of badgeCatalog)
    for (let i = 1; i < 5; i++)
      assert.ok(b.thresholds[i] > b.thresholds[i - 1]);
});

test("parseLevelId accepts only a catalog key and a level 1 to 5", () => {
  assert.deepEqual(parseLevelId("rally:3"), { key: "rally", level: 3 });
  assert.deepEqual(parseLevelId("full-house:5"), {
    key: "full-house",
    level: 5,
  });
  for (const bad of [
    "rally:0",
    "rally:6",
    "rally",
    "Rally:1",
    "first-rally",
    `regular:${group}`,
    "rally:1:x",
    "rally:01",
    "",
    "x".repeat(81),
  ])
    assert.equal(parseLevelId(bad), null, bad);
});

test("parseTitleId keeps accepting old badge ids, plain and per group", () => {
  assert.deepEqual(parseTitleId("first-rally"), {
    key: "first-rally",
    groupId: null,
  });
  assert.deepEqual(parseTitleId(`regular:${group}`), {
    key: "regular",
    groupId: group,
  });
  for (const bad of [
    "regular",
    `first-rally:${group}`,
    `Regular:${group}`,
    `regular:${group.toUpperCase()}`,
    "regular:not-a-uuid",
    "rally:1",
    "",
    "x".repeat(81),
    "streak-7",
  ])
    assert.equal(parseTitleId(bad), null, bad);
});

test("levelOf and nextTarget follow the thresholds", () => {
  assert.equal(levelOf(state("rally", 0)), 0);
  assert.equal(
    levelOf(
      state("rally", 30, [
        [1, "a"],
        [2, "b"],
        [3, "c"],
      ]),
    ),
    3,
  );
  assert.equal(nextTarget("rally", 9), 10);
  assert.equal(nextTarget("rally", 10), 25);
  assert.equal(nextTarget("rally", 100), null);
  assert.equal(nextTarget("steady", 0), 2);
});

test("newestUnseen shows one level per badge and counts the other badges", () => {
  const at = "2026-10-05T00:00:00Z";
  const badges = [
    state("rally", 25, [
      [1, at],
      [2, at],
      [3, at],
    ]),
    state("host", 1, [[1, "2026-10-01T00:00:00Z"]]),
    state("steady", 2, [[1, "2026-10-09T00:00:00Z", true]]),
  ];
  const moment = newestUnseen(badges);
  assert.deepEqual(
    { key: moment.key, level: moment.level, more: moment.more },
    { key: "rally", level: 3, more: 1 },
  );
  assert.deepEqual(unseenIds(badges), [
    "rally:1",
    "rally:2",
    "rally:3",
    "host:1",
  ]);
  const seen = badges.map((b) => ({
    ...b,
    levels: b.levels.map((l) => ({ ...l, seen: true })),
  }));
  assert.equal(newestUnseen(seen), null);
  assert.deepEqual(unseenIds(seen), []);
});

test("nextBadge picks the closest unfinished badge, never an empty or complete one", () => {
  const next = nextBadge([
    state("new-faces", 3),
    state("rally", 9, [[1, "a"]]),
  ]);
  assert.deepEqual(next, { key: "rally", level: 1, current: 9, target: 10 });
  assert.deepEqual(nextBadge([state("new-faces", 3)]), {
    key: "new-faces",
    level: 0,
    current: 3,
    target: 5,
  });
  assert.equal(
    nextBadge([
      state("host", 0),
      state("rally", 100, [
        [1, "a"],
        [2, "b"],
        [3, "c"],
        [4, "d"],
        [5, "e"],
      ]),
    ]),
    null,
  );
});

test("level copy is plain and fixed", () => {
  assert.equal(levelSentence("rally", 1), "Your first session, checked in.");
  assert.equal(levelSentence("rally", 3), "25 sessions, checked in.");
  assert.equal(levelSentence("steady", 4), "Played in 12 different months.");
  assert.equal(
    levelSentence("new-faces", 2),
    "Played alongside 10 different people.",
  );
  assert.equal(
    levelSentence("plus-one", 1),
    "You brought a guest who showed up.",
  );
  assert.equal(
    levelSentence("plus-one", 2),
    "Guests you brought showed up 3 times.",
  );
  assert.equal(levelSentence("host", 1), "You ran check-in at a session.");
  assert.equal(levelSentence("host", 3), "You’ve run check-in at 10 sessions.");
  assert.equal(
    levelSentence("full-house", 1),
    "You ran a session where every seat was taken.",
  );
  assert.equal(levelSentence("full-house", 2), "3 sessions you ran were full.");
  assert.equal(progressLabel("rally", 1), "1 more session");
  assert.equal(progressLabel("rally", 13), "13 more sessions");
  assert.equal(progressLabel("steady", 2), "2 more months");
  assert.equal(progressLabel("new-faces", 1), "1 more new person");
  assert.equal(progressLabel("new-faces", 3), "3 more new people");
  assert.equal(progressLabel("plus-one", 1), "1 more session with a guest");
  assert.equal(progressLabel("host", 4), "4 more sessions to run");
  assert.equal(progressLabel("full-house", 2), "2 more full sessions to run");
  assert.equal(levelLabel(0), "Not started");
  assert.equal(levelLabel(3), "Level 3");
  assert.equal(levelLabel(5), "Complete");
  assert.equal(medallionLabel("rally", 3), "Rally, level 3 of 5");
  assert.equal(medallionLabel("rally", 0), "Rally, not started");
});

test("old titles keep their names and map onto a level where one exists", () => {
  assert.equal(Object.keys(legacyTitles).length, 15);
  assert.equal(
    titleLabel({ key: "regular", groupName: "Sunday Dink" }),
    "Regular · Sunday Dink",
  );
  assert.equal(
    titleLabel({ key: "sessions-25", groupName: null }),
    "Twenty-Five",
  );
  assert.equal(titleForLevel("rally", 3), "sessions-25");
  assert.equal(titleForLevel("rally", 1), "first-rally");
  assert.equal(titleForLevel("new-faces", 4), "new-faces-50");
  assert.equal(titleForLevel("host", 3), "hosted-10");
  assert.equal(titleForLevel("steady", 1), null);
  assert.equal(titleForLevel("host", 2), null);
  assert.equal(legacyTitles.founder.shows, null);
  assert.equal(legacyTitles.regular.shows, null);
  assert.equal(legacyTitles["off-the-bench"].shows, null);
  assert.deepEqual(legacyTitles["hosted-10"].shows, { key: "host", level: 3 });
  assert.deepEqual(legacyTitles["sessions-100"].shows, {
    key: "rally",
    level: 5,
  });
});

// WCAG relative luminance and contrast.
const channel = (c) =>
  c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
const luminance = ([r, g, b]) =>
  0.2126 * channel(r / 255) +
  0.7152 * channel(g / 255) +
  0.0722 * channel(b / 255);
const contrast = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
};
const white = [255, 255, 255];

test("level colours keep the white icon and the numeral readable", () => {
  assert.equal(levelColors.length, 5);
  assert.equal(new Set(levelColors.map(([a, b]) => a + b)).size, 5);
  for (const [light, dark] of levelColors) {
    const mid = rgb(light).map((v, i) => (v + rgb(dark)[i]) / 2);
    assert.ok(contrast(white, mid) >= 3, `${light}→${dark} icon`);
    assert.ok(contrast(white, rgb(dark)) >= 4.5, `${dark} numeral`);
  }
});

test("the SQL thresholds match the catalog", async () => {
  const { readFileSync } = await import("node:fs");
  const migration = readFileSync(
    new URL(
      "../supabase/migrations/20261025090000_badge_levels.sql",
      import.meta.url,
    ),
    "utf8",
  );
  const body = migration.slice(migration.indexOf("app.badge_thresholds()"));
  const rows = [
    ...body
      .slice(0, body.indexOf("$$;"))
      .matchAll(/\('([a-z-]+)',(\d),(\d+)\)/g),
  ];
  const sqlThresholds = {};
  for (const [, key, level, target] of rows)
    (sqlThresholds[key] ??= [])[Number(level) - 1] = Number(target);
  assert.deepEqual(
    sqlThresholds,
    Object.fromEntries(badgeCatalog.map((b) => [b.key, [...b.thresholds]])),
  );
});
