import { test } from "node:test";
import assert from "node:assert/strict";
import {
  levelLabel,
  normalizeProfile,
  playsLine,
} from "../packages/domain/src/profile.ts";

test("a name is trimmed and blank means no override", () => {
  assert.deepEqual(
    normalizeProfile({ name: "  Sam  ", activities: [] }).value.name,
    "Sam",
  );
  assert.equal(
    normalizeProfile({ name: "   ", activities: [] }).value.name,
    null,
  );
});

test("80 code points pass and 81 fail, emoji included", () => {
  assert.equal(
    normalizeProfile({ name: "🏓".repeat(80), activities: [] }).ok,
    true,
  );
  const r = normalizeProfile({ name: "é".repeat(81), activities: [] });
  assert.equal(r.ok, false);
  assert.equal(r.errors[0].field, "name");
});

test("activities: presets match case-insensitively and keep their preset spelling", () => {
  const r = normalizeProfile({
    name: "",
    activities: [{ name: " pickleball ", level: "intermediate" }],
  });
  assert.deepEqual(r.value.activities, [
    { name: "Pickleball", level: "intermediate" },
  ]);
});

test("activities: limits", () => {
  const custom = (n) => ({ name: `Sport ${n}`, level: null });
  assert.equal(
    normalizeProfile({ name: "", activities: [1, 2, 3, 4].map(custom) }).ok,
    false,
  ); // 4 custom
  assert.equal(
    normalizeProfile({
      name: "",
      activities: [{ name: "x".repeat(41), level: null }],
    }).ok,
    false,
  );
  assert.equal(
    normalizeProfile({
      name: "",
      activities: [
        { name: "Tennis", level: null },
        { name: "tennis ", level: "beginner" },
      ],
    }).ok,
    false,
  );
  assert.equal(
    normalizeProfile({
      name: "",
      activities: [{ name: "Tennis", level: "pro" }],
    }).ok,
    false,
  );
  const all = ["Pickleball", "Badminton", "Tennis", "Basketball"].map(
    (name) => ({ name, level: null }),
  );
  assert.equal(
    normalizeProfile({
      name: "",
      activities: [...all, ...[1, 2, 3].map(custom)],
    }).ok,
    true,
  ); // 7, the most possible
});

test("plays line", () => {
  assert.equal(
    playsLine([
      { name: "Pickleball", level: "intermediate" },
      { name: "Badminton", level: null },
    ]),
    "Plays: Pickleball (Intermediate), Badminton",
  );
  assert.equal(playsLine([]), "");
});

test("each failing field reports one plain error", () => {
  const r = normalizeProfile({
    name: "é".repeat(81),
    activities: [1, 2, 3, 4].map((n) => ({ name: `Sport ${n}`, level: null })),
  });
  assert.equal(r.ok, false);
  assert.deepEqual(r.errors, [
    { field: "name", message: "Use a name of up to 80 characters." },
    { field: "activities", message: "Add up to 3 of your own activities." },
  ]);
});

test("level labels read in words", () => {
  assert.equal(levelLabel.beginner, "Beginner");
  assert.equal(levelLabel.intermediate, "Intermediate");
  assert.equal(levelLabel.advanced, "Advanced");
});
