import { test } from "node:test";
import assert from "node:assert/strict";
import {
  badgeCatalog,
  badgeStates,
  isBadgeKey,
  levelColors,
  levelLabel,
  levelOf,
  levelSentence,
  levelTarget,
  levelTitle,
  medallionLabel,
  newestUnseen,
  nextBadge,
  nextTarget,
  parseLevelId,
  progressLabel,
  rosterTitle,
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
    // The disc runs light (top-left) to dark; icons reach up to about a
    // quarter of the way along it, so check there as well as the middle.
    for (const t of [0.25, 0.5]) {
      const at = rgb(light).map((v, i) => v + (rgb(dark)[i] - v) * t);
      assert.ok(contrast(white, at) >= 3, `${light}→${dark} icon at ${t}`);
    }
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

test("levelTarget names what a level needs", () => {
  assert.equal(levelTarget("rally", 1), "1 session");
  assert.equal(levelTarget("rally", 3), "25 sessions");
  assert.equal(levelTarget("steady", 1), "2 months");
  assert.equal(levelTarget("new-faces", 5), "100 people");
  assert.equal(levelTarget("plus-one", 1), "1 session with a guest");
  assert.equal(levelTarget("plus-one", 2), "3 sessions with a guest");
  assert.equal(levelTarget("host", 2), "5 sessions run");
  assert.equal(levelTarget("full-house", 1), "1 full session");
  assert.equal(levelTarget("full-house", 3), "10 full sessions");
});

test("a badge response of another shape reads as empty, so pages keep working mid-rollout", () => {
  const old = { earned: [{ id: "first-rally" }], progress: [], title: null };
  assert.deepEqual(badgeStates(old), []);
  assert.deepEqual(badgeStates(null), []);
  const view = { badges: [state("rally", 1)], titles: [{ id: "first-rally" }] };
  assert.equal(badgeStates(view), view.badges);
  assert.equal(newestUnseen(badgeStates(old)), null);
  assert.equal(nextBadge(badgeStates(old)), null);
});

test("each badge has five level titles, none of them a badge name", () => {
  assert.deepEqual(
    badgeCatalog.map((b) => [b.key, b.titles]),
    [
      ["rally", ["Rookie", "Regular", "Mainstay", "Veteran", "Rally Master"]],
      [
        "steady",
        ["Returner", "Familiar Face", "Fixture", "Year-Rounder", "Lifer"],
      ],
      [
        "new-faces",
        [
          "Friendly Face",
          "Mixer",
          "Connector",
          "Social Butterfly",
          "Super Connector",
        ],
      ],
      [
        "plus-one",
        [
          "Good Company",
          "Recruiter",
          "Talent Scout",
          "Ambassador",
          "Grand Ambassador",
        ],
      ],
      [
        "host",
        [
          "Organizer",
          "Game Runner",
          "Ringleader",
          "Club Captain",
          "Community Pillar",
        ],
      ],
      [
        "full-house",
        [
          "Crowd Puller",
          "Crowd Favourite",
          "Headliner",
          "Sell-Out Star",
          "Main Event",
        ],
      ],
    ],
  );
  const names = new Set(badgeCatalog.map((b) => b.name.toLowerCase()));
  const titles = badgeCatalog.flatMap((b) => b.titles);
  for (const title of titles) assert.ok(!names.has(title.toLowerCase()), title);
  assert.equal(new Set(titles).size, 30);
  assert.equal(levelTitle("rally", 5), "Rally Master");
  assert.equal(levelTitle("host", 3), "Ringleader");
});

test("rosterTitle reads only a catalog badge at level 1 to 5", () => {
  assert.deepEqual(rosterTitle({ key: "rally", level: 3 }), {
    key: "rally",
    level: 3,
  });
  for (const bad of [
    { key: "first-rally", groupName: null },
    { key: "rally", level: 0 },
    { key: "rally", level: 6 },
    { key: "rally", level: "3" },
    { key: "rally", level: 2.5 },
    { key: "rally" },
    null,
    undefined,
    "rally",
  ])
    assert.equal(rosterTitle(bad), null, JSON.stringify(bad));
  assert.equal(isBadgeKey("rally"), true);
  assert.equal(isBadgeKey("sessions-25"), false);
  assert.equal(isBadgeKey("rally:1"), false);
});

test("newestUnseen leads with the badge shown as your title", () => {
  const badges = [
    state("rally", 10, [
      [1, "2026-10-01T00:00:00Z", true],
      [2, "2026-10-02T00:00:00Z"],
    ]),
    state("host", 1, [[1, "2026-10-05T00:00:00Z"]]),
  ];
  const pick = (m) => ({ key: m.key, level: m.level, more: m.more });
  assert.deepEqual(pick(newestUnseen(badges, "rally")), {
    key: "rally",
    level: 2,
    more: 1,
  });
  assert.deepEqual(pick(newestUnseen(badges)), {
    key: "host",
    level: 1,
    more: 1,
  });
  assert.deepEqual(pick(newestUnseen(badges, "steady")), {
    key: "host",
    level: 1,
    more: 1,
  });
});
