import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSession } from "../packages/domain/src/session.ts";
import { nextWeekForm } from "../packages/domain/src/run-again.ts";

// P-36: who can see a session is part of its details, like who can join.
const form = (over = {}) => ({
  title: "Saturday Dink",
  activity: "Pickleball",
  startLocal: "2026-10-24T09:00",
  endLocal: "2026-10-24T11:00",
  timeZone: "Asia/Manila",
  location: "Synthetic court",
  instructions: "",
  capacity: "16",
  openLocal: "2026-10-21T09:00",
  cutoffLocal: "2026-10-23T21:00",
  fee: "0.00",
  currency: "PHP",
  guests: true,
  ...over,
});

test("sessions are public unless made private", () => {
  assert.equal(normalizeSession(form(), false).access, "public");
  assert.equal(
    normalizeSession(form({ access: "private" }), false).access,
    "private",
  );
  assert.throws(() => normalizeSession(form({ access: "secret" }), false));
});

test("a private session is always join directly", () => {
  assert.equal(
    normalizeSession(form({ access: "private", joinMode: "request" }), false)
      .joinMode,
    "direct",
  );
  assert.equal(
    normalizeSession(form({ joinMode: "request" }), false).joinMode,
    "request",
  );
});

test("run again keeps the session private", () => {
  const source = {
    ...form({ access: "private" }),
    startsAt: "2026-10-24T01:00:00Z",
    endsAt: "2026-10-24T03:00:00Z",
    opensAt: "2026-10-21T01:00:00Z",
    cutoffAt: "2026-10-23T13:00:00Z",
  };
  assert.equal(
    nextWeekForm(source, Date.parse("2026-10-24T04:00:00Z")).access,
    "private",
  );
});
