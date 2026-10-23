import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeSession } from "../packages/domain/src/session.ts";
import { nextWeekForm } from "../packages/domain/src/run-again.ts";

// A published Saturday-morning session in Manila, as stored after publishing.
const source = (over = {}) => ({
  title: "Saturday Dink",
  activity: "Pickleball",
  startLocal: "2026-10-24T09:00",
  endLocal: "2026-10-24T11:00",
  timeZone: "Asia/Manila",
  location: "Synthetic court",
  instructions: "Bring water",
  capacity: "16",
  openLocal: "2026-10-21T09:00",
  cutoffLocal: "2026-10-23T21:00",
  fee: "200.00",
  currency: "PHP",
  guests: true,
  feeMode: "fixed",
  paymentMode: "organizer",
  releaseUnpaid: true,
  startsAt: "2026-10-24T01:00:00Z",
  endsAt: "2026-10-24T03:00:00Z",
  opensAt: "2026-10-21T01:00:00Z",
  cutoffAt: "2026-10-23T13:00:00Z",
  feeMinor: 20000,
  ...over,
});
// Saturday 24 Oct 2026, 12:00 in Manila: just after the source ended.
const afterSource = Date.parse("2026-10-24T04:00:00Z");

test("runs on the same weekday and local time one week later", () => {
  const next = nextWeekForm(source(), afterSource);
  assert.equal(next.startLocal, "2026-10-31T09:00");
  assert.equal(next.endLocal, "2026-10-31T11:00");
  assert.equal(next.openLocal, "2026-10-28T09:00");
  assert.equal(next.cutoffLocal, "2026-10-30T21:00");
});

test("an older session runs in the next upcoming week", () => {
  const old = source({
    startLocal: "2026-10-10T09:00",
    endLocal: "2026-10-10T11:00",
    openLocal: "2026-10-07T09:00",
    cutoffLocal: "2026-10-09T21:00",
  });
  const next = nextWeekForm(old, afterSource);
  assert.equal(next.startLocal, "2026-10-31T09:00");
  assert.equal(next.openLocal, "2026-10-28T09:00");
});

test("a session later today still moves to next week", () => {
  // 08:00 in Manila on the same Saturday, an hour before the source starts.
  const next = nextWeekForm(source(), Date.parse("2026-10-24T00:00:00Z"));
  assert.equal(next.startLocal, "2026-10-31T09:00");
});

test("keeps the details and drops everything derived at publish", () => {
  const next = nextWeekForm(source(), afterSource);
  assert.deepEqual(
    {
      title: next.title,
      activity: next.activity,
      location: next.location,
      instructions: next.instructions,
      capacity: next.capacity,
      fee: next.fee,
      currency: next.currency,
      guests: next.guests,
      feeMode: next.feeMode,
      paymentMode: next.paymentMode,
      releaseUnpaid: next.releaseUnpaid,
      timeZone: next.timeZone,
    },
    {
      title: "Saturday Dink",
      activity: "Pickleball",
      location: "Synthetic court",
      instructions: "Bring water",
      capacity: "16",
      fee: "200.00",
      currency: "PHP",
      guests: true,
      feeMode: "fixed",
      paymentMode: "organizer",
      releaseUnpaid: true,
      timeZone: "Asia/Manila",
    },
  );
  for (const key of ["startsAt", "endsAt", "opensAt", "cutoffAt", "feeMinor"])
    assert.equal(key in next, false, key);
});

test("an opening time that would be in the past opens now", () => {
  // Opens ten days ahead, so next week's opening would already have passed.
  const early = source({ openLocal: "2026-10-14T09:00" });
  const next = nextWeekForm(early, Date.parse("2026-10-24T04:00:30Z"));
  assert.equal(next.openLocal, "2026-10-24T12:01");
  assert.equal(next.cutoffLocal, "2026-10-30T21:00");
});

test("the cutoff never falls before the opening time", () => {
  const early = source({
    openLocal: "2026-10-14T09:00",
    cutoffLocal: "2026-10-15T09:00",
  });
  const next = nextWeekForm(early, afterSource);
  assert.equal(next.openLocal, "2026-10-24T12:00");
  assert.equal(next.cutoffLocal, "2026-10-24T12:00");
});

test("local time is kept across a clock change", () => {
  // Berlin leaves summer time on 25 Oct 2026.
  const berlin = source({
    timeZone: "Europe/Berlin",
    currency: "EUR",
    fee: "8.00",
    startLocal: "2026-10-21T19:00",
    endLocal: "2026-10-21T21:00",
    openLocal: "2026-10-18T19:00",
    cutoffLocal: "2026-10-21T07:00",
  });
  const next = nextWeekForm(berlin, Date.parse("2026-10-22T08:00:00Z"));
  assert.equal(next.startLocal, "2026-10-28T19:00");
  const published = normalizeSession(next, true);
  assert.equal(published.startsAt, "2026-10-28T18:00:00Z");
});

test("a Not tracked here session stays valid", () => {
  const untracked = source({
    paymentMode: "untracked",
    releaseUnpaid: false,
    fee: "0.00",
    feeMode: undefined,
    cutoffLocal: "2026-10-24T09:00",
  });
  const next = nextWeekForm(untracked, afterSource);
  assert.equal(next.cutoffLocal, "2026-10-31T09:00");
  assert.equal(next.paymentMode, "untracked");
});

test("every result publishes without changes", () => {
  for (const s of [
    source(),
    source({ openLocal: "2026-10-14T09:00" }),
    source({
      openLocal: "2026-10-14T09:00",
      cutoffLocal: "2026-10-15T09:00",
      releaseUnpaid: false,
    }),
  ])
    assert.doesNotThrow(() =>
      normalizeSession(nextWeekForm(s, afterSource), true),
    );
});
