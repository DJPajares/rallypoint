import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityFor,
  applyActivityDefaults,
  limitProblem,
  matchActivity,
} from "../packages/domain/src/activities.ts";

const levels = {
  beginner: "New to it.",
  intermediate: "Plays often.",
  advanced: "Plays competitively.",
};
const pickleball = {
  key: "pickleball",
  name: "Pickleball",
  icon: "pickleball",
  sortOrder: 1,
  listed: true,
  defaults: {
    capacity: 8,
    durationMinutes: 120,
    guests: true,
    cutoffHours: 24,
    opensDays: null,
  },
  limits: {
    minCapacity: 4,
    maxCapacity: 24,
    minDurationMinutes: 30,
    maxDurationMinutes: 240,
  },
  levels,
};
const general = {
  ...pickleball,
  key: "general",
  name: "Other",
  icon: "general",
  sortOrder: 99,
  listed: false,
  defaults: { ...pickleball.defaults, capacity: 12, guests: false },
  limits: {
    minCapacity: 2,
    maxCapacity: 50,
    minDurationMinutes: 15,
    maxDurationMinutes: 480,
  },
};
const catalog = [pickleball, general];
const blank = {
  title: "",
  activity: "",
  startLocal: "",
  endLocal: "",
  timeZone: "Asia/Manila",
  location: "",
  instructions: "",
  capacity: "12",
  openLocal: "",
  cutoffLocal: "",
  fee: "0.00",
  currency: "PHP",
  guests: false,
};
const none = new Set();

test("matching ignores case and spacing, and never names general", () => {
  assert.equal(activityFor(catalog, "  PICKLEBALL ").key, "pickleball");
  assert.equal(activityFor(catalog, "pottery").key, "general");
  assert.equal(matchActivity(catalog, "Other"), null);
  assert.equal(matchActivity(catalog, "general"), null);
});

test("defaults fill spots and guests without a start", () => {
  const form = applyActivityDefaults(
    blank,
    pickleball,
    none,
    "2026-10-30T09:00",
  );
  assert.equal(form.capacity, "8");
  assert.equal(form.guests, true);
  assert.equal(form.endLocal, "");
  assert.equal(form.openLocal, "");
  assert.equal(form.cutoffLocal, "");
});

test("times follow the start", () => {
  const form = applyActivityDefaults(
    { ...blank, startLocal: "2026-11-02T18:00" },
    pickleball,
    none,
    "2026-10-30T09:00",
  );
  assert.equal(form.endLocal, "2026-11-02T20:00");
  assert.equal(form.openLocal, "2026-10-30T09:00");
  assert.equal(form.cutoffLocal, "2026-11-01T18:00");
});

test("opening days count back from the start", () => {
  const weekAhead = {
    ...pickleball,
    defaults: { ...pickleball.defaults, opensDays: 7 },
  };
  const form = applyActivityDefaults(
    { ...blank, startLocal: "2026-11-20T18:00" },
    weekAhead,
    none,
    "2026-10-30T09:00",
  );
  assert.equal(form.openLocal, "2026-11-13T18:00");
});

test("cutoff never falls before opening", () => {
  const form = applyActivityDefaults(
    { ...blank, startLocal: "2026-10-30T20:00" },
    pickleball,
    none,
    "2026-10-30T09:00",
  );
  assert.equal(form.cutoffLocal, "2026-10-30T09:00");
});

test("touched field kept", () => {
  const form = applyActivityDefaults(
    {
      ...blank,
      capacity: "30",
      startLocal: "2026-11-02T18:00",
      endLocal: "2026-11-02T23:00",
    },
    pickleball,
    new Set(["capacity", "endLocal"]),
    "2026-10-30T09:00",
  );
  assert.equal(form.capacity, "30");
  assert.equal(form.guests, true);
  assert.equal(form.endLocal, "2026-11-02T23:00");
});

test("limit messages name the range in plain words", () => {
  const both = { capacity: true, duration: true };
  assert.equal(
    limitProblem(pickleball, { capacity: 30, durationMinutes: 120 }, both),
    "Pickleball sessions can have 4 to 24 spots.",
  );
  assert.equal(
    limitProblem(
      pickleball,
      { capacity: 30, durationMinutes: 120 },
      { capacity: false, duration: true },
    ),
    null,
  );
  assert.equal(
    limitProblem(pickleball, { capacity: 8, durationMinutes: 300 }, both),
    "Pickleball sessions can run 30 minutes to 4 hours.",
  );
  assert.equal(
    limitProblem(pickleball, { capacity: 4, durationMinutes: 30 }, both),
    null,
  );
  assert.equal(
    limitProblem(pickleball, { capacity: 24, durationMinutes: 240 }, both),
    null,
  );
  assert.equal(
    limitProblem(pickleball, { capacity: 8, durationMinutes: null }, both),
    null,
  );
  assert.equal(
    limitProblem(general, { capacity: 12, durationMinutes: 600 }, both),
    "These sessions can run 15 minutes to 8 hours.",
  );
});
