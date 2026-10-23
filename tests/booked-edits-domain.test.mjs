import test from "node:test";
import assert from "node:assert/strict";
import * as session from "../packages/domain/src/session.ts";
import { feeStanding } from "../packages/domain/src/registration.ts";
const form = {
  title: "Evening practice",
  activity: "Badminton",
  location: "Court A",
  instructions: "",
  capacity: "8",
  currency: "SGD",
  fee: "12",
  guests: true,
  startLocal: "2027-05-09T19:00",
  endLocal: "2027-05-09T21:00",
  openLocal: "2027-05-01T09:00",
  cutoffLocal: "2027-05-08T19:00",
  timeZone: "Asia/Singapore",
};
test("confirmation follows real instants or venue, including end-only changes", () => {
  const before = session.normalizeSession(form, true);
  assert.equal(typeof session.hasMaterialSessionChange, "function");
  assert.equal(
    session.hasMaterialSessionChange(before, {
      ...before,
      title: "Corrected",
      capacity: "10",
    }),
    false,
  );
  assert.equal(
    session.hasMaterialSessionChange(before, {
      ...before,
      startsAt: "2027-05-09T19:00:00+08:00",
    }),
    false,
  );
  for (const changed of [
    { location: "Court B" },
    { startsAt: "2027-05-09T12:00:00Z" },
    { endsAt: "2027-05-09T14:00:00Z" },
  ])
    assert.equal(
      session.hasMaterialSessionChange(before, { ...before, ...changed }),
      true,
    );
});
test("editing a saved session keeps its zone when the device moves", () => {
  const before = session.normalizeSession(form, true),
    old = process.env.TZ;
  try {
    process.env.TZ = "America/Los_Angeles";
    const after = session.normalizeSession(
      { ...before, title: "Correction" },
      true,
    );
    assert.equal(after.startsAt, "2027-05-09T11:00:00Z");
    assert.equal(after.timeZone, "Asia/Singapore");
    assert.equal(session.hasMaterialSessionChange(before, after), false);
  } finally {
    if (old === undefined) delete process.env.TZ;
    else process.env.TZ = old;
  }
});
test("a change-based release has the same removed standing as other releases", () => {
  assert.equal(
    feeStanding({
      liabilityState: "removed_after_change",
      markedPaid: false,
      totalMinor: 1200,
    }),
    "Removed",
  );
});

test("a published edit still requires confirmation when a first booking arrives after the editor loaded", () => {
  const details = session.normalizeSession(form, true);
  const loadedBeforeFirstBooking = {
    state: "published",
    bookingsStarted: false,
    details,
  };
  assert.equal(typeof session.sessionEditNeedsConfirmation, "function");
  assert.equal(
    session.sessionEditNeedsConfirmation(loadedBeforeFirstBooking, {
      ...details,
      location: "Court B",
    }),
    true,
  );
  assert.equal(
    session.sessionEditNeedsConfirmation(loadedBeforeFirstBooking, {
      ...details,
      title: "Corrected",
    }),
    false,
  );
  assert.equal(
    session.sessionEditNeedsConfirmation(
      { ...loadedBeforeFirstBooking, state: "draft" },
      { ...details, location: "Court B" },
    ),
    false,
  );
});
