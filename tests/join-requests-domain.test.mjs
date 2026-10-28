import { test } from "node:test";
import assert from "node:assert/strict";
import {
  blankSession,
  normalizeSession,
} from "../packages/domain/src/session.ts";
import { nextWeekForm } from "../packages/domain/src/run-again.ts";
import { statusLabel } from "../packages/domain/src/my-sessions.ts";

// A draft-shaped form: only what normalizeSession needs without publishing.
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

test("parses who can join", () => {
  assert.equal(
    normalizeSession(form({ joinMode: "request" }), false).joinMode,
    "request",
  );
  assert.equal(normalizeSession(form(), false).joinMode, "direct");
  assert.throws(
    () => normalizeSession(form({ joinMode: "open" }), false),
    /Choose who can join\./,
  );
});

test("a blank session lets people join directly", () => {
  assert.equal(blankSession().joinMode, "direct");
});

test("a pending request reads as Request sent", () => {
  assert.equal(
    statusLabel({ status: "requested", waitPosition: null }, false),
    "Request sent",
  );
});

test("running a session again keeps who can join", () => {
  const source = {
    ...form({ joinMode: "request" }),
    startsAt: "2026-10-24T01:00:00Z",
    endsAt: "2026-10-24T03:00:00Z",
    opensAt: "2026-10-21T01:00:00Z",
    cutoffAt: "2026-10-23T13:00:00Z",
  };
  assert.equal(
    nextWeekForm(source, Date.parse("2026-10-24T04:00:00Z")).joinMode,
    "request",
  );
});
